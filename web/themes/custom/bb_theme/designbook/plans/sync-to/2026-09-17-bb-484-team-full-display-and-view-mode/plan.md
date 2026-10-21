# Plan: sync-to
<!-- digest: 2f034f96a8f4dc13b5aa6818559114cc5a5d88680d10e543504cc6d652719df5 -->

## Schemas
```yaml
definitions:
  ConfigNameUnit:
    type: object
    title: Config Name Unit
    description: |
      One Drupal configuration object name together with the data-model context needed to author its generator JSONata. Emitted by resolve-filter (one unit per Drupal config file a slice yields) and consumed by transform (one result per unit).
    required:
      - config_name
    additionalProperties: false
    properties:
      config_name:
        type: string
        description: |
          Drupal configuration object name matching the config/sync filename without the .yml extension. Dot-separated lowercase segments (e.g. node.type.article, field.storage.node.field_body, field.field.node.article.field_body, core.entity_view_display.node.article.teaser).
        pattern: ^[a-z0-9_]+(\.[a-z0-9_]+)+$
      entity_type:
        type: string
        description: |
          Drupal entity type machine name. Present for content-derived units (e.g. "node", "media", "taxonomy_term", "block_content").
        examples:
          - node
          - media
          - taxonomy_term
          - block_content
      bundle:
        type: string
        description: |
          Bundle machine name within the entity type. Present for content-derived units (e.g. "article", "image", "tag").
        examples:
          - article
          - page
          - image
          - tag
      field_name:
        type: string
        description: |
          Field machine name. Present for field.storage.* and field.field.* units. Absent for bundle-type and view-display units.
        examples:
          - field_body
          - field_subtitle
          - field_image
      config_key:
        type: string
        description: |
          Original dot-separated config key from data_model.config. Present for config-slice-derived units (e.g. "views.listing", "image_style.hero").
        pattern: ^[a-z0-9_]+(\.[a-z0-9_]+)*$
      def:
        type: object
        description: |
          The relevant definition object from the data model — bundle def (fields, view_modes, purpose, etc.) for content-derived units, or config def for config-slice units. Used by the generator to author the JSONata transform.
      build_form:
        type: string
        description: |
          Page build form for a Scene-derived config unit — the presentation surface the page's config is authored against. Taken (not guessed) from the full view-mode `template` of the page bundle in the data model, on the same backend-neutral `template` axis as view- and form-mode templates: a free string whose allowed values come from `entity_mapping.templates` in `designbook.config.yml`, with the concrete technology behind each value set by the config default / active `backend` — not enum-fixed here. The `template → build_form → config` mapping (the *how* of each form) lives in the backend integration's data-mapping blueprints. Absent on config/data-model-derived units.
  SyncResult:
    type: object
    title: Sync Result
    description: |
      Outcome of applying config to the live Drupal site via drush config:import. Captures the drush command summary text and the list of config names applied.
    required:
      - drush_summary
      - applied_config_names
      - cim_ok
    properties:
      drush_summary:
        type: string
        description: |
          Full stdout/stderr output from the drush config:import invocation, captured verbatim. Used for reporting and error surfacing.
      applied_config_names:
        type: array
        description: |
          List of Drupal config names that drush reported as imported/applied during this run. Derived from the drush output.
        items:
          type: string
          description: Drupal config name, e.g. "node.type.article".
          pattern: ^[a-z0-9_]+(\.[a-z0-9_]+)+$
      cim_ok:
        type: boolean
        const: true
        description: True when the drush config:import (--partial) invocation exited 0.
  ExportSummary:
    type: object
    title: Export Summary
    description: |
      Summary of the Drupal config files written in one export run. Produced by the outtake stage from the transform stage results.
    required:
      - config_names
      - count
    properties:
      config_names:
        type: array
        description: Sorted list of Drupal config names (without .yml extension) written in this run.
        items:
          type: string
          description: Drupal config name, e.g. "node.type.article".
          pattern: ^[a-z0-9_]+(\.[a-z0-9_]+)+$
      count:
        type: integer
        description: Total number of config YAML files written.
      presenter_templates:
        type: array
        description: |
          Paths of the presenter-template files this run wrote — one per surface (`template: presenter`) whose presentation the display config cannot express. Empty when every surface was declaratively bindable (`template: field-map`). Makes the contract widening (config, plus a presenter-template) visible in the run summary. The concrete markup form (e.g. Twig) and theme path are a Drupal concern — the paths here are opaque.
        items:
          type: string
          description: Path of one written presenter-template (theme-relative on a Drupal backend), e.g. "templates/views/views-view.html.twig".
      uncovered_units:
        type: array
        description: |
          Config names that reached blueprint-precedence stage 4 (authored from `prepared` alone, with no matching blueprint). Empty in the normal case — every unit kind occurring today has a covering blueprint. A non-empty list is the reported, visible signal that a new unit kind needs a blueprint; it never fails the run silently.
        items:
          type: string
          description: Drupal config name that hit stage 4, e.g. "some.new.config_type".
          pattern: ^[a-z0-9_]+(\.[a-z0-9_]+)+$
      page_url:
        type: string
        description: |
          Reachable URL of the synced page, present only on the scene branch (absent for a config/data-model run). Resolved at outtake time from the synced page's config-derived identity (Layout-Builder canonical entity URL / Display-Builder `page_layout` route) and expected to answer HTTP 200.
        examples:
          - https://drupal.ddev.site/node/1
```

## Context
### task:transform (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/skills/sync-to/tasks/transform.md)
```
---
title: Transform config-name unit to Drupal config YAML
trigger:
  steps:
    - sync-to:transform
domain:
  - data-mapping
  - data-model
params:
  type: object
  required:
    - units
    - backend_cmd
    - config_sync_dir
  properties:
    units:
      type: array
      description: Ordered list of config-name units from the resolve-filter stage.
      items:
        $ref: ../schemas.yml#/ConfigNameUnit
    backend_cmd:
      type: object
      resolve: backend_cmd
      description: >
        Backend command strings from designbook.config.yml. Provides schema_cmd (append config name → JSON
        Schema on stdout), validate_cmd (append config name + yaml path → exit non-zero on violation), and
        import (run as-is by the sync stage to apply the config-sync directory).
      required:
        - schema_cmd
        - validate_cmd
      properties:
        schema_cmd:
          type: string
          description: >
            Command prefix for fetching a config JSON Schema. The engine appends the config name before
            running (e.g. "ddev drush designbook:config-schema").
          examples:
            - ddev drush designbook:config-schema
        validate_cmd:
          type: string
          description: >
            Command prefix for validating a config YAML file. The engine appends the config name and yaml path
            before running (e.g. "ddev drush designbook:config-validate").
          examples:
            - ddev drush designbook:config-validate
        import:
          type: string
          description: >
            Complete command run as-is by the sync stage to import the config-sync directory into the live
            backend. Not used by transform itself; declared here so the shared backend_cmd shape validates
            when the config supplies it.
          examples:
            - ddev drush config:import --partial -y --source=/var/www/html/web/sites/default/files/sync
        exists_cmd:
          type: string
          description: >
            Command prefix that exits 0 iff a config object already exists in the live backend; append the
            config name. Not used by transform itself (the resolve-filter stage already dropped existing
            units); declared here so the shared backend_cmd shape validates when the config supplies it.
          examples:
            - ddev drush config:get
    config_sync_dir:
      type: string
      description: Absolute path to the Drupal config-sync directory where YAML files are written.
      resolve: config_sync_dir
result:
  type: object
  required:
    - config-file
  properties:
    config-file:
      path: '{{ config_sync_dir }}/{{ unit.config_name }}.yml'
      description: >
        The Drupal configuration YAML file written directly to the config-sync directory. Filename derives
        from the iteration binding unit.config_name. Shape is authoritative from the prepare-fetched schema
        (stored as prepared).
      prepare:
        cmd: '{{ backend_cmd.schema_cmd }} {{ unit.config_name }}'
        as: prepared
      generator:
        jsonata: $DESIGNBOOK_DATA/sync/{{ unit.config_name }}.jsonata
---

# Transform

Author and run a per-config-name JSONata to produce the Drupal configuration YAML for one unit, written directly to the config-sync directory.

## Result: config-file

For each unit, the result is the Drupal config YAML file at `{{ config_sync_dir }}/{{ unit.config_name }}.yml` — one file per config name, written as the terminal step.

`prepared` (the JSON Schema fetched by the `prepare` cmd for this config name) is authoritative for the **shape**: it decides which properties are allowed and which are required — the *form* of the config. The **content** — the values that fill that shape — comes from the Scene and the unit's `def`, carried unchanged: the Scene is the source, this config its translation. `prepared` is the guide for the form, never a stand-in for what the Scene means; where a property could take many schema-valid values, the Scene's value is the one to produce.

For the JSONata at the generator path, pick the guiding blueprint by this precedence: (1) if a loaded blueprint declares a `trigger.config_name` glob that matches `unit.config_name`, follow that blueprint's `### to_drupal` block — such a blueprint is already gated to the project by its own `filter:` (extensions/frameworks), so it is present only when it applies; (2) otherwise, for a content-derived unit follow the blueprint for `unit.entity_type` plus the `field-types` prelude for field units; (3) otherwise, for a config-slice unit follow the config-type blueprint; (4) with no matching blueprint, author from `prepared` alone — **a reported state, never a silent one**: record the unit as an uncovered stage-4 case in the outtake (surfaced in `plan summary`), so a missing blueprint shows up instead of quietly producing schema-conformant-but-not-Scene config. Every unit kind that occurs today has a covering blueprint; a stage-4 hit means a new unit kind needs one. This is the pattern to follow when authoring the transform. Run the authored JSONata over `unit` (binding `unit.entity_type`, `unit.bundle`, `unit.field_name`, `unit.def` as needed) to produce the config payload written to `{{ file }}`.

