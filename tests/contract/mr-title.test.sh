#!/usr/bin/env bash
# Cases for tests/contract/mr-title.sh; the CI job `mr_title` runs them before the real title.
set -uo pipefail

SCRIPT="$(dirname "${BASH_SOURCE[0]}")/mr-title.sh"
failures=0

expect() {
  local want="$1" title="$2" got=pass
  bash "$SCRIPT" "$title" >/dev/null 2>&1 || got=fail
  if [ "$got" = "$want" ]; then
    printf 'PASS %s: %s\n' "$want" "$title"
  else
    printf 'FAIL expected %s, got %s: %s\n' "$want" "$got" "$title"
    failures=$((failures + 1))
  fi
}

expect pass 'feat(stats): new vs. done flow chart'
expect pass 'fix: read the release version without a pipe'
expect pass 'feat(server)!: require client 0.2'
expect pass 'chore!: drop the label changelog'
expect pass 'ci(release/tag): tag the release commit'
expect fail 'Statistics: new vs. done flow chart'
expect fail 'feature(stats): new vs. done flow chart'
expect fail 'feat(Stats): new vs. done flow chart'
expect fail 'feat(stats):new vs. done flow chart'
expect fail 'feat(stats): '
expect fail 'Draft: feat(stats): new vs. done flow chart'
expect fail ''

# The failure names the rule.
refusal="$(bash "$SCRIPT" 'Statistics: new vs. done flow chart' 2>&1)"
grep -qF 'Rule: type(scope)!: subject' <<<"$refusal" \
  && printf 'PASS the refusal names the rule\n' \
  || { printf 'FAIL the refusal does not name the rule\n'; failures=$((failures + 1)); }

[ "$failures" -eq 0 ] || { printf '%d case(s) failed\n' "$failures"; exit 1; }
printf 'all cases passed\n'
