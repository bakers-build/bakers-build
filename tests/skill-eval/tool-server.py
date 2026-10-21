#!/usr/bin/env python3
"""Local stdio MCP simulator. Never executes argv, accesses a tracker, or reads model-selected disk paths.

The command language, error classes and payloads follow the repository bakers.build CLI as observed by the
real-CLI contract suite (bakers-cli/core/tests/workflow/skill-cli-contract.test.ts); that suite fails
when this bounded model drifts from the CLI.
"""
import argparse
import copy
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = json.loads((HERE / 'contract-fixture.json').read_text())
SCHEMAS = CONTRACT['schemas']

TOOLS = [
    {'name': 'bakers', 'description': 'Invoke the synthetic bakers.build CLI. Supply the complete argv array beginning with bakers dropsh, with each flag/value as a separate token (or --field=value). Values are literal: no shell expansion. Discover command syntax with argv ["bakers", "dropsh", "--help"] or an action followed by --help. argv ["bakers", "info"] returns the project and workspace context. Returns exit_code, stdout and stderr as text, like the real CLI. State exists only in this fixture server.',
     'inputSchema': {'type': 'object', 'properties': {'argv': {'type': 'array', 'items': {'type': 'string'}}}, 'required': ['argv'], 'additionalProperties': False}},
    {'name': 'read_file', 'description': 'Read a caller-supplied virtual fixture file by its exact path. No host filesystem access.',
     'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path'], 'additionalProperties': False}},
]

EXIT = {'E_UNKNOWN': 1, 'E_CONFIG': 2, 'E_AUTH': 3, 'E_VALIDATION': 4, 'E_HTTP': 5, 'E_PLUGIN': 6}
PROGRAM_VALUE = {'--config', '--connection', '--connections-dir', '--auth-profile', '--format', '--view-mode'}
COMMANDS = {
    'read': {'argument': 'target', 'value': set(), 'variadic': {'--include'}, 'flags': set(), 'unknown': False},
    'search': {'argument': 'entity_type', 'value': {'--bundle', '--limit', '--offset', '--sort'}, 'variadic': {'--filter', '--include'}, 'flags': set(), 'unknown': False},
    'create': {'argument': 'entity_type', 'value': {'--bundle', '--data'}, 'variadic': set(), 'flags': {'--dry-run', '--no-validate', '--fields'}, 'unknown': True, 'required': '--bundle <bundle>'},
    'update': {'argument': 'target', 'value': {'--data'}, 'variadic': set(), 'flags': {'--dry-run', '--no-validate', '--fields'}, 'unknown': True},
}
# Real commands outside the fixture's bounded matrix: rejected as unmodeled, never as unknown.
UNMODELED = {'delete', 'upload-file', 'schema', 'connections', 'auth', 'help'}
HELP = {
    None: 'Usage: dropsh [options] [command]\n\nOptions:\n  --format <id>  output format: json (default) or a renderer id (md)\n  -h, --help     display help for command\n\nCommands:\n  read [options] <target>\n  search [options] <entity_type>\n  create [options] <entity_type>\n  update [options] <target>\n',
    'read': 'Usage: dropsh read [options] <target>\n\nRead entity_type/bundle/uuid\n\nOptions:\n  --include <fields...>  related fields to include (JSON:API include)\n',
    'search': 'Usage: dropsh search [options] <entity_type>\n\nSearch entities with filters\n\nOptions:\n  --bundle <bundle>\n  --filter <kv...>  filter in key:value or key:op:value form (default: [])\n  --limit <n>       max results per page (default: 50)\n  --offset <n>      skip the first n results (page[offset])\n  --sort <field>    sort by field; prefix with - for descending\n  --include <fields...>  related fields to include (JSON:API include)\n',
    'create': 'Usage: dropsh create [options] <entity_type>\n\nCreate an entity of given type/bundle\n\nOptions:\n  --bundle <bundle>\n  --data <json>  inline JSON or @path\n  --dry-run\n  --no-validate  skip client-side schema validation\n  --fields       list this bundle\'s field parameters and exit\n\nField parameters (instead of --data):\n  --<field> <value>  --<field>=<value>  --<field>.<sub> <value>  --<relationship> <uuid>  --json <field>=<json>\nA value starting with -- needs the --<field>=<value> form.\n',
    'update': 'Usage: dropsh update [options] <target>\n\nUpdate an existing entity\n\nOptions:\n  --data <json>  inline JSON or @path\n  --dry-run\n  --no-validate  skip client-side schema validation\n  --fields       list this bundle\'s field parameters and exit\n\nField parameters (instead of --data):\n  --<field> <value>  --<field>=<value>  --<field>.<sub> <value>  --<relationship> <uuid>  --json <field>=<json>\nA value starting with -- needs the --<field>=<value> form.\n',
}
READ_TARGET = re.compile(r'^[a-z0-9_]+/[a-z0-9_]+/[a-z0-9_-]+$')
UPDATE_TARGET = re.compile(r'^[a-z0-9_]+/[a-z0-9_]+/[a-f0-9-]{8,}$')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