When a display unit's `def` carries `template: presenter` (a surface whose presentation the display config cannot express), follow the presenter-template blueprint **in addition to** the display-unit pattern: `transform` writes the **presenter-template** to the path and shape that blueprint directs, alongside the unit's config YAML. The config remains the binding; the presenter-template carries the presentation the display config cannot express. A declaratively bindable surface (`template: field-map`) writes config only.

Schema conformance for `config-file` is validated against `prepared` — the live Drupal typed-config JSON Schema fetched by `prepare` — checked against the submitted content on completion. Live validation via the backend's config-validate command is deferred: it takes a file path argument, and the staged file lives on the host while the command executes inside the backend container, so the path does not resolve there. `backend_cmd.validate_cmd` is declared for this future capability but is currently unused by transform.

```

### task:sync (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/skills/sync-to/tasks/sync.md)
````
---
title: "Sync config to Drupal"
trigger:
  steps: [sync-to:sync]
params:
  type: object
  required: [backend_cmd]
  properties:
    backend_cmd:
      type: object
      resolve: backend_cmd
      description: >
        Backend command strings from designbook.config.yml. Provides import
        (runs config-import against the backend's view of the config-sync
        directory).
      required: [import]
      properties:
        import:
          type: string
          description: >
            Complete command that imports the config-sync directory into the
            live backend. The engine runs this string opaquely — no
            drush/Drupal/path knowledge lives in this task.
          examples: ["ddev drush config:import --partial -y --source=/var/www/html/web/sites/default/files/sync"]
result:
  type: object
  required: [sync-result]
  properties:
    sync-result:
      $ref: ../schemas.yml#/SyncResult
---

# Sync

Apply the config-sync directory to the live Drupal site by running:

```
{{ backend_cmd.import }}
```

Capture stdout, stderr, and the exit code.

On a non-zero exit code, retain stdout/stderr as failure evidence. Correct the cause and retry this task. If it cannot be corrected within the saved definition, block the task with the attempted correction and the command output. A failed import does not complete this task.

## Result: sync-result

- `drush_summary`: the complete captured stdout/stderr from the drush invocation.
- `applied_config_names`: the list of config names that drush reported as imported during this run, parsed from the drush output.
- `cim_ok`: `true` if `drush config:import --partial` exited 0; `false` otherwise.

````

### task:outtake (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/skills/sync-to/tasks/outtake.md)
```
---
title: Outtake
trigger:
  steps: [sync-to:outtake]
params:
  type: object
  properties:
    scene:
      type: string
      default: ""
      description: >
        Scene id (SceneDef.name) of a scene run — keys the config-derived page URL
        lookup. Empty on a config/data-model run (then no page_url is emitted).
    backend_cmd:
      type: object
      resolve: backend_cmd
      description: >
        Backend command strings from designbook.config.yml. Provides page_url_cmd
        for a Scene run (substitute the scene id → prints the config-derived page URL).
        Run opaquely — no drush/Drupal knowledge lives in this task.
      properties:
        page_url_cmd:
          type: string
          description: >
            Command template that prints the reachable URL of a synced page from its
            config-derived identity (Layout-Builder canonical entity URL / Display-Builder
            `page_layout` route); substitute the scene id for the `{scene}` placeholder.
            Used only on the Scene path — keyed by the scene id, since a Scene sync creates no content.
          examples: ["ddev drush designbook:page-url {scene}"]
result:
  type: object
  required: [summary]
  properties:
    summary:
      $ref: ../schemas.yml#/ExportSummary
---

# Outtake

Assemble the `ExportSummary` from this workflow's own written-file results and
submit it as the task result.

## Result: summary

The config files come from the workflow's task results in scope — no params are
passed in for them:

- `config_names` is the sorted list of `config_name` values sourced from the
  `transform` stage results (one `config-file` result per `config-name` unit
  produced in that stage).
- `count` is the total number of config YAML files written, derived from the
  same `transform` stage results.
- `presenter_templates` is the sorted list of presenter-template paths the `transform` stage
  wrote for `template: presenter` surfaces — empty when no surface needed one. It makes the
  contract widening (config, plus a presenter-template) visible in the summary.
- `uncovered_units` is the list of `config_name`s the `transform` stage recorded as
  blueprint-precedence stage-4 hits (authored from `prepared` alone). Empty in the normal case;
  a non-empty list is the reported signal that a unit kind lacks a covering blueprint — surface
  it, do not swallow it.
- `page_url` is set only on the scene branch (`scene` is set): run `page_url_cmd` with the
  scene id substituted for the `{scene}` placeholder and record the printed URL — the reachable,
  config-derived URL of the page this run synced (expected HTTP 200). Omit it on a
  config/data-model run. Also omit it (do not fail the stage) when the command prints nothing —
  a config-only sync creates no entity, so the page's canonical entity may not exist yet on the
  first run; the URL becomes resolvable once the page's canonical entity is present.

```

### ctx:cli-surface (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/workflow/rules/cli-surface.md)
```
---
name: designbook-cli-surface
trigger:
  steps:
    [
      capture,
      capture-backend,
      capture-file,
      capture-image,
      compare,
      compare-observations,
      compile-css,
      create-data-model,
      create-sample-data,
      create-scene-file,
      create-tokens,
      create-vision,
      generate-css,
      generate-index,
      generate-jsonata,
      guard-css,
      map-entity,
      observe-figma,
      observe-storybook,
      observe-website,
      outtake,
      polish,
      polish-config,
      prepare-fonts,
      publish-capture,
      re-capture,
      re-capture-backend,
      re-compare,
      refresh-components,
      setup-storybook,
      sync,
      transform,
      triage,
      triage-config,
      validate,
      verify-install,
      write-component,
      write-config,
      write-scene,
    ]
---

# CLI command surface

`_debo` / `npx storybook-addon-designbook` is the command contract for every
workflow. Run the command. Its stdout and stderr are the spec: intake context,
schemas, instructions, status. Skill descriptions only fire the skill; they
are not the command surface.

Every intake's first command is `intake <id>`. Source dumps use
`_debo reference save --reference <dir> --url <url> --state <name> --session
<name>`. Screenshots use `_debo reference capture-image --reference <dir> --path
<png> --url <url> --selector <sel> --width <px> --session <name>` (optional
`--steps`, `--prelude`). Asset files use `_debo reference capture-file
--reference <dir> --path <rel> --url <absolute-http-url> --session <name>`.
Unpublished revisions are read with `_debo reference inspect`; a prelude is
fingerprinted with `_debo reference prelude`. A full matrix uses
`_debo capture matrix`. Story identity uses `_debo storybook check`.
`plan instructions` supplies the saved step. A nonzero CLI exit ends this
work with that exact message. Recover with `--help`, the intake context, or the
saved step instructions.

`packages/storybook-addon-designbook` is not a recovery path. When the work needs
a fact that `--help`, the intake context and the saved step instructions do not carry,
stop and name that missing fact in the report — the skills own it, so the gap is
the finding. Reconstructing it from the addon source, or from a stored artifact
opened off disk, publishes a guess in the place of an observation.

```

### ctx:sample-template-mapping (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/skills/data-model/rules/sample-template-mapping.md)
````
---
trigger:
  domain: [data-model]
provides:
  data-model:
    properties:
      content:
        additionalProperties:
          additionalProperties:
            properties:
              fields:
                additionalProperties:
                  properties:
                    sample_template: { type: object }
---

# Rule: Auto-assign sample_template from Config

When adding or updating fields in the data model, check `designbook.config.yml` for a `sample_data.field_types` map and auto-assign `sample_template` accordingly.

## How to Apply

1. Read `sample_data.field_types` from `designbook.config.yml` (may be absent — skip silently if so)
2. For each field being created or updated:
   - If the field's `type` matches a key in `sample_data.field_types`
   - AND the field does not already have a `sample_template`
   - → Set `sample_template.template` to the mapped value

## Example

Given config:
```yaml
sample_data:
  field_types:
    formatted_text: formatted-text
    text_with_summary: formatted-text
    link: link
    image: image
```

A field `body: { type: formatted_text }` becomes:
```yaml
body:
  type: formatted_text
  title: Body
  sample_template:
    template: formatted-text
```

## Rules

- Do NOT overwrite an existing `sample_template` on a field
- Do NOT add `sample_template` if `sample_data.field_types` is absent from config
- `sample_template.settings` is left empty unless the user provides a hint
- This mapping is additive — it does not replace any other field properties

````

### ctx:presenter-template (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/skills/data-model/rules/presenter-template.md)
```
---
trigger:
  domain: [data-model]
---

# Rule: Presenter-Template vs Declarative Template

A view mode or form mode's `template` selects how the entity is presented. Every template is one
of two kinds, and which kind a mode needs is **decidable** — never a per-case judgement:

- A **declarative template** renders the mode through display **config** the backend interprets:
  the presentation is expressed as data — component bindings, props, slots — that a declarative
  display layer resolves. This is the normal case.
- A **presenter-template** (`template: presenter`) renders the mode through generated
  **backend-native presentation markup** (a backend-native template) for a presentation the config
  layer cannot express. It stands **beside** the declarative templates — a peer kind, not a replacement.

## The decision (deterministic)

For each view mode / form mode, ask one question: **can this mode's presentation be expressed as
declarative display config?**

- **Yes → a declarative template** (config only). The mode carries a declarative template value
  and generates no presenter-template.
- **No — the presentation binds only through backend-native markup → `template: presenter`.** The
  mode carries `presenter`; a presenter-template is generated for it.

