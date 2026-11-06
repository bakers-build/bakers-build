#!/usr/bin/env bash
set -euo pipefail

# A missing `yaml` module reads as nine ordinary check failures below — with both vacuity
# guards silently among them — the one failure shape this suite exists to make impossible.
# Fail loud, once, before any check runs.
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  printf 'FATAL: python3 module "yaml" is not installed (pip: PyYAML, apt: python3-yaml) — required by this suite\n' >&2
  exit 1
fi

# BB-389 — a container owns what is inside it, and a component knows no bakers.build concept.
#
# What this proves. BB-378 named the layout layer; the half of the theme that DISPLAYS data never
# got that pass. Measured over the 57 survivors: ten components exist only to be one item of
# something (five `<tr>` rows with 9/9/6/5/4 cells, three list entries, a board column, a row of
# pills), the ticket teaser is declared six times in two spellings across both Drupal install paths,
# and one scene ships a table with THREE headers over rows that emit NINE `<td>` each
# (`project-detail-delivery`) — invalid markup that renders without complaint, because the columns
# live in the row instead of in the table.
#
# The cause is one missing address: the toolchain has a View node (`entity: "view.<id>"`) and this
# theme never used it, so every listing was hand-rolled out of repeated single-entity nodes and every
# entity type got its own row component. This suite asserts the target: `table` owns `columns` +
# `rows`, `list` owns `items`, `form` owns its widget grammar, a cell is plain data, a listing is a
# View, and the classification is `group:` — the field every `component.yml` already declares.
#
# Every assertion is made against the TREE — the components, the scene files, the mappings, the
# `sync` generators, the data model, both Drupal install paths — never against the spec or the plan
# prose, which are documents this suite must be able to contradict.
#
# Ten groups of checks, B1–B10 of the spec's D8:
#   0. the enumerations this suite searches actually reach the files the criteria are about. Most of
#      B1–B10 are "no hit" assertions, so an enumeration that returned nothing would report them as
#      PASS while inspecting no bytes — and `errexit` is suppressed inside `check()`'s `if "$@"`, so
#      nothing else would notice. Inherited from the BB-378 suite's group 0; the reasoning is
#      restated here so it survives its source. This group also guards B10's VOCABULARY, which is
#      read out of `data-model.yml`: an extraction that returned an empty set would make B10 vacuous
#      in exactly the same silent way.
#   B1. No row, no column — `table.twig` is the only template with a `<tr>`, and no directory name
#       ends in `-row`/`_row`/`-column`/`_column`. A PATTERN, not a list, so a sixth row component
#       cannot be added quietly.
#   B2. The nineteen deletions — the directories are gone, no live surface of the repository renders
#       them, and the component count is `TARGET_COMPONENT_COUNT` (63 today; see that line for the
#       amendments that took it there from 41).
#   B3. The three container contracts — `table` (columns + rows), `list` (items + layout), `form`
#       (lead/lines/pills/actions) — and nothing else is a container.
#   B4. Cells are keyed against columns — for every `table` node in a scene and every view mapping.
#       This is the assertion the `project-detail-delivery` defect needed.
#   B5. Every listing is a View — no slot lists repeated single-entity nodes, no `records:` shorthand.
#   B6. One identity, no bare dot — `avatar` is markup inside `person.twig`, `status-dot` inside
#       `badge.twig`; neither is an address any more.
#   B7. The two artifacts for one unit agree — an entity mapping and its `sync` generator name the
#       SAME component. AC-1's guard.
#   B8. The classification is `group:` (a) and the spelling is DERIVED from it (b).
#   B9. One prose treatment — the arbitrary-value prose selectors live in `rich-text.twig` and
#       nowhere else.
#   B10. No component knows a bakers.build concept — the vocabulary read out of `data-model.yml`.
#
# Out of scope, deliberately, and therefore NOT asserted here:
#   - the 454 arbitrary `[Npx]` values in the leaf components (BB-378 R3, restated by this spec's
#     "Out of scope"). BB-378's A9 is scoped to five layout templates for that reason and this
#     suite adds no sweep of its own.
#   - colour and typography. No token assertion here; BB-378's A9 owns the spacing scale.
#   - retiring the `bb_dashboard` MODULE. It is already UNINSTALLED — absent from
#     `config/sync/core.extension.yml` — while its code and its own `config/{install,optional}` are
#     kept on purpose, so a `drush cim` can still run the module's uninstall path on each
#     environment. An uninstalled module is not a live surface, so `live_sources()` does not
#     enumerate it; see the narrowing there. Deciding the module's future is a different ticket with
#     a documented procedure.
#
# How to run — no DDEV environment, no Drupal bootstrap and no theme build required; every check is a
# read of repository content:
#   bash tests/contract/data-display-components.sh
#
# Exit code is the verdict: 0 = every check passed, 1 = at least one failed.
#
# Runs on bash 3.2 (macOS `/bin/bash`): no `mapfile`, no `declare -A`. `python3` with `yaml` is
# required — the criteria are about YAML STRUCTURE (which slot a node sits in, which keys a row's
# cell map has), and a grep cannot answer any of those.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THEME="$ROOT/web/themes/custom/bb_theme"
COMPONENTS="$THEME/components"
DESIGNBOOK="$THEME/designbook"
DATA_MODEL="$DESIGNBOOK/data-model.yml"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# --- Inventories --------------------------------------------------------------------------------

# The EIGHTEEN deleted directories that are still deleted (spec › *Deleted — 19*), in the eight
# cohorts the spec argues: five `<tr>` rows and one masked key/value list → `table`/`list`, three
# list entries → `list`, four badges → `badge`, two link rows → `link_group`, `avatar` → `person`,
# `board-column` → `board`, two form fields → `form`.
#
# `text_line` IS THE NINETEENTH, AND IT CAME BACK AND WENT AGAIN INSIDE BB-420. Both halves are
# stated because a deletion that reverses — and then re-reverses — is exactly what this list exists
# to make visible.
#
# It was lifted back out of `form` mid-ticket for a real reason: a widget renders itself, `form`'s
# regions became SLOTS to receive that rendering, and a macro inside `form.twig` is not addressable
# from outside that file. Then the rule changed underneath it. Every editable field in this UI now
# renders through Drupal's real form-element pipeline and is themed with Formdazzle overrides, which
# leaves no bespoke line component anywhere — so `text_line` was retired for good, along with its
# `data-form-line` hook and its JS. `form_input` and `form_textarea` are what a field is made of now.
#
# The retirement reached beyond this dialog, and that was the operator's call with the numbers in
# hand: `text_line` was also the theme's INLINE-EDIT affordance in `projects` and `settings`, so
# those headings carry a bordered box where they carried a borderless line.
#
# `property_row` stays deleted: the ROW is still `form`'s, and what came out beside the line is one
# PILL (`property_pill`), which is a different object.
DELETED_COMPONENTS='ticket-row ticket_list_row project-row group-row environment-row
text_line
member-row run_row meta_row
status-pill claim-badge status-dot refresh_indicator
link_row link_report_row
avatar
board-column
property_row
ticket_env'

# THE ONE PERMITTED EXCEPTION, EMPTY BY DEFAULT.
#
# `ticket-row` is the only deletion the spec gates on an open question (D4): `views.view.active_tickets`
# binds it as a `row:` plugin in BOTH install paths, `bb_dashboard` is installed, and whether
# ui_patterns can source a whole result set into a `rows` prop is unverified in this tree. If that
# spike lands on **D4-legacy**, `ticket-row` survives as legacy-only — and then it belongs HERE, with
# its reason, rather than quietly dropped out of the inventory above:
#
#   DELETED_ALLOWLIST='ticket-row  # D4-legacy: the ui_patterns rows source cannot feed `rows`, so the
#                                  # views binding stays until the wiring/retirement ticket. Legacy
#                                  # only — no file under designbook/ may name it (D4).
#
# An allowlisted name is exempt from the directory and repo-wide reference checks and RAISES the
# expected component count by one — but it is NOT exempt from `designbook/`, which is the surface
# D4-legacy forbids. An exception has to be visible IN the gate; a gate that hides one asserts less
# than it claims.
DELETED_ALLOWLIST=''

