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
    # A retired skill name in any skill text is a dangling reference the link check cannot see.
    retired = ('method-context', 'essential-skills', 'diagnose-ticket', 'workflow-step', 'recipe-matt', 'runtime-ddev', 'ddev-drupal-feature', 'ddev-drupal-bug', 'docs-authoring',
               'create-spec', 'provision-ddev')
    # Every skill carries the bb- prefix; an unprefixed name of a current skill is a stale reference.
    # Single-word names (init, acceptance, scenario) are also ordinary words and stay out.
    retired += tuple(p.parent.name[3:] for p in skills if p.parent.name.startswith('bb-') and '-' in p.parent.name[3:])
    for source in installed.rglob('*.md'):
        for name in re.findall(r'(?<![\w-])(' + '|'.join(retired) + r')(?![\w-])', source.read_text()):
            raise AssertionError((source.relative_to(installed), name))
    print(f'PASS {len(skills)} skills, {count} local references, no retired skill names')