Which surfaces are declaratively bindable and which are markup-only is the concrete criterion of
the active backend integration — its rules name the bindable surfaces and the markup-only ones.
The two-kinds split and the one-question decision above hold regardless of backend, so for every
bundle and every mode the answer is determined, not guessed.

## Where the presenter-template is generated

The data model only **declares** `template: presenter`. The presenter-template artifact itself is
produced when the model is synced to the backend — the sync writes it alongside the mode's display
config — and its concrete form and location are the backend integration's concern. Declaring
`presenter` is authoring-time; generating the markup is sync-time.

```

### ctx:presenter-template-surfaces (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/presenter-template-surfaces.md)
```
---
trigger:
  domain: [data-model]
filter:
  backend: drupal
---

# Rule: Which Drupal Surfaces Are Presenter-Template Surfaces

This is the concrete criterion behind the backend-neutral presenter-template decision: for a
Drupal project it names which surfaces bind declaratively (config) and which bind only through
theme methods (a presenter-template). The decision stays deterministic — never a per-mode
judgement.

## Declaratively bindable → a declarative template (config)

A surface whose presentation can be expressed through **UI Patterns 2** display config is
declaratively bindable and uses a declarative template — `field-map` for field-driven content.
Field-rendered content reaches its component through UI-Patterns slots (a `field_block` in its
slot region), attributes and control values through props. This is the normal case for a bundle's
read displays.

## Theme-methods-only → `template: presenter`

A surface whose presentation can be produced **only** by Drupal theme markup — not by UI-Patterns
display config — is a presenter-template surface and uses `template: presenter`:

- an **edit form** (a `form_mode` display reached over an edit route) — Drupal renders forms
  through the form builder and theme layer, not through UI-Patterns display config;
- a view **pager**;
- a view **exposed filter** form.

A mode that is a presenter surface carries `template: presenter`; `sync-to` then generates its
presenter-template (the Twig *how* is the presenter-template blueprint) alongside the display
config that binds it.

## Field content stays in slots, unchanged

Choosing `presenter` for a form/pager/exposed-filter surface does not move field-rendered content
out of slots: the field→slot mapping for read displays is unchanged. A presenter-template renders
the theme-methods-only chrome around fields; the fields themselves still render through their
formatter into slots.

```

### ctx:media-image-styles (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/media-image-styles.md)
````
---
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Rule: Media View Modes Match Image Styles

In Drupal, media entity view modes typically correspond to image styles. When creating the data model, align media view mode names with image style bundle names.

## How to Apply

For each media bundle with image fields (e.g. `media.image`):
- Create a view mode for each image style that media will be displayed in
- Name the view mode the same as the image style bundle (e.g. view mode `ratio_16_9` uses image style `ratio_16_9`)

## Example

```yaml
content:
  media:
    image:
      view_modes:
        ratio_16_9:
          template: field-map
        ratio_4_3:
          template: field-map
        ratio_1_1:
          template: field-map
      fields:
        field_media_image:
          type: image
          required: true

config:
  image_style:
    ratio_16_9:
      aspect_ratio: 16:9
    ratio_4_3:
      aspect_ratio: 4:3
    ratio_1_1:
      aspect_ratio: 1:1
```

## Rules

- Media view mode names SHOULD match the image style bundle they render with
- This convention allows entity mappings to connect media display with the correct aspect ratio
- Semantic image styles (e.g. `hero`) do NOT need a matching media view mode — they are applied at the scene level, not at the media entity level

````

### ctx:form-modes (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/form-modes.md)
```
---
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Rule: Form Modes

A bundle's `form_modes` are the **editing** half of the bundle, symmetric to `view_modes` (the reading
half). Each form mode maps to a Drupal `core.entity_form_display.<et>.<bundle>.<form_mode>`, reached over
an edit route. `default` is the form mode every bundle always has.

## `label` required for non-default form modes

`label` is required on every **non-default** form mode. `sync-to` emits a
`core.entity_form_mode.<et>.<form_mode>` definition for each non-default mode, and that definition carries
the human-readable name from `label` — with no `label` there is nothing to name it. The `default` form
mode is built in and needs no `label`. This mirrors the same requirement on non-standard `view_modes`.

## Edit routes

Form displays render over an edit route, not as a placed block:

- `/node/add/{type}` and `/node/{node}/edit` — the node add/edit form
- `/user/{user}/edit` — the user edit form
- `/user/register` — the user `register` form mode
- `comment/reply/{entity_type}/{entity}/{field_name}` — the comment reply form

## Comment form

The comment form belongs here, not with placed blocks. A `comment` field in the host bundle's
`core.entity_view_display.*` renders the reply form through
`core.entity_form_display.comment.<bundle>.default`. Drupal core ships no comment-form block plugin, and
none is needed — model the comment form as a `form_modes` entry on the `comment` bundle.

## Not a goal — field selection and widgets

Scope is **which component renders the form**. The full `core.entity_form_display` field semantics — which
fields appear, in what order, and each field's widget configuration — are out of scope. Do not add a
`widgets:` or field-selection member to a form mode; a form mode carries only `template`, `label`, and
`settings`, the same shape as a view mode.

## Multiple form modes are core reality

More than one form mode per bundle is normal, not an edge case. Drupal core ships
`core/modules/user/config/install/core.entity_form_mode.user.register.yml` (the `register` mode on the
`user` bundle) and `core/modules/media_library/config/install/core.entity_form_mode.media.media_library.yml`
as stock non-default form modes.

```

### ctx:field-type-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/field-type-constraints.md)
```
---
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Rule: Drupal Field Type Constraints

`DataModel.content.*.*.fields.*.type` must be one of the nine types that the
`field-types` blueprint serializes to Drupal config. Any other value has no
`$fieldToStorage` / `$fieldToInstance` mapping and will cause the export stage
to fail.

## Merge engine limitation

The `constrains:` mechanism intersects enum values by navigating named
`properties` paths.  `DataModel.content` uses `additionalProperties` wildcards
at the entity-type and bundle levels, not named `properties` keys.  Because the
merge engine cannot recurse through `additionalProperties`, there is no
`properties`-only path to `content.*.*.fields.*.type`.  The enum constraint
therefore cannot be expressed in `constrains:` frontmatter and is enforced here
as guidance.  If the merge engine gains `additionalProperties`-aware descent in
a future release, migrate the constraint below into `constrains:` frontmatter
and remove this prose.

## Enforced field type enum

`fields.*.type` must be one of:

| Value | Drupal storage type | Module |
|---|---|---|
| `string` | `string` | `text` |
| `text` | `text_long` | `text` |
| `text_with_summary` | `text_with_summary` | `text` |
| `formatted_text` | `text_long` | `text` |
| `integer` | `integer` | `core` |
| `boolean` | `boolean` | `core` |
| `link` | `link` | `link` |
| `image` | `image` | `image` |
| `reference` | `entity_reference` | `core` |

Any other value is invalid for the Drupal backend and must be rejected.

## Per-type required settings

These requirements also cannot be expressed via `constrains:` (no `if/then/else`
conditional support in the merge engine).  They are hard constraints enforced
here as guidance:

- **`image`** — `settings.image_style` is **required**.  Without it the storage
  config omits the style and Drupal falls back to the `_original` style
  silently.
- **`reference`** — `settings.target_type` is **required**.  Without it the
  `entity_reference` storage record has no `target_type` and Drupal config
  import fails.

All other field types accept an empty or absent `settings` object.

```

### ctx:drupal-views (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/drupal-views.md)
```
---
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Rule: Drupal Views Config Entities

`view` is a config entity type (defined in `entity-types/view.md`). Base fields and placement are defined there.

## Rules

- Declare `view_modes.default.template: list-view` (or the appropriate template for this view)
- `rows` is generated at sample data time — do NOT set row values in the data model

```

### ctx:drupal-config (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/drupal-config.md)
```
---
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Rule: Drupal Config Name Format

## config_name format

Every `config_name` value MUST match the pattern `^[a-z0-9_]+(\.[a-z0-9_]+)+$`
(dot-separated lowercase/digit/underscore segments). This mirrors the Drupal
config/sync filename convention (the `.yml` extension is excluded).

```

### ctx:block-decision (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/rules/block-decision.md)
```
---
trigger:
  domain: [data-model]
filter:
  backend: drupal
---

# Rule: How a Scene Block Is Typed — and When It Cannot Be

## Which node this rule types

This rule types the **block** nodes of a page; it never decides which node is the main content.
Which nodes are blocks comes from the scene kind:

- A **screen scene** (built by `design-screen`) names exactly one route-bearing **main content**
  (an entity or a View); **every other node in the `content` slot is a block** (see the core
  screen-scene constraints). The main content is never a block.
- A **page-content scene** synced by `sync-to` (a Layout-Builder / `page_layout` page, where the
  page node is **implicit** — its display carries the blocks) is not gated by the screen-scene
  constraints, so no main-content node is designated. There **every** node in the `content` slot is
  a block placed into the page's sections.

Either way, once a node is a block, its type is read **from the data model** — never from a
per-node judgement and never from a family hint. The data model is the source; the scene points at
what it declares.

## The decision

For each block node, in this order (first match wins, so two runs never diverge):

- The data model carries a **`block_plugin` entry** for it → **`block_plugin`** (a plugin
  placement: a `views_block` — e.g. a View rendered as a block — an exposed-filter block, a
  user-login block, a placed content block, or any contrib/custom block plugin). This wins even
  when a `block_content` bundle also backs it: the bundle *defines* the content once, the
  `block_plugin` entry *places* it (see `block_plugin.md` — content blocks as plugins).