# The target inventory (spec › *The inventory: 57 → 41*): 57 − 19 deleted + 3 new = 41 as that
# ticket left it, then amended THREE times — BB-336, BB-415 and BB-420 below. The arithmetic
# that matters is therefore the one on the variable, not the one in this sentence: 57 − 18
# still-deleted + 3 new + 1 (BB-336) + 1 (BB-415) + 2 (BB-420) = 45. The check's own label no
# longer names a number and its failure message prints both, so neither can go stale the way two
# labels here already had.
#
# THE AMENDMENT IS THE POINT OF THE NUMBER rather than an exception to it. The count exists so a
# component cannot be added QUIETLY; adding one loudly means changing this line and saying why.
# Every raise is therefore recorded here, in order, and the check's own label carries the current
# value — a label that keeps naming a superseded number is how the drift below went unnoticed.
#
# 42 SINCE BB-336, which adds exactly one — `log-viewer`, which renders a block of machine
# output as a log (monospace, whitespace preserved, gutter line numbers, its own horizontal scroll)
# so that `bb_run.error_log` is readable at all. It is generic by B10's test: it knows `text` and
# `caption` and nothing about runs. The two components that ticket first shipped — `run_detail` and
# `run_state_badge` — are NOT here, because B10 and B6 rejected them and they dissolved into the
# mapping the way the run row did.
#
# 43 SINCE BB-415, which adds exactly one — `gate`, the product's SECOND CHROME (BB-415 › D6).
# It is a peer of `shell`, not a variant of it: the slot sets are disjoint, so it is declared beside
# the shell in `design-system.scenes.yml` rather than derived from it. It frames everything standing
# BEFORE the product — its first inhabitant is the workspace chooser `/home` answers with when a
# reader belongs to several workspaces or to none, and the auth pages are the intended second. It is
# generic by B10's test: it knows `title`, `description`, `mark` and `content`, and nothing about
# workspaces, tickets or any other bakers.build concept — the chooser's cards are passed into `content`.
#
# BB-415 also corrected a drift this line had already caused: the check's label below still said
# "41" while this constant had been 42 since BB-336, so the gate reported a number it was not
# asserting. Both move together from now on.
#
# 45 SINCE BB-420, for the same reason and by the same rule: two, loudly. `form`'s four regions
# became SLOTS, because a field widget renders itself and rendered content cannot go into a prop, so
# the two macros `form.twig` carried had to become addressable — `text_line` (restored, see above)
# and `property_pill`. Both are generic by B10's test: neither names an entity, a bundle or a field,
# and both are placed by a form display rather than by any form class. Nothing else moved with them:
# the markup, the classes and the two grammar rules they carry are the ones `form` already held.
#
# BB-481 raises this by four: `stat-windows`, `stat-series`, `stat-ratio` and `stat-breakdown`,
# one per value of the statistics `display` field. That field is a closed set, constrained in the
# config schema to exactly those four, and each kind carries a genuinely different value shape —
# three trailing totals; totals plus per-axis rows; a day series; a quotient with its two factors.
# One component covering all four would need every prop optional, and could then no longer require
# a `series` figure to actually carry its days. Since display_builder drops an invalid SDC prop
# SILENTLY rather than erroring, a lax schema there fails invisibly: the figure renders as an empty
# box and nothing says why. Four strict schemas trade a higher number here for components that
# cannot be handed the wrong data without failing visibly.
#
# `stat-breakdown` composes `table` rather than emitting rows of its own, so B1 still finds a single
# `<tr>` in the theme and B3 still finds exactly three containers. Its per-axis prop is named
# `entries` for that same reason: `rows` is container-exclusive under B3, and a display component
# declaring one would be claiming a contract it does not own.
# 45 + 4 (BB-481) = 49; BB-503 removes topbar, search_trigger, command_palette, user_menu,
# workspace_switcher (-5) and adds account_switcher (+1): 49 - 5 + 1 = 45
#
# 46 SINCE BB-490, and this one is a single addition rather than the groups above.
# `segmented_control` is the closed-rows control on the six operator listings: three mutually
# exclusive positions, each a link, exactly one carrying `aria-current`. It is generic by B10's
# test — it knows `label` and `items`, and nothing about tickets, runs or the word "closed". `tabs`
# was the obvious reuse and was rejected: its own description binds it to `page_header`'s `tabs`
# slot and to switching the subject of an entity page, so a filter rendered through it would have
# given one component two meanings and made the control read as page navigation.
#
# This line is the one the BB-490 / BB-503 merge collided on, and the resolution is arithmetic
# rather than a choice between two numbers: the two tickets moved the count in opposite directions
# and independently, so both chains stand and compose. 45 + 1 (BB-490) = 46.
#
# 47 SINCE BB-504 (Plan Task 11), one addition: `mode_toggle`, the icon button that flips the
# persisted colour mode (light/dark). It is a genuinely new component rather than a variant of an
# existing one — no other component in the rail footer is a button that calls
# `window.bakersToggleMode()` — and it is generic by B10's test: it knows `mode` (for static/story
# rendering) and `label`, and nothing about any bakers.build entity or bundle. It sits in the sidebar
# footer's `actions` slot beside `person`, is NOT an island (no `hx-*` attribute, no region
# rebuild — a pure client-side attribute flip and localStorage write, same mechanism `skin.src.js`
# itself uses), and carries zero outer margin as every CONTENT component in this theme must; the
# `gap-2` between it and `person` is owned by `sidebar.twig`'s own footer row. 46 + 1 (BB-504) = 47.
# 48 SINCE BB-547: `brand` owns the shared login logo and wordmark.
# It is a Shell component, not an entity-specific data display. 47 + 1 = 48.
# 49: `stat-comparison` is the shared-axis two-series plot. Existing
# `stat-series` bars cannot carry two measurements on one time/value scale.
# 50: `onboarding` is the wizard chrome: one centred column with the mark and
# the step's heading and sentence above the form card. Gate carries no
# per-step copy above its card.
# 53: three additions, because PHP under web/modules/custom may no longer
# build tags or set classes for what the theme renders. `text` is one run of
# copy in a typographic role (paragraph, heading, span or link) for the
# login, join, onboarding and device-sign-in forms; `toast` is the fixed
# confirmation (then the Settings autosave's `Saved`, which explicit Save has
# since retired) whose classes used to sit in a PHP render array and a
# safelist span in `status_bar`; `menu_item` is one row of the workspace
# switcher panel, whose link classes the panel source set. No existing
# component fits: `note` and `message` are asides with their own frame,
# `button` is a control, and the switcher panel is a slot filled row by row.
# 50 + 3 = 53.
# 54: `tab` is one destination of the `tabs` row and the single owner of its
# link classes. Drupal's local-task presenter has to style a link render
# element it may not rebuild (`#access`, URL options and cacheability ride on
# it), one task at a time; without a one-link component that class list lived
# twice, in `tabs.twig` and in `menu-local-task.html.twig`, kept equal by hand.
# `menu_item` is a `role="menuitem"` panel row, not a page-navigation link.
# 53 + 1 = 54.
# 55: `gate_form` is the frame of every form in the gate card (login, the
# e-mail code, device sign-in, creating and joining a workspace). Core's form
# elements carry no spacing, and the gap, action row and focus ring used to be
# classes in per-form presenter templates — three forms had none and rendered
# their submit flush on the field. A presenter may not set classes, so the
# frame is a component the six form templates include; `gate` is the card
# around it and `form` is the dialog surface whose grammar rejects labelled
# rows, so neither fits. 54 + 1 = 55.
# 56: `image_crop` is the square crop control of an image upload: a thumbnail
# of the staged square, an Edit crop button and a native modal dialog that pans
# and zooms the image behind a fixed square. The `bb_square_image` widget
# renders it for every image field, so the profile, onboarding, project and
# group uploads share one control. `dialog` cannot host it: that hull is
# island's, whose Escape handler would close a parent create dialog, and it is
# not opened modally into the top layer. 55 + 1 = 56.
# 57 SINCE BB-592: `form_select`, the theme's native `<select>`. The listings'
# "Sort by" dropdown is BEF's combined native select, which rendered through
# core's unstyled `select.html.twig`: at a narrow content column it grew to its
# longest option and scrolled the page, and no scene could depict it. It is the
# select sibling of `form_input` (same attribute pass-through, same tokens), not
# an `option_picker` variant — that is a disclosure listbox with its own
# interaction, while the sort must stay a plain GET form control. 56 + 1 = 57.
# 58 SINCE BB-617: `setup_command`, a copyable command for the onboarding
# setup pages. The wizard has to show exact CLI and slash-command lines with
# one Copy action each; `text` can print the line but has no copy control, and
# `button` is a control without the escaped pre/code. The new component owns
# both: escaped command text plus a native type=button that reads that DOM
# text into the clipboard. It is Action (a Copy control) so the directory is
# snake_case. 57 + 1 = 58.
# 59 SINCE BB-617: `copied`, the absolutely positioned copy confirmation.
# `setup_command` had an in-flow status line that grew the card on every copy.
# `toast` is the viewport-fixed sibling for "Saved" and cannot sit on a control.
# `copied` is that confirmation as a reusable overlay: one element, empty
# hidden, parent supplies `relative`. Data Display (single word). 58 + 1 = 59.
# 60 SINCE BB-617: `setup_paths`, the agent plugin-install panels. PHP used
# to emit flex/gap classes and Alpine `x-data`/`x-show` for Claude vs Codex.
# Presenters may not set classes; this wrapper owns `{ client }` and the
# segmented filter, so the form passes props and slots only. Action (snake_case),
# sibling of `setup_command`. 59 + 1 = 60.
# 61 SINCE the run canonical page: `breadcrumb`, a generic trail of ordered
# places (label plus optional url). The shared page_header grew a slot so the
# nested run page can show Workspace → Ticket → Run without a product-named
# component. Layout (snake_case), sibling of page_header. 60 + 1 = 61.
# 62 SINCE BB-661: `surface_card`, the lifted-panel look `inspector`'s
# `surface` variant already draws, factored out for a SECOND panel of
# `canvas.inspector` — the ticket's Addons card (a tab strip over one message
# panel) — so that second panel does not grow a product-named wrapper of its
# own. Owns no bakers.build concept: an optional `header` slot over a divider, then
# `content`. Layout (snake_case), sibling of `inspector`. 61 + 1 = 62.
# 63 SINCE BB-640: `week-strip`, the Harvest-style day selector with daily
# totals for the time calendar. No existing component carries a seven-day link
# row with a value per day: `segmented_control` is a filter without values,
# `tabs` switches an entity's subject, and `stat-tile` has no link. 62 + 1 = 63.
# 64 SINCE BB-670: `action_menu`, a list row's several actions behind one
# more-horizontal trigger. `nav` draws such a menu inline for its own items
# only, and `account_switcher` is shell chrome; no component offered it to a
# row. Native <details>, so the actions work without JavaScript. Action
# (snake_case), sibling of `option_picker`. 63 + 1 = 64.
# 65 SINCE BB-28: `form_rich_text`, the Markdown authoring control — a
# formatting toolbar over a plain textarea for every bb_rich body. It is a
# second control, not a replacement: `form_textarea` stays the plain box, and
# `rich-text` only displays processed HTML. Neither can grow a toolbar without
# changing what every other caller renders. Form (snake_case), sibling of
# `form_textarea`. 64 + 1 = 65.
# 66 SINCE BAKERS-12: `flow-chart`, tickets created ("new") against tickets
# closed ("done") per section, the area between the two lines tinted by which
# one is larger. No existing component fits: `stat-comparison` draws up to six
# independent lines but has no area between two series, no running or cut
# section marks (dashed last interval, hollow points) and no ratio; `stat-series`
# and `stat-ratio` show one value shape each. Generic by B10's test: it knows
# sections, two counts, an optional open count and a prepared ratio, nothing
# about tickets. Data Display (kebab-case), sibling of `stat-comparison`.
# 65 + 1 = 66.
# 67 SINCE BAKERS-11: `period-range`, the shared statistics period switch — a
# kind dropdown, previous/next around a calendar picker and the "vs."
# comparison text, with its own date math. No existing component offers a period: `option_picker`
# picks values a server rendered, and `week-strip` shows days, it does not
# choose a range. Data Display (kebab-case). 66 + 1 = 67.
# 68 SINCE BAKERS-54: `time`, the one `<time datetime title>` every displayed
# timestamp renders through, fed by `BbDate`. No component rendered a point in
# time; `event` hand-wrote its own. Data Display (single word). 67 + 1 = 68.
# 69 SINCE BAKERS-54: `form_check`, the native checkbox or radio with the shared
# focus ring. The `input--checkbox`/`input--radio` presenters drew it inline;
# a presenter carries no classes, so the input became the `form_input` sibling
# it is. Form (snake_case). 68 + 1 = 69.
# 70 SINCE BAKERS-54: `form_field`, the field wrapper around a control. The
# `form-element` presenter rendered stable9 markup and styled the help text
# itself; the field also owns the space below it, so forms stack evenly.
# Form (snake_case). 69 + 1 = 70.
TARGET_COMPONENT_COUNT=70