class Fail(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


class Commander(Exception):
    """A parser rejection printed as plain text, before any bakers.build JSON error envelope exists."""


def result(stdout='', error='', code=0):
    return {'exit_code': code, 'stdout': stdout, 'stderr': error}


def failure(exc):
    return result(error=json.dumps({'error': {'code': exc.code, 'message': exc.message, 'details': exc.details}}, ensure_ascii=False) + '\n', code=EXIT[exc.code])


def http(status, detail):
    return Fail('E_HTTP', f'HTTP {status}', {'status': status, 'body': {'errors': [{'status': str(status), 'detail': detail}]}})


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'


def parse(argv):
    """Commander-equivalent split: program options anywhere, then one command and its options."""
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv) or argv[:2] != ['bakers', 'dropsh']:
        raise ValueError('Only bakers dropsh argument arrays are supported; commands are never executed')
    tokens, program, rest = argv[2:], {}, []
    while tokens:
        token = tokens.pop(0)
        name, eq, value = token.partition('=')
        if name in PROGRAM_VALUE:
            if not eq:
                if not tokens:
                    raise Commander(f"error: option '{name} <value>' argument missing")
                value = tokens.pop(0)
            program[name] = value
            continue
        rest.append(token)
    command = rest[0] if rest else None
    if not rest or command in {'--help', '-h'} or (command in COMMANDS and ('--help' in rest or '-h' in rest)):
        return 'help', command if command in COMMANDS else None, program, {}, []
    if command.startswith('-'):
        raise Commander(f"error: unknown option '{command}'")
    if command in UNMODELED:
        raise Commander(f"fixture simulator does not model '{command}'; it supports read, search, create and update")
    if command not in COMMANDS:
        raise Commander(f"error: unknown command '{command}'")
    spec, args, options, operands, unknown = COMMANDS[command], rest[1:], {}, [], []
    destination = operands
    while args:
        token = args.pop(0)
        if token == '--':
            destination.extend(args)
            break
        if len(token) > 1 and token.startswith('-'):
            key, eq, value = token.partition('=')
            if key in spec['flags'] and not eq:
                options[key] = True
                continue
            if key in spec['value'] or key in spec['variadic']:
                if not eq:
                    if not args:
                        raise Commander(f"error: option '{key} <value>' argument missing")
                    value = args.pop(0)
                values = [value]
                while key in spec['variadic'] and args and not (len(args[0]) > 1 and args[0].startswith('-')):
                    values.append(args.pop(0))
                options.setdefault(key, []).extend(values)
                continue
            if not spec['unknown']:
                raise Commander(f"error: unknown option '{token}'")
            destination = unknown
        destination.append(token)
    positional = operands + unknown
    if not positional:
        raise Commander(f"error: missing required argument '{spec['argument']}'")
    if spec.get('required') and spec['required'].split()[0] not in options:
        raise Commander(f"error: required option '{spec['required']}' not specified")
    return command, positional[0], program, options, positional[1:]