- Otherwise its bundle is a **`block_content` bundle** → **`block_content`** (a content block: a
  bundle with fields, editorially maintained).
- Otherwise it is a **component node** (`component:`) with no block backing → **no separate
  block**: an inline component in the page's layout/`page_layout` config.

**Matching a node to its entry.** A block node names what it renders (a `component:`, or an
`entity: <type>.<bundle>` / `entity: view.<id>` address); it maps to the **one** `block_plugin`
entry (or `block_content` bundle) that places/backs exactly that plugin, component, or view. If the
model offers **no** matching entry, or **more than one**, the block is undeterminable — reported,
not guessed (below). The match is by what the entry places, never by proximity or ordering, so two
runs agree.

## `suggests` stays a hint

The `component_by_family` suggestions in `block_plugin.md` are a discovery signal only. They never
decide the block type, and an explicit data-model declaration always wins. A family hint is not a
substitute for the declaration.

## An undeterminable block is reported, not guessed

An **entity** block node (`entity: <type>.<bundle>`) becomes a block only through the data model: a
`block_plugin` entry names it, or its bundle is a `block_content` bundle. If **neither** types it,
the block is undeterminable — the run **reports the node and stops for that unit** rather than
guessing (silently choosing a content vs. plugin block). The fix is to make the data model declare
how that entity becomes a block; the source, not the sync, decides. Guessing here would let two runs
over one scene produce different config.

```

### ctx:image-fields (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/rules/image-fields.md)
````
---
trigger:
  domain: data-mapping
---

# Rule: Image Field Mapping

Hard constraints for mapping image and reference fields in entity-mapping JSONata expressions.

## Invariants

### 1. Images are always slots

An ImageNode or EntityNode representing an image MUST be placed in a named **slot** of a ComponentNode — never as a prop value.

```jsonata
/* correct — image in slot */
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
  "props": { "title": title },
  "slots": {
    "image": [
      { "image": "leando_teaser", "alt": field_image.alt }
    ]
  }
}

/* wrong — image as prop */
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
  "props": {
    "title": title,
    "image": field_image.url,
    "image_alt": field_image.alt
  }
}
```

### 2. `type: image` fields emit ImageNode via image style

When the data-model field type is `image`, the image data lives directly on the entity. The JSONata mapping emits an ImageNode with a mandatory image style name:

```jsonata
{ "image": "<style_name>", "alt": <field>.alt }
```

The `<style_name>` MUST reference a bundle defined under `config.image_style` in `data-model.yml`. No image without an image style.

### 3. `type: reference` fields emit EntityNode

When the data-model field type is `reference`, the JSONata mapping emits an EntityNode. The referenced entity renders itself — the mapping does not access the referenced entity's data.

```jsonata
{ "entity": "<entity_type>.<bundle>", "view_mode": "<view_mode>", "record": <index> }
```

This applies to ALL reference types — media, paragraph, node, taxonomy_term, etc. What the referenced entity produces (ImageNode, ComponentNode, etc.) is that entity's own mapping concern.

````

### ctx:field-cardinality (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/rules/field-cardinality.md)
````
---
trigger:
  domain: data-mapping
---

# Rule: Field Cardinality Mapping

Drupal field cardinality defines the mapping boundary. A field can have its own
field-level template, and multi-value fields MUST keep that boundary.

## Constraints

- Multi-value fields map as one field-level collection: slot, field component,
  repeated field template, or renderable child list.
- Single-value fields MAY unwrap inner values into component props or slots when
  the reference-visible treatment is atomic. A single-value field whose formatter
  renders markup/content — including one `title` or one `link`/CTA — is a **slot**
  (`field_block`), not a scalar prop; scalar props stay reserved for genuinely
  atomic non-markup values (icon id, boolean, image attribute). See *Field-Rendered
  Content Maps to a Slot, Not a Scalar Prop* in
  `../../components/rules/reference-field-semantics.md`.
- Do not flatten multi-value items into sibling parent props.
- Do not render only the first item of a multi-value field unless the data model
  explicitly describes a single selected value field.
- Entity reference fields follow the same rule and always render through
  `EntityNode` with the referenced entity type, bundle, and explicit referenced
  bundle view mode.
- Parent mappings MUST NOT inspect referenced entity fields. The referenced
  entity's own mapping renders its fields.

## Pattern

Multi-value non-reference field:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:<parent-component>",
  "slots": {
    "<field_slot>": [
      {
        "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:<field-component>",
        "props": { "items": <multi_value_field> }
      }
    ]
  }
}
```

Multi-value reference field:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:<parent-component>",
  "slots": {
    "<reference_field_slot>": $map(<multi_value_reference_field>, function($id) {
      {
        "entity": "<target_entity_type>.<target_bundle>",
        "view_mode": "<target_view_mode>",
        "record": $number($id) - 1
      }
    })
  }
}
```

Wrong:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:<parent-component>",
  "props": {
    "<item_prop_a>": <multi_value_field>[0].<value_a>,
    "<child_prop_a>": <multi_value_reference_field>[0].<child_field_a>
  }
}
```

````

### ctx:image_style (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/461188163343/skills/data-model/blueprints/image_style.md)
````
---
type: entity-type
name: image_style
priority: 5
trigger:
  domain: data-model
---

# Entity Type: image_style

```yaml
entity_type: image_style
section: config
bundle_properties:
  aspect_ratio:
    type: string
    format: "W:H"
    required: true
  breakpoints:
    type: object
    required: false
    description: >
      Named breakpoints with width and optional aspect_ratio override.
      Breakpoint names are arbitrary labels — not tied to CSS breakpoints.
    properties:
      width:
        type: integer
        required: true
      aspect_ratio:
        type: string
        format: "W:H"
        required: false
```

## Drupal Config Export Pattern

The concrete `.jsonata` is authored per config-name task against the prepare-fetched schema.
The pattern below describes the mapping intent for authoring that transform.

**Input:** `{ key, def: { aspect_ratio: "W:H", breakpoints?: { <name>: { width: <n>, aspect_ratio?: "W:H" } } } }`

**Output config-name units:**
- `image.style.<key>` — one image style entity; keys include `name`, `label` (both from `key`), module dependency `["image"]`, and an `effects` map
- Effect key: `"scale_and_crop_" + key` — used for both the map key and `uuid`; deterministic so repeated sync runs stay idempotent (Drupal uses config-name as primary key, not uuid)
- Effect `id`: `"image_scale_and_crop"`, `weight: 1`, `anchor: "center-center"`, `upscale: false`
- Effect `data.width` / `data.height`: parse `aspect_ratio` as `"W:H"` → multiply each component by 100 (e.g. `16:9` → width 1600, height 900)

All emitted units carry `langcode: "en"`, `status: true`, and a `dependencies` object.

## Naming Convention

**Ratio-based names** — when the aspect ratio is the same across all viewports. Use `ratio_` prefix followed by the ratio with underscores. The prefix avoids YAML parsing numeric-looking keys as integers:

```yaml
image_style:
  ratio_16_9:
    aspect_ratio: 16:9
  ratio_4_3:
    aspect_ratio: 4:3
  ratio_1_1:
    aspect_ratio: 1:1
```

**Semantic names** — when the ratio changes per viewport (responsive breakpoints). Name describes the usage context:

```yaml
image_style:
  hero:
    aspect_ratio: 21:9
    breakpoints:
      xl: { width: 1200 }
      md: { width: 768, aspect_ratio: 16:9 }
      sm: { width: 480, aspect_ratio: 4:3 }
  card:
    aspect_ratio: 4:3
    breakpoints:
      sm: { width: 480, aspect_ratio: 1:1 }
```

Use ratio-based names by default. Switch to semantic names only when breakpoints override the ratio.

## Rules

- `image_style` lives under `config:` in data-model.yml — NOT under `content:`
- Bundles do NOT use `fields` — properties (`aspect_ratio`, `breakpoints`) are direct bundle keys
- `aspect_ratio` is required on every bundle, format `W:H` (e.g. `16:9`, `4:3`, `1:1`)
- Breakpoint names are arbitrary labels; the `width` value determines the media query threshold
- Breakpoints without `aspect_ratio` inherit the bundle's default ratio

````

### ctx:view (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/blueprints/view.md)
````
---
type: entity-type
name: view
priority: 10
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Entity Type: view

```yaml
entity_type: view
section: config
base_fields:
  rows:
    type: view_rows
    required: true
  items_per_page:
    type: integer
    required: false
  header:
    type: text
    required: false
  footer:
    type: text
    required: false
  empty:
    type: text
    required: false
view_modes:
  required: true
```

## Drupal Config Export Pattern

The concrete `.jsonata` is authored per config-name task against the prepare-fetched schema.
The pattern below describes the mapping intent for authoring that transform.

**Input:** `{ key, def: { items_per_page?, view_modes?: [<string>] } }`

**Output config-name units:**
- `views.view.<key>` — a single Views config entity; keys include `id`, `label` (both from `key`), `base_table: "node_field_data"`, `base_field: "nid"`, module dependency `["views"]`, and a `display` map with a `"default"` display entry
- The default display's pager uses `items_per_page` from `def.items_per_page` (falls back to `10`); access type `"none"`, cache type `"tag"`

All emitted units carry `langcode: "en"`, `status: true`, and a `dependencies` object.

## Rules

- `rows` is generated at sample data time from context (entity_type, bundle, view_mode of the targeted content) — do NOT manually declare row values in the data model
- Every view bundle MUST declare at least one `view_modes` entry
- `view` lives under `config:` in data-model.yml — NOT under `content:`

````

### ctx:taxonomy_term (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/blueprints/taxonomy_term.md)
````
---
type: entity-type
name: taxonomy_term
priority: 10
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Entity Type: taxonomy_term

