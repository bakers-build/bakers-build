#!/usr/bin/env python3
"""Enforce the complete bakers.build SKILL.md word budget (including frontmatter/code)."""
from pathlib import Path
import sys


def violations(root: Path, limit: int = 500) -> list[tuple[Path, int]]:
    skills = sorted(root.glob('*/SKILL.md'))
    if not skills:
        raise ValueError(f'No skills found in {root}')
    return [(path, count) for path in skills
            if (count := len(path.read_text().split())) > limit]


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2] / '.claude/skills/bakers-build/skills'
    failures = violations(root)
    for path, count in failures:
        print(f'FAIL {path.relative_to(root)}: {count} words (maximum 500)')
    if failures:
        sys.exit(1)
    print(f'PASS {len(list(root.glob("*/SKILL.md")))} skills contain at most 500 words')
