"""Exercise the public stdio tool boundary with synthetic records and no model calls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class ToolServerTests(unittest.TestCase):
    def test_seeded_comments_are_read_with_their_ticket(self):
        spec = importlib.util.spec_from_file_location('tool_server', HERE / 'tool-server.py')
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        ticket = '11111111-1111-4111-8111-111111111111'
        seeded = {'id': '77777777-7777-4777-8777-000000000001', 'bb_comment_type': 'qualification',
                  'body': {'value': 'Handoff', 'format': 'bb_rich'},
                  'relationships': {'ticket_id': {'data': {'type': 'bb_ticket--bb_ticket', 'id': ticket}}}}
        simulation = server.Simulation({'simulation': {'ticket': {'id': ticket, 'state': 'plan'}, 'comments': [seeded]}})
        read = simulation.call('bakers', {'argv': ['bakers', 'dropsh', 'read', f'bb_ticket/bb_ticket/{ticket}', '--include', 'comments']})
        included = json.loads(read['stdout'])['included']
        self.assertEqual([(c['id'], c['attributes']['bb_comment_type']) for c in included], [(seeded['id'], 'qualification')])

    def test_comment_call_preserves_markdown_and_readback_without_running_commands(self):
        body = '-- leading dash\n\n`code` $HOME $(touch /tmp/not-executed) "quoted"\n\n'
        ticket = '11111111-1111-4111-8111-111111111111'
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            fixture = directory / 'fixture.json'
            trace = directory / 'trace.jsonl'
            fixture.write_text(json.dumps({'input': {'project_uuid': '55555555-5555-4555-8555-555555555555', 'workspace_uuid': '66666666-6666-4666-8666-666666666666'},
                'simulation': {'ticket': {'id': ticket, 'state': 'coding'}, 'files': {'/fixture/body.md': body}}}))
            argv = ['bakers', 'dropsh', 'create', 'bb_comment', '--bundle', 'bb_comment',
                    '--body.value='+body, '--body.format', 'bb_rich', '--bb_comment_type', 'coding', '--ticket_id', ticket]
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05'}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
                {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'read_file', 'arguments': {'path': '/fixture/body.md'}}},
                {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': {'name': 'bakers', 'arguments': {'argv': argv}}},
                {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/call', 'params': {'name': 'bakers', 'arguments': {'argv': ['bakers', 'dropsh', 'read', 'bb_comment/bb_comment/22222222-2222-4222-8222-000000000001']}}},
                {'jsonrpc': '2.0', 'id': 6, 'method': 'tools/call', 'params': {'name': 'bakers', 'arguments': {'argv': ['bash', '-c', 'exit 0']}}},
                {'jsonrpc': '2.0', 'id': 7, 'method': 'tools/call', 'params': {'name': 'read_file', 'arguments': {'path': '/etc/passwd'}}},
                {'jsonrpc': '2.0', 'id': 8, 'method': 'tools/call', 'params': {'name': 'bakers', 'arguments': {'argv': ['bakers', 'dropsh', 'read', 'bb_ticket/bb_ticket/'+ticket, '--invented-flag', 'yes']}}},
                {'jsonrpc': '2.0', 'id': 9, 'method': 'tools/call', 'params': {'name': 'bakers', 'arguments': {'argv': ['bakers', 'info']}}},
            ]
            result = subprocess.run([sys.executable, '-B', str(HERE/'tool-server.py'), '--fixture', str(fixture), '--trace', str(trace)],
                input='\n'.join(json.dumps(r) for r in requests)+'\n', capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual({t['name'] for t in responses[1]['result']['tools']}, {'bakers', 'read_file'})
            readback = json.loads(responses[4]['result']['content'][0]['text'])
            self.assertEqual(json.loads(readback['stdout'])['data']['attributes']['body']['value'], body)
            self.assertEqual(json.loads(responses[5]['result']['content'][0]['text'])['exit_code'], 2)
            self.assertEqual(json.loads(responses[6]['result']['content'][0]['text'])['exit_code'], 2)
            unknown = json.loads(responses[7]['result']['content'][0]['text'])
            self.assertEqual((unknown['exit_code'], unknown['stderr']), (1, "error: unknown option '--invented-flag'\n"))
            info = json.loads(responses[8]['result']['content'][0]['text'])
            self.assertEqual(info['exit_code'], 0)
            self.assertEqual(json.loads(info['stdout'])['workspace_id'], '66666666-6666-4666-8666-666666666666')
            self.assertEqual(json.loads(info['stdout'])['project_id'], '55555555-5555-4555-8555-555555555555')
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertEqual(len(calls), 7)
            self.assertEqual(calls[1]['arguments']['argv'], argv)
            self.assertEqual(calls[2]['result'], readback)


class DeclaredCommandTests(unittest.TestCase):
    def test_only_fixture_declared_literal_commands_are_available(self):
        spec = importlib.util.spec_from_file_location('server', HERE / 'tool-server.py')
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        response = {'exit_code': 1, 'stdout': '', 'stderr': ''}
        fixture = {'simulation': {'commands': {'git': [
            {'argv': ['git', 'grep', '-nEi', 'invoice|invoices', 'origin/develop', '--', 'docs'], 'result': response}
        ]}}}
        sim = server.Simulation(fixture)
        argv = fixture['simulation']['commands']['git'][0]['argv']
        self.assertEqual(sim.call('git', {'argv': argv}), response)
        self.assertEqual({t['name'] for t in sim.tools}, {'bakers', 'read_file', 'git'})
        for tool, args in [('git', ['git', 'status']), ('glab', ['glab', 'mr', 'merge', '1']), ('bash', ['bash', '-c', 'true'])]:
            self.assertEqual(sim.call(tool, {'argv': args})['exit_code'], 2)
        fixture['simulation']['commands']['glab'] = [
            {'argv': ['glab', 'mr', 'view', '30'], 'before_merge': {'exit_code': 0, 'stdout': 'open', 'stderr': ''},
             'result': {'exit_code': 0, 'stdout': 'merged', 'stderr': ''}},
            {'argv': ['glab', 'mr', 'merge', '30'], 'result': {'exit_code': 0, 'stdout': 'ok', 'stderr': ''}},
        ]
        sim = server.Simulation(fixture)
        self.assertEqual(sim.call('glab', {'argv': ['glab', 'mr', 'view', '30']})['stdout'], 'open')
        sim.call('glab', {'argv': ['glab', 'mr', 'merge', '30']})
        self.assertEqual(sim.call('glab', {'argv': ['glab', 'mr', 'view', '30']})['stdout'], 'merged')
        ordinary = server.Simulation({'simulation': {}})
        self.assertEqual({t['name'] for t in ordinary.tools}, {'bakers', 'read_file'})
        self.assertEqual(ordinary.call('git', {'argv': argv})['exit_code'], 2)

class LocalGitSemanticsTests(unittest.TestCase):
    def test_remote_search_distinguishes_empty_unknown_reverted_and_own_ticket(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            remote, work = root / 'remote.git', root / 'work'
            def git(*argv, cwd=None, code=0):
                r = subprocess.run(['git', *argv], cwd=cwd, text=True, capture_output=True, timeout=10)
                self.assertEqual(r.returncode, code, r.stderr)
                return r.stdout.strip()
            git('init', '--bare', str(remote))
            git('clone', str(remote), str(work))
            git('config', 'user.email', 'fixture@example.invalid', cwd=work)
            git('config', 'user.name', 'Fixture', cwd=work)
            git('checkout', '-b', 'develop', cwd=work)
            (work / 'docs').mkdir()
            guide = work / 'docs/README.md'
            guide.write_text('Guide\n')
            git('add', '.', cwd=work)
            git('commit', '-m', 'Guide', cwd=work)
            before = git('rev-parse', 'HEAD', cwd=work)
            guide.write_text('Guide\nInvoice export: export --project NAME\n')
            git('commit', '-am', 'Document invoice export\n\nref:EVAL-70', cwd=work)
            candidate = git('rev-parse', 'HEAD', cwd=work)
            git('push', 'origin', 'develop', cwd=work)
            git('fetch', 'origin', '--quiet', cwd=work)
            self.assertIn('Invoice export', git('grep', '-nEi', 'invoice|invoices', 'origin/develop', '--', 'docs', cwd=work))
            self.assertIn('ref:EVAL-70', git('log', '-1', candidate, '--format=%h %s%n%b', cwd=work))
            self.assertIn('README.md', git('diff', '--stat', before+'..origin/develop', cwd=work))
            git('revert', '--no-edit', candidate, cwd=work)
            git('push', 'origin', 'develop', cwd=work)
            git('fetch', 'origin', '--quiet', cwd=work)
            self.assertEqual(git('diff', '--stat', before+'..origin/develop', cwd=work), '')
            git('grep', '-nEi', 'invoice|invoices', 'origin/develop', '--', 'docs', cwd=work, code=1)
            self.assertIn(':1', git('grep', '-c', 'Guide', 'origin/develop', '--', 'docs', cwd=work))
            git('grep', '-nEi', 'invoice|invoices', 'origin/missing', '--', 'docs', cwd=work, code=128)
            self.assertEqual(git('log', '--oneline', 'origin/develop', '--since=2030-01-01T00:00:00Z', cwd=work), '')
            guide.write_text('Guide\nInvoice export draft\n')
            git('commit', '-am', 'Own work\n\nref:EVAL-30', cwd=work)
            self.assertIn('ref:EVAL-30', git('log', '-1', 'HEAD', '--format=%h %s%n%b', cwd=work))


if __name__ == '__main__':
    unittest.main()