# The three containers and the props that make them containers (D2).
CONTAINER_COMPONENTS='table list form'

# The seven `group:` values (D9). SDC's own classification field, which Storybook builds its sidebar
# from; six are in use today and `Form` is the seventh this ticket adds.
ARRANGE_GROUPS='Layout|Shell|Navigation|Action|Form'
DISPLAY_GROUPS='Data Display|Media'

# The `Form` membership (D9). `input`/`label` are renamed `form_input`/`form_label` and move here;
# `button`, `option_list` and `option_picker` stay in `Action`, because they are used far outside any
# add or edit surface (`option_picker` 24 times) and a filter picker in a group called `Form` would
# be a lie about where it is used.
#
# `property_pill` and `form_textarea` join them with BB-420 (see the count above). They belong
# here and not in `Action` by the very test that keeps `option_picker` out of it: a pill and a
# textarea are widgets of the add/edit grammar and are used nowhere else, where `option_picker` is
# used 24 times across filters and inline edits.
#
# `image_crop` joins by the same test: it is the crop control of an image
# upload widget and appears only inside add and edit forms.
#
# `form_rich_text` joins as the Markdown counterpart of `form_textarea`: it is
# only ever a body field of an add or edit form.
#
# `form_check` joins as the checkbox/radio sibling of `form_input`, and
# `form_field` as the field wrapper both sit in.
FORM_COMPONENTS='form form_check form_field form_input form_label form_rich_text form_select form_textarea image_crop property_pill'

# A `<tr>` open tag. The trailing guard is "anything that is not a name character", because the tag
# is written `<tr{{ attributes }}` in this theme — a space/`>` guard would match none of the five row
# templates and B1 would have reported PASS while finding nothing.
TR_RE='<tr([^A-Za-z0-9-]|$)'

# The arbitrary-value prose selectors that ARE the rich-body treatment (D10). Measured once in the
# theme today, inlined in `comment_event.twig` as a fifteen-declaration blob, while the ticket
# detail renders `$t.description` with no treatment at all — so a comment body and a ticket
# description, the same field type, do not look alike.
PROSE_SELECTOR_RE='\[&>p\]|\[&_a\]|\[&_code\]|\[&_pre\]|\[&_ul\]'

# The three section scene files. Every listing and every table this ticket is about lives in one of
# them; `design-system/design-system.scenes.yml` declares the shell and holds no data table.
SECTION_SCENE_FILES='designbook/sections/tickets/tickets.section.scenes.yml
designbook/sections/projects/projects.section.scenes.yml
designbook/sections/settings/settings.section.scenes.yml'

# --- Enumeration --------------------------------------------------------------------------------
#
# The enumeration idiom, the comment stripping and the two "hits" helpers below are BB-378's,
# reused deliberately rather than re-invented: the criteria are the same shape (does any live surface
# still RENDER this name) and two suites disagreeing about what a live surface is would be worse than
# the duplication. The reasoning is restated in short form; the long form is in
# `layout-components.sh`.
#
# NO `grep -q` MAY APPEAR INSIDE A PIPELINE IN THIS FILE. Under `pipefail`, `grep -q` exits as soon
# as it matches, the writer upstream dies of SIGPIPE, and `pipefail` turns that into a failed
# pipeline — so such a check fails intermittently, on the order of one run in five. Use
# `[ -z "$(… | grep … || true)" ]` instead.
#
# `storybook-static/` IS EXCLUDED. It is the `storybook build` OUTPUT — the same class of artifact as
# `dist/` — but unlike `dist/` it is not gitignored here, so `--others --exclude-standard` hands it
# over as though it were source, and its bundles INLINE every component's Twig verbatim. Scanning it
# would make B2 assert that a deleted component is absent from a build produced BEFORE the deletion:
# red until someone rebuilt, and — worse — green again on a stale build of a tree that had regrown
# the component.
theme_sources() {
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- "$THEME" |
    while IFS= read -r rel; do
      case "$rel" in
        */storybook-static/*) continue ;;
      esac
      [ -f "$ROOT/$rel" ] && printf '%s\n' "$ROOT/$rel"
    done
}

# Every LIVE surface that can RENDER or BIND a component: the theme, the shipped config of BOTH
# install paths (`config/sync` for the server's CIM, `recipes/**` and the modules'
# `config/{install,optional}` for the recipe path) and the custom modules' PHP. `web/modules` is
# passed whole rather than `web/modules/custom`, so a tracked contrib patch or a second custom tree
# is not silently exempt.
#
# Excluded, each for a reason that is not convenience:
#   - `docs/**` and `designbook/plans/**` are ARCHIVES. A spec, a plan or a Designbook workflow record
#     legitimately quotes the world as it was when it was written; rewriting one so a criterion about
#     live artifacts passes would falsify the record.
#   - `tests/contract/**`. A contract suite names a banned component precisely in order to BAN it, so
#     the mention IS the ban rather than a render. This file's own `DELETED_COMPONENTS` inventory is
#     the same case.
#   - `storybook-static/`, for the reason above.
#   - `*.md`. Prose end to end; it cannot render anything.
#   - EVERY FILE INSIDE AN UNINSTALLED MODULE, computed by `dormant_module_roots` below. The check's
#     own name is "no LIVE surface … renders a deleted component"; a module Drupal never installs
#     renders nothing, so counting it made the criterion assert something stronger than it claims.
#     This is the narrowing, and — like the legacy allowlist above and B7's generator-less mappings —
#     it is written down HERE so the exception is visible IN the gate rather than hidden by it.
live_sources() {
  local skip root
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- \
    "$ROOT/config" "$ROOT/recipes" "$ROOT/web/modules" "$ROOT/web/themes/custom" |
    while IFS= read -r rel; do
      case "$rel" in
        */designbook/plans/* | */storybook-static/*) continue ;;
        # A TEST FIXTURE IS NOT A LIVE SURFACE. BB-396 finished the
        # bb_dashboard retirement and moved that module's four Views into
        # bb_core/tests/fixtures/views/, where two access tests import them by
        # path to execute a query. They are inert config that nothing installs
        # or renders — and one of them still names `bb_theme:ticket-row`,
        # which is exactly the stale address the header below warns about. It
        # stays because the tests are about query access and not about the row
        # plugin, and it is exempted here rather than silently edited out of the
        # fixture, which would change the byte the test claims to measure.
        */tests/fixtures/*) continue ;;
        *.md) continue ;;
      esac
      skip=0
      for root in $DORMANT_MODULE_ROOTS; do
        case "$rel" in "$root"*) skip=1; break ;; esac
      done
      [ "$skip" -eq 1 ] && continue
      [ -f "$ROOT/$rel" ] && printf '%s\n' "$ROOT/$rel"
    done
}

# The module machine names `config/sync/core.extension.yml` lists — Drupal's own record of what is
# installed, read from the file rather than restated here, so retiring or installing a module needs
# no edit to this suite. The `module:` block only: `theme:` and `profile:` are a different namespace.
installed_modules() {
  awk '
    /^module:$/ { inmod = 1; next }
    /^[a-z_]+:/ { inmod = 0 }
    inmod && /^  [a-z0-9_]+: [0-9]+$/ { name = $1; sub(/:$/, "", name); print name }
  ' "$ROOT/config/sync/core.extension.yml"
}

# Every module directory under `web/modules` whose machine name is NOT installed, as a path prefix.
# A module root is where its `*.info.yml` sits, so this finds NESTED modules too — which is the case
# that matters: `bb_dashboard` is a SUBMODULE of `bb_core`
# (`web/modules/custom/bb_core/modules/bb_dashboard`), so a check on the top-level directory
# under `web/modules` would not have found it, and skipping `bb_core` to reach it would have
# blinded B2 to the one module that IS installed and does render.
#
# WHAT THIS SKIPS TODAY, and why each is right rather than convenient:
#   bb_dashboard  — RETIRED in 549c738a. Uninstalled, but its code and its own
#                     `config/{install,optional}` are deliberately kept so `drush cim` can run the
#                     module's uninstall path on every environment; they go with the ticket that
#                     FINISHES the retirement, not with this one. It holds all five of the live
#                     bindings B2 used to report: `bb_theme:ticket-row` in
#                     `views.view.active_tickets` and in the `bb_ticket` teaser display,
#                     `bb_theme:run_row` and `bb_theme:comment_event` in two more displays, and
#                     `bb_theme:board-column` in `DashboardBoardRenderer`.
#   island, designbook_config_schema, and the three `tests/modules/*` fixtures — also not installed.
#                     MEASURED: zero deleted-component references between them, so widening the
#                     exemption past `bb_dashboard` is real but inert today. It is still an
#                     exemption: a test fixture that renders a deleted component would go unseen
#                     here, and the theme-scoped checks (B1, B8b, the count) do not cover it either.
#
# THE BLIND SPOT THIS CANNOT FIX, for whoever finishes the retirement. `comment_event` was RENAMED to
# `event` by this ticket, not deleted, so it is not in `DELETED_COMPONENTS` and B2 would NEVER have
# caught the dangling `bb_theme:comment_event` in the dormant `bb_comment.full` display — not
# before this narrowing and not after it. Every renamed component has the same hole: a stale address
# left in dormant config is caught by no check in this file. Grep the dormant tree for every name
# this ticket touched before you delete it.
dormant_module_roots() {
  local installed name
  installed=" $(installed_modules | tr '\n' ' ')"
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- "$ROOT/web/modules" |
    while IFS= read -r rel; do
      case "$rel" in
        *.info.yml) ;;
        *) continue ;;
      esac
      name="$(basename "$rel" .info.yml)"
      case "$installed" in
        *" $name "*) continue ;;
      esac
      printf '%s/\n' "$(dirname "$rel")"
    done
}

# Computed once: `live_sources` is called by the non-vacuity guard and by every `live_hits_e` scan,
# and each call would otherwise re-read `core.extension.yml` and re-walk `web/modules`.
DORMANT_MODULE_ROOTS="$(dormant_module_roots)"

# A COMMENT IS NOT A RENDER, so every scan strips comments before it matches. Recording WHY a
# component was retired requires naming it, and a comment-blind ban would forbid every honest
# retirement note and push the next author toward deleting the explanation instead of the code. The
# inverse costs just as much: BB-378's first measurement spared `section` because two templates
# mentioned it in PROSE.
#
# Blank the comment body rather than deleting the line, so reported line numbers stay true.
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

comment_family() {
  case "$1" in
    *.twig) printf 'twig\n' ;;
    *.ts | *.js | *.mjs | *.cjs | *.css | *.php) printf 'c\n' ;;
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

# The same, narrowed to `designbook/` — the surface D4-legacy forbids even for an allowlisted name.
# `designbook/plans/` is excluded: those are Designbook's own ARCHIVED workflow records.
designbook_hits_e() {
  local pattern="$1"
  git -C "$ROOT" ls-files --cached --others --exclude-standard -- "$DESIGNBOOK" |
    while IFS= read -r rel; do
      case "$rel" in
        */designbook/plans/* | *.md) continue ;;
      esac
      [ -f "$ROOT/$rel" ] || continue
      strip_comments "$ROOT/$rel" "$(comment_family "$rel")" |
        grep -nE -e "$pattern" | sed "s|^|$rel:|" || true
    done
}

# One regex matching a render of any name in `$1`, in either address form a scene, mapping, template
# or Drupal config uses: `bb_theme:<name>`, `$DESIGNBOOK_COMPONENT_NAMESPACE:<name>` or the
# `bb_theme/<name>` library form. Built once and searched in a SINGLE pass rather than once per
# name: `strip_comments` runs an `awk` per file, so a per-name loop would re-strip the whole tree
# nineteen times.
components_re() {
  local alt="" name
  for name in $1; do
    alt="${alt:+$alt|}$name"
  done
  printf '(bb_theme|DESIGNBOOK_COMPONENT_NAMESPACE)[:/](%s)([^A-Za-z0-9_-]|$)\n' "$alt"
}

# Is this name on the allowlist above?
is_allowlisted() {
  local name
  for name in $DELETED_ALLOWLIST; do
    case "$name" in
      '#'*) break ;;
    esac
    [ "$name" = "$1" ] && return 0
  done
  return 1
}

allowlist_count() {
  local name n=0
  for name in $DELETED_ALLOWLIST; do
    case "$name" in
      '#'*) break ;;
    esac
    n=$((n + 1))
  done
  printf '%s\n' "$n"
}

# Every component directory of the theme, one per line.
component_dirs() {
  local d
  for d in "$COMPONENTS"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    printf '%s\n' "${d##*/}"
  done
}

