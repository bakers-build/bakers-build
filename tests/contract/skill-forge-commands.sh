#!/usr/bin/env bash
# Forge operations in the bakers.build skills and WORKFLOW.md run through the forge tools
# (bb-workflow/references/forge.md), so no skill text spells out a forge command line.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pattern='git push|git fetch|gh pr |gh api|glab mr |glab ci status|merge_requests/[^ ]*/merge|pulls/[^ ]*/merge'

hits="$(cd "$root" && grep -rnE "$pattern" --include='*.md' .claude/skills/bakers-build WORKFLOW.md)"
if [ -n "$hits" ]; then
  printf 'FAIL forge command lines; name the operation and point to bb-workflow/references/forge.md:\n%s\n' "$hits"
  exit 1
fi
printf 'PASS no forge command lines in the skills or WORKFLOW.md\n'