def field_args(tokens):
    out, i = [], 0
    while i < len(tokens):
        token = tokens[i]
        if not token.startswith('--'):
            raise Fail('E_VALIDATION', f'unexpected argument "{token}"; field parameters are long options (--<field> <value>)')
        body = token[2:]
        if not body:
            raise Fail('E_VALIDATION', '"--" is not a field parameter')
        name, eq, value = body.partition('=')
        if name == 'json':
            pairs = [value] if eq else []
            i += 1
            while not eq and i < len(tokens) and not tokens[i].startswith('--'):
                pairs.append(tokens[i])
                i += 1
            if not pairs:
                raise Fail('E_VALIDATION', '--json expects at least one <field>=<value> pair')
            for pair in pairs:
                if pair.find('=') <= 0:
                    raise Fail('E_VALIDATION', f'--json expects <field>=<value> pairs, got "{pair}"')
                path, _, raw = pair.partition('=')
                out.append({'path': path, 'value': raw, 'json': True, 'has': True})
            continue
        if eq:
            out.append({'path': name, 'value': value, 'json': False, 'has': True})
            i += 1
        elif i + 1 < len(tokens) and not tokens[i + 1].startswith('--'):
            out.append({'path': name, 'value': tokens[i + 1], 'json': False, 'has': True})
            i += 2
        else:
            out.append({'path': name, 'value': '', 'json': False, 'has': False})
            i += 1
    return out


def operation_schema(key, operation):
    """The resource schema as dropsh sees it: write envelope, operation variant, name-ref extension."""
    resource = copy.deepcopy(SCHEMAS[key]['allOf'][0]['properties'])
    if operation == 'update':
        resource['attributes']['required'] = []
        resource['relationships']['required'] = []
    if 'labels' in resource['relationships']['properties']:
        resource['attributes']['properties']['label_names'] = {'type': 'string', 'title': 'Label names (comma-separated bb_labels names; unique only within workspace_id — resolved to labels on the live write)'}
    return resource


def describe(resource):
    attributes, relationships = [], []

    def walk(path, node, required):
        props = node.get('properties') if node.get('type') != 'array' else None
        if props:
            for sub, child in props.items():
                walk(f'{path}.{sub}', child, required and sub in node.get('required', []))
            return
        kind = node.get('type')
        spelled = f'--json {path}=<json>' if kind == 'array' else f'--{path} [true|false]' if kind == 'boolean' else f'--{path} <value>'
        attributes.append((spelled, '  '.join(n for n in [kind or '', 'required' if required else '', node.get('title', '')] if n)))
    attrs = resource['attributes']
    for name, node in attrs['properties'].items():
        walk(name, node, name in attrs.get('required', []))
    for name, node in resource['relationships']['properties'].items():
        data = node['properties']['data']
        many = data.get('type') == 'array'
        targets = (data['items'] if many else data)['properties']['type']['enum']
        relationships.append((f'--{name} <uuid>', '  '.join([' | '.join(targets)] + (['repeatable'] if many else []))))
    rows = attributes + relationships
    width = max(len(p) for p, _ in rows) + 2
    line = lambda row: f'  {row[0].ljust(width)}{row[1]}' if row[1] else f'  {row[0]}'
    out = [f"{resource['type']['const']} — field parameters"]
    if attributes:
        out += ['', 'Attributes:'] + [line(r) for r in attributes]
    if relationships:
        out += ['', 'Relationships (take a UUID):'] + [line(r) for r in relationships]
    return '\n'.join(out) + '\n'


