#!/usr/bin/env bash
set -euo pipefail

# BB-336 — the run detail overlay, opened from the ticket detail.
#
# What this proves. Before this ticket a bb_run was rendered ONLY as a row, `error_log` was
# rendered nowhere, and the state derivation collapsed `running` and `done` onto one tone while
# branching on two states (`released`, `dispatched`) that bb_core.workflows.yml does not define.
# This suite asserts the file-observable half of the fix: the view-mode split happened in both
# directions, both mappings give every canonical state its own glyph and AGREE on which, each glyph
# resolves in the BUILT sprite, the overlay scene uses the dialog hull and carries none of the
# add/edit widget grammar, and the Runs section is gone with no pointer left behind.
#
# WHAT THIS SUITE ASSERTED AND NO LONGER CAN. BB-336 first shipped three components —
# `run_state_badge`, `log_viewer`, `run_detail` — and this file checked their files, their per-state
# stories and their Twig glyph map. BB-389 then made two of them illegal: `run_state_badge`
# addressed the deleted `status-dot` (its B6), and `run_detail` was a DISPLAY component whose props
# were `run_state`, `conductor` and `state_at_start` (its B10, "no component knows a bakers.build concept").
# Both dissolved into the mapping, the way the run row did. The CLAIMS survive the components: every
# state still has its own glyph, and the two places that now hold the map are compared against each
# other here — which is a weaker guarantee than one shared component, and is why it is asserted
# rather than assumed.
#
# What this suite deliberately does NOT prove. C1 (the overlay renders above the ticket detail on
# sample data), C2's perceptual half (five states TELLABLE APART, read in greyscale) and C5's
# perceptual half (it reads as read-only) are observations of a rendered frame. A wrong view_mode
# renders an EMPTY component rather than erroring (spec R1), so C4 in particular cannot be settled
# here. Those are read in Storybook; this file is the floor beneath them.
#
# Seven groups of checks:
#   0. the enumeration this suite searches actually reaches the theme's files. Groups 6 and 7 are
#      "no hit" assertions, so an enumeration returning nothing would report PASS while inspecting
#      no bytes — and errexit is suppressed inside check()'s `if "$@"`, so nothing else would
#      notice.
#   1. C3 — `log-viewer`, the one component of this ticket's making that survived BB-389, exists.
#   2. C2 — both mappings map every canonical state.
#   3. C2 — the glyph map is complete in BOTH mappings, the two AGREE on all five, neither branches
#      on `released` or `dispatched`, and each glyph resolves in the BUILT sprite. Asserting only
#      the icon SOURCES would pass on a stale dist/ — the failure spec R2 names.
#   4. C4/D2 — the view-mode split: `teaser` is the row (a `list` of cells),
#      `full` is the canonical page body (summary + activity, no log), `overlay`
#      is the dialog body (zones and a log), and the ticket mapping renders its
#      runs at `teaser`.
#   5. C3/C5 — the overlay scene references the shell, fills the overlay slot with the dialog hull,
#      reaches `log-viewer`, and carries NONE of the add/edit widget grammar.
#   6. C6 — the Runs section is gone and no file under the theme points a reader at one.
#   7. C2 regression — no mapping under entity-mapping/ still branches on a dead state.
#
# How to run — no DDEV environment and no Drupal bootstrap required. Group 3 DOES need the theme to
# have been built once, because dist/ is a build artifact and is not committed:
#   cd web/themes/custom/bb_theme && pnpm install && pnpm build
#   bash tests/contract/run-detail-overlay.sh
#
# Exit code is the verdict: 0 = every check passed, 1 = at least one failed.
#
# Runs on bash 3.2 (macOS /bin/bash): no `mapfile`, no `declare -A`.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THEME="$ROOT/web/themes/custom/bb_theme"
COMPONENTS="$THEME/components"
DESIGNBOOK="$THEME/designbook"
MAPPING="$DESIGNBOOK/entity-mapping"
SPRITE="$THEME/dist/assets/icons/sprite.svg"
TICKETS_SCENES="$DESIGNBOOK/sections/tickets/tickets.section.scenes.yml"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# The five canonical bb_run states (bb_core.workflows.yml > bb_run > states) and the glyph
# each one carries (spec D6). `released` and `dispatched` are deliberately absent: the workflow
# does not define them, and group 7 asserts no mapping still branches on them.
STATES='claimed running done expired failed'
GLYPHS='lock run check clock alert-triangle'