# --- File helpers -------------------------------------------------------------------------------

file_exists() {
  [ -f "$1" ] || { printf '  missing file: %s\n' "${1#"$ROOT"/}"; return 1; }
}

# --- 0. The enumerations are non-vacuous --------------------------------------------------------

enumeration_reaches_the_criterion_files() {
  local list count rc=0 rel
  list="$(theme_sources)"
  count="$(printf '%s\n' "$list" | grep -c . || true)"
  if [ "$count" -lt 200 ]; then
    printf '  theme enumeration returned only %s file(s) — it cannot have inspected the theme\n' "$count"
    rc=1
  fi
  # One file per surface the theme enumeration has to reach: the data model, a section's scenes, an
  # entity mapping and a component contract. The criterion is LOAD-BEARING, not decorative — if the
  # enumeration stopped reaching `designbook/entity-mapping/`, B5 and B7 would both report PASS
  # having read nothing.
  #
  # The mapping named here must therefore be one this ticket LEAVES ALONE, or the guard dies of the
  # change it guards. `view.tickets.default.jsonata` is that file: D1 makes every listing a
  # `view.<id>` mapping and this is that decision's deliverable for the tickets listing, so B5
  # already fails if it disappears; D3 deletes only the four `*.teaser` mappings and a View is
  # explicitly not a view mode; D11 moves entity knowledge INTO the mappings rather than out; and no
  # task after this one touches a `view.*` mapping at all. Its predecessor here was
  # `bb_ticket.bb_ticket.teaser.jsonata`, which D3 deletes by design.
  for rel in \
    'designbook/data-model.yml' \
    'designbook/sections/tickets/tickets.section.scenes.yml' \
    'designbook/entity-mapping/view.tickets.default.jsonata' \
    'components/table/table.component.yml'; do
    if [ -z "$(printf '%s\n' "$list" | grep -xF "$THEME/$rel" || true)" ]; then
      printf '  enumeration does not reach %s\n' "$rel"
      rc=1
    fi
  done
  return "$rc"
}

# The same guard for the repo-wide enumeration. B2 is a "no hit" assertion over BOTH Drupal install
# paths, so a `--` pathspec that silently matched nothing (git treats it as empty rather than an
# error) would report PASS having inspected no bytes. The named files are one per surface: the
# server's CIM source, the recipe path, a custom module and the theme.
live_enumeration_is_non_vacuous() {
  local list count rc=0 rel
  list="$(live_sources)"
  count="$(printf '%s\n' "$list" | grep -c . || true)"
  if [ "$count" -lt 400 ]; then
    printf '  live enumeration returned only %s file(s) — it cannot have inspected the repository\n' "$count"
    rc=1
  fi
  for rel in \
    'config/sync/system.theme.yml' \
    'recipes/bakers/recipe.yml' \
    'web/modules/custom/bb_core/bb_core.install' \
    'web/themes/custom/bb_theme/bb_theme.info.yml'; do
    if [ -z "$(printf '%s\n' "$list" | grep -xF "$ROOT/$rel" || true)" ]; then
      printf '  live enumeration does not reach %s\n' "$rel"
      rc=1
    fi
  done
  return "$rc"
}

# B1, B3, B8 and B10 all iterate the component directories, and B10 additionally reads its whole
# VOCABULARY out of `data-model.yml`. Both are single points of silent vacuity: an empty directory
# glob makes every per-component assertion pass, and an empty vocabulary makes B10 pass while
# matching nothing at all. Assert both here, once, rather than in each group.
component_and_vocabulary_enumerations_are_non_vacuous() {
  local rc=0 count
  count="$(component_dirs | grep -c . || true)"
  if [ "$count" -lt 20 ]; then
    printf '  the component enumeration returned only %s directory/ies\n' "$count"
    rc=1
  fi
  file_exists "$COMPONENTS/table/table.component.yml" || rc=1
  file_exists "$DATA_MODEL" || rc=1
  if ! python3 - "$DATA_MODEL" <<'PY'; then
import sys
import yaml
# The same extraction B10 uses, asserted here for non-emptiness only. Two independent copies would
# drift, so B10's block below is the one that documents the rule; this is a smoke test of the source.
model = yaml.safe_load(open(sys.argv[1])) or {}
content = model.get('content') or {}
nouns = set()
for entity_type, bundles in content.items():
    for bundle in bundles:
        for machine in (entity_type, bundle):
            nouns.add(machine)
            if machine.startswith('bb_'):
                nouns.add(machine[len('bb_'):])
if len(nouns) < 10:
    print(f'  data-model.yml yielded only {len(nouns)} entity/bundle noun(s): {sorted(nouns)}')
    sys.exit(1)
if 'bb_ticket' not in nouns or 'ticket' not in nouns:
    print(f'  the extraction lost the ticket noun; it read: {sorted(nouns)}')
    sys.exit(1)
PY
    rc=1
  fi
  return "$rc"
}