```yaml
entity_type: taxonomy_term
section: content
base_fields:
  name:
    type: string
    required: true
  description:
    type: text
    required: false
  weight:
    type: integer
    required: false
```

## Drupal Config Export Pattern

The concrete `.jsonata` is authored per config-name task against the prepare-fetched schema.
The pattern below describes the mapping intent for authoring that transform.

**Input:** `{ bundle, def: { fields: { <name>: { type, required?, multiple?, settings? } } } }`

**Output config-name units:**
- `taxonomy.vocabulary.<bundle>` — the vocabulary entity (note: config name uses `taxonomy.vocabulary.*`, NOT `taxonomy_term.type.*`); keys include `name`, `vid` (both from `bundle`), `description` (from `def.purpose`), `hierarchy: 0`, `weight: 0`
- `field.storage.taxonomy_term.<name>` — one per field (entity type key is `taxonomy_term`), via the field-types serialization pattern
- `field.field.taxonomy_term.<bundle>.<name>` — one per field, via the field-types serialization pattern
  - The bundle config dependency in `field.field.*` is `taxonomy.vocabulary.<bundle>`, not `taxonomy_term.type.<bundle>`

All emitted units carry `langcode: "en"`, `status: true`, and a `dependencies` object.
Field configs are serialized using `$fieldToStorage` / `$fieldToInstance` — see `field-types.md` for the mapping.

````

### ctx:node (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/blueprints/node.md)
````
---
type: entity-type
name: node
priority: 10
trigger:
  domain: data-model
filter:
  backend: drupal
---

# Entity Type: node

```yaml
entity_type: node
section: content
base_fields:
  title:
    type: string
    required: true
  body:
    type: text_with_summary
    required: false
```

## Drupal Config Export Pattern

The concrete `.jsonata` is authored per config-name task against the prepare-fetched schema.
The pattern below describes the mapping intent for authoring that transform.

**Input:** `{ bundle, def: { fields: { <name>: { type, required?, multiple?, title?, description?, settings? } } } }`

**Output config-name units:**
- `node.type.<bundle>` — the bundle entity; keys include `name`, `type`, `description` (from `def.purpose`), `new_revision`, `preview_mode`, `display_submitted`
- `field.storage.node.<name>` — one per field, via the field-types serialization pattern
- `field.field.node.<bundle>.<name>` — one per field, via the field-types serialization pattern

All emitted units carry `langcode: "en"`, `status: true`, and a `dependencies` object.
Field configs are serialized using `$fieldToStorage` / `$fieldToInstance` — see `field-types.md` for the mapping.

````

### ctx:media (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/blueprints/media.md)
````
---
type: entity-type
name: media
priority: 10
trigger:
  domain: data-model
filter:
  backend: drupal
suggests:
  source:
    type: string
    default: "image"
    description: >
      Drupal media source plugin ID for the bundle (e.g. "image", "file", "video_file",
      "oembed:video"). Defaults to "image" — override in project-specific configuration.
---

# Entity Type: media

```yaml
entity_type: media
section: content
base_fields:
  name:
    type: string
    required: true
```

## Drupal Config Export Pattern

The concrete `.jsonata` is authored per config-name task against the prepare-fetched schema.
The pattern below describes the mapping intent for authoring that transform.

**Input:** `{ bundle, def: { fields: { <name>: { type, required?, multiple?, settings? } }, source? } }`

**Output config-name units:**
- `media.type.<bundle>` — the bundle entity; keys include `name`, `id`, `description` (from `def.purpose`), `source` (defaults to `"image"` if not set), `source_configuration: {}`, `field_map: {}`; module dependency: `["media"]`
- `field.storage.media.<name>` — one per field, via the field-types serialization pattern
- `field.field.media.<bundle>.<name>` — one per field, via the field-types serialization pattern

All emitted units carry `langcode: "en"`, `status: true`, and a `dependencies` object.
Field configs are serialized using `$fieldToStorage` / `$fieldToInstance` — see `field-types.md` for the mapping.

````

### ctx:field-types (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/blueprints/field-types.md)
```
---
type: field-types
name: field-types
priority: 10
trigger:
  domain: data-model
filter:
  backend: drupal
extends:
  DataModel:
    properties:
      content:
        additionalProperties:
          additionalProperties:
            properties:
              fields:
                additionalProperties:
                  properties:
                    settings:
                      type: object
                      additionalProperties: true
suggests:
  field_type_enum:
    enum:
      - string
      - text
      - text_with_summary
      - formatted_text
      - integer
      - boolean
      - link
      - image
      - reference
    description: >
      Recognised Designbook field types for Drupal backend. Reference fields map to
      entity_reference in Drupal storage. Image fields require settings.image_style.
      Reference fields require settings.target_type.
  image_settings:
    type: object
    description: Required settings for image-type fields.
    required: [image_style]
    properties:
      image_style:
        type: string
        description: Machine name of the Drupal image style to apply (e.g. "thumbnail", "hero").
  reference_settings:
    type: object
    description: Required settings for reference-type fields.
    required: [target_type]
    properties:
      target_type:
        type: string
        description: Drupal entity type the field references (e.g. "user", "node", "media").
      handler:
        type: string
        description: Selection handler machine name (default "default").
---

# Blueprint: Field Types

Shared serialization pattern for Drupal config export. Describes how to map a Designbook
field definition into a `field.storage.*` record and a `field.field.*` record, following the
config-name/data shape used by the sync transform stage.

The concrete `.jsonata` per config-name is authored against the prepare-fetched schema.
This blueprint provides the mapping rules an AI uses when authoring that transform.

## Field-type mapping

| Designbook type | Drupal storage type | Module dependency |
|---|---|---|
| `string` | `string` | `text` |
| `text` | `text_long` | `text` |
| `text_with_summary` | `text_with_summary` | `text` |
| `formatted_text` | `text_long` | `text` |
| `integer` | `integer` | `core` |
| `boolean` | `boolean` | `core` |
| `link` | `link` | `link` |
| `image` | `image` | `image` |
| `reference` | `entity_reference` | `core` |

## Special cases

- **image**: `settings.image_style` is required. The storage type is `image`; the
  `image` module must be listed as a dependency.
- **reference**: `settings.target_type` is required (Drupal entity type). The storage
  type is `entity_reference`. Optionally `settings.handler` overrides the selection
  handler (default `"default"`).

## Field serialization pattern

The transform produces two config-name/data units per field — one `field.storage.*` and one
`field.field.*` — using the type mapping table above.

**`field.storage.<et>.<name>` shape:**
- `config_name`: `"field.storage." + et + "." + name`
- `data.type`: Drupal storage type from the mapping table
- `data.module`: module from the mapping table; omit from `dependencies` if `"core"`
- `data.settings`: `{ target_type }` for `reference` fields; `{}` otherwise
- `data.cardinality`: `-1` if `field.multiple = true`, else `1`
- `data.id`: `et + "." + name`; `data.field_name`: `name`; `data.entity_type`: `et`
- Always: `langcode: "en"`, `status: true`, `locked: false`, `translatable: true`, `indexes: {}`

**`field.field.<et>.<bundle>.<name>` shape:**
- `config_name`: `"field.field." + et + "." + bundle + "." + name`
- `data.dependencies.config`: sorted array containing `"field.storage.<et>.<name>"` and the
  bundle config name (e.g. `node.type.<bundle>`, `media.type.<bundle>`, `block_content.type.<bundle>`,
  `taxonomy.vocabulary.<bundle>`); omit bundle dep for entity types without a bundle config (e.g. `user`)
- `data.dependencies.module`: module if not `"core"`
- `data.settings` special cases:
  - `image`: `{ image_style: field.settings.image_style }`
  - `reference`: `{ handler: field.settings.handler ?? "default", handler_settings: { target_bundles: null } }`
  - all others: `{}`
- `data.field_type`: Drupal storage type from the mapping table
- `data.label`: `field.title ?? name`; `data.required`: `field.required === true`
- Always: `langcode: "en"`, `status: true`, `translatable: true`, `default_value: []`

```

### ctx:block_plugin (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-model/blueprints/block_plugin.md)
````
---
type: entity-type
name: block_plugin
priority: 10
trigger:
  domain: data-model
filter:
  backend: drupal
suggests:
  component_by_family:
    description: >
      Soft per-family starting component for a block_plugin entry. These are a
      discovery signal only — never merged into validation; an explicit `component`
      on the entry always wins over the hint.
    properties:
      views_block:
        default: block
        description: A view rendered as a block.
      views_exposed_filter_block:
        default: filter
        description: The exposed-filter form of a view's display.
      user_login_block:
        default: login-form
        description: The core user-login form.
      block_content:
        default: block
        description: A reusable content block placed as a plugin.
---

# Entity Type: block_plugin

A `block_plugin` entry is a named plugin-block instance — a block that reaches a page
as a **Block** rather than through a route. It is the home for every plugin block that
has **no** `block_content` backing (`views_block`, `views_exposed_filter_block`,
`user_login_block`, `system_menu_block`, and any contrib/custom block plugin) and it
also accepts a content block referenced by its plugin form (`block_content:<uuid>`). Its
`plugin` ID identifies the Drupal block plugin: it is what the render `component` is
chosen for, and it is the key Drupal resolves the block's own `settings` schema against
when the config is applied to a site.

```yaml
entity_type: block_plugin
section: config
```

