"""Actual resource failures; no constructed exception is counted as tool failure."""
import argparse
import json
import uuid
from datetime import datetime, timezone

from compose_fixture import ARTIFACTS, HOST_ROOT, PREFIX, command, component, compose, inside, ipc_request, prepare, write_remote
from environment import mysql_sql
from lifecycle import check_versions, containers, login, record, request, wait_until


def publish_target():
    images = json.loads((ARTIFACTS / 'local-oci-fixtures.json').read_text())
    repository = images['new']['url'].split('@')[0]
    tag = repository + ':broken'
    command('docker', 'tag', PREFIX + '-backend:broken-target', tag)
    command('docker', 'push', tag)
    info = json.loads(command('docker', 'image', 'inspect', tag).stdout)[0]
    canonical = next(value for value in info['RepoDigests'] if value.startswith(repository + '@'))
    artifact = {'url': canonical, 'sha256': canonical.split('@sha256:')[1],
                'imageId': info['Id'], 'size': info['Size'],
                'sourceCommit': info['Config']['Labels']['org.opencontainers.image.revision']}
    (ARTIFACTS / 'broken-target-image.json').write_text(json.dumps(artifact, indent=2))
    print(json.dumps(artifact))


def run(database, scenario):
    # Docker DNS labels must remain within 63 bytes, including service suffixes.
    name = database + '-f-' + scenario + '-' + uuid.uuid4().hex[:6]
    root = HOST_ROOT + '/' + name
    sibling = wait_until(lambda: mysql_sql('SELECT * FROM untouched_sibling.sentinel;'),
                         lambda _: True) if database == 'mysql' else None
    prepare(name, database, read_only_worker_data=scenario == 'restore')
    base = 'http://' + command('docker', 'port', PREFIX + '-' + name + '-web-1', '80').stdout.strip()
    wait_until(lambda: check_versions(base, '1.9.0'), lambda _: True)
    wait_until(lambda: ipc_request(name, 'capabilities'), lambda value: value['ready'])
    assert ipc_request(name, 'current')['job'] is None
    token = login(base)
    row = 'real-failure-' + uuid.uuid4().hex
    request(base, '/api/strategies', {'name': row}, token)
    write_remote(root + '/data/failure-business.json', {'name': row})
    initial = containers(name)
    proof = {}
    job_id = None
    details = None
    tool = '/usr/bin/sqlite3' if database == 'sqlite' else '/usr/bin/mysqldump'
    updater = PREFIX + '-' + name + '-updater-1'
    if scenario == 'preflight':
        if database == 'sqlite':
            command('docker', 'exec', updater, 'chmod', '000', tool)
            proof['resourceFailure'] = 'Actual installed SQLite executable is not executable'
        else:
            installed = json.loads(inside('cat', root + '/state/installation.json'))
            installed['database']['username'] = 'console_readonly'
            write_remote(root + '/state/installation.json', installed)
            compose(name, 'restart', 'updater')
            proof['resourceFailure'] = 'Real database account has SELECT but lacks schema restore privileges'
        capability = wait_until(lambda: ipc_request(name, 'capabilities'), lambda value: not value['ready'])
        preview = ipc_request(name, 'plans')
        assert not preview['executable'] and preview['blockers']
        assert ipc_request(name, 'current')['job'] is None
        assert containers(name) == initial
        proof.update(capability=capability, planBlocked=True, noJobAccepted=True, noSwitch=True)
        terminal = {'status': 'blocked'}
    else:
        if scenario in ['pull', 'startup', 'restore']:
            catalog = json.loads(inside('cat', root + '/fixture/catalog.json'))
            if scenario == 'pull':
                target = json.loads((ARTIFACTS / 'local-oci-fixtures.json').read_text())['new']
                missing = uuid.uuid4().hex + uuid.uuid4().hex
                target.update(sha256=missing, url=target['url'].split('@')[0] + '@sha256:' + missing)
                proof['resourceFailure'] = 'Real OCI registry has no manifest for the requested immutable digest'
            else:
                target = json.loads((ARTIFACTS / 'broken-target-image.json').read_text())
                proof['resourceFailure'] = 'Actual Node process entrypoint is absent in the immutable target image'
            catalog['targets']['backend'] = component('backend', '1.9.1', target, 191)
            write_remote(root + '/fixture/catalog.json', catalog)
            compose(name, 'restart', 'updater')
        if scenario == 'backup':
            write_remote(root + '/fixture/fault.json', [{'event': 'backup:intent', 'action': 'hold'}])
        elif scenario in ['startup', 'restore']:
            write_remote(root + '/fixture/fault.json', [{'event': 'verify:intent', 'action': 'hold'}])
        plan = wait_until(lambda: ipc_request(name, 'plans'), lambda value: value['executable'])
        job_id = ipc_request(name, 'jobs', {'planId': plan['planId'], 'idempotencyKey': str(uuid.uuid4()), 'acknowledgeDowntime': True})['jobId']
        worker = PREFIX + '-' + name + '-update-' + job_id
        if scenario == 'backup':
            marker = root + '/state/test-fault-' + job_id + '-backup-intent'
            wait_until(lambda: inside('test', '-f', marker), lambda _: True)
            command('docker', 'exec', worker, 'chmod', '000', tool)
            probe = command('docker', 'exec', worker, tool, '--version', check=False)
            assert probe.returncode != 0
            proof.update(resourceFailure='Backup client execution permission removed after applications stopped',
                         actualToolProbeExit=probe.returncode, exportStarted=False)
            inside('touch', marker + '-continue')
        if scenario in ['startup', 'restore']:
            marker = root + '/state/test-fault-' + job_id + '-verify-intent'
            wait_until(lambda: inside('test', '-f', marker), lambda _: True)
            failed = wait_until(lambda: json.loads(command('docker', 'inspect', PREFIX + '-' + name + '-backend-1').stdout)[0],
                                lambda value: value['Image'] == target['imageId'] and
                                not value['State']['Running'] and value['State']['ExitCode'] != 0)
            logs = command('docker', 'logs', failed['Id'], check=False)
            assert 'MODULE_NOT_FOUND' in logs.stdout + logs.stderr
            proof.update(targetContainer=failed['Id'], targetImage=failed['Image'], targetExitCode=failed['State']['ExitCode'],
                         actualStartupError='MODULE_NOT_FOUND')
            if scenario == 'restore':
                info = json.loads(command('docker', 'inspect', worker).stdout)[0]
                mount = next(value for value in info['Mounts'] if value['Destination'] == root + '/data')
                assert not mount['RW']
                probe = command('docker', 'exec', worker, 'touch', root + '/data/restore-write-probe', check=False)
                assert probe.returncode != 0 and 'Read-only file system' in probe.stderr
                proof.update(restoreDestinationReadOnly=True, actualRestoreFilesystemProbeExit=probe.returncode)
            inside('touch', marker + '-continue')
        terminal = wait_until(lambda: ipc_request(name, 'current')['job'],
                              lambda value: value and value['status'] in ['failed', 'rolled_back', 'recovery_required', 'succeeded'], 420)
        details = record(name, job_id)
        expected = {'pull': 'failed', 'backup': 'failed', 'startup': 'rolled_back', 'restore': 'recovery_required'}[scenario]
        assert terminal['status'] == expected, terminal
        if scenario in ['pull', 'backup']:
            assert 'switch' not in details['operations'] and not details.get('decision')
            assert containers(name) == initial
            proof['noSwitch'] = True
        if scenario == 'backup':
            assert details['operations']['backup'] == 'intent' and details['operations']['stop'] == 'done'
        if scenario == 'restore':
            assert details['operations']['backup'] == 'done'
            assert details['operations']['restore_data'] == 'intent'
            maintenance = json.loads(inside('cat', root + '/maintenance/maintenance.json'))
            assert maintenance['active'] and not details.get('decision')
            proof['businessRemainsFenced'] = True
            compose(name, 'restart', 'updater')
            resumed = wait_until(lambda: ipc_request(name, 'current')['job'], lambda value: value and value['jobId'] == job_id)
            assert resumed['status'] == 'recovery_required'
            proof['sameJobAfterHelperRestart'] = True
    if scenario != 'restore':
        check_versions(base, '1.9.0')
        names = {value['name'] for value in request(base, '/api/strategies?current=1&pageSize=100', token=token)['data']}
        assert row in names and json.loads(inside('cat', root + '/data/failure-business.json'))['name'] == row
        proof['originalBusinessDataPreserved'] = True
    if database == 'mysql':
        assert mysql_sql('SELECT * FROM untouched_sibling.sentinel;') == sibling
        proof['siblingSchemaPreserved'] = True
    result = {'at': datetime.now(timezone.utc).isoformat(), 'fixture': name, 'database': database, 'scenario': scenario,
              'job': terminal, 'operations': details['operations'] if details else {}, 'proof': proof,
              'provenance': 'actual resource failure with unpublished immutable local fixtures; no thrown fault exception'}
    path = ARTIFACTS / (name + '-failure.json')
    path.write_text(json.dumps(result, indent=2))
    print(json.dumps({'file': path.name, 'jobId': job_id, 'status': terminal['status']}), flush=True)
    compose(name, 'stop')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', choices=['sqlite', 'mysql'])
    parser.add_argument('--publish-target', action='store_true')
    parser.add_argument('--scenario', choices=['preflight', 'backup', 'pull', 'startup', 'restore', 'all'], default='all')
    args = parser.parse_args()
    if args.publish_target:
        publish_target()
    elif not args.database:
        parser.error('--database is required unless publishing a prepared target')
    else:
        for scenario in ['preflight', 'backup', 'pull', 'startup', 'restore'] if args.scenario == 'all' else [args.scenario]:
            run(args.database, scenario)