# The scene parser must actually see scenes: B4 and B5 are per-scene "no hit" assertions, so a scenes
# file whose `scenes:` key moved would silence both.
scene_enumeration_is_non_vacuous() {
  python3 - "$THEME" $SECTION_SCENE_FILES <<'PY'
import sys, yaml
theme, rc = sys.argv[1], 0
for rel in sys.argv[2:]:
    try:
        doc = yaml.safe_load(open(f'{theme}/{rel}')) or {}
    except OSError as exc:
        print(f'  {rel}: cannot be read ({exc})')
        rc = 1
        continue
    scenes = doc.get('scenes') or []
    if len(scenes) < 2:
        print(f'  {rel}: the parser found {len(scenes)} scene(s) — it cannot have inspected the file')
        rc = 1
    for scene in scenes:
        if not isinstance(scene, dict) or not scene.get('name'):
            print(f'  {rel}: a scene has no `name`, so no failure below could name it')
            rc = 1
sys.exit(rc)
PY
}

check "the theme enumeration is non-vacuous and reaches the criterion files" \
  enumeration_reaches_the_criterion_files
check "the repo-wide live enumeration is non-vacuous and reaches both install paths" \
  live_enumeration_is_non_vacuous
check "the component enumeration and B10's data-model vocabulary are non-vacuous" \
  component_and_vocabulary_enumerations_are_non_vacuous
check "the scene parser reaches the scenes of all three section files" \
  scene_enumeration_is_non_vacuous

# --- B1. No row, no column ----------------------------------------------------------------------

# D2 — a table owns its rows, so `<tr>` exists in exactly one template. Comments are stripped first:
# `member-row.twig`'s `<td>` sits inside a comment today, and a comment is not markup.
b1_table_is_the_only_template_with_a_tr() {
  local rc=0 twig hits
  for twig in "$COMPONENTS"/*/*.twig; do
    [ -f "$twig" ] || continue
    case "$twig" in */table/table.twig) continue ;; esac
    hits="$(strip_comments "$twig" twig | grep -nE "$TR_RE" || true)"
    if [ -n "$hits" ]; then
      printf '  %s contains a <tr> — only table.twig may (D2):\n' "${twig#"$COMPONENTS"/}"
      printf '%s\n' "$hits" | sed 's|^|    |'
      rc=1
    fi
  done
  # The mirror: the one template that must have one. A `table` that stopped rendering a row would
  # otherwise satisfy the check above by being empty.
  if [ -z "$(strip_comments "$COMPONENTS/table/table.twig" twig | grep -nE "$TR_RE" || true)" ]; then
    printf '  table.twig renders no <tr> at all\n'
    rc=1
  fi
  return "$rc"
}

# The inventory rule stated as a PATTERN rather than as a list, so the next author cannot add a sixth
# row component without this gate saying so. `-column` and `_column` are here for the same reason:
# `board-column` is a column of a board exactly as `ticket-row` is a row of a table.
b1_no_row_or_column_directory_names() {
  local rc=0 name
  for name in $(component_dirs); do
    case "$name" in
      *-row | *_row | *-column | *_column)
        printf '  components/%s/ is named as one item of a container (D2/D3)\n' "$name"
        rc=1
        ;;
    esac
  done
  return "$rc"
}

check "B1 table.twig is the only template under components/ containing a <tr>" \
  b1_table_is_the_only_template_with_a_tr
check "B1 no component directory name ends in -row/_row/-column/_column" \
  b1_no_row_or_column_directory_names

# --- B2. The nineteen deletions -----------------------------------------------------------------

b2_deleted_directories_are_gone() {
  local rc=0 name
  for name in $DELETED_COMPONENTS; do
    if is_allowlisted "$name"; then continue; fi
    if [ -d "$COMPONENTS/$name" ]; then
      printf '  components/%s/ still exists (spec › Deleted — 19)\n' "$name"
      rc=1
    fi
  done
  return "$rc"
}

# R4 — `bb_dashboard` is INSTALLED, so a component deleted while a `display_builder` layout or a
# view still names it does not fail loudly: display_builder drops an unresolvable component silently,
# the layout renders a hole, and nothing reports it. This check is what makes that visible, and it is
# why it greps `config/**` and `web/modules/**` and not only the theme.
b2_no_live_surface_renders_a_deleted_component() {
  local names="" name hits
  for name in $DELETED_COMPONENTS; do
    if is_allowlisted "$name"; then continue; fi
    names="${names:+$names }$name"
  done
  [ -n "$names" ] || return 0
  hits="$(live_hits_e "$(components_re "$names")")"
  [ -z "$hits" ] && return 0
  printf '  a live surface still renders a deleted component:\n'
  printf '%s\n' "$hits" | sed "s|^$ROOT/|    |"
  return 1
}

# D4-legacy's own condition, and the reason the allowlist is not a blanket pardon: an allowlisted
# component is legacy Drupal wiring only, so no file under `designbook/` may name it. Vacuous while
# the allowlist is empty — which is the default and the target.
b2_no_designbook_file_names_an_allowlisted_component() {
  local names="" name hits
  for name in $DELETED_COMPONENTS; do
    if is_allowlisted "$name"; then names="${names:+$names }$name"; fi
  done
  [ -n "$names" ] || return 0
  hits="$(designbook_hits_e "$(components_re "$names")")"
  [ -z "$hits" ] && return 0
  printf '  designbook/ names a legacy-only component (D4: no scene may):\n'
  printf '%s\n' "$hits" | sed 's|^|    |'
  return 1
}

# 57 − 19 + 3 = 41 at BB-389 (spec › *The inventory: 57 → 41*), and every amendment since is
# chained at `TARGET_COMPONENT_COUNT` itself — that line, and not this one, is the authoritative
# derivation. A count is what catches the deletion that was replaced by a new component
# nobody agreed to: the two halves of the rename are asserted separately above and here they have to
# add up.
b2_the_component_count_is_the_target() {
  local count expected extra
  count="$(component_dirs | grep -c . || true)"
  extra="$(allowlist_count)"
  expected=$((TARGET_COMPONENT_COUNT + extra))
  if [ "$count" -ne "$expected" ]; then
    printf '  the theme ships %s components; the target inventory is %s' "$count" "$TARGET_COMPONENT_COUNT"
    if [ "$extra" -ne 0 ]; then printf ' + %s allowlisted' "$extra"; fi
    printf '\n'
    return 1
  fi
}

check "B2 the eighteen still-deleted component directories are gone" b2_deleted_directories_are_gone
check "B2 no live surface of the repository renders a deleted component (both install paths)" \
  b2_no_live_surface_renders_a_deleted_component
check "B2 no file under designbook/ names an allowlisted legacy component" \
  b2_no_designbook_file_names_an_allowlisted_component
check "B2 the theme ships exactly the target inventory of components" b2_the_component_count_is_the_target

# --- B3. The three container contracts ----------------------------------------------------------

# D2 — `table` takes over the two things the rows held. `headers` is gone because a header without a
# key cannot be keyed against a cell (F4), and `head`/`body` are gone because a slot is how the old
# architecture injected a RENDERED row: keeping it would keep the escape hatch that produced the
# three-headers-over-nine-cells defect. `empty` survives, for the collapsed variant's confirmation
# strip.
b3_the_container_contracts() {
  python3 - "$COMPONENTS" <<'PY'
import os
import sys
import yaml

comps, rc = sys.argv[1], 0


def load(name):
    path = f'{comps}/{name}/{name}.component.yml'
    if not os.path.exists(path):
        print(f'  components/{name}/{name}.component.yml does not exist (D2)')
        return None
    meta = yaml.safe_load(open(path)) or {}
    return (
        (meta.get('props') or {}).get('properties') or {},
        meta.get('slots') or {},
    )


def want(name, kind, block, keys):
    global rc
    for key in keys:
        if key not in block:
            print(f'  {name} declares no `{key}` {kind} (D2)')
            rc = 1


def reject(name, kind, block, keys, why):
    global rc
    for key in keys:
        if key in block:
            print(f'  {name} still declares the `{key}` {kind} — {why} (D2)')
            rc = 1


table = load('table')
if table is None:
    rc = 1
else:
    props, slots = table
    want('table', 'prop', props, ('columns', 'rows'))
    reject('table', 'prop', props, ('headers',), '`columns` replaced it, keyed against the cells')
    reject('table', 'slot', slots, ('head', 'body'), 'it is the rendered-row injection point')

listing = load('list')
if listing is None:
    rc = 1
else:
    props, slots = listing
    want('list', 'prop', props, ('items', 'layout'))

# The revision-3 form contract (spec D2). NOT `fields` + `actions`: `action-pattern.md`'s widget
# grammar is a RULE and its first line rejects the shape a flat field list would produce — "the
# dialog is not a form of labelled rows". The spec's own D8 item 3 still says `fields`; it is stale
# against its own D2, and this suite follows D2.
#
# FOUR NAMED SLOTS SINCE BB-420, where they were four named props. What D2 is about survives the
# change untouched — four NAMED regions cannot express three text lines, two prominent properties or
# a column of labelled rows any more than four named props could — and the change was forced: the
# create-ticket surface is built by real field widgets, a widget renders itself, and rendered content
# cannot go into a prop.
#
# `lead`'s CARDINALITY IS THE ONE THING THAT DID NOT SURVIVE THE TYPE. It was an object rather than
# an array, which is how grammar 3a — at most one emphasised property, "a surface where everything
# is emphasised emphasises nothing" — was carried by the contract. A slot cannot carry it: core's
# slot definition admits only `title`/`description`/`examples` and `ComponentValidator` never looks
# at slot content. It did not become a comment. The caller is a FORM DISPLAY now, not arbitrary
# code, and `PickerSurface::assertGrammar()` throws on a display that gives `picker_region:
# lead` to two fields — `TicketCreateFormTest::testSecondLeadOnTheDisplayIsRefused` pins it, and
# this check asserts the `lead_label` prop that only exists because the row can no longer read its
# own name off a `lead` object.
form = load('form')
if form is None:
    rc = 1
else:
    props, slots = form
    want('form', 'slot', slots, ('lead', 'lines', 'pills', 'actions'))
    want('form', 'prop', props, ('lead_label',))
    reject('form', 'prop', props, ('fields',), "the grammar is lead/lines/pills/actions")
    reject('form', 'prop', props, ('lead', 'lines', 'pills'),
           'a widget renders itself, so a region is a slot')

sys.exit(rc)
PY
}

