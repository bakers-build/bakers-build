#!/usr/bin/env python3
"""Run a bounded synthetic setup conversation in a herdr pane, retaining every turn.

The model has no native tools. Literal action requests pass through a closed boundary;
only local config commands and data-only file writes can affect the case directory.
External observations are explicitly supplied fixture doubles, never real operations.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import worker
from setup_support import safe_path, config_args, init_blocked, parse_action, validate_config_write

ROOT = worker.ROOT
SYSTEM = '''Apply the supplied setup skill and its documentation to the user request.
This is an isolated synthetic setup environment. You have no native tools; request exactly
one action per response as a JSON object, without markdown fences:
{"type":"question","text":"one question and any relevant explanation"}
{"type":"command","argv":["bakers","config",...]}
{"type":"read","path":"project/WORKFLOW.md"}
{"type":"write","path":"project/WORKFLOW.md","content":"..."}
{"type":"final","text":"honest report of results and remaining work"}
Command arguments are literal, never shell. Read supplied sources as already loaded.
Use relative paths under project/ or machine/ for synthetic files, or absolute paths
inside the supplied environment root. No files or login outside this environment exist.
Tools return actual local command output or clearly marked synthetic external observations.
Do not claim actions without successful results. You may write project/.bakers/project.config.js
and machine/machine.config.js as "export default " followed by a STRICT JSON object and semicolon.
Read existing files first and preserve unrelated values. No imports, expressions, functions or
other code are accepted. After a direct write to a machine or project config, config init of that scope is unavailable; offline checks
and declared synthetic checks remain available. Connection files must use the CLI.
Never invent user answers. Git check-ignore -v is supported in the project root;
bakers conductor check has a declared synthetic response, not real runtime verification.
No install, shell, hook, real login, clone or conductor operation will be executed.
Use English. Preserve the skill's conversation, scope and readiness requirements.'''


def encode(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def main():
    fixture_path, destination = map(Path, sys.argv[1:3])
    fixture = {**json.loads((fixture_path.parent / 'defaults.json').read_text()),
               **json.loads(fixture_path.read_text())}
    destination.mkdir()
    environment = destination.resolve() / 'environment'
    (environment / 'project').mkdir(parents=True)
    (environment / 'machine').mkdir()
    subprocess.run(['git', '-c', 'init.templateDir=', '-c', 'init.defaultBranch=main', 'init', '-q', str(environment / 'project')],
                   check=True, env={**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null'})
    for path, content in fixture.get('files', {}).items():
        target = safe_path(environment, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    for key in list(os.environ):
        if key.startswith(('BB_', 'BAKERS_')):
            del os.environ[key]
    sources = {path: (ROOT / path).read_text() for path in fixture['sources']}
    spec = importlib.util.spec_from_file_location('setup_tool_server', ROOT / 'tests/skill-eval/tool-server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    simulation = server.Simulation(fixture.get('server', {'simulation': {}}))
    (destination / 'fixture.json').write_text(encode(fixture))
    (destination / 'sources.json').write_text(encode(sources))
    history = [{'role': 'user', 'content': fixture['request']}]
    tools = []
    config_written = set()
    result = {'status': 'incomplete', 'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
              'source_hashes': {path: hashlib.sha256(content.encode()).hexdigest() for path, content in sources.items()},
              'turns': history, 'tools': tools, 'limitations': ['External operations are fixture doubles', 'Direct config writes accept JSON data only; CLI writes and offline checks are real', 'Each role receives full prior conversation via isolated worker calls']}
    result['runner_hashes'] = {name: hashlib.sha256((ROOT / 'tests/skill-eval' / name).read_bytes()).hexdigest()
                               for name in ['setup-conversation.py', 'setup_support.py', 'setup-config.mjs', 'worker.py', 'tool-server.py']}
    (destination / 'before.json').write_text(encode(fixture.get('files', {})))
    try:
        for step in range(fixture.get('max_turns', 24)):
            prompt = encode({'sources': sources, 'environment_root': str(environment), 'observations': fixture.get('observations', {}), 'conversation': history})
            output, metadata = worker.invoke(prompt, SYSTEM, destination / f'target-{step}', os.environ.get('SETUP_MODEL', 'sonnet'), 120)
            try:
                action = parse_action(output)
            except ValueError as error:
                history.extend([{'role': 'assistant', 'content': output, 'metadata': metadata},
                                {'role': 'tool', 'content': 'Nothing executed: ' + str(error) + '. Return exactly one JSON action without markup or commentary.'}])
                (destination / 'conversation.json').write_text(encode(history))
                continue
            history.append({'role': 'assistant', 'content': action, 'metadata': metadata})
            print(f"{fixture['id']} {step}: {encode(action).strip()}", flush=True)
            kind = action['type']
            if kind == 'final':
                result['status'] = 'completed'
                break
            if kind == 'question':
                mode = fixture.get('interaction', 'interactive')
                if mode in {'cancelled', 'unanswered', 'noninteractive'}:
                    reply = {'cancelled': 'Cancel setup now. Do not write anything further.',
                             'unanswered': '[No answer is available. Report the unresolved setup and stop.]',
                             'noninteractive': 'This run is unattended. No answer is available; report unresolved choices.'}[mode]
                else:
                    user_system = 'Play the synthetic setup user. Answer only the latest question using your private facts. Do not volunteer unrelated facts. Suggestions are proposals, not facts or consent: correct suggestions that conflict with your facts, and never invent authorization. If a fact is missing, say you do not know. No tools. Private facts: ' + encode(fixture['answers'])
                    reply, user_metadata = worker.invoke(encode(history), user_system, destination / f'user-{step}', os.environ.get('SETUP_USER_MODEL', 'sonnet'), 120)
                    (destination / f'user-{step}/role.json').write_text(encode(user_metadata))
                history.append({'role': 'user', 'content': reply})
                print('USER: ' + reply, flush=True)
            else:
                event = {'action': action}
                try:
                    if kind == 'read':
                        path = action['path']
                        event['output'] = sources[path] if path in sources else safe_path(environment, path).read_text()
                    elif kind == 'write':
                        path = safe_path(environment, action['path'])
                        if path.suffix == '.js':
                            validate_config_write(environment, path, action['content'])
                            config_written.add(path.parent.name if path.parent.name == 'machine' else 'project')
                        elif path.name not in {'WORKFLOW.md', '.gitignore', 'README.md'}:
                            raise ValueError('Only documentation, ignore files and data-only config writes are supported')
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(action['content'])
                        event['output'] = {'written': str(path)}
                    elif kind == 'command':
                        argv = action['argv']
                        key = json.dumps(argv, separators=(',', ':'))
                        if argv[:3] == ['bakers', 'config', 'check'] and '--online' in argv and '--scope' in argv:
                            # Match a declared auth double after validating all extra paths/flags.
                            config_args(environment, [value for value in argv if value != '--online'])
                            scope = argv[argv.index('--scope') + 1]
                            canonical = json.dumps(['bakers', 'config', 'check', '--scope', scope, '--online'], separators=(',', ':'))
                            if canonical in fixture.get('commands', {}):
                                key = canonical
                        if key in fixture.get('commands', {}):
                            event.update(output=fixture['commands'][key], simulated=True)
                        elif argv[:2] == ['bakers', 'tools'] or argv == ['bakers', 'info']:
                            event.update(output=simulation.call('bakers', {'argv': argv}), simulated=True)
                        elif argv[:3] == ['git', 'check-ignore', '-v'] and len(argv) > 3:
                            paths = [str(safe_path(environment / 'project', value).relative_to(environment / 'project')) for value in argv[3:]]
                            checked = subprocess.run(['git', 'check-ignore', '-v', '--', *paths], cwd=environment / 'project',
                                                     text=True, capture_output=True, timeout=10,
                                                     env={**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null'})
                            event['output'] = {'exit_code': checked.returncode, 'stdout': checked.stdout, 'stderr': checked.stderr}
                            event['simulated'] = False
                        else:
                            args = config_args(environment, argv)
                            if init_blocked(config_written, args):
                                raise ValueError('This scope was written directly; use its offline check, initialization is unavailable')
                            event['executed_config_argv'] = args
                            completed = subprocess.run(['node', '--import', str(ROOT / 'bakers-cli/node_modules/tsx/dist/loader.mjs'),  # the tsx CLI needs an IPC pipe that a sandbox denies
                                str(ROOT / 'tests/skill-eval/setup-config.mjs'), str(environment), json.dumps(args)],
                                cwd=environment / 'project', text=True, capture_output=True, timeout=30,
                                env={**os.environ, 'BAKERS_HOME': str(environment / 'machine'),
                                     'XDG_CONFIG_HOME': str(environment / 'private-config'),
                                     'XDG_CACHE_HOME': str(environment / 'private-cache'), 'CI': '1'})
                            event['output'] = {'exit_code': completed.returncode, 'stdout': completed.stdout, 'stderr': completed.stderr}
                            event['simulated'] = False
                    else:
                        raise ValueError('Unsupported action type')
                except (ValueError, OSError, subprocess.SubprocessError) as error:
                    event['output'] = {'blocked': str(error)}
                tools.append(event)
                history.append({'role': 'tool', 'content': event['output'], 'simulated': event.get('simulated', False)})
            (destination / 'conversation.json').write_text(encode(history))
    except Exception as error:
        result.update(status='error', error=str(error))
    finally:
        result['files'] = {str(path.relative_to(environment)): path.read_text() for path in environment.rglob('*') if path.is_file() and '.git' not in path.relative_to(environment).parts}
        (destination / 'result.json').write_text(encode(result))
        print('SETUP_CONVERSATION_RESULT ' + fixture['id'] + ' ' + result['status'], flush=True)
    return 0 if result['status'] == 'completed' else 2


if __name__ == '__main__':
    sys.exit(main())
