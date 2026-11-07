# Plan: repair
<!-- digest: 794792adabf2c3cf986e3c92cc1fd208412cff59e509d972c172262528b5fda1 -->

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

- [x] polish — issue-001 body default

  Instruction: task:polish

  #### Params
  ```yaml
  issue:
    id: issue-001
    story_id: designbook-sections-projects-scenes--project-detail-board
    checkKey: frame--body-default
    severity: major
    description: 'The document''s base text keeps the browser default (16px/24px), so text without a role falls back to 16px: the Drupal <summary> "Locale settings" on /user/1/edit and "Cropped on creation." on /home. Set the body role once on body in the document defaults: font-size 16px -> 13px (--text-body), line-height 24px -> 20px (--text-body--line-height), font-weight 400 (--text-body--font-weight). html stays at the browser size, because the roles are in rem (Figma 68:89).'
    file_hint: css/tailwind.config.pcss
    check: AC-2
    source: BAKERS-54 verification
    properties:
      - property: font-size
        expected: 13px
        actual: 16px
      - property: line-height
        expected: 20px
        actual: 24px
  design_tokens:
    primitive:
      layout:
        spacing:
          base:
            $value: 4px
            $type: dimension
          space-1:
            $value: 4px
            $type: dimension
          space-2:
            $value: 8px
            $type: dimension
          space-3:
            $value: 12px
            $type: dimension
          space-4:
            $value: 16px
            $type: dimension
          space-5:
            $value: 20px
            $type: dimension
          space-6:
            $value: 24px
            $type: dimension
          space-8:
            $value: 32px
            $type: dimension
            $description: Space above a section heading.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:118'
                  - '68:135'
        row-h:
          $value: 34px
          $type: dimension
        control-h:
          $value: 28px
          $type: dimension
        radius:
          '5':
            $value: 5px
            $type: dimension
          '7':
            $value: 7px
            $type: dimension
          '10':
            $value: 10px
            $type: dimension
      style:
        color:
          neutral-50:
            $value: '#FAFAF7'
            $type: color
          neutral-100:
            $value: '#F1F0EA'
            $type: color
          neutral-200:
            $value: '#E9E7E0'
            $type: color
          neutral-300:
            $value: '#D6D3CA'
            $type: color
          neutral-400:
            $value: '#A5A6A3'
            $type: color
          neutral-500:
            $value: '#707888'
            $type: color
          neutral-600:
            $value: '#5B6169'
            $type: color
          neutral-700:
            $value: '#444A52'
            $type: color
          neutral-800:
            $value: '#2C3137'
            $type: color
          neutral-900:
            $value: '#14171A'
            $type: color
          violet-50:
            $value: '#F3F3FF'
            $type: color
          violet-100:
            $value: '#E8E8FF'
            $type: color
          violet-200:
            $value: '#D3D4FF'
            $type: color
          violet-300:
            $value: '#B2B5FA'
            $type: color
          violet-400:
            $value: '#858AF2'
            $type: color
          violet-500:
            $value: '#6268EB'
            $type: color
          violet-600:
            $value: '#494FE5'
            $type: color
          violet-700:
            $value: '#3D42BE'
            $type: color
          violet-800:
            $value: '#323795'
            $type: color
          violet-900:
            $value: '#292D70'
            $type: color
          red-50:
            $value: '#FFF3F1'
            $type: color
          red-100:
            $value: '#FFE2DD'
            $type: color
          red-200:
            $value: '#FFC5BB'
            $type: color
          red-300:
            $value: '#FF9D8D'
            $type: color
          red-400:
            $value: '#FF7463'
            $type: color
          red-500:
            $value: '#FF4E42'
            $type: color
          red-600:
            $value: '#D73D30'
            $type: color
          red-700:
            $value: '#A5301F'
            $type: color
          red-800:
            $value: '#7F291D'
            $type: color
          red-900:
            $value: '#602219'
            $type: color
          amber-50:
            $value: '#FFFBEB'
            $type: color
          amber-100:
            $value: '#FFF2C2'
            $type: color
          amber-200:
            $value: '#FFE58A'
            $type: color
          amber-300:
            $value: '#FFD451'
            $type: color
          amber-400:
            $value: '#FFC024'
            $type: color
          amber-500:
            $value: '#E3A008'
            $type: color
          amber-600:
            $value: '#B77C00'
            $type: color
          amber-700:
            $value: '#7A5600'
            $type: color
          amber-800:
            $value: '#604500'
            $type: color
          amber-900:
            $value: '#493600'
            $type: color
          teal-50:
            $value: '#F0FAF8'
            $type: color
          teal-100:
            $value: '#D9F2EE'
            $type: color
          teal-200:
            $value: '#B5E4DD'
            $type: color
          teal-300:
            $value: '#81CFC5'
            $type: color
          teal-400:
            $value: '#4BB9AE'
            $type: color
          teal-500:
            $value: '#329D93'
            $type: color
          teal-600:
            $value: '#278178'
            $type: color
          teal-700:
            $value: '#1F6B63'
            $type: color
          teal-800:
            $value: '#1B514C'
            $type: color
          teal-900:
            $value: '#173D39'
            $type: color
          indigo-50:
            $value: '#F3F5FF'
            $type: color
          indigo-100:
            $value: '#E6EBFF'
            $type: color
          indigo-200:
            $value: '#CDD7FE'
            $type: color
          indigo-300:
            $value: '#A8B9FC'
            $type: color
          indigo-400:
            $value: '#8197F8'
            $type: color
          indigo-500:
            $value: '#6078E5'
            $type: color
          indigo-600:
            $value: '#4A60C8'
            $type: color
          indigo-700:
            $value: '#3B4BA8'
            $type: color
          indigo-800:
            $value: '#303E82'
            $type: color
          indigo-900:
            $value: '#27325F'
            $type: color
        fontFamily:
          sans:
            $value: '''Spline Sans'', system-ui, -apple-system, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif'
            $type: fontFamily
            $description: Text face of the CI, observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '550:8978'
                  - '550:8992'
                  - '550:9016'
                  - '550:9024'
          mono:
            $value: '''Spline Sans Mono'', ui-monospace, ''SF Mono'', Menlo, Consolas, monospace'
            $type: fontFamily
            $description: Machine values only (keys, branches, IDs), observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '550:9021'
          display:
            $value: '''Bricolage Grotesque'', ''Spline Sans'', system-ui, sans-serif'
            $type: fontFamily
            $description: Page titles only, observed on the CI board at opsz 14.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '550:8977'
        fontSize:
          '11':
            $value: 11px
            $type: dimension
          '12':
            $value: 12px
            $type: dimension
          '13':
            $value: 13px
            $type: dimension
          '14':
            $value: 14px
            $type: dimension
            $description: Item title size.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:60'
                  - '550:9024'
          '16':
            $value: 16px
            $type: dimension
          '24':
            $value: 24px
            $type: dimension
        fontWeight:
          regular:
            $value: 400
            $type: fontWeight
          medium:
            $value: 500
            $type: fontWeight
          semibold:
            $value: 600
            $type: fontWeight
          bold:
            $value: 700
            $type: fontWeight
        lineHeight:
          '14':
            $value: 14px
            $type: dimension
            $description: Whole-pixel line height 14px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:81'
                  - '68:84'
          '16':
            $value: 16px
            $type: dimension
            $description: Whole-pixel line height 16px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:72'
                  - '68:75'
                  - '68:78'
          '20':
            $value: 20px
            $type: dimension
            $description: Whole-pixel line height 20px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:60'
                  - '68:63'
                  - '68:66'
          '21':
            $value: 21px
            $type: dimension
            $description: Whole-pixel line height 21px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:69'
          '22':
            $value: 22px
            $type: dimension
            $description: Whole-pixel line height 22px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:57'
          '28':
            $value: 28px
            $type: dimension
            $description: Whole-pixel line height 28px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:87'
          '30':
            $value: 30px
            $type: dimension
            $description: Whole-pixel line height 30px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:54'
          tight:
            $value: 1.2
            $type: number
          snug:
            $value: 1.3
            $type: number
          relaxed:
            $value: 1.5
            $type: number
          normal:
            $value: 1.45
            $type: number
        elevation:
          '1':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 4px
              spread: 0px
              opacity: 0.06
            $type: shadow
          '2':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 12px
              spread: 0px
              opacity: 0.1
            $type: shadow
          '3':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 24px
              spread: 0px
              opacity: 0.14
            $type: shadow
        lineWeight:
          hairline:
            $value: 1px
            $type: dimension
          emphasis:
            $value: 2px
            $type: dimension
        duration:
          '120':
            $value: 120ms
            $type: duration
          '200':
            $value: 200ms
            $type: duration
        focusRing:
          width:
            $value: 2px
            $type: dimension
          color:
            $value: '{primitive.style.color.violet-600}'
            $type: color
          offset:
            $value: 2px
            $type: dimension
            $description: Gap between a control and its focus ring.
            $extensions:
              designbook:
                provenance: addition
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '61:3240'
                note: Observed as the focus-keyboard interaction (2px ring, 2px gap); the tokens package does not project interactions.
        letterSpacing:
          tight:
            $value: '-0.01em'
            $type: dimension
            $description: Page title tracking (-1 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:54'
                  - '550:8977'
                note: Figma -1 % at 24px = -0.24px.
          snug:
            $value: '-0.005em'
            $type: dimension
            $description: Section title tracking (-0.5 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:57'
                  - '550:9016'
                note: Figma -0.5 % at 16px = -0.08px.
          wide:
            $value: 0.04em
            $type: dimension
            $description: Eyebrow tracking (4 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/c666d120267b60a5
                nodes:
                  - '68:81'
                note: Figma 4 % at 11px.
    semantic:
      color:
        app:
          $value: '{primitive.style.color.neutral-100}'
          $type: color
        surface:
          $value: '{primitive.style.color.neutral-50}'
          $type: color
        surface-2:
          $value: '{primitive.style.color.neutral-200}'
          $type: color
        surface-3:
          $value: '{primitive.style.color.neutral-300}'
          $type: color
        input:
          $value: '{primitive.style.color.neutral-100}'
          $type: color
        canvas:
          $value: '{primitive.style.color.neutral-200}'
          $type: color
        text:
          $value: '{primitive.style.color.neutral-800}'
          $type: color
        text-light:
          $value: '{primitive.style.color.neutral-600}'
          $type: color
        text-faint:
          $value: '{primitive.style.color.neutral-600}'
          $type: color
        title:
          $value: '{primitive.style.color.neutral-900}'
          $type: color
        primary:
          $value: '{primitive.style.color.violet-600}'
          $type: color
        chart-series-a:
          $value: '{primitive.style.color.violet-600}'
          $type: color
          $description: First comparison series (solid / circle).
        chart-series-b:
          $value: '{primitive.style.color.teal-500}'
          $type: color
          $description: Second comparison series (dashed / square).
        chart-series-c:
          $value: '{primitive.style.color.amber-500}'
          $type: color
          $description: Third comparison series (dotted / circle).
        chart-series-d:
          $value: '{primitive.style.color.indigo-400}'
          $type: color
          $description: Fourth comparison series (dash-dot / square).
        chart-series-e:
          $value: '{primitive.style.color.red-500}'
          $type: color
          $description: Fifth comparison series (sparse-dot / circle).
        chart-series-f:
          $value: '{primitive.style.color.neutral-600}'
          $type: color
          $description: Sixth comparison series (even-dash / square).
        chart-flow-new:
          $value: '{primitive.style.color.violet-600}'
          $type: color
          $description: Flow chart "new" line, points and end label. Observed as chart-series-a (#494fe5) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24.
        chart-flow-done:
          $value: '{primitive.style.color.teal-600}'
          $type: color
          $description: Flow chart "done" line, points and end label. Observed as the Figma proposal chart-outflow (#0d9488) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24; teal-600 is the closest existing primitive, so no new primitive is added.
        chart-flow-grows:
          $value: '{primitive.style.color.red-100}'
          $type: color
          $description: Flow chart fill where new exceeds done (backlog grows). Observed as the state-unassigned-tint colour.
        chart-flow-shrinks:
          $value: '{primitive.style.color.teal-100}'
          $type: color
          $description: Flow chart fill where done exceeds new (backlog shrinks). Observed as the state-running-tint colour.
        control-border:
          $value: '{primitive.style.color.neutral-500}'
          $type: color
        on-primary:
          $value: '#ffffff'
          $type: color
        border:
          $value: '{primitive.style.color.neutral-300}'
          $type: color
        border-2:
          $value: '{primitive.style.color.neutral-200}'
          $type: color
        link:
          $value: '{primitive.style.color.violet-600}'
          $type: color
        focus-ring:
          $value: '{primitive.style.focusRing.color}'
          $type: color
        state-unassigned:
          $value: '{primitive.style.color.red-500}'
          $type: color
        state-attention:
          $value: '{primitive.style.color.amber-500}'
          $type: color
        state-running:
          $value: '{primitive.style.color.teal-500}'
          $type: color
        state-lease:
          $value: '{primitive.style.color.indigo-400}'
          $type: color
        state-offline:
          $value: '{primitive.style.color.neutral-500}'
          $type: color
        type-feature:
          $value: '{primitive.style.color.indigo-400}'
          $type: color
        type-bug:
          $value: '{primitive.style.color.red-500}'
          $type: color
        type-chore:
          $value: '{primitive.style.color.amber-500}'
          $type: color
        state-unassigned-tint:
          $value: '{primitive.style.color.red-100}'
          $type: color
        state-attention-tint:
          $value: '{primitive.style.color.amber-100}'
          $type: color
        state-running-tint:
          $value: '{primitive.style.color.teal-100}'
          $type: color
        state-lease-tint:
          $value: '{primitive.style.color.indigo-100}'
          $type: color
        state-offline-tint:
          $value: '{primitive.style.color.neutral-200}'
          $type: color
        state-unassigned-ink:
          $value: '{primitive.style.color.red-700}'
          $type: color
        state-attention-ink:
          $value: '{primitive.style.color.amber-800}'
          $type: color
        state-running-ink:
          $value: '{primitive.style.color.teal-800}'
          $type: color
        state-lease-ink:
          $value: '{primitive.style.color.indigo-800}'
          $type: color
        state-ink:
          $value: '#000000'
          $type: color
          $description: Mode-invariant ink for text placed directly on a state-hue background (state.running/attention/unassigned/lease/offline base colors, not their tints). Those hues do not invert between light and dark mode, so an ink that DOES invert (like semantic.color.title) drops below WCAG contrast in one of the two modes; this token stays constant in both and keeps ≥4.5:1 against every state hue.
      typography:
        page-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.30}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Page title.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:54'
                - '550:8977'
        section-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.16}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.22}'
            letterSpacing: '{primitive.style.letterSpacing.snug}'
          $type: typography
          $description: Section heading; the CI board sets it semibold.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:57'
                - '550:9016'
        item-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.14}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Title of a list row or card.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:60'
                - '550:9024'
        body-strong:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Emphasised body text, such as a person's name.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:63'
        body:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Default text, also for otherwise unstyled text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:66'
        prose:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.21}'
          $type: typography
          $description: Running text, at most the prose width.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:69'
        label:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Field and property label.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:72'
                - '550:8992'
        meta:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Secondary information such as times and counts.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:75'
                - '550:8978'
                - '550:9011'
        data:
          $value:
            fontFamily: '{primitive.style.fontFamily.mono}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: 'Machine values: keys, branches, IDs.'
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:78'
                - '550:9021'
        eyebrow:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
            letterSpacing: '{primitive.style.letterSpacing.wide}'
          $type: typography
          $description: Uppercase group label above content.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:81'
        badge:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
          $type: typography
          $description: Badge and pill text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:84'
        stat-value:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.28}'
          $type: typography
          $description: Large statistic value.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:87'
      fontWeight:
        regular:
          $value: '{primitive.style.fontWeight.regular}'
          $type: fontWeight
        medium:
          $value: '{primitive.style.fontWeight.medium}'
          $type: fontWeight
        semibold:
          $value: '{primitive.style.fontWeight.semibold}'
          $type: fontWeight
        bold:
          $value: '{primitive.style.fontWeight.bold}'
          $type: fontWeight
      lineHeight:
        tight:
          $value: '{primitive.style.lineHeight.tight}'
          $type: number
        snug:
          $value: '{primitive.style.lineHeight.snug}'
          $type: number
        relaxed:
          $value: '{primitive.style.lineHeight.relaxed}'
          $type: number
        normal:
          $value: '{primitive.style.lineHeight.normal}'
          $type: number
      radius:
        xs:
          $value: '{primitive.layout.radius.5}'
          $type: dimension
        sm:
          $value: '{primitive.layout.radius.7}'
          $type: dimension
        md:
          $value: '{primitive.layout.radius.10}'
          $type: dimension
      shadow:
        shadow-1:
          $value: '{primitive.style.elevation.1}'
          $type: shadow
        shadow-2:
          $value: '{primitive.style.elevation.2}'
          $type: shadow
        shadow-3:
          $value: '{primitive.style.elevation.3}'
          $type: shadow
      transition:
        fast:
          $value: '{primitive.style.duration.120}'
          $type: duration
        base:
          $value: '{primitive.style.duration.200}'
          $type: duration
      spacing:
        inline-xs:
          $value: '{primitive.layout.spacing.space-1}'
          $type: dimension
          $description: Icon to text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:98'
                - '68:99'
        inline:
          $value: '{primitive.layout.spacing.space-2}'
          $type: dimension
          $description: Pills and buttons side by side.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:102'
                - '68:103'
        stack:
          $value: '{primitive.layout.spacing.space-3}'
          $type: dimension
          $description: Label to control, row content, below a heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:106'
                - '68:107'
                - '68:137'
        group:
          $value: '{primitive.layout.spacing.space-4}'
          $type: dimension
          $description: Field groups and card padding.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:110'
                - '68:111'
        gutter:
          $value: '{primitive.layout.spacing.space-6}'
          $type: dimension
          $description: Page edge from 1280px.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:114'
                - '68:115'
        section:
          $value: '{primitive.layout.spacing.space-8}'
          $type: dimension
          $description: Above a section heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:118'
                - '68:119'
                - '68:135'
    component:
      empty-state:
        icon:
          $value: 64px
          $type: dimension
          $description: Regular state illustration size, independent of layout density.
        compact-icon:
          $value: 24px
          $type: dimension
          $description: Compact state illustration size, independent of layout density.
      shell:
        offset:
          $value: var(--drupal-displace-offset-top, 0px)
          $type: dimension
        height:
          $value: calc(100dvh - var(--drupal-displace-offset-top, 0px))
          $type: dimension
      section:
        padding-y:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      grid:
        gap:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      container:
        max-width:
          $value: 1280px
          $type: dimension
      row:
        height:
          $value: '{primitive.layout.row-h}'
          $type: dimension
      control:
        height:
          $value: '{primitive.layout.control-h}'
          $type: dimension
      brand:
        compact:
          braid-width:
            $value: 24px
            $type: dimension
            $description: 'Width of the braid in the compact brand the gate chrome uses. Fixed: it does not follow the layout density.'
          braid-height:
            $value: 38.4px
            $type: dimension
            $description: Height of the braid in the compact brand, keeping the default braid's 40:64 proportion.
          wordmark-width:
            $value: 96px
            $type: dimension
            $description: Width of the wordmark in the compact brand; its height follows the SVG aspect ratio.
          gap:
            $value: 8px
            $type: dimension
            $description: Gap between braid and wordmark in the compact brand (24 + 8 + 96 = 128px combined).
      zone:
        gap:
          sm:
            $value: '{primitive.layout.spacing.space-3}'
            $type: dimension
            $description: 'Zone cell gap `sm`: the space-3 step (12px, 16px cozy).'
          md:
            $value: '{primitive.layout.spacing.space-5}'
            $type: dimension
            $description: 'Zone cell gap `md`, the default: the space-5 step (20px, 24px cozy).'
          lg:
            $value: '{primitive.layout.spacing.space-6}'
            $type: dimension
            $description: 'Zone cell gap `lg`: the space-6 step (24px, 32px cozy).'
      prose:
        max-width:
          $value: 620px
          $type: dimension
          $description: Maximum width of running text (72ch).
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/c666d120267b60a5
              nodes:
                - '68:152'
    themes:
      cozy:
        primitive:
          layout:
            spacing:
              base:
                $value: 6px
                $type: dimension
              space-1:
                $value: 8px
                $type: dimension
              space-2:
                $value: 12px
                $type: dimension
              space-3:
                $value: 16px
                $type: dimension
              space-4:
                $value: 20px
                $type: dimension
              space-5:
                $value: 24px
                $type: dimension
              space-6:
                $value: 32px
                $type: dimension
              space-8:
                $value: 40px
                $type: dimension
                $description: Cozy step after 32px.
                $extensions:
                  designbook:
                    provenance: addition
                    reference: 8c75dc05ca021b53/c666d120267b60a5
                    note: 'Intake decision 2026-11-04: continues the cozy scale 24, 32, 40.'
            row-h:
              $value: 40px
              $type: dimension
            control-h:
              $value: 36px
              $type: dimension
            radius:
              '5':
                $value: 5px
                $type: dimension
              '7':
                $value: 7px
                $type: dimension
              '10':
                $value: 10px
                $type: dimension
      dark:
        $extensions:
          darkMode: true
        semantic:
          color:
            app:
              $value: '{primitive.style.color.neutral-900}'
              $type: color
            surface:
              $value: '{primitive.style.color.neutral-800}'
              $type: color
            surface-2:
              $value: '{primitive.style.color.neutral-700}'
              $type: color
            surface-3:
              $value: '{primitive.style.color.neutral-600}'
              $type: color
            input:
              $value: '{primitive.style.color.neutral-700}'
              $type: color
            canvas:
              $value: '{primitive.style.color.neutral-900}'
              $type: color
            text:
              $value: '{primitive.style.color.neutral-100}'
              $type: color
            text-light:
              $value: '{primitive.style.color.neutral-400}'
              $type: color
            text-faint:
              $value: '{primitive.style.color.neutral-400}'
              $type: color
            title:
              $value: '{primitive.style.color.neutral-50}'
              $type: color
            primary:
              $value: '{primitive.style.color.violet-400}'
              $type: color
            chart-series-a:
              $value: '{primitive.style.color.violet-400}'
              $type: color
              $description: First comparison series (solid / circle).
            chart-series-b:
              $value: '{primitive.style.color.teal-400}'
              $type: color
              $description: Second comparison series (dashed / square).
            chart-series-c:
              $value: '{primitive.style.color.amber-400}'
              $type: color
              $description: Third comparison series (dotted / circle).
            chart-series-d:
              $value: '{primitive.style.color.indigo-300}'
              $type: color
              $description: Fourth comparison series (dash-dot / square).
            chart-series-e:
              $value: '{primitive.style.color.red-400}'
              $type: color
              $description: Fifth comparison series (sparse-dot / circle).
            chart-series-f:
              $value: '{primitive.style.color.neutral-400}'
              $type: color
              $description: Sixth comparison series (even-dash / square).
            chart-flow-new:
              $value: '{primitive.style.color.violet-400}'
              $type: color
              $description: Flow chart "new" line in dark mode (chart-series-a step).
            chart-flow-done:
              $value: '{primitive.style.color.teal-400}'
              $type: color
              $description: 'Flow chart "done" line in dark mode. Addition: the reference shows light mode only; teal-400 mirrors chart-series-b''s dark step.'
            chart-flow-grows:
              $value: '{primitive.style.color.red-800}'
              $type: color
              $description: Flow chart "backlog grows" fill in dark mode (state-unassigned-tint step).
            chart-flow-shrinks:
              $value: '{primitive.style.color.teal-800}'
              $type: color
              $description: Flow chart "backlog shrinks" fill in dark mode (state-running-tint step).
            control-border:
              $value: '{primitive.style.color.neutral-400}'
              $type: color
            on-primary:
              $value: '{primitive.style.color.neutral-900}'
              $type: color
            border:
              $value: '{primitive.style.color.neutral-600}'
              $type: color
            border-2:
              $value: '{primitive.style.color.neutral-700}'
              $type: color
            link:
              $value: '{primitive.style.color.violet-400}'
              $type: color
            focus-ring:
              $value: '{primitive.style.color.violet-400}'
              $type: color
            state-unassigned-tint:
              $value: '{primitive.style.color.red-800}'
              $type: color
            state-attention-tint:
              $value: '{primitive.style.color.amber-800}'
              $type: color
            state-running-tint:
              $value: '{primitive.style.color.teal-800}'
              $type: color
            state-lease-tint:
              $value: '{primitive.style.color.indigo-800}'
              $type: color
            state-offline-tint:
              $value: '{primitive.style.color.neutral-700}'
              $type: color
            state-unassigned-ink:
              $value: '{primitive.style.color.red-200}'
              $type: color
            state-attention-ink:
              $value: '{primitive.style.color.amber-200}'
              $type: color
            state-running-ink:
              $value: '{primitive.style.color.teal-200}'
              $type: color
            state-lease-ink:
              $value: '{primitive.style.color.indigo-200}'
              $type: color
        primitive:
          style:
            elevation:
              '1':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 4px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '2':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 12px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '3':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 24px
                  spread: 0px
                  opacity: 0
                $type: shadow
      harbor:
        $extensions:
          selector: '[data-skin="harbor"]'
        semantic:
          color:
            app:
              $value: '#edf3f7'
              $type: color
            surface:
              $value: '#ffffff'
              $type: color
            surface-2:
              $value: '#e3edf4'
              $type: color
            surface-3:
              $value: '#d8e5ef'
              $type: color
            input:
              $value: '#edf3f7'
              $type: color
            canvas:
              $value: '#edf3f7'
              $type: color
            text:
              $value: '#20384a'
              $type: color
            text-light:
              $value: '#52687a'
              $type: color
            text-faint:
              $value: '#52687a'
              $type: color
            title:
              $value: '#20384a'
              $type: color
            border:
              $value: '#b3c6d5'
              $type: color
            border-2:
              $value: '#e3edf4'
              $type: color
            primary:
              $value: '#155b91'
              $type: color
            link:
              $value: '#155b91'
              $type: color
            focus-ring:
              $value: '#155b91'
              $type: color
            control-border:
              $value: '#768897'
              $type: color
            on-primary:
              $value: '#ffffff'
              $type: color
      harbor-dark:
        $extensions:
          selector: '[data-skin="harbor"][data-mode="dark"]'
        semantic:
          color:
            app:
              $value: '#101c28'
              $type: color
            surface:
              $value: '#182938'
              $type: color
            surface-2:
              $value: '#203647'
              $type: color
            surface-3:
              $value: '#2a4356'
              $type: color
            input:
              $value: '#101c28'
              $type: color
            canvas:
              $value: '#101c28'
              $type: color
            text:
              $value: '#e3edf5'
              $type: color
            text-light:
              $value: '#b4c8d8'
              $type: color
            text-faint:
              $value: '#b4c8d8'
              $type: color
            title:
              $value: '#e3edf5'
              $type: color
            border:
              $value: '#58768d'
              $type: color
            border-2:
              $value: '#203647'
              $type: color
            primary:
              $value: '#8bcaff'
              $type: color
            link:
              $value: '#8bcaff'
              $type: color
            focus-ring:
              $value: '#8bcaff'
              $type: color
            control-border:
              $value: '#6f808e'
              $type: color
            on-primary:
              $value: '#101c28'
              $type: color
      grove:
        $extensions:
          selector: '[data-skin="grove"]'
        semantic:
          color:
            app:
              $value: '#edf2ea'
              $type: color
            surface:
              $value: '#fafcf7'
              $type: color
            surface-2:
              $value: '#e3ebdd'
              $type: color
            surface-3:
              $value: '#d8e3d0'
              $type: color
            input:
              $value: '#edf2ea'
              $type: color
            canvas:
              $value: '#edf2ea'
              $type: color
            text:
              $value: '#243d2b'
              $type: color
            text-light:
              $value: '#53664e'
              $type: color
            text-faint:
              $value: '#53664e'
              $type: color
            title:
              $value: '#243d2b'
              $type: color
            border:
              $value: '#b4c4ac'
              $type: color
            border-2:
              $value: '#e3ebdd'
              $type: color
            primary:
              $value: '#286040'
              $type: color
            link:
              $value: '#286040'
              $type: color
            focus-ring:
              $value: '#286040'
              $type: color
            control-border:
              $value: '#788873'
              $type: color
            on-primary:
              $value: '#ffffff'
              $type: color
      grove-dark:
        $extensions:
          selector: '[data-skin="grove"][data-mode="dark"]'
        semantic:
          color:
            app:
              $value: '#141e18'
              $type: color
            surface:
              $value: '#1d2c21'
              $type: color
            surface-2:
              $value: '#273b2c'
              $type: color
            surface-3:
              $value: '#334b38'
              $type: color
            input:
              $value: '#141e18'
              $type: color
            canvas:
              $value: '#141e18'
              $type: color
            text:
              $value: '#e7eee1'
              $type: color
            text-light:
              $value: '#c0ceba'
              $type: color
            text-faint:
              $value: '#c0ceba'
              $type: color
            title:
              $value: '#e7eee1'
              $type: color
            border:
              $value: '#617c63'
              $type: color
            border-2:
              $value: '#273b2c'
              $type: color
            primary:
              $value: '#98d7aa'
              $type: color
            link:
              $value: '#98d7aa'
              $type: color
            focus-ring:
              $value: '#98d7aa'
              $type: color
            control-border:
              $value: '#788476'
              $type: color
            on-primary:
              $value: '#141e18'
              $type: color
      ember:
        $extensions:
          selector: '[data-skin="ember"]'
        semantic:
          color:
            app:
              $value: '#f5eee5'
              $type: color
            surface:
              $value: '#fffaf3'
              $type: color
            surface-2:
              $value: '#eee2d3'
              $type: color
            surface-3:
              $value: '#e5d4c0'
              $type: color
            input:
              $value: '#f5eee5'
              $type: color
            canvas:
              $value: '#f5eee5'
              $type: color
            text:
              $value: '#443024'
              $type: color
            text-light:
              $value: '#6e5543'
              $type: color
            text-faint:
              $value: '#6e5543'
              $type: color
            title:
              $value: '#443024'
              $type: color
            border:
              $value: '#c9b39b'
              $type: color
            border-2:
              $value: '#eee2d3'
              $type: color
            primary:
              $value: '#93401f'
              $type: color
            link:
              $value: '#93401f'
              $type: color
            focus-ring:
              $value: '#93401f'
              $type: color
            control-border:
              $value: '#917d6d'
              $type: color
            on-primary:
              $value: '#ffffff'
              $type: color
      ember-dark:
        $extensions:
          selector: '[data-skin="ember"][data-mode="dark"]'
        semantic:
          color:
            app:
              $value: '#251b17'
              $type: color
            surface:
              $value: '#32251e'
              $type: color
            surface-2:
              $value: '#403025'
              $type: color
            surface-3:
              $value: '#513d2d'
              $type: color
            input:
              $value: '#251b17'
              $type: color
            canvas:
              $value: '#251b17'
              $type: color
            text:
              $value: '#f4e7d8'
              $type: color
            text-light:
              $value: '#d6beaa'
              $type: color
            text-faint:
              $value: '#d6beaa'
              $type: color
            title:
              $value: '#f4e7d8'
              $type: color
            border:
              $value: '#90745b'
              $type: color
            border-2:
              $value: '#403025'
              $type: color
            primary:
              $value: '#f6b78c'
              $type: color
            link:
              $value: '#f6b78c'
              $type: color
            focus-ring:
              $value: '#f6b78c'
              $type: color
            control-border:
              $value: '#8c7a6c'
              $type: color
            on-primary:
              $value: '#251b17'
              $type: color
      iris:
        $extensions:
          selector: '[data-skin="iris"]'
        semantic:
          color:
            app:
              $value: '#f2eef5'
              $type: color
            surface:
              $value: '#fdfbff'
              $type: color
            surface-2:
              $value: '#e9e1ef'
              $type: color
            surface-3:
              $value: '#dfd4e8'
              $type: color
            input:
              $value: '#f2eef5'
              $type: color
            canvas:
              $value: '#f2eef5'
              $type: color
            text:
              $value: '#3c2c48'
              $type: color
            text-light:
              $value: '#6a5579'
              $type: color
            text-faint:
              $value: '#6a5579'
              $type: color
            title:
              $value: '#3c2c48'
              $type: color
            border:
              $value: '#c1aecf'
              $type: color
            border-2:
              $value: '#e9e1ef'
              $type: color
            primary:
              $value: '#78418d'
              $type: color
            link:
              $value: '#78418d'
              $type: color
            focus-ring:
              $value: '#78418d'
              $type: color
            control-border:
              $value: '#8c7b98'
              $type: color
            on-primary:
              $value: '#ffffff'
              $type: color
      iris-dark:
        $extensions:
          selector: '[data-skin="iris"][data-mode="dark"]'
        semantic:
          color:
            app:
              $value: '#201925'
              $type: color
            surface:
              $value: '#2c2134'
              $type: color
            surface-2:
              $value: '#392b43'
              $type: color
            surface-3:
              $value: '#483752'
              $type: color
            input:
              $value: '#201925'
              $type: color
            canvas:
              $value: '#201925'
              $type: color
            text:
              $value: '#f0e7f5'
              $type: color
            text-light:
              $value: '#cebbda'
              $type: color
            text-faint:
              $value: '#cebbda'
              $type: color
            title:
              $value: '#f0e7f5'
              $type: color
            border:
              $value: '#846794'
              $type: color
            border-2:
              $value: '#392b43'
              $type: color
            primary:
              $value: '#d8aff1'
              $type: color
            link:
              $value: '#d8aff1'
              $type: color
            focus-ring:
              $value: '#d8aff1'
              $type: color
            control-border:
              $value: '#83758c'
              $type: color
            on-primary:
              $value: '#201925'
              $type: color
  ```

  #### Contract
  ```yaml
  outputs: {}
  ```

  #### Results
  <!-- done -->