# "Exactly these three are containers" — asserted as an exclusivity, because three positive contracts
# above would pass on a fourth component that grew a `rows` prop of its own.
#
# Two scopes, deliberately different, because the props are not equally diagnostic:
#   - `cells` is THE container marker. A cell map keyed by a column is what `table` and `list` are
#     for, so no other component anywhere may declare one.
#   - `rows` / `items` / `lines` are asserted over the DISPLAYS groups only (`group:` is the
#     classification, D9). `nav` and `tabs` legitimately declare `items` — navigation items are
#     links, not entries of a listing — and `zone` legitimately declares `columns`; all three survive
#     the ticket (spec › inventory). Asserting these names tree-wide would be permanently RED against
#     the spec's own target state, which is a broken gate rather than a strict one. `form` is in
#     `Form`, an arranging group, so its `lines` is covered by its positive contract above.
b3_nothing_else_is_a_container() {
  python3 - "$COMPONENTS" "$CONTAINER_COMPONENTS" "$DISPLAY_GROUPS" <<'PY'
import os
import sys
import yaml

comps = sys.argv[1]
containers = set(sys.argv[2].split())
display_groups = set(sys.argv[3].split('|'))
rc = 0

for name in sorted(os.listdir(comps)):
    path = f'{comps}/{name}/{name}.component.yml'
    if not os.path.isdir(f'{comps}/{name}') or not os.path.exists(path):
        continue
    meta = yaml.safe_load(open(path)) or {}
    props = (meta.get('props') or {}).get('properties') or {}
    if name not in containers and 'cells' in props:
        print(f'  {name} declares a `cells` prop — only {sorted(containers)} may (D2)')
        rc = 1
    if name in containers or meta.get('group') not in display_groups:
        continue
    for prop in ('rows', 'items', 'lines'):
        if prop in props:
            print(f'  {name} (group: {meta.get("group")}) declares a `{prop}` prop — '
                  f'a display component is not a container (D2)')
            rc = 1

sys.exit(rc)
PY
}

check "B3 table/list/form declare the container contracts D2 gives them" b3_the_container_contracts
check "B3 no other component declares a cells/rows/items/lines prop" b3_nothing_else_is_a_container

# GRAMMAR 3a, ON THE OTHER SIDE OF THE CONTRACT. `form`'s `lead` was an OBJECT prop until BB-420,
# and that is how "at most one emphasised property per surface" was carried by the type: a caller
# could not pass two. A slot cannot carry a cardinality — core's slot definition admits only
# `title`/`description`/`examples`, and `ComponentValidator` does not look at slot content at all.
#
# `PickerSurface::assertGrammar()` closes it for the FORM path: a form display that gives
# `picker_region: lead` to two fields throws, and a kernel test pins that. There is exactly one
# other caller class, and it is this file's own subject — a SCENE, which fills the slot directly and
# which no PHP ever sees. Two `property_pill` nodes in `slots.lead` would render a lead row of two
# prominent pills and nothing anywhere would object. So the rule is asserted here for that half,
# which is what makes "the rule moved rather than became a comment" true of BOTH callers rather than
# of the one that happened to be under test.
b3_no_scene_puts_two_things_in_the_lead() {
  python3 - "$THEME" $SECTION_SCENE_FILES <<'PY'
import sys
import yaml

theme = sys.argv[1]
rc = 0
seen = 0


def walk(node, where):
    global rc, seen
    if isinstance(node, dict):
        if node.get('component') == 'bb_theme:form':
            lead = (node.get('slots') or {}).get('lead')
            entries = lead if isinstance(lead, list) else ([] if lead is None else [lead])
            seen += 1
            if len(entries) > 1:
                print(f'  {where}: a `bb_theme:form` fills `slots.lead` with {len(entries)} nodes '
                      f'— a surface has at most one lead (grammar 3a)')
                rc = 1
        for value in node.values():
            walk(value, where)
    elif isinstance(node, list):
        for value in node:
            walk(value, where)


for rel in sys.argv[2:]:
    doc = yaml.safe_load(open(f'{theme}/{rel}')) or {}
    walk(doc, rel)

# Non-vacuity: this whole check is "no scene does X", so a parser that reached no `form` node at all
# would PASS while asserting nothing — the exact shape the suite's own preflight checks exist for.
if seen == 0:
    print('  no scene addresses `bb_theme:form` at all — the cardinality assertion is vacuous')
    rc = 1
sys.exit(rc)
PY
}

check "B3 no scene puts two things in form's lead slot (grammar 3a)" b3_no_scene_puts_two_things_in_the_lead

# --- B4. Cells are keyed against columns --------------------------------------------------------

# F4, the defect this check exists for: `project-detail-delivery` declares THREE headers and fills
# its body with two `ticket-row` nodes that emit NINE `<td>` each. Invalid table markup on a rendered
# scene, and nothing caught it, because a header list and a row component cannot be compared — there
# is no key. Once cells are keyed, the comparison is a set equality, which is what this asserts.
#
# The mappings are read as TEXT: a `.jsonata` file is not YAML, and shipping a JSONata parser into a
# bash contract to assert "it emits columns and rows" is not a trade worth making.
b4_row_cells_equal_the_column_keys() {
  python3 - "$THEME" $SECTION_SCENE_FILES <<'PY'
import glob
import os
import sys
import yaml

theme = sys.argv[1]
rc = 0


def walk(node, where, seen):
    global rc
    if isinstance(node, dict):
        component = str(node.get('component') or '')
        if component.split(':')[-1] == 'table' and 'component' in node:
            seen.append(where)
            props = node.get('props') or {}
            columns = props.get('columns') or []
            keys = {c.get('key') for c in columns if isinstance(c, dict)}
            if not keys:
                print(f'  {where}: a table node declares no `columns` with keys '
                      f'(it declares: {sorted(props)})')
                rc = 1
            for index, row in enumerate(props.get('rows') or []):
                cells = set((row.get('cells') or {}).keys()) if isinstance(row, dict) else set()
                if cells != keys:
                    print(f'  {where}: row {index} cells {sorted(cells)} '
                          f'!= columns {sorted(k for k in keys if k)}')
                    rc = 1
            for slot in ('body', 'head'):
                if (node.get('slots') or {}).get(slot):
                    print(f'  {where}: a table still fills the `{slot}` slot — '
                          f'a row is data, not markup (D2)')
                    rc = 1
        for value in node.values():
            walk(value, where, seen)
    elif isinstance(node, list):
        for value in node:
            walk(value, where, seen)


seen = []
for rel in sys.argv[2:]:
    doc = yaml.safe_load(open(f'{theme}/{rel}')) or {}
    for scene in doc.get('scenes') or []:
        name = scene.get('name') if isinstance(scene, dict) else None
        walk(scene, f'{rel} [{name}]', seen)

# D1 — four view mappings replace the four `*.teaser` entity mappings, and the delivery table is a
# three-column column set of `view.tickets` rather than a fifth view. So the tables have to come from
# somewhere: an empty glob here means the View address is still unused, which is the disease this
# ticket treats (F9).
mappings = sorted(glob.glob(f'{theme}/designbook/entity-mapping/view.*.jsonata'))
if not mappings:
    print('  designbook/entity-mapping/ declares no view.*.jsonata mapping — '
          'every listing is a View (D1/F9)')
    rc = 1
for path in mappings:
    rel = os.path.relpath(path, theme)
    src = open(path).read()
    # BB-592 moved the four main listings to patterned `list` rows: such a mapping emits `items`
    # keyed by the `pattern` regions instead of a column set. The Project Board mapping emits
    # `columns` of cards. Every other view mapping is a table.
    if ':list"' in src:
        required = ('"items"', '"pattern"')
    elif ':board"' in src:
        required = ('"columns"',)
    else:
        required = ('"columns"', '"rows"')
    for key in required:
        if key not in src:
            print(f'  {rel}: a view mapping must emit {key}')
            rc = 1
    if '"slots"' in src:
        print(f'  {rel}: a view mapping must not fill a table slot (D2)')
        rc = 1

if not seen:
    print('  no table node was found in any scene file — this check inspected nothing')
    rc = 1
sys.exit(rc)
PY
}

check "B4 every table node's row cells are exactly its column keys, and no table fills a body slot" \
  b4_row_cells_equal_the_column_keys

# --- B5. Every listing is a View ----------------------------------------------------------------

