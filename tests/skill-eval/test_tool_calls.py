"""Exercise the public stdio tool boundary with synthetic records and no model calls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def load_server():
    spec = importlib.util.spec_from_file_location('tool_server', HERE / 'tool-server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    return server


TOOL = ['bakers', 'tools']


class ToolServerTests(unittest.TestCase):
    def test_tools_accept_selectors_around_the_command(self):
        simulation = load_server().Simulation({'simulation': {}})
        selected = simulation.call('bakers', {'argv': ['bakers', '--connection', 'work', 'tools', '--auth-profile=worker']})
        plain = simulation.call('bakers', {'argv': TOOL})
        self.assertEqual(selected, plain)

    def test_a_relative_path_reads_the_same_virtual_file(self):
        simulation = load_server().Simulation({'simulation': {'files': {'WORKFLOW.md': '# Project'}}})
        self.assertEqual(simulation.call('read_file', {'path': './WORKFLOW.md'}), simulation.call('read_file', {'path': 'WORKFLOW.md'}))
        self.assertEqual(simulation.call('read_file', {'path': './WORKFLOW.md'})['stdout'], '# Project')

    def test_seeded_comments_are_read_with_their_ticket(self):
        server = load_server()
        ticket = '11111111-1111-4111-8111-111111111111'
        seeded = {'id': '77777777-7777-4777-8777-000000000001', 'ticket': ticket, 'type': 'qualification', 'body': 'Handoff'}
        simulation = server.Simulation({'simulation': {'ticket': {'id': ticket, 'identifier': 'EVAL-20', 'title': 'T', 'workflow': 'bb_work', 'state': 'plan'}, 'comments': [seeded]}})
        read = simulation.call('bakers', {'argv': TOOL + ['tool_api__bakers_ticket_read', '--data', '{"ticket": "EVAL-20"}']})
        self.assertEqual([(c['id'], c['type']) for c in json.loads(read['stdout'])['comments']], [(seeded['id'], 'qualification')])

    def test_jsonapi_commands_are_outside_the_contract_and_bare_names_mean_the_wire_name(self):
        simulation = load_server().Simulation({'simulation': {'ticket': {'id': 'x', 'identifier': 'EVAL-20', 'state': 'plan'}}})
        for verb in ['read', 'search', 'create', 'update', 'delete', 'schema', 'tool']:
            rejected = simulation.call('bakers', {'argv': ['bakers', 'dropsh', verb, 'bb_ticket/bb_ticket/x']})
            self.assertEqual(rejected['exit_code'], 2)
            self.assertIn('not part of the skill contract', rejected['stderr'])
        bare = simulation.call('bakers', {'argv': TOOL + ['bakers_ticket_read', '--data', '{"ticket": "EVAL-20"}']})
        wire = simulation.call('bakers', {'argv': TOOL + ['tool_api__bakers_ticket_read', '--data', '{"ticket": "EVAL-20"}']})
        self.assertEqual(bare, wire)
        unknown = simulation.call('bakers', {'argv': TOOL + ['bakers_ticket_frobnicate']})
        self.assertEqual((unknown['exit_code'], json.loads(unknown['stderr'])['error']['code']), (4, 'E_VALIDATION'))
        invalid = simulation.call('bakers', {'argv': TOOL + ['tool_api__bakers_ticket_read', '--data', '{"tick": "EVAL-20"}']})
        self.assertEqual(invalid['exit_code'], 4)
        refused = simulation.call('bakers', {'argv': TOOL + ['tool_api__bakers_ticket_read', '--data', '{"ticket": "EVAL-404"}']})
        self.assertEqual((refused['exit_code'], json.loads(refused['stderr'])['error']['code']), (1, 'E_TOOL'))

    def test_comment_call_preserves_markdown_from_a_written_arguments_file_without_running_commands(self):
        body = '-- leading dash\n\n`code` $HOME $(touch /tmp/not-executed) "quoted"\n\n'
        ticket = '11111111-1111-4111-8111-111111111111'
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            fixture = directory / 'fixture.json'
            trace = directory / 'trace.jsonl'
            fixture.write_text(json.dumps({'input': {'project_uuid': '55555555-5555-4555-8555-555555555555', 'workspace_uuid': '66666666-6666-4666-8666-666666666666'},
                'simulation': {'ticket': {'id': ticket, 'identifier': 'EVAL-20', 'title': 'T', 'workflow': 'bb_work', 'state': 'coding'}, 'files': {'/fixture/body.md': body}}}))
            argv = TOOL + ['tool_api__bakers_comment_publish', '--data', '@/tmp/args.json']
            call = lambda i, name, arguments: {'jsonrpc': '2.0', 'id': i, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05'}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
                call(3, 'read_file', {'path': '/fixture/body.md'}),
                call(4, 'write_file', {'path': '/tmp/args.json', 'content': json.dumps({'ticket': ticket, 'type': 'coding', 'body': body})}),
                call(5, 'bakers', {'argv': argv}),
                call(6, 'bakers', {'argv': TOOL + ['tool_api__bakers_ticket_read', '--param', 'ticket=' + ticket]}),
                call(7, 'bakers', {'argv': ['bash', '-c', 'exit 0']}),
                call(8, 'read_file', {'path': '/etc/passwd'}),
                call(9, 'write_file', {'path': '/fixture/body.md', 'content': 'overwritten'}),
                call(10, 'bakers', {'argv': TOOL + ['tool_api__bakers_ticket_read', '--invented-flag', 'yes']}),
                call(11, 'bakers', {'argv': ['bakers', 'info']}),
            ]
            result = subprocess.run([sys.executable, '-B', str(HERE/'tool-server.py'), '--fixture', str(fixture), '--trace', str(trace)],
                input='\n'.join(json.dumps(r) for r in requests)+'\n', capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            text = lambda i: json.loads(responses[i]['result']['content'][0]['text'])
            self.assertEqual({t['name'] for t in responses[1]['result']['tools']}, {'bakers', 'read_file', 'write_file'})
            self.assertEqual(json.loads(text(4)['stdout']), {'id': '22222222-2222-4222-8222-000000000001', 'type': 'coding'})
            self.assertEqual(json.loads(text(5)['stdout'])['comments'][0]['body'], body)
            self.assertEqual(text(6)['exit_code'], 2)
            self.assertEqual(text(7)['exit_code'], 2)
            self.assertEqual(text(8)['exit_code'], 2)
            self.assertEqual((text(9)['exit_code'], text(9)['stderr']), (1, "error: unknown option '--invented-flag'\n"))
            info = text(10)
            self.assertEqual(info['exit_code'], 0)
            self.assertEqual(json.loads(info['stdout'])['workspace_id'], '66666666-6666-4666-8666-666666666666')
            self.assertEqual(json.loads(info['stdout'])['project_id'], '55555555-5555-4555-8555-555555555555')
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertEqual(len(calls), 9)
            self.assertEqual(calls[2]['arguments']['argv'], argv)
            self.assertEqual(calls[3]['result'], text(5))


class DeclaredCommandTests(unittest.TestCase):
    def test_only_fixture_declared_literal_commands_are_available(self):
        server = load_server()
        response = {'exit_code': 1, 'stdout': '', 'stderr': ''}
        fixture = {'simulation': {'commands': {'git': [
            {'argv': ['git', 'grep', '-nEi', 'invoice|invoices', 'origin/develop', '--', 'docs'], 'result': response}
        ]}}}
        sim = server.Simulation(fixture)
        argv = fixture['simulation']['commands']['git'][0]['argv']
        self.assertEqual(sim.call('git', {'argv': argv}), response)
        self.assertEqual({t['name'] for t in sim.tools}, {'bakers', 'read_file', 'write_file', 'git'})
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
        self.assertEqual({t['name'] for t in ordinary.tools}, {'bakers', 'read_file', 'write_file'})
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
