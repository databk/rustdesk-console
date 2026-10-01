"""Real default registration; only unpublished release sources are injected."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import socket
import uuid
from datetime import datetime, timezone

from compose_fixture import ARTIFACTS, DRIVER, HOST_ROOT, PREFIX, component, driver, inside, load_images
from environment import command, ensure_network, mysql_sql
from lifecycle import request, wait_until


def run(database='mysql', fixture_catalog=None, production=False, fixture_entrypoint=None):
    source = Path(__file__).resolve().parents[2]
    launcher = Path(__file__).with_name('compose-bootstrap.fixture.mjs')
    if not launcher.is_file():
        raise RuntimeError('Reviewed source-only deployment fixture launcher required')
    suffix = uuid.uuid4().hex[:6]
    name, root, schema = PREFIX + '-bootstrap-' + database + '-' + suffix, HOST_ROOT + '/b' + database[0] + suffix, 'console_bootstrap_' + suffix
    if production and (not fixture_entrypoint or not Path(fixture_entrypoint).is_file()):
        raise RuntimeError('Final production registration requires the handed-off local catalog seam')
    ensure_network()
    driver()
    inside('mkdir', '-p', root + '/fixture')
    assert inside('sh', '-c', 'test ! -e ' + root + '/docker-compose.yml && printf fresh') == 'fresh'
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base = 'http://127.0.0.1:' + str(port)
    admin_password, database_password = secrets.token_hex(24), secrets.token_hex(24)
    sibling = mysql_sql('SELECT * FROM untouched_sibling.sentinel;') if database == 'mysql' else None
    # These generated identifiers only address a new task-owned disposable schema.
    if database == 'mysql':
        mysql_sql(f"CREATE DATABASE {schema}; CREATE USER '{schema}'@'%' IDENTIFIED BY '{database_password}'; "
                  f"GRANT ALL PRIVILEGES ON {schema}.* TO '{schema}'@'%'; GRANT PROCESS ON *.* TO '{schema}'@'%';")
    images = load_images(fixture_catalog)
    backend_key = 'production' if production else 'old'
    current = {'backend': component('backend', '1.9.0', images[backend_key], 7001),
               'web': component('web', '1.6.0', images['web'], 7002)}
    repositories = {key: value['artifact']['url'].split('@')[0] for key, value in current.items()}
    fixture = {'testOnly': PREFIX, 'repositories': repositories, 'current': current, 'targets': current, 'archives': {}}
    config = json.loads(command('docker', 'compose', '--file', str(source / 'docker-compose.yml'),
                                'config', '--format', 'json', '--no-interpolate', '--no-path-resolution', '--no-normalize').stdout)
    services = config['services']
    services['rustdesk-console']['image'] = images[backend_key].get('taggedUrl', repositories['backend'] + ':old')
    services['rustdesk-console-web']['image'] = images['web'].get('taggedUrl', repositories['web'] + ':current')
    services['rustdesk-console-web']['ports'] = [f'127.0.0.1:{port}:80']
    services['updater']['image'] = services['rustdesk-console']['image']
    services['updater']['command'] = ['node', '/test-bootstrap/bootstrap-live-launch.mjs']
    services['updater']['volumes'][2] = {'type': 'bind', 'source': root, 'target': root}
    services['updater']['volumes'].extend([root + '/fixture:/test-bootstrap:ro', root + '/fixture:/etc/rustdesk-console/test-fixture:ro'])
    if production:
        # The production image stays immutable; this explicit test-only mount
        # permits the resident control service to read the unpublished catalog.
        services['updater']['volumes'].append(root + '/fixture/fixture-entrypoint.cjs:/app/dist/updater/entrypoint.js:ro')
    config['networks'] = {'default': {'external': True, 'name': PREFIX}}
    for service, memory in [('rustdesk-console', '320m'), ('updater', '256m'), ('rustdesk-console-web', '96m')]:
        services[service]['mem_limit'] = memory
        services[service]['cpus'] = 0.5
        services[service]['labels'] = {'console-system-update-test': 'true'}
    environment = {'CONSOLE_INSTALL_DIR': root, 'JWT_SECRET': secrets.token_hex(48), 'ADMIN_PASSWORD': admin_password,
                   'DB_TYPE': database, 'DB_HOST': PREFIX + '-mysql', 'DB_PORT': '3306', 'DB_USERNAME': schema,
                   'DB_PASSWORD': database_password, 'DB_DATABASE': schema, 'SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA': 'true'}
    stage = ARTIFACTS / (name + '-inputs')
    stage.mkdir(mode=0o700)
    files = {'docker-compose.yml': json.dumps(config, indent=2), 'docker-compose.override.yml': 'services: {}\n',
             '.env': ''.join(key + '=' + value + '\n' for key, value in environment.items()),
             'catalog.json': json.dumps(fixture), 'fault.json': '[]'}
    for file, contents in files.items():
        target = stage / file
        target.write_text(contents)
        remote = root + ('/fixture/' if file in ['catalog.json', 'fault.json'] else '/') + file
        command('docker', 'cp', str(target), DRIVER + ':' + remote)
    injected = [(launcher, 'bootstrap-live-launch.mjs')]
    if production:
        injected.append((Path(fixture_entrypoint), 'fixture-entrypoint.cjs'))
    for local, remote_name in injected:
        command('docker', 'cp', str(local), DRIVER + ':' + root + '/fixture/' + remote_name)
    inside('chmod', '600', root + '/.env')

    def compose(*args):
        return inside('docker', 'compose', '--project-directory', root, '--project-name', name, *args)

    compose('up', '-d', '--pull', 'never')
    token = wait_until(lambda: request(base, '/api/login', {'username': 'databk', 'password': admin_password,
                      'type': 'account', 'deviceInfo': {'type': 'browser'}}), lambda value: bool(value.get('access_token')))['access_token']
    ready = wait_until(lambda: request(base, '/api/system-update/capabilities', token=token), lambda value: value.get('ready'))
    installed = json.loads(inside('cat', root + '/updater-state/installation.json'))
    assert installed['database']['kind'] == database
    if database == 'mysql':
        assert installed['database']['database'] == schema
    assert request(base, '/api/system-update/jobs/current', token=token)['job'] is None
    override = json.loads(inside('cat', root + '/docker-compose.override.yml'))
    for service, image in [('rustdesk-console', backend_key), ('updater', backend_key), ('rustdesk-console-web', 'web')]:
        assert override['services'][service]['image'] == images[image]['url']
    registrar = json.loads(command('docker', 'inspect', name + '-register-' + ready['installationId']).stdout)[0]
    assert registrar['State']['ExitCode'] == 0 and not registrar['State']['Running']
    compose('restart', 'updater')
    resumed = wait_until(lambda: request(base, '/api/system-update/capabilities', token=token),
                         lambda value: value.get('ready') and value['installationId'] == ready['installationId'])
    assert request(base, '/api/system-update/jobs/current', token=token)['job'] is None
    if database == 'mysql':
        assert mysql_sql('SELECT * FROM untouched_sibling.sentinel;') == sibling
    running = json.loads(command('docker', 'inspect', *[name + '-' + role + '-1' for role in services]).stdout)
    for container in running:
        key = 'web' if container['Config']['Labels']['com.docker.compose.service'] == 'rustdesk-console-web' else backend_key
        assert container['Image'] == images[key]['imageId']
    result = {'at': datetime.now(timezone.utc).isoformat(), 'project': name, 'database': database,
              'installationId': resumed['installationId'], 'schema': schema if database == 'mysql' else None, 'defaultThreeServices': list(services),
              'noManualInstallationRecord': True, 'sameImagesPinned': True, 'independentRegistrarExit': 0, 'ready': True,
              'sameInstallationAfterHelperRestart': True, 'automaticNewJob': False, 'siblingSchemaPreserved': sibling is not None,
              'backend': request(base, '/api/system-update/health'), 'web': request(base, '/system-update-health.json'),
              'provenance': 'unpublished-local-fixtures; catalog/repository identity/source allowlist only injected',
              'realBoundaries': ['Docker', 'Compose', database, 'health', 'filesystem', 'helper replacement', 'IPC', 'backup preflight'],
              'productionImage': images[backend_key] if production else None,
              'images': {role: images[key] for role, key in [('backend', backend_key), ('web', 'web')]},
              'containers': {item['Config']['Labels']['com.docker.compose.service']: {'id': item['Id'], 'image': item['Image']} for item in running}}
    if production:
        result['localCatalogSeamSha256'] = hashlib.sha256(Path(fixture_entrypoint).read_bytes()).hexdigest()
    if fixture_catalog:
        result['artifactCatalog'] = {'file': Path(fixture_catalog).name,
                                     'sha256': hashlib.sha256(Path(fixture_catalog).read_bytes()).hexdigest()}
    evidence = ARTIFACTS / (name + '-result.json')
    evidence.write_text(json.dumps(result, indent=2))
    print(json.dumps({'evidence': str(evidence), 'ready': True, 'installationId': resumed['installationId']}), flush=True)
    compose('stop')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', choices=['sqlite', 'mysql'], default='mysql')
    parser.add_argument('--fixture-catalog')
    parser.add_argument('--production', action='store_true', help='Run the catalogued final production image with the explicit local catalog seam')
    parser.add_argument('--fixture-entrypoint', help='Read-only handed-off local catalog CJS')
    args = parser.parse_args()
    run(args.database, args.fixture_catalog, args.production, args.fixture_entrypoint)
