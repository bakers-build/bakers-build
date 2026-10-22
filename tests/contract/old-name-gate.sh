#!/usr/bin/env bash
set -euo pipefail

# The rename leaves no trace of the old product name. The exclusion list is the whole allowance:
# the upgrade guide names the old package on purpose, and the lockfile holds an integrity hash
# that happens to contain the letters. `g[a]ia` keeps this script out of its own matches.
#
# Run by `bakers-cli/core/tests/workflow/old-name-gate.test.ts`, so it fails core tests and CI.

cd "$(git rev-parse --show-toplevel)"
EXCLUDE=(
  ':!docs/advanced/cli/switch-to-bakers.md'
  ':!tests/skill-eval/package-lock.json'
)
if git grep -niE 'g[a]ia' -- . "${EXCLUDE[@]}"; then
  echo 'FAIL old product name found outside the exclusion list'
  exit 1
fi
echo 'PASS no old product name outside the exclusion list'
