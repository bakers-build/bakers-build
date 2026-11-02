#!/usr/bin/env bash
# Exercise automatic fallback against real isolated Git repositories.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
die() { echo "$*" >&2; exit 1; }
say() { :; }
for name in test_branch_name workspace_has_branch select_workspace_branch parent_branch_for seed_fixture_origin; do
  body="$(awk -v fn="$name" '$0 == fn "() {" { inside=1 } inside { print } inside && /^}/ { exit }' "$ROOT/scripts/setup-test-project.sh")"
  [ -n "$body" ] || fail "missing $name"
  eval "$body"
done
[ "$(test_branch_name feat/shop-27-cart)" = shop-27 ] || fail 'current name is not derived'
[ "$(test_branch_name feat/shop-9-checkout)" = shop-9 ] || fail 'parent name is not derived'
[ "$(test_branch_name feature/plain-name)" = feature/plain-name ] || fail 'ordinary branch name was changed'
git init -q --bare "$TMP/remote.git"
git init -q -b develop "$TMP/seed"
git -C "$TMP/seed" config user.name Test
git -C "$TMP/seed" config user.email test@example.invalid
echo original > "$TMP/seed/WORKFLOW.md"
git -C "$TMP/seed" add WORKFLOW.md
git -C "$TMP/seed" commit -qm original
for branch in main shop-27 shop-9; do git -C "$TMP/seed" branch "$branch"; done
git -C "$TMP/seed" remote add origin "$TMP/remote.git"
git -C "$TMP/seed" push -q origin develop main shop-27 shop-9
git --git-dir="$TMP/remote.git" symbolic-ref HEAD refs/heads/main
git clone -q -b develop "$TMP/remote.git" "$TMP/work"
before="$(git -C "$TMP/work" rev-parse origin/main origin/develop)"
select_workspace_branch "$TMP/work" feat/shop-27-cart feat/shop-9-checkout
[ "$(git -C "$TMP/work" branch --show-current)" = shop-27 ] || fail 'current branch did not win'
echo custom > "$TMP/work/WORKFLOW.md"
select_workspace_branch "$TMP/work" feat/shop-27-cart feat/shop-9-checkout
[ "$(cat "$TMP/work/WORKFLOW.md")" = custom ] || fail 'rerun overwrote workflow'
if (select_workspace_branch "$TMP/work" feat/shop-28-other feat/shop-9-checkout) >/dev/null 2>&1; then fail 'switched with tracked edits'; fi
[ "$(git -C "$TMP/work" branch --show-current)" = shop-27 ] || fail 'failed checkout fell back silently'
git -C "$TMP/work" restore WORKFLOW.md
select_workspace_branch "$TMP/work" feat/shop-28-other feat/shop-9-checkout
[ "$(git -C "$TMP/work" branch --show-current)" = shop-9 ] || fail 'parent fallback failed'
select_workspace_branch "$TMP/work" feat/shop-28-other ''
[ "$(git -C "$TMP/work" branch --show-current)" = develop ] || fail 'no-parent fallback failed'
select_workspace_branch "$TMP/work" feat/shop-28-other feat/shop-29-missing
[ "$(git -C "$TMP/work" branch --show-current)" = develop ] || fail 'missing-parent-branch fallback failed'
! git -C "$TMP/work" show-ref --verify --quiet refs/heads/shop-28 || fail 'missing current branch was created'
[ "$(git -C "$TMP/work" rev-parse origin/main origin/develop)" = "$before" ] || fail 'shared branch moved'
[ "$(git --git-dir="$TMP/remote.git" show develop:WORKFLOW.md)" = original ] || fail 'remote workflow overwritten'
# The committed fixture tree becomes a local bare origin on develop, seeded once.
FIXTURE_BRANCH=develop
seed_fixture_origin "$ROOT/tests/fixtures/bakers-playground" "$TMP/fixture.git"
seeded="$(git --git-dir="$TMP/fixture.git" rev-parse develop)"
[ "$(git --git-dir="$TMP/fixture.git" symbolic-ref HEAD)" = refs/heads/develop ] || fail 'fixture origin HEAD is not develop'
git --git-dir="$TMP/fixture.git" cat-file -e develop:.bakers/conductor.config.js || fail 'fixture origin lacks the conductor config'
seed_fixture_origin "$ROOT/tests/fixtures/bakers-playground" "$TMP/fixture.git"
[ "$(git --git-dir="$TMP/fixture.git" rev-parse develop)" = "$seeded" ] || fail 'reseeding moved develop'
git clone -q -b develop "$TMP/fixture.git" "$TMP/playground"
[ "$(git -C "$TMP/playground" remote get-url origin)" = "$TMP/fixture.git" ] || fail 'clone origin is not the bare repository'
select_workspace_branch "$TMP/playground" feat/bakers-6-test ''
[ "$(git -C "$TMP/playground" branch --show-current)" = develop ] || fail 'fixture clone did not fall back to develop'
# Exercise the ticket lookup at its external command boundary.
bakers() {
  [ "$1 $2 $3" = 'tools tool_api__bakers_ticket_search --data' ] || return 99
  [ "$(jq -c . "${4#@}")" = '{"branch_name":"feat/shop-27-cart"}' ] || return 98
  printf '%s\n' "$LOOKUP_JSON"
}
LOOKUP_JSON='{"tickets":[{"identifier":"SHOP-27","base_branch":"feat/shop-9-checkout","parent":"SHOP-9"}]}'
[ "$(parent_branch_for feat/shop-27-cart)" = feat/shop-9-checkout ] || fail 'parent is not read from ticket metadata'
LOOKUP_JSON='{"tickets":[{"identifier":"SHOP-27","base_branch":"develop","parent":null}]}'
[ -z "$(parent_branch_for feat/shop-27-cart)" ] || fail 'root ticket invented a parent'
LOOKUP_JSON='{"error":{"message":"offline"}}'
if (parent_branch_for feat/shop-27-cart) >/dev/null 2>&1; then fail 'lookup error was treated as no parent'; fi
echo 'PASS: fixture origin seeding, dynamic names, current/parent/develop priority, no-parent case, preserved edits, lookup errors, no remote writes'
