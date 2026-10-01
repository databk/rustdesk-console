#!/usr/bin/env python3
"""Install an official complete backend/web pair and its supervised updater."""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import pwd
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

REPOSITORIES = {'backend': 'databk/rustdesk-console', 'web': 'databk/rustdesk-console-web'}
OFFICIAL_HOSTS = {'api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}
VERSION = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 4 * 1024 * 1024 * 1024
SPACE_HEADROOM = 64 * 1024 * 1024
ROOT = pathlib.Path('/opt/rustdesk-console')
CONFIG = pathlib.Path('/etc/rustdesk-console')
STATE = pathlib.Path('/var/lib/rustdesk-console-updater')
DATA = pathlib.Path('/var/lib/rustdesk-console')
MAINTENANCE = pathlib.Path('/var/lib/rustdesk-console-maintenance')
IPC = pathlib.Path('/run/rustdesk-console-updater')
UNITS = {'backend': 'rustdesk-console-backend.service', 'web': 'rustdesk-console-web.service',
         'updater': 'rustdesk-console-updater.service', 'job': 'rustdesk-console-update-job@.service'}


def filesystem_path(path):
    existing = pathlib.Path(path)
    while not existing.exists():
        parent = existing.parent
        if parent == existing:
            raise ValueError('Installation filesystem is unavailable')
        existing = parent
    return existing


def allocation_size(size, block_size):
    return ((size + block_size - 1) // block_size) * block_size


def filesystem_block_size(path):
    information = os.statvfs(filesystem_path(path))
    return max(information.f_frsize, information.f_bsize, 1)


def require_space(path, additional_bytes, operation):
    available = shutil.disk_usage(filesystem_path(path)).free
    required = additional_bytes + SPACE_HEADROOM
    if available < required:
        raise ValueError(f'Insufficient free space for {operation}: {required} bytes required '
                         f'(including {SPACE_HEADROOM} bytes of headroom), {available} bytes available')


def require_installation_space(bundles):
    block_size = filesystem_block_size(ROOT)
    required = 0
    for bundle in bundles.values():
        for folder, _directories, files in os.walk(bundle):
            required += block_size
            for name in files:
                required += allocation_size((pathlib.Path(folder) / name).stat().st_size, block_size)
    # Staged archives and expanded trees are already reflected in free space.
    # Only the additional copies count here, even when /var/tmp shares /opt.
    require_space(ROOT, required, 'installing the complete backend and web bundles')


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in OFFICIAL_HOSTS
            or parsed.port not in (None, 443) or parsed.username or parsed.password):
        raise ValueError('Artifact redirect left the official HTTPS allowlist')


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        validate_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def download(url, destination, limit):
    validate_url(url)
    require_space(destination, allocation_size(limit, filesystem_block_size(destination)), 'downloading an official artifact')
    request = urllib.request.Request(url, headers={'User-Agent': 'rustdesk-console-installer/1'})
    opener = urllib.request.build_opener(OfficialRedirect())
    with opener.open(request, timeout=60) as response, open(destination, 'xb') as output:
        validate_url(response.url)
        size = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError('Official artifact exceeded the installation size limit')
            output.write(chunk)
        output.flush()
        os.fsync(output.fileno())


def fetch_json(url, directory, name):
    file = directory / name
    download(url, file, 4 * 1024 * 1024)
    return json.loads(file.read_text(encoding='utf8'))


def sha256_file(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def satisfies(version, expression):
    current = tuple(map(int, version.split('.')))
    terms = expression.split() if isinstance(expression, str) else []
    if not terms:
        return False
    for term in terms:
        matched = re.fullmatch(r'(>=|<=|>|<|=)(' + VERSION + ')', term)
        if not matched:
            return False
        target = tuple(map(int, matched[2].split('.')))
        results = {'>=': current >= target, '<=': current <= target, '>': current > target, '<': current < target, '=': current == target}
        if not results[matched[1]]:
            return False
    return True


def load_release(component, tag, target, directory):
    repository = REPOSITORIES[component]
    if tag != 'latest' and not re.fullmatch(r'v?' + VERSION, tag):
        raise ValueError('Installation accepts only official stable release tags')
    suffix = 'latest' if tag == 'latest' else 'tags/' + tag
    release = fetch_json(f'https://api.github.com/repos/{repository}/releases/{suffix}', directory, component + '-release.json')
    release_tag = release.get('tag_name', '')
    if (release.get('draft') is not False or release.get('prerelease') is not False
            or not release.get('published_at') or not re.fullmatch(r'v?' + VERSION, release_tag)):
        raise ValueError('Release is not an official published stable version')
    manifest_url = f'https://github.com/{repository}/releases/download/{release_tag}/update-manifest.json'
    assets = release.get('assets', [])
    if not any(item.get('browser_download_url') == manifest_url and item.get('state') == 'uploaded' for item in assets):
        raise ValueError('Release does not yet contain its finalized update manifest')
    manifest = fetch_json(manifest_url, directory, component + '-manifest.json')
    expected = {'schemaVersion': 1, 'repository': repository, 'component': component, 'version': release_tag.lstrip('v'),
                'releaseId': release['id'], 'tag': release_tag, 'publishedAt': release['published_at'],
                'updaterProtocol': 1, 'maintenanceProtocol': 1, 'bundleFormat': 1}
    if any(manifest.get(key) != value for key, value in expected.items()) or not re.fullmatch('[a-f0-9]{40}', manifest.get('sourceCommit', '')):
        raise ValueError('Release manifest identity or protocol is invalid')
    commit = fetch_json(f'https://api.github.com/repos/{repository}/commits/{release_tag}', directory, component + '-commit.json')
    if commit.get('sha') != manifest['sourceCommit']:
        raise ValueError('Manifest source commit differs from the official release tag')
    selected = [item for item in manifest.get('artifacts', []) if item.get('kind') == 'archive' and item.get('platform') == target]
    if len(selected) != 1:
        raise ValueError('Release does not have exactly one complete bundle for this platform')
    artifact = selected[0]
    name = artifact.get('name', '')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+\.tar\.gz', name):
        raise ValueError('Invalid archive name')
    url = f'https://github.com/{repository}/releases/download/{release_tag}/{name}'
    asset = next((item for item in assets if item.get('name') == name), None)
    if (artifact.get('url') != url or not asset or asset.get('state') != 'uploaded'
            or asset.get('browser_download_url') != url or asset.get('size') != artifact.get('size')
            or not isinstance(artifact.get('size'), int) or not 0 < artifact['size'] <= MAX_ARCHIVE
            or not re.fullmatch('[a-f0-9]{64}', artifact.get('sha256', ''))):
        raise ValueError('Complete bundle does not match the published asset')
    return {'version': manifest['version'], 'sourceCommit': manifest['sourceCommit'], 'manifest': manifest, 'artifact': artifact}


def extract_bundle(archive, destination):
    """Extract only regular files/directories, with bounded expansion and no traversal."""
    seen = set()
    total = 0
    block_size = filesystem_block_size(destination)
    expanded_bytes = 0
    directories = {pathlib.PurePosixPath('.')}
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        if len(members) > 100000:
            raise ValueError('Bundle contains too many entries')
        for member in members:
            name = member.name
            relative = pathlib.PurePosixPath(name)
            if (relative.is_absolute() or '..' in relative.parts or '\\' in name
                    or not (member.isfile() or member.isdir()) or member.size < 0
                    or any(ord(char) < 32 for char in name)):
                raise ValueError('Unsafe archive entry')
            key = str(relative)
            if key in seen or key.startswith('/'):
                raise ValueError('Duplicate archive entry')
            seen.add(key)
            total += member.size
            if total > MAX_EXPANDED:
                raise ValueError('Bundle expansion exceeds limit')
            directories.update(relative.parents)
            if member.isdir():
                directories.add(relative)
            else:
                expanded_bytes += allocation_size(member.size, block_size)
        require_space(destination, expanded_bytes + len(directories) * block_size, 'expanding a verified bundle')
        destination.mkdir(mode=0o755)
        for member in members:
            relative = pathlib.PurePosixPath(member.name)
            output = destination.joinpath(*relative.parts)
            if member.isdir():
                output.mkdir(mode=0o755, parents=True, exist_ok=True)
            else:
                output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, output.open('xb') as target:
                    shutil.copyfileobj(source, target)
                output.chmod(0o755 if member.mode & 0o111 else 0o644)
        # umask 077 protects credentials, but the service account reads assets.
        destination.chmod(0o755)
        for folder, directories, _files in os.walk(destination):
            for name in directories:
                (pathlib.Path(folder) / name).chmod(0o755)


def prepare_bundle(component, installed, target, directory):
    artifact = installed['artifact']
    archive = directory / (component + '.tar.gz')
    download(artifact['url'], archive, artifact['size'])
    if archive.stat().st_size != artifact['size'] or sha256_file(archive) != artifact['sha256']:
        raise ValueError('Downloaded bundle failed size or SHA-256 verification')
    extracted = directory / component
    extract_bundle(archive, extracted)
    info = json.loads((extracted / 'build-info.json').read_text(encoding='utf8'))
    expected = {'component': component, 'version': installed['version'], 'sourceCommit': installed['sourceCommit'],
                'bundleFormat': 1, 'platform': target['os'], 'arch': target['arch'], 'libc': target['libc']}
    if any(info.get(key) != value for key, value in expected.items()):
        raise ValueError('Bundle build identity does not match the manifest')
    metadata = json.loads((extracted / 'release-metadata.json').read_text(encoding='utf8'))
    if metadata != {'version': installed['version'], 'sourceCommit': installed['sourceCommit']}:
        raise ValueError('Runtime metadata does not match the manifest')
    executable = extracted / ('rustdesk-console' if component == 'backend' else 'rustdesk-console-web')
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError('Bundle executable is missing or not executable')
    if component == 'backend':
        for required in ['node_modules/sqlite3', 'node_modules/sharp', 'templates/email', 'templates/oidc', 'deployment/systemd']:
            if not (extracted / required).is_dir():
                raise ValueError('Backend archive is not a complete SEA bundle')
    return extracted


def parse_environment(file):
    values = {}
    if not file:
        return values
    for line in pathlib.Path(file).read_text(encoding='utf8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch('[A-Z][A-Z0-9_]*', key):
            raise ValueError('Configuration requires one KEY=value per line')
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError('Unterminated configuration quote')
            value = value[1:-1]
        if any(char in value for char in ['\n', '\r', '\x00']):
            raise ValueError('Multiline configuration is unsupported')
        values[key] = value
    return values


def private_write(file, contents, mode=0o600):
    descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'w', encoding='utf8') as stream:
        stream.write(contents)
        stream.flush()
        os.fsync(stream.fileno())


def write_environment(file, values):
    def quoted(value):
        return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
    private_write(file, ''.join(f'{key}={quoted(value)}\n' for key, value in values.items()))


def database_environment(values):
    result = {**values, 'DB_TYPE': values.get('DB_TYPE', '').strip().lower() or 'sqlite'}
    if result['DB_TYPE'] not in ['sqlite', 'mysql']:
        raise ValueError('DB_TYPE must be sqlite or mysql')
    if result['DB_TYPE'] == 'mysql':
        if result.get('SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA') != 'true':
            raise ValueError('MySQL requires an explicitly dedicated schema: SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA=true')
        # Persist the same effective defaults used by the application before hashing.
        for key, default in {'DB_HOST': 'localhost', 'DB_PORT': '3306', 'DB_USERNAME': 'root',
                             'DB_PASSWORD': '', 'DB_DATABASE': 'rustdesk_console'}.items():
            result[key] = result.get(key) or default
        port = int(result['DB_PORT'])
        if not 1 <= port <= 65535:
            raise ValueError('DB_PORT must be between 1 and 65535')
        result['DB_PORT'] = str(port)
    return result


def configuration_hashes(database):
    files = [CONFIG / name for name in ['backend.env', 'web.env', 'updater.env']]
    if database['kind'] == 'mysql':
        files.append(pathlib.Path(database['passwordFile']))
    return {str(file): sha256_file(file) for file in files}


def health(url, expected, component):
    with urllib.request.urlopen(url, timeout=5) as response:
        info = json.loads(response.read(1024 * 1024))
    return (info.get('component') == component and info.get('version') == expected['version']
            and info.get('sourceCommit') == expected['sourceCommit'] and info.get('ready') is True
            and info.get('maintenanceProtocol') == 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-tag', default='latest')
    parser.add_argument('--web-tag', default='latest')
    parser.add_argument('--config', type=pathlib.Path, help='Initial backend KEY=value configuration; never evaluated as shell')
    options = parser.parse_args()
    if os.geteuid() != 0 or platform.system() != 'Linux' or not pathlib.Path('/run/systemd/system').is_dir():
        raise ValueError('The installer requires root on a systemd Linux host')
    if (CONFIG / 'installation.json').exists() or any((ROOT / name).exists() or (ROOT / name).is_symlink() for name in ['current-backend', 'current-web', 'current-updater']):
        raise ValueError('An installation already exists; use its update or recovery operation')
    if any((CONFIG / name).exists() for name in ['backend.env', 'web.env', 'updater.env']):
        raise ValueError('Existing configuration must be migrated explicitly; it will not be overwritten')
    if DATA.exists() and any(DATA.iterdir()):
        raise ValueError('Existing data requires the documented manual migration procedure')
    recovery = pathlib.Path('/usr/local/sbin/rustdesk-console-recover')
    if recovery.exists() or recovery.is_symlink() or any((pathlib.Path('/etc/systemd/system') / unit).exists() for unit in UNITS.values()):
        raise ValueError('Existing service files require manual migration; they will not be overwritten')
    arch = {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine())
    if not arch:
        raise ValueError('Supported Linux architectures are x64 and arm64')
    libc = 'musl' if list(pathlib.Path('/lib').glob('ld-musl-*.so.1')) else 'glibc'
    target = {'os': 'linux', 'arch': arch, 'libc': libc}
    values = database_environment(parse_environment(options.config))
    values.setdefault('JWT_SECRET', secrets.token_urlsafe(48))
    values.setdefault('ADMIN_PASSWORD', secrets.token_urlsafe(24))
    if not values['JWT_SECRET'] or not values['ADMIN_PASSWORD']:
        raise ValueError('JWT_SECRET and ADMIN_PASSWORD must be nonempty')
    port = int(values.get('PORT', '3000'))
    if not 1024 <= port <= 65535 or port == 21114:
        raise ValueError('Backend PORT must be an unprivileged port other than 21114')
    for executable in ['systemctl', 'sqlite3', 'useradd']:
        if not shutil.which(executable):
            raise ValueError('Required installation tool is missing: ' + executable)
    if not any(shutil.which(item) for item in ['mysql', 'mariadb']) or not any(shutil.which(item) for item in ['mysqldump', 'mariadb-dump']):
        raise ValueError('The standard installation requires MySQL backup and restore clients')
    with tempfile.TemporaryDirectory(prefix='rustdesk-console-install-', dir='/var/tmp') as temporary:
        directory = pathlib.Path(temporary)
        current = {component: load_release(component, getattr(options, component + '_tag'), target, directory) for component in ['backend', 'web']}
        if not satisfies(current['web']['version'], current['backend']['manifest'].get('peerVersionRange')) or not satisfies(current['backend']['version'], current['web']['manifest'].get('peerVersionRange')):
            raise ValueError('Official backend and web releases do not declare mutual compatibility')
        bundles = {component: prepare_bundle(component, current[component], target, directory) for component in ['backend', 'web']}
        require_installation_space(bundles)
        try:
            account = pwd.getpwnam('rustdesk-console')
        except KeyError:
            subprocess.run(['useradd', '--system', '--user-group', '--home-dir', str(DATA), '--shell', '/usr/sbin/nologin', 'rustdesk-console'], check=True)
            account = pwd.getpwnam('rustdesk-console')
        for folder, mode in [(ROOT, 0o755), (CONFIG, 0o750), (STATE, 0o700), (DATA, 0o750), (MAINTENANCE, 0o755), (IPC, 0o750)]:
            folder.mkdir(mode=mode, parents=True, exist_ok=True)
            folder.chmod(mode)
        os.chown(DATA, account.pw_uid, account.pw_gid)
        os.chown(IPC, 0, account.pw_gid)
        for component in ['backend', 'web']:
            destination = ROOT / 'releases' / component / current[component]['version']
            destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            (ROOT / 'releases').chmod(0o755)
            destination.parent.chmod(0o755)
            shutil.copytree(bundles[component], destination)
            private_write(destination / '.updater-integrity.json', json.dumps({'sha256': current[component]['artifact']['sha256']}) + '\n')
            (ROOT / ('current-' + component)).symlink_to(destination, target_is_directory=True)
        (ROOT / 'current-updater').symlink_to(ROOT / 'releases/backend' / current['backend']['version'], target_is_directory=True)
        values.update({'DATA_DIR': str(DATA), 'PORT': str(port), 'NODE_ENV': 'production',
                       'SYSTEM_UPDATE_SOCKET': str(IPC / 'control.sock'), 'SYSTEM_UPDATE_MAINTENANCE_FILE': str(MAINTENANCE / 'maintenance.json')})
        write_environment(CONFIG / 'backend.env', values)
        write_environment(CONFIG / 'web.env', {'PORT': '21114', 'BACKEND_URL': f'http://127.0.0.1:{port}', 'BIND_ADDR': '0.0.0.0'})
        write_environment(CONFIG / 'updater.env', {'SYSTEM_UPDATE_INSTALLATION': str(CONFIG / 'installation.json'),
                          'SYSTEM_UPDATE_SOCKET': str(IPC / 'control.sock'), 'SYSTEM_UPDATE_SOCKET_GID': account.pw_gid,
                          'SYSTEM_UPDATE_MAINTENANCE_FILE': str(MAINTENANCE / 'maintenance.json')})
        if values['DB_TYPE'] == 'sqlite':
            database = {'kind': 'sqlite', 'path': str(DATA / 'rustdesk-console.db')}
        else:
            password_file = CONFIG / 'mysql.password'
            private_write(password_file, values['DB_PASSWORD'])
            database = {'kind': 'mysql', 'host': values['DB_HOST'], 'port': int(values['DB_PORT']),
                        'username': values['DB_USERNAME'], 'database': values['DB_DATABASE'],
                        'passwordFile': str(password_file), 'exclusiveSchema': True}
        installation = {'schemaVersion': 1, 'installationId': str(uuid.uuid4()), 'deployment': 'managed-linux', 'platform': target,
                        'stateDir': str(STATE), 'ipcDir': str(IPC), 'maintenanceFile': str(MAINTENANCE / 'maintenance.json'), 'dataDir': str(DATA),
                        'backendHealthUrl': f'http://127.0.0.1:{port}/api/system-update/health', 'webHealthUrl': 'http://127.0.0.1:21114/system-update-health.json',
                        'current': current, 'database': database, 'linux': {'configFiles': configuration_hashes(database), 'releasesDir': str(ROOT / 'releases'),
                        'backendLink': str(ROOT / 'current-backend'), 'webLink': str(ROOT / 'current-web'), 'updaterLink': str(ROOT / 'current-updater'),
                        'units': UNITS, 'executableRelativePath': {'backend': 'rustdesk-console', 'web': 'rustdesk-console-web'}}}
        private_write(CONFIG / 'installation.json', json.dumps(installation, indent=2) + '\n')
        deployment = bundles['backend'] / 'deployment'
        for unit in UNITS.values():
            destination = pathlib.Path('/etc/systemd/system') / unit
            shutil.copyfile(deployment / 'systemd' / unit, destination)
            destination.chmod(0o644)
        shutil.copyfile(deployment / 'rustdesk-console-recover', recovery)
        recovery.chmod(0o755)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', 'enable', '--now', UNITS['updater'], UNITS['backend'], UNITS['web']], check=True)
        for _attempt in range(60):
            try:
                ready = (health(installation['backendHealthUrl'], current['backend'], 'backend')
                         and health(installation['webHealthUrl'], current['web'], 'web')
                         and health('http://127.0.0.1:21114/api/system-update/health', current['backend'], 'backend')
                         and (IPC / 'control.sock').is_socket())
                if ready:
                    print('Installed and verified backend, web, API proxy and updater IPC. Initial credentials: /etc/rustdesk-console/backend.env (root only).')
                    return
            except (OSError, ValueError):
                pass
            time.sleep(2)
        raise RuntimeError('Services were installed but readiness did not pass; inspect systemctl status and journalctl. No update success is claimed.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        # Avoid printing response bodies, credentials, command output or configuration.
        print('Installation failed: ' + (str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__), file=__import__('sys').stderr)
        raise SystemExit(1)
