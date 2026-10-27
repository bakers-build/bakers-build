#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# docs/bakers/testing.md › Test users names exactly the accounts recipes/bb_e2e seeds.
#
#   bash tests/contract/test-users.sh
#
# CI runs it through bakers-cli/core/tests/workflow/repository-contracts.test.ts.
# A documented account is a table row in that section whose first cell is one
# backticked name; a seeded account is the `name` of a user content file.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

documented="$(awk '/^## Test users$/ { on = 1; next } on && /^## / { exit }
  on && /^\| `[^`]+` \|/ { split($0, cell, "`"); print cell[2] }' "$ROOT/docs/bakers/testing.md" | sort)"
seeded="$(for f in "$ROOT"/recipes/bb_e2e/content/user/*.yml; do
  awk '/^  name:/ { on = 1 } on && /value:/ { sub(/.*value: */, ""); gsub(/"/, ""); print; exit }' "$f"
done | sort)"

[ -n "$documented" ] || { echo "FAIL: docs/bakers/testing.md › Test users lists no account" >&2; exit 1; }
[ -n "$seeded" ] || { echo "FAIL: recipes/bb_e2e seeds no account" >&2; exit 1; }
if [ "$documented" != "$seeded" ]; then
  echo "FAIL: docs/bakers/testing.md › Test users and the seeded accounts differ (< documented only, > seeded only):" >&2
  diff <(echo "$documented") <(echo "$seeded") | grep '^[<>]' >&2
  exit 1
fi
echo "ok: $(echo "$seeded" | wc -l | tr -d ' ') test users documented and seeded"
