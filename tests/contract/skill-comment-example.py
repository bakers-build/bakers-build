#!/usr/bin/env python3
"""Execute the documented writer against a recorder; no network or live writes."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
skill = root / '.claude/skills/bakers-build/skills/publish-comment/SKILL.md'
source = Path(os.environ.get('COMMENT_SKILL', skill)).read_text()
block = re.search(r'```bash\n(.*?)```', source, re.S).group(1)
# The caller supplies these values; execute every guard and the actual command.
block = re.sub(r'^(TICKET_UUID|COMMENT_TYPE|BODY_FILE)=.*\n', '', block, flags=re.M)
with tempfile.TemporaryDirectory() as directory:
    tmp = Path(directory)
    recorder = tmp / 'bakers'
    recorder.write_text('#!/usr/bin/env python3\nimport json,os,sys\n'
                        'open(os.environ["RECORDED"],"w").write(json.dumps(sys.argv[1:]))\n')
    recorder.chmod(0o755)
    body = tmp / 'body.md'
    output = tmp / 'args.json'
    content = '---\n- Grüße "quoted" `literal` $(touch SHOULD_NOT_EXIST)\n\n'
    env = {**os.environ, 'PATH': f'{tmp}:{os.environ["PATH"]}',
           'TICKET_UUID': '2070d433-6bf3-4beb-883c-cbc0f33711c8',
           'COMMENT_TYPE': 'comment', 'BODY_FILE': str(body), 'RECORDED': str(output)}
    for case in ['missing-ticket', 'missing-type', 'missing-path', 'absent-file', 'empty', 'whitespace', 'literal']:
        body.write_text(content)
        current = env.copy()
        if case.startswith('missing-'):
            current.pop({'missing-ticket': 'TICKET_UUID', 'missing-type': 'COMMENT_TYPE',
                         'missing-path': 'BODY_FILE'}[case])
        elif case == 'absent-file':
            body.unlink()
        elif case in ['empty', 'whitespace']:
            body.write_text('' if case == 'empty' else ' \t\n\n')
        output.unlink(missing_ok=True)
        result = subprocess.run(['bash', '-eu', '-c', block], env=current, cwd=tmp,
                                capture_output=True, text=True)
        if case == 'literal':
            assert result.returncode == 0, result.stderr
            args = json.loads(output.read_text())
            assert args.count('--body.value=' + content) == 1, args
            for field, value in [('--body.format', 'bb_rich'), ('--bb_comment_type', 'comment'),
                                 ('--ticket_id', env['TICKET_UUID'])]:
                assert args[args.index(field) + 1] == value
            assert not (tmp / 'SHOULD_NOT_EXIST').exists()
        else:
            assert result.returncode != 0 and not output.exists(), case
        print('PASS', case)
