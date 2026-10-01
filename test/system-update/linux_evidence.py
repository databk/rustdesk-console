"""Optional, separately identified host evidence for a recreated Linux fixture."""
import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import uuid

ENVIRONMENT_KEY = 'CONSOLE_SYSTEM_UPDATE_EVIDENCE_ROOT'
DEFAULT_ROOT = Path(__file__).resolve().parent / 'artifacts/linux'
SOURCE_EPOCH = 'storage-v3'


def read_small(path):
    assert path.is_file() and path.stat().st_size < 2 * 1024 * 1024, 'Missing or oversized evidence: ' + str(path)
    return path.read_bytes()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def child_file(root, name):
    assert isinstance(name, str) and Path(name).name == name and name not in ['', '.', '..']
    path = root / name
    assert path.resolve().parent == root.resolve(), 'Evidence path escapes its root'
    return path


def indexed_receipts(source, index):
    files = {}
    for entry in index['cases']:
        filename = entry['file']
        raw = read_small(child_file(source, filename))
        assert digest(raw) == entry['sha256']
        files[filename] = raw
        sibling = entry.get('siblingEvidence')
        if sibling:
            raw = read_small(child_file(source, sibling['file']))
            assert digest(raw) == sibling['sha256']
            files[sibling['file']] = raw
        result = json.loads(files[filename])
        if result['scenario'].endswith('-reboot'):
            filename = 'linux-reboot-' + entry['jobId'] + '-host-receipt.json'
            files[filename] = read_small(child_file(source, filename))
    return files


@dataclass(frozen=True)
class EvidenceContext:
    root: Path
    inputs: Path
    fixture_id: str | None = None
    inherited_index_sha256: str | None = None

    def inherited_entries(self):
        if self.fixture_id is None:
            return {}
        raw = read_small(self.inputs / 'storage-v3-matrix-index.json')
        assert digest(raw) == self.inherited_index_sha256, 'Original matrix changed after context creation'
        index = json.loads(raw)
        metadata = json.loads(read_small(self.root / 'fixture-context.json'))
        assert metadata['fixtureId'] == self.fixture_id
        files = indexed_receipts(self.inputs, index)
        expected = metadata['inheritedEvidence']
        assert {name: digest(raw) for name, raw in files.items()} == expected, 'Original inherited receipts changed'
        for name, raw in files.items():
            assert read_small(child_file(self.root, name)) == raw, 'Inherited receipt changed: ' + name
        entries = {item['label']: item for item in index['cases']}
        assert len(entries) == len(index['cases']), 'Duplicate inherited case label'
        return entries

    def validate_entries(self, entries):
        inherited = self.inherited_entries()
        if self.fixture_id is not None:
            current = {item['label']: item for item in entries}
            assert len(current) == len(entries), 'Duplicate case label'
            assert all(current.get(label) == row for label, row in inherited.items()), 'Inherited matrix row missing or changed'
            added = [row for label, row in current.items() if label not in inherited]
            for row in added:
                identity = self.identity(row['database'])
                assert all(row.get(key) == value for key, value in identity.items()), 'New case lacks its scoped fixture identity'
            indexed_receipts(self.root, {'cases': added})
        return inherited

    def identity(self, database):
        assert database in ['sqlite', 'mysql']
        if self.fixture_id is None:
            return {}
        value = json.loads(read_small(self.root / 'fixture-runtime.json'))
        assert value['fixtureId'] == self.fixture_id and value['sourceEpoch'] == SOURCE_EPOCH
        assert value['originalLiveDataRecovered'] is False
        assert len(value['vmContainerId']) == 64 and all(c in '0123456789abcdef' for c in value['vmContainerId'])
        assert value['vmVolume'].startswith('console-system-update-test-vm-')
        result = {key: value[key] for key in ['fixtureId', 'vmContainerId', 'vmVolume']}
        if database == 'mysql':
            instance = json.loads(read_small(self.root / 'mysql-lowio-instance.json'))
            original = json.loads(read_small(self.inputs / 'mysql-lowio-instance.json'))
            assert instance['fixtureId'] == self.fixture_id
            assert instance['freshDatabaseInstance'] is True and instance['originalLiveSchemaRecovered'] is False
            assert instance['testInstanceId'] != original['testInstanceId']
            assert instance['serverUuid'] != original['serverUuid']
            assert instance['containerId'] != original['containerId']
            assert len(instance['containerId']) == 64 and all(c in '0123456789abcdef' for c in instance['containerId'])
            assert str(uuid.UUID(instance['testInstanceId'])) == instance['testInstanceId']
            assert str(uuid.UUID(instance['serverUuid'])) == instance['serverUuid']
            assert instance['volume'].startswith('console-system-update-test-mysql-')
            assert instance['volume'] != original['volume']
            result.update(databaseInstanceId=instance['testInstanceId'], mysqlServerUuid=instance['serverUuid'])
        return result


def load_context(environ=None, default_root=DEFAULT_ROOT):
    environ = os.environ if environ is None else environ
    original = default_root.resolve()
    selected = environ.get(ENVIRONMENT_KEY)
    if selected is None:
        return EvidenceContext(original, original)
    root = Path(selected)
    assert root.is_absolute() and root.resolve().parent == original, 'Scoped evidence must be a direct child of the original Linux evidence root'
    root = root.resolve()
    value = json.loads(read_small(root / 'fixture-context.json'))
    assert value['schemaVersion'] == 1 and value['sourceEpoch'] == SOURCE_EPOCH
    fixture_id = value['fixtureId']
    assert str(uuid.UUID(fixture_id)) == fixture_id
    assert Path(value['inputRoot']).resolve() == original
    assert value['originalLiveDataRecovered'] is False
    return EvidenceContext(root, original, fixture_id, value['inheritedIndexSha256'])


def prepare_context(destination, source_root=DEFAULT_ROOT):
    """Copy only indexed small receipts; never include current jobs or secrets."""
    source = source_root.resolve()
    destination = Path(destination).resolve()
    assert destination.parent == source and not destination.exists(), 'Use a new direct child evidence directory'
    raw_index = read_small(source / 'storage-v3-matrix-index.json')
    index = json.loads(raw_index)
    files = indexed_receipts(source, index)
    fixture_id = str(uuid.uuid4())
    metadata = {'schemaVersion': 1, 'sourceEpoch': SOURCE_EPOCH, 'fixtureId': fixture_id,
                'inputRoot': str(source), 'originalLiveDataRecovered': False,
                'inheritedIndexSha256': digest(raw_index),
                'inheritedEvidence': {name: digest(raw) for name, raw in files.items()}}
    destination.mkdir()
    for name, raw in files.items():
        (destination / name).write_bytes(raw)
    (destination / 'storage-v3-matrix-index.json').write_bytes(raw_index)
    (destination / 'linux-schedule.json').write_text(json.dumps({'allowNewCases': False,
        'reason': 'Fresh context: runtime identities and explicit scheduling authorization required'}))
    (destination / 'fixture-context.json').write_text(json.dumps(metadata, indent=2))
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--create', required=True, type=Path)
    args = parser.parse_args()
    result = prepare_context(args.create)
    print(json.dumps({'root': str(args.create.resolve()), 'fixtureId': result['fixtureId'],
                      'copiedReceipts': len(result['inheritedEvidence']), 'runtimeStarted': False}))