def validate(node, value, path=''):
    """The JSON Schema subset the contract schemas use; a mismatch is a pre-send rejection."""
    kind = node.get('type')
    checks = {'object': dict, 'array': list, 'string': str}
    if kind in checks and not isinstance(value, checks[kind]):
        return [f'{path} must be {kind}']
    if 'const' in node and value != node['const'] or 'enum' in node and value not in node['enum']:
        return [f'{path} must be an allowed value']
    if kind == 'string' and len(value) > node.get('maxLength', len(value)):
        return [f'{path} is too long']
    if node.get('format') == 'uuid' and not UUID.match(value) or node.get('format') == 'uri' and not re.match(r'^[a-z][a-z0-9+.-]*:', value, re.I):
        return [f'{path} must match format {node["format"]}']
    errors = []
    if kind == 'object':
        props = node.get('properties', {})
        errors += [f'{path} must have {name}' for name in node.get('required', []) if name not in value]
        errors += [f'{path} must not have {name}' for name in value if node.get('additionalProperties') is False and name not in props]
        for name, child in value.items():
            if name in props:
                errors += validate(props[name], child, f'{path}/{name}')
    if kind == 'array':
        for index, item in enumerate(value):
            errors += validate(node.get('items', {}), item, f'{path}/{index}')
    return errors


def build_payload(resource, params, operation, identifier=None):
    attrs, rels = resource['attributes']['properties'], resource['relationships']['properties']
    attributes, relationships = {}, {}
    for param in params:
        segments = param['path'].split('.')
        name = segments[0]
        if name in rels:
            if len(segments) > 1:
                raise Fail('E_VALIDATION', f"relationship '{name}' takes a UUID, not a sub-path ('{param['path']}')")
            if not param['has']:
                raise Fail('E_VALIDATION', f'missing value for --{name} (expected a UUID)')
            data = rels[name]['properties']['data']
            many = data.get('type') == 'array'
            if relationships.get(name) and not many:
                raise Fail('E_VALIDATION', f"relationship '{name}' accepts a single value; it was given more than once")
            relationships.setdefault(name, []).append({'type': (data['items'] if many else data)['properties']['type']['enum'][0], 'id': param['value']})
            continue
        if name not in attrs:
            raise Fail('E_VALIDATION', f"unknown parameter '{name}'. Known attributes: {', '.join(attrs) or '(none)'}. Known relationships: {', '.join(rels) or '(none)'}.")
        node, cursor = attrs[name], attributes
        for segment in segments[1:]:
            if segment not in node.get('properties', {}):
                raise Fail('E_VALIDATION', f"unknown sub-property '{segment}' of '{name}'")
            node = node['properties'][segment]
        if param['json']:
            try:
                value = json.loads(param['value'])
            except json.JSONDecodeError as exc:
                raise Fail('E_VALIDATION', f"--json {param['path']} is not valid JSON: {exc.msg}")
        elif not param['has']:
            raise Fail('E_VALIDATION', f"missing value for --{param['path']}" + (f" (expected {node['type']})" if node.get('type') else ''))
        else:
            value = param['value']
        for segment in segments[:-1]:
            cursor = cursor.setdefault(segment, {})
        if segments[-1] in cursor:
            raise Fail('E_VALIDATION', f"parameter '{param['path']}' was given more than once")
        cursor[segments[-1]] = value
    data = {'type': resource['type']['const']}
    if operation == 'update':
        data['id'] = identifier
    if attributes:
        data['attributes'] = {k: ({s: attributes[k][s] for s in attrs[k].get('properties', {}) if s in attributes[k]} if isinstance(attributes[k], dict) else attributes[k]) for k in attrs if k in attributes}
    if relationships:
        data['relationships'] = {k: {'data': v if rels[k]['properties']['data'].get('type') == 'array' else v[0]} for k, v in ((k, relationships[k]) for k in rels if k in relationships)}
    return {'data': data}


def yaml_scalar(text):
    return json.dumps(text, ensure_ascii=False) if text == '' or text.strip() != text or re.search(r'[:#\n"\'\[\]{}]', text) else text


def field_text(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, dict):
        if isinstance(value.get('value'), str) and isinstance(value.get('format'), str):
            return value['value']
        if isinstance(value.get('processed'), str):
            return value['processed']
        if isinstance(value.get('value'), str):
            return value['value']
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')) if value is not None else ''


