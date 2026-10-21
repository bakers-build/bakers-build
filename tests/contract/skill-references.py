#!/usr/bin/env python3
"""Check disclosed local Markdown targets in the independently installed skill layout."""
from pathlib import Path
import re
import shutil
import tempfile

root = Path(__file__).resolve().parents[2] / '.claude/skills/bakers-build'
with tempfile.TemporaryDirectory() as directory:
    installed = Path(directory) / 'skills'
    shutil.copytree(root / 'skills', installed)
    skills = list(installed.glob('*/SKILL.md'))
    # Every skill directory carries its SKILL.md; the count itself is not a contract.
    assert skills and len(skills) == len([d for d in installed.iterdir() if d.is_dir()]), len(skills)
    count = 0
    for source in installed.rglob('*.md'):
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', source.read_text()):
            if not target.startswith(('./', '../', 'references/')) or '<' in target:
                continue
            path = target.split('#')[0]
            assert (source.parent / path).is_file(), (source.relative_to(installed), target)
            count += 1
    assert count >= 10, count
    assert (installed / 'init-project/references/WORKFLOW.template.md').read_bytes() == (
        root / 'templates/WORKFLOW.template.md').read_bytes()
    print(f'PASS {len(skills)} skills, {count} local references and packaged workflow template')