A `block_plugin` entry is an **open config entry** — exactly like every other config
type (`view`, `canvas_page`, `block_content`, `media`), it carries **no** authoring-time
schema and no enforced per-entry shape; `config.block_plugin` falls back to the core
config model's open `additionalProperties: true`, accepting arbitrary keys per type. An
entry typically names the block `plugin` ID and the render `component`, and may carry a
render `layout` or a providing `module` — but none of these is a hard contract checked
here. This body describes only the surrounding intent, export behaviour, the
authoring-time vs. runtime split, dependencies, and non-goals.

## Authoring-time vs. runtime

The Drupal block-plugin space is open, and Drupal resolves each block's `settings` schema
dynamically per plugin (`block.settings.[%parent.plugin]`). Nothing about an entry is
enforced while authoring — without a site there is no schema to check a `block_plugin`
entry against, so the whole entry (including its plugin-specific `settings`) stays
free-form here. Everything that needs the actual Drupal install is deferred to when the
modelled config is exported and applied to a live target (the `sync-verify` round-trip),
where Drupal's own config schema resolves:

- whether the named `plugin` actually exists on the target,
- whether `settings` matches Drupal's real `block.settings.<plugin>`,
- whether a referenced view carries its exposed-filter block (see Dependencies).

A hand-maintained enumeration of a few plugin families is deliberately **not** used: it
would reject every legitimate contrib/custom plugin and drift from the installed Drupal.

## Render component

An entry typically names the SDC that renders the block. The `component_by_family`
suggestions in this blueprint's frontmatter offer a per-family starting point for
discovery, but they are a soft signal only — never merged into validation. An explicit
`component` on the entry always wins, and there is no hidden plugin-to-component lookup at
export time.

## Drupal Config Export Pattern

A `block_plugin` entry emits **no** `block.block.*` placement entity of its own. Placement
stays owned by the page that hosts the block:

- On the Canvas path, the `canvas_page` `component_tree` node references the entry.
- On the Layout Builder path, the `layout_builder__layout` tree node references the entry.

The hosting tree node carries the plugin ID and the block settings; the `block_plugin`
entry is the reusable definition those nodes point at by its key. Nothing about the block
is exported twice.

## Dependencies

- **Exposed filters.** A `views_exposed_filter_block:*` entry depends on the view display
  it exposes having its exposed-filter block turned on. That flag lives with the view
  (`views.view.*`) and stays owned there — the entry only declares a dependency on the
  view key, and a `--with-deps` export pulls the referenced view alongside the block. The
  flag is never re-modelled on the block entry.
- **Providing module.** A core-provided plugin (e.g. views, user, block_content, system)
  needs no module entry. A block from a non-core provider must name its providing `module`;
  a non-core plugin left without one is a `sync-verify` failure, not a silently empty block.

## Content blocks as plugins

A reusable content block is referenced here by its `block_content:<uuid>` plugin value.
The block-content bundle, its fields, and its view modes stay defined once as content in
`block_content.md` — a `block_plugin` entry never re-declares them, it only points at the
placed block.

## Non-goals

- **Entity form displays are out of scope.** A form that reaches a page through a route
  rather than as a block belongs to `form_modes` (DESIGNBOOK-31), not here.
- **No widget-to-SDC mapping.** A `block_plugin` entry carries no `widgets:` field; the
  widget-to-SDC mapping stays the single responsibility of `components/blueprints/form.md`.

````

### ctx:views (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/views.md)
````
---
type: data-mapping
name: views
priority: 10
trigger:
  domain: data-mapping
  config_name: 'views.view.*'
filter:
  backend: drupal
---

# Blueprint: List View Mapping

Applies when `map-entity` runs for a View (`entity_type: view` — a `config.view` bundle). The same
blueprint also binds the view's Drupal config at `sync-to:transform` through its
`trigger.config_name: 'views.view.*'` — the config-name binding `form-display` and
`layout-builder-display` use — so a view binds like the other displays, not by prose alone.

## A view is a combination — presenter-template + UI-Patterns styles

Views are not a single-kind surface. Without Display Builder you cannot avoid combining **two**
templates for one view, and both must be modelled:

- **The view template** — the wrapper that renders the view as a whole: title, the rows region,
  the **pager**, and the **exposed filter**. This is **theme-methods-only** — there is no
  config-only way to express it without Display Builder — so it is a **presenter-template** (Twig).
- **The view styles / row-style template** — how each listed row renders. This binds through **UI
  Patterns**: the view's style/row plugin carries the shared `{component_id, variant_id, props,
  slots}` block, so each row is an SDC component render, not a raw view field. This is the
  declarative half.

So one view declares `template: list-view` in its `config.view.<id>` `view_modes` entry — that
value is the **UI-Patterns row-style** binding — and `sync-to` **also** generates the
**presenter-template** for the view wrapper (with its pager and exposed filter). A view therefore
emits config (the `views.view.<id>` with its UI-Patterns row style) *and* a presenter-template
(the wrapper); neither alone is a whole view.

## A view mapping is self-contained

A view scene node (`entity: "view.<id>"`, with no `record`/`select`) is resolved with an **empty
context**: the entity builder evaluates the view mapping against `{}`, not against a sample record.
So a view mapping MUST be **self-contained** — it enumerates the rows it lists directly and reads
nothing from `$`. A mapping that dereferences `$` (e.g. `$view.rows`, `$.items_per_page`) resolves
to empty and the listing renders blank.

The rows a view lists are the records of its **row bundle** — the content `entity_type`/`bundle`/
`view_mode` the view's `row` declares. The `design-screen` intake adds that row bundle to
`sample_data_bundles`, so its records exist; the mapping then references those records by index.
Because the rows are real row-bundle records, the entity-mapping validator finds them (no
"No sample records found") and the same enumeration renders the list.

## JSONata Pattern — flat list

Emit a flat array, one entry per listed row-bundle record. Top-level entries use the
`{ "type": "entity", … }` form (at the mapping's top level the validator accepts a `component` node
or a `type: "entity"` node; the `entity: "type.bundle"` string form is a scene-node shorthand, not a
mapping-output top-level form):

```jsonata
[
  { "type": "entity", "entity_type": "<row_entity_type>", "bundle": "<row_bundle>", "view_mode": "<row_view_mode>", "record": 0 },
  { "type": "entity", "entity_type": "<row_entity_type>", "bundle": "<row_bundle>", "view_mode": "<row_view_mode>", "record": 1 }
  /* one entry per row-bundle record the view lists */
]
```

Each entry renders the row bundle in its listed view-mode; the entity builder resolves each record.

## Optional wrapper (summary / pager)

When `list-view` / `view-summary` / `pager` components exist, wrap the same enumerated array in the
wrapper's `rows` slot — still self-contained (rows are enumerated, never read from `$`):

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:list-view",
  "slots": {
    "rows": [
      { "type": "entity", "entity_type": "<row_entity_type>", "bundle": "<row_bundle>", "view_mode": "<row_view_mode>", "record": 0 },
      { "type": "entity", "entity_type": "<row_entity_type>", "bundle": "<row_bundle>", "view_mode": "<row_view_mode>", "record": 1 }
    ]
  }
}
```

## A View's Display Type Decides Its Role

The same view can be a page's main content or beiwerk beside it — its **display type** decides:

- A view **page display** owns a route and can be a screen's route-bearing main content.
- A view **block** (`views_block:*`) owns no route; it is a block that sits beside the main content.

A View that a screen renders as its main content is modelled as a `config.view.<id>` bundle (its own
`view_modes` entry) so the renderer resolves it; the Drupal config-object name `views.view.<id>`
stays the sync/export address.

## Drupal config export — the `### to_drupal` pattern

At `sync-to:transform` this blueprint authors the `views.view.<id>` config. `prepared` (the
prepare-fetched schema) is authoritative for the shape; the view's data-model `def` supplies the
content — base table, row bundle/view-mode, filters, sort, and the `list-view` template.

Bind the view's **row output to its SDC component through the shared UI Patterns block** — the
`{component_id, variant_id, props, slots}` mechanism (see `ui-patterns.md`): the view's row/style
plugin carries that block, so a rendered list is a component render — the same UI-Patterns
manifestation a `field-map` display uses — not a raw view row. The view's `template: list-view`
names the component the rows bind to.

This authors only the **UI-Patterns half** (the row style). The **view wrapper** — the view
template with its **pager** and **exposed filter** — is theme-methods-only, so `sync-to` also emits
a **presenter-template** (Twig) for it (the presenter-template blueprint carries the *how*). A view
is the combination of the two: neither the UI-Patterns row config nor the wrapper presenter-template
is a whole view on its own.

The concrete config keys come from `prepared`; treat the row-binding intent here as the starting
point, not a fixed key layout.

````

### ctx:ui-patterns (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/ui-patterns.md)
````
---
type: data-mapping
name: ui-patterns
priority: 5
trigger:
  domain: data-mapping
---

# Blueprint: UI Patterns 2 — `{source_id, source}` Sub-Pattern

Path-neutral starting point for the **UI Patterns 2** config block —
`{ component_id, variant_id, props{}, slots{} }`. It carries **no** Layout Builder or Display
Builder specifics, so the Layout-Builder display path references it, and the Display Builder path
(DESIGNBOOK-3) references the same block unchanged.

The block has **two halves**:

- **Scene-intent** — how each prop is supplied: a literal, a field reference (`$fields.<field>`), a
  `[token]`, or attributes; which field; which prop-property. Only the scene/agent knows this. It
  stays here, in this blueprint.
- **Drupal-registry** — the `source_id` for a prop type, the `entity_field`/`field_property` block,
  and `variant_id`. This is deterministic and introspectable from UI Patterns 2's own plugin
  registry. **Do not hand-derive it** — the `designbook_ui_patterns` submodule emits it.

## Emit the block with the drush command

