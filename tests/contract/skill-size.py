#!/usr/bin/env python3
"""Enforce the 500-word budget (frontmatter and code included) on every SKILL.md and frame reference."""
from pathlib import Path
import re
import sys
import tempfile


def violations(root: Path, limit: int = 500) -> list[tuple[Path, int]]:
    files = sorted([*root.glob('*/SKILL.md'), *root.glob('bb-workflow/references/**/*.md')])
    if not files:
        raise ValueError(f'No skills found in {root}')
    return [(path, count) for path in files
            if (count := len(path.read_text().split())) > limit]


STATE_LIMITS = {'qualification': 18000, 'plan': 12000, 'working': 19000, 'review': 15000}


def state_budgets(root: Path, limits=STATE_LIMITS):
    references = root / 'bb-workflow/references'
    totals = {}
    for state in limits:
        text = (references / f'{state}.md').read_text()
        match = re.search(r'^always: (.+)$', text, re.M)
        if not match:
            raise ValueError(f'{state}: missing always: reading list')
        names = match[1].split(', ')
        if len(names) != len(set(names)):
            raise ValueError(f'{state}: duplicate reference')
        totals[state] = sum((references / name).stat().st_size for name in names)
    return totals


def budget_report(totals, limits=STATE_LIMITS):
    return ', '.join(f'{state} {total / 1000:.1f}/{limits[state] / 1000:g} KB'
                     for state, total in totals.items())


def exceeds_budget(totals, limits=STATE_LIMITS):
    return any(total > limits[state] for state, total in totals.items())


def budget_self_check():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        references = root / 'bb-workflow/references'
        references.mkdir(parents=True)
        (references / 'plan.md').write_text('always: payload.md\n')
        (references / 'payload.md').write_bytes(b'x' * 12001)
        totals = state_budgets(root, {'plan': 12000})
        assert totals == {'plan': 12001}
        assert exceeds_budget(totals, {'plan': 12000})
        assert not exceeds_budget({'plan': 12000}, {'plan': 12000})
        assert budget_report(totals, {'plan': 12000}) == 'plan 12.0/12 KB'


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2] / '.claude/skills/bakers-build/skills'
    budget_self_check()
    failures = violations(root)
    totals = state_budgets(root)
    over_budget = exceeds_budget(totals)
    print(("FAIL " if over_budget else "PASS ") + budget_report(totals))
    for path, count in failures:
        print(f'FAIL {path.relative_to(root)}: {count} words (maximum 500)')
    if failures or over_budget:
        sys.exit(1)
    print(f'PASS {len(list(root.glob("*/SKILL.md")))} skills and '
          f'{len(list(root.glob("bb-workflow/references/**/*.md")))} frame references contain at most 500 words')
