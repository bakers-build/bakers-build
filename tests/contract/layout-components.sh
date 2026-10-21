#!/usr/bin/env bash
set -euo pipefail

# BB-378 — the web UI's layout layer is a named, minimal set.
#
# What this proves. BB-327's eleven children built the screens; nobody gave a pass to the layer
# those screens are composed ON. The result is measurable rather than aesthetic: the shell is
# inlined four times instead of inherited once (spec F1), a screen renders two to four `<h1>`
# elements (F4), one body wrapper carries six unrelated concerns (F5) whose defaults are corrected
# sixteen times in the scenes (F6), and there is no spacing scale at all — four tokens, three of
# them the same value, against 454 arbitrary `[Npx]` values in the components (F8).
#
# This suite asserts the file-observable half of the target: `shell` → `canvas` →
# `page_header` / `filters` / `zone` / `inspector`, the shell declared once and inherited by every
# screen scene, exactly one `<h1>` per screen, and spacing as configuration on a token scale. Every
# assertion is made against the TREE — the components, the scene files, the token file, the
# libraries file — never against the spec or the plan prose, which are documents this suite must be
# able to contradict.
#
# Ten groups of checks, A1–A10 of the plan:
#   0. the enumeration this suite searches actually reaches the theme's files. A2, A3 and A8 are
#      "no hit" assertions, so an enumeration that returned nothing would report them as PASS while
#      inspecting no bytes — and `errexit` is suppressed inside `check()`'s `if "$@"`, so nothing
#      else would notice. The pattern was inherited from the BB-330 suite, which BB-378 deleted
#      along with the other legacy web-UI contracts; the reasoning is restated here so it survives
#      its source.
#   A1. Names — the nine target components exist; the nine superseded directories are gone.
#   A2. Deletions — the SEVENTEEN unreferenced components are gone, nothing references them anywhere
#       in the repository's live surfaces, and the charting library goes with `stat-chart`.
#   A3. Chrome inheritance — every screen scene starts its `items:` with its section's chrome
#       scene: `design-system:shell` for a workspace section, `design-system:gate` for the gate one
#       and no section file inlines the shell component any more.
#   A4. One layout in `content` — the shell scene's `content` is the `$content` placeholder, and a
#       screen scene's `content` holds exactly one node, a `canvas` (inline, or a route-bearing
#       View whose mapping emits that canvas as its root).
#   A5. One `<h1>` — `page_header` owns the only one, and no screen places two page headers.
#   A6. Regions — `canvas` declares exactly `header`, `filters`, `main`, `inspector`, and is not a
#       scroll container.
#   A7. `zone` contract — the slots and props it has, and the three it deliberately does not.
#   A8. `section` is DELETED — the directory is gone and nothing anywhere renders it. (This group was
#       inverted; see the block above A8 for the decision that voided D18's premise.)
#   A9. Spacing scale — six measured tokens replace the three 14px synonyms, and the five layout
#       templates carry no arbitrary `[Npx]` spacing utility.
#   A10. Tabs in the header — `page_header` carries them, `entity_chrome` was never built, and both
#       the project-detail scenes and the team scene fill the slot (inline, or through the
#       View mapping that owns that scene's canvas).
#
# Out of scope, deliberately, and therefore NOT asserted here (plan › Out of scope):
#   - the 454 arbitrary `[Npx]` values in the leaf components (R3/D16). A9's second half is scoped
#     to the FIVE layout templates by name for exactly that reason; a tree-wide grep would assert a
#     sweep this ticket decided not to make.
#   - retiring the `bb_login` / `bb_dashboard` MODULES, or touching `core.extension`. Deleting
#     the components a module rendered is not the same decision as retiring the module, and this
#     repository has a separate documented procedure for module retirement.
#
# How to run — no DDEV environment, no Drupal bootstrap and no theme build required; every check is
# a read of repository content:
#   bash tests/contract/layout-components.sh
#
# Exit code is the verdict: 0 = every check passed, 1 = at least one failed.
#
# Runs on bash 3.2 (macOS `/bin/bash`): no `mapfile`, no `declare -A`.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THEME="$ROOT/web/themes/custom/bb_theme"
COMPONENTS="$THEME/components"
DESIGNBOOK="$THEME/designbook"
TOKENS="$DESIGNBOOK/design-system/design-tokens.yml"
LIBRARIES="$THEME/bb_theme.libraries.yml"
SHELL_SCENES="$DESIGNBOOK/design-system/design-system.scenes.yml"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# --- Inventories --------------------------------------------------------------------------------

# The target set (D9, D11–D15). `sidebar`, `status_bar`, `dialog` and `tabs` keep their names and
# are NOT asserted here. They used to be covered by the BB-330 suite, which BB-378 deleted along
# with the other legacy web-UI contracts; the Storybook build is now what proves they still render,
# and nothing file-level asserts their contracts. Named so the gap is visible rather than assumed.
# BB-503 removed `topbar` from this set (and its directory) along with `search_trigger` and
# `command_palette` — the shell has no header at all; see that ticket for why.
TARGET_COMPONENTS='shell canvas page_header nav inspector filters active-filters collapsible zone'

# The names those nine replace. A directory that still exists means a `git mv` did not happen.
SUPERSEDED_COMPONENTS='page detail_layout content_header navigation toolbar meta_rail facet_sidebar selected_facets disclosure'

# The SEVENTEEN deleted components, in two cohorts.
#
# The first six are F12/D17's genuinely unreferenced primitives — nothing, anywhere, rendered them.
#
# The remaining ELEVEN are the SCOPE EXTENSION: every component that is not reachable from a
# Designbook scene. The criterion is transitive reachability — a component counts as in-scene if a
# scene names it, or a component reachable from a scene names it, or an entity view-mode mapping a
# reachable scene uses names it — measured over BOTH address forms (`bb_theme:<name>` and
# `$DESIGNBOOK_COMPONENT_NAMESPACE:<name>`) and over `bb_theme/<name>` library references. Measured
# on this tree: 57 of 68 components were scene-reachable, these eleven were not.
#
# A COMPONENT STORY IS NOT A SCENE, and `node-row` is the case that settles it. It was the eleventh
# unreachable component, and the only thing still rendering it was `table.default.story.yml` — a
# story of a SURVIVING component. Sparing it on that ground would have inverted the rule (any
# component could be kept alive by a story of its own container), so the STORY was rewritten onto the
# scene-reachable `ticket-row` and the component went. Its Drupal wiring went too: `views.view.nodes`
# in both shipped locations, the recipe's `config.import` line for it, `NodesFragmentBlock`, and the
# `nodes` entry of `DashboardSectionRenderer`. Two bb_core query-access kernel tests used that View
# as their `bb_conductor` vehicle and were MIGRATED to `views.view.bb_conductors` — same base
# table, same conditions — rather than deleted.
#
# Why unreachability is now sufficient grounds to delete, including the Drupal wiring: the human
# decided that only Storybook counts and that the Drupal side is to be rewired wholesale later, so a
# component no scene reaches has no surviving consumer worth keeping. That decision is also what
# retires D18 — see the block above A8.
#
# A comment is not a render. `badge.twig` and `member-row.twig` mentioned `bb_theme:section` in
# PROSE only (stale leftovers of this ticket's own `section` → `zone` rename); a comment-blind sweep
# reported `section` as reachable through them. Those two comments now say `zone`, which is what they
# meant, and the measurement is comment-aware.
DELETED_COMPONENTS='checkbox multiselect-dropdown progress-bar select_field textarea stat-chart
page_auth auth_card form_element submit section ticket_detail footprint_summary ticket_links
filter-bar filter-autocomplete node-row'

