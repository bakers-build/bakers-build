#!/usr/bin/env bash
# BB-469 D5/AC-5: a change under `.claude/skills/bakers-build/skills/**` must bump
# `.claude/skills/bakers-build/.claude-plugin/plugin.json`, or the frozen marketplace
# bundle a consumer project pins never refreshes and the change ships to
# nobody (BB-469's own root cause D5/candidate 3).
#
# Compares the diff between BASE_REF (default: origin/develop) and HEAD_REF
# (default: HEAD). Tolerates a version bump that already arrived from a
# sibling branch (D5's prior-art warning): the gate only asks that the diff
# TOUCHES plugin.json, not that the number moved by any particular amount —
# a sibling that already bumped to the same target nets to a no-op diff and
# still counts as "touched" because the merge itself brings the changed line.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BASE_REF="${BASE_REF:-origin/develop}"
HEAD_REF="${HEAD_REF:-HEAD}"
SKILLS_PATH='.claude/skills/bakers-build/skills/'
PLUGIN_JSON='.claude/skills/bakers-build/.claude-plugin/plugin.json'

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "FAIL: base ref '$BASE_REF' does not resolve (fetch it first)." >&2
  exit 1
fi

# HEAD_REF=HEAD (the default) diffs against the working tree, so uncommitted
# work is caught before it is committed; any other explicit ref diffs between
# two committed points.
if [ "$HEAD_REF" = 'HEAD' ]; then
  diff_range=("$BASE_REF")
else
  diff_range=("$BASE_REF"..."$HEAD_REF")
fi

changed="$(git diff --name-only "${diff_range[@]}" -- "$SKILLS_PATH")"

if [ -z "$changed" ]; then
  echo "PASS: no change under $SKILLS_PATH between $BASE_REF and $HEAD_REF."
  exit 0
fi

if git diff --name-only "${diff_range[@]}" -- "$PLUGIN_JSON" | grep -q .; then
  echo "PASS: $PLUGIN_JSON changed alongside $SKILLS_PATH."
  exit 0
fi

echo "FAIL: $SKILLS_PATH changed without $PLUGIN_JSON changing." >&2
echo "Changed skill files:" >&2
echo "$changed" | sed 's/^/  /' >&2
echo "Bump the version in $PLUGIN_JSON so consumer projects' cached bundle refreshes." >&2
exit 1
