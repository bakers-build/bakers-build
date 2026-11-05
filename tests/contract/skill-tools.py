#!/usr/bin/env python3
"""Skills call tracker operations as bakers tools, each named in the tools reference and served by Drupal."""
from pathlib import Path
import re
import sys

repo = Path(__file__).resolve().parents[2]
REFERENCE = 'bb-workflow/references/tools.md'
# Lookup, setup and time tools live in a sibling so each stays within the word budget.
TABLES = (REFERENCE, 'bb-workflow/references/tools-lookup.md')
# Hidden compatibility is executable but never a maintained skill transport, and
# neither is generic entity CRUD; the bare word dropsh stays legal for the library.
RETIRED_CALL = re.compile(
    r'\bbakers(?:-conductor)?\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*dropsh\b'
    r'|\bdropsh\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*(?:read|search|create|update|delete|schema)\b'
    r'|--(?:fields|label_names|bundle)\b|\bbb_[a-z_]+/bb_[a-z_]+/|/api/time\b')
TOOL = re.compile(r'\bbakers_[a-z_]+\b')


def violations(skills, modules):
    documented = {name for table in TABLES
                  for name in re.findall(r'^\| [^|]+ \| `(bakers_[a-z_]+)` \|', (skills / table).read_text(), re.M)}
    served = {m for path in modules.glob('*/src/Plugin/tool/Tool/*.php')
              for m in re.findall(r"^\s+id: '(bakers_[a-z_]+)'", path.read_text(), re.M)}
    errors = [f'{REFERENCE}: {name} is not a Drupal tool' for name in sorted(documented - served)]
    for path in sorted(skills.rglob('*.md')):
        rel, text = path.relative_to(skills).as_posix(), path.read_text()
        for line_no, line in enumerate(text.splitlines(), 1):
            if RETIRED_CALL.search(line):
                errors.append(f'{rel}:{line_no}: teaches the retired shell or /api/time instead of tools/auth')
            if re.search(r'`bakers tools\b|\bbakers tools\s+(?:tool_api__|<|--)', line) and rel != REFERENCE:
                errors.append(f'{rel}:{line_no}: shows the tool transport; only {REFERENCE} does')
            errors += [f'{rel}:{line_no}: {name} is not in {" or ".join(TABLES)}'
                       for name in TOOL.findall(line) if name not in documented]
    return documented, errors


if __name__ == '__main__':
    for command in ['bakers dropsh tool', 'bakers-conductor dropsh delete',
                    'bakers --connection work dropsh read', 'bakers --connection=work dropsh create --fields',
                    'bakers dropsh update --label_names', 'dropsh --format md search bb_ticket',
                    'run `dropsh delete` on it', 'list it with --bundle bb_ticket', 'pass --fields title',
                    'set --label_names ready', 'GET bb_ticket/bb_ticket/<uuid>', 'call /api/time']:
        assert RETIRED_CALL.search(command), command
    for command in ['bakers tools tool_api__bakers_ticket_read', 'bakers auth status', '@bakers-build/addon-dropsh',
                    'bakers tools tool_api__bakers_ticket_update --data @f.json', 'the dropsh library',
                    'a bb_ticket entity', '@dropsh/plugin-oauth2']:
        assert not RETIRED_CALL.search(command), command
    skills = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / '.claude/skills/bakers-build/skills'
    documented, errors = violations(skills, repo / 'web/modules/custom')
    for error in errors:
        print(f'FAIL {error}')
    if errors:
        sys.exit(1)
    print(f'PASS {len(documented)} tools in the reference, all served; no skill teaches the retired shell, generic CRUD or /api/time')