# The three section scene files, relative to the theme. `design-system/design-system.scenes.yml` is
# NOT in this list: it declares the shell every one of these inherits, so it is the one file that is
# allowed to name the shell component.
SECTION_SCENE_FILES='designbook/sections/tickets/tickets.section.scenes.yml
designbook/sections/projects/projects.section.scenes.yml
designbook/sections/settings/settings.section.scenes.yml
designbook/sections/gate/gate.section.scenes.yml
designbook/sections/onboarding/onboarding.section.scenes.yml
designbook/sections/user/user.section.scenes.yml'

# THE GATE SECTION HAS A DIFFERENT CHROME, AND THAT IS WHY IT IS NAMED SEPARATELY (BB-415 D11).
# Every other section is a PRODUCT screen: addressed under a workspace slug, framed by
# `design-system:shell`, and filling `content` with exactly one `bb_theme:canvas`. A gate screen
# stands outside every workspace — `/home` carries no slug — so it is framed by
# `design-system:gate`, the peer chrome declared beside the shell in the same design-system file.
#
# TWO RULES BEND FOR IT AND NEITHER IS WAIVED. A3 asks for a scene root and gets `design-system:gate`
# instead of `design-system:shell`; A4 asks what fills `content` and does not ask for a canvas,
# because a canvas is the workspace work surface — a header, a filters rail, a main region and an
# inspector — and a gate has one message or one list and none of those regions. Adding the file
# without teaching the two loops would have left the new scenes UNCHECKED, which is how the rule
# this contract enforces quietly stops being enforced (F13).
GATE_SCENE_FILE='designbook/sections/gate/gate.section.scenes.yml'
ONBOARDING_SCENE_FILE='designbook/sections/onboarding/onboarding.section.scenes.yml'

# The scene root a section file's scenes must open with.
scene_root_of() {
  case "$1" in
    "$GATE_SCENE_FILE") printf 'design-system:gate' ;;
    designbook/sections/user/user.section.scenes.yml) printf 'design-system:account-shell' ;;
    "$ONBOARDING_SCENE_FILE") printf 'design-system:onboarding' ;;
    *) printf 'design-system:shell' ;;
  esac
}

# The five layout templates A9's second half is scoped to (D16: binding for the layout layer only).
LAYOUT_TWIGS='zone canvas page_header filters inspector'

# The measured spacing scale (D16, derived from F8's real distribution).
SPACING_SCALE='space-1:4px space-2:8px space-3:12px space-4:16px space-5:20px space-6:24px'

# The three 14px synonyms the scale supersedes, plus `row-h`, which is a row height and stays.
RETIRED_SPACING_TOKENS='sec-pad gap m'

# An arbitrary `[Npx]` SPACING utility: padding, margin or gap with a hard pixel value. Width,
# height, `top`, `min-h` and grid track values are not spacing and are deliberately not matched —
# `canvas` legitimately declares a 236px and a 320px track, and `inspector` legitimately sticks at
# `top-0`. The optional leading `-` catches a negative margin (`[&_.text-line]:-mx-[6px]` is one of
# the values `content_header` carries today), and the leading guard rejects a longer utility name
# ending in one of these letters, so `min-h-[44px]` and `grid-cols-[…320px]` do not match.
SPACING_UTILITY_RE='(^|[^A-Za-z0-9_-])-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-\[[0-9]+(\.[0-9]+)?px\]'