Given a ComponentNode (`{ component, props{}, slots{} }`, schema
`designbook/scenes/schemas.yml#/ComponentNode`), map each prop to its **scene-intent hint** and pass
the hints to the command in **one call** — it returns the whole `ui_patterns` block with the
registry half filled in:

```
{{ backend_cmd.ui_pattern_cmd }} '<set>:<component>' --props='<json>'
```

where `<json>` is `{ "props": { "<prop>": <hint> }, "slots": { … } }` and each `<hint>` is the
scene-intent for that prop:

| Scene-intent | Hint to pass |
|--------------|--------------|
| Literal value | `{ "literal": <value> }` (or the bare scalar) |
| Field reference `$fields.<field>` | `{ "field": "<et>:<bundle>:<field>" }` |
| A specific field property | `{ "field": "<et>:<bundle>:<field>:<property>" }` |
| A `[…]`-shaped token | `{ "token": "<token>" }` |
| The implicit `attributes` prop | `{ "literal": "" }` on the `attributes` prop |

The command derives the `source_id`, the `entity_field`/`field_property` structure, and `variant_id`
from the SDC prop type + UI Patterns' source registry. It never guesses which field or literal — that
is the scene-intent you pass in.

The `{ "field": … }` prop hint is for attribute-only/control values a prop legitimately carries (a
link `url`, a `heading_level`, a variant selector). Field-rendered content — incl. single-value
`title` and `link`/CTA — belongs in a **slot**, not a prop, per *Field-Rendered Content Maps to a
Slot, Not a Scalar Prop* in `../../components/rules/reference-field-semantics.md`.

## `component_id`

`'<set>:<component>'`, taken from the ComponentNode `component` (`provider:name`) — `<set>` is the
SDC provider (theme/module machine name), `<component>` the SDC name. This is scene-derived; pass it
as the command's first argument.

## `variant_id`

Scene-intent decides only *whether* a variant is selected and, for a field-driven selector, *which*
field. Whether the component even has variants, and the resolved `{source_id, source}` shape, come
from the command (`null` when the SDC declares no `variants:`).

## `slots`

