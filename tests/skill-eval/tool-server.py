#!/usr/bin/env python3
"""Local stdio MCP simulator. Never executes argv, accesses a tracker, or reads model-selected disk paths.

It models `bakers tools [<tool>] [--schema] [--data <json|@file>] [--param k=v]` for the bakers
tools in contract-fixture.json: argument validation, results and error classes follow the repository
CLI (@dropsh/plugin-tool) and the Drupal tools as observed by the real-CLI contract suite
(bakers-cli/core/tests/workflow/skill-cli-contract.test.ts), which fails when this model drifts.
JSON:API commands (read, search, create, update, schema) are not part of the skill contract.
"""
import argparse
import copy
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = json.loads((HERE / 'contract-fixture.json').read_text())
TOOL_DEFS = {t['name']: t for t in CONTRACT['tools']}

TOOLS = [
    {'name': 'bakers', 'description': 'Invoke the synthetic bakers.build CLI. Supply the complete argv array beginning with bakers, each flag/value as a separate token (or --flag=value). Values are literal: no shell expansion. argv ["bakers", "tools"] lists the tracker tools, ["bakers", "tools", "<tool>", "--schema"] describes one and ["bakers", "tools", "<tool>", "--data", "@<file>"] calls it with a JSON arguments file written by write_file. argv ["bakers", "info"] returns the project and workspace context. Returns exit_code, stdout and stderr as text, like the real CLI. State exists only in this fixture server.',
     'inputSchema': {'type': 'object', 'properties': {'argv': {'type': 'array', 'items': {'type': 'string'}}}, 'required': ['argv'], 'additionalProperties': False}},
    {'name': 'read_file', 'description': 'Read a caller-supplied or previously written virtual file by its exact path. No host filesystem access.',
     'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path'], 'additionalProperties': False}},
    {'name': 'write_file', 'description': 'Write a virtual file (e.g. a tool arguments JSON file) by its exact path; caller-supplied files are read-only. No host filesystem access.',
     'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}, 'content': {'type': 'string'}}, 'required': ['path', 'content'], 'additionalProperties': False}},
]

EXIT = {'E_TOOL': 1, 'E_VALIDATION': 4, 'E_HTTP': 5}
SELECTORS = {'--config', '--connection', '--auth-profile', '--conductor'}
HELP = {
    None: 'Usage: bakers [options] [command]\n\nCommands:\n  tools [options] [name]  List, describe or call the site\'s Drupal Tool API tools over its MCP endpoint\n',
    'tool': 'Usage: bakers tools [options] [name]\n\nList, describe or call the site\'s Drupal Tool API tools over its MCP endpoint\n\nOptions:\n  --schema              print the tool\'s input (and output) schema\n  --param <key=value>   tool argument; repeatable, overrides --data (default: [])\n  --data <json|@file>   tool arguments as a JSON object, or @file\n  -h, --help            display help for command\n',
}
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


