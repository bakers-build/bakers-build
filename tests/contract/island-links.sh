#!/usr/bin/env bash
set -euo pipefail

# BB-398 — the island link layer's file-observable half.
#
# Two groups. B1 asserts that exactly one htmx reaches a rendered page and that
# it is core's. B2 asserts that the GLOBAL link layer stays withdrawn (spec
# revision 2, D1/D2/D5): whether a link is an htmx link is a property of the
# component that renders it, not of every link in the product.
#
# B2 replaced a ledger rather than merely deleting one. Its predecessor
# enumerated the six theme templates and one core template that a render-layer
# alter could never reach — the measured limit of "every internal Drupal link is
# an HTMX link". That ledger bounded a rule that no longer exists, and the
# templates on it are no longer a gap in anything: they are simply links that
# are not island links. What criterion 2 asks for instead is that the removal be
# observable, because a deletion nothing guards is a deletion that grows back.
#
# Check 0 exists because B1 and B2 are almost entirely "no hit" assertions, and
# an enumeration that reached no files would report every one of them as PASS
# while inspecting no bytes. The pattern is inherited from the BB-378 suite;
# the reasoning is restated here so it survives its source.
#
# How to run — no DDEV environment and no theme build required; every check is a
# read of repository content:
#   bash tests/contract/island-links.sh
#
# Exit code is the verdict: 0 = every check passed, 1 = at least one failed.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THEME="$ROOT/web/themes/custom/bb_theme"
MODULE="$ROOT/web/modules/custom/island"
FAILED=0

check() {
  local label="$1"; shift
  if "$@"; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    FAILED=1
  fi
}

# ---------------------------------------------------------------- check 0
# The Twig enumeration is gone with the ledger it bounded; the non-vacuity guard
# moves to the module's own sources, which the B2 group reads. B1 reads only
# bb_theme.libraries.yml and package.json and never touched that enumeration.
#
# The threshold stays at 15 after the route-dependent fan-out took three files
# out of src/: the observed count is 19, so the floor still holds with room to
# spare. It is a floor against reading nothing, not a census.
php_count=$(find "$MODULE/src" -name '*.php' | wc -l | tr -d ' ')
check "0. the enumeration reaches the module's PHP sources ($php_count found)" \
  test "$php_count" -gt 15
check "0. the libraries file is readable" test -r "$THEME/bb_theme.libraries.yml"

# ---------------------------------------------------------------- B1
# Comment lines are stripped before the search: the library file EXPLAINS what
# was removed and why, and prose cannot declare an asset. What this catches is a
# real `<path>/htmx*.js` entry reappearing under `js:` in any library.
check "B1. the theme declares no htmx asset of its own" \
  bash -c "! grep -vE '^[[:space:]]*#' '$THEME/bb_theme.libraries.yml' | grep -qE 'htmx[^ ]*\.js'"
check "B1. the theme depends on core/drupal.htmx" \
  grep -qF 'core/drupal.htmx' "$THEME/bb_theme.libraries.yml"
check "B1. no vendored htmx source remains" \
  bash -c "! test -e '$THEME/js/htmx.src.js'"
check "B1. no duplicate behaviours bridge remains" \
  bash -c "! test -e '$THEME/js/htmx-behaviors.js'"
check "B1. htmx.org is not a theme dependency" \
  bash -c "! grep -q '\"htmx.org\"' '$THEME/package.json'"

# ---------------------------------------------------------------- B2
# The global link layer is withdrawn (spec revision 2, D1/D2/D5). Every check
# here is an ABSENCE, which is exactly why check 0 exists: an enumeration that
# reached no files would report all of them as PASS while reading nothing.
# The module ROOT, not just src/. A procedural island_element_info_alter() in
# island.module is a working global link alter, and Drupal loads it without any
# class under src/ existing — so a check that reads only src/ cannot see the
# cheapest way to bring the withdrawn mechanism back. The file-type filter and
# the node_modules exclusion keep it an absence check that finishes instantly:
# tests/e2e/node_modules is ~200 MB of JavaScript and none of it is a Drupal
# hook implementation.
check "B2. no element_info_alter on link remains" \
  bash -c "! grep -rq --include='*.php' --include='*.module' --include='*.inc' --include='*.install' --include='*.theme' --exclude-dir=node_modules 'element_info_alter' '$MODULE'"