def render_resource(record):
    lines = [f"type: {record['type']}", f"id: {record['id']}"]
    for key, value in record.get('attributes', {}).items():
        text = field_text(value)
        if '\n' in text:
            lines.append(f'{key}: |')
            lines += ['' if line == '' else f'  {line}' for line in text.rstrip('\n').split('\n')]
        else:
            lines.append(f'{key}: {yaml_scalar(text)}')
    for key, rel in record.get('relationships', {}).items():
        data = rel.get('data') if isinstance(rel, dict) else None
        refs = [f"{r['type']}/{r['id']}" for r in (data if isinstance(data, list) else [data] if data else [])]
        if refs:
            lines.append(f"{key}: [{', '.join(refs)}]")
    return '\n'.join(lines)


def render_markdown(document):
    data = document['data']
    primary = ('_(no results)_' if not data else '\n\n---\n\n'.join(map(render_resource, data))) if isinstance(data, list) else render_resource(data)
    included = document.get('included') or []
    text = primary + ('\n\n## Included\n\n' + '\n\n---\n\n'.join(map(render_resource, included)) if included else '')
    return text + '\n'


def record_from(kind, value):
    """Legacy fixture tickets are flat attribute maps; stored records follow the JSON:API resource shape."""
    value = copy.deepcopy(value)
    identifier = value.pop('id')
    relationships = value.pop('relationships', {})
    return {'type': kind, 'id': identifier, 'attributes': value, **({'relationships': relationships} if relationships else {})}