# ONE component, not three. BB-336 shipped `run_state_badge`, `log_viewer` and `run_detail`;
# BB-389 rejected two of them and they dissolved into the mapping the way the run row did —
# `run_state_badge` addressed the deleted `status-dot` (B6) and `run_detail` was a DISPLAY component
# whose props were called `run_state`, `conductor` and `state_at_start` (B10). What survives is the
# one that knows nothing about runs: a log is a block of text with a caption.
NEW_COMPONENTS='log-viewer'

# Every source file of the theme that is repository content, EXCEPT designbook/workflows/. Those
# are the Designbook workflow runtime's archived task files: they legitimately quote pre-change
# values as the record of what a past run submitted, so group 6 would read them as surviving
# pointers and fail on files nobody may edit. Same rationale bb-330-shell-components.sh states
# for its own enumeration.
theme_sources() {
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- "$THEME" |
    grep -v '/designbook/workflows/' |
    while IFS= read -r rel; do
      [ -f "$ROOT/$rel" ] && printf '%s\n' "$ROOT/$rel"
    done
}

theme_hits() {
  theme_sources | while IFS= read -r file; do
    grep -Hni -e "$1" "$file" 2>/dev/null || true
  done
}

file_exists() {
  local file="$1"
  [ -f "$file" ] || { printf '  missing file: %s\n' "${file#"$ROOT"/}"; return 1; }
}

file_contains() {
  local file="$1" needle="$2"
  [ -f "$file" ] || { printf '  missing file: %s\n' "${file#"$ROOT"/}"; return 1; }
  grep -q -e "$needle" "$file" || { printf '  %s does not contain: %s\n' "${file#"$ROOT"/}" "$needle"; return 1; }
}

file_lacks() {
  local file="$1" needle="$2"
  [ -f "$file" ] || { printf '  missing file: %s\n' "${file#"$ROOT"/}"; return 1; }
  grep -q -e "$needle" "$file" && { printf '  %s still contains: %s\n' "${file#"$ROOT"/}" "$needle"; return 1; }
  return 0
}

# "This file does not point a reader at the Runs section" — satisfied either by the pointer being
# rewritten or by the file being gone. BB-315 deleted the dashboard and conductors sections
# outright, and a deleted file carries no pointer at all; `file_lacks` would report FAIL for the
# missing file and turn the stronger outcome into a red check. The theme-wide `runs_pointers`
# assertion below is what keeps this honest — this pair is a named floor under it, not the whole
# claim, so accepting absence here cannot hide a pointer that moved somewhere else.
file_absent_or_lacks() {
  local file="$1" needle="$2"
  [ -f "$file" ] || return 0
  grep -q -e "$needle" "$file" && { printf '  %s still contains: %s\n' "${file#"$ROOT"/}" "$needle"; return 1; }
  return 0
}

path_absent() {
  local path="$1"
  [ -e "$path" ] && { printf '  still present: %s\n' "${path#"$ROOT"/}"; return 1; }
  return 0
}

# The `run-detail` scene of the Tickets section file, from its own `- name:` to the next one (or to
# EOF). Group 5 reads this and never the whole file — see the note there.
run_detail_scene() {
  awk '/^  - name: run-detail$/{inscene=1; next} inscene && /^  - name: /{inscene=0} inscene' \
    "$TICKETS_SCENES"
}

scene_contains() {
  # Not `grep -q`: it exits on the first match, awk takes SIGPIPE, and pipefail turns a found
  # needle into a failure whenever the match comes early enough in a long scene.
  run_detail_scene | grep -e "$1" >/dev/null || { printf '  run-detail scene does not contain: %s\n' "$1"; return 1; }
}

