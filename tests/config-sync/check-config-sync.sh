#!/usr/bin/env bash
# BB-407 — source config must be a semantic subset of config/sync.
#
#   bash tests/config-sync/check-config-sync.sh
#
# This suite is deliberately outside tests/contract: it is wired into its own
# `config_sync` job in .github/workflows/checks.yml and runs both the live green tree and a committed red fixture.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$ROOT/scripts/check-config-sync.php"
FIXTURE="$ROOT/tests/config-sync/fixtures/broken"
EXPECTED="$ROOT/tests/config-sync/fixtures/broken.expected.txt"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

php -l "$CHECKER"

green_output="$(php "$CHECKER" "$ROOT")"
case "$green_output" in
  'OK: '*" source config file(s) agree with config/sync.") ;;
  *)
    printf 'FAIL: unexpected current-tree output:\n%s\n' "$green_output" >&2
    exit 1
    ;;
esac
printf '%s\n' "$green_output"

set +e
php "$CHECKER" "$FIXTURE" >"$TMP_DIR/broken.actual.txt" 2>&1
broken_status=$?
set -e

if [ "$broken_status" -ne 1 ]; then
  printf 'FAIL: broken fixture exited %d, expected 1\n' "$broken_status" >&2
  cat "$TMP_DIR/broken.actual.txt" >&2
  exit 1
fi

diff -u "$EXPECTED" "$TMP_DIR/broken.actual.txt"
printf 'OK: broken fixture failed with every expected mismatch.\n'
