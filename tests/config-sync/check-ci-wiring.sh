#!/usr/bin/env bash
# BB-407 — the semantic config gate must remain an independent every-push job.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI="$ROOT/.gitlab-ci.yml"
JOB="$(awk '
  /^config_sync:$/ { in_job = 1 }
  in_job && /^[A-Za-z0-9_.-]+:$/ && $0 != "config_sync:" { exit }
  in_job { print }
' "$CI")"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

[ -n "$JOB" ] || fail 'config_sync job is missing'
grep -q '^  stage: test$' <<<"$JOB" || fail 'config_sync is not in the test stage'
grep -q '^  needs: \[\]$' <<<"$JOB" || fail 'config_sync is not an independent DAG job'
grep -q 'CI_PIPELINE_SOURCE == "push"' <<<"$JOB" || fail 'config_sync does not run on pushes'
grep -q 'CI_PIPELINE_SOURCE == "merge_request_event"' <<<"$JOB" || fail 'config_sync does not run for merge requests'
grep -q 'bash tests/config-sync/check-config-sync.sh' <<<"$JOB" || fail 'config_sync does not run the semantic harness'
grep -q 'bash tests/config-sync/check-ci-wiring.sh' <<<"$JOB" || fail 'config_sync does not run the wiring guard'
if grep -q 'tests/contract/' <<<"$JOB"; then
  fail 'config_sync is incorrectly routed through tests/contract'
fi

printf 'OK: config_sync is an independent push and merge-request job.\n'
