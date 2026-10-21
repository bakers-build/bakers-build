"""Protect the harness's isolation and fail-closed verdict handling, without model calls."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("worker.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def stream(tools=None, blocks=None):
    return "\n".join(json.dumps(event) for event in [
        {"type": "system", "subtype": "init", "tools": tools or [], "mcp_servers": [],
         "skills": [], "permissionMode": "dontAsk", "model": "test-model", "claude_code_version": "test-version"},
        {"type": "assistant", "message": {"content": blocks or []}},
        {"type": "result", "subtype": "success", "is_error": False, "result": "artifact"},
    ])


class RunnerTests(unittest.TestCase):
    def test_worker_has_no_tools_or_discovered_customizations(self):
        command = runner.command("system")
        for flag in ["--tools", "--setting-sources"]:
            self.assertEqual(command[command.index(flag) + 1], "")
        self.assertIn("--safe-mode", command)
        self.assertIn("--strict-mcp-config", command)
        self.assertIn("--no-session-persistence", command)

    def test_rejects_tool_availability_and_calls(self):
        self.assertEqual(runner.read_stream(stream())[0], "artifact")
        for raw in [stream(tools=["Bash"]), stream(blocks=[{"type": "tool_use"}]), ""]:
            with self.assertRaises(ValueError):
                runner.read_stream(raw)

    def test_rubric_requires_complete_unique_boolean_checks(self):
        criteria = [{"id": "actor"}, {"id": "mode"}]
        good = [{"id": name, "met": True, "reason": "observed", "quote": "actor"}
                for name in ["actor", "mode"]]
        self.assertEqual(runner.parse_grade(json.dumps({"checks": good}), criteria, "actor"), good)
        for checks in [good[:1], [good[0], good[0]], [dict(good[0], met="true"), good[1]],
                       [dict(good[0], quote="invented"), good[1]]]:
            with self.assertRaises(ValueError):
                runner.parse_grade(json.dumps({"checks": checks}), criteria, "actor")

    def test_missing_model_and_provider_errors_are_execution_errors(self):
        for raw in [stream().replace('"test-model"', 'null'),
                    stream().replace('"is_error": false', '"is_error": true'),
                    stream().replace('"artifact"', '""'), '{malformed']:
            with self.assertRaises(ValueError):
                runner.read_stream(raw)

    def test_tool_mode_requires_exact_server_tools_and_independent_call_trace(self):
        call = {"type": "tool_use", "id": "call-1", "name": "mcp__fixture__bakers", "input": {"argv": ["bakers", "dropsh", "read", "bb_ticket/bb_ticket/id"]}}
        raw = stream(tools=["mcp__fixture__bakers", "mcp__fixture__read_file"], blocks=[call])
        raw = raw.replace('"mcp_servers": []', '"mcp_servers": [{"name":"fixture","status":"connected"}]')
        trace = [{"tool": "bakers", "arguments": call['input'], "result": {"exit_code": 0}}]
        self.assertEqual(runner.read_stream(raw, tool_trace=trace)[0], "artifact")
        self.assertEqual(runner.read_stream(raw.replace('"status":"connected"', '"status":"connected","source":"dynamic"'), tool_trace=trace)[0], "artifact")
        for changed in [[], [{**trace[0], "arguments": {"argv": ["wrong"]}}]]:
            with self.assertRaises(ValueError):
                runner.read_stream(raw, tool_trace=changed)
        with self.assertRaises(ValueError):
            runner.read_stream(raw.replace('"mcp__fixture__read_file"', '"Bash"'), tool_trace=trace)

    def test_optional_tools_are_bound_to_the_selected_fixture(self):
        fixture = {'simulation': {'commands': {'git': []}}}
        names = ['mcp__fixture__bakers', 'mcp__fixture__read_file', 'mcp__fixture__git']
        raw = stream(tools=names).replace('"mcp_servers": []', '"mcp_servers": [{"name":"fixture","status":"connected"}]')
        self.assertEqual(runner.read_stream(raw, tool_trace=[], fixture=fixture)[0], 'artifact')
        with self.assertRaises(ValueError):
            runner.read_stream(raw, tool_trace=[])
        with self.assertRaises(ValueError):
            runner.read_stream(raw.replace('mcp__fixture__git', 'Bash'), tool_trace=[], fixture=fixture)
        with self.assertRaises(ValueError):
            runner.read_stream(raw, tool_trace=[], fixture={'simulation': {'commands': {'bash': []}}})

    def test_generation_records_measured_worker_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cli = directory / 'claude'
            cli.write_text(f'#!{sys.executable}\nimport time\ntime.sleep(0.05)\nprint({stream()!r})\n')
            cli.chmod(0o755)
            output = directory / 'attempt'
            output.mkdir()
            env = dict(os.environ, PATH=str(directory) + os.pathsep + os.environ['PATH'])
            result = subprocess.run([sys.executable, '-B', str(runner.HERE / 'skill-worker.py'),
                                     'generate', '--input', str(runner.HERE / 'fixtures/missing-account.json'),
                                     '--output', str(output)], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            worker = json.loads((output / 'generation.json').read_text())['worker']
            self.assertIsInstance(worker['elapsed_ms'], int)
            self.assertGreaterEqual(worker['elapsed_ms'], 50)

    def test_generation_snapshot_can_start_the_fixture_server(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cli = directory / 'claude'
            raw = stream(tools=['mcp__fixture__bakers', 'mcp__fixture__read_file']).replace('"mcp_servers": []', '"mcp_servers": [{"name":"fixture","status":"connected"}]')
            cli.write_text(f'#!{sys.executable}\nimport json, subprocess, sys\na=sys.argv\nc=json.loads(a[a.index("--mcp-config")+1])["mcpServers"]["fixture"]\nr=subprocess.run([c["command"], *c["args"]], input="", text=True, capture_output=True)\nif r.returncode: print(r.stderr, file=sys.stderr); sys.exit(r.returncode)\nprint({raw!r})\n')
            cli.chmod(0o755)
            output = directory / 'attempt'
            output.mkdir()
            env = dict(os.environ, PATH=str(directory) + os.pathsep + os.environ['PATH'])
            result = subprocess.run([sys.executable, '-B', str(runner.HERE / 'skill-worker.py'),
                                     'generate', '--input', str(runner.HERE / 'fixtures/publish-comment-calls.json'),
                                     '--output', str(output)], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, (output / 'generation.json').read_text())

    def test_bridge_retains_provider_failure_as_execution_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cli = directory / 'claude'
            failure = stream().replace('"is_error": false', '"is_error": true')
            cli.write_text(f'#!{sys.executable}\nprint({failure!r})\n')
            cli.chmod(0o755)
            output = directory / 'attempt'
            output.mkdir()
            env = dict(os.environ, PATH=str(directory) + os.pathsep + os.environ['PATH'])
            result = subprocess.run([sys.executable, '-B', str(runner.HERE / 'skill-worker.py'),
                                     'generate', '--input', str(runner.HERE / 'fixtures/run-outtake-coding.json'),
                                     '--output', str(output)], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 2, result.stderr)
            record = json.loads((output / 'generation.json').read_text())
            self.assertEqual(record['status'], 'error')
            self.assertIn('successful final result', record['error'])
            self.assertTrue((output / 'worker/stream.jsonl').is_file())
            self.assertNotIn('output', record)



if __name__ == "__main__":
    unittest.main()
