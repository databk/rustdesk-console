import io
import os
import pathlib
import stat
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import install_linux as installer


class InstallationSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = pathlib.Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def archive(self, entries):
        file = self.directory / 'bundle.tar.gz'
        with tarfile.open(file, 'w:gz') as archive:
            for name, kind, contents in entries:
                item = tarfile.TarInfo(name)
                item.type = kind
                item.mode = 0o6755
                item.size = len(contents) if kind == tarfile.REGTYPE else 0
                item.linkname = '/etc/shadow' if kind in [tarfile.SYMTYPE, tarfile.LNKTYPE] else ''
                archive.addfile(item, io.BytesIO(contents) if item.size else None)
        return file

    def test_extracts_complete_bundle_and_drops_special_bits(self):
        archive = self.archive([('./', tarfile.DIRTYPE, b''), ('./bin/app', tarfile.REGTYPE, b'ELF fixture')])
        old = os.umask(0o077)
        try:
            installer.extract_bundle(archive, self.directory / 'out')
        finally:
            os.umask(old)
        self.assertEqual((self.directory / 'out/bin/app').read_bytes(), b'ELF fixture')
        self.assertEqual(stat.S_IMODE((self.directory / 'out/bin/app').stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((self.directory / 'out/bin').stat().st_mode), 0o755)

    def test_rejects_traversal_before_extracting_any_file(self):
        archive = self.archive([('ok', tarfile.REGTYPE, b'good'), ('../escape', tarfile.REGTYPE, b'bad')])
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            installer.extract_bundle(archive, self.directory / 'out')
        self.assertFalse((self.directory / 'out').exists())

    def test_rejects_absolute_paths_links_and_devices(self):
        for index, (name, kind) in enumerate([('/etc/passwd', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('device', tarfile.CHRTYPE), ('a\\b', tarfile.REGTYPE)]):
            with self.subTest(name=name):
                archive = self.archive([(name, kind, b'')])
                with self.assertRaises(ValueError):
                    installer.extract_bundle(archive, self.directory / str(index))

    def test_rejects_normalized_duplicate_paths(self):
        archive = self.archive([('same', tarfile.REGTYPE, b'a'), ('./same', tarfile.REGTYPE, b'b')])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            installer.extract_bundle(archive, self.directory / 'out')

    def test_rejects_expansion_limit_before_extraction(self):
        archive = self.archive([('large', tarfile.REGTYPE, b'abcd')])
        with patch.object(installer, 'MAX_EXPANDED', 3), self.assertRaisesRegex(ValueError, 'expansion'):
            installer.extract_bundle(archive, self.directory / 'out')

    def test_compatibility_requires_explicit_comparators(self):
        self.assertTrue(installer.satisfies('1.10.0', '>=1.7.0 <2.0.0'))
        for expression in ['^1.0.0', '', '>=2.0.0', '>=1.0.0 || <2.0.0', '>=01.0.0']:
            self.assertFalse(installer.satisfies('1.10.0', expression))

    def test_redirects_reject_credentials_ports_and_host_confusion(self):
        installer.validate_url('https://release-assets.githubusercontent.com/asset')
        for url in ['http://github.com/a', 'https://github.com.evil.test/a', 'https://user@github.com/a', 'https://github.com:444/a', 'file:///tmp/artifact']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                installer.validate_url(url)

    def test_environment_is_data_never_shell(self):
        file = self.directory / 'input.env'
        literal = 'literal$(whoami)' + chr(96) + 'id' + chr(96) + '$HOME'
        file.write_text('DB_PASSWORD="' + literal + '"\nDB_TYPE=mysql\n', encoding='utf8')
        values = installer.parse_environment(file)
        self.assertEqual(values['DB_PASSWORD'], literal)
        installer.write_environment(self.directory / 'output.env', values)
        self.assertEqual((self.directory / 'output.env').read_text(), 'DB_PASSWORD="' + literal + '"\nDB_TYPE="mysql"\n')
        self.assertEqual(stat.S_IMODE((self.directory / 'output.env').stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            installer.write_environment(self.directory / 'output.env', {'DB_PASSWORD': 'replacement'})

    def test_environment_rejects_multiline_and_invalid_names(self):
        file = self.directory / 'bad.env'
        for content in ['export DB_TYPE=mysql', 'DB_PASSWORD="unfinished', 'A=contains\0nul']:
            file.write_text(content, encoding='utf8')
            with self.assertRaises(ValueError):
                installer.parse_environment(file)

    def test_configuration_fingerprint_tracks_all_service_environments(self):
        for name in ['backend.env', 'web.env', 'updater.env']:
            installer.write_environment(self.directory / name, {'PRIVATE_VALUE': 'secret-sentinel'})
        with patch.object(installer, 'CONFIG', self.directory):
            before = installer.configuration_hashes({'kind': 'sqlite'})
            (self.directory / 'backend.env').write_text('DATA_DIR=/changed\n', encoding='utf8')
            after = installer.configuration_hashes({'kind': 'sqlite'})
        self.assertEqual(set(before), {str(self.directory / name) for name in ['backend.env', 'web.env', 'updater.env']})
        self.assertTrue(all(len(value) == 64 for value in before.values()))
        self.assertNotIn('secret-sentinel', repr(before))
        self.assertNotEqual(before[str(self.directory / 'backend.env')], after[str(self.directory / 'backend.env')])
        self.assertEqual(before[str(self.directory / 'web.env')], after[str(self.directory / 'web.env')])

    def test_mysql_defaults_match_the_application_environment(self):
        values = installer.database_environment({'DB_TYPE': ' MYSQL ', 'SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA': 'true'})
        self.assertEqual({key: values[key] for key in ['DB_TYPE', 'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']},
                         {'DB_TYPE': 'mysql', 'DB_HOST': 'localhost', 'DB_PORT': '3306', 'DB_USERNAME': 'root',
                          'DB_PASSWORD': '', 'DB_DATABASE': 'rustdesk_console'})
        file = self.directory / 'backend.env'
        installer.write_environment(file, values)
        self.assertEqual(installer.parse_environment(file), values)

    def test_mysql_configuration_preserves_explicit_connection_and_credentials(self):
        values = {'DB_TYPE': 'mysql', 'SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA': 'true', 'DB_HOST': 'database',
                  'DB_PORT': '3307', 'DB_USERNAME': 'dedicated', 'DB_PASSWORD': 'secret-sentinel', 'DB_DATABASE': 'dedicated_schema'}
        self.assertEqual(installer.database_environment(values), values)

    def test_database_configuration_rejects_unsafe_inputs(self):
        for values in [{'DB_TYPE': 'postgres'}, {'DB_TYPE': 'mysql'},
                       *({'DB_TYPE': 'mysql', 'SYSTEM_UPDATE_MYSQL_EXCLUSIVE_SCHEMA': 'true', 'DB_PORT': port}
                         for port in ['0', '65536', '3306suffix'])]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                installer.database_environment(values)
        self.assertEqual(installer.database_environment({}), {'DB_TYPE': 'sqlite'})

    def test_configuration_fingerprint_includes_mysql_password_and_rejects_missing_files(self):
        for name in ['backend.env', 'web.env', 'updater.env']:
            installer.write_environment(self.directory / name, {'KEY': 'value'})
        password = self.directory / 'mysql.password'
        database = {'kind': 'mysql', 'passwordFile': str(password)}
        with patch.object(installer, 'CONFIG', self.directory):
            with self.assertRaises(FileNotFoundError):
                installer.configuration_hashes(database)
            installer.private_write(password, 'mysql-secret-sentinel')
            before = installer.configuration_hashes(database)
            password.write_text('changed-secret', encoding='utf8')
            after = installer.configuration_hashes(database)
        self.assertEqual(len(before), 4)
        self.assertNotIn('mysql-secret-sentinel', repr(before))
        self.assertNotEqual(before[str(password)], after[str(password)])
        self.assertEqual(stat.S_IMODE(password.stat().st_mode), 0o600)

    def release_fixture(self):
        url = 'https://github.com/databk/rustdesk-console/releases/download/1.10.0/'
        target = {'os': 'linux', 'arch': 'x64', 'libc': 'glibc'}
        artifact = {'kind': 'archive', 'platform': target, 'name': 'rustdesk-console-linux-x64.tar.gz', 'url': url + 'rustdesk-console-linux-x64.tar.gz', 'size': 123, 'sha256': 'a' * 64}
        release = {'id': 42, 'tag_name': '1.10.0', 'draft': False, 'prerelease': False, 'published_at': '2026-09-29T00:00:00Z',
                   'assets': [{'name': 'update-manifest.json', 'state': 'uploaded', 'browser_download_url': url + 'update-manifest.json'},
                              {'name': artifact['name'], 'state': 'uploaded', 'size': 123, 'browser_download_url': artifact['url']}]}
        manifest = {'schemaVersion': 1, 'component': 'backend', 'repository': 'databk/rustdesk-console', 'version': '1.10.0', 'tag': '1.10.0', 'releaseId': 42,
                    'publishedAt': release['published_at'], 'sourceCommit': 'b' * 40, 'bundleFormat': 1, 'updaterProtocol': 1, 'maintenanceProtocol': 1,
                    'peerVersionRange': '>=1.7.0 <2.0.0', 'artifacts': [artifact]}
        return release, manifest, target

    def test_selects_only_exact_official_artifact(self):
        release, manifest, target = self.release_fixture()
        with patch.object(installer, 'fetch_json', side_effect=[release, manifest, {'sha': manifest['sourceCommit']}]):
            result = installer.load_release('backend', 'latest', target, self.directory)
        self.assertEqual(result['version'], '1.10.0')
        self.assertEqual(result['artifact']['size'], 123)

    def test_rejects_unpublished_or_prerelease_at_discovery(self):
        for field, value in [('draft', True), ('prerelease', True), ('tag_name', 'nightly'), ('published_at', None)]:
            release, manifest, target = self.release_fixture()
            release[field] = value
            with patch.object(installer, 'fetch_json', side_effect=[release, manifest, {'sha': 'b' * 40}]), self.assertRaises(ValueError):
                installer.load_release('backend', 'latest', target, self.directory)

    def test_rejects_valid_commit_hash_that_does_not_match_official_tag(self):
        release, manifest, target = self.release_fixture()
        with patch.object(installer, 'fetch_json', side_effect=[release, manifest, {'sha': 'c' * 40}]), self.assertRaisesRegex(ValueError, 'source commit'):
            installer.load_release('backend', 'latest', target, self.directory)

    def test_rejects_manifest_tampering_and_missing_artifacts(self):
        for field, value in [('sourceCommit', 'short'), ('releaseId', 99), ('version', '1.11.0'), ('updaterProtocol', 2), ('artifacts', [])]:
            release, manifest, target = self.release_fixture()
            manifest[field] = value
            with patch.object(installer, 'fetch_json', side_effect=[release, manifest, {'sha': 'b' * 40}]), self.assertRaises(ValueError):
                installer.load_release('backend', 'latest', target, self.directory)


class InstallationSpaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.staging = self.directory / 'staging'
        self.staging.mkdir()
        self.install_parent = self.directory / 'opt'
        self.install_parent.mkdir()
        self.root = self.install_parent / 'rustdesk-console'
        for replacement in [patch.object(installer, 'ROOT', self.root),
                            patch.object(installer, 'filesystem_block_size', return_value=4096)]:
            replacement.start()
            self.addCleanup(replacement.stop)
        self.bundles = {}
        for component in ['backend', 'web']:
            bundle = self.staging / component
            bundle.mkdir()
            (bundle / 'app').write_bytes(b'fixture')
            self.bundles[component] = bundle

    def usage(self, free):
        return SimpleNamespace(free=free)

    def test_small_filesystem_accepts_measured_bundles_below_eight_gib(self):
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(128 * 1024 * 1024)) as usage:
            installer.require_installation_space(self.bundles)
        usage.assert_called_once_with(self.install_parent)
        self.assertFalse(self.root.exists())

    def test_final_copy_reserves_both_components_and_allocation_rounding(self):
        # Each bundle needs a directory block plus one block for its tiny file.
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(installer.SPACE_HEADROOM + 3 * 4096)):
            with self.assertRaisesRegex(ValueError, 'installing the complete backend and web bundles'):
                installer.require_installation_space(self.bundles)
        self.assertFalse(self.root.exists())

    def test_shared_filesystem_peak_includes_existing_staging_bytes(self):
        staged_bytes = 4 * 4096
        downloaded_bytes = 2 * 4096
        final_copy_bytes = 4 * 4096
        initial_free = installer.SPACE_HEADROOM + staged_bytes + downloaded_bytes + final_copy_bytes
        current_free = initial_free - staged_bytes - downloaded_bytes
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(current_free)):
            installer.require_installation_space(self.bundles)
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(current_free - 1)):
            with self.assertRaisesRegex(ValueError, 'Insufficient free space'):
                installer.require_installation_space(self.bundles)

    def test_separate_destination_filesystem_does_not_reserve_staging_again(self):
        def usage(path):
            available = installer.SPACE_HEADROOM + 4 * 4096 if path == self.install_parent else 0
            return self.usage(available)
        with patch.object(installer.shutil, 'disk_usage', side_effect=usage) as checked:
            installer.require_installation_space(self.bundles)
        checked.assert_called_once_with(self.install_parent)

    def test_checks_existing_parent_before_creating_destination(self):
        destination = self.directory / 'missing' / 'nested' / 'file'
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(installer.SPACE_HEADROOM + 7)) as checked:
            installer.require_space(destination, 7, 'test allocation')
        checked.assert_called_once_with(self.directory)
        self.assertFalse(destination.parent.exists())

    def test_download_refuses_before_network_access_or_file_creation(self):
        destination = self.staging / 'archive.tar.gz'
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(installer.SPACE_HEADROOM)), \
                patch.object(installer.urllib.request, 'build_opener') as opener:
            with self.assertRaisesRegex(ValueError, 'downloading an official artifact'):
                installer.download('https://github.com/databk/rustdesk-console/archive.tar.gz', destination, 1)
        opener.assert_not_called()
        self.assertFalse(destination.exists())

    def test_expansion_reserves_parent_directories_before_writing(self):
        archive = self.staging / 'bundle.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            entry = tarfile.TarInfo('nested/app')
            entry.size = 1
            bundle.addfile(entry, io.BytesIO(b'a'))
        destination = self.staging / 'expanded'
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(installer.SPACE_HEADROOM + 3 * 4096 - 1)):
            with self.assertRaisesRegex(ValueError, 'expanding a verified bundle'):
                installer.extract_bundle(archive, destination)
        self.assertFalse(destination.exists())

    def test_expansion_uses_actual_contents_at_exact_space_boundary(self):
        archive = self.staging / 'bundle.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            entry = tarfile.TarInfo('nested/app')
            entry.size = 1
            bundle.addfile(entry, io.BytesIO(b'a'))
        destination = self.staging / 'expanded'
        with patch.object(installer.shutil, 'disk_usage', return_value=self.usage(installer.SPACE_HEADROOM + 3 * 4096)):
            installer.extract_bundle(archive, destination)
        self.assertEqual((destination / 'nested/app').read_bytes(), b'a')


if __name__ == '__main__':
    unittest.main()