# A negative assertion over an EMPTY extract is vacuously true, which is the same trap check 0
# exists for one level up: before the scene is written these four would report PASS while reading
# nothing. So the extract must be non-empty before "does not contain" means anything.
scene_lacks() {
  [ -n "$(run_detail_scene)" ] || { printf '  run-detail scene is empty — nothing to assert against\n'; return 1; }
  run_detail_scene | grep -q -e "$1" && { printf '  run-detail scene still contains: %s\n' "$1"; return 1; }
  return 0
}

# The view mode the ticket mapping renders its runs at. It must be read as a TWO-LINE WINDOW: since
# BB-335 the Run history is a count-driven $map whose node spans several lines, and `"view_mode":
# "full"` also appears twice for bb_comment in the same file — so a single-line grep for either
# the entity or the view mode answers the wrong question. Prints the empty string if the node is
# gone, which fails the comparison rather than passing it silently.
ticket_run_view_mode() {
  grep -A 1 '"entity": "bb_run.bb_run"' "$MAPPING/bb_ticket.bb_ticket.full.jsonata" |
    grep '"view_mode"' |
    sed 's/.*"view_mode": *"\([a-z_]*\)".*/\1/' |
    head -1
}

# The `bb_run:` entity block of data-model.yml, from its own key to the next entity key at the
# same indent. Needed because a bare `grep teaser data-model.yml` already passes today —
# bb_ticket has a teaser view mode — so an unscoped check would report PASS while proving
# nothing about bb_run. A dry run of this suite is what surfaced that.
bb_run_block() {
  awk '/^  bb_run:$/{inblock=1} inblock && /^  [a-z_]+:$/ && !/^  bb_run:$/{inblock=0} inblock' \
    "$DESIGNBOOK/data-model.yml"
}

# --- 0. the enumeration reaches real files ------------------------------------------------------
echo '--- 0. enumeration guard'
enumerated="$(theme_sources | wc -l | tr -d ' ')"
check "theme_sources enumerates more than 50 files (got $enumerated)" test "$enumerated" -gt 50

# --- 1. the three new components exist ----------------------------------------------------------
echo '--- 1. new components (C2, C3)'
for c in $NEW_COMPONENTS; do
  check "$c.component.yml exists" file_exists "$COMPONENTS/$c/$c.component.yml"
  check "$c.twig exists" file_exists "$COMPONENTS/$c/$c.twig"
done

# --- 2. every canonical state is mapped, on both surfaces -----------------------------------------
echo '--- 2. per-state coverage (C2)'
# The five per-state STORIES are gone with the components that carried them. The claim they made —
# every canonical state is rendered, and rendered distinguishably — did not go with them: it is now
# a property of the two mappings, which group 3 and group 4 assert directly. A story file cannot be
# the evidence for a state whose component no longer exists.
for s in $STATES; do
  check "the teaser maps $s" file_contains "$MAPPING/bb_run.bb_run.teaser.jsonata" "\"$s\" ?"
  check "the overlay maps $s" file_contains "$MAPPING/bb_run.bb_run.overlay.jsonata" "\"$s\" ?"
done

# --- 3. the glyph map is complete and resolves in the BUILT sprite -------------------------------
echo '--- 3. glyph map + built sprite (C2, R2)'
# THE GLYPH MAP LIVES IN THE TWO MAPPINGS. It used to live in one component, which is what made it
# indivisible; BB-389 dissolved both consumers into mappings, and a JSONata mapping cannot import
# from another. So the guarantee is asserted instead of structural: each mapping must map all five,
# neither may branch on a state the workflow does not define, and the two must AGREE.
badge_glyph() { sed -n "s/.*\"$1\" ? \"\([a-z-]*\)\".*/\1/p" "$MAPPING/bb_run.bb_run.overlay.jsonata" | head -1; }
teaser_glyph() { sed -n "s/.*\"$1\" ? \"\([a-z-]*\)\".*/\1/p" "$MAPPING/bb_run.bb_run.teaser.jsonata" | head -1; }
glyph_maps_agree() {
  local rc=0 st a b
  for st in $STATES; do
    a="$(badge_glyph "$st")"; b="$(teaser_glyph "$st")"
    if [ -z "$a" ] || [ -z "$b" ] || [ "$a" != "$b" ]; then
      printf '  %s: the overlay says "%s", the teaser says "%s"\n' "$st" "$a" "$b"
      rc=1
    fi
  done
  return "$rc"
}
check "the two glyph maps agree on all five states" glyph_maps_agree
for dead in released dispatched; do
  check "the teaser has no $dead branch" file_lacks "$MAPPING/bb_run.bb_run.teaser.jsonata" "\"$dead\" ?"
  check "the overlay has no $dead branch" file_lacks "$MAPPING/bb_run.bb_run.overlay.jsonata" "\"$dead\" ?"
