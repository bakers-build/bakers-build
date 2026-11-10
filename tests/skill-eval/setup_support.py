"""Closed command and path boundary for synthetic setup conversations."""
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlparse


def parse_action(text):
    text = re.sub(r'^```(?:json)?\s*\n|\n```\s*$', '', text.strip())
    if text.startswith('<invoke '):
        try:
            node = ET.fromstring(text)
            action = {'type': node.attrib['name']}
            for child in node:
                key = child.attrib['name']
                if child.tag != 'parameter' or key in action:
                    raise ValueError('Invalid action parameter')
                action[key] = json.loads(child.text) if key == 'argv' else child.text
        except (ET.ParseError, KeyError) as error:
            raise ValueError('Invalid action transport') from error
    else:
        action = json.loads(text)
    fields = {'question': {'text'}, 'final': {'text'}, 'command': {'argv'},
              'read': {'path'}, 'write': {'path', 'content'}}
    if not isinstance(action, dict) or action.get('type') not in fields or set(action) != fields[action['type']] | {'type'}:
        raise ValueError('Expected one supported action')
    return action


def safe_path(root, value):
    root = Path(root).resolve()
    path = (root / value).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError('Path is outside the synthetic case')
    return path


def config_args(root, argv):
    if not isinstance(argv, list) or not all(isinstance(value, str) for value in argv):
        raise ValueError('Expected literal argv')
    if argv[:2] != ['bakers', 'config'] or len(argv) < 3 or argv[2] not in {'init', 'check'}:
        raise ValueError('Only local config init/check is permitted')
    if argv[3:] == ['--help']:
        return argv[1:]
    values = {}
    online = False
    dry_run = False
    flags = {'--scope', '--label', '--project', '--workspace', '--base-url', '--client-id',
             '--workspace-id', '--path', '--machine-path', '--config', '--connection',
             '--after-create', '--after-done', '--format', '--project-connection'}
    index = 3
    while index < len(argv):
        key = argv[index]
        if key == '--dry-run':
            dry_run = True
            index += 1
            continue
        if key == '--online':
            online = True
            index += 1
            continue
        if key == '--yes':
            index += 1
            continue
        if key not in flags or key in values or index + 1 == len(argv):
            raise ValueError('Unsupported or repeated config flag: ' + key)
        values[key] = argv[index + 1]
        index += 2
    if values.get('--scope') not in {'machine', 'connection', 'project', 'all'}:
        raise ValueError('Explicit scope required')
    if online and values['--scope'] != 'machine':
        raise ValueError('Live authentication is not permitted')
    for key in ['--path', '--machine-path', '--config']:
        if key in values:
            values[key] = str(safe_path(root, values[key]))
    if '--base-url' in values and urlparse(values['--base-url']).hostname != 'setup.example.test':
        raise ValueError('Only the synthetic server URL is allowed')
    if '--connection' in values and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', values['--connection']):
        raise ValueError('Invalid connection identifier')
    values['--format'] = 'json'
    values.setdefault('--path', str(safe_path(root, 'project')))
    return argv[1:3] + [item for pair in values.items() for item in pair] + (['--dry-run'] if dry_run else [])
