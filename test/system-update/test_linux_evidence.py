"""Small host-only checks: no Docker, network, guest or archive payload reads."""
import io
import json
from pathlib import Path
import runpy
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import uuid

import linux_evidence as evidence
import linux_provision as provision


class EvidenceContextTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        result = json.dumps({'scenario': 'normal', 'job': {'jobId': 'prior-job'}}).encode()
        self.row = {'label': 'old-case', 'file': 'old-result.json', 'sha256': evidence.digest(result)}
        (self.root / 'old-result.json').write_bytes(result)
        (self.root / 'storage-v3-matrix-index.json').write_text(json.dumps({'cases': [self.row]}))
        (self.root / 'main-current-native-job.json').write_text('{"jobId":"stale"}')
        (self.root / 'backend-mysql.env').write_text('DB_PASSWORD=must-not-copy')
        (self.root / 'mysql-lowio-instance.json').write_text(json.dumps({
            'testInstanceId': str(uuid.uuid4()), 'serverUuid': str(uuid.uuid4()),
            'containerId': 'c' * 64,
            'volume': 'console-system-update-test-mysql-original'}))

    def scoped(self):
        destination = self.root / 'recreated-test'
        metadata = evidence.prepare_context(destination, self.root)
        context = evidence.load_context({evidence.ENVIRONMENT_KEY: str(destination)}, self.root)
        return context, metadata

    def runtime(self, context):
        (context.root / 'fixture-runtime.json').write_text(json.dumps({
            'fixtureId': context.fixture_id, 'sourceEpoch': 'storage-v3',
            'originalLiveDataRecovered': False, 'vmContainerId': 'a' * 64,
            'vmVolume': 'console-system-update-test-vm-new'}))

    def test_default_context_preserves_original_paths(self):
        context = evidence.load_context({}, self.root)
        self.assertEqual(context.root, self.root)
        self.assertEqual(context.inputs, self.root)
        self.assertIsNone(context.fixture_id)
        self.assertEqual(context.identity('mysql'), {})

    def test_initializer_preserves_receipt_bytes_and_excludes_secrets_and_job(self):
        context, _ = self.scoped()
        self.assertEqual((context.root / 'old-result.json').read_bytes(), (self.root / 'old-result.json').read_bytes())
        self.assertEqual((context.root / 'storage-v3-matrix-index.json').read_bytes(), (self.root / 'storage-v3-matrix-index.json').read_bytes())
        self.assertFalse((context.root / 'backend-mysql.env').exists())
        self.assertFalse((context.root / 'main-current-native-job.json').exists())
        self.assertFalse((context.root / 'mysql-lowio-instance.json').exists())
        self.assertFalse(json.loads((context.root / 'linux-schedule.json').read_text())['allowNewCases'])
        self.assertEqual(context.inputs, self.root)
        self.assertEqual(context.inherited_entries(), {'old-case': self.row})

    def test_context_missing_or_outside_identity_fails(self):
        with self.assertRaises(AssertionError):
            evidence.load_context({evidence.ENVIRONMENT_KEY: str(self.root / 'absent')}, self.root)
        with self.assertRaises(AssertionError):
            evidence.load_context({evidence.ENVIRONMENT_KEY: str(self.root.parent)}, self.root)

    def test_missing_runtime_identity_fails(self):
        context, _ = self.scoped()
        with self.assertRaises(AssertionError):
            context.identity('sqlite')

    def test_changed_historical_index_fails(self):
        context, _ = self.scoped()
        (self.root / 'storage-v3-matrix-index.json').write_text('{"cases":[]}')
        with self.assertRaises(AssertionError):
            context.inherited_entries()

    def test_changed_inherited_reboot_receipt_fails(self):
        result = json.dumps({'scenario': 'commit-reboot', 'job': {'jobId': 'prior-job'}}).encode()
        (self.root / 'old-result.json').write_bytes(result)
        self.row.update(jobId='prior-job', sha256=evidence.digest(result))
        (self.root / 'storage-v3-matrix-index.json').write_text(json.dumps({'cases': [self.row]}))
        name = 'linux-reboot-prior-job-host-receipt.json'
        (self.root / name).write_text('{"sameVmAndDisk":true}')
        context, _ = self.scoped()
        (context.root / name).write_text('{"sameVmAndDisk":false}')
        with self.assertRaisesRegex(AssertionError, 'Inherited receipt changed'):
            context.inherited_entries()

    def test_inherited_rows_cannot_be_omitted_changed_or_duplicated(self):
        context, _ = self.scoped()
        for rows in [[], [{**self.row, 'status': 'changed'}], [self.row, self.row]]:
            with self.subTest(rows=rows), self.assertRaises(AssertionError):
                context.validate_entries(rows)
        self.assertEqual(context.validate_entries([self.row]), {'old-case': self.row})

    def test_new_case_requires_current_fixture_and_safe_receipt_path(self):
        context, _ = self.scoped()
        self.runtime(context)
        row = {'label': 'new-case', 'database': 'sqlite', 'file': '../outside.json',
               **context.identity('sqlite')}
        with self.assertRaises(AssertionError):
            context.validate_entries([self.row, {**row, 'fixtureId': str(uuid.uuid4())}])
        with self.assertRaises(AssertionError):
            context.validate_entries([self.row, row])

    def test_mismatched_receipt_prevents_context_creation(self):
        (self.root / 'old-result.json').write_text('tampered')
        with self.assertRaises(AssertionError):
            evidence.prepare_context(self.root / 'recreated-bad', self.root)
        self.assertFalse((self.root / 'recreated-bad').exists())

    def test_sqlite_runtime_identity_needs_no_mysql_receipt(self):
        context, _ = self.scoped()
        self.runtime(context)
        self.assertEqual(context.identity('sqlite')['fixtureId'], context.fixture_id)
        self.assertFalse((context.root / 'mysql-lowio-instance.json').exists())

    def test_mysql_requires_new_instance_and_matching_fixture(self):
        context, _ = self.scoped()
        self.runtime(context)
        original = json.loads((self.root / 'mysql-lowio-instance.json').read_text())
        instance = {'fixtureId': context.fixture_id, 'freshDatabaseInstance': True,
                    'originalLiveSchemaRecovered': False, 'testInstanceId': original['testInstanceId'],
                    'serverUuid': str(uuid.uuid4()), 'volume': 'console-system-update-test-mysql-new',
                    'containerId': 'b' * 64}
        path = context.root / 'mysql-lowio-instance.json'
        path.write_text(json.dumps(instance))
        with self.assertRaises(AssertionError):
            context.identity('mysql')
        instance['testInstanceId'] = str(uuid.uuid4())
        path.write_text(json.dumps(instance))
        self.assertEqual(context.identity('mysql')['databaseInstanceId'], instance['testInstanceId'])
        instance['containerId'] = original['containerId']
        path.write_text(json.dumps(instance))
        with self.assertRaises(AssertionError):
            context.identity('mysql')
        instance['containerId'] = 'b' * 64
        instance['fixtureId'] = str(uuid.uuid4())
        path.write_text(json.dumps(instance))
        with self.assertRaises(AssertionError):
            context.identity('mysql')


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        with tarfile.open(self.root / 'linux-evidence.tar', 'w'):
            pass
        self.addCleanup(patch.stopall)
        patch.object(provision, 'EVIDENCE', self.root).start()
        self.ssh = patch.object(provision, 'ssh', return_value='sqlite').start()
        self.command = patch.object(provision, 'command').start()
        self.mysql = patch.object(provision, 'mysql_sql', return_value='sentinel').start()

    def baseline(self):
        (self.root / 'mysql-sibling-before.json').write_text('{"rows":"sentinel"}')

    def test_sqlite_ignores_stale_mysql_baseline(self):
        self.baseline()
        provision.collect(database='sqlite')
        self.mysql.assert_not_called()
        self.assertFalse((self.root / 'mysql-sibling-retention.json').exists())

    def test_default_collection_uses_current_database(self):
        self.baseline()
        provision.collect()
        self.mysql.assert_not_called()
        self.assertIn('installation.json', self.ssh.call_args_list[0].args[0])

    def test_mysql_missing_baseline_stops_before_collection(self):
        with self.assertRaises(AssertionError):
            provision.collect(database='mysql')
        self.command.assert_not_called()
        self.ssh.assert_not_called()
        self.mysql.assert_not_called()

    def test_mysql_preserves_sibling_assertion_and_proof(self):
        self.baseline()
        provision.collect(database='mysql')
        self.mysql.assert_called_once_with('SELECT * FROM untouched_sibling.sentinel;')
        self.assertTrue(json.loads((self.root / 'mysql-sibling-retention.json').read_text())['unchanged'])
        self.mysql.return_value = 'changed'
        with self.assertRaises(AssertionError):
            provision.collect(database='mysql')

    def test_collection_cannot_overwrite_inherited_receipt(self):
        raw = b'{"scenario":"normal","oldProof":true}'
        (self.root / 'prior.json').write_bytes(raw)
        (self.root / 'storage-v3-matrix-index.json').write_text(json.dumps({'cases': [
            {'label': 'prior', 'file': 'prior.json', 'sha256': evidence.digest(raw)}]}))
        destination = self.root / 'recreated'
        evidence.prepare_context(destination, self.root)
        context = evidence.load_context({evidence.ENVIRONMENT_KEY: str(destination)}, self.root)
        with tarfile.open(destination / 'linux-evidence.tar', 'w') as bundle:
            replacement = b'{"scenario":"normal","oldProof":false}'
            member = tarfile.TarInfo('prior.json')
            member.size = len(replacement)
            bundle.addfile(member, io.BytesIO(replacement))
        with patch.object(provision, 'EVIDENCE', destination), patch.object(provision, 'CONTEXT', context):
            with self.assertRaisesRegex(AssertionError, 'cannot overwrite inherited receipt'):
                provision.collect(database='sqlite')
        self.assertEqual((destination / 'prior.json').read_bytes(), raw)
        self.assertEqual((self.root / 'prior.json').read_bytes(), raw)
        self.mysql.assert_not_called()