done
check "clock icon source exists" file_exists "$THEME/assets/icons/src/clock.svg"
for g in $GLYPHS; do
  check "glyph $g resolves in the built sprite" file_contains "$SPRITE" "id=\"$g\""
done

# --- 4. the view-mode split, in both directions --------------------------------------------------
echo '--- 4. view-mode split (C4, D2)'
check "bb_run teaser mapping exists" file_exists "$MAPPING/bb_run.bb_run.teaser.jsonata"
# The row is a `list` item since BB-389, not a `run_row`. The split itself is unchanged and is
# still what C4 is about: one view mode cannot be both a listing's item and a dialog's body.
check "bb_run teaser emits a list container" file_contains "$MAPPING/bb_run.bb_run.teaser.jsonata" 'NAMESPACE:list'
check "bb_run teaser carries a state badge cell" file_contains "$MAPPING/bb_run.bb_run.teaser.jsonata" '"kind": "badge"'
check "bb_run full is the canonical body (summary zone)" file_contains "$MAPPING/bb_run.bb_run.full.jsonata" 'Latest ticket summary'
check "bb_run full is the canonical body (activity empty-state)" file_contains "$MAPPING/bb_run.bb_run.full.jsonata" 'No activity for this run'
check "bb_run full does not carry the log viewer" file_lacks "$MAPPING/bb_run.bb_run.full.jsonata" 'NAMESPACE:log-viewer'
check "bb_run overlay mapping exists" file_exists "$MAPPING/bb_run.bb_run.overlay.jsonata"
check "bb_run overlay composes the detail from generic containers" file_contains "$MAPPING/bb_run.bb_run.overlay.jsonata" 'NAMESPACE:zone'
check "bb_run overlay carries the log" file_contains "$MAPPING/bb_run.bb_run.overlay.jsonata" 'NAMESPACE:log-viewer'
# C2 on the new model. The badge cell's TONE is colour, so a state told only by its tone is a state
# a colour-blind reader cannot read — and the mapping BB-389 shipped collided `running` and `done`
# on one tone. Assert the glyph per state, and assert the five tones are DISTINCT.
for s in $STATES; do
  check "the teaser maps $s to a glyph" file_contains "$MAPPING/bb_run.bb_run.teaser.jsonata" "\"$s\" ? \""
done
check "the teaser's five state tones are all different" \
  test "$(sed -n '/\$tone :=/,/;$/p' "$MAPPING/bb_run.bb_run.teaser.jsonata" | grep -oE '\? "[a-z]+"' | sort -u | wc -l | tr -d ' ')" -eq 5
check "data-model declares a teaser view mode ON bb_run" \
  test "$(bb_run_block | grep -c 'teaser:' || true)" -eq 1
check "data-model declares an overlay view mode ON bb_run" \
  test "$(bb_run_block | grep -c 'overlay:' || true)" -eq 1
check "ticket mapping renders its runs at view_mode teaser (got '$(ticket_run_view_mode)')" \
  test "$(ticket_run_view_mode)" = "teaser"
check "the pinned facts render five runs for ticket 1" \
  test "$(grep -c '"runs": 5' "$MAPPING/bb_ticket.bb_ticket.full.jsonata" || true)" -eq 1

# --- 5. the overlay scene, and the grammar it must NOT use ---------------------------------------
echo '--- 5. the overlay scene (C3, C5, D1, D9)'
# EVERY check in this group reads the run-detail scene ALONE, never the whole file. Since BB-335
# the Tickets file holds ten scenes, four of them dialogs built on the add/edit widget grammar — so
# an unscoped `overlay:` / `bb_theme:dialog` / `entity: bb_ticket.bb_ticket` needle passes
# before this ticket writes a line, and an unscoped "carries no option_picker" needle FAILS on
# ticket-create, which is supposed to have one. Scoping is what makes this group mean anything.
scene_lines="$(run_detail_scene | wc -l | tr -d ' ')"
check "the run-detail scene exists in the tickets section file (got $scene_lines lines)" \
  test "$scene_lines" -gt 10
