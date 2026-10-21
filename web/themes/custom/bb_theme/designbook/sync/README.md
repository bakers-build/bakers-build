# designbook `sync-to` generators — Drupal config from the data model

These `<config_name>.jsonata` files are the per-config generators the designbook
**`sync-to`** workflow (sync concern, `engine: direct`) runs to author Drupal
config YAML from `../data-model.yml`. Each is executed over one resolve-filter
`unit` and its output is written to `config/sync/<config_name>.yml`, then
applied with `config:import --partial`.

## What is shipped here

**Eight objects ship today** — two Island Profiles and the six BB-414 added.
The other nine generators ship nothing; see *Most generators here ship nothing*
below, which is still the normal state rather than an oversight.

- `island.profile.bb_shell.jsonata` and `island.profile.bb_gate.jsonata` —
  standalone profiles owned by the `bakers` app (BB-423). They retain the global
  shell/gate scene composition and migrated placement IDs. The generated
  dependencies are the current entity saved form; both install copies match.
  The retired page-layout generators have been removed.
- The **ticket detail's body and the two view modes it renders into**
  (BB-414 D4), all six shipped on both install paths and named under
  `config: import:` › `bb_core:` in `recipes/bakers/recipe.yml`. Each mode
  precedes its display, because a display whose view-mode definition is absent
  cannot be imported at all:
  - `core.entity_view_mode.bb_ticket.full.jsonata`
  - `core.entity_view_display.bb_ticket.bb_ticket.full.jsonata` — the body's
    three zones: About, Run history, and the handoff stream last and collapsed.
  - `core.entity_view_mode.bb_run.teaser.jsonata`
  - `core.entity_view_display.bb_run.bb_run.teaser.jsonata` — the run ROW.
  - `core.entity_view_mode.bb_comment.full.jsonata`
  - `core.entity_view_display.bb_comment.bb_comment.full.jsonata`
- The **group detail's Overview body** (BB-587):
  `core.entity_view_mode.bb_group.full.jsonata` and
  `core.entity_view_display.bb_group.bb_group.full.jsonata` — two zones,
  Owner and Workspace, each a label. The mode is named under `config: import:`;
  the display ships in `recipes/bakers/config/` as its saved form. No `sync-to`
  run produced them: this site has no `designbook:config-schema` command, so
  the generators were evaluated with `jsonata` and the saved form exported by
  the procedure below.

**THE SHIPPED FILE IS THE SAVED FORM, NOT THE GENERATOR'S OUTPUT, and for the
three displays that difference is load-bearing rather than cosmetic.**
`EntityDisplayBase::preSave()` → `init()` materialises a `content` and a
`hidden` map from the entity's field definitions on the **first** save, so a
file stating
`content: {}` / `hidden: {}` never equals active config — `drush cim` would
re-save on every deploy and manufacture exactly the second save the recipe's
strict list rejects (BB-414 R2). The maps are inert at render time:
`EntityViewDisplayTrait::buildMultiple()` clears the parent build and renders
only the display_builder sources, so shipping them costs the screen nothing.
`dependencies` is *not* touched by that save and is the authored form key for
key. The step that turns an emitted file into a shipped one is therefore:

```bash
ddev drush config:get <name> --format=yaml > config/sync/<name>.yml
grep -v '^uuid:' config/sync/<name>.yml \
  > recipes/bakers/config/<name>.yml
```

The standing cost of that, named so it is not rediscovered as drift: `content`
and `hidden` enumerate the entity's base fields, so adding one to `bb_ticket`,
`bb_run` or `bb_comment` changes the saved form and re-breaks the second
`ddev init`. Same symptom and same fix as the contrib-schema trap WORKFLOW.md
records — re-export the saved form into both copies.

## Historical page-layout generation (retired by BB-423)

The following records describe earlier runs. Current shell/gate regeneration
uses `island.profile.*` and never recreates the retired page-layout config.
The BB-423 sync used live Island typed schema, with both profiles reported
as uncovered blueprint units (stage 4), then a partial import of only the two
profiles. Existing DisplayBuilder entity-view generators remain applicable.

