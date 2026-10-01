"""Actual resource faults in a fresh, explicitly identified disposable systemd installation."""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time
import uuid
from datetime import datetime, timezone

from linux_guest import target
from linux_lifecycle import (BASE, EVIDENCE, FIXTURE, INSTALLATION, business_names,
                             command, durable_json, health, ipc, login, request, wait_until)


def tools_for(database):
    names = ['sqlite3'] if database == 'sqlite' else ['mysql', 'mysqldump', 'mariadb', 'mariadb-dump']
    paths = {Path(value).resolve() for name in names if (value := shutil.which(name))}
    assert paths, 'Required real database tools are absent before fault setup'
    return {path: stat.S_IMODE(path.stat().st_mode) for path in paths}


def deny_tools(paths):
    for path in paths:
        path.chmod(0)
    probes = []
    for path in paths:
        try:
            result = subprocess.run([str(path), '--version'], capture_output=True, timeout=15)
        except PermissionError as error:
            assert error.errno == errno.EACCES
            probes.append({'tool': path.name, 'errno': error.errno})
        else:
            raise AssertionError('Expected an actual exec EACCES, received exit ' + str(result.returncode))
    return probes


def read_record(state, job):
    return json.loads((state / 'jobs' / (job + '.json')).read_text())


def hold_marker(state, job, event):
    marker = state / ('test-fault-' + job + '-' + event.replace(':', '-'))
    wait_until(marker.exists, bool, 420)
    return marker


def retained_snapshot(state, job, record):
    root = state / 'backups' / job / 'snapshot'
    assert record['snapshot']['path'] == str(root)
    assert root.is_dir() and not root.is_symlink()
    entries = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink(), 'Backup retention cannot follow symlinks'
        info = path.stat()
        assert stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)
        entries.append({'path': path.relative_to(root).as_posix(),
                        'mode': stat.S_IMODE(info.st_mode),
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None})
    manifest_path = root / 'snapshot.json'
    manifest = json.loads(manifest_path.read_text())
    assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == record['snapshot']['metadata']['manifestSha256']
    assert manifest['jobId'] == job and manifest['database'] == record['snapshot']['database']
    database_name = 'database.sqlite' if manifest['database'] == 'sqlite' else 'database.sql'
    assert manifest['databaseFile'] == database_name
    database_path = root / database_name
    assert database_path.stat().st_size == manifest['databaseSize']
    assert hashlib.sha256(database_path.read_bytes()).hexdigest() == manifest['databaseSha256']
    return {'path': str(root), 'entries': len(entries),
            'treeSha256': hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()}


def release_resource_hold(marker, state, job, event, unit):
    # The frozen fixture times out after 300 seconds. Reject stale barriers.
    record = read_record(state, job)
    assert record['view']['status'] == 'running' and record['view']['finishedAt'] is None
    assert record['operations'][event.split(':')[0]] == 'intent'
    assert int(command('systemctl', 'show', '--property=MainPID', '--value', unit)) > 1
    created = marker.stat().st_mtime
    assert 0 <= time.time() - created < 240, 'Resource hold expired or lacks completion margin'
    continuation = Path(str(marker) + '-continue')
    assert not continuation.exists()
    durable_json(continuation, {'resourceFaultReady': True})
    return {'markerCreatedAt': created, 'releasedAt': continuation.stat().st_mtime,
            'holdTimeoutSeconds': 300}


def readonly_worker_data(pid, data):
    # The systemd worker has a private mount namespace. Restrict only that namespace.
    own_ns = os.readlink('/proc/self/ns/mnt')
    worker_ns = os.readlink('/proc/' + str(pid) + '/ns/mnt')
    assert own_ns != worker_ns, 'Refuse to remount the guest host namespace'
    prefix = ['nsenter', '--target', str(pid), '--mount', '--']
    command(*prefix, 'mount', '--make-rprivate', '/')
    command(*prefix, 'mount', '--bind', str(data), str(data))
    command(*prefix, 'mount', '-o', 'remount,bind,ro', str(data))
    probe = data / ('native-restore-write-probe-' + uuid.uuid4().hex)
    script = ('import errno,json,os,sys\n'
              'try:\n fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n'
              'except OSError as error:\n print(json.dumps({"errno":error.errno})); sys.exit(0 if error.errno==errno.EROFS else 2)\n'
              'else:\n os.close(fd); sys.exit(3)\n')
    result = json.loads(command(*prefix, 'python3', '-c', script, str(probe)))
    assert result['errno'] == errno.EROFS
    assert not os.statvfs(data).f_flag & os.ST_RDONLY, 'Guest host data mount was affected'
    return {'workerPid': pid, 'workerMountNamespace': worker_ns,
            'hostMountNamespace': own_ns, 'probeErrno': result['errno'],
            'hostDataMountStillWritable': True}