check "the scene fills the page overlay slot" scene_contains 'overlay:'
check "the scene uses the dialog hull" scene_contains 'bb_theme:dialog'
check "the scene puts the ticket detail underneath" scene_contains 'entity: bb_ticket.bb_ticket'
check "the scene selects a failed run" scene_contains "state='failed'"
# The claim is unchanged — the scene must not duplicate the chrome — but what "not duplicating"
# looks like changed with BB-378. It used to mean reusing this file's `*tickets_shell_*` YAML
# anchors, because a REFERENCED scene could not take an overlay without printing a literal `$var`.
# BB-378 deleted `page` and fixed that, so every scene in this file now REFERENCES the shell, and
# the anchors it used to alias no longer exist.
check "the scene references the shell rather than duplicating it" scene_contains 'design-system:shell'
check "the overlay reaches log-viewer" file_contains "$MAPPING/bb_run.bb_run.overlay.jsonata" 'NAMESPACE:log-viewer'
check "the overlay scene selects the overlay view mode" scene_contains 'view_mode: overlay'
for w in option_picker text_line property_row; do
  check "the run-detail scene carries no $w (C5)" scene_lacks "$w"
done
# C5's structural half: the hull renders no action row when its actions slot is unfilled.
check "the run-detail scene fills no actions slot (C5)" scene_lacks 'actions:'

# --- 6. the Runs section is gone, with no pointer left behind ------------------------------------
echo '--- 6. the Runs section is gone (C6)'
check "sections/runs/ is gone" path_absent "$DESIGNBOOK/sections/runs"
check "the superseded design-screen plan is gone" path_absent "$DESIGNBOOK/plans/design-screen/runs.plan.md"
check "the dashboard flow no longer points at the section" file_absent_or_lacks "$DESIGNBOOK/sections/dashboard/dashboard.section.scenes.yml" "Runs section"
check "the conductors flow no longer points at the section" file_absent_or_lacks "$DESIGNBOOK/sections/conductors/conductors.section.scenes.yml" "Runs section"
# The enumeration wraps across a line break ("… the board, the runs\nlist and …"), so the needle
# is the line-6 fragment, not the phrase. `grep "runs list"` passes today and proves nothing.
check "action-pattern.md no longer enumerates the runs list" file_lacks "$DESIGNBOOK/design-system/action-pattern.md" "the board, the runs"
check "action-pattern.md carries the rewritten enumeration" file_contains "$DESIGNBOOK/design-system/action-pattern.md" "the board and the"
# The POINTING forms only. "the Runs section was abolished" is the opposite of a pointer, and the
# overlay scene's docs says exactly that.
runs_pointers="$(theme_hits "in the runs section\|runs section's" | wc -l | tr -d ' ')"
check "no file under the theme points a reader at a Runs section (got $runs_pointers)" test "$runs_pointers" -eq 0

# --- 7. no mapping branches on a state the workflow does not define ------------------------------
echo '--- 7. dead state branches are gone (C2)'
for dead in released dispatched; do
  # `|| true` is load-bearing, not decoration. grep exits 1 when it matches nothing, and under
  # `set -o pipefail` that becomes the whole pipeline's status — so the assignment fails and
  # `set -e` kills the script at the exact moment this check is about to report PASS. The bug is
  # invisible while the branches still exist, which is why it only surfaced once they were removed.
  hits="$({ grep -rl "\"$dead\"" "$MAPPING" 2>/dev/null || true; } | wc -l | tr -d ' ')"
  check "no mapping branches on $dead (got $hits)" test "$hits" -eq 0
done

echo
if [ "$failures" -eq 0 ]; then
  echo "run-detail-overlay: all checks passed"
  exit 0
fi
echo "run-detail-overlay: $failures check(s) failed"
exit 1
