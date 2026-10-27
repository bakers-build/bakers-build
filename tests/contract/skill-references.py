#!/usr/bin/env python3
"""The one structure check of the bakers.build skills: names, links, the state × phase grid."""
from pathlib import Path
import re
import shutil
import tempfile

repo = Path(__file__).resolve().parents[2]
root = repo / '.claude/skills/bakers-build'
SKILLS = ('bb-create-project', 'bb-create-ticket', 'bb-init', 'bb-init-project', 'bb-prepare-time',
          'bb-recipe-deploy-and-release', 'bb-recipe-matt', 'bb-recipe-superpowers', 'bb-recipe-verify',
          'bb-runtime-ddev',
          'bb-scope-change', 'bb-upgrade-project', 'bb-verdict', 'bb-workflow')
STATES = ('qualification', 'plan', 'working', 'review')
PHASES = ('read', 'provision', 'work', 'validate', 'deliver', 'outtake', 'transition')
# Skills that became bb-workflow references or were deleted; none may be named anywhere.
RETIRED = ('bb-acceptance', 'bb-ensure-qualification', 'bb-merge-mr', 'bb-post-deployment',
           'bb-prepare-deployment', 'bb-publish-comment', 'bb-publish-origin-feedback',
           'bb-publish-origin-status', 'bb-qualify-ticket', 'bb-read-ticket', 'bb-record-measurement',
           'bb-resolve-environment', 'bb-review-ticket', 'bb-run-intake', 'bb-run-outtake', 'bb-scenario',
           'bb-summarize-verification', 'bb-transition-ticket', 'bb-verify-on-environment',
           'bb-verify-playwright-cli', 'bb-verify-tests')
# Pre-prefix names and current skills without `bb-`; matched in skill text only, where they can only
# mean a skill. Retired helpers' bare names are reference file names now.
UNPREFIXED = ('method-context', 'essential-skills', 'diagnose-ticket', 'workflow-step', 'ddev-drupal-feature',
              'ddev-drupal-bug', 'docs-authoring', 'create-spec', 'provision-ddev',
              *(n[3:] for n in SKILLS if '-' in n[3:]))
STATE_HEADING = re.compile(r'## (?:([a-z]+):)?bb-state-([a-z_]+)')
PHASE_HEADING = re.compile(r'#{2,3} bb-phase-([a-z_]+)')


def headings(text, level=None):
    lines = re.sub(r'```.*?```', '', text, flags=re.S).splitlines()
    return [l for l in lines if re.match(r'#{1,6} ', l) and (level is None or l.startswith('#' * level + ' '))]


def grid_errors(path, text, recipe=False):
    """Every bb-state/bb-phase heading names a real state, phase and declared type."""
    # Declared types are only the description's `of type X, Y or Z` clause.
    declared = re.search(r'^description:.*?\bof type ([a-z]+(?:, [a-z]+)*(?: or [a-z]+)?)', text, re.M)
    types = set(re.findall(r'[a-z]+', declared[1])) - {'or'} if declared else set()

    def valid(heading):
        state, phase = STATE_HEADING.fullmatch(heading), PHASE_HEADING.fullmatch(heading)
        if recipe and heading.startswith('## '):
            return bool(state) and state[2] in STATES and (not state[1] or state[1] in types)
        # A recipe nests phase slots under its state sections; hints and guides use them top-level.
        return bool(phase) and phase[1] in PHASES and heading.startswith('### ' if recipe else '## ')

    return [(path, h) for h in headings(text)
            if ('bb-state' in h or 'bb-phase' in h or (recipe and h[:3] in ('## ', '###'))) and not valid(h)]