def run(scenario, expected_installation):
    assert os.geteuid() == 0 and Path('/proc/1/comm').read_text().strip() == 'systemd'
    fixture = json.loads((FIXTURE / 'catalog.json').read_text())
    assert fixture['testOnly'] == 'console-system-update-test'
    assert Path('/home/tester/integration/catalog-all.json').is_file()
    installed = json.loads(INSTALLATION.read_text())
    assert installed['installationId'] == expected_installation
    assert installed['deployment'] == 'managed-linux'
    assert ipc('current')['job'] is None, 'Use a fresh test installation for every fault case'
    state, data = Path(installed['stateDir']), Path(installed['dataDir'])
    assert data.resolve() == Path('/var/lib/rustdesk-console')
    assert state.resolve() == Path('/var/lib/rustdesk-console-updater')
    database = installed['database']['kind']
    assert database in ['sqlite', 'mysql']
    target('startup-failure' if scenario == 'restore' else 'backend')
    fixture = json.loads((FIXTURE / 'catalog.json').read_text())
    if scenario == 'archive':
        cached = Path(installed['linux']['releasesDir']) / 'backend' / fixture['targets']['backend']['version']
        assert not cached.exists(), 'Archive-read qualification requires an uncached target release'
    versions = {key: value['version'] for key, value in installed['current'].items()}
    wait_until(lambda: health(versions), lambda _: True, 180)
    wait_until(lambda: ipc('capabilities'), lambda value: value['ready'], 180)
    token = login()
    row = 'native-resource-fault-' + uuid.uuid4().hex
    route = '/api/strategies'
    request(BASE, route, {'name': row}, token)
    sentinel = data / 'native-failure-business.json'
    durable_json(sentinel, {'name': row})
    installation_hash = hashlib.sha256(INSTALLATION.read_bytes()).hexdigest()
    EVIDENCE.mkdir(mode=0o700, parents=True, exist_ok=True)
    receipt = EVIDENCE / ('linux-' + database + '-' + scenario + '-' + expected_installation + '-fault-receipt.json')
    assert not receipt.exists(), 'Do not silently repeat a previous fault attempt'
    proof, changed_tools, displaced_archive = {}, {}, None
    job, record, terminal = None, None, None
    durable_json(receipt, {'installationId': expected_installation, 'database': database,
                          'scenario': scenario, 'state': 'prepared'})
    try:
        if scenario == 'preflight':
            changed_tools = tools_for(database)
            durable_json(receipt, {'installationId': expected_installation, 'scenario': scenario,
                                  'toolModes': {str(path): mode for path, mode in changed_tools.items()}})
            proof['actualToolExecProbes'] = deny_tools(changed_tools)
            capability = ipc('capabilities')
            plan = ipc('plans')
            assert not capability['ready'] and capability['blockers']
            assert not plan['executable'] and plan['blockers']
            assert ipc('current')['job'] is None
            terminal = {'jobId': None, 'status': 'blocked'}
            proof.update(blockers=capability['blockers'], noJobAccepted=True, noSwitch=True)
        else:
            event = {'backup': 'backup:intent', 'archive': 'prepare:intent',
                     'restore': 'restore_data:intent'}[scenario]
            durable_json(FIXTURE / 'fault.json', [{'event': event, 'action': 'hold'}])
            plan = ipc('plans')
            assert plan['executable'], plan['blockers']
            job = ipc('jobs', {'planId': plan['planId'], 'idempotencyKey': str(uuid.uuid4()),
                               'acknowledgeDowntime': True})['jobId']
            unit = installed['linux']['units']['job'].replace('@.', '@' + job + '.')
            durable_json(receipt, {'installationId': expected_installation, 'scenario': scenario,
                                  'jobId': job, 'unit': unit, 'heldAt': event})
            print(json.dumps({'database': database, 'scenario': scenario, 'jobId': job}), flush=True)
            marker = hold_marker(state, job, event)
            if scenario == 'backup':
                record = read_record(state, job)
                assert record['operations']['stop'] == 'done' and record['operations']['backup'] == 'intent'
                changed_tools = tools_for(database)
                durable_json(receipt, {'installationId': expected_installation, 'scenario': scenario,
                                      'jobId': job, 'toolModes': {str(path): mode for path, mode in changed_tools.items()}})
                proof.update(actualToolExecProbes=deny_tools(changed_tools), exportStarted=False)
            elif scenario == 'archive':
                artifact = fixture['targets']['backend']['artifact']
                archive = Path(fixture['archives'][artifact['url']])
                assert archive.parent == FIXTURE and archive.is_file()
                assert hashlib.sha256(archive.read_bytes()).hexdigest() == artifact['sha256']
                displaced_archive = archive.with_name(archive.name + '.unavailable-' + job)
                assert not displaced_archive.exists()
                durable_json(receipt, {'installationId': expected_installation, 'scenario': scenario,
                                      'jobId': job, 'archive': str(archive), 'retainedAt': str(displaced_archive)})
                archive.rename(displaced_archive)
                try:
                    archive.read_bytes()
                except FileNotFoundError as error:
                    assert error.errno == errno.ENOENT
                    proof.update(archiveReadErrno=error.errno, retainedArtifactSha256=artifact['sha256'])
                else:
                    raise AssertionError('Missing archive remained readable')
            else:
                record = read_record(state, job)
                assert record['operations']['backup'] == 'done'
                assert record['operations']['restore_deployment'] == 'done'
                assert record['operations']['restore_data'] == 'intent' and not record.get('decision')
                proof['retainedBackupBeforeFault'] = retained_snapshot(state, job, record)
                pid = int(command('systemctl', 'show', '--property=MainPID', '--value', unit))
                assert pid > 1
                proof['restoreFilesystem'] = readonly_worker_data(pid, data)
                since = record['view']['createdAt'].replace('T', ' ').replace('Z', ' UTC')
                journal = command('journalctl', '--unit=' + installed['linux']['units']['backend'],
                                  '--since=' + since, '--output=cat', '--no-pager')
                assert 'status=42' in journal, 'Real failed target exit42 was not observed'
                proof['actualTargetExitCode'] = 42
            proof['resourceHold'] = release_resource_hold(marker, state, job, event, unit)
            terminal = wait_until(lambda: ipc('current')['job'], lambda value: value and value['status'] in
                                  ['failed', 'rolled_back', 'succeeded', 'recovery_required'], 420)
            assert terminal['jobId'] == job
            assert terminal['status'] == ('recovery_required' if scenario == 'restore' else 'failed'), terminal
            finished = datetime.fromisoformat(terminal['finishedAt'].replace('Z', '+00:00')).timestamp()
            assert proof['resourceHold']['releasedAt'] <= finished
            assert finished < proof['resourceHold']['markerCreatedAt'] + 300, 'Hold timeout cannot qualify as resource failure'
            proof['resourceHold']['finishedAt'] = finished
            proof['resourceHold']['finishedBeforeTimeout'] = True
            record = read_record(state, job)
            assert not record.get('decision')
            if scenario == 'restore':
                assert record['operations']['restore_data'] == 'intent'
                assert json.loads(Path(installed['maintenanceFile']).read_text())['active']
                command('systemctl', 'restart', installed['linux']['units']['updater'])
                current = wait_until(lambda: ipc('current')['job'], lambda value: value and value['jobId'] == job, 180)
                assert current['status'] == 'recovery_required'
                assert json.loads(Path(installed['maintenanceFile']).read_text())['active']
                assert read_record(state, job)['operations']['restore_data'] == 'intent'
                proof['retainedBackupAfterRestart'] = retained_snapshot(state, job, read_record(state, job))
                assert proof['retainedBackupAfterRestart'] == proof['retainedBackupBeforeFault']
                proof.update(businessRemainsFenced=True, sameJobAfterHelperRestart=True,
                             unresolvedRecoveryPreserved=True, backupBytesPreserved=True)
            else:
                assert 'switch' not in record['operations']
                operation = 'backup' if scenario == 'backup' else 'prepare'
                assert record['operations'][operation] == 'intent'
                proof['noSwitch'] = True
    finally:
        for path, mode in changed_tools.items():
            path.chmod(mode)
        if displaced_archive and displaced_archive.exists():
            original = Path(json.loads(receipt.read_text())['archive'])
            assert not original.exists(), 'Do not overwrite an unexpected replacement artifact'
            displaced_archive.rename(original)
    if scenario != 'restore':
        assert hashlib.sha256(INSTALLATION.read_bytes()).hexdigest() == installation_hash
        wait_until(lambda: health(versions), lambda _: True, 180)
        assert row in business_names(route, token)
        assert json.loads(sentinel.read_text())['name'] == row
        proof['originalBusinessDataPreserved'] = True
    result = {'at': datetime.now(timezone.utc).isoformat(), 'installationId': expected_installation,
              'database': database, 'scenario': scenario, 'job': terminal,
              'operations': record['operations'] if record else {}, 'proof': proof,
              'artifacts': {key: value['artifact']['sha256'] for key, value in fixture['targets'].items()},
              'provenance': 'actual Linux resource fault; unpublished immutable fixtures; no thrown fault exception',
              'mysqlSiblingVerification': 'host collector must separately compare the retained sibling baseline'}
    output = EVIDENCE / ('linux-' + database + '-' + scenario + '-' + (job or expected_installation) + '-failure.json')
    durable_json(output, result)
    print(json.dumps({'file': output.name, 'jobId': job, 'status': terminal['status']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scenario', choices=['preflight', 'backup', 'archive', 'restore'])
    parser.add_argument('installation_id', help='Exact disposable installation UUID; required safety boundary')
    args = parser.parse_args()
    assert str(uuid.UUID(args.installation_id)) == args.installation_id
    run(args.scenario, args.installation_id)
