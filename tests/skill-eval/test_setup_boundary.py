"""Setup audit effects stay inside the supplied synthetic case directory."""
import tempfile
from pathlib import Path
import unittest
import json
import subprocess

from setup_support import safe_path, config_args, init_blocked, parse_action, validate_config_write


class SetupBoundaryTest(unittest.TestCase):
    def test_configuration_writes_are_data_only_and_never_connections(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'project/.bakers/project.config.js'
            validate_config_write(root, path, 'export default {"project":{"name":"demo"},"hooks":{"provision_up":{"test":"echo demo"}}};')
            validate_config_write(root, root / 'machine/machine.config.js', 'export default {"tunnel":true};')
            for content in ["export default {project: {name: 'demo'}};", 'export default (() => process.exit())();', 'export default {}; console.log("side effect");', 'export default [];', 'export default {"x":NaN};']:
                with self.subTest(content=content), self.assertRaises(ValueError):
                    validate_config_write(root, path, content)
            for target in ['machine/connections/default.js', 'project/scripts/run.js', '../outside.js']:
                with self.subTest(target=target), self.assertRaises(ValueError):
                    validate_config_write(root, root / target, 'export default {};')

    def test_action_transport_accepts_one_literal_request_not_multiple(self):
        self.assertEqual(parse_action('<invoke name="command"><parameter name="argv">["bakers","config","check"]</parameter></invoke>'),
                         {'type': 'command', 'argv': ['bakers', 'config', 'check']})
        for text in ['{}', '{"type":"shell","command":"anything"}', '<invoke name="question"/><invoke name="question"/>']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_action(text)

    def test_action_with_wrongly_typed_field_is_refused_not_a_crash(self):
        for text in ['{"type":"command","argv":5}', '{"type":"command","argv":["git",3]}', '{"type":"read","path":["a"]}']:
            with self.assertRaises(ValueError):
                parse_action(text)

    def test_direct_write_blocks_initialization_of_that_scope_only(self):
        machine = ['config', 'init', '--scope', 'machine']
        self.assertTrue(init_blocked({'machine'}, machine))
        self.assertTrue(init_blocked({'machine'}, ['config', 'init', '--scope', 'all']))
        self.assertFalse(init_blocked({'machine'}, ['config', 'init', '--scope', 'connection']))
        self.assertFalse(init_blocked({'machine'}, ['config', 'init', '--scope', 'project']))
        self.assertFalse(init_blocked({'machine'}, machine + ['--dry-run']))
        self.assertFalse(init_blocked(set(), machine))
        self.assertFalse(init_blocked({'machine'}, ['config', 'check', '--scope', 'machine']))

    def test_real_cli_preserves_identity_on_repeat_and_honors_custom_path(self):
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'project').mkdir()
            args = config_args(root, ['bakers', 'config', 'init', '--scope', 'machine',
                                     '--machine-path', 'machine/custom.js', '--label', 'chosen-worker'])
            command = ['node', '--import', str(repo / 'bakers-cli/node_modules/tsx/dist/loader.mjs'), str(repo / 'tests/skill-eval/setup-config.mjs'), str(root), json.dumps(args)]
            first = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(first.returncode, 0, first.stderr)
            saved = (root / 'machine/custom.js').read_text()
            self.assertIn("label: 'chosen-worker'", saved)
            second = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual((root / 'machine/custom.js').read_text(), saved)
            self.assertFalse((root / 'machine/machine.config.js').exists())

    def test_paths_cannot_escape_including_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'case'
            root.mkdir()
            (root / 'escape').symlink_to(root.parent, target_is_directory=True)
            for path in ['../outside', '/etc/passwd', 'escape/outside']:
                with self.subTest(path=path), self.assertRaises(ValueError):
                    safe_path(root, path)
            self.assertEqual(safe_path(root, 'project/WORKFLOW.md'), root / 'project/WORKFLOW.md')

    def test_only_local_config_commands_and_case_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args = config_args(root, ['bakers', 'config', 'init', '--scope', 'machine', '--label', 'test-worker'])
            self.assertIn('test-worker', args)
            for argv in [
                ['bakers', 'auth', 'login'],
                ['bakers', 'conductor', 'start'],
                ['bakers', 'config', 'init', '--scope', 'all', '--config', '/etc/connection.js'],
                ['bakers', 'config', 'init', '--scope', 'connection', '--secret-env', 'REAL_TOKEN'],
                ['bakers', 'config', 'init', '--scope', 'connection', '--base-url', 'https://production.example'],
                ['bakers', 'config', 'check', '--online'],
            ]:
                with self.subTest(argv=argv), self.assertRaises(ValueError):
                    config_args(root, argv)


if __name__ == '__main__':
    unittest.main()