### Earlier page-layout design

Everything else in this directory is `core.entity_view_mode.*` or
`core.entity_view_display.*`: view-mode names and entity displays. That is the
whole reason `display_builder_page_layout.page_layout.bb_shell.jsonata`
exists. BB-396's AC 6 asks that `sync-to` emit **island** configuration and
that the reference surface run on the emitted object, and a
`display_builder_page_layout.page_layout` entity is neither block nor display
configuration — it is the shell, and both island boundaries (`island-rail`
around `sidebar`, `island-content` around `content`) are `source_id: island`
entries inside it.

Two properties of that generator are load-bearing and are written up in its
own header rather than here: the `enforced.config` dependency on
`display_builder.profile.default`, without which `RecipeConfigInstaller`
creates the layout before the profile and `PageLayout::postSave()` fatals
inside contrib; and the fact that the emitted `dependencies` are the
**first-save** form, because a second save adds keys the recipe's strict list
rejects.

**Every unit of that run was a blueprint-precedence stage-4 hit**, reported
in the run's `uncovered_units` rather than swallowed: `designbook-drupal`
ships no blueprint with a `trigger.config_name` glob, none for
`display_builder_page_layout`, and none for bakers.build's custom entity types — its
entity-type blueprints are `node`, `media`, `taxonomy_term`, `block_content`
and `canvas_page`. The `canvas` data-mapping blueprint does describe a
`page_layout` config unit, but it gates on `build_form: canvas` and this
page's `build_form` is `field-map`. So all three generators that run emitted —
the page layout and the two `bb_team` ones since removed — were authored from
`prepared` (the live typed-config JSON Schema) plus the scene and the data
model. That is a gap in the backend integration, not in this project.

**There is no `block.block.*` generator, and that is measured.** D10 names
"the rail block's placement" beside the page layout, but that clause survives
from revision 1's D5, which made the rail a placed, islandified, boosted menu
block. Spec F32/F33 measured that a page layout produces no placement and
that the page-layout variant renders no region; plan T1 seam 1 counted
`block.block.*` as 0 before and 0 after saving a page layout. Revision 2's D5
redecided the rail as the island source inside the layout, so there is
nothing left for a placement generator to emit.

**Removed (BB-396), measured rather than forgotten:**
`core.entity_view_mode.bb_team.full.jsonata` and
`core.entity_view_display.bb_team.bb_team.full.jsonata` were authored by the
`sync-to` run below and are **deleted again**. They are not a gap left open by
accident; they were withdrawn by human decision after two measurements, and
**BB-357 owns whatever replaces them**.

1. **The display's output is unshippable in any form.** Its calculated
   `dependencies.module` is a function of install order: `og_group` is the only
   field on `bb_team` with `isDisplayConfigurable('view')` TRUE — every other
   `BbTeam` base field configures only the `'form'` side — so
   `calculateDependencies()` adds the `og_group_subscribe` formatter's provider
   `og`, but only where bb_team is *already* an OG group.
   `recipes/bakers/recipe.yml` registers that with an `og.settings` **action**,
   and a recipe applies `config:` before `actions:`. The recipe path therefore
   saves `module: ["bb_core"]` and the CIM path `["bb_core", "og"]`;
   whichever form the file states, the other world mismatches and aborts the
   *whole* recipe. Reproduced as `ddev init --provider recipe-test` exit
   status 4 and a strict-list scan of `bakers 50 strict entries, 1 MISMATCH` on
   exactly that key.