def check(scan):
    errors = []
    installed = scan / 'skills'
    names = sorted(d.name for d in installed.iterdir() if d.is_dir())
    assert names == sorted(SKILLS), ('skills', names)
    assert all((installed / n / 'SKILL.md').is_file() for n in names)
    count = 0
    for source in installed.rglob('*.md'):
        text = source.read_text()
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
            if not target.startswith(('./', '../', 'references/', 'outtake/')) and not re.match(r'[\w-]+\.md', target) or '<' in target:
                continue
            if not (source.parent / target.split('#')[0]).is_file():
                errors.append((source.relative_to(installed), target))
            count += 1
        for name in re.findall(r'(?<![\w-])(' + '|'.join(UNPREFIXED) + r')(?![\w-])', text):
            errors.append((source.relative_to(installed), name))
        # Inputs are retired: lifecycle parameters are recipe prose or WORKFLOW.md hint tables.
        if re.search(r'^inputs:', text, re.M) or re.search(r'\b[a-z_]+\.(?:prompt|command)\b', text):
            errors.append((source.relative_to(installed), 'declares an input'))
    texts = [*installed.rglob('*.md'), *(scan / 'docs').rglob('*.md'), *(scan / 'fixtures').rglob('*.json'),
             scan / 'README.md', scan / 'WORKFLOW.md', scan / 'fixtures.json', scan / 'manual.mjs']
    for source in texts:
        for name in re.findall(r'(?<![\w-])(' + '|'.join(RETIRED) + r')(?![\w-])', source.read_text()):
            errors.append((source.relative_to(scan), name))
    for recipe in [*installed.glob('bb-recipe-*/SKILL.md'), *(scan / 'recipes').glob('bb-recipe-*.md')]:
        text = recipe.read_text()
        errors += grid_errors(recipe.relative_to(scan), text, recipe=True)
        # A recipe may live in any plugin: it links no frame reference and calls no other skill.
        if re.search(r'\]\([^)]*bb-workflow/', text) or re.search(r'@bakers-build/bb-(?!workflow\b)', text):
            errors.append((recipe.relative_to(scan), 'links a bakers.build reference or skill'))
    for guide in installed.glob('bb-runtime-*/SKILL.md'):
        errors += grid_errors(guide.relative_to(installed), guide.read_text())
    for hints in (scan / 'WORKFLOW.md', installed / 'bb-init-project/references/WORKFLOW.template.md'):
        text = hints.read_text()
        errors += grid_errors(hints.name, text)
        errors += [(hints.name, h) for h in headings(text, 2) if not PHASE_HEADING.fullmatch(h)]
    references = installed / 'bb-workflow/references'
    for state in STATES:
        found = [h[3:] for h in headings((references / f'{state}.md').read_text(), 2)]
        if found != list(PHASES):
            errors.append((f'{state}.md', f'phase headings {found}'))
        if not (references / 'outtake' / f'{state}.md').is_file():
            errors.append((f'outtake/{state}.md', 'missing'))
    frame = (installed / 'bb-workflow/SKILL.md').read_text()
    errors += [('bb-workflow/SKILL.md', h) for h in headings(frame, 2) if h[3:] in PHASES]
    errors += [('bb-workflow/SKILL.md', f'no link to {f}') for f in [*STATES, 'intake']
               if f'](references/{f}.md)' not in frame]
    for source in installed.rglob('*.md'):
        if source.name != 'SKILL.md' or source.parent.name != 'bb-workflow':
            if re.search(r'\]\([^)]*intake\.md', source.read_text()):
                errors.append((source.relative_to(installed), 'names the intake; only the frame reads it'))
    assert not errors, errors
    assert count >= 10, count
    return f'PASS {len(names)} skills, {count} local references, state × phase grid, no retired skill names'


def layout(directory):
    """Copy the plugin as installed, plus the repository texts that may not name a retired skill."""
    scan = Path(directory)
    shutil.copytree(root / 'skills', scan / 'skills')
    shutil.copytree(repo / 'docs', scan / 'docs')
    shutil.copytree(repo / 'tests/skill-eval/fixtures', scan / 'fixtures')
    shutil.copytree(repo / 'tests/skill-eval/recipes', scan / 'recipes')
    for source, name in ((root / 'README.md', 'README.md'), (repo / 'WORKFLOW.md', 'WORKFLOW.md'),
                         (repo / 'tests/skill-eval/fixtures.json', 'fixtures.json'),
                         (repo / 'website/.vitepress/manual.mjs', 'manual.mjs')):
        shutil.copy(source, scan / name)
    return scan


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as directory:
        print(check(layout(directory)))