`{}` when slot content is placed by the consuming path via field-level regions. Inline slot content
(e.g. a nested component's own slot) is passed under `slots` in the command input, following the same
per-prop scene-intent hints.

## Reference shape (illustrative command output)

For a component with a field-derived prop, a static prop, and variants, the command emits, e.g.:

```yaml
component_id: '<set>:<component>'
variant_id:
  source_id: select
  source:
    value: null
slots: {  }
props:
  attributes:
    source_id: attributes
    source:
      value: ''
  heading_level:
    source_id: entity_field
    source:
      derivable_context: 'field:<et>:<bundle>:<field>'
      'field:<et>:<bundle>:<field>':
        value:
          source_id: 'field_property:<et>:<bundle>:<field>'
  size:
    source_id: select
    source:
      value: lg
```

The exact `entity_field` leaf and `variant_id` shape are whatever the live registry returns — treat
the command output as authoritative, not this illustration.

## Reused by

This block is the shared UI Patterns 2 mechanism. It is consumed by `layout-builder-display.md`
(as `layout_settings.ui_patterns` and, nested, as a formatter's `settings.ui_patterns`) and by the
DESIGNBOOK-3 Display Builder path unchanged. Keep it free of Layout Builder / Display Builder keys
(`sections`, `field_block`, `enabled`, `allow_custom`, …).

````

### ctx:presenter-template-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/presenter-template.md)
````
---
type: data-mapping
name: presenter-template
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
---

# Blueprint: Presenter-Template (Twig)

Starting point for the Twig theme template `sync-to` writes for a `template: presenter` surface —
a form, pager, or exposed filter whose presentation Drupal produces only through theme markup, not
through UI-Patterns display config. The display config still binds the surface to its SDC (authored
by the matching display-unit pattern); this blueprint is the theme-markup *how* that config points
at. A UI-Patterns-bindable surface (`template: field-map`) needs no presenter-template.

## Where the file lands

The presenter-template is a Twig file in the active theme's templates directory, generated
alongside the surface's display config (not in the config-sync directory). Follow the theme's
normal template layout — group by surface **type** under `templates/<type>/`, not under a
`presenter/` folder, and use Drupal's **base theme-hook** name for the surface — unified, not
per-entity: `templates/forms/form.html.twig` for a form, `templates/views/views-view.html.twig` for
a view template, `templates/pager/pager.html.twig` for a pager. A pager uses the generic `pager`
hook — it is **not** view-template-specific. Reach for the double-hyphen **suggestion**
(`form--<form-id>.html.twig`, `views-view--<view-id>.html.twig`) only as the **exception**, when one
specific form or view genuinely needs its own template diverging from the base. Never name a form or
view presenter after an entity/node display.

## Fields render through their formatter; chrome is the Twig's job

A presenter-template renders the theme-methods-only chrome — the form element ordering and markup,
the pager, the exposed-filter form — and lets each field render through its own formatter output.
Field-rendered content (rich text, body, a single `title` or `link`/CTA) is emitted as its
rendered field markup, the same content that a read display places in a slot; the Twig never
re-stringifies a raw storage value into an escaped scalar. Control and attribute values (a variant
key, an icon id, a link `url` fed to an attribute) may be read directly.

## Per-surface guidance

- **Edit form (`form_mode`).** Render the form's render array through the theme layer, ordering
  and grouping the widgets as the design reference shows. The form display config stays minimal
  (its binding identity); the arrangement lives in this Twig.
- **Pager.** Render the pager markup (previous/next, page items) for the view's result set.
- **Exposed filter.** Render the exposed-filter form controls (the filter inputs and submit) as
  the reference shows them.

## Reference shape (illustrative)

```twig
{# templates/forms/form.html.twig — the base FORM theme-hook template (not an entity/node display)
   renders the form's children; the <form> element and its attributes come from the render element.
   Arrange the
   fields you place, then emit `form|without(...)` so the form's other children — the actions and
   the hidden CSRF / form_build_id / form_id inputs — are still output and the form submits. #}
<div class="presenter-form__body">
  {{ form.field_title }}
  {{ form.field_body }}
</div>
{{ form|without('field_title', 'field_body') }}
```

Never cherry-pick only the visible fields: dropping `form|without(...)` (or `{{ children }}`) drops
the hidden inputs and actions, and the form no longer submits. The concrete field names come from
the surface's render array at generation time; treat the arrangement here as a starting point a
theme may replace wholesale.

````

### ctx:layout-builder (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/layout-builder.md)
````
---
type: data-mapping
name: layout-builder
priority: 10
trigger:
  domain: data-mapping
---

# Blueprint: Layout Builder — Passthrough Mapping

Applies when `map-entity` runs for a view mode with `template: layout-builder` (i.e. a node bundle's full view mode that uses Layout Builder).

## Behavior

For Layout Builder full view mode, the sample data IS the component tree — no JSONata transformation is needed. The `layout_builder__layout` field on the node record contains an array of block_content entity references. Each entry is resolved to its full component tree via the standard entity node mechanism.

## JSONata Pattern

```jsonata
$.layout_builder__layout
```

## Rules

- Read `layout_builder__layout` directly — it is already a `ComponentNode[]`, no transformation needed
- Do NOT map, iterate, or restructure the entries — pass the array through as-is
- Do NOT generate a field-by-field JSONata mapping

## Config expansion (sync-to Scene sync)

Starting point for the config units `sync-to` emits when a Scene's page uses
`build_form: layout-builder` / view-mode `template: layout-builder`. A Scene resolves to
**config only** — never a content entity, never a content payload, never a backend content step:

- **Page layout config** — `core.entity_view_display.<et>.<bundle>.<full>` with Layout Builder
  **enabled** and `allow_custom: true`, and **empty** `sections` (see `layout-builder-display.md`).
  The page's visible section tree is a **per-entity content override** on
  `layout_builder__layout`, not default sections in this config file. Do not stuff
  `inline_block` / `block_serialized` / Scene props into display-config sections.
- **Layout-override field config** — `field.storage.<et>.layout_builder__layout` and
  `field.field.<et>.<bundle>.layout_builder__layout`. A real Layout-Builder config export
  includes them and `config:import` does not synthesise them, so both are emitted as units.
- **Block config** — the block-type config (and field/display units) for each `block_content`
  bundle the Scene uses, plus view config for any `views_block` / `block_plugin`, expanded
  through the standard content-bundle and config-slice rules.

The Scene still drives *which* bundles and views become config units (resolve-filter). The
section *composition* for a `layout-builder` template is not authored into the display YAML;
tests that need a reachable rendered page seed the override layout after import (fixture seed).
This is an overridable starting point — a project whose Layout-Builder export differs replaces it.

````

### ctx:form-display (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/form-display.md)
````
---
type: data-mapping
name: form-display
priority: 20
trigger:
  domain: data-mapping
  config_name: 'core.entity_form_display.*'
filter:
  backend: drupal
---

# Blueprint: Entity Form Display

Starting point for the `### to_drupal` pattern that authors a
`core.entity_form_display.<et>.<bundle>.<form_mode>` — the **editing** half of a bundle, reached over an
edit route (`/node/add/{type}`, `/node/{node}/edit`, `/user/{user}/edit`, `/user/register`,
`comment/reply/{et}/{entity}/{field}`). It is the form-side counterpart of `layout-builder-display.md`
(which authors the read-side `core.entity_view_display.*`).

This blueprint self-selects for `core.entity_form_display.*` config units via `trigger.config_name`;
`filter.backend: drupal` gates it to Drupal projects.

## Two paired config names

For a bundle's `form_modes`, `sync-to`'s resolve-filter emits up to two config names per mode:

- `core.entity_form_display.<et>.<bundle>.<form_mode>` — the display authored by this blueprint.
- `core.entity_form_mode.<et>.<form_mode>` — the mode *definition*, emitted only for **non-default**
  form modes (the `default` mode is built in). This blueprint's display references that mode; the
  definition unit is authored from its own name and `label` and must import before the display.

## Scope — the display binding, not the form presentation

This blueprint authors the **existence and binding** of a form display for a form mode, not its per-field
widget layout and not the form's presentation. Author the identity keys — `uuid`, `langcode: en`,
`status: true`, `id: <et>.<bundle>.<form_mode>`, `targetEntityType: <et>`, `bundle: <bundle>`,
`mode: <form_mode>` — and leave `content` and `hidden` empty: Drupal assigns each field its default widget
at runtime, so an empty form display imports cleanly and stays out of the field-selection /
widget-configuration semantics that are out of scope. Drupal computes `dependencies` at import; do not
hand-author the full dependency graph.

A form is a theme-methods-only surface, so its **presentation runs through a presenter-template**
(`template: presenter` on the form mode), generated as Twig theme markup — not authored here. This
config is only the minimal binding; hand-authoring form presentation into `core.entity_form_display.*`
is no longer the prescribed path.

## Reference shape (generic)

```yaml
uuid: <uuid>
langcode: en
status: true
dependencies: {  }
id: '<et>.<bundle>.<form_mode>'
targetEntityType: <et>
bundle: <bundle>
mode: <form_mode>
content: {  }
hidden: {  }
```

The `mode` value is `default` for the built-in edit form, or the non-default form-mode machine name
(e.g. `register`) whose paired `core.entity_form_mode.<et>.<form_mode>` definition carries the
human-readable `label`.

````

### ctx:field-map (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/field-map.md)
````
---
type: data-mapping
name: field-map
priority: 10
trigger:
  domain: data-mapping
---

# Blueprint: Field Map

Applies when a view mode declares `template: field-map`. Generates a JSONata expression that maps entity fields to a `ComponentNode[]` array.

## Pattern

```jsonata
(
  $fields := $;
  [
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:heading",
      "props": { "level": "h1" },
      "slots": { "text": $fields.title }
    },
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:text_block",
      "slots": { "content": $fields.field_body }
    },
    /* Reference field → entity node in slot */
    $fields.field_author ? {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:author_card",
      "slots": {
        "avatar": [
          { "entity": "user.user", "view_mode": "avatar", "record": 0 }
        ]
      }
    }
  ]
)
```

## Image Field Mapping

> See rule: [image-fields](../rules/image-fields.md) for hard constraints.

### `type: image` — direct ImageNode

When the data-model declares `type: image`, image data lives on the entity. Emit an ImageNode in the component's image slot:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
  "props": {
    "title": title,
    "text": field_teaser_text
  },
  "slots": {
    "image": [
      { "image": "leando_teaser", "alt": field_topic_image.alt }
    ]
  }
}
```

### `type: reference` — EntityNode

When the data-model declares `type: reference`, emit an EntityNode. The referenced entity renders itself via its own mapping:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
  "props": { "title": field_title },
  "slots": {
    "image": [
      { "entity": "media.image", "view_mode": "leando_teaser", "record": $number(field_image) - 1 }
    ]
  }
}
```

The record index is derived from the reference field value (entity ID) mapped to the sample data array index.

## Rules

- Output is a JSONata array expression returning `ComponentNode[]`
- Input (`$`) is the sample data record for this entity from `data.yml`
- Use dot notation for field access: `$fields.field_image.alt`
- Static values (no `$`): `"h1"`, `true`, `42`
- Provider prefix must be resolved at generation time: `DESIGNBOOK_COMPONENT_NAMESPACE:component-name`
- Reference fields (`type: reference`) emit `{ "entity": "<entity_type>.<bundle>", "view_mode": "...", "record": N }` nodes **as slot values of the wrapping component — NEVER in `props`** (the renderer resolves refs only inside slots and at top level; a ref in `props` is never resolved and renders empty — see scenes-constraints). The **only** exception is a pure delegation parent that has no wrapping markup of its own (e.g. a landing page stacking its paragraph sections), which MAY emit the refs as top-level array items.
- Image fields: see [image-fields rule](../rules/image-fields.md) — `type: image` → ImageNode in slot, `type: reference` → EntityNode in slot
- Conditional components: use `$fields.field_x ? { ... }` to omit when field is empty

## Supported Settings

- `primary_image_field` — name of the entity's primary image field (e.g. `field_topic_image`). Determines which field is mapped to the component's main image slot. The field's data-model type (`image` vs `reference`) decides the mapping pattern — see Image Field Mapping above.

````

### ctx:canvas (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/461188163343/data-mapping/blueprints/canvas.md)
````
---
type: data-mapping
name: canvas
priority: 10
trigger:
  domain: data-mapping
---

# Blueprint: Canvas — Passthrough Mapping

Applies when `map-entity` runs for a view mode with `template: canvas` (i.e. a `canvas_page` bundle's full view mode).

## Behavior

For Canvas full view mode, the sample data IS the component tree — no JSONata field mapping is needed. The `component_tree` field on the `canvas_page` record contains a nested component tree stored directly inline. No entity references, no block_content — all component data is self-contained.

## JSONata Pattern

```jsonata
(
  $record := $;
  $record.components
)
```

## Structure of `components`

The `components` field contains a nested `ComponentNode[]`. Each top-level entry is typically a **section** component. Sections use `slots` for nested content, with each slot containing either plain strings or arrays of nested `ComponentNode`.

Example structure in sample data:
```yaml
components:
  - component: "$COMPONENT_NAMESPACE:section"
    props:
      max_width: "lg"
      padding_top: "lg"
      columns: 1
    slots:
      column_1:
        - component: "$COMPONENT_NAMESPACE:hero"
          slots:
            content:
              - component: "$COMPONENT_NAMESPACE:rich-snippet"
                props:
                  headline: "Welcome to our site"
                  headline_level: "h1"
                  text: "Get started with our platform."
            actions:
              - component: "$COMPONENT_NAMESPACE:button"
                props:
                  variant: "primary"
                  content: "Get started"
```

## Rules

- Read the `components` field directly from the sample data record — this IS the component tree
- Do NOT generate a field-by-field JSONata mapping — just return `$record.components`
- There are NO entity references in Canvas — all component data is inline
- Canvas uses the entity type `canvas_page` (not `node`)
- Nested components carry their own `props` and `slots` inline — no further resolution needed
- Sections can have multiple levels of nesting (unlike Layout Builder which is flat)

## Config expansion (sync-to Scene sync)

Starting point for the config unit `sync-to` emits when a Scene's page uses
`build_form: canvas`. A Scene resolves to **config only** — never a `canvas_page` content
entity, never a content payload, never a backend content step:

- **Page layout config** — a single `page_layout` config entity carrying the Scene's component
  tree inline as its `components` field, exactly the nested `ComponentNode[]` shown above. It
  has its own route/URL; the visible content lives inline in this config, self-contained with
  no entity references.

Canvas emits only this one config unit. This is an overridable starting point — a project whose
Display-Builder page config differs replaces it.

````

## Steps

### Step: transform
Context: [ctx:cli-surface, ctx:sample-template-mapping, ctx:presenter-template, ctx:presenter-template-surfaces, ctx:media-image-styles, ctx:form-modes, ctx:field-type-constraints, ctx:drupal-views, ctx:drupal-config, ctx:block-decision, ctx:image-fields, ctx:field-cardinality, ctx:image_style, ctx:view, ctx:taxonomy_term, ctx:node, ctx:media, ctx:field-types, ctx:block_plugin, ctx:views, ctx:ui-patterns, ctx:presenter-template-2, ctx:layout-builder, ctx:form-display, ctx:field-map, ctx:canvas]

- [ ] transform — bb_team full display + view mode

  Instruction: task:transform

  #### Params
  ```yaml
  units:
    - config_name: core.entity_view_mode.bb_team.full
      entity_type: bb_team
      bundle: bb_team
    - config_name: core.entity_view_display.bb_team.bb_team.full
      entity_type: bb_team
      bundle: bb_team
  backend_cmd:
    schema_cmd: ddev drush designbook:config-schema
    validate_cmd: ddev drush designbook:config-validate
  config_sync_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-484-team-canonical-v/config/sync
  ```

  #### Contract
  ```yaml
  outputs:
    config-file:
      required: true
      schema:
        description: |
          The Drupal configuration YAML file written directly to the config-sync directory. Filename derives from the iteration binding unit.config_name. Shape is authoritative from the prepare-fetched schema (stored as prepared).
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-484-team-canonical-v/config/sync/{{ unit.config_name }}.yml
  ```

  #### Results
  <!-- pending -->

### Step: sync
Context: [ctx:cli-surface]

- [ ] sync — apply to bb-484 recipe-test world

  Instruction: task:sync

  #### Params
  ```yaml
  backend_cmd:
    import: ddev drush config:import --partial -y --source=/var/www/html/config/sync
  ```

  #### Contract
  ```yaml
  outputs:
    sync-result:
      required: true
      schema:
        $ref: '#/definitions/SyncResult'
      submission: data
      validators: []
  ```

  #### Results
  <!-- pending -->

### Step: outtake
Context: [ctx:cli-surface]

- [ ] outtake — config/data-model run, no scene

  Instruction: task:outtake

  #### Params
  ```yaml
  scene: ''
  backend_cmd: {}
  ```

  #### Contract
  ```yaml
  outputs:
    summary:
      required: true
      schema:
        $ref: '#/definitions/ExportSummary'
      submission: data
      validators: []
  ```

  #### Results
  <!-- pending -->