check "B2. the link decorator is gone" \
  bash -c "! test -e '$MODULE/src/Render/IslandLinkDecorator.php'"
check "B2. the theme-scope collaborator is gone" \
  bash -c "! test -e '$MODULE/src/IslandThemeScope.php'"
check "B2. neither service is declared" \
  bash -c "! grep -qE 'island\.(link_decorator|theme_scope)' '$MODULE/island.services.yml'"
# The `test -f` is not decoration. `grep` on a missing file exits 2, and the
# leading `!` turns that into a PASS — so a rename of IslandWrapper.php would
# make this check go quiet instead of failing. Check 0's floor does not cover
# it: it counts src/*.php, which stays 19 through a rename.
check "B2. no module-owned content-island id remains" \
  bash -c "test -f '$MODULE/src/IslandWrapper.php' && ! grep -q 'CONTENT_ID' '$MODULE/src/IslandWrapper.php'"
# Comment lines are stripped first, for the reason B1 strips them: a table is
# CODE, and the sources explain the prohibition in prose that would otherwise
# trip it.
#
# The expression names a table the way PHP spells one: an identifier whose
# stem is `route` or `path` and whose tail is `table`, `map` or `islands`, in
# any casing — `$route_map`, `$routeMap`, `ROUTE_TABLE`, `$routeIslands` — plus
# the reverse reading `islandsByRoute`. The letter class `[a-zA-Z_]*` is what
# keeps it honest in both directions: it cannot cross a space, a comma or a
# `$`, so `table` inside `TranslatableMarkup` is unreachable from the `$route_`
# parameters that share a line with it in both builders' signatures.
#
# Its predecessor asserted nothing. `route[a-z_]*\b.*\b(table|map)\b` let
# `route[a-z_]*` consume the very word being hunted, so a SECOND `table` or
# `map` was required on the line and never present — every spelling above
# passed. Verified here by planting each of them and watching this check report
# FAIL, under GNU grep 3.12 and ugrep 7.5 alike, because `grep` in an
# interactive shell on a developer machine is not always the `grep` a script
# gets.
#
# Naming alone would still be a guard around a spelling: `match ($route_name)
# { 'a.b' => '#island-a' }` is a route-to-island table under any name. Hence
# the second half of the expression, which reads the CONSTRUCT — a match or
# switch whose subject is a route. And hence island.module beside src/, for the
# same reason the element_info check above reads the module root: a table put
# in a procedural file would otherwise be unscanned.
#
# The scan is the IMPLEMENTATION only, deliberately — not tests/. A host
# fixture mapping a route to an active-trail LABEL (island_example's
# TaskHostProvider) is exactly what D4 says a host owns, and is not the thing
# criterion 4 prohibits.
#
# `--include='*.module'` is load-bearing and was found the hard way: grep
# applies its include filter to an explicitly named FILE too, not only to what
# a recursive walk turns up. Without it, island.module is handed to grep and
# then silently skipped for not being *.php — the check reads the wider scope
# and inspects none of it. Planted and observed.
check "B2. no route-to-island or per-link-kind table exists" \
  bash -c "! grep -rhs --include='*.php' --include='*.module' -vE '^[[:space:]]*(//|\*|/\*)' '$MODULE/src' $MODULE/*.module | grep -qiE '(route|path)[a-zA-Z_]*(table|map|islands)|islands_?by_?route|per-link|(match|switch)[[:space:]]*\([^)]*route'"

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf 'island-links: FAILED\n'
  exit 1
fi
printf 'island-links: all checks passed\n'