class Fail(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


class Commander(Exception):
    """A parser rejection printed as plain text, before any error envelope exists."""


def refused(message):
    """A tool that ran and reported an error (isError): E_TOOL, exit 1."""
    return Fail('E_TOOL', message, {'content': [{'type': 'text', 'text': message}]})


def result(stdout='', error='', code=0):
    return {'exit_code': code, 'stdout': stdout, 'stderr': error}


def failure(exc):
    return result(error=json.dumps({'error': {'code': exc.code, 'message': exc.message, 'details': exc.details}}, ensure_ascii=False) + '\n', code=EXIT[exc.code])


def dumps(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def parse(argv):
    """Commander-equivalent split of `bakers tools [name] [options]`."""
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv) or not argv or argv[0] != 'bakers':
        raise ValueError('Only bakers argument arrays are supported; commands are never executed')
    args = argv[1:]
    while args and args[0].partition('=')[0] in SELECTORS:
        key, eq, _ = args.pop(0).partition('=')
        if not eq:
            if not args:
                raise Commander(f"error: option '{key}' argument missing")
            args.pop(0)
    if args in [[], ['--help'], ['-h']]:
        return 'help', None, {}
    if args.pop(0) != 'tools':
        raise ValueError('This command is not part of the skill contract; call bakers tools <tool> --data @<args.json>')
    options, names = {'--param': []}, []
    while args:
        token = args.pop(0)
        key, eq, value = token.partition('=')
        if key in SELECTORS:
            if not eq:
                if not args:
                    raise Commander(f"error: option '{key}' argument missing")
                args.pop(0)
        elif key in {'--help', '-h'}:
            return 'help', 'tool', {}
        elif key == '--schema' and not eq:
            options['--schema'] = True
        elif key in {'--data', '--param'}:
            if not eq:
                if not args:
                    raise Commander(f"error: option '{key} <{'json|@file' if key == '--data' else 'key=value'}>' argument missing")
                value = args.pop(0)
            if key == '--param':
                options['--param'].append(value)
            else:
                options['--data'] = value
        elif token.startswith('-') and len(token) > 1:
            raise Commander(f"error: unknown option '{token}'")
        else:
            names.append(token)
    # Like the CLI, excess positional arguments are ignored.
    return 'tool', names[0] if names else None, options


def coerce(schema, key, value):
    declared = schema.get('properties', {}).get(key, {})
    kinds = declared.get('type') or [o.get('type') for o in declared.get('oneOf', [])]
    kind = next((k for k in (kinds if isinstance(kinds, list) else [kinds]) if k != 'null'), None)
    if kind in {'integer', 'number'}:
        try:
            return int(value) if re.fullmatch(r'-?\d+', value.strip()) else float(value) if value.strip() else value
        except ValueError:
            return value
    if kind == 'boolean':
        return {'true': True, 'false': False}.get(value, value)
    if kind in {'object', 'array'}:
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise Fail('E_VALIDATION', f'--param {key} is not valid JSON: {exc.msg}')
    return value


def kind_of(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, int) or isinstance(value, float) and value.is_integer():
        return 'integer'
    return {float: 'number', str: 'string', list: 'array', dict: 'object'}.get(type(value))


def validate(node, value, path=''):
    """The JSON Schema subset the Drupal tool schemas use, judged like the CLI's Ajv: pre-send rejections."""
    if 'oneOf' in node:
        matching = [o for o in node['oneOf'] if not validate(o, value, path)]
        if len(matching) != 1:
            return [f'{path or "/"} must match exactly one schema in oneOf']
    declared = node.get('type')
    if declared is not None:
        kinds = declared if isinstance(declared, list) else [declared]
        actual = kind_of(value)
        if not (actual in kinds or actual == 'integer' and 'number' in kinds):
            return [f'{path or "/"} must be {",".join(kinds)}']
    errors = []
    if isinstance(value, str):
        if len(value) < node.get('minLength', 0) or len(value) > node.get('maxLength', len(value)):
            errors.append(f'{path} must have a length within its limits')
        if 'pattern' in node and not re.search(node['pattern'], value):
            errors.append(f'{path} must match pattern "{node["pattern"]}"')
    if isinstance(value, dict):
        props = node.get('properties', {})
        errors += [f"{path or '/'} must have required property '{name}'" for name in node.get('required', []) if name not in value]
        errors += [f'{path or "/"} must NOT have additional properties' for name in value if node.get('additionalProperties') is False and name not in props]
        for name, child in value.items():
            if name in props:
                errors += validate(props[name], child, f'{path}/{name}')
    if isinstance(value, list):
        if len(value) < node.get('minItems', 0):
            errors.append(f'{path} must NOT have fewer than {node["minItems"]} items')
        for index, item in enumerate(value):
            errors += validate(node.get('items', {}), item, f'{path}/{index}')
    return errors


def ticket_record(source):
    record = copy.deepcopy(source)
    record.setdefault('labels', [])
    record.setdefault('links', [])
    return record


class Simulation:
    def __init__(self, fixture):
        self.config = fixture['simulation']
        self.input = fixture.get('input', {})
        commands = self.config.get('commands', {})
        if not isinstance(commands, dict) or any(name not in {'git', 'glab'} for name in commands):
            raise ValueError('Only fixture git/glab commands are supported')
        self.tools = TOOLS + [dict(TOOLS[0], name=name,
            description=f'Synthetic {name}: literal argv including the binary. No host execution. Supported command syntax: ' + json.dumps([row['argv'] for row in commands[name]])) for name in commands]
        sources = [self.config.get('ticket'), self.config.get('prior_art'), CONTRACT['probe_ticket']]
        self.tickets = {s['id']: ticket_record(s) for s in sources if s}
        # Seeded comments model earlier states' handoffs; created ones are numbered after them.
        self.comments = [copy.deepcopy(c) for c in self.config.get('comments', [])]
        self.worklogs = copy.deepcopy(self.config.get('worklogs', []))
        self.files = dict(self.config.get('files', {}))
        self.created = 0
        self.submissions = 0
        self.lost = False
        self.merge_completed = False

    def call(self, name, arguments):
        if name in self.config.get('commands', {}):
            if set(arguments) != {'argv'}:
                return result(error='Expected literal argv only', code=2)
            for declared in self.config['commands'][name]:
                if arguments['argv'] == declared['argv']:
                    response = declared.get('before_merge', declared['result']) if not self.merge_completed else declared['result']
                    if name == 'glab' and arguments['argv'][1:3] == ['mr', 'merge'] and response['exit_code'] == 0:
                        self.merge_completed = True
                    return copy.deepcopy(response)
            return result(error='Undeclared fixture command', code=2)
        if name == 'read_file':
            path = arguments.get('path')
            # A worktree-relative ./ names the same file, as on a real filesystem.
            if isinstance(path, str) and path.startswith('./'):
                path = path[2:]
            if path not in self.files:
                return result(error='No such virtual fixture file', code=2)
            return result(self.files[path])
        if name == 'write_file':
            path, content = arguments.get('path'), arguments.get('content')
            if not isinstance(path, str) or not path or not isinstance(content, str) or path in self.config.get('files', {}):
                return result(error='Expected a new virtual path and string content; caller-supplied files are read-only', code=2)
            self.files[path] = content
            return result()
        if name != 'bakers':
            return result(error='Unknown tool', code=2)
        try:
            argv = arguments.get('argv')
            if argv == ['bakers', 'info']:
                if not self.input.get('workspace_uuid'):
                    return result(error='No workspace context in this fixture', code=2)
                # Like the real `bakers info`: pretty-printed JSON text.
                return result(json.dumps({'project': 'fixture', 'project_id': self.input.get('project_uuid'), 'workspace': 'fixture',
                                          'workspace_id': self.input['workspace_uuid'], 'workspace_ids': [self.input['workspace_uuid']]}, indent=2) + '\n')
            command, tool, options = parse(argv)
            if command == 'help':
                return result(HELP[tool])
            return self.tool(tool, options)
        except Commander as exc:
            return result(error=f'{exc}\n', code=1)
        except Fail as exc:
            return failure(exc)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            return result(error=str(exc), code=2)

    def tool(self, name, options):
        """The CLI's order: list, unknown tool, --schema, read --data, overlay --param, validate, call."""
        if name is None:
            return result(dumps([{'name': t['name'], 'title': t['title'], 'description': t['description']} for t in CONTRACT['tools']]))
        definition = TOOL_DEFS.get(name)
        if definition is None:
            raise Fail('E_VALIDATION', f"unknown tool '{name}'", {'tool': name})
        if options.get('--schema'):
            return result(dumps({'name': name, 'inputSchema': definition['inputSchema'], 'outputSchema': definition['outputSchema']}))
        data = {}
        if '--data' in options:
            raw = options['--data']
            if raw.startswith('@'):
                if raw[1:] not in self.files:
                    raise Fail('E_VALIDATION', f'Cannot read --data file {raw[1:]}: no such virtual file')
                raw = self.files[raw[1:]]
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise Fail('E_VALIDATION', f'--data is not valid JSON: {exc.msg}')
            if not isinstance(data, dict):
                raise Fail('E_VALIDATION', '--data must be a JSON object')
        for param in options['--param']:
            key, eq, value = param.partition('=')
            if not eq or not key:
                raise Fail('E_VALIDATION', f"--param '{param}' must be key=value")
            data[key] = coerce(definition['inputSchema'], key, value)
        errors = validate(definition['inputSchema'], data)
        if errors:
            raise Fail('E_VALIDATION', f'payload does not match schema for tool {name}', {'errors': errors})
        try:
            output = getattr(self, name.removeprefix('tool_api__bakers_'))(data)
        except Fail as exc:
            if exc.code == 'E_TOOL':
                exc.details = {'tool': name, **exc.details}
            raise
        # The MCP client checks structured content against the advertised output schema.
        if validate(definition['outputSchema'], output):
            raise Fail('E_HTTP', "MCP error -32602: Structured content does not match the tool's output schema", {'status': 0})
        return result(dumps(output))

    def find(self, reference):
        found = next((t for t in self.tickets.values() if reference in (t['id'], t.get('identifier'))), None)
        if found is None:
            raise refused(f'Ticket {reference} does not exist or is not readable.')
        return found

    def project(self, reference):
        if reference not in (CONTRACT['project'], CONTRACT['project_key']):
            raise refused(f'Project {reference} does not exist or is not readable.')

    def parent_identifier(self, t):
        parent = self.tickets.get(t.get('parent'))
        return parent.get('identifier') if parent else None

    def ticket_read(self, args):
        t = self.find(args['ticket'])
        return {**{k: t.get(k) for k in ['id', 'identifier', 'title', 'state', 'workflow', 'description', 'type', 'recipe', 'branch_name', 'conductor']},
                'labels': t['labels'], 'links': t['links'],
                'project': CONTRACT['project'], 'base_branch': t.get('base_branch', 'main'), 'frozen': bool(t.get('frozen')),
                'metrics': copy.deepcopy(t.get('metrics', [])),
                'comments': [{'id': c['id'], 'type': c['type'], 'body': c['body'], 'created': c.get('created', '2026-01-01T00:00:00+00:00'),
                              'author': c.get('author', 'fixture-agent')} for c in self.comments if c['ticket'] == t['id']]}

    def ticket_search(self, args):
        if args.get('project'):
            self.project(args['project'])
        query, branch = (args.get('query') or '').lower(), args.get('branch_name')
        if not query and not branch:
            raise refused('Give a query or a branch_name.')
        rows = [t for t in reversed(list(self.tickets.values()))
                if (not query or query in (t.get('title') or '').lower() or query in (t.get('description') or '').lower())
                and (not branch or t.get('branch_name') == branch)]
        return {'tickets': [{**{k: t.get(k) for k in ['identifier', 'title', 'state', 'type', 'branch_name']},
                             'base_branch': t.get('base_branch', 'main'), 'parent': self.parent_identifier(t)} for t in rows[:50]]}

    def ticket_create(self, args):
        self.project(args['project'])
        parent = self.find(args['parent'])['id'] if args.get('parent') else None
        self.created += 1
        ticket = {'id': f'33333333-3333-4333-8333-{self.created:012d}', 'identifier': f'EVAL-{100 + self.created}', 'title': args['title'],
                  'state': 'qualification', 'workflow': args['workflow'], 'description': args.get('description'),
                  'type': args.get('type') or None, 'recipe': args.get('recipe') or None, 'labels': [], 'links': [], 'parent': parent,
                  'branch_name': args.get('branch_name') or f'feat/eval-{100 + self.created}'}
        self.tickets[ticket['id']] = ticket
        return {'id': ticket['id'], 'identifier': ticket['identifier'], 'state': ticket['state'], 'branch_name': ticket['branch_name']}

    def ticket_update(self, args):
        fields = ['title', 'description', 'conductor', 'labels_add', 'frozen']
        if all(args.get(f) is None for f in fields):
            raise refused('Give a title, a description, a conductor, labels to add or frozen.')
        t = self.find(args['ticket'])
        for f in ['title', 'description', 'conductor', 'frozen']:
            if args.get(f) is not None:
                t[f] = args[f]
        for label in args.get('labels_add') or []:
            if label not in t['labels']:
                t['labels'].append(label)
        return {'identifier': t.get('identifier'), 'title': t.get('title'), 'description': t.get('description'),
                'conductor': t.get('conductor'), 'labels': list(t['labels']), 'frozen': bool(t.get('frozen'))}

    # Setup lookups read fixture rows (`simulation.<collection>`); one page, no workspace prerequisite.
    def rows(self, collection, default):
        return copy.deepcopy(self.config.get(collection, default))

    def workspace_list(self, args):
        return {'workspaces': self.rows('workspaces', [{'uuid': self.input.get('workspace_uuid') or CONTRACT['project'], 'name': 'fixture', 'slug': 'fixture'}]),
                'next_offset': None}

    def group_list(self, args):
        groups = [g for g in self.rows('groups', []) if not args.get('group') or g['uuid'] == args['group']]
        return {'groups': groups, 'next_offset': None}

    def team_list(self, args):
        return {'teams': self.rows('teams', []), 'next_offset': None}

    def group_create(self, args):
        group = {'uuid': f'44444444-4444-4444-8444-{len(self.config.setdefault("groups", [])) + 1:012d}',
                 'name': args['name'], 'description': args.get('description')}
        self.config['groups'].append(group)
        return copy.deepcopy(group)

    def project_create(self, args):
        if not args.get('teams'):
            raise refused('teams: This value should not be null.')
        project = {'uuid': f'66666666-6666-4666-8666-{len(self.config.setdefault("projects", [])) + 1:012d}',
                   'key': ''.join(ch for ch in args['name'].upper() if ch.isalnum())[:10], 'name': args['name'],
                   'description': args.get('description'), 'group': args['group'], 'teams': list(args['teams']),
                   'repository': args.get('repository'), 'coder_config': args.get('coder_config')}
        self.config['projects'].append(project)
        return copy.deepcopy(project)

    def project_read(self, args):
        found = next((p for p in self.config.get('projects', []) if args['project'] in (p['uuid'], p['key'])), None)
        if found is None:
            raise refused(f"Project {args['project']} does not exist or is not readable.")
        return copy.deepcopy(found)

    def conductor_list(self, args):
        self.project(args['project'])
        return {'conductors': self.rows('conductors', []), 'next_offset': None}

    # shortcut: fixture `templates` rows; no placeholder rendering, labels or target_state.
    def ticket_template_run(self, args):
        template = next((t for t in self.rows('templates', []) if t['uuid'] == args['template']), None)
        if template is None:
            raise refused(f"Template {args['template']} does not exist or is not readable.")
        project = args.get('project') or template.get('project')
        if not project:
            raise refused('A project is required for a workspace template.')
        created = self.ticket_create({'project': project, 'title': args.get('title') or template['title'],
                                      'workflow': args.get('workflow') or template['workflow'], 'description': args.get('description')})
        return {'uuid': created['id'], 'identifier': created['identifier']}

    def ticket_runs_list(self, args):
        t = self.find(args['ticket'])
        return {'runs': copy.deepcopy(t.get('runs', [])), 'next_offset': None}

    # Term names (type, recipe, label) are reused or created: the fixture caller may create terms.
    def ticket_classify(self, args):
        if not args.get('type') and not args.get('recipe'):
            raise refused('Give a recipe or a type.')
        t = self.find(args['ticket'])
        for field in ['type', 'recipe']:
            if args.get(field):
                t[field] = args[field]
        return {'type': t.get('type'), 'recipe': t.get('recipe')}

    def ticket_transition(self, args):
        state, links = args.get('state') or '', args.get('links') or []
        if not state and not links:
            raise refused('Give a target state or links to add.')
        t = self.find(args['ticket'])
        if state and self.config.get('reject_transition'):
            raise refused(f"Ticket {args['ticket']} cannot move from {t['state']} to {state}.")
        if state:
            t['state'] = state
        for link in links:
            if not any(existing['uri'] == link['uri'] for existing in t['links']):
                t['links'].append({'uri': link['uri'], 'title': link.get('title') or ''})
        return {'state': t['state'], 'links': copy.deepcopy(t['links'])}

    def comment_publish(self, args):
        t = self.find(args['ticket'])
        comment = {'id': f'22222222-2222-4222-8222-{len(self.comments) + 1:012d}', 'ticket': t['id'], 'type': args['type'], 'body': args['body']}
        self.comments.append(comment)
        mode = self.config.get('uncertain_comment')
        if mode and not self.lost:
            self.lost = True
            if mode == 'unapplied':
                self.comments.pop()
            raise Fail('E_HTTP', 'cannot reach MCP endpoint: fetch failed', {'status': 0})
        return {'id': comment['id'], 'type': comment['type']}

    def metric_write(self, args):
        prefix = args['name'] + '.'
        for row in args['rows']:
            if not row['name'].startswith(prefix):
                raise refused(f"Row {row['name']} is not in the {prefix} namespace.")
        t = self.find(args['ticket'])
        t['metrics'] = [m for m in t.get('metrics', []) if not m['name'].startswith(prefix)] + \
            [{'name': r['name'], 'value': float(r['value']), 'unit': r.get('unit')} for r in args['rows']]
        if args.get('label'):
            if args['label'] not in t['labels']:
                t['labels'].append(args['label'])
        return {'metrics': copy.deepcopy(t['metrics'])}

    def time_propose(self, args):
        for position, entry in enumerate(args['entries'], 1):
            seconds = entry['duration_seconds']
            if not DATE.match(entry['work_date']) or not 60 <= seconds <= 86400 or seconds % 60 or len(entry['description']) > 2000:
                raise refused(f"Entry {position} ({entry['source_key']}) is invalid: work_date Y-m-d, whole minutes from 60 to 86400 seconds, at most 2000 characters.")
        self.submissions += 1
        submission = f'aaaaaaaa-aaaa-4aaa-8aaa-{self.submissions:012d}'
        ids = []
        for entry in args['entries']:
            ids.append(f'bbbbbbbb-bbbb-4bbb-8bbb-{len(self.worklogs) + 1:012d}')
            self.worklogs.append({'id': ids[-1], 'work_date': entry['work_date'], 'state': 'proposed', 'duration_seconds': entry['duration_seconds'],
                                  'description': entry['description'], 'source_keys': [],
                                  'project_id': entry.get('project') or args.get('project') or CONTRACT['project'],
                                  'ticket_id': entry.get('ticket'), 'submission_id': submission})
        return {'submission': submission, 'worklogs': ids}

    def worklog_list(self, args):
        start, end = args['from'], args['to']
        limit, offset = args.get('limit') or 50, args.get('offset') or 0
        if not DATE.match(start) or not DATE.match(end) or start > end or not 1 <= limit <= 50 or offset < 0:
            raise refused('Give from <= to as Y-m-d, limit 1 to 50 and a non-negative offset.')
        rows = [w for w in self.worklogs if start <= w['work_date'] <= end]
        page = copy.deepcopy(rows[offset:offset + limit])
        tickets = [t for t in self.tickets.values() if t['id'] in {w['ticket_id'] for w in page}]
        return {'data': page,
                'projects': [{'id': p, 'name': 'fixture'} for p in sorted({w['project_id'] for w in page if w['project_id']})],
                'tickets': [{'id': t['id'], 'identifier': t.get('identifier'), 'title': t.get('title'), 'project_id': CONTRACT['project']} for t in tickets],
                'omitted': False, 'next_offset': offset + limit if len(rows) > offset + limit else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--trace', required=True)
    args = parser.parse_args()
    simulation = Simulation(json.loads(Path(args.fixture).read_text()))
    # Only runner-selected startup paths touch disk; model-selected file paths are virtual.
    with Path(args.trace).open('x') as trace:
        for line in sys.stdin:
            request = json.loads(line)
            if 'id' not in request:
                continue
            method = request.get('method')
            if method == 'initialize':
                response = {'protocolVersion': request.get('params', {}).get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'bakers-skill-fixture', 'version': '3'}}
            elif method == 'tools/list':
                response = {'tools': simulation.tools}
            elif method == 'tools/call':
                params = request['params']
                value = simulation.call(params['name'], params.get('arguments', {}))
                trace.write(json.dumps({'tool': params['name'], 'arguments': params.get('arguments', {}), 'result': copy.deepcopy(value)}, ensure_ascii=False)+'\n')
                trace.flush()
                response = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}], 'isError': value['exit_code'] != 0}
            elif method in {'ping', 'resources/list', 'prompts/list'}:
                response = {'resources': [], 'prompts': []} if method != 'ping' else {}
            else:
                print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32601, 'message': 'Method not found'}}), flush=True)
                continue
            print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': response}), flush=True)


if __name__ == '__main__':
    main()
