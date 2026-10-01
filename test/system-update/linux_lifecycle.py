"""Run inside the disposable real-systemd guest using complete local SEA/Rust bundles."""
import argparse
import http.client
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from lifecycle import SCENARIOS as SHARED_SCENARIOS, request, wait_until

SCENARIOS = {**SHARED_SCENARIOS, 'startup-failure': [],
             'commit-reboot': SHARED_SCENARIOS['commit-write'],
             'restore-reboot': SHARED_SCENARIOS['restore-write']}

FIXTURE = Path('/etc/rustdesk-console/test-fixture')
INSTALLATION = Path('/etc/rustdesk-console/installation.json')
EVIDENCE = Path('/var/lib/console-system-update-test-results')
BASE = 'http://127.0.0.1:21114'


def command(*args):
    value = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if value.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed ({value.returncode})')
    return value.stdout.strip()


def durable_json(path, value):
    with path.open('w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())


def health(expected):
    result = {'backend': request(BASE, '/api/system-update/health'),
              'web': request(BASE, '/system-update-health.json')}
    for component, value in result.items():
        assert value['ready'] and value['version'] == expected[component], result
    return result


def business_names(path, token):
    return {row['name'] for row in request(BASE, path + '?current=1&pageSize=100', token=token)['data']}


def installer():
    spec = importlib.util.spec_from_file_location('fixture_installer', '/home/tester/integration/install_linux.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def install():
    module = installer()
    fixture = json.loads((FIXTURE / 'catalog.json').read_text())
    module.load_release = lambda component, _tag, _platform, _directory: fixture['current'][component]

    production_download = module.download

    def download(url, destination, limit):
        archive = Path(fixture['archives'][url])
        assert archive.parent == FIXTURE and archive.stat().st_size <= limit
        # Replace only the network response: retain production space, URL and I/O checks.
        with archive.open('rb') as response:
            response.url = url
            opener = SimpleNamespace(open=lambda *_args, **_kwargs: response)
            with patch.object(module.urllib.request, 'build_opener', return_value=opener):
                production_download(url, destination, limit)

    module.download = download
    sys.argv = ['install_linux.py', '--config', '/home/tester/integration/backend.env']
    module.main()
    installed = json.loads(INSTALLATION.read_text())
    assert ipc('current')['job'] is None
    wait_until(lambda: ipc('capabilities'), lambda value: value['ready'], 180)
    EVIDENCE.mkdir(mode=0o700, parents=True, exist_ok=True)
    (EVIDENCE / ('linux-' + installed['database']['kind'] + '-installer-' + installed['installationId'] + '.json')).write_text(json.dumps({
        'installationId': installed['installationId'], 'defaultUpdaterReady': True,
        'startedNewJob': False, 'pid1': Path('/proc/1/comm').read_text().strip(),
        'backend': request(BASE, '/api/system-update/health'),
        'web': request(BASE, '/system-update-health.json'),
        'units': command('systemctl', 'is-active', *[installed['linux']['units'][key] for key in ['backend', 'web', 'updater']]),
        'tools': {'systemd': command('systemd', '--version').splitlines()[0],
                  'sqlite': command('sqlite3', '--version'), 'mysql': command('mariadb', '--version')},
        'provenance': 'unpublished-local-fixtures',
    }, indent=2))


class LocalConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=30)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


def ipc(operation, body=None):
    installed = json.loads(INSTALLATION.read_text())
    connection = LocalConnection(installed['ipcDir'] + '/control.sock')
    try:
        connection.request('POST', '/', json.dumps({'operation': operation, 'body': body or {}, 'actorId': 'integration-admin'}))
        response = connection.getresponse()
        value = json.loads(response.read())
        if response.status >= 400:
            raise RuntimeError(value.get('code', 'IPC_FAILED'))
        return value
    finally:
        connection.close()


def login():
    config = installer().parse_environment(Path('/etc/rustdesk-console/backend.env'))
    return request(BASE, '/api/login', {'username': config.get('ADMIN_USERNAME', 'databk'),
        'password': config['ADMIN_PASSWORD'], 'type': 'account', 'deviceInfo': {'type': 'browser'}})['access_token']


def run(scenario):
    installed = json.loads(INSTALLATION.read_text())
    state = Path(installed['stateDir'])
    data = Path(installed['dataDir'])
    versions = {component: value['version'] for component, value in installed['current'].items()}
    wait_until(lambda: health(versions), lambda _: True, 180)
    token = login()
    before = 'before-update-' + uuid.uuid4().hex
    business_path = '/api/strategies' if installed['database']['kind'] == 'mysql' else '/api/user-groups'
    request(BASE, business_path, {'name': before}, token)
    durable_json(data / 'integration-sentinel.json', {'name': before})
    durable_json(FIXTURE / 'fault.json', SCENARIOS[scenario])
    plan = ipc('plans')
    assert plan['executable'], plan['blockers']
    body = {'planId': plan['planId'], 'idempotencyKey': str(uuid.uuid4()), 'acknowledgeDowntime': True}
    accepted = ipc('jobs', body)
    job = accepted['jobId']
    assert ipc('jobs', body)['jobId'] == job
    unit = installed['linux']['units']['job'].replace('@.', '@' + job + '.')
    EVIDENCE.mkdir(mode=0o700, parents=True, exist_ok=True)
    accepted_evidence = {'database': installed['database']['kind'], 'scenario': scenario,
                         'jobId': job, 'unit': unit, 'plan': plan}
    durable_json(EVIDENCE / ('linux-' + installed['database']['kind'] + '-' + scenario + '-' + job + '-accepted.json'), accepted_evidence)
    print(json.dumps({'database': installed['database']['kind'], 'scenario': scenario, 'jobId': job}), flush=True)
    faults = []
    for fault in SCENARIOS[scenario]:
        if fault['action'] != 'kill':
            continue
        marker = state / ('test-fault-' + job + '-' + fault['event'].replace(':', '-'))
        wait_until(marker.exists, bool, 420)
        pid = int(command('systemctl', 'show', '--property=MainPID', '--value', unit))
        assert pid > 1
        command('systemctl', 'kill', '--kill-whom=main', '--signal=KILL', unit)
        faults.append({'event': fault['event'], 'pid': pid, 'externalSignal': 'SIGKILL'})
    post = None
    if scenario.endswith(('-write', '-reboot')):
        marker = state / ('test-fault-' + job + '-business_reopened')
        wait_until(marker.exists, bool, 420)
        paused = json.loads((state / 'jobs' / (job + '.json')).read_text())
        restoring = scenario in ['restore-write', 'restore-reboot']
        decision = 'restore_decided' if restoring else 'commit_decided'
        assert paused['decision'] == decision and paused['view']['status'] == 'running'
        versions = {component: value['version'] for component, value in
                    (installed['current'] if restoring else paused['plan']['targets']).items()}
        health(versions)
        post = 'accepted-after-decision-' + uuid.uuid4().hex
        request(BASE, business_path, {'name': post}, token)
        durable_json(data / 'accepted-after-decision.json', {'name': post})
        pid = int(command('systemctl', 'show', '--property=MainPID', '--value', unit))
        assert pid > 1
        if scenario.endswith('-reboot'):
            receipt = {'database': installed['database']['kind'], 'scenario': scenario,
                       'installationId': installed['installationId'], 'jobId': job, 'unit': unit,
                       'before': before, 'afterDecision': post, 'decision': decision,
                       'workerPid': pid, 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
            durable_json(EVIDENCE / ('linux-reboot-' + job + '-receipt.json'), receipt)
            print(json.dumps({'rebootPending': True, **receipt}), flush=True)
            return
        command('systemctl', 'kill', '--kill-whom=main', '--signal=KILL', unit)
        faults.append({'event': 'business_reopened', 'pid': pid, 'externalSignal': 'SIGKILL'})
    complete(scenario, installed, job, token, before, post, unit, faults)


def complete(scenario, installed, job, token, before, post, unit, faults, reboot=None):
    state = Path(installed['stateDir'])
    data = Path(installed['dataDir'])
    business_path = '/api/strategies' if installed['database']['kind'] == 'mysql' else '/api/user-groups'
    terminal = wait_until(lambda: ipc('current')['job'], lambda value: value and value['status'] in
                          ['succeeded', 'rolled_back', 'failed', 'recovery_required'], 420)
    expected = 'rolled_back' if scenario in ['before-commit', 'rollback', 'after-restore', 'restore-write', 'restore-reboot', 'startup-failure'] else 'succeeded'
    assert terminal['jobId'] == job, 'Recovery changed the accepted job identity'
    assert terminal['status'] == expected, terminal
    record = json.loads((state / 'jobs' / (job + '.json')).read_text())
    assert record['decision'] == ('restore_decided' if expected == 'rolled_back' else 'commit_decided')
    versions = {component: value['version'] for component, value in
                (installed['current'] if expected == 'rolled_back' else record['plan']['targets']).items()}
    checked_health = health(versions)
    names = business_names(business_path, token)
    assert before in names and json.loads((data / 'integration-sentinel.json').read_text())['name'] == before
    if post:
        assert post in names and json.loads((data / 'accepted-after-decision.json').read_text())['name'] == post
    command('systemctl', 'restart', *[installed['linux']['units'][key] for key in ['backend', 'web', 'updater']])
    wait_until(lambda: health(versions), lambda _: True, 300)
    current = wait_until(lambda: ipc('current')['job'], lambda value: value and value['jobId'] == job)
    assert current['status'] == expected
    restarted_names = business_names(business_path, token)
    assert before in restarted_names
    assert json.loads((data / 'integration-sentinel.json').read_text())['name'] == before
    if post:
        assert post in restarted_names, 'Post-decision database write lost after service restart'
        assert json.loads((data / 'accepted-after-decision.json').read_text())['name'] == post
    result = {'database': installed['database']['kind'], 'scenario': scenario, 'job': current,
              'decision': record['decision'], 'operations': record['operations'], 'acceptedWritePreserved': bool(post),
              'businessApi': business_path, 'businessRows': {'before': before, 'afterDecision': post},
              'externallyKilledAt': faults, 'health': checked_health, 'versions': versions,
              'workerRestarts': int(command('systemctl', 'show', '--property=NRestarts', '--value', unit) or '0'),
              'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
              'artifacts': {role: {component: {'version': value['version'], 'sha256': value['artifact']['sha256']}
                           for component, value in components.items()} for role, components in
                           [('original', installed['current']), ('target', record['plan']['targets'])]},
              'sameJobAfterServiceRestart': True, 'supervisor': 'real-systemd', 'provenance': 'unpublished-local-fixtures'}
    if faults:
        assert result['workerRestarts'] >= 1, 'systemd did not restart the externally terminated worker'
    if reboot:
        assert result['bootId'] != reboot['bootId'], 'The guest did not reboot'
        assert result['decision'] == reboot['decision'] and post
        result['guestReboot'] = {'beforeBootId': reboot['bootId'], 'afterBootId': result['bootId'],
                                'sameJobId': job, 'acceptedWritePreserved': True,
                                'method': 'guest-systemctl-reboot-and-same-qemu-disk-start'}
    if scenario == 'startup-failure':
        since = record['view']['createdAt'].replace('T', ' ').replace('Z', ' UTC')
        entries = command('journalctl', '--unit=' + installed['linux']['units']['backend'],
                          '--since=' + since, '--output=json', '--no-pager')
        failures = [entry for line in entries.splitlines()
                    if 'status=42' in (entry := json.loads(line)).get('MESSAGE', '')]
        assert failures, 'Actual target exit 42 was not observed in the systemd journal'
        result['startupFailureEvidence'] = [
            {'message': entry['MESSAGE'], 'timestamp': entry.get('__REALTIME_TIMESTAMP')}
            for entry in failures]
    EVIDENCE.mkdir(mode=0o700, parents=True, exist_ok=True)
    (EVIDENCE / ('linux-' + installed['database']['kind'] + '-' + scenario + '-' + job + '-result.json')).write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


def reboot_receipt(job):
    assert str(uuid.UUID(job)) == job
    receipt = json.loads((EVIDENCE / ('linux-reboot-' + job + '-receipt.json')).read_text())
    assert receipt['jobId'] == job and receipt['scenario'].endswith('-reboot')
    return receipt


def resume_reboot(job):
    receipt = reboot_receipt(job)
    installed = json.loads(INSTALLATION.read_text())
    assert installed['installationId'] == receipt['installationId']
    assert Path('/proc/sys/kernel/random/boot_id').read_text().strip() != receipt['bootId']
    current = wait_until(lambda: ipc('current')['job'], lambda value: value and value['status'] in
                         ['succeeded', 'rolled_back', 'failed', 'recovery_required'], 420)
    expected = 'rolled_back' if receipt['scenario'] == 'restore-reboot' else 'succeeded'
    assert current['jobId'] == job and current['status'] == expected, current
    record = json.loads((Path(installed['stateDir']) / 'jobs' / (job + '.json')).read_text())
    complete(receipt['scenario'], record['originalInstallation'], job, wait_until(login, bool, 180),
             receipt['before'], receipt['afterDecision'], receipt['unit'], [], reboot=receipt)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'reboot-receipt', 'resume-reboot', *SCENARIOS])
    parser.add_argument('job', nargs='?')
    args = parser.parse_args()
    if args.action == 'install': install()
    elif args.action == 'resume-reboot': resume_reboot(args.job)
    elif args.action == 'reboot-receipt':
        receipt = reboot_receipt(args.job)
        current = ipc('current')['job']
        assert current['jobId'] == args.job and current['status'] == 'running', current
        print(json.dumps(receipt), flush=True)
    else: run(args.action)
