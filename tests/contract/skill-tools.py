#!/usr/bin/env python3
"""Skills call tracker operations as bakers tools, each named in the tools reference and served by Drupal."""
from pathlib import Path
import re
import sys

repo = Path(__file__).resolve().parents[2]
REFERENCE = 'bb-workflow/references/tools.md'
# The JSON:API commands and the time controller the tools replaced.
RETIRED_CALL = re.compile(r'bakers dropsh (read|search|create|update|schema)\b|/api/time\b')
TOOL = re.compile(r'\bbakers_[a-z_]+\b')


def violations(skills, modules):
    reference = (skills / REFERENCE).read_text()
    documented = set(re.findall(r'^\| [^|]+ \| `(bakers_[a-z_]+)` \|', reference, re.M))
    served = {m for path in modules.glob('*/src/Plugin/tool/Tool/*.php')
              for m in re.findall(r"^\s+id: '(bakers_[a-z_]+)'", path.read_text(), re.M)}
    errors = [f'{REFERENCE}: {name} is not a Drupal tool' for name in sorted(documented - served)]
    for path in sorted(skills.rglob('*.md')):
        rel, text = path.relative_to(skills).as_posix(), path.read_text()
        for line_no, line in enumerate(text.splitlines(), 1):
            if RETIRED_CALL.search(line):
                errors.append(f'{rel}:{line_no}: calls JSON:API or /api/time instead of a tool')
            if 'bakers dropsh tool' in line and rel != REFERENCE:
                errors.append(f'{rel}:{line_no}: shows the tool transport; only {REFERENCE} does')
            errors += [f'{rel}:{line_no}: {name} is not in {REFERENCE}'
                       for name in TOOL.findall(line) if name not in documented]
    return documented, errors


if __name__ == '__main__':
    skills = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / '.claude/skills/bakers-build/skills'
    documented, errors = violations(skills, repo / 'web/modules/custom')
    for error in errors:
        print(f'FAIL {error}')
    if errors:
        sys.exit(1)
    print(f'PASS {len(documented)} tools in the reference, all served; no skill calls JSON:API or /api/time')