class HostDriverContextTests(unittest.TestCase):
    @unittest.skipUnless((evidence.DEFAULT_ROOT / 'run_storage_v3.py').is_file(),
        'Local ignored qualification driver is not provisioned')
    def test_driver_rejects_changed_history_before_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            raw = b'{"scenario":"normal"}'
            (source / 'prior.json').write_bytes(raw)
            (source / 'storage-v3-matrix-index.json').write_text(json.dumps({'cases': [
                {'label': 'prior', 'file': 'prior.json', 'sha256': evidence.digest(raw)}]}))
            destination = source / 'recreated'
            evidence.prepare_context(destination, source)
            context = evidence.load_context({evidence.ENVIRONMENT_KEY: str(destination)}, source)
            (destination / 'prior.json').write_text('{"scenario":"changed"}')
            with patch.object(provision, 'CONTEXT', context), patch.object(provision, 'EVIDENCE', destination), \
                    patch.object(sys, 'path', [str(evidence.DEFAULT_ROOT), *sys.path]), patch.dict(sys.modules), \
                    patch('subprocess.check_output') as docker, patch('subprocess.run') as command, \
                    patch('subprocess.Popen') as process:
                sys.modules.pop('run_remaining', None)
                sys.modules.pop('run_lowio', None)
                driver = runpy.run_path(str(evidence.DEFAULT_ROOT / 'run_storage_v3.py'))
                with self.assertRaisesRegex(AssertionError, 'Inherited receipt changed'):
                    driver['run_next']()
                docker.assert_not_called()
                command.assert_not_called()
                process.assert_not_called()

    @unittest.skipUnless((evidence.DEFAULT_ROOT / 'run_storage_v3.py').is_file(),
        'Local ignored qualification driver is not provisioned')
    def test_mysql_guard_requires_actual_server_uuid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            instance = {'containerId': 'b' * 64, 'volume': 'console-system-update-test-mysql-new',
                        'serverUuid': str(uuid.uuid4())}
            (root / 'mysql-lowio-instance.json').write_text(json.dumps(instance))
            context = Mock(root=root, fixture_id=str(uuid.uuid4()))
            info = {'Id': instance['containerId'], 'State': {'Running': True, 'OOMKilled': False},
                    'HostConfig': {'Memory': 805306368, 'NanoCpus': 500000000},
                    'Mounts': [{'Name': instance['volume'], 'Destination': '/var/lib/mysql'}]}
            with patch.object(provision, 'CONTEXT', context), patch.object(provision, 'EVIDENCE', root), \
                    patch.object(sys, 'path', [str(evidence.DEFAULT_ROOT), *sys.path]), patch.dict(sys.modules), \
                    patch.object(provision, 'mysql_sql', return_value=str(uuid.uuid4())) as sql, \
                    patch('subprocess.check_output', return_value=json.dumps([info])) as docker:
                sys.modules.pop('run_remaining', None)
                sys.modules.pop('run_lowio', None)
                driver = runpy.run_path(str(evidence.DEFAULT_ROOT / 'run_storage_v3.py'))
                with self.assertRaisesRegex(AssertionError, 'MySQL server differs'):
                    driver['mysql_memory_guard']('test')
                sql.assert_called_once_with('SELECT @@server_uuid;')
                self.assertEqual(docker.call_count, 1)
                self.assertFalse((root / 'storage-v3-mysql-memory-samples.jsonl').exists())

    @unittest.skipUnless(all((evidence.DEFAULT_ROOT / name).is_file() for name in [
        'run_storage_v3.py', 'verify_storage_v3.py', 'storage-v3-catalog-all.json']),
        'Local ignored qualification drivers/catalog are not provisioned')
    def test_scoped_imports_and_missing_identity_never_reach_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context = evidence.EvidenceContext(root, evidence.DEFAULT_ROOT, str(uuid.uuid4()))
            (root / 'linux-schedule.json').write_text('{"allowNewCases":true}')
            with patch.object(provision, 'CONTEXT', context), patch.object(provision, 'EVIDENCE', root), \
                    patch.object(evidence, 'load_context', return_value=context), \
                    patch.object(sys, 'path', [str(evidence.DEFAULT_ROOT), *sys.path]), \
                    patch.dict(sys.modules), patch('subprocess.check_output') as docker, \
                    patch('subprocess.run') as command, patch('subprocess.Popen') as process:
                sys.modules.pop('run_remaining', None)
                sys.modules.pop('run_lowio', None)
                driver = runpy.run_path(str(evidence.DEFAULT_ROOT / 'run_storage_v3.py'))
                verifier = runpy.run_path(str(evidence.DEFAULT_ROOT / 'verify_storage_v3.py'))
                self.assertEqual(driver['EVIDENCE'], root)
                self.assertEqual(driver['runner'].EVIDENCE, root)
                self.assertEqual(driver['runner'].INDEX, root / 'storage-v3-matrix-index.json')
                self.assertEqual(verifier['EVIDENCE'], root)
                self.assertEqual(verifier['CATALOG_FILE'], evidence.DEFAULT_ROOT / 'storage-v3-catalog-all.json')
                with self.assertRaises(AssertionError):
                    driver['run_next']()
                docker.assert_not_called()
                command.assert_not_called()
                process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