2. **The generator cannot agree with its mapping.** The entity mapping
   `bb_team.bb_team.full` names `zone`, `option_list` and `option_picker`
   — a *design* surface. A Drupal view display can express none of it, for the
   same reason as above: `og_group` is the only view-configurable field there
   is. The contract `tests/contract/data-display-components.sh` check
   B7 asserts that a mapping and its generator name the same component, so a
   generator that cannot carry the mapping's components is a **failing**
   artifact, whereas a mapping with *no* generator is explicitly allowed —
   B7's own comment lists `bb_team.bb_team.full` by name among six
   deliberately generator-less mappings and calls that a real, pre-existing
   gap belonging to whoever owns them. Emitting half of it broke the gate;
   removing it restores B7 to green without weakening the gate by a line.

Nothing renders either object, so the removal costs the product nothing:
`BbTeamRouteProvider::getCanonicalRoute()` **unsets** `_entity_view` and
points `/{ws}/team/{id}` at `BbTeamTabController::load`, and the three
secondary tabs are `_controller` routes. Spec F21 ("no `designbook/sync/`
generator for either")
therefore stands as written, and AC 6's emission claim is carried by the page
layout above, which the reference surface does run on. The view **mode** went
with the display for the reason BB-378 gives below in reverse: shipping the
name of a display that does not exist is worse than shipping neither.

**Retired (BB-378) — SUPERSEDED by BB-414. Read both halves.**

BB-378 deleted `core.entity_view_display.bb_ticket.bb_ticket.full.jsonata`
and the two shipped copies of the config it produced. That generator bound the
props of a single `ticket_detail` SDC component (and its `comments` slot) to
bb_ticket field sources, and it went because that component is not reachable
from any Designbook scene and was deleted with its Drupal wiring. The **view
mode** stayed, on the rule that a mode is a name and not a layout.

**BB-414 re-created the generator, and the retirement does not argue against
it — it argues against the thing that was retired.** The deletion was about a
whole-screen component nothing rendered, not about the ticket having a `full`
display at all. What is here now emits three GENERIC containers, in the shape
BB-378 itself decided: the scene owns the `canvas`, and the view mode emits
only the body. The component set is `{zone, rich-text, collapsible}` — exactly
what `entity-mapping/bb_ticket.bb_ticket.full.jsonata` names, which is a
checked statement rather than a coincidence: adding the generator turned that
mapping from B7's generator-less list into a live comparison
(`tests/contract/data-display-components.sh`, BB-414 F11/R5).

**If you are here because you are deleting a display again, the test the two
decisions share is this:** delete the generator when nothing renders its output,
and keep it when a route does. `/{workspace}/ticket/{id}` renders this one —
`BbTicketDetailController` puts the ticket's `full` view mode in the canvas's
`main` region. That is the difference from the `bb_team` pair below, which
nothing renders and which stays deleted.

bb_ticket is a code-defined base-field entity (no `*.type.*` / `field.*`
config), so the sync filter emits **only** view units — no bundle or field
config.

## Re-running the sync (bb-8a9979fd)

- **debo sub-command:** `/debo sync-to`
- **designbook commit:** `64d954b sync-to (#114)` — the run for bb-8a9979fd
  used the designbook checkout at `7941073a` (post-#114). The installed
  marketplace plugin/CLI must be at that commit or newer; a
  `storybook-addon-designbook` older than the sync-to engine (≤ 0.6.0) rejects
  the transform stage's `prepare`/`generator` result-schema keywords.
- **helper module:** `web/modules/custom/designbook_config_schema` provides the
  `designbook:config-schema` / `designbook:config-validate` drush commands
  `sync-to` calls. It is **dev-only** — enabled locally for the sync run, kept
  out of `config/sync/core.extension.yml`, and `drupal/config_inspector` is a
  `require-dev` dependency, so the server (CIM, `composer install --no-dev`)
  never installs or enables either.
- **backend_cmd:** configured in `../../designbook.config.yml` (`exists_cmd`,
  `schema_cmd`, `validate_cmd`, `import`) with bakers paths (`config/sync`;
  container source `/var/www/html/config/sync`).

Steps:

```bash
cd web/themes/custom/bb_theme
# 1. enable the dev tooling locally (core `config` is needed for --partial)
ddev drush en config config_inspector designbook_config_schema -y
# 2. run the workflow — sync-to loads ../data-model.yml, resolves the filtered
#    units, drops any that already exist, authors + imports the rest.
# filter to bb_ticket/bb_ticket; emit only the full view units:
/debo sync-to
```

`sync-to` is **idempotent**: its resolve-filter existence check
(`ddev drush config:get <name>`) drops units that already exist, so a re-run
against a site that already has the `full` mode + display yields an empty unit
list and writes nothing.

## Re-running the sync (BB-396, run `sync-to-2026-08-31-117c`)

The run that emitted the page layout above, plus the two `bb_team` generators
that were removed again (see *Removed (BB-396)*). Two things about it are
worth copying and one is worth avoiding.

```bash
cd web/themes/custom/bb_theme
ddev drush en config config_inspector designbook_config_schema -y
# config_sync_dir MUST be passed: the code resolver derives it from the
# designbook home and produced …/bb_theme/web/sites/default/files/sync, which
# does not exist. bakers's real one is <repo>/config/sync.
npx storybook-addon-designbook workflow create --workflow sync-to --params '{
  "scene": "team", "section": "settings",
  "filter": {"bb_team": ["bb_team"]},
  "config_sync_dir": "<repo>/config/sync"
}'
```

- **Scope the `filter`.** An empty `filter` means "export every entity type and
  bundle in the data model", which for this model expands to view-mode and
  display units for all twelve types. Naming `bb_team` is what narrowed the
  unit list to three. Only one of the three survives in this directory; the
  filter is recorded as run, not as it would be run today.
- **The existence filter has to be able to see the unit.**
  `resolve-filter` drops every unit whose config already exists, so
  re-emitting an object that is already live requires deleting it from active
  config first (`ddev drush config:delete <name> -y`). Without that the run
  comes back with an empty unit list and writes nothing — the correct
  idempotent behaviour, and useless when the point is that the shipped file
  *is* the emission.
- **`backend_cmd.import` does not work on a recipe-provisioned site.** It
  runs `--source=/var/www/html/config/sync`, and `config/sync/system.site.yml`
  carries a different site UUID than a `ddev init --provider recipe-test`
  install, so the whole-directory import fails validation ("Site UUID in
  source storage does not match the target storage"), together with
  pre-existing-entity errors for og_membership and the two bakers.build vocabularies.
  `--partial` seeds from **active** storage, so pointing `--source` at a
  directory holding only the run's own emitted files makes `system.site` come
  from active and the import succeed. Same command, narrower source.

## Re-running the sync (BB-414, run `sync-to-2026-09-01-6202`)

The run that emitted the six ticket-detail objects. Config-kind (no `scene`), so
it took the `resolve-filter` → `transform` → `sync` path over the data-model
filter and never entered the scene branch.

```bash
cd web/themes/custom/bb_theme
ddev drush en config config_inspector designbook_config_schema -y
npx storybook-addon-designbook workflow create --workflow sync-to --params '{
  "filter": {
    "bb_ticket": ["bb_ticket"],
    "bb_run": ["bb_run"],
    "bb_comment": ["bb_comment"],
    "view_modes": {
      "bb_ticket": ["full"],
      "bb_run": ["teaser"],
      "bb_comment": ["full"]
    }
  },
  "config_sync_dir": "<repo>/config/sync"
}'
```

Units, in the order `resolve-filter` emitted them — definition before display,
because a display whose view-mode definition is absent cannot be imported:

1. `core.entity_view_mode.bb_ticket.full`
2. `core.entity_view_display.bb_ticket.bb_ticket.full`
3. `core.entity_view_mode.bb_run.teaser`
4. `core.entity_view_display.bb_run.bb_run.teaser`
5. `core.entity_view_mode.bb_comment.full`
6. `core.entity_view_display.bb_comment.bb_comment.full`

Four things about this invocation are worth copying.

- **`config_sync_dir` is passed explicitly**, for the reason the BB-396 run
  below records: the code resolver derives it from the designbook home and
  produces `…/bb_theme/web/sites/default/files/sync`, which does not exist.
- **The `filter` carries a `view_modes` key, and that is an addition to the
  documented `{entity_type: [bundles]}` shape.** Without it the three bundles
  expand to TEN units, not six — `resolve-filter` emits one definition and one
  display per view mode the data model declares, so `bb_ticket.teaser` and
  `bb_run.full` come along. Neither belongs to BB-414 and one of them is
  actively wrong: the ticket teaser's design subject is the row component
  BB-389 deleted, so authoring a display for it would be shipping the name of
  a display nothing renders — the mistake the `bb_team` removal above records.
  Narrowing at the filter is what keeps the run's output equal to what ships,
  and it is stated here because the workflow does not document the key.
- **The existence filter kept all six.** `resolve-filter` runs
  `ddev drush config:get <name>` per candidate and drops it on exit 0; all six
  exited 1 on a `ddev init --provider recipe-test` world. `full` and `teaser`
  are stock mode NAMES but neither is REGISTERED for a code-defined custom
  entity type, so all three definition units are genuinely new. Re-emitting an
  object that is already live needs `ddev drush config:delete <name> -y` first —
  an empty unit list is the correct idempotent behaviour and completely useless
  when the emission is the point.
- **`backend_cmd.import` was narrowed to the run's own emitted files**, exactly
  as the BB-396 section below prescribes:
  `ddev drush config:import --partial -y --source=<a dir holding only the six>`.
  The whole-directory form fails on a recipe-provisioned site with "Site UUID in
  source storage does not match the target storage"; `--partial` seeds from
  ACTIVE storage, so a narrow source makes `system.site` come from active and
  the import succeed. Same command, narrower source. Result: six `Create`
  operations, exit 0.

**Every unit was a blueprint-precedence stage-4 hit again**, reported in
`uncovered_units` rather than swallowed — the same gap the BB-396 run found
and for the same reason: `designbook-drupal` ships no blueprint with a
`trigger.config_name` glob and its entity-type blueprints are `node`, `media`,
`taxonomy_term`, `block_content` and `canvas_page`, none of which is a bakers.build
custom entity type. All six were authored from `prepared` (the live typed-config
JSON Schema) plus the entity mappings and the data model.

**What the run could not express, stated rather than faked.** One of the three
displays binds less than its mapping composes, and its generator says so in its
own header:

- `bb_ticket.bb_ticket.full` feeds the prose component's `body` from
  `field_property:bb_ticket:description:processed` and NOT from the
  `field_formatter:` source the spec's D3 names. Measured: the field-formatter
  source declares `prop_types: ["slot"]` and that `body` is a PROP, so
  ui_patterns would never have offered the one to the other and display_builder
  drops an unresolvable prop WITHOUT erroring — the zone would have rendered an
  empty body silently. `processed` is the same intent in the shape the prop
  takes (`prop_types: ["string", "enum"]`), and "already rendered by the text
  format" is that prop's stated contract. The two zones whose content is a SLOT
  keep D3's field-formatter sources unchanged. A slot cannot take `textfield`
  either (`["string", "identifier"]`), so the three headings are `token` sources
  (`["slot", "string", "url"]`) carrying a literal with no placeholder in it.

## Re-running the sync (BB-414, run `sync-to-2026-09-01-5419`) — the run row

**The run row's cells were the second thing that run could not express, and this
run expressed them.** The entry removed from the list above used to read: the
container owns its items, `items` is an array of keyed cell maps, prop bindings
are `{source_id, source}` pairs resolving to one field's value, and no source on
a provisioned site produces an array of cell maps — so bind nothing. Every
measurement in it was correct and the conclusion was not, and the difference is
worth keeping because it is the general shape of this trap.

**What the earlier run measured, and what it missed.** `items` is `type: array`
of objects, ui_patterns' compatibility checker does not descend into an array
item's object `properties`, so `guessFromSchema()` returns the **`unknown`**
PropType — and `SourcePluginManager::filterDefinitionsByPropType()` offers a
source only when the source's `prop_types` contains it. Zero of the 819 source
definitions declare `unknown`. That is what "no source produces an array of cell
maps" actually was: not a data-shape limit, a **registry** limit. And a registry
of plugins is something a project extends. The consequence of not extending it
was not a degraded row — `list.twig` opens `{% if items is not empty %}`, so the
zone rendered a heading over nothing and one run in `teaser` came out at **91
bytes**, all of it SDC comment.

`bb_core`'s **`BbRunRowSource`** (plugin id `bb_run_row`) is the missing
source: `prop_types: ['unknown']`, a required `entity:bb_run` context, and one
`list` item built cell for cell from
`entity-mapping/bb_run.bb_run.teaser.jsonata` — glyph map, tones, the
narrower item accent, the minute-precision start, the conditional `took` pair.
The generator now binds `items: {source_id: bb_run_row, source: {}}`, and the
same run in `teaser` renders **2913 bytes** with its state badge, its
from-state, its conductor and its start. `dependencies.module` is unchanged,
because `bb_core` was already on it.

**The rule this leaves behind.** A prop that no source can reach is a prop whose
PropType nothing declares — check the *guess* before concluding the *shape* is
inexpressible. `TicketDetailScreenTest::testTheItemsPropStillGuessesTheUnknownPropType`
pins that guess, because the day a ui_patterns release starts guessing a real
PropType for an array of objects, `SourcePluginBase::getValue()` looks for a
conversion path from `unknown`, finds none, and the zone goes empty again with
no error at all.

The run itself was the ordinary config path — filter
`{"bb_run": ["bb_run"], "view_modes": {"bb_run": ["teaser"]}}`, the
existence filter kept the display and dropped the mode (the mode already
existed; `ddev drush config:delete` on the display first, per the note below),
one unit, one `uncovered_unit` — the same blueprint-precedence stage-4 hit
every unit in this directory reports, and for the same reason.

## Two-path shipping

A generator's output is not shipped by being written. `config/sync` is only
the CIM half, and a config name outside a module's own `<module>.` prefix is
never created by enabling that module, so the recipe half takes a
`config: import:` entry as well (WORKFLOW.md › *Binding shortcuts*). Shipped
output therefore lives in two places, byte-identical minus the runtime `uuid`
that only the `config/sync` copy carries:

- `config/sync/**` — server CIM (`drush cim` on deploy).
- `recipes/bakers/config/**` — recipe install. The recipe's own `config/` is on
  the same STRICT list a `config: import:` name joins, so a file here needs no
  import entry and must be the saved form key for key.

  It is NOT `web/modules/custom/bb_core/config/optional/**`, and that changed
  in BB-415 rather than always having been so. A page layout is
  display_builder-owned config, `bb_core` does not depend on display_builder,
  and a module may not ship config whose schema comes from a non-dependency —
  it fails on both install paths, with a `SchemaIncompleteException` on the
  plain module-install path every Kernel test takes. The shell layout sat in
  that directory as a standing exception WORKFLOW.md recorded as "to fix, not to
  copy"; BB-415 shipped a second layout and moved the first one here rather
  than encoding the exception as the pattern.

**Most generators here ship nothing, and that is the normal state rather than
an oversight.** Only the two page layouts —
`display_builder_page_layout.page_layout.bb_shell` and, since BB-415,
`…bb_gate` — have shipped output today. The nine `bb_*` view-mode and
display generators lost theirs when BB-389 retired `bb_dashboard` and
BB-396 deleted it — the
paths this section used to name, under that module and
`recipes/bb_seed/recipe.yml`, no longer exist. A generator is a record of how
an object is authored; shipping it is a separate decision with a separate cost.
The two `bb_team` generators are the case where that decision came back
negative on *both* halves and the generator itself was withdrawn — see
*Removed (BB-396)* above.