# F9/D1 — `scenes/schemas.yml` documents `entity: "view.<id>"` and
# `design/rules/screen-scene-constraints.md` says a listing of several contents IS a View and that
# `records:` is a demo shorthand. This theme used neither: the twelve tables are fed by repeated
# single-entity `teaser` nodes with a `select:` each, which is why every entity type grew its own row
# component. Two hand-rolled entries in one slot are the signature.
b5_every_listing_is_a_view_node() {
  python3 - "$THEME" $SECTION_SCENE_FILES <<'PY'
import sys
import yaml

theme = sys.argv[1]
rc = 0
views = 0


def walk(node, where):
    global rc, views
    if isinstance(node, dict):
        if 'entity' in node:
            if str(node['entity']).startswith('view.'):
                views += 1
            if 'records' in node:
                print(f'  {where}: an entity node uses the `records:` demo shorthand — '
                      f'a real listing is a View (screen-scene-constraints.md)')
                rc = 1
        for slot, value in (node.get('slots') or {}).items():
            items = value if isinstance(value, list) else []
            singles = [
                i for i in items
                if isinstance(i, dict) and 'entity' in i
                and not str(i['entity']).startswith('view.')
            ]
            if len(singles) > 1:
                entities = sorted({str(i['entity']) for i in singles})
                print(f'  {where}: slot `{slot}` lists {len(singles)} single-entity nodes '
                      f'({", ".join(entities)}) — a listing is a View (D1/F9)')
                rc = 1
        for value in node.values():
            walk(value, where)
    elif isinstance(node, list):
        for value in node:
            walk(value, where)


for rel in sys.argv[2:]:
    doc = yaml.safe_load(open(f'{theme}/{rel}')) or {}
    for scene in doc.get('scenes') or []:
        name = scene.get('name') if isinstance(scene, dict) else None
        walk(scene, f'{rel} [{name}]', )

if views == 0:
    print('  no scene addresses a listing as `entity: view.<id>` — the toolchain has the address '
          'and this theme has never used it (F9)')
    rc = 1
sys.exit(rc)
PY
}

check "B5 every listing in a scene file is an entity: view.<id> node" b5_every_listing_is_a_view_node

# --- B6. One identity, no bare dot --------------------------------------------------------------

# D5 — `avatar`'s eleven lines move INTO `person.twig`. Keeping `avatar` as a directory only `person`
# composes would make it a single-caller component, which is what AC-6 forbids, so "avatar is
# person's internal" is read literally: not an address at all. D6 does the same for `status-dot`,
# which declares NO props, has zero scene references and four composers — a dot is a `badge` variant.
b6_avatar_and_status_dot_are_not_addresses() {
  local rc=0 hits
  if [ -d "$COMPONENTS/avatar" ]; then
    printf '  components/avatar/ still exists — it is markup inside person.twig now (D5)\n'
    rc=1
  fi
  if [ -d "$COMPONENTS/status-dot" ]; then
    printf '  components/status-dot/ still exists — a dot is a badge variant (D6)\n'
    rc=1
  fi
  hits="$(live_hits_e "$(components_re 'avatar status-dot')")"
  if [ -n "$hits" ]; then
    printf '  something still composes avatar or status-dot (D5/D6):\n'
    printf '%s\n' "$hits" | sed "s|^$ROOT/|    |"
    rc=1
  fi
  return "$rc"
}

check "B6 avatar and status-dot are markup inside person/badge, not addresses" \
  b6_avatar_and_status_dot_are_not_addresses

# --- B7. The two artifacts for one unit agree ---------------------------------------------------

# AC-1's guard. The ticket teaser is declared six times in two spellings (F2): the entity mapping
# emits `ticket_list_row`, the `sync` generator and all four Drupal-side artifacts emit `ticket-row`.
# The divergence is even documented as deliberate, which is exactly why a gate is needed — the
# statement is "the two artifacts for one unit AGREE", never "the unit names <name>", so it survives
# the next rename instead of pinning today's answer.
b7_mapping_and_sync_name_the_same_component() {
  python3 - "$THEME" <<'PY'
import glob
import os
import re
import sys

theme = sys.argv[1]
rc = 0
# Both address forms. A `sync` generator emits Drupal config (`component_id: 'bb_theme:x'`); an
# entity mapping emits a scene node (`$DESIGNBOOK_COMPONENT_NAMESPACE:x`). Same statement, two
# spellings, and measuring only one is how the divergence stayed invisible.
ADDRESS = re.compile(r'(?:DESIGNBOOK_COMPONENT_NAMESPACE|bb_theme)[:/]([a-z][a-z0-9_-]*)')


def components_of(path):
    return set(ADDRESS.findall(open(path).read()))


pairs = 0
for mapping in sorted(glob.glob(f'{theme}/designbook/entity-mapping/*.jsonata')):
    unit = os.path.basename(mapping)[: -len('.jsonata')]
    if unit.startswith('view.'):
        # A View is not an entity view mode, so it has no `core.entity_view_display` counterpart.
        continue
    syncs = sorted(glob.glob(f'{theme}/designbook/sync/*{unit}.jsonata'))
    if not syncs:
        # NOT A FAILURE, DELIBERATELY. D8 item 7 asks only that the two artifacts AGREE "for any view
        # mode that survives" — where both exist. Asserting that a mapping HAS a generator is a
        # second, stronger statement, and six mappings this ticket never touches do not satisfy it:
        #
        #   bb_team.bb_team.full        bb_workspace.bb_workspace.full
        #   bb_term.label.teaser    og_membership.default.teaser
        #   bb_ticket.bb_ticket.full    user.user.compact
        #
        # A generator-less mapping is a REAL, PRE-EXISTING gap: those view modes render in Storybook
        # but sync to no Drupal display. It belongs to whoever owns them, not to this ticket, and it
        # is written down here — as the legacy allowlist above is — so the narrowing is visible IN
        # the gate rather than hidden by it. Widen this to a failure in the ticket that closes the
        # gap, not before.
        continue
    pairs += 1
    mapped, synced = components_of(mapping), components_of(syncs[0])
    if mapped != synced:
        print(f'  {unit}: the mapping names {sorted(mapped)} but '
              f'{os.path.basename(syncs[0])} names {sorted(synced)} (AC-1)')
        rc = 1

if pairs == 0:
    print('  no mapping/sync pair was found at all — this check compared nothing')
    rc = 1
sys.exit(rc)
PY
}

check "B7 every entity mapping and its sync generator name the same component" \
  b7_mapping_and_sync_name_the_same_component

# --- B8. The classification is `group:`, and the spelling is derived from it ---------------------

# D9 — SDC's own classification field is the classification. A hand-maintained list is a second copy
# that drifts, and it drifted immediately when this ticket's first revision tried one: it put
# `text_line` on the displays side, which `group: Action` contradicts. So there is no list to
# maintain here either — the assertion reads the field.
#
# The seventh value, `Form`, is asserted to be USED and not merely known: a value nobody declares is
# not a classification but a hope, and the target inventory gives all seven at least one member.
b8a_every_component_declares_a_known_group() {
  python3 - "$COMPONENTS" "$ARRANGE_GROUPS" "$DISPLAY_GROUPS" <<'PY'
import os
import sys
import yaml

comps = sys.argv[1]
known = set(sys.argv[2].split('|')) | set(sys.argv[3].split('|'))
rc = 0
used = set()

for name in sorted(os.listdir(comps)):
    if not os.path.isdir(f'{comps}/{name}'):
        continue
    path = f'{comps}/{name}/{name}.component.yml'
    if not os.path.exists(path):
        print(f'  components/{name}/ has no {name}.component.yml, so it declares no group')
        rc = 1
        continue
    group = (yaml.safe_load(open(path)) or {}).get('group')
    if group is None:
        print(f'  {name} declares no `group:` (D9: the field IS the classification)')
        rc = 1
    elif group not in known:
        print(f'  {name} declares `group: {group}`, which is not one of the seven: {sorted(known)}')
        rc = 1
    else:
        used.add(group)

for group in sorted(known - used):
    print(f'  no component declares `group: {group}` — a known value nobody uses is not a '
          f'classification (D9)')
    rc = 1
sys.exit(rc)
PY
}

# D9's derived spelling rule. `layout.md` §8 draws the line at *arranges* versus *displays*, and the
# seven groups fall exactly on it, so the rule is DERIVED from `group:` and from nothing else:
#
#   arranges → snake_case (no hyphen):  Layout, Shell, Navigation, Action, Form
#   displays → kebab-case (no underscore): Data Display, Media
#
# A separator-free single-word name satisfies either, which is not a loophole but the measurement:
# 21 of the 57 names carry no separator at all, and the first revision of the spec mistook those for
# violations (F8's "nineteen display components wearing snake_case" was really eleven).
b8b_the_name_is_spelled_for_its_group() {
  python3 - "$COMPONENTS" "$ARRANGE_GROUPS" "$DISPLAY_GROUPS" "$FORM_COMPONENTS" <<'PY'
import os
import sys
import yaml

comps = sys.argv[1]
arrange = set(sys.argv[2].split('|'))
display = set(sys.argv[3].split('|'))
form_members = set(sys.argv[4].split())
rc = 0
in_form = set()

for name in sorted(os.listdir(comps)):
    path = f'{comps}/{name}/{name}.component.yml'
    if not os.path.isdir(f'{comps}/{name}') or not os.path.exists(path):
        continue
    group = (yaml.safe_load(open(path)) or {}).get('group')
    if group == 'Form':
        in_form.add(name)
    if group in arrange and '-' in name:
        print(f'  {name} is in `{group}`, which arranges, so it takes snake_case (D9)')
        rc = 1
    elif group in display and '_' in name:
        print(f'  {name} is in `{group}`, which displays, so it takes kebab-case (D9)')
        rc = 1

# D9's one membership statement, and the reason it is here rather than in a list of its own: `input`
# and `label` were classified `Action` and `Data Display` respectively — which is how a form label
# ended up a data display — and their bare names are generic to the point of collision. The rename
# and the move are one change, so the gate asserts them as one.
if in_form != form_members:
    print(f'  `Form` holds {sorted(in_form) or "nothing"}; D9 gives it exactly '
          f'{sorted(form_members)}')
    rc = 1
for gone in ('input', 'label'):
    if os.path.isdir(f'{comps}/{gone}'):
        print(f'  components/{gone}/ still exists — it is `form_{gone}` in `Form` now (D9)')
        rc = 1
sys.exit(rc)
PY
}

