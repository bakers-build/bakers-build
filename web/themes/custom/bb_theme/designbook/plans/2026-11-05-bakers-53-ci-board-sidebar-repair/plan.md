# Plan: repair
<!-- digest: 7f971005c4e779f509fdb9fce875891be1387cd370dd8718a3b9c99b64add29a -->

## Schemas
```yaml
definitions:
  Issue:
    type: object
    required:
      - severity
      - description
    properties:
      id:
        type: string
      story_id:
        type: string
      checkKey:
        type: string
      severity:
        type: string
        enum:
          - critical
          - major
          - minor
      description:
        type: string
      file_hint:
        type: string
      check:
        type: string
      source:
        type: string
      details:
        type: string
      properties:
        type: array
        items:
          type: object
          properties:
            property:
              type: string
            expected:
              type: string
            actual:
              type: string
  Screenshot:
    type: object
    title: Screenshot
    description: |
      Atomic capture descriptor — one rendered image, identical shape on the reference (baseline) and story sides. Identity is (element, state, breakpoint). The on-disk filename is derived: `<breakpoint>--<element>--<state>.png`.
    required:
      - element
      - state
      - breakpoint
      - selector
    properties:
      element:
        type: string
        description: |
          Stable label for the comparison subject, used in filenames and scores. Name the rendered surface, not the capture area: entity stories use `entity-<entity_type>-<bundle>-<view_mode>` (for example `entity-paragraph-signage-full`, where `full` is the view mode), scene regions use names such as `scene-header` or `scene-footer`, and components use `component-<name>`. Use `selector: ""` to capture the isolated story root; do not encode that capture mode as `id: full`. A trailing `full` in an entity id is valid when it is the entity view mode.
      state:
        type: string
        description: rest | interaction-state name
      breakpoint:
        type: string
        description: |
          Viewport breakpoint identifier from `design-tokens.yml` (sm, md, lg, xl, ...). Determines the viewport width for capture/verify operations.
        examples:
          - sm
          - md
          - lg
          - xl
      threshold:
        type: number
        minimum: 0
        maximum: 1
        description: Maximum differing-pixel ratio accepted by this planned check; set during intake.
      selector:
        type: string
        description: |
          CSS selector for THIS side's capture; "" ⇒ isolated root / full. Reference side uses the Reference element's selector, story side uses the StoryMeta element's selector — context (which meta) disambiguates.
  StoryId:
    type: string
    description: |
      CSF story id (`sanitize(title)--sanitize(name)`). `sanitize` lowercases and turns spaces, slashes and other non-alphanumerics into `-` (CSF `toId`).

      SDC component stories: derive from frozen identity namespace + group + component + variant (see designbook-drupal `sdc-components` story-address rule). Example: `test-integration-drupal-shell-header--default`.

      Vue component stories: derive from title `Components/<Human Name>` (see designbook-vue `vue-components` story-address rule). Example: `components-book-card--default`.

      Scene files (`*.scenes.yml`): each scene export uses title `<group>/Scenes` and the scene display name, so the id is `sanitize(<group>/Scenes)--sanitize(<scene>)`. The stem is the `group` field, not the section file `id`. Example: group `Designbook/Sections/Wayfinding`, scene `signage` → `designbook-sections-wayfinding-scenes--signage`. The overview entry (section files only) uses title `<group>` and name `Overview`, so the id is `sanitize(<group>)--overview`. Example: group `Designbook/Sections/Wayfinding` → `designbook-sections-wayfinding--overview`.

      Entity stories use their own title prefixes. Copy retained ids from the live index when unchanged.
    examples:
      - test-integration-drupal-shell-header--default
      - test-integration-drupal-action-button--primary
      - components-book-card--default
      - designbook-sections-wayfinding-scenes--signage
      - designbook-sections-wayfinding--overview
  FrozenObservationQuery:
    type: object
    title: Bound observation cell
    additionalProperties: false
    required:
      - reference
      - package
      - subjects
      - states
      - views
      - fingerprint
    properties:
      reference:
        type: string
        description: Absolute directory of the published revision.
      package:
        type: string
        enum:
          - component
      subjects:
        type: array
        minItems: 1
        maxItems: 1
        items:
          type: string
        description: Exactly one observed subject for this comparison.
      states:
        type: array
        minItems: 1
        maxItems: 1
        items:
          type: string
        description: Exactly one observed state for this comparison.
      views:
        type: array
        minItems: 1
        maxItems: 1
        items:
          type: string
        description: Exactly one native view
        explicitly mapped to the other side.: null
      fingerprint:
        type: string
        pattern: ^[a-f0-9]{64}$
        description: Fingerprint returned by reference prepare.
  BreakpointId:
    type: string
    description: |
      Viewport breakpoint identifier from `design-tokens.yml` (sm, md, lg, xl, ...). Determines the viewport width for capture/verify operations.
    examples:
      - sm
      - md
      - lg
      - xl
  ElementId:
    type: string
    description: |
      Stable label for the comparison subject, used in filenames and scores. Name the rendered surface, not the capture area: entity stories use `entity-<entity_type>-<bundle>-<view_mode>` (for example `entity-paragraph-signage-full`, where `full` is the view mode), scene regions use names such as `scene-header` or `scene-footer`, and components use `component-<name>`. Use `selector: ""` to capture the isolated story root; do not encode that capture mode as `id: full`. A trailing `full` in an entity id is valid when it is the entity view mode.
  CompareArtifact:
    type: object
    title: Compare Artifact
    description: |
      Structured result of one screenshot compare check. One item is emitted per `(breakpoint, element, state)` triple so outtake can summarize visual review without rerunning capture or compare.
    required:
      - story_id
      - breakpoint
      - element
      - passed
    properties:
      story_id:
        $ref: '#/definitions/StoryId'
      breakpoint:
        $ref: '#/definitions/BreakpointId'
      element:
        $ref: '#/definitions/ElementId'
      state:
        type: string
        default: rest
        description: Interaction state compared (see `#/CaptureState`). `rest` = default.
      passed:
        type: boolean
        description: True when this compare check passed within its configured threshold.
      diff_path:
        type: string
        description: Path to the diff/report artifact for this check when one was written.
      screenshot_path:
        type: string
        description: Path to the captured Storybook screenshot used in the compare.
      reference_path:
        type: string
        description: Path to the reference screenshot used in the compare.
      diff_percent:
        type: number
        description: Measured visual deviation ratio for this check when available.
      severity:
        type: string
        enum:
          - pass
          - minor
          - major
          - critical
        description: |
          Deterministic severity from the compare-images CLI, derived from pixel ratio, spatial extent, and dimension drift together. Carried onto the artifact so outtake scores by severity, not pixel ratio alone — a small but widely-spread shift (low diff_percent, high extent) still lands as `major`/`critical` here.
