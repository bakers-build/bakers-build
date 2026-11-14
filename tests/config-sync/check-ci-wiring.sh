#!/usr/bin/env bash
# BB-407 — the semantic config gate must remain an independent pull-request job that gates merges.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="${1:-$ROOT/.github/workflows/checks.yml}"
# Body of one top-level job: the lines between its key and the next job key.
job() { sed -n "/^  $1:\$/,/^  [A-Za-z0-9_.-]*:/{/^  [A-Za-z0-9_.-]*:/!p}" "$CI"; }
JOB="$(job config_sync)"
REQUIRED="$(job required)"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

[ -n "$JOB" ] || fail 'config_sync job is missing'
if grep -q '^    needs:' <<<"$JOB"; then
  fail 'config_sync is not an independent job'
fi
grep -q '^    if: \*checks$' <<<"$JOB" || fail 'config_sync does not run for pull requests'
grep -q '^      - config_sync$' <<<"$REQUIRED" || fail 'config_sync is not required'
grep -q 'bash tests/config-sync/check-config-sync.sh' <<<"$JOB" || fail 'config_sync does not run the semantic harness'
grep -q 'bash tests/config-sync/check-ci-wiring.sh' <<<"$JOB" || fail 'config_sync does not run the wiring guard'
if grep -q 'tests/contract/' <<<"$JOB"; then
  fail 'config_sync is incorrectly routed through tests/contract'
fi

printf 'OK: config_sync is an independent, required pull-request job.\n'
