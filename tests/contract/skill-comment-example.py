#!/usr/bin/env python3
"""Execute the documented tool-arguments writer; the Markdown body must arrive byte for byte."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
skill = root / '.claude/skills/bakers-build/skills/bb-workflow/references/tools.md'
source = Path(os.environ.get('COMMENT_SKILL', skill)).read_text()
command = re.search(r"\(`(jq -n --rawfile body <file\.md> [^`]*)`\)", source).group(1)
ticket = '2070d433-6bf3-4beb-883c-cbc0f33711c8'
content = '---\n- Grüße "quoted" `literal` $(touch SHOULD_NOT_EXIST)\n\n'
with tempfile.TemporaryDirectory() as directory:
    tmp = Path(directory)
    body = tmp / 'body.md'
    argv = command.replace('<file.md>', str(body)).replace('<ticket>', ticket)
    for case in ['absent-file', 'literal']:
        body.unlink(missing_ok=True)
        if case == 'literal':
            body.write_text(content)
        result = subprocess.run(['bash', '-eu', '-c', argv], cwd=tmp, capture_output=True, text=True)
        if case == 'literal':
            assert result.returncode == 0, result.stderr
            args = json.loads(result.stdout)
            assert args == {'ticket': ticket, 'type': 'plan', 'body': content}, args
            assert not (tmp / 'SHOULD_NOT_EXIST').exists()
        else:
            assert result.returncode != 0 and not result.stdout, case
        print('PASS', case)