```

## Context
### task:polish (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/polish.md)
````
---
name: designbook:design:polish
title: Polish {{ issue.id }}
description: '{{ issue.description }}'
trigger:
  steps:
    - polish
priority: 50
params:
  type: object
  required:
    - issue
  properties:
    issue:
      type: object
      $ref: ../schemas.yml#/Issue
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      type: object
---

# Polish

Fixes a single consolidated issue from the triage stage. Each polish task receives one issue with actionable description and concrete values.

## Parameters from the repair intake

| Field | Description |
|---|---|
| `issue.id` | Issue ID (e.g. `issue-001`) |
| `issue.story_id` | Story identifier |
| `issue.checkKey` | Check key (e.g. `sm--header`, `xl--markup`) |
| `issue.severity` | `critical` or `major` |
| `issue.description` | Actionable work instruction from triage |
| `issue.file_hint` | Primary file to edit |
| `issue.properties` | Array of `{property, expected, actual}` (extraction issues) |

## Step 0: Inspection (Before Any Fix)

Before applying any fix, inspect what exists:

1. **Read the component files** referenced by `issue.file_hint` and any related templates
2. **Read the scene YAML** associated with the affected story (`issue.story_id`)
3. **Open the Storybook URL** and verify current rendering state — understand what the issue looks like before changing code

Only proceed to the fix after completing the inspection.

## Step 1: Understand the Issue

Read the `issue.description` — it contains:
- Which element is affected
- What properties need to change (with VON → NACH values)
- Which file to edit

If `issue.properties` array is present, use the concrete values directly.
If `issue.file_hint` is present, start there.

## Step 2: Rule Compliance Check

Before applying any fix, verify it does not contradict any loaded rules for the current stage.

## Step 3: Fix Code

Edit the file(s) to resolve the issue. Keep changes minimal and focused.

**Change scope:**

| In scope | Out of scope |
|----------|-------------|
| Component templates | `design-tokens.yml` (requires tokens workflow) |
| Scene definitions (`*.scenes.yml`) | Workflow configuration |
| Story files (`*.story.yml`) | Component schema structure |
| CSS framework output files | |

When CSS output values are changed to match the reference, the polish report MUST include a reconciliation note: "CSS output values adjusted — reconcile with `design-tokens.yml` via tokens workflow."

## Step 4: Mark Task Done

Mark the workflow task as done. The task status IS the issue status — no separate issue tracking needed.

## Output

```
## Polish: {{ issue.description }}

