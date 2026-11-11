"""All installation tests use a temporary data directory; no desktop is changed."""
import contextlib
import gettext
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('extension_project', ROOT / 'project.py')
project = importlib.util.module_from_spec(spec)
spec.loader.exec_module(project)


class ProjectTests(unittest.TestCase):
    def test_setup_preserves_other_extensions_and_enables_project(self):
        import install_utils
        state = {'enabled-extensions': ['unrelated@example', 'lunarcal@ailin.nemui'],
                 'disabled-extensions': ['lunar-calendar@system.local']}
        writes = []
        with patch.object(install_utils, 'read_shell_state', return_value=state), \
                patch.object(install_utils, 'write_shell_state', side_effect=writes.append), \
                patch.object(project, 'assert_target'), patch.object(project, 'install') as install, \
                contextlib.redirect_stdout(io.StringIO()):
            project.setup()
        install.assert_called_once()
        self.assertEqual(writes[-1]['enabled-extensions'], ['unrelated@example', 'lunar-calendar@system.local'])
        self.assertEqual(writes[-1]['disabled-extensions'], ['lunarcal@ailin.nemui'])

    def test_setup_failure_restores_extension_enable_lists(self):
        import install_utils
        state = {'enabled-extensions': ['unrelated@example', 'lunar-calendar@system.local'],
                 'disabled-extensions': ['other@example']}
        writes = []
        with patch.object(install_utils, 'read_shell_state', return_value=state), \
                patch.object(install_utils, 'write_shell_state', side_effect=writes.append), \
                patch.object(project, 'assert_target'), \
                patch.object(project, 'install', side_effect=RuntimeError('fixture failure')):
            with self.assertRaisesRegex(RuntimeError, 'fixture failure'):
                project.setup()
        self.assertEqual(writes[-1], state)

    def test_translation_roundtrip_and_fuzzy(self):
        with tempfile.TemporaryDirectory() as tmp:
            po, mo = Path(tmp) / 'test.po', Path(tmp) / 'test.mo'
            po.write_text('msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8\\n"\n\n'
                          'msgid "CPU"\nmsgstr "处理器"\n\n'
                          '#, fuzzy\nmsgid "RAM"\nmsgstr "内存"\n\n')
            project.compile_po(po, mo)
            with mo.open('rb') as stream:
                translation = gettext.GNUTranslations(stream)
            self.assertEqual(translation.gettext('CPU'), '处理器')
            self.assertEqual(translation.gettext('RAM'), 'RAM')

    def test_unsupported_po_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            po, mo = Path(tmp) / 'test.po', Path(tmp) / 'test.mo'
            po.write_text('msgid "disk"\nmsgid_plural "disks"\n')
            with self.assertRaises(ValueError):
                project.compile_po(po, mo)

    def test_staging_contains_root_metadata_and_no_compiled_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / 'extension'
            project.stage(staged)
            self.assertTrue((staged / 'metadata.json').is_file())
            self.assertFalse(list(staged.rglob('gschemas.compiled')))
            self.assertTrue((staged / 'LICENSE').is_file())
            self.assertNotEqual(project.metadata()['uuid'],
                                json.loads((ROOT / 'upstream.lock.json').read_text())['upstream_uuid'])

    def test_install_update_in_temporary_data_directory(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, XDG_DATA_HOME=tmp), \
                patch.object(project, 'assert_target'), \
                patch.object(project.subprocess, 'check_output', return_value='[]'), \
                contextlib.redirect_stdout(io.StringIO()):
            project.install()
            target = Path(tmp) / 'gnome-shell/extensions' / project.metadata()['uuid']
            self.assertTrue((target / 'schemas/gschemas.compiled').is_file())
            (target / 'old-marker').write_text('preserve in backup')
            project.install()
            backups = list((Path(tmp) / 'gnome-extension-project-backups' /
                            project.metadata()['uuid']).iterdir())
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / 'old-marker').read_text(), 'preserve in backup')
            self.assertFalse((target / 'old-marker').exists())

    def test_enabled_upstream_is_not_overwritten(self):
        upstream = json.loads((ROOT / 'upstream.lock.json').read_text())['upstream_uuid']
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, XDG_DATA_HOME=tmp), \
                patch.object(project, 'assert_target'), \
                patch.object(project.subprocess, 'check_output', return_value=repr([upstream])):
            with self.assertRaisesRegex(RuntimeError, 'Disable'):
                project.install()
            self.assertEqual(list(Path(tmp).iterdir()), [])


    def test_runtime_detection_accepts_both_target_systems(self):
        with patch.object(project.os, 'geteuid', return_value=1000):
            for version, major in [('43.9', '43'), ('48.7', '48'), ('51.1', '51')]:
                with self.subTest(version=version), patch.object(project.subprocess, 'check_output', return_value='GNOME Shell ' + version):
                    self.assertEqual(project.assert_target(), major)
            for version in ['42.9', '49.0', '50.0', '52.0']:
                with self.subTest(version=version), patch.object(project.subprocess, 'check_output', return_value='GNOME Shell ' + version):
                    with self.assertRaisesRegex(RuntimeError, '43, 48, 51'):
                        project.assert_target()

    def test_shared_package_declares_the_reviewed_targets(self):
        self.assertEqual(project.metadata()['shell-version'], ['48', '51'])
        self.assertEqual(json.loads((ROOT / 'compatibility.json').read_text())['package_shell_versions']['modern'], ['48', '51'])

    def test_legacy_stage_selects_a_real_legacy_loader(self):
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / 'extension'
            project.stage(staged, '43')
            self.assertEqual(json.loads((staged / 'metadata.json').read_text())['shell-version'], ['43'])
            self.assertIn('function init()', (staged / 'extension.js').read_text())
            self.assertNotIn('export default', (staged / 'extension.js').read_text())
            self.assertIn('vertical: true', (staged / 'dateMenu43.js').read_text())

    def test_install_detects_legacy_target(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, XDG_DATA_HOME=tmp), \
                patch.object(project, 'assert_target', return_value='43'), \
                patch.object(project.subprocess, 'check_output', return_value='[]'), \
                contextlib.redirect_stdout(io.StringIO()):
            project.install()
            target = Path(tmp) / 'gnome-shell/extensions' / project.metadata()['uuid']
            self.assertEqual(json.loads((target / 'metadata.json').read_text())['shell-version'], ['43'])
            self.assertTrue((target / 'calendarBundle.js').is_file())


if __name__ == '__main__':
    unittest.main()