class Simulation:
    def __init__(self, fixture):
        self.config = fixture['simulation']
        self.input = fixture.get('input', {})
        commands = self.config.get('commands', {})
        if not isinstance(commands, dict) or any(name not in {'git', 'glab'} for name in commands):
            raise ValueError('Only fixture git/glab commands are supported')
        self.tools = TOOLS + [dict(TOOLS[0], name=name,
            description=f'Synthetic {name}: literal argv including the binary. No host execution. Supported command syntax: ' + json.dumps([row['argv'] for row in commands[name]])) for name in commands]
        ticket = 'bb_ticket--bb_ticket'
        sources = [self.config.get('ticket'), self.config.get('prior_art'), CONTRACT['probe_ticket']]
        self.tickets = {s['id']: record_from(ticket, s) for s in sources if s}
        self.comments = {}
        self.terms = {t['id']: record_from('bb_term--bb_labels', t) for t in CONTRACT['terms']}
        self.lost = False
        self.merge_completed = False

    def store(self, key):
        return {'bb_ticket/bb_ticket': self.tickets, 'bb_comment/bb_comment': self.comments, 'bb_term/bb_labels': self.terms}.get(key)

    def emit(self, document, program):
        fmt = program.get('--format', 'json')
        if fmt == 'json' or 'data' not in document:
            return result(dumps(document))
        if fmt == 'md':
            return result(render_markdown(document))
        raise Fail('E_CONFIG', f"Unknown format '{fmt}'. Available: json, md")

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
            if path not in self.config.get('files', {}):
                return result(error='No such virtual fixture file', code=2)
            return result(self.config['files'][path])
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
            command, target, program, options, extra = parse(arguments.get('argv'))
            if command == 'help':
                return result(HELP[target])
            if program.get('--format', 'json') not in {'json', 'md'}:
                raise Fail('E_CONFIG', f"Unknown format '{program['--format']}'. Available: json, md")
            return getattr(self, command)(target, program, options, extra)
        except Commander as exc:
            return result(error=f'{exc}\n', code=1)
        except Fail as exc:
            return failure(exc)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            return result(error=str(exc), code=2)

    def read(self, target, program, options, _extra):
        if not READ_TARGET.match(target):
            raise Fail('E_VALIDATION', f'target must be <entity_type>/<bundle>/<uuid>, got "{target}"')
        entity, bundle, identifier = target.split('/')
        store = self.store(f'{entity}/{bundle}')
        if store is None or identifier not in store:
            raise http(404, 'fixture entity not found')
        record = copy.deepcopy(store[identifier])
        document = {'data': record}
        includes = [n.strip() for v in options.get('--include', []) for n in v.split(',') if n.strip()]
        if entity == 'bb_ticket':
            record['relationships'] = {**record.get('relationships', {}),
                                       'comments': {'data': [{'type': c['type'], 'id': c['id']} for c in self.comments.values() if c['relationships']['ticket_id']['data']['id'] == identifier]}}
        if includes:
            refs = [r for name in includes for r in ([record.get('relationships', {}).get(name, {}).get('data')] if isinstance(record.get('relationships', {}).get(name, {}).get('data'), dict) else record.get('relationships', {}).get(name, {}).get('data') or [])]
            document['included'] = [copy.deepcopy((self.comments.get(r['id']) or self.terms.get(r['id']))) for r in refs if self.comments.get(r['id']) or self.terms.get(r['id'])]
        return self.emit(document, program)

    def search(self, entity, program, options, _extra):
        bundle = options.get('--bundle', [None])[-1]
        filters = []
        for raw in options.get('--filter', []):
            parts = raw.split(':')
            if len(parts) < 2:
                raise Fail('E_VALIDATION', f'--filter must be key:value or key:op:value, got "{raw}"')
            filters.append((parts[0], parts[1], ':'.join(parts[2:])) if len(parts) >= 3 and parts[1] in {'CONTAINS', '='} else (parts[0], '=', ':'.join(parts[1:])))
        store = self.store(f'{entity}/{bundle}')
        if store is None:
            raise http(404, 'unmodeled fixture route')
        rows = []
        for record in store.values():
            matched = True
            for path, operator, expected in filters:
                relationship = record.get('relationships', {}).get(path, {}).get('data')
                actual = relationship['id'] if isinstance(relationship, dict) else record['attributes']
                if not isinstance(relationship, dict):
                    for segment in path.split('.'):
                        actual = actual.get(segment) if isinstance(actual, dict) else None
                if isinstance(actual, dict):
                    raise http(400, f'Invalid nested filtering. The field `{path}` is not a filterable scalar.')
                matched = matched and (isinstance(actual, str) and expected.lower() in actual.lower() if operator == 'CONTAINS' else actual == expected)
            if matched:
                rows.append(copy.deepcopy(record))
        return self.emit({'data': rows, 'links': {}}, program)

    def payload(self, key, operation, options, extra, identifier=None):
        resource = operation_schema(key, operation)
        params = field_args(extra)
        if '--data' in options and params:
            raise Fail('E_VALIDATION', '--data and field parameters are mutually exclusive; use one or the other')
        if '--data' not in options and not params:
            raise Fail('E_VALIDATION', 'provide either --data or field parameters (--<field> <value>)')
        if '--data' in options:
            raw = options['--data'][-1]
            if raw.startswith('@'):
                if raw[1:] not in self.config.get('files', {}):
                    raise Fail('E_VALIDATION', f'Cannot read --data file {raw[1:]}: no such virtual fixture file')
                raw = self.config['files'][raw[1:]]
            try:
                document = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise Fail('E_VALIDATION', f'--data is not valid JSON: {exc.msg}')
        else:
            if operation == 'update' and not UPDATE_TARGET.match(identifier[0]):
                raise Fail('E_VALIDATION', f'target must be <entity_type>/<bundle>/<uuid>, got "{identifier[0]}"')
            document = build_payload(resource, params, operation, identifier and identifier[1])
        if '--no-validate' not in options:
            schema = {'type': 'object', 'required': ['data'], 'properties': {'data': {'type': 'object', 'required': ['type', 'id'] if operation == 'update' else ['type'],
                      'properties': {'type': resource['type'], 'id': {'type': 'string'}, 'attributes': resource['attributes'], 'relationships': resource['relationships']}}}}
            errors = validate(schema, document)
            if errors:
                raise Fail('E_VALIDATION', f'payload does not match schema for {key}', {'errors': errors})
        return document

    def resolve_labels(self, data):
        names = data.get('attributes', {}).pop('label_names', None)
        if not data.get('attributes'):
            data.pop('attributes', None)
        if names is None:
            return
        by_name = {t['attributes']['name']: t['id'] for t in self.terms.values()}
        ids = []
        for name in [n.strip() for n in names.split(',') if n.strip()]:
            if name not in by_name:
                cause = f"Error: label name '{name}' does not exist in the bb_term/bb_labels vocabulary. Known names: {', '.join(by_name)}"
                raise Fail('E_PLUGIN', "plugin 'bakers-name-refs' failed in alterRequest", {'pluginId': 'bakers-name-refs', 'hook': 'alterRequest', 'cause': cause})
            ids.append(by_name[name])
        existing = data.get('relationships', {}).get('labels', {}).get('data', [])
        merged = list({r['id']: r for r in existing + [{'type': 'bb_term--bb_labels', 'id': i} for i in ids]}.values())
        if merged:
            data.setdefault('relationships', {})['labels'] = {'data': merged}

    def create(self, entity, program, options, extra):
        bundle = options['--bundle'][-1]
        key = f'{entity}/{bundle}'
        if key not in SCHEMAS:
            raise Fail('E_VALIDATION', f"no such target '{key}'. Run 'dropsh schema' to see available targets.")
        if options.get('--fields'):
            return result(describe(operation_schema(key, 'create')))
        document = self.payload(key, 'create', options, extra)
        if options.get('--dry-run'):
            return result(dumps({'dry_run': True, 'method': 'POST', 'path': key, 'payload': document}))
        data = copy.deepcopy(document['data'])
        self.resolve_labels(data)
        if entity == 'bb_comment':
            data['id'] = f'22222222-2222-4222-8222-{len(self.comments) + 1:012d}'
            self.comments[data['id']] = data
            mode = self.config.get('uncertain_comment')
            if mode and not self.lost:
                self.lost = True
                if mode == 'unapplied':
                    del self.comments[data['id']]
                raise Fail('E_HTTP', 'Network failure after 1 attempts', {'status': 0, 'body': {'cause': 'TypeError: fetch failed'}})
        else:
            data['id'] = '33333333-3333-4333-8333-333333333333'
            data['attributes'] = {**data.get('attributes', {}), 'state': 'qualification', 'identifier': 'EVAL-30', 'changed': 'fixture-revision-1'}
            self.tickets[data['id']] = data
        return self.emit({'data': copy.deepcopy(data)}, program)

    def update(self, target, program, options, extra):
        entity, _, rest = target.partition('/')
        bundle, _, identifier = rest.partition('/')
        key = f'{entity}/{bundle}'
        if key not in SCHEMAS:
            raise Fail('E_VALIDATION', f"no such target '{key}'. Run 'dropsh schema' to see available targets.")
        if options.get('--fields'):
            return result(describe(operation_schema(key, 'update')))
        document = self.payload(key, 'update', options, extra, (target, identifier))
        if not UPDATE_TARGET.match(target):
            raise Fail('E_VALIDATION', f'target must be <entity_type>/<bundle>/<uuid>, got "{target}"')
        if options.get('--dry-run'):
            return result(dumps({'dry_run': True, 'method': 'PATCH', 'path': target, 'payload': document}))
        store = self.store(key)
        if identifier not in store:
            raise http(404, 'fixture entity not found')
        data = copy.deepcopy(document['data'])
        self.resolve_labels(data)
        if 'state' in data.get('attributes', {}) and self.config.get('reject_transition'):
            raise http(422, 'supplied transition rejected; current state unchanged')
        # The complete mutation is validated above; only now does the stored record change.
        record = store[identifier]
        record['attributes'].update(data.get('attributes', {}))
        if data.get('relationships'):
            record['relationships'] = {**record.get('relationships', {}), **data['relationships']}
        return self.emit({'data': copy.deepcopy(record)}, program)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--trace', required=True)
    args = parser.parse_args()
    simulation = Simulation(json.loads(Path(args.fixture).read_text()))
    # Only runner-selected startup paths touch disk; model-selected read_file paths are virtual.
    with Path(args.trace).open('x') as trace:
        for line in sys.stdin:
            request = json.loads(line)
            if 'id' not in request:
                continue
            method = request.get('method')
            if method == 'initialize':
                response = {'protocolVersion': request.get('params', {}).get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'bakers-skill-fixture', 'version': '2'}}
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