Fixed: {{ issue.description }}
File: {{ issue.file_hint }}
Changes: fontSize 14px → 48px, fontFamily 'Nunito Sans' → 'Inter'
```

````

### ctx:cli-surface (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/workflow/rules/cli-surface.md)
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

### ctx:playwright-capture (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/playwright-capture.md)
```
---
name: designbook:design:playwright-capture
trigger:
  steps: [capture, re-capture, capture-backend, re-capture-backend, compare, re-compare, polish, polish-config]
---

# Screenshot capture

Write each declared PNG with `_debo reference capture-image --reference <revision-dir> --path <png>
--url <url> --selector <css-locator> --width <px> --session <name> [--steps <json>]
[--prelude <file>]`. Empty selector is the full page except on a
Storybook story, where the full subject is `#storybook-root`. `--steps`
reaches a non-rest state. A prelude makes the page observable before the
shot — dismissing consent, closing widgets, forcing lazy content.

A whole element × state × breakpoint matrix uses `_debo capture matrix
<meta.yml> --url <url> --out <dir>`. After template, scene or CSS writes,
restart with `_debo storybook start --force` before recapture.

Capture directly to the absolute screenshot path in the saved task
(`submission: direct`). Inspect the resulting image: the selected subject,
requested state and relevant overlay must be visible. On compare, recapture
and polish, a selector with no matches skips with a warning. Create the
output directory before the command. A nonzero CLI exit is the diagnosis.

```

### ctx:component-contract-index (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/component-contract-index.md)
```
---
trigger:
  steps: [write-component, refresh-components, validate, design-component, polish]
  domain: components
---

# Component Contract Index

A single cross-cutting index for the constraints that govern component work across
its full lifecycle — creation, variant stories, entity mapping, and review/polish.
Each detailed constraint remains owned by its own rule file; this index exists so
that inventory and review tooling can cite a stable ID instead of re-deriving the
constraint from prose each time.

| ID | Contract |
| --- | --- |
| CCI-01 | [Variant transport](variant-transport.md): display variants are declared at the top-level `variants:` and never re-declared as a `variant`/`*_variant` prop. |
| CCI-02 | [Typed component boundary](typed-component-boundary.md): a component varies only through named typed props or declared variants — never through an open-ended styling prop. |
| CCI-03 | [Presenter composition](presenter-composition.md): the smallest existing component is reused before new markup is introduced; presenters map data, branch, loop, and compose components — they do not own visible markup. |
| CCI-04 | [Entity reference rendering](entity-reference-rendering.md): referenced entities render as their own render node in a slot, never inlined as child field values. |

Each owning rule file's own `trigger`/`filter` governs when it loads; this index
adds no additional activation condition beyond citing the stable ID. A project's
CSS-framework integration adds its own styling-utility contract under its own
`rules/` — this index does not duplicate framework-specific styling constraints.

These constraints apply at component creation, variant-story creation, entity
mapping, component/screen work, and final polish/review alike. The detailed
owner files load at their own declared triggers; this index is the discoverability
boundary across that full set of stages.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| CCI-05 | error | Every ID in this index's table links to a rule file that actually exists | design/rules |
| CCI-06 | warning | No contract listed here duplicates prose already owned by its linked rule file (this index only cites, it never re-states the constraint) | body |


```

## Steps

### Step: polish
Context: [ctx:cli-surface, ctx:playwright-capture, ctx:component-contract-index]

- [x] polish — polish — issue-001 shell scene avatars

  Instruction: task:polish

  #### Params
  ```yaml
  issue:
    id: issue-001
    story_id: designbook-sections-projects-scenes--project-detail-board
    checkKey: desktop--sidebar-light, desktop--sidebar-dark
    severity: minor
    description: 'Shell scene sidebar avatars: Team A color running (avatar-a) → attention (avatar-b, Figma #CFE69A light / #BFE07A dark) in scenes shell and shell collapsed; account CW color lease (avatar-c) → running (avatar-a, Figma #F4AFC0) in scenes shell, shell collapsed and account-shell, matching CW on the board cards. Nothing else in the file changes. File: designbook/design-system/design-system.scenes.yml. States: ci-light, ci-dark.'
    file_hint: designbook/design-system/design-system.scenes.yml
    properties:
      - property: Team A color (shell, shell collapsed)
        expected: attention
        actual: running
      - property: account CW color (shell, shell collapsed, account-shell)
        expected: running
        actual: lease
  ```

  #### Contract
  ```yaml
  outputs: {}
  ```

  #### Results
  <!-- done -->