check "B8a every component.yml declares a group: from the seven known values, and all seven are used" \
  b8a_every_component_declares_a_known_group
check "B8b every directory name is spelled for its group's class, and Form holds exactly its own" \
  b8b_the_name_is_spelled_for_its_group

# --- B9. One prose treatment --------------------------------------------------------------------

# D10 — the typographic treatment of an already-rendered `bb_rich` body exists exactly once in the
# theme today, inlined in `comment_event.twig`, while the ticket detail renders `$t.description` with
# none. So the same field type does not look alike in two places, and nothing said it should.
# `rich-text` owns the treatment and is the only template allowed to carry these selectors.
b9_only_rich_text_carries_the_prose_treatment() {
  local rc=0 twig hits
  for twig in "$COMPONENTS"/*/*.twig; do
    [ -f "$twig" ] || continue
    case "$twig" in */rich-text/rich-text.twig) continue ;; esac
    hits="$(strip_comments "$twig" twig | grep -nE "$PROSE_SELECTOR_RE" || true)"
    if [ -n "$hits" ]; then
      printf '  %s carries a prose treatment — rich-text owns it (D10):\n' "${twig#"$COMPONENTS"/}"
      printf '%s\n' "$hits" | sed 's|^|    |'
      rc=1
    fi
  done
  # The mirror, for the same reason as B1's: a `rich-text` that carried no treatment would satisfy
  # the sweep above by being empty.
  if [ -z "$(strip_comments "$COMPONENTS/rich-text/rich-text.twig" twig 2>/dev/null |
    grep -nE "$PROSE_SELECTOR_RE" || true)" ]; then
    printf '  rich-text.twig does not carry the prose treatment (D10)\n'
    rc=1
  fi
  return "$rc"
}

check "B9 the prose selectors appear in rich-text.twig and in no other template" \
  b9_only_rich_text_carries_the_prose_treatment

# --- B10. No component knows a bakers.build concept -----------------------------------------------------
#
# D11 — entity knowledge lives in the mapping. The View knows the entity; the `table` does not. And
# `ticket_list_row` existed BECAUSE that knowledge had leaked into a component, so this is the same
# defect in a smaller form.
#
# THE VOCABULARY IS READ OUT OF `data-model.yml`, never hardcoded, so the check follows the data
# model instead of ageing beside it. THE FILTERING RULE, stated here so a reader can audit it rather
# than reverse-engineer it from failures:
#
#   1. The vocabulary is every ENTITY-TYPE and BUNDLE machine name in the model, plus each one's
#      `bb_`-stripped short form — `bb_ticket` and `ticket`, `bb_comment` and `comment`, and so
#      on. Those are the nouns of the domain.
#   2. FIELD names and STATE values are NOT in it, and that is a measurement rather than laziness.
#      The model's field names include `title`, `label`, `state`, `type`, `name`, `body`, `key`,
#      `initials`, `display_name`, `state_flow` — the vocabulary of any display component, and of the
#      spec's OWN target contracts: D2 gives a person cell `display_name` and `initials`, D11 keeps
#      `state-flow` by name. The state values are worse: `summary` is a `bb_ticket` state and
#      `summary-band` is a name D11 CHOOSES, while `running`/`done`/`idle` are the tone and accent
#      values D2's cells carry. Including either would make this check permanently red against the
#      target state, which is a broken gate and not a strict one.
#      A bundle that shares its machine name with a workflow state — the `review` comment bundle and
#      the `review` ticket state — is therefore dropped too: `state-flow` colours the STATE.
#   3. `user` and `default` are dropped: they are Drupal/OG core nouns (`user.user`,
#      `og_membership.default`), not bakers.build concepts, and every application has a user menu.
#   4. Nouns shorter than four characters are dropped — `run` is an English verb and would match
#      prose everywhere. `run_row` is caught by B1 and B2 regardless.
#   5. A NAME or PROP matches when its FIRST `-`/`_` segment is one of the nouns: the entity is the
#      subject and what follows is the treatment (`ticket_env`, `comment_event`). A trailing
#      occurrence is the generic English word — `link-group` is a group of LINKS, not a `bb_group`,
#      and the spec keeps it.
#   6. In TEMPLATE text the noun `group` is additionally dropped: Tailwind's `group` utility class is
#      a bare `group` token in every hover-scoped template.
#   7. The check is scoped to the DISPLAYS groups (`Data Display`, `Media`), derived from `group:`
#      exactly as B8b is. This is D11's own scope — it reaches "the six components of `Data Display`
#      that name a bakers.build concept", and its conclusion is that "the whole of `Data Display` is honestly
#      generic". The arranging groups are chrome, and their nouns are affordances the spec keeps by
#      name: `sidebar` declares a `workspace` slot and `account_switcher` IS the workspace switcher
#      filling it (BB-503 retired the `workspace_switcher` component, not the affordance).
#   8. The bundles of `bb_term` are dropped: `type`, `recipe` and `label` name vocabularies a user
#      fills, and `label`/`type` are the props of any display component. `term` itself stays.
#
# Surfaces: the directory name, prop and slot names, the declared `title:` of a prop or slot (that is
# the CONTRACT, and it is where `board-card` says "Ticket identifier" four times), and the template
# with comments stripped. Free `description:` prose is NOT scanned: a usage note legitimately names
# where a component is used, and scanning it flags `person`, `badge`, `link_group` and `active_filters`
# for sentences that are true.
b10_no_component_names_a_bb_concept() {
  python3 - "$COMPONENTS" "$DATA_MODEL" "$DISPLAY_GROUPS" <<'PY'
import os
import re
import sys
import yaml

comps, data_model = sys.argv[1], sys.argv[2]
display_groups = set(sys.argv[3].split('|'))
rc = 0

model = yaml.safe_load(open(data_model)) or {}
nouns = set()
for entity_type, bundles in (model.get('content') or {}).items():
    for bundle in bundles:
        # Rule 8: term bundles (`type`, `recipe`, `label`) are vocabulary values, not concepts.
        for machine in (entity_type,) if entity_type == 'bb_term' else (entity_type, bundle):
            nouns.add(machine)
            if machine.startswith('bb_'):
                nouns.add(machine[len('bb_'):])


def state_values(node):
    # Rule 2: the allowed values of a `state`/`states`/`*_state` field are workflow states.
    found = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, dict) and (key in ('state', 'states') or key.endswith('_state')):
                found.update(str(v) for v in ((value.get('settings') or {}).get('allowed_values') or []))
            found |= state_values(value)
    elif isinstance(node, list):
        for item in node:
            found |= state_values(item)
    return found


CORE_NOUNS = {'user', 'default'}          # rule 3
TAILWIND_UTILITIES = {'group'}            # rule 6
vocabulary = {n for n in nouns - CORE_NOUNS - state_values(model) if len(n) > 3}   # rules 2 and 4


def word_re(words):
    # `-` counts as a word character so a Tailwind utility (`group-hover:`, `environment-tone`) is
    # not read as the bare noun.
    return re.compile(
        r'(?i)(?<![A-Za-z0-9_-])(%s)(?![A-Za-z0-9_-])' % '|'.join(sorted(words, key=len, reverse=True))
    )


IN_TEXT = word_re(vocabulary)
IN_TEMPLATE = word_re(vocabulary - TAILWIND_UTILITIES)


def leading_noun(identifier):
    return re.split(r'[-_]', identifier)[0].lower() in vocabulary


for name in sorted(os.listdir(comps)):
    path = f'{comps}/{name}/{name}.component.yml'
    if not os.path.isdir(f'{comps}/{name}') or not os.path.exists(path):
        continue
    meta = yaml.safe_load(open(path)) or {}
    if meta.get('group') not in display_groups:
        continue
    hits = []
    if leading_noun(name):
        hits.append('its directory name')
    for kind, block in (
        ('prop', (meta.get('props') or {}).get('properties') or {}),
        ('slot', meta.get('slots') or {}),
    ):
        for key, declared in block.items():
            if leading_noun(key):
                hits.append(f'{kind} `{key}`')
            title = declared.get('title') if isinstance(declared, dict) else None
            if isinstance(title, str):
                for match in IN_TEXT.finditer(title):
                    hits.append(f'the title of {kind} `{key}` ("{title}" → {match.group(1)})')
    template = f'{comps}/{name}/{name}.twig'
    if os.path.exists(template):
        source = re.sub(r'\{#.*?#\}', ' ', open(template).read(), flags=re.S)
        for lineno, line in enumerate(source.splitlines(), start=1):
            for match in IN_TEMPLATE.finditer(line):
                hits.append(f'{name}.twig:{lineno} ({match.group(1)})')
    if hits:
        print(f'  {name} ({meta.get("group")}) knows a bakers.build concept (D11): {"; ".join(hits[:6])}'
              + (f' … and {len(hits) - 6} more' if len(hits) > 6 else ''))
        rc = 1

sys.exit(rc)
PY
}

check "B10 no display component's name, prop or template names a bakers.build entity or bundle" \
  b10_no_component_names_a_bb_concept

# --- Verdict -------------------------------------------------------------------------------------

if [ "$failures" -ne 0 ]; then
  printf '\n%s check(s) failed.\n' "$failures"
  exit 1
fi

printf '\nAll checks passed.\n'