# --- Enumeration --------------------------------------------------------------------------------
#
# Every source file of the theme that is repository content — tracked, or untracked but not ignored.
# The criteria are about what the repository ships, so the enumeration is git's: it excludes
# `node_modules/` and `dist/` (build output).
#
# NO `grep -q` MAY APPEAR INSIDE A PIPELINE IN THIS FILE. Under `pipefail`, `grep -q` exits as soon
# as it matches and the writer upstream then dies of SIGPIPE, which `pipefail` turns into a failed
# pipeline — so such a check fails intermittently, on the order of one run in five. Use
# `[ -z "$(… | grep … || true)" ]` instead. This rule used to live in the BB-330 suite, which
# BB-378 deleted; the now-deleted BB-329 suite had the bug, and its non-vacuity guard was red
# for exactly this reason.
#
# `storybook-static/` IS EXCLUDED, and the exclusion is load-bearing rather than cosmetic. It is the
# `storybook build` OUTPUT — the same class of artifact as `dist/` and `node_modules/`, which this
# enumeration already means to exclude — but unlike those two it is not gitignored in this
# repository, so `--others --exclude-standard` hands it over as though it were source. Its bundles
# INLINE each component's Twig template and docblocks verbatim, so every `bb_theme:<name>` in the
# tree at build time reappears there as a string. Scanning it would make A2 assert something it
# cannot mean: that a deleted component is absent from a build produced BEFORE the deletion. The
# check would then fail until someone rebuilt, and — worse — pass again on a stale build of a tree
# that had since regrown the component. The build is a gate of its own (`pnpm exec storybook build`
# is the ticket's decisive one); it is not evidence about repository content.
theme_sources() {
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- "$THEME" |
    while IFS= read -r rel; do
      case "$rel" in
        */storybook-static/*) continue ;;
      esac
      [ -f "$ROOT/$rel" ] && printf '%s\n' "$ROOT/$rel"
    done
}

# A search for a RENDER of a component across the theme. It filters the enumeration above the same
# two ways `live_hits_e` does, and for the same reasons spelled out there — skip the Designbook plan
# ARCHIVES and Markdown prose, and strip comments before matching. Before this ticket the
# distinction never bit: the six components of the original A2 cohort appear in no archive and in no
# comment, so a raw grep and a render-aware one gave the same answer. The ten added here appear in
# both, so the two answers diverge, and only one of them is the criterion.
#
# The enumeration itself is deliberately NOT filtered — `theme_sources` still measures the whole
# theme, so check 0's non-vacuity guard keeps counting every file the theme ships.
theme_hits_e() {
  local pattern="$1"
  theme_sources | while IFS= read -r file; do
    case "$file" in
      */designbook/plans/* | *.md) continue ;;
    esac
    strip_comments "$file" "$(comment_family "$file")" |
      grep -nE -e "$pattern" | sed "s|^|$file:|" || true
  done
}

# The same enumeration narrowed to `designbook/`, for A8's "no scene may reference `section`" check.
# Its non-vacuity is covered transitively by check 0: that guard asserts the identical git command,
# scoped one level up, reaches `designbook/design-system/design-tokens.yml` and
# `designbook/sections/tickets/tickets.section.scenes.yml`.
#
# `designbook/plans/` IS EXCLUDED. Those files are Designbook's own ARCHIVED workflow plan records —
# a `design-entity` run's write-up of what it was about to build — and they legitimately quote the
# world as it was when they ran. Rewriting an archive so a criterion about the LIVE artifacts passes
# would falsify the record, and the criterion is about scenes, mappings and components, not about
# history. BB-330's suite excludes archives from its own inventories for the same reason. The live
# surfaces — `design-system/`, `sections/`, `entity-mapping/`, `data/`, `sync/` — are all still
# enumerated, so nothing a scene can reach is exempted.
designbook_hits_e() {
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- "$DESIGNBOOK" |
    while IFS= read -r rel; do
      case "$rel" in
        */designbook/plans/*) continue ;;
      esac
      [ -f "$ROOT/$rel" ] || continue
      grep -HnE -e "$1" "$ROOT/$rel" 2>/dev/null || true
    done
}

# Every LIVE surface of the repository that can actually RENDER or BIND a component: the shipped
# config of both install paths (`config/sync` for the server's CIM, `recipes/**/config` and the
# modules' `config/{install,optional}` for the recipe path), the custom modules' PHP, and the theme's
# Twig/YAML/CSS/JS. Deliberately EXCLUDED, each for a reason that is not convenience:
#
#   - `docs/**` and `web/themes/**/designbook/plans/**` are ARCHIVES. A spec, a plan or a Designbook
#     workflow record legitimately quotes the world as it was when it was written; rewriting one so a
#     criterion about live artifacts passes would falsify the record. The `designbook_hits_e` helper
#     above excludes archives for the identical reason.
#   - `tests/contract/**`. A contract suite names a banned component precisely in order to BAN it, so
#     the mention IS the ban rather than a render. Scanning the suites would force such negative
#     assertions to be written in some obfuscated form, which is strictly worse than exempting the
#     directory. This file's own `DELETED_COMPONENTS` inventory is the same case — and after BB-378
#     this file is the only web-UI contract left, so the exemption is mostly about itself.
#   - `storybook-static/`, for the reason spelled out over `theme_sources` above: it is the Storybook
#     build output, it is not gitignored here, and it inlines every component's Twig verbatim.
#   - `*.md`. Prose end to end; it cannot render anything, and scanning it would only catch the
#     retirement notes this ticket wrote — which is what the comment stripping below exists to stop.
#
# `tests/playwright` is NOT in the pathspec, because that directory no longer exists: BB-378 deleted
# the entire Playwright suite on the same decision that only Storybook counts. It WAS in an earlier
# revision of this function, and a `git ls-files` pathspec matching nothing is silently empty rather
# than an error — which is exactly why the non-vacuity guard below names one file per surface instead
# of trusting the pathspec.
live_sources() {
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- \
    "$ROOT/config" "$ROOT/recipes" "$ROOT/web/modules/custom" "$ROOT/web/themes/custom" \
    "$ROOT/scripts" |
    while IFS= read -r rel; do
      case "$rel" in
        */designbook/plans/* | */storybook-static/*) continue ;;
        *.md) continue ;;
      esac
      [ -f "$ROOT/$rel" ] && printf '%s\n' "$ROOT/$rel"
    done
}

# A COMMENT IS NOT A RENDER, so the scan strips comments before it matches.
#
# This is not a convenience: it is the same defect that made the FIRST measurement of this scope
# extension wrong. `badge.twig` and `member-row.twig` mentioned `bb_theme:section` in prose only,
# and a comment-blind reachability sweep therefore reported `section` as still reachable and spared
# it. The inverse costs just as much — recording WHY a component was retired requires naming it, and
# a comment-blind ban would forbid every honest retirement note (this ticket wrote five) and push the
# next author toward deleting the explanation instead of the code.
#
# Blank the comment body rather than deleting the line, so the reported line numbers stay true to the
# file. Four syntaxes, chosen by extension — Twig `{# … #}` (single- and multi-line), `//` and
# `/* … */` for TS/JS/CSS, and `#` for YAML/shell/Python. A `#` inside quotes is left alone: a colour
# literal or a URL fragment is not a comment, and blanking from it would hide real code to its right.
strip_comments() {
  awk -v ext="$2" '
    function blank(s) { r = ""; n = length(s); for (i = 0; i < n; i++) r = r " "; return r }
    {
      line = $0
      if (ext == "twig") {
        while (match(line, /\{#.*#\}/)) line = substr(line, 1, RSTART - 1) blank(substr(line, RSTART, RLENGTH)) substr(line, RSTART + RLENGTH)
        if (!inblk && match(line, /\{#/)) { line = substr(line, 1, RSTART - 1); inblk = 1 }
        else if (inblk) { if (match(line, /#\}/)) { line = blank(substr(line, 1, RSTART + RLENGTH - 1)) substr(line, RSTART + RLENGTH); inblk = 0 } else line = blank(line) }
      } else if (ext == "c") {
        while (match(line, /\/\*.*\*\//)) line = substr(line, 1, RSTART - 1) blank(substr(line, RSTART, RLENGTH)) substr(line, RSTART + RLENGTH)
        if (!inblk && match(line, /\/\*/)) { line = substr(line, 1, RSTART - 1); inblk = 1 }
        else if (inblk) { if (match(line, /\*\//)) { line = blank(substr(line, 1, RSTART + RLENGTH - 1)) substr(line, RSTART + RLENGTH); inblk = 0 } else line = blank(line) }
        if (match(line, /\/\//)) line = substr(line, 1, RSTART - 1)
      } else if (ext == "hash") {
        # Walk the line so a `#` inside a quoted string is not treated as a comment.
        out = ""; q = ""
        n = length(line)
        for (i = 1; i <= n; i++) {
          ch = substr(line, i, 1)
          if (q != "") { if (ch == q) q = ""; out = out ch; continue }
          if (ch == "\"" || ch == "'"'"'") { q = ch; out = out ch; continue }
          if (ch == "#") break
          out = out ch
        }
        line = out
      }
      print line
    }
  ' "$1"
}

# The comment syntax family of a path, or empty when the file has none worth stripping.
comment_family() {
  case "$1" in
    *.twig) printf 'twig\n' ;;
    # Drupal's PHP files are not all called `.php`: `.module`, `.install`,
    # `.theme`, `.profile` and `.engine` are PHP with PHP comment syntax. Listing
    # only `.php` made every comment in them read as live code, and the whole
    # point of stripping is that a MENTION is not a render — on 2026-09-11 a
    # comment in `bb_core.install` explaining why a legacy page layout names a
    # component the theme dropped failed A2 as "a live surface still renders a
    # deleted component".
    *.ts | *.js | *.mjs | *.cjs | *.css | *.php | *.module | *.install | *.theme | *.profile | *.engine) printf 'c\n' ;;
    *.yml | *.yaml | *.sh | *.py | *.jsonata) printf 'hash\n' ;;
    *) printf '\n' ;;
  esac
}

live_hits_e() {
  local pattern="$1"
  live_sources | while IFS= read -r file; do
    strip_comments "$file" "$(comment_family "$file")" |
      grep -nE -e "$pattern" | sed "s|^|$file:|" || true
  done
}

# One regex matching a render of ANY of the seventeen, in either address form. Built once and
# searched in a SINGLE pass rather than once per name: `strip_comments` runs an `awk` per file, so a
# per-name loop re-stripped the whole tree seventeen times over and took minutes. Seventeen names
# against one corpus is the same statement as one name against seventeen corpora, and the per-name
# attribution the loop gave for free is recovered from the hit text afterwards.
deleted_components_re() {
  local alt=""
  for name in $DELETED_COMPONENTS; do
    alt="${alt:+$alt|}$name"
  done
  printf '(bb_theme|DESIGNBOOK_COMPONENT_NAMESPACE):(%s)([^A-Za-z0-9_-]|$)\n' "$alt"
}

# --- File helpers -------------------------------------------------------------------------------

file_exists() {
  [ -f "$1" ] || { printf '  missing file: %s\n' "${1#"$ROOT"/}"; return 1; }
}

file_contains_e() {
  local file="$1" pattern="$2"
  [ -f "$file" ] || { printf '  missing file: %s\n' "${file#"$ROOT"/}"; return 1; }
  if ! grep -qE -e "$pattern" "$file"; then
    printf '  %s does not match /%s/\n' "${file#"$ROOT"/}" "$pattern"
    return 1
  fi
}

file_lacks_e() {
  local file="$1" pattern="$2" what="$3"
  [ -f "$file" ] || { printf '  missing file: %s\n' "${file#"$ROOT"/}"; return 1; }
  if printf '%s' "$(twig_source_without_comments "$file")" | grep -qE -e "$pattern"; then
    printf '  %s still carries %s:\n' "${file#"$ROOT"/}" "$what"
    printf '%s' "$(twig_source_without_comments "$file")" | grep -nE -e "$pattern" | sed 's|^|    |'
    return 1
  fi
}

# A `{# ... #}` comment is prose, not markup — a defect this suite hunts (an `overflow` that would
# make `canvas` a scroll container, an arbitrary spacing utility, a stray `<h1>`) is real only when
# it is live in the template. Design rationale that NAMES the very thing it was deliberately not
# used — canvas.twig documents choosing `z-index` over `overflow` — must not trip the check that
# hunts for it. Only `file_lacks_e` reads through this: `file_contains_e` asserts something IS
# present, and a comment can no more satisfy that than a docstring can satisfy a missing return
# statement, so it is never fooled by prose either way.
#
# TWO INDEPENDENT FIXES FOR ONE DEFECT (BB-420 Task 14): this function is
# BB-420's own answer to "a Twig comment tripped the grep" — strip every
# comment before any `file_lacks_e` pattern ever runs, so `A6`'s `overflow`
# check below cannot see the design-rationale prose at all, whatever its
# pattern is. `a6_canvas_is_not_a_scroll_container()`'s OWN comment records a
# second, differently-shaped answer to the SAME original defect (BB-413,
# narrowing the pattern itself so a bare "overflow" cannot match prose
# either) — authored on a sibling branch, unaware of this one, and merged in
# without conflict because the two never touch the same lines. Both hold
# today: this function makes A6's pattern-narrowing redundant for that one
# check (the comment it was written against no longer reaches the grep at
# all), and the pattern-narrowing costs nothing extra, so neither was removed
# — do not remove either without first confirming, by injecting a real
# `overflow-hidden` declaration into `canvas.twig`, that the check still goes
# red.
twig_source_without_comments() {
  local file="$1" content s out rest
  content="$(cat "$file")"
  out=""
  s="$content"
  while [[ "$s" == *"{#"* ]]; do
    out+="${s%%\{\#*}"
    rest="${s#*\{\#}"
    if [[ "$rest" != *"#}"* ]]; then
      s=""
      break
    fi
    s="${rest#*\#\}}"
  done
  out+="$s"
  printf '%s' "$out"
}

# The keys a component metadata file declares under a top-level block (`slots:` at column 0, keys at
# indent 2) or under `props:` › `properties:` (keys at indent 4). Printed one per line, sorted, so a
# caller can compare a SET rather than probe for members one at a time — "declares exactly these
# four regions" is a set statement and asserting it as four `grep`s would pass on a fifth.
yaml_block_keys() {
  local file="$1" block="$2" depth="$3"
  [ -f "$file" ] || return 1
  awk -v block="$block" -v depth="$depth" '
    function ind(s) { match(s, /^ */); return RLENGTH }
    { line = $0; sub(/\r$/, "", line) }
    line ~ /^[ \t]*$/ { next }
    {
      i = ind(line)
      body = substr(line, i + 1)
      if (body ~ /^#/) { next }
      if (inblock && i <= block_ind) { inblock = 0 }
      if (!inblock) {
        if (body ~ "^" block ":") { inblock = 1; block_ind = i }
        next
      }
      if (i == depth && body ~ /^[A-Za-z_][A-Za-z0-9_-]*:/) {
        k = body; sub(/:.*$/, "", k); print k
      }
    }
  ' "$file" | sort -u
}

# --- The scene model ----------------------------------------------------------------------------
#
# Extracted to `lib/scenes.sh` by BB-396, whose check D needs the same per-scene line range this
# suite needs. Sourced rather than copied, for the reason `lib/writers.sh` states: a definition two
# gates share and each keeps its own copy of is a definition that drifts in one of them.
. "$(dirname "${BASH_SOURCE[0]}")/lib/scenes.sh"
# --- 0. The enumeration is non-vacuous ----------------------------------------------------------

enumeration_reaches_the_criterion_files() {
  local list count rc=0 rel
  list="$(theme_sources)"
  count="$(printf '%s\n' "$list" | grep -c . || true)"
  if [ "$count" -lt 50 ]; then
    printf '  theme enumeration returned only %s file(s) — it cannot have inspected the theme\n' "$count"
    rc=1
  fi
  for rel in \
    'bb_theme.libraries.yml' \
    'designbook/design-system/design-tokens.yml' \
    'designbook/sections/tickets/tickets.section.scenes.yml'; do
    if [ -z "$(printf '%s\n' "$list" | grep -xF "$THEME/$rel" || true)" ]; then
      printf '  enumeration does not reach %s\n' "$rel"
      rc=1
    fi
  done
  return "$rc"
}

check "the theme enumeration is non-vacuous and reaches the criterion files" \
  enumeration_reaches_the_criterion_files

# The same guard for the repo-wide enumeration, and for the same reason: the assertion it feeds is a
# "no hit" one, so an enumeration that returned nothing would report PASS having inspected no bytes.
# The named files are one per surface — the server's CIM source, the recipe path, a custom module and
# the theme — so a `--` pathspec that silently matched nothing fails here instead of passing. An
# earlier revision named a Playwright step file; BB-378 deleted that suite, and this guard is what
# would have caught the stale pathspec left behind.
live_enumeration_is_non_vacuous() {
  local list count rc=0 rel
  list="$(live_sources)"
  count="$(printf '%s\n' "$list" | grep -c . || true)"
  if [ "$count" -lt 200 ]; then
    printf '  live enumeration returned only %s file(s) — it cannot have inspected the repository\n' "$count"
    rc=1
  fi
  for rel in \
    'config/sync/system.theme.yml' \
    'recipes/bakers/recipe.yml' \
    'web/modules/custom/bb_core/bb_core.module' \
    'web/themes/custom/bb_theme/bb_theme.info.yml'; do
    if [ -z "$(printf '%s\n' "$list" | grep -xF "$ROOT/$rel" || true)" ]; then
      printf '  live enumeration does not reach %s\n' "$rel"
      rc=1
    fi
  done
  return "$rc"
}

check "the repo-wide live enumeration is non-vacuous and reaches both install paths" \
  live_enumeration_is_non_vacuous

# --- A1. The names ------------------------------------------------------------------------------

a1_target_components_exist() {
  local rc=0 name
  for name in $TARGET_COMPONENTS; do
    file_exists "$COMPONENTS/$name/$name.component.yml" || rc=1
    file_exists "$COMPONENTS/$name/$name.twig" || rc=1
  done
  return "$rc"
}

a1_superseded_components_are_gone() {
  local rc=0 name
  for name in $SUPERSEDED_COMPONENTS; do
    if [ -d "$COMPONENTS/$name" ]; then
      printf '  components/%s/ still exists — the rename to its target name did not happen\n' "$name"
      rc=1
    fi
  done
  return "$rc"
}

check "A1 the nine target layout/chrome components exist (.component.yml + .twig)" \
  a1_target_components_exist
check "A1 the nine superseded component directories are gone" \
  a1_superseded_components_are_gone

# --- A2. The deletions --------------------------------------------------------------------------

a2_deleted_components_are_gone() {
  local rc=0 name
  for name in $DELETED_COMPONENTS; do
    if [ -d "$COMPONENTS/$name" ]; then
      printf '  components/%s/ still exists (D17: unreferenced, therefore deleted)\n' "$name"
      rc=1
    fi
  done
  return "$rc"
}

# A reference to a component is one of the two ADDRESS FORMS a scene, mapping or template uses —
# `bb_theme:<name>` or `$DESIGNBOOK_COMPONENT_NAMESPACE:<name>`. The bare word is not a reference
# and must not be matched: `checkbox` is an input type, `textarea` is an HTML element that
# `form_element` and `input` legitimately render, and `chart` is a word `stat-tile`'s prose uses.
# The trailing guard stops a name from matching a longer sibling's prefix.
a2_nothing_references_the_deleted_components() {
  local hits
  hits="$(theme_hits_e "$(deleted_components_re)")"
  [ -z "$hits" ] && return 0
  printf '  the theme still references a deleted component:\n'
  printf '%s\n' "$hits" | sed "s|^$THEME/|    |"
  return 1
}

# D17a — the charting library goes with `stat-chart`, its only consumer. The library key in
# `bb_theme.libraries.yml` is `chart` (singular); the spec calls it `charts` in prose, and this
# assertion follows the FILE, because the file is what Drupal reads.
a2_the_chart_library_is_gone() {
  local rc=0
  file_lacks_e "$LIBRARIES" '^chart:' 'the charting library (D17a)' || rc=1
  if [ -f "$THEME/js/apexcharts.src.js" ]; then
    printf '  js/apexcharts.src.js still exists — nothing bundles it any more (D17a)\n'
    rc=1
  fi
  return "$rc"
}

# The same statement over the whole repository, which is what the scope extension actually requires:
# the eleven scene-unreachable components were rendered by Drupal config, two Block plugins, a
# FieldFormatter, a View, two theme templates and four Playwright step files, and a theme-scoped
# assertion
# cannot see any of those. Deleting a component directory while its `display_builder` page layout
# still names it does not fail loudly — display_builder drops an unresolvable component silently
# (see MEMORY: display_builder drops invalid SDC props without a word), so the layout renders a hole
# and nothing reports it. This check is what makes that visible.
a2_nothing_in_the_repository_renders_a_deleted_component() {
  local hits
  hits="$(live_hits_e "$(deleted_components_re)")"
  [ -z "$hits" ] && return 0
  printf '  a live surface still renders a deleted component:\n'
  printf '%s\n' "$hits" | sed "s|^$ROOT/|    |"
  return 1
}

check "A2 the seventeen unreferenced components are deleted" a2_deleted_components_are_gone
check "A2 nothing under the theme references any of the seventeen deleted components" \
  a2_nothing_references_the_deleted_components
check "A2 no live surface of the repository renders any of the seventeen deleted components" \
  a2_nothing_in_the_repository_renders_a_deleted_component
check "A2 the charting library and its bundle source are gone" a2_the_chart_library_is_gone

# --- A3. Shell inheritance ----------------------------------------------------------------------

# D1/F1 — `screen-scene-constraints.md` requires scene items to START with
# `scene: design-system:<shell_name>` and to fill `content` through `with:`. The ref source is the
# literal `design-system` (the location of the shell scenes file), not the shell SceneFile's `id:`.
a3_every_screen_scene_inherits_the_shell() {
  local rc=0 rel file model idx item1 name root
  for rel in $SECTION_SCENE_FILES; do
    file="$THEME/$rel"
    file_exists "$file" || { rc=1; continue; }
    model="$(scene_model "$file")"
    if [ -z "$(scene_indices "$model")" ]; then
      printf '  %s declares no scenes at all — the parser found nothing to assert on\n' "$rel"
      rc=1
      continue
    fi
    root="$(scene_root_of "$rel")"
    for idx in $(scene_indices "$model"); do
      name="$(scene_name_of "$model" "$idx")"
      item1="$(model_field "$model" "$idx" ITEM1)"
      case "$item1" in
        "scene: $root" | "scene: \"$root\"" | "scene: '$root'") ;;
        '')
          printf '  %s [%s]: the scene declares no items\n' "$rel" "$name"
          rc=1
          ;;
        *)
          printf '  %s [%s]: items start with `%s`, not `scene: "%s"`\n' \
            "$rel" "$name" "$item1" "$root"
          rc=1
          ;;
      esac
    done
  done
  return "$rc"
}

# The mirror of the above: a section file may not name the shell COMPONENT at all, under either its
# old or its new name. `bb_theme:page` is guarded on the right, or it would match
# `bb_theme:page_header` — the very component A10 requires these files to place — and this check
# would then be unsatisfiable.
a3_no_section_file_inlines_the_shell() {
  local rc=0 rel file hits
  for rel in $SECTION_SCENE_FILES; do
    file="$THEME/$rel"
    [ -f "$file" ] || continue
    hits="$(grep -nE 'component: *"?'"'"'?bb_theme:(shell|page)([^A-Za-z0-9_-]|$)' "$file" || true)"
    if [ -n "$hits" ]; then
      printf '  %s still inlines the shell component (D1: it is declared once, in design-system):\n' "$rel"
      printf '%s\n' "$hits" | sed 's|^|    |'
      rc=1
    fi
  done
  return "$rc"
}

check "A3 every scene of the four section files starts its items with its own chrome scene" \
  a3_every_screen_scene_inherits_the_shell
check "A3 no section file inlines bb_theme:shell or bb_theme:page" \
  a3_no_section_file_inlines_the_shell

# --- A4. One layout component in `content` ------------------------------------------------------

# A scene may put a route-bearing View in `content` instead of inlining `bb_theme:canvas`.
# That is still D2 when the View's mapping emits the canvas as its root node: the screen has
# exactly one layout, it just lives in `entity-mapping/<view>.<mode>.jsonata` rather than in
# the scene YAML. Inline `entity: view.tickets` (and every other listing) still sit *inside*
# canvas.main and keep the existing canvas-child assertion; only a sole `entity: view.*`
# content child is resolved through its mapping. Missing mappings fail; they are not skipped.
entity_view_id() {
  local child="$1" rest
  case "$child" in
    entity:*) ;;
    *) return 0 ;;
  esac
  rest="${child#entity:}"
  while [ "${rest# }" != "$rest" ]; do rest="${rest# }"; done
  rest="${rest#\"}"
  rest="${rest%\"}"
  rest="${rest#\'}"
  rest="${rest%\'}"
  case "$rest" in
    view.*) printf '%s' "$rest" ;;
  esac
}

jsonata_without_comments() {
  awk '
    {
      line = $0
      out = ""
      while (length(line) > 0) {
        if (in_c) {
          if (match(line, /\*\//)) {
            line = substr(line, RSTART + 2)
            in_c = 0
          } else next
        } else if (match(line, /\/\*/)) {
          out = out substr(line, 1, RSTART - 1)
          line = substr(line, RSTART + 2)
          in_c = 1
        } else {
          out = out line
          line = ""
        }
      }
      print out
    }
  ' "$1"
}

mapping_first_component() {
  local src
  src="$(jsonata_without_comments "$1")"
  printf '%s\n' "$src" | awk '
    found { next }
    match($0, /"component"[ \t]*:[ \t]*"/) {
      rest = substr($0, RSTART + RLENGTH)
      if (match(rest, /"/)) {
        print substr(rest, 1, RSTART - 1)
        found = 1
      }
    }
  '
}

is_canvas_address() {
  case "$1" in
    '$DESIGNBOOK_COMPONENT_NAMESPACE:canvas'|bb_theme:canvas) return 0 ;;
    *) return 1 ;;
  esac
}

view_mapping_file() {
  local file="$1" model="$2" idx="$3" child id mode
  child="$(model_field "$model" "$idx" CHILD)"
  id="$(entity_view_id "$child")"
  [ -n "$id" ] || return 1
  mode="$(scene_lines "$file" "$model" "$idx" | awk '
    function ind(s) { match(s, /^ */); return RLENGTH }
    {
      line = $0; sub(/\r$/, "", line)
      body = substr(line, ind(line) + 1)
      if (body ~ /^#/) next
      if (!found && body ~ /^view_mode:/) {
        v = body
        sub(/^view_mode:[ \t]*/, "", v)
        gsub(/["'"'"']/, "", v)
        print v
        found = 1
      }
    }
  ')"
  mode="${mode:-default}"
  printf '%s' "$DESIGNBOOK/entity-mapping/${id}.${mode}.jsonata"
}

mapping_root_is_canvas() {
  local mapping="$1" comp
  [ -f "$mapping" ] || {
    printf '  missing View mapping: %s\n' "${mapping#"$ROOT"/}"
    return 1
  }
  comp="$(mapping_first_component "$mapping")"
  if ! is_canvas_address "$comp"; then
    printf '  %s root component is `%s`, not a canvas\n' \
      "${mapping#"$ROOT"/}" "${comp:-<none>}"
    return 1
  fi
}

mapping_page_header_fills_tabs() {
  local mapping="$1" src
  [ -f "$mapping" ] || return 1
  src="$(jsonata_without_comments "$mapping")"
  printf '%s\n' "$src" | awk '
    /DESIGNBOOK_COMPONENT_NAMESPACE:page_header|bb_theme:page_header/ { header = 1 }
    header && /"tabs"[ \t]*:/ { tabs = 1 }
    header && /DESIGNBOOK_COMPONENT_NAMESPACE:tabs|bb_theme:tabs/ { component = 1 }
    END { exit (header && tabs && component) ? 0 : 1 }
  '
}

# D1/F2 — the shell scene is the one place `content` is a placeholder rather than a filled slot.
a4_the_shell_scene_content_is_the_placeholder() {
  local rc=0 model idx name value
  file_exists "$SHELL_SCENES" || return 1
  model="$(scene_model "$SHELL_SCENES")"
  if [ -z "$(scene_indices "$model")" ]; then
    printf '  %s declares no scenes at all\n' "${SHELL_SCENES#"$ROOT"/}"
    return 1
  fi
  for idx in $(scene_indices "$model"); do
    name="$(scene_name_of "$model" "$idx")"
    value="$(model_field "$model" "$idx" CONTENT)"
    if [ "$value" != '$content' ]; then
      printf '  %s [%s]: content is `%s`, not the $content placeholder\n' \
        "${SHELL_SCENES#"$ROOT"/}" "$name" "${value:-<a block>}"
      rc=1
    fi
  done
  return "$rc"
}

# D2 — `content` carries exactly one layout component, `canvas`; the route-bearing main content sits
# inside its `main` region. A scene may reach its content through a YAML alias (`content: *anchor`),
# so an alias is resolved to the children of the anchor that defines it before counting. A sole
# `entity: view.*` child is the canvas when that View's mapping emits it as the root component.
a4_every_screen_content_holds_one_canvas() {
  local rc=0 rel file model idx name value children count anchor mapping
  for rel in $SECTION_SCENE_FILES; do
    # The gate section is exempt, and the exemption is narrow: its screens are
    # framed by `design-system:gate`, whose card IS the layout, so there is no
    # canvas to place. See GATE_SCENE_FILE above for the whole argument. A3
    # still checks these scenes, so they are covered rather than skipped.
    [ "$rel" = "$GATE_SCENE_FILE" ] && continue
    [ "$rel" = "$ONBOARDING_SCENE_FILE" ] && continue
    file="$THEME/$rel"
    [ -f "$file" ] || { rc=1; continue; }
    model="$(scene_model "$file")"
    for idx in $(scene_indices "$model"); do
      name="$(scene_name_of "$model" "$idx")"
      value="$(model_field "$model" "$idx" CONTENT)"
      children="$(model_field "$model" "$idx" CHILD)"
      case "$value" in
        '*'*)
          anchor="${value#\*}"
          children="$(printf '%s\n' "$model" |
            awk -F'\t' -v a="&$anchor" '
              $3 == "CONTENT" && $4 == a { want = $1; next }
              want != "" && $1 == want && $3 == "CHILD" { print $4 }
            ')"
          ;;
      esac
      count="$(printf '%s\n' "$children" | grep -c . || true)"
      if [ "$count" -ne 1 ]; then
        printf '  %s [%s]: content holds %s node(s), D2 allows exactly one\n' "$rel" "$name" "$count"
        printf '%s\n' "$children" | grep . | sed 's|^|      |' || true
        rc=1
        continue
      fi
      case "$children" in
        'component: bb_theme:canvas' | 'component: "bb_theme:canvas"' | "component: 'bb_theme:canvas'") ;;
        *)
          mapping="$(view_mapping_file "$file" "$model" "$idx" || true)"
          if [ -n "$mapping" ]; then
            mapping_root_is_canvas "$mapping" || rc=1
          else
            printf '  %s [%s]: the single content node is `%s`, not a bb_theme:canvas\n' \
              "$rel" "$name" "$children"
            rc=1
          fi
          ;;
      esac
    done
  done
  return "$rc"
}

check "A4 both shell scenes fill content with the \$content placeholder" \
  a4_the_shell_scene_content_is_the_placeholder
check "A4 every WORKSPACE screen scene's content holds exactly one node, a bb_theme:canvas" \
  a4_every_screen_content_holds_one_canvas

# --- A5. One <h1> per screen --------------------------------------------------------------------

a5_page_header_renders_one_h1() {
  local twig="$COMPONENTS/page_header/page_header.twig" count
  file_exists "$twig" || return 1
  count="$(grep -oE '<h1' "$twig" | grep -c . || true)"
  if [ "$count" -ne 1 ]; then
    printf '  %s renders %s <h1> element(s); D5 gives the screen exactly one\n' \
      "${twig#"$ROOT"/}" "$count"
    return 1
  fi
}

# F4 — `project-detail-overview` carries four `content_header` instances today, the projects list
# two, so a screen ships two to four `<h1>` elements. One page header per screen is what fixes that,
# and it is a per-SCENE statement: a file-wide count would be meaningless across ten scenes.
a5_no_screen_places_two_page_headers() {
  local rc=0 rel file model idx name count
  for rel in $SECTION_SCENE_FILES; do
    file="$THEME/$rel"
    [ -f "$file" ] || { rc=1; continue; }
    model="$(scene_model "$file")"
    for idx in $(scene_indices "$model"); do
      name="$(scene_name_of "$model" "$idx")"
      count="$(scene_lines "$file" "$model" "$idx" |
        grep -cE 'component: *"?'"'"'?bb_theme:page_header([^A-Za-z0-9_-]|$)' || true)"
      if [ "$count" -gt 1 ]; then
        printf '  %s [%s]: %s page headers, therefore %s <h1> elements (D5 allows one)\n' \
          "$rel" "$name" "$count" "$count"
        rc=1
      fi
    done
  done
  return "$rc"
}

check "A5 page_header.twig renders exactly one <h1>" a5_page_header_renders_one_h1
check "A5 no screen scene places more than one page_header" a5_no_screen_places_two_page_headers

# --- A6. The canvas regions ---------------------------------------------------------------------

# D6/D11 — exactly four regions, asserted as a SET. Four `grep`s for four names would pass on a
# fifth region, which is precisely the drift `detail_layout`'s `band`/`story`/`meta` came from.
a6_canvas_declares_exactly_four_regions() {
  local yml="$COMPONENTS/canvas/canvas.component.yml" actual expected
  file_exists "$yml" || return 1
  actual="$(yaml_block_keys "$yml" slots 2 | tr '\n' ' ' | sed 's/ *$//')"
  expected='filters header inspector main'
  if [ "$actual" != "$expected" ]; then
    printf '  %s declares slots: %s\n' "${yml#"$ROOT"/}" "${actual:-<none>}"
    printf '  D11 declares exactly:  %s\n' "$expected"
    return 1
  fi
}

# D12 — it is not a scroll container. An `overflow` ancestor here would take `inspector` and
# `filters` their `sticky` and clip every absolutely positioned picker panel (BB-332 R9).
#
# THE CHECK IS ON THE DECLARATION, NOT ON THE WORD, and that is a measured
# correction rather than a loosening (BB-413 T13). As a bare `overflow` grep it
# also matched PROSE: the paragraph in `canvas.twig` that explains why the sticky
# aside was given a `z-index` names the two cures it rejected, and one of them is
# `overflow`. A gate that fails on a comment warning against the very thing it
# guards teaches people to delete the comment — the same trap BB-413's own
# contract hit with a bare `hx-select-oob` grep, and it is narrowed the same way.
# The pattern matches a Tailwind utility (`overflow-hidden`, `lg:overflow-y-auto`)
# and a CSS or arbitrary-value declaration (`overflow: auto`, `[overflow:auto]`),
# and does not match the word inside backticks.
#
# NOT THE ONLY DEFENCE AGAINST THAT DEFECT ANYMORE (BB-420 Task 14):
# `file_lacks_e`, which this check calls below, now runs every pattern
# against `twig_source_without_comments()`'s own comment-stripped read of the
# file rather than the file itself (see that function's docblock) — authored
# independently, on a sibling branch, for the identical "a Twig comment
# tripped the grep" defect this paragraph already describes, and merged in
# beside it without conflict. That means the design-rationale prose this
# paragraph worries about no longer reaches ANY pattern here at all, bare
# `overflow` included — the narrowing below is now a second, harmless line of
# defence rather than the one thing standing between this check and that
# comment. Kept regardless: it still does its own job for a `overflow`
# arbitrary-value form the comment-stripping does not care about either way,
# and removing it changes nothing this suite currently measures.
a6_canvas_is_not_a_scroll_container() {
  local twig="$COMPONENTS/canvas/canvas.twig"
  file_exists "$twig" || return 1
  file_lacks_e "$twig" \
    'overflow(-(auto|hidden|scroll|clip|visible|x|y)|[[:space:]]*:)' \
    'an overflow declaration (D12: it must not be a scroll container)'
}

check "A6 canvas declares exactly the regions header, filters, main, inspector" \
  a6_canvas_declares_exactly_four_regions
check "A6 canvas.twig carries no overflow" a6_canvas_is_not_a_scroll_container

# --- A7. The zone contract ----------------------------------------------------------------------

a7_zone_declares_its_slots_and_props() {
  local yml="$COMPONENTS/zone/zone.component.yml" rc=0 slots props key
  file_exists "$yml" || return 1
  slots="$(yaml_block_keys "$yml" slots 2)"
  props="$(yaml_block_keys "$yml" properties 4)"
  for key in heading actions content; do
    if [ -z "$(printf '%s\n' "$slots" | grep -xF "$key" || true)" ]; then
      printf '  %s declares no `%s` slot (D14)\n' "${yml#"$ROOT"/}" "$key"
      rc=1
    fi
  done
  for key in inset gap direction columns list; do
    if [ -z "$(printf '%s\n' "$props" | grep -xF "$key" || true)" ]; then
      printf '  %s declares no `%s` prop (D14)\n' "${yml#"$ROOT"/}" "$key"
      rc=1
    fi
  done
  return "$rc"
}

# The three `section` concerns that deliberately do not come along: the two-axis padding whose same
# word means two sizes (F7) and the three-way heading style (D14 — a zone heading has one style).
a7_zone_drops_the_section_concerns() {
  local yml="$COMPONENTS/zone/zone.component.yml" rc=0 props key
  file_exists "$yml" || return 1
  props="$(yaml_block_keys "$yml" properties 4)"
  for key in padding_x padding_y header_style; do
    if [ -n "$(printf '%s\n' "$props" | grep -xF "$key" || true)" ]; then
      printf '  %s still declares `%s` (D14: superseded by `inset` / a single heading style)\n' \
        "${yml#"$ROOT"/}" "$key"
      rc=1
    fi
  done
  return "$rc"
}

a7_zone_heading_is_an_h2() {
  local twig="$COMPONENTS/zone/zone.twig" rc=0
  file_exists "$twig" || return 1
  file_contains_e "$twig" '<h2' || rc=1
  file_lacks_e "$twig" '<h1' 'an <h1> (D5: page_header owns the only one)' || rc=1
  return "$rc"
}

check "A7 zone declares the slots heading/actions/content and the props inset/gap/direction/columns/list" \
  a7_zone_declares_its_slots_and_props
check "A7 zone declares no padding_x/padding_y and no header_style" \
  a7_zone_drops_the_section_concerns
check "A7 zone.twig renders an <h2> and no <h1>" a7_zone_heading_is_an_h2

# --- A8. `section` is DELETED --------------------------------------------------------------------
#
# THIS GROUP WAS INVERTED, and D18 IS RETIRED. It used to assert the opposite — that
# `components/section/` must still exist — so read the reversal deliberately rather than as drift.
#
# D18 kept `section` as legacy for exactly ONE reason: its only surviving callers were the three
# synchronised `display_builder` page-layout copies of the retired Drupal dashboard (F14) and, through
# them, two Playwright step files (F16). The argument was never that `section` had a future; it was
# that deleting it would drag a config reconciliation across both install paths into a layout ticket.
#
# THAT PREMISE IS VOID BY HUMAN DECISION: only Storybook counts, the Drupal side is to be rewired
# wholesale later, and every component no Designbook scene reaches is to be deleted together with its
# Drupal wiring. So the config reconciliation D18 was avoiding is now the work, not the obstacle — and
# with `zone` delivered (A7) a second body wrapper has no reason to exist at all. `section` is
# therefore gone, and A8 asserts its absence and that nothing renders it.
#
# The two consequences D18 predicted are real and were paid, not dodged: the three page-layout copies
# and the ticket-detail view display were deleted from every location that ships them, and
# `ShippedConfigDriftTest`'s dashboard-layout case was retired with the config it compared.
a8_section_is_deleted() {
  if [ -d "$COMPONENTS/section" ]; then
    printf '  components/section/ still exists; the human decision that voided D18 deletes it\n'
    ls "$COMPONENTS/section" | sed 's|^|    section/|'
    return 1
  fi
}

# R2 — kept from the pre-inversion form, and still worth its own check even though the repo-wide A2
# assertion above now subsumes it. It is the ONE surface on which `section` may never come back: a
# Designbook scene is where a second body wrapper would re-enter the design system, and A2's
# enumeration exempts `tests/contract/` whereas this one does not exempt anything under `designbook/`
# except the archives. Both address forms are matched: measuring only `bb_theme:` is what produced
# the spec's discarded "17 orphans" count (F12).
a8_designbook_no_longer_references_section() {
  local hits
  hits="$(designbook_hits_e '(bb_theme|DESIGNBOOK_COMPONENT_NAMESPACE):section([^A-Za-z0-9_-]|$)')"
  [ -z "$hits" ] && return 0
  printf '  designbook/ still references the deleted `section` wrapper (R2: no scene may):\n'
  printf '%s\n' "$hits" | sed "s|^$DESIGNBOOK/|    |"
  return 1
}

check "A8 components/section/ is deleted (D18 retired)" a8_section_is_deleted
check "A8 no file under designbook/ references bb_theme:section" \
  a8_designbook_no_longer_references_section

# --- A9. The spacing scale -----------------------------------------------------------------------

# The primitive spacing tokens, as `<name> <value>` pairs. Read out of the token file rather than out
# of the generated CSS: the token file is the source Designbook's `css-generate` consumes, and a
# hand-edited `primitive-spacing.src.css` that disagreed with it would be silently overwritten by the
# next generation.
primitive_spacing_tokens() {
  [ -f "$TOKENS" ] || return 1
  awk '
    /^primitive:/ { inp = 1; next }
    /^[A-Za-z]/   { inp = 0 }
    inp && /^  layout:/ { inl = 1; next }
    inp && /^  [A-Za-z]/ { inl = 0 }
    inl && /^    spacing:/ { ins = 1; next }
    inl && /^    row-h:/ { inrow = 1; next }
    inl && /^    [A-Za-z]/ && !/^    spacing:/ && !/^    row-h:/ { ins = 0; inrow = 0 }
    ins && /^      [A-Za-z0-9_-]+:/ { k = $1; sub(/:$/, "", k); next }
    ins && /^        \$value:/ { print k " " $2; next }
    inrow && /^      \$value:/ { print "row-h " $2; inrow = 0 }
  ' "$TOKENS"
}

# D16 (revised) — six tokens on an integer 4px-step scale, restructured from the flat
# `primitive.spacing.*` shape into `primitive.layout.spacing.*`, replacing `sec-pad`, `gap` and `m`
# (all superseded by `space-3`/`space-4`). `row-h: 34px` moved alongside under `primitive.layout`
# rather than under `primitive.layout.spacing` — it is a row height rather than spacing. It is
# consumed via the named `h-row`/`min-h-row` Tailwind utilities (backed by
# `--spacing-row` in `css/tokens/component-sizing.src.css`, itself resolving
# `component.row.height` -> `primitive.layout.row-h`), not by a raw `var(--spacing-row-h)`
# reference — a tree-wide grep for that literal string currently returns zero hits, so losing the
# 34px value would still be a silent regression, just reachable only through the two Tailwind
# utility names rather than a directly-quoted CSS variable.
a9_the_spacing_scale_is_declared() {
  local rc=0 tokens pair name value actual
  tokens="$(primitive_spacing_tokens)" || { printf '  missing file: %s\n' "${TOKENS#"$ROOT"/}"; return 1; }
  for pair in $SPACING_SCALE; do
    name="${pair%%:*}"
    value="${pair##*:}"
    actual="$(printf '%s\n' "$tokens" | awk -v n="$name" '$1 == n { print $2 }')"
    if [ "$actual" != "$value" ]; then
      printf '  primitive.layout.spacing.%s is `%s`, D16 measured `%s`\n' "$name" "${actual:-<absent>}" "$value"
      rc=1
    fi
  done
  actual="$(printf '%s\n' "$tokens" | awk '$1 == "row-h" { print $2 }')"
  if [ "$actual" != '34px' ]; then
    printf '  primitive.layout.row-h is `%s`, D16 keeps it at `34px`\n' "${actual:-<absent>}"
    rc=1
  fi
  for name in $RETIRED_SPACING_TOKENS; do
    if [ -n "$(printf '%s\n' "$tokens" | awk -v n="$name" '$1 == n { print $2 }')" ]; then
      printf '  primitive.layout.spacing.%s is still declared (D16: superseded by space-3/space-4)\n' "$name"
      rc=1
    fi
  done
  return "$rc"
}

# D16, second half — spacing in the LAYOUT layer is configuration on the scale, not a hard pixel
# value repeated per template. Scoped to these five templates by name: the 454 arbitrary values in
# the leaf components are explicitly out of scope (R3), and a tree-wide assertion would demand a
# sweep this ticket decided not to make.
a9_layout_twigs_carry_no_arbitrary_spacing() {
  local rc=0 name twig
  for name in $LAYOUT_TWIGS; do
    twig="$COMPONENTS/$name/$name.twig"
    file_lacks_e "$twig" "$SPACING_UTILITY_RE" 'an arbitrary [Npx] spacing utility (D16)' || rc=1
  done
  return "$rc"
}

check "A9 the token file declares space-1…space-6 with the measured values and no sec-pad/gap/m" \
  a9_the_spacing_scale_is_declared
check "A9 the five layout templates carry no arbitrary [Npx] spacing utility" \
  a9_layout_twigs_carry_no_arbitrary_spacing

# --- A10. Tabs live in the page header -----------------------------------------------------------

a10_page_header_declares_a_tabs_slot() {
  local yml="$COMPONENTS/page_header/page_header.component.yml" slots
  file_exists "$yml" || return 1
  slots="$(yaml_block_keys "$yml" slots 2)"
  if [ -z "$(printf '%s\n' "$slots" | grep -xF tabs || true)" ]; then
    printf '  %s declares no `tabs` slot (D7)\n' "${yml#"$ROOT"/}"
    printf '  it declares: %s\n' "$(printf '%s\n' "$slots" | tr '\n' ' ')"
    return 1
  fi
}

# D7's rejected alternative, asserted so it cannot be built later by accident: a second chrome
# component whose only content is a header and a tab row.
a10_entity_chrome_was_never_built() {
  if [ -d "$COMPONENTS/entity_chrome" ]; then
    printf '  components/entity_chrome/ exists; D7 folds the tabs into page_header instead\n'
    return 1
  fi
}

# D7/D19 — two callers, so the slot is a contract rather than a guess: the six project-detail scenes
# and the team scene. The assertion is structural — a `tabs:` key inside the page_header NODE's own
# subtree — because `tabs:` appearing anywhere in a 1 291-line file says nothing about which
# component it belongs to.
page_header_fills_tabs() {
  local file="$1" model="$2" idx="$3"
  scene_lines "$file" "$model" "$idx" | awk '
    function ind(s) { match(s, /^ */); return RLENGTH }
    { line = $0; sub(/\r$/, "", line) }
    line ~ /^[ \t]*$/ { next }
    {
      i = ind(line)
      body = substr(line, i + 1)
      if (body ~ /^#/) { next }
      if (body ~ /:[ \t]*[|>][0-9]*[-+]?$/) { blk = i; next }
      if (blk != "" && i > blk) { next }
      blk = ""
      if (inside && i <= node_ind) { inside = 0 }
      if (body ~ /^- component: *"?'"'"'?bb_theme:page_header([^A-Za-z0-9_-]|$)/) {
        inside = 1; node_ind = i; next
      }
      if (inside && body ~ /^tabs:/) { found = 1 }
    }
    END { exit(found ? 0 : 1) }
  '
}

a10_the_entity_places_fill_the_tabs_slot() {
  local rc=0 rel file model idx name mapping
  for rel in designbook/sections/projects/projects.section.scenes.yml \
    designbook/sections/settings/settings.section.scenes.yml; do
    file="$THEME/$rel"
    [ -f "$file" ] || { printf '  missing file: %s\n' "$rel"; rc=1; continue; }
    model="$(scene_model "$file")"
    for idx in $(scene_indices "$model"); do
      name="$(scene_name_of "$model" "$idx")"
      case "$name" in
        project-detail* | team) ;;
        *) continue ;;
      esac
      if page_header_fills_tabs "$file" "$model" "$idx"; then
        continue
      fi
      mapping="$(view_mapping_file "$file" "$model" "$idx" || true)"
      if [ -n "$mapping" ] && mapping_page_header_fills_tabs "$mapping"; then
        continue
      fi
      printf '  %s [%s]: no page_header node fills a `tabs` slot (D7/D19)\n' "$rel" "$name"
      rc=1
    done
  done
  return "$rc"
}

check "A10 page_header.component.yml declares a tabs slot" a10_page_header_declares_a_tabs_slot
check "A10 no entity_chrome component exists" a10_entity_chrome_was_never_built
check "A10 the project-detail scenes and the team scene fill page_header's tabs slot" \
  a10_the_entity_places_fill_the_tabs_slot

# --- Verdict -------------------------------------------------------------------------------------

if [ "$failures" -ne 0 ]; then
  printf '\n%s check(s) failed.\n' "$failures"
  exit 1
fi

printf '\nAll checks passed.\n'
