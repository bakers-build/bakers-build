#!/usr/bin/env python3
"""Enforce the 500-word budget (frontmatter and code included) on every SKILL.md and frame reference."""
from pathlib import Path
import sys

# Read only at an eligible terminal decision, as one unit; splitting it would add a pointer, not clarity.
EXCEPTIONS = ('bb-workflow/references/retrospective.md',)


def violations(root: Path, limit: int = 500) -> list[tuple[Path, int]]:
    files = sorted([*root.glob('*/SKILL.md'), *root.glob('bb-workflow/references/**/*.md')])
    if not files:
        raise ValueError(f'No skills found in {root}')
    return [(path, count) for path in files
            if path.relative_to(root).as_posix() not in EXCEPTIONS
            and (count := len(path.read_text().split())) > limit]


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2] / '.claude/skills/bakers-build/skills'
    failures = violations(root)
    for path, count in failures:
        print(f'FAIL {path.relative_to(root)}: {count} words (maximum 500)')
    if failures:
        sys.exit(1)
    print(f'PASS {len(list(root.glob("*/SKILL.md")))} skills and '
          f'{len(list(root.glob("bb-workflow/references/**/*.md")))} frame references contain at most 500 words')
