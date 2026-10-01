"""Host-side transfer and real guest invocation; owns no Compose fixtures."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import tarfile
import uuid

from environment import command, mysql_sql, owned_container, PREFIX
from lifecycle import wait_until
from linux_evidence import load_context

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT.parent
VM = PREFIX + '-vm'
CONTEXT = load_context()
EVIDENCE = CONTEXT.root


def require_scheduling_slot():
    schedule = EVIDENCE / 'linux-schedule.json'
    if schedule.exists() and not json.loads(schedule.read_text()).get('allowNewCases', False):
        raise RuntimeError('Linux scheduling hold is active; no new case was started')


def ssh(script, timeout=600):
    return command('docker', 'exec', '-i', VM, 'ssh', '-i', '/vm/id_ed25519', '-p', '2222',
                   '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
                   'tester@127.0.0.1', "tr -d '\r' | bash -se", stdin=script, timeout=timeout).stdout


def component(archive, kind, version, release_id):
    with tarfile.open(archive, 'r:gz') as bundle:
        entries = {str(Path(item.name).as_posix()).removeprefix('./'): item for item in bundle}
        assert all(item.isfile() or item.isdir() for item in entries.values()), archive
        info = json.load(bundle.extractfile(entries['build-info.json']))
    assert info['version'] == version and info['component'] == kind
    repository = 'databk/rustdesk-console' + ('-web' if kind == 'web' else '')
    artifact = {'kind': 'archive', 'platform': {'os': 'linux', 'arch': 'x64', 'libc': 'glibc'},
                'name': archive.name, 'url': 'https://github.com/' + repository + '/releases/download/v' + version + '/' + archive.name,
                'size': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
    manifest = {'schemaVersion': 1, 'repository': repository, 'component': kind, 'version': version, 'tag': 'v' + version,
                'releaseId': release_id, 'sourceCommit': info['sourceCommit'], 'publishedAt': '2026-09-29T00:00:00.000Z',
                'peerVersionRange': '>=1.0.0 <2.0.0', 'updaterProtocol': 1, 'maintenanceProtocol': 1,
                'bundleFormat': 1, 'artifacts': [artifact]}
    return {'version': version, 'sourceCommit': info['sourceCommit'], 'manifest': manifest, 'artifact': artifact}


def stage(backend_fixtures=None, web_old=None, web_target=None, prepare_only=False):
    owned_container(VM)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    deployment = WORKSPACE / 'deployment-artifacts'
    frontend = WORKSPACE / 'frontend-evidence'
    archives = {'backendOld': deployment / 'backend-fixture-1.9.0-linux-x64.tar.gz',
                'backendTarget': deployment / 'backend-fixture-1.9.1-linux-x64.tar.gz',
                'webOld': frontend / 'rustdesk-console-web-linux-x64-baseline-1.6.0.tar.gz',
                'webTarget': frontend / 'rustdesk-console-web-linux-x64-target-1.6.1.tar.gz'}
    if web_old:
        archives['webOld'] = Path(web_old).resolve()
    if web_target:
        archives['webTarget'] = Path(web_target).resolve()
    if backend_fixtures:
        directory = Path(backend_fixtures).resolve()
        records = json.loads((directory / 'artifacts.json').read_text())
        for key, version in [('backendOld', '1.9.0'), ('backendTarget', '1.9.1')]:
            record = next(item for item in records if item['version'] == version)
            archive = directory / Path(record['archive']).name
            assert hashlib.sha256(archive.read_bytes()).hexdigest() == record['sha256']
            archives[key] = archive
    target_hash = hashlib.sha256(archives['backendTarget'].read_bytes()).hexdigest()
    failure = EVIDENCE / ('backend-fixture-1.9.99-startup-failure-' + target_hash[:12] + '.tar.gz')
    if not failure.exists():
        with tarfile.open(archives['backendTarget'], 'r:gz') as source, tarfile.open(failure, 'w:gz') as output:
            for member in source:
                name = member.name.removeprefix('./')
                if name == 'rustdesk-console':
                    content = b'#!/bin/sh\nexit 42\n'
                elif name in ['build-info.json', 'release-metadata.json', 'package.json']:
                    metadata = json.load(source.extractfile(member)); metadata['version'] = '1.9.99'
                    content = json.dumps(metadata).encode()
                else:
                    output.addfile(member, source.extractfile(member) if member.isfile() else None)
                    continue
                member.size = len(content); output.addfile(member, io.BytesIO(content))
    archives['backendFailure'] = failure
    components = {key: component(path, 'web' if key.startswith('web') else 'backend',
                  {'backendOld': '1.9.0', 'backendTarget': '1.9.1', 'backendFailure': '1.9.99', 'webOld': '1.6.0', 'webTarget': '1.6.1'}[key],
                  8100 + index) for index, (key, path) in enumerate(archives.items())}
    index = {**components, 'current': {'backend': components['backendOld'], 'web': components['webOld']},
             'archives': {components[key]['artifact']['url']: value.name for key, value in archives.items()},
             'archiveNames': [value.name for value in archives.values()]}
    (EVIDENCE / 'catalog-all.json').write_text(json.dumps(index, indent=2))
    if not (EVIDENCE / 'backend-sqlite.env').exists():
        (EVIDENCE / 'backend-sqlite.env').write_text('DB_TYPE=sqlite\nJWT_SECRET=' + secrets.token_urlsafe(40) + '\nADMIN_PASSWORD=' + secrets.token_urlsafe(30) + '\n')
    payload = EVIDENCE / 'linux-payload.tar'
    with tarfile.open(payload, 'w') as bundle:
        for path in archives.values():
            bundle.add(path, arcname=path.name)
        for name in ['linux_lifecycle.py', 'linux_guest.py', 'linux_failures.py', 'lifecycle.py', 'compose_fixture.py', 'environment.py']:
            bundle.add(ROOT / 'test/system-update' / name, arcname=name)
        bundle.add(ROOT / 'deployment/install_linux.py', arcname='install_linux.py')
        bundle.add(ROOT / 'deployment/install-linux.sh', arcname='bootstrap/install-linux.sh')
        wrapper = b'import sys\nsys.path.insert(0,"/home/tester/integration")\nfrom linux_lifecycle import install\ninstall()\n'
        member = tarfile.TarInfo('bootstrap/install_linux.py'); member.mode = 0o755; member.size = len(wrapper)
        bundle.addfile(member, io.BytesIO(wrapper))
        for name in ['catalog-all.json', 'backend-sqlite.env']:
            bundle.add(EVIDENCE / name, arcname=name)
    proof = {'payloadSha256': hashlib.sha256(payload.read_bytes()).hexdigest(),
             'artifacts': {key: value['artifact']['sha256'] for key, value in components.items()}}
    (EVIDENCE / 'linux-payload-ready.json').write_text(json.dumps(proof, indent=2))
    if not prepare_only:
        transfer_stage()
    print(json.dumps({'stageComplete': not prepare_only, 'payloadPrepared': True, **proof}))


def transfer_stage():
    owned_container(VM)
    payload = EVIDENCE / 'linux-payload.tar'
    proof = json.loads((EVIDENCE / 'linux-payload-ready.json').read_text())
    assert hashlib.sha256(payload.read_bytes()).hexdigest() == proof['payloadSha256']
    command('docker', 'cp', str(payload), VM + ':/vm/linux-payload.tar')
    print(ssh('mkdir -p /home/tester/integration'))
    command('docker', 'exec', VM, 'scp', '-q', '-i', '/vm/id_ed25519', '-P', '2222',
            '-o', 'StrictHostKeyChecking=accept-new', '/vm/linux-payload.tar',
            'tester@127.0.0.1:/home/tester/linux-payload.tar', timeout=300)
    print(ssh('tar -xf /home/tester/linux-payload.tar -C /home/tester/integration\nchmod 700 /home/tester/integration\nchmod 600 /home/tester/integration/backend-sqlite.env'))
    print(json.dumps({'payloadTransferred': True, 'payloadSha256': proof['payloadSha256']}))


def mysql_config():
    password_file = EVIDENCE / 'mysql-linux-password'
    if not password_file.exists():
        password_file.write_text(secrets.token_hex(24))
    password = password_file.read_text().strip()
    mysql_sql("CREATE DATABASE IF NOT EXISTS console_linux; CREATE USER IF NOT EXISTS 'console_linux'@'%' IDENTIFIED BY '" + password + "'; GRANT ALL PRIVILEGES ON console_linux.* TO 'console_linux'@'%'; GRANT PROCESS ON *.* TO 'console_linux'@'%';")
    server = owned_container(PREFIX + '-mysql')
    host = server['NetworkSettings']['Networks'][PREFIX]['IPAddress']
    config = EVIDENCE / 'backend-mysql.env'
    if not config.exists():
        config.write_text('DB_TYPE=mysql\nDB_HOST=' + host + '\nDB_PORT=3306\nDB_DATABASE=console_linux\nDB_USERNAME=console_linux\nDB_PASSWORD=' + password + '\nSYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA=true\nJWT_SECRET=' + secrets.token_urlsafe(40) + '\nADMIN_PASSWORD=' + secrets.token_urlsafe(30) + '\n')
    baseline = EVIDENCE / 'mysql-sibling-before.json'
    if not baseline.exists():
        baseline.write_text(json.dumps({'rows': mysql_sql('SELECT * FROM untouched_sibling.sentinel;')}))
    command('docker', 'cp', str(config), VM + ':/vm/backend-mysql.env')
    command('docker', 'exec', VM, 'scp', '-q', '-i', '/vm/id_ed25519', '-P', '2222', '/vm/backend-mysql.env', 'tester@127.0.0.1:/home/tester/integration/backend-mysql.env')
    print(ssh('chmod 600 /home/tester/integration/backend-mysql.env'))
    print(json.dumps({'dedicatedSchema': 'console_linux', 'siblingBaselineRecorded': True}))


def sync_helpers():
    payload = EVIDENCE / 'linux-owned-helpers.tar'
    with tarfile.open(payload, 'w') as bundle:
        for name in ['linux_lifecycle.py', 'linux_guest.py', 'linux_failures.py']:
            bundle.add(ROOT / 'test/system-update' / name, arcname=name)
    command('docker', 'cp', str(payload), VM + ':/vm/linux-owned-helpers.tar')
    command('docker', 'exec', VM, 'scp', '-q', '-i', '/vm/id_ed25519', '-P', '2222',
            '/vm/linux-owned-helpers.tar', 'tester@127.0.0.1:/home/tester/linux-owned-helpers.tar')
    print(ssh('tar -xf /home/tester/linux-owned-helpers.tar -C /home/tester/integration'))


def collect(database=None):
    inherited_files = set()
    if CONTEXT.fixture_id:
        CONTEXT.inherited_entries()
        inherited_files = set(json.loads((EVIDENCE / 'fixture-context.json').read_text())['inheritedEvidence'])
    if database is None:
        database = ssh("sudo python3 -c \"import json;print(json.load(open('/etc/rustdesk-console/installation.json'))['database']['kind'])\"", timeout=30).strip()
    assert database in ['sqlite', 'mysql'], 'Collection requires the tested database identity'
    baseline = EVIDENCE / 'mysql-sibling-before.json'
    if database == 'mysql':
        assert baseline.is_file(), 'MySQL collection requires this fixture sibling baseline'
        original = json.loads(baseline.read_text())['rows']
    print(ssh('sudo tar -cf /home/tester/linux-evidence.tar -C /var/lib/console-system-update-test-results .\nsudo chown tester:tester /home/tester/linux-evidence.tar'))
    command('docker', 'exec', VM, 'scp', '-q', '-i', '/vm/id_ed25519', '-P', '2222', 'tester@127.0.0.1:/home/tester/linux-evidence.tar', '/vm/linux-evidence.tar')
    command('docker', 'cp', VM + ':/vm/linux-evidence.tar', str(EVIDENCE / 'linux-evidence.tar'))
    with tarfile.open(EVIDENCE / 'linux-evidence.tar') as bundle:
        for member in bundle:
            if member.isfile() and member.name.endswith('.json') and len(Path(member.name).parts) == 1:
                destination = EVIDENCE / Path(member.name).name
                raw = bundle.extractfile(member).read()
                if destination.name in inherited_files:
                    assert destination.read_bytes() == raw, 'Collection cannot overwrite inherited receipt: ' + destination.name
                else:
                    destination.write_bytes(raw)
    if database == 'mysql':
        current = mysql_sql('SELECT * FROM untouched_sibling.sentinel;')
        assert original == current, 'Linux acceptance changed the MySQL sibling schema'
        (EVIDENCE / 'mysql-sibling-retention.json').write_text(json.dumps(
            {'unchanged': True, 'before': original, 'after': current}, indent=2))
    print(json.dumps({'evidence': str(EVIDENCE)}))


def reboot(job):
    assert str(uuid.UUID(job)) == job
    original_vm = owned_container(VM)
    receipt = json.loads(ssh('sudo python3 /home/tester/integration/linux_lifecycle.py reboot-receipt ' + job))
    host_receipt = {'guest': receipt, 'vmId': original_vm['Id'], 'mounts': original_vm['Mounts']}
    path = EVIDENCE / ('linux-reboot-' + job + '-host-receipt.json')
    assert not path.exists(), 'A host receipt already exists; resume the same job without a second reboot'
    with path.open('x') as stream:
        json.dump(host_receipt, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        ssh('sudo systemctl reboot --no-block', timeout=30)
    except RuntimeError:
        # SSH may close during reboot; the stopped QEMU is the next required proof.
        pass
    wait_until(lambda: owned_container(VM)['State']['Running'], lambda running: not running, 120)
    command('docker', 'start', VM)
    resumed_vm = owned_container(VM)
    assert resumed_vm['Id'] == original_vm['Id'] and resumed_vm['Mounts'] == original_vm['Mounts']
    wait_until(lambda: ssh('true', timeout=15), lambda _: True, 240)
    print(json.dumps({'guestRestarted': True, 'sameVmAndDisk': True, 'jobId': job}), flush=True)
    output = ssh('sudo python3 /home/tester/integration/linux_lifecycle.py resume-reboot ' + job, timeout=900)
    result = json.loads(output.strip().splitlines()[-1])
    assert result['job']['jobId'] == job and result['guestReboot']['acceptedWritePreserved']
    host_receipt['result'] = {'status': result['job']['status'], 'reboot': result['guestReboot'],
                              'sameVmAndDisk': True}
    with path.open('w') as stream:
        json.dump(host_receipt, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    print(output, flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['stage', 'transfer', 'mysql', 'collect', 'sync', 'reboot', 'guest'])
    parser.add_argument('arguments', nargs='*')
    parser.add_argument('--backend-fixtures', type=Path)
    parser.add_argument('--web-old', type=Path)
    parser.add_argument('--web-target', type=Path)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    if args.action == 'stage': stage(args.backend_fixtures, args.web_old, args.web_target, args.prepare_only)
    elif args.action == 'transfer': transfer_stage()
    elif args.action == 'mysql': mysql_config()
    elif args.action == 'collect': collect()
    elif args.action == 'sync': sync_helpers()
    elif args.action == 'reboot':
        assert len(args.arguments) == 1, 'Supply exactly one accepted job ID'
        reboot(args.arguments[0])
    else:
        assert all(value.replace('-', '').replace('_', '').isalnum() for value in args.arguments)
        if args.arguments[:2] == ['linux_guest', 'target'] or args.arguments[0] == 'linux_failures' or (
                args.arguments[0] == 'linux_lifecycle' and args.arguments[1] not in ['reboot-receipt', 'resume-reboot']):
            require_scheduling_slot()
        print(ssh('sudo python3 /home/tester/integration/' + args.arguments[0] + '.py ' + ' '.join(args.arguments[1:]), timeout=900))
