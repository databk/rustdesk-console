"""Prepare and retain only this disposable guest's fixed Console test layout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

from linux_lifecycle import FIXTURE, INSTALLATION, command, installer, durable_json

STAGING = Path('/home/tester/integration')
ARCHIVES = Path('/var/lib/console-system-update-test-archives')
HISTORY = Path('/var/lib/console-system-update-test-history')
PATHS = [Path(value) for value in ['/opt/rustdesk-console', '/etc/rustdesk-console',
         '/var/lib/rustdesk-console', '/var/lib/rustdesk-console-updater',
         '/var/lib/rustdesk-console-maintenance', '/run/rustdesk-console-updater']]


def prepare(database):
    assert os.geteuid() == 0 and Path('/proc/1/comm').read_text().strip() == 'systemd'
    assert not INSTALLATION.exists(), 'Archive the existing test installation explicitly first'
    index = json.loads((STAGING / 'catalog-all.json').read_text())
    ARCHIVES.mkdir(mode=0o700, parents=True, exist_ok=True)
    for filename in index['archiveNames']:
        file = STAGING / filename
        file_hash = hashlib.sha256(file.read_bytes()).hexdigest()
        destination = ARCHIVES / (file_hash + '-' + file.name)
        if not destination.exists():
            shutil.copyfile(file, destination)
            destination.chmod(0o600)
        else:
            assert hashlib.sha256(destination.read_bytes()).digest() == hashlib.sha256(file.read_bytes()).digest(), 'Existing immutable archive differs: ' + file.name
    FIXTURE.mkdir(mode=0o700, parents=True, exist_ok=True)
    for filename in index['archiveNames']:
        source = STAGING / filename
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        os.link(ARCHIVES / (source_hash + '-' + filename), FIXTURE / filename)
    fixture = {'testOnly': 'console-system-update-test', 'current': index['current'],
               'targets': {'backend': index['backendTarget'], 'web': index['current']['web']},
               'archives': {url: str(FIXTURE / name) for url, name in index['archives'].items()}}
    durable_json(FIXTURE / 'catalog.json', fixture)
    durable_json(FIXTURE / 'fault.json', [])
    values = installer().parse_environment(STAGING / ('backend-' + database + '.env'))
    installer().write_environment(STAGING / 'backend.env', values)
    print(json.dumps({'prepared': database, 'provenance': 'unpublished-local-fixtures'}))


def target(mode):
    index = json.loads((STAGING / 'catalog-all.json').read_text())
    current = json.loads(INSTALLATION.read_text())['current']
    targets = dict(current)
    if mode in ['backend', 'both']:
        targets['backend'] = index['backendTarget']
    if mode in ['web', 'both']:
        targets['web'] = index['webTarget']
    if mode == 'startup-failure':
        targets['backend'] = index['backendFailure']
    fixture = json.loads((FIXTURE / 'catalog.json').read_text())
    fixture['targets'] = targets
    durable_json(FIXTURE / 'catalog.json', fixture)
    durable_json(FIXTURE / 'fault.json', [])
    command('systemctl', 'restart', 'rustdesk-console-updater.service')
    print(json.dumps({'targets': {component: item['version'] for component, item in targets.items()}}))


def archive(recovery_id=None):
    installed = json.loads(INSTALLATION.read_text())
    if recovery_id:
        assert recovery_id == installed['installationId'], 'Quarantine requires the exact installation identity'
    jobs = []
    for job in Path(installed['stateDir']).glob('jobs/*.json'):
        record = json.loads(job.read_text())
        allowed = ['succeeded', 'rolled_back', 'failed'] + (['recovery_required'] if recovery_id else [])
        assert record['view']['status'] in allowed, 'Do not archive an active or unresolved recovery'
        jobs.append((job, record))
    if recovery_id:
        unresolved = [record['view'] for _, record in jobs if record['view']['status'] == 'recovery_required']
        assert unresolved, 'Quarantine is only for an explicitly unresolved installation'
        assert json.loads(Path(installed['maintenanceFile']).read_text())['active'], 'Preserve the unresolved maintenance fence'
    history = HISTORY / (('unresolved-' if recovery_id else '') + installed['installationId'])
    history.mkdir(mode=0o700, parents=True, exist_ok=False)
    if recovery_id:
        durable_json(history / 'quarantine.json', {'installationId': recovery_id,
                     'outcome': 'unresolved-recovery-retained', 'jobs': unresolved})
    for job, record in jobs:
        unit = installed['linux']['units']['job'].replace('@.', '@' + job.stem + '.')
        subprocess.run(['systemctl', 'disable', '--now', unit], check=True, capture_output=True)
    units = installer().UNITS
    command('systemctl', 'disable', '--now', units['backend'], units['web'], units['updater'])
    for index, source in enumerate(PATHS):
        if source.exists():
            shutil.move(str(source), history / ('path-' + str(index)))
    for unit in units.values():
        source = Path('/etc/systemd/system') / unit
        if source.exists():
            shutil.move(source, history / unit)
    recovery = Path('/usr/local/sbin/rustdesk-console-recover')
    if recovery.exists():
        shutil.move(recovery, history / recovery.name)
    config = STAGING / 'backend.env'
    if config.exists():
        shutil.move(config, history / 'initial-backend.env')
    command('systemctl', 'daemon-reload')
    print(json.dumps({'retainedInstallation': installed['installationId'], 'history': str(history),
                      'unresolvedRecovery': bool(recovery_id)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'target', 'archive', 'quarantine'])
    parser.add_argument('value', nargs='?')
    args = parser.parse_args()
    if args.action == 'prepare':
        assert args.value in ['sqlite', 'mysql']
        prepare(args.value)
    elif args.action == 'target':
        assert args.value in ['backend', 'web', 'both', 'startup-failure']
        target(args.value)
    elif args.action == 'quarantine':
        assert args.value, 'Supply the explicitly authorized installation ID'
        archive(args.value)
    else:
        archive()
