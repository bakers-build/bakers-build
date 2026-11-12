# Plan: extract-reference
<!-- digest: 2210db0bd9b1fcd21b0743165031064967efeb8dc3279b03d0e3195aa06b868f -->

## Schemas
```yaml
definitions:
  ObservationSource:
    type: object
    title: Source provenance
    additionalProperties: false
    required:
      - kind
      - identity
      - revision
    properties:
      kind:
        type: string
        minLength: 1
        description: Opaque source kind declared by its integration skill.
      identity:
        type: string
        minLength: 1
        description: Stable source identity supplied by the skill; may be a URL or file identity.
      revision:
        type:
          - string
          - 'null'
        description: Observed source version
        or null when unavailable.: null
  ReferenceFolder:
    type: string
    description: |
      Path to a scene's verification material — contains one source dump per declared state (`extract--<state>.json`), `meta.yml`, and one screenshot per view/element/state cell, named `<view>--<element>--<state>.png`. The leading segment is the view id the metadata declares; a view carries a breakpoint only where that mapping is established, and the file name stays on the view.
    examples:
      - $DESIGNBOOK_DATA/references/hero
      - /tmp/refs/article
  SourceDump:
    type: object
    title: Stored source extract
    description: |
      One browser dump for one state of a capture revision (`extract--<state>.json`): one page load, in one session, at that state. Agents consume it through `reference save` stdout, `reference inspect` and `reference query`, never by opening the file. Walker-specific extra keys on the dump object are allowed.
    additionalProperties: true
    required:
      - source_kind
      - source_ref
      - nodes
    properties:
      source_kind:
        type: string
        minLength: 1
        description: Walker identity such as url-dom.
      source_ref:
        type: string
        minLength: 1
        description: Observed source identity, typically the URL.
      captured_at:
        type: string
        description: Capture timestamp.
      adapter_version:
        type: string
        description: Walker version string.
      nodes:
        type: array
        description: Observed nodes with native locators, boxes and styles. Extra walker keys are allowed.
        items:
          type: object
          additionalProperties: true
          description: One captured node. Keys include id, kind, locator, box and style.
  ElementId:
    type: string
    description: |
      Stable label for the comparison subject, used in filenames and scores. Name the rendered surface, not the capture area: entity stories use `entity-<entity_type>-<bundle>-<view_mode>` (for example `entity-paragraph-signage-full`, where `full` is the view mode), scene regions use names such as `scene-header` or `scene-footer`, and components use `component-<name>`. Use `selector: ""` to capture the isolated story root; do not encode that capture mode as `id: full`. A trailing `full` in an entity id is valid when it is the entity view mode.
  ObservationLocator:
    type: object
    title: Native source locator
    additionalProperties: false
    required:
      - kind
      - value
    properties:
      kind:
        type: string
        minLength: 1
        description: Integration-defined locator kind such as css or figma-node.
      value:
        type: string
        minLength: 1
        description: Exact native identity; a Figma node is not a CSS selector.
  BreakpointId:
    type: string
    description: |
      Viewport breakpoint identifier from `design-tokens.yml` (sm, md, lg, xl, ...). Determines the viewport width for capture/verify operations.
    examples:
      - sm
      - md
      - lg
      - xl
  ReferenceStructure:
    type: object
    title: Observed source structure
    additionalProperties: false
    required:
      - roots
      - nodes
    description: Observed hierarchy with native locators. Target component structure belongs in the plan.
    properties:
      roots:
        type: array
        minItems: 1
        uniqueItems: true
        description: Ordered observed root node IDs.
        items:
          type: string
          minLength: 1
      nodes:
        type: array
        minItems: 1
        description: Reachable observed nodes; IDs and ordered children preserve source relationships.
        items:
          type: object
          additionalProperties: false
          required:
            - id
            - kind
            - locator
            - children
          properties:
            id:
              type: string
              minLength: 1
              description: Unique local observed node ID.
            kind:
              type: string
              minLength: 1
              description: Observed native or normalized node category.
            locator:
              $ref: '#/definitions/ObservationLocator'
            children:
              type: array
              uniqueItems: true
              description: Ordered child node IDs, empty for leaves.
              items:
                type: string
                minLength: 1
  ReferenceMaterial:
    type: object
    title: Observed properties
    description: Measured source values keyed by their native or normalized property names. Contains observed facts, not planned implementation decisions.
    additionalProperties: true
  ReferenceDependencies:
    type: object
    title: Exact observation dependencies
    additionalProperties: false
    required:
      - parent_ids
      - asset_ids
      - font_families
    properties:
      parent_ids:
        type: array
        uniqueItems: true
        description: Exact observed ancestor layout IDs.
        items:
          type: string
          minLength: 1
      asset_ids:
        type: array
        uniqueItems: true
        description: Exact images[].url identities required by this sample.
        items:
          type: string
          minLength: 1
      font_families:
        type: array
        uniqueItems: true
        description: Exact fonts[].family identities required by this sample.
        items:
          type: string
          minLength: 1
  ReferenceSample:
    type: object
    title: Observed subject condition
    additionalProperties: false
    required:
      - view
      - state
      - structure
      - observations
      - dependencies
      - unavailable
    properties:
      view:
        type: string
        minLength: 1
        description: Exact selected view identity.
      state:
        type: string
        minLength: 1
        description: Exact observed state identity.
      breakpoint:
        $ref: '#/definitions/BreakpointId'
      structure:
        $ref: '#/definitions/ReferenceStructure'
      observations:
        type: object
        additionalProperties: false
        description: Measured facts only; raw unmapped properties remain available for targeted inspection.
        properties:
          layout:
            $ref: '#/definitions/ReferenceMaterial'
          typography:
            type: array
            description: Observed text treatments.
            items:
              $ref: '#/definitions/ReferenceMaterial'
          content:
            type: array
            description: Observed content in reading order.
            items:
              $ref: '#/definitions/ReferenceMaterial'
          interactions:
            type: array
            description: Observed interaction evidence; absent states are recorded as unavailable.
            items:
              $ref: '#/definitions/ReferenceMaterial'
          properties:
            $ref: '#/definitions/ReferenceMaterial'
      dependencies:
        $ref: '#/definitions/ReferenceDependencies'
      unavailable:
        type: array
        description: Explicit observation gaps; a required gap blocks publication.
        items:
          type: object
          additionalProperties: false
          required:
            - property
            - reason
            - required
          properties:
            property:
              type: string
              minLength: 1
              description: Missing observation identity.
            reason:
              type: string
              minLength: 1
              description: Why the selected source cannot supply it.
            required:
              type: boolean
              description: Whether the agreed capture scope requires this information.
  ReferenceSubject:
    type: object
    title: Exact observed subject
    additionalProperties: false
    required:
      - id
      - locator
      - samples
    properties:
      id:
        $ref: '#/definitions/ElementId'
      locator:
        $ref: '#/definitions/ObservationLocator'
      samples:
        type: array
        minItems: 1
        description: One sample for each selected view and state; duplicate cells are invalid.
        items:
          $ref: '#/definitions/ReferenceSample'
  ReferenceParentSample:
    type: object
    title: Observed ancestor condition
    additionalProperties: false
    required:
      - view
      - state
      - layout
      - asset_ids
      - font_families
    properties:
      view:
        type: string
        minLength: 1
        description: Exact selected view identity.
      state:
        type: string
        minLength: 1
        description: Exact observed state identity.
      layout:
        $ref: '#/definitions/ReferenceMaterial'
      asset_ids:
        type: array
        uniqueItems: true
        description: Exact images[].url dependencies.
        items:
          type: string
          minLength: 1
      font_families:
        type: array
        uniqueItems: true
        description: Exact fonts[].family dependencies.
        items:
          type: string
          minLength: 1
  ReferenceParent:
    type: object
    title: Observed ancestor layout
    additionalProperties: false
    required:
      - id
      - samples
    properties:
      id:
        type: string
        minLength: 1
        description: Exact observed dependency identity.
      parent:
        type: string
        minLength: 1
        description: Exact ancestor dependency identity when needed.
      samples:
        type: array
        minItems: 1
        description: Observed ancestor layout for the selected view and state.
        items:
          $ref: '#/definitions/ReferenceParentSample'
  ObservationCapture:
    type: object
    title: Captured visual evidence
    additionalProperties: false
    required:
      - subject
      - view
      - state
      - path
      - width
      - height
    properties:
      subject:
        $ref: '#/definitions/ElementId'
      view:
        type: string
        minLength: 1
        description: Exact selected view identity.
      state:
        type: string
        minLength: 1
        description: Exact observed state identity.
      path:
        type: string
        minLength: 1
        description: Screenshot path relative to the CLI-owned revision directory.
      width:
        type: number
        exclusiveMinimum: 0
        description: Actual image width in pixels.
      height:
        type: number
        exclusiveMinimum: 0
        description: Actual image height in pixels.
  DesignReference:
    type: object
    title: Shared captured observations
    additionalProperties: false
    description: Source and actual observations only. The design plan separately owns target structure, styling and implementation decisions.
    required:
      - subjects
      - parents
      - images
      - fonts
      - captures
    properties:
      subjects:
        type: array
        minItems: 1
        description: Selected subjects, each with observations for its declared views and states.
        items:
          $ref: '#/definitions/ReferenceSubject'
      parents:
        type: array
        description: Observed ancestor layout dependencies; empty when none.
        items:
          $ref: '#/definitions/ReferenceParent'
      captures:
        type: array
        minItems: 1
        description: Exact screenshot associations for selected subject, view and state cells.
        items:
          $ref: '#/definitions/ObservationCapture'
      fonts:
        type: array
        description: |
          Web fonts the reference renders text with. Each family that is not a Google/system font must be downloaded — see `files[]`. Metadata alone (family/weights) is insufficient: a self-hosted family with no `files[]` leaves downstream CSS with an unresolvable family and a silent serif fallback. This is the concrete failure mode `files[]` exists to prevent.
        items:
          type: object
          required:
            - family
            - source
          properties:
            family:
              type: string
              description: Exact font-family name as used in @font-face / CSS (e.g. "Reef", "Inter").
            source:
              type: string
              description: |
                Where the font is served from. `self-hosted` and `adobe`/`other` families MUST be downloaded into `files[]`; `google` also needs local binaries for offline execution; `system` needs no download.
              enum:
                - self-hosted
                - google
                - adobe
                - system
                - other
            weights:
              type: array
              items:
                type: number
              description: Distinct numeric weights observed (e.g. [400, 700]).
            styles:
              type: array
              items:
                type: string
              description: Distinct styles observed (e.g. [normal, italic]).
            files:
              type: array
              description: |
                Downloaded font binaries for this family. Required when `source` is not `system`; frozen packages require offline binaries. Empty only when the font could not be downloaded.
              items:
                type: object
                required:
                  - local_path
                properties:
                  weight:
                    type: number
                    description: Weight this file provides.
                  style:
                    type: string
                    description: Style this file provides (normal, italic).
                    examples:
                      - normal
                      - italic
                  format:
                    type: string
                    description: Font format.
                    examples:
                      - woff2
                      - woff
                      - ttf
                  src_url:
                    type: string
                    description: Resolved absolute URL the binary was downloaded from.
                  local_path:
                    type: string
                    description: |
                      Path (relative to the reference folder, typically under `{assets_dir}/fonts/`) where the binary was written.
                    examples:
                      - assets/fonts/Reef-Regular.woff2
      images:
        type: array
        description: Static images and brand assets detected in the design reference (logos, icons, illustrations).
        items:
          type: object
          required:
            - url
            - role
          properties:
            reference_path:
              type: string
              minLength: 1
              description: Downloaded asset path relative to the reference folder. Required by offline packages that reference this image's exact url identity; distinct from its public local_path URL.
              examples:
                - assets/logo.svg
            url:
              type: string
              description: Source URL or path of the image.
            role:
              type: string
              description: Visual role of the image.
              enum:
                - logo
                - icon
                - hero
                - background
                - illustration
                - avatar
                - other
            alt:
              type: string
              description: Alt text or accessible label if present.
            location:
              type: string
              description: 'Where the image appears: header, footer, main, sidebar.'
            width:
              type: string
              description: Rendered width (px or CSS value).
            height:
              type: string
              description: Rendered height (px or CSS value).
            local_path:
              type: string
              description: |
                Path (relative to the Storybook `public/` or configured static dir) where the asset has been downloaded. Empty if the asset could not be downloaded or is decorative-only. Scenes and components MUST reference this path (e.g. `<img src="/logo.svg">`) instead of text placeholders when it is set.
              examples:
                - /logo.svg
                - /assets/partner-bmbf.svg
  CaptureFile:
    title: Captured binary artifact
    description: Declared direct screenshot or asset file; plan done records its exact file integrity.
  ObservationView:
    type: object
    title: Selected source view
    additionalProperties: false
    required:
      - id
      - width
      - height
    properties:
      id:
        type: string
        minLength: 1
        description: Stable selected viewport or frame identity.
      width:
        type: number
        exclusiveMinimum: 0
        description: Capture width in pixels.
      height:
        type: number
        exclusiveMinimum: 0
        description: Capture height in pixels.
      breakpoint:
        $ref: '#/definitions/BreakpointId'
        description: Explicit responsive mapping when established during intake.
  ObservationElement:
    type: object
    title: Observed subject coverage
    additionalProperties: false
    required:
      - id
      - locator
      - states
      - views
    properties:
      id:
        $ref: '#/definitions/ElementId'
      locator:
        $ref: '#/definitions/ObservationLocator'
      states:
        type: array
        minItems: 1
        description: |
          Explicit observed states; source-specific replay details belong in the source workflow. Each state has its own dump `extract--<name>.json`, so a state name identifies one page load in one session across the whole revision and cannot carry different observers on different subjects.
        items:
          type: object
          additionalProperties: false
          required:
            - name
            - session
          properties:
            name:
              type: string
              minLength: 1
              description: Exact state identity.
            session:
              type: string
              minLength: 1
              description: |
                Who observed this state. `anonymous` is the reserved name for a capture taken without a stored session; any other name must be a key of `sessions:` in designbook.config.yml, which resolves it to a Playwright storage state. Required so a published revision states its observer instead of defaulting to anonymous in silence.
              examples:
                - anonymous
                - member
                - admin
      views:
        type: array
        minItems: 1
        description: Selected views; no implicit frame-to-breakpoint mapping.
        items:
          $ref: '#/definitions/ObservationView'
  Reference:
    type: object
    title: Captured observation metadata
    additionalProperties: false
    description: One source-neutral snapshot shared by reference and actual Storybook capture. Publication identity is supplied by the CLI binding manifest.
    required:
      - source
      - role
      - elements
      - assets_dir
    properties:
      source:
        $ref: '#/definitions/ObservationSource'
      role:
        type: string
        enum:
          - reference
          - actual
      elements:
        type: array
        minItems: 1
        description: Selected subjects with their observed state and view coverage.
        items:
          $ref: '#/definitions/ObservationElement'
      prelude_digest:
        type: string
        pattern: ^[a-f0-9]{64}$
        description: |
          SHA-256 of the prelude module that prepared every pass of this revision. Absent when the capture used no prelude. Fixing it here means a later prelude edit cannot silently redefine what was observed.
      assets_dir:
        type: string
        const: assets
        description: Revision-relative asset directory.
```

## Context
### task:observe-storybook (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/observe-storybook.md)
```
---
title: Observe storybook
trigger:
  steps: [observe-storybook]
domain: [references]
params:
  type: object
  required: [source, reference_folder, state, session]
  properties:
    source:
      $ref: ../schemas.yml#/ObservationSource
    reference_folder:
      $ref: ../schemas.yml#/ReferenceFolder
    state:
      type: string
      minLength: 1
      description: >
        The one observed state this dump records. A dump is one page load, so a
        revision holds one per declared state and one task writes one of them.
      examples: [rest, menu-open]
    session:
      type: string
      minLength: 1
      description: >
        Who observes this state. `anonymous` is the reserved name for a pass
        without a stored session; any other name is a key of `sessions:` in the
        project configuration.
      examples: [anonymous, member, admin]
result:
  type: object
  required: [extract]
  properties:
    extract:
      path: "{{ reference_folder }}/extract--{{ state }}.json"
      submission: direct
      $ref: ../schemas.yml#/SourceDump
---

# Observe storybook

Source dump for one selected state of the fixed Storybook scope, written
with `reference save`.
Catalogue JSON is CLI stdout. Required missing evidence is explicit.

```

### task:capture-image (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/capture-image.md)
```
---
title: Capture selected PNG image
trigger:
  steps: [capture-image]
domain: [references]
params:
  type: object
  required: [file_path]
  properties:
    file_path:
      type: string
      description: Absolute CLI-owned revision path for one selected PNG screenshot.
result:
  type: object
  required: [file]
  properties:
    file:
      path: "{{ file_path }}"
      submission: direct
      validators: [image]
      $ref: ../schemas.yml#/CaptureFile
---

# Capture selected PNG image

A valid selected PNG screenshot of the observed subject.
Its observation association is declared separately in the shared extract.

```

### task:capture-file (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/capture-file.md)
```
---
title: Capture selected evidence file
trigger:
  steps: [capture-file]
domain: [references]
params:
  type: object
  required: [file_path]
  properties:
    file_path:
      type: string
      description: Absolute CLI-owned revision path for one selected asset file, such as a font, SVG, JPEG or PNG.
result:
  type: object
  required: [file]
  properties:
    file:
      path: "{{ file_path }}"
      submission: direct
      $ref: ../schemas.yml#/CaptureFile
---

# Capture selected evidence file

The exact selected asset file associated with the observation scope.

```

### task:publish-capture (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/publish-capture.md)
```
---
title: Publish captured observations
trigger:
  steps: [publish-capture]
domain: [references]
params:
  type: object
  required: [reference_folder]
  properties:
    reference_folder:
      $ref: ../schemas.yml#/ReferenceFolder
result:
  type: object
  required: [reference]
  properties:
    reference:
      path: "{{ reference_folder }}/meta.yml"
      submission: direct
      $ref: ../schemas.yml#/Reference
---

# Publish captured observations

Selected-scope metadata for the capture revision. Publication fingerprints this
metadata together with the source dump and declared PNG/asset files.

```

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

### ctx:storybook-capture-observations (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/storybook-capture-observations.md)
```
---
name: storybook-capture-observations
trigger:
  steps: [observe-storybook]
---

# Observe the selected storybook source

Use the exact selected story iframe URLs after the required build and index
refresh. Confirm each story exists with `_debo storybook check <story-url>`.
A missing story, error page or unrelated element cannot establish visual
success.

One dump records one state. Explore each story iframe with `_debo reference
save --reference <revision-dir> --url <story-url> --state <name> --session
anonymous [--steps <json>]`; stdout is the catalogue JSON and the command writes
`extract--<state>.json`. A rendered story has no stored session, so every state
is observed as `anonymous`.

Capture each selected subject/view/state with `_debo reference capture-image
--reference <revision-dir> --path <view>--<subject>--<state>.png --url
<story-url> --selector <css-locator> --width <px> --session anonymous
[--steps <json>]`. The full
story subject uses selector `#storybook-root`, not an empty selector and not a
viewport shot of the Storybook chrome. `--steps` reaches a non-rest state.
Confirm the intended subject via `_debo reference image` plus visual
inspection.

Preserve native CSS locators. Submit the shared observation shape with the role
selected by intake: `actual` when verifying a design implementation, or
`reference` when checking a backend render against Storybook. Node IDs always
describe the observed Storybook DOM. Record explicit subject/view/state
correspondences in the verification plan. Font identities are `@font-face`
family names, or the first unquoted CSS family token; the catalogue's
`font_faces` carries their binary URLs. Download required image files and each
non-system font's binaries into the declared capture asset outputs with
`_debo reference capture-file --reference <revision-dir> --path
assets/<basename> --url <absolute-http-url> --session anonymous`. Screenshots
use `capture-image`.
Record unavailable required observations explicitly; a nonzero selector count
alone does not establish subject identity.

The CLI projects observations from the per-state dumps, `meta.yml` and PNG
files; `meta.yml` carries each state's session. Check projected package sizes
with `reference query` after publication against the [bounded observation
contract](../resources/reference-packages.md).

## Read the extract, not the story

`_debo reference inspect --reference <revision-dir> --state <name> --locator
<css>` resolves one locator against an unpublished dump and reports its subtree,
contained images and font families. Confirm every selected locator in each
selected state before freezing the capture block: `subject.found` is true and
the returned subject and subtree establish the intended identity. Follow the
resolved `extract-reference` intake context
when a correction changes the revision directory. `playwright-cli` covers one purpose here — diagnosing
a capture that produced nothing — and that use is named with its purpose in the
intake.

## Capture the selected subject and state

`reference capture-image` isolates the selector at the view width. Choose
the selector so the subject and any associated overlay are in that capture.
Inspect the resulting image: the selected subject, requested state and relevant
overlay must be visible. A missing subject or state is a capture failure, not
a full-page fallback.

```

### ctx:authenticated-capture-parity (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/authenticated-capture-parity.md)
```
---
trigger:
  steps: [observe, capture-file, capture-image]
---

# Authenticated Capture Parity

A backend capture must observe the same relevant user state as the reference it will be
compared against. State parity is established through the session already selected for
that state in the intake's capture block — the existing session/capture abstraction — never
through a new or improvised authentication path.

## Prove state before capturing

Before taking the screenshot, positively confirm the expected state is active — a
selector, text, or structural marker known to appear only in that state. Confirming state
is a positive check for the state's own evidence, not the mere absence of an error page:
a session that silently fails still returns a 200 and a full page, so absence-of-error
proves nothing.

## Abort, never score, on a measurement error

Any of the following mean the capture did not observe the intended state — the run is a
measurement error, not a comparison result:

- a login or sign-in page appears where the expected state is authenticated,
- a redirect landed on a 200 response for a different page than requested,
- the page renders an empty or access-guard placeholder instead of the expected content.

Abort the capture for that state on any of these. An aborted capture produces no image for
that cell and carries no diff score — downstream comparison must treat the missing capture
as blocked, per [screen-compare.md](screen-compare.md), never as a pass or a measured
deviation.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| AUTHCAP-01 | error | Each captured state carries the session declared for that state in the capture block; no ad hoc or inline authentication path is introduced | body |
| AUTHCAP-02 | error | A positive state-evidence check runs immediately before the screenshot for every state that expects a specific user state | body |
| AUTHCAP-03 | error | A login page, a same-status redirect to an unexpected page, or an empty/access-guard placeholder aborts the capture for that state and never emits a diff score | body |

```

## Steps

### Step: observe-storybook
Context: [ctx:cli-surface, ctx:storybook-capture-observations]

- [x] observe-storybook — overview

  Instruction: task:observe-storybook

  #### Params
  ```yaml
  source:
    kind: storybook
    identity: http://localhost:6006
    revision: null
  reference_folder: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299
  state: overview
  session: anonymous
  ```

  #### Contract
  ```yaml
  outputs:
    extract:
      required: true
      schema:
        $ref: '#/definitions/SourceDump'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/extract--overview.json
  ```

  #### Results
  <!-- done -->

- [x] observe-storybook — board

  Instruction: task:observe-storybook

  #### Params
  ```yaml
  source:
    kind: storybook
    identity: http://localhost:6006
    revision: null
  reference_folder: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299
  state: board
  session: anonymous
  ```

  #### Contract
  ```yaml
  outputs:
    extract:
      required: true
      schema:
        $ref: '#/definitions/SourceDump'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/extract--board.json
  ```

  #### Results
  <!-- done -->

- [x] observe-storybook — board-details

  Instruction: task:observe-storybook

  #### Params
  ```yaml
  source:
    kind: storybook
    identity: http://localhost:6006
    revision: null
  reference_folder: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299
  state: board-details
  session: anonymous
  ```

  #### Contract
  ```yaml
  outputs:
    extract:
      required: true
      schema:
        $ref: '#/definitions/SourceDump'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/extract--board-details.json
  ```

  #### Results
  <!-- done -->

- [x] observe-storybook — board-done-open

  Instruction: task:observe-storybook

  #### Params
  ```yaml
  source:
    kind: storybook
    identity: http://localhost:6006
    revision: null
  reference_folder: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299
  state: board-done-open
  session: anonymous
  ```

  #### Contract
  ```yaml
  outputs:
    extract:
      required: true
      schema:
        $ref: '#/definitions/SourceDump'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/extract--board-done-open.json
  ```

  #### Results
  <!-- done -->

- [x] observe-storybook — board-unhealthy

  Instruction: task:observe-storybook

  #### Params
  ```yaml
  source:
    kind: storybook
    identity: http://localhost:6006
    revision: null
  reference_folder: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299
  state: board-unhealthy
  session: anonymous
  ```

  #### Contract
  ```yaml
  outputs:
    extract:
      required: true
      schema:
        $ref: '#/definitions/SourceDump'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/extract--board-unhealthy.json
  ```

  #### Results
  <!-- done -->

### Step: capture-image
Context: [ctx:cli-surface, ctx:authenticated-capture-parity]

- [x] capture-image — ov-attention-list overview

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--ov-attention-list--overview.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--ov-attention-list--overview.png
  ```

  #### Results
  <!-- done -->

- [x] capture-image — board-toolbar board

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--board-toolbar--board.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--board-toolbar--board.png
  ```

  #### Results
  <!-- done -->

- [x] capture-image — board-not-assigned board

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--board-not-assigned--board.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--board-not-assigned--board.png
  ```

  #### Results
  <!-- done -->

- [x] capture-image — board-intake board

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--board-intake--board.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--board-intake--board.png
  ```

  #### Results
  <!-- done -->

- [x] capture-image — details-working board-details

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--details-working--board-details.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--details-working--board-details.png
  ```

  #### Results
  <!-- done -->

- [x] capture-image — done-open-done board-done-open

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--done-open-done--board-done-open.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--done-open-done--board-done-open.png
  ```

  #### Results
  <!-- done -->

- [x] capture-image — unhealthy-intake board-unhealthy

  Instruction: task:capture-image

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--unhealthy-intake--board-unhealthy.png
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/desktop--unhealthy-intake--board-unhealthy.png
  ```

  #### Results
  <!-- done -->

### Step: capture-file
Context: [ctx:cli-surface, ctx:authenticated-capture-parity]

- [x] capture-file — spline-sans.woff2

  Instruction: task:capture-file

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/spline-sans.woff2
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/spline-sans.woff2
  ```

  #### Results
  <!-- done -->

- [x] capture-file — spline-sans-mono.woff2

  Instruction: task:capture-file

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/spline-sans-mono.woff2
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/spline-sans-mono.woff2
  ```

  #### Results
  <!-- done -->

- [x] capture-file — bricolage-grotesque.woff2

  Instruction: task:capture-file

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/bricolage-grotesque.woff2
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/bricolage-grotesque.woff2
  ```

  #### Results
  <!-- done -->

- [x] capture-file — logo.svg

  Instruction: task:capture-file

  #### Params
  ```yaml
  file_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/logo.svg
  ```

  #### Contract
  ```yaml
  outputs:
    file:
      required: true
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/assets/logo.svg
  ```

  #### Results
  <!-- done -->

### Step: publish-capture
Context: [ctx:cli-surface]

- [x] publish-capture — bakers-55 board and attention actual round 4

  Instruction: task:publish-capture

  #### Params
  ```yaml
  reference_folder: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299
  capture:
    role: actual
    source:
      kind: storybook
      identity: http://localhost:6006
      revision: null
    scope:
      - subject: ov-attention-list
        view: desktop
        state: overview
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div > div:nth-of-type(1) > section:nth-of-type(2) > div:nth-of-type(2) > ul
      - subject: board-toolbar
        view: desktop
        state: board
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div:nth-of-type(1)
      - subject: board-not-assigned
        view: desktop
        state: board
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > section:nth-of-type(1)
      - subject: board-intake
        view: desktop
        state: board
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > section:nth-of-type(2)
      - subject: details-working
        view: desktop
        state: board-details
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > section:nth-of-type(3)
      - subject: done-open-done
        view: desktop
        state: board-done-open
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > section:nth-of-type(4)
      - subject: unhealthy-intake
        view: desktop
        state: board-unhealthy
        session: anonymous
        locator:
          kind: css
          value: body > div:nth-of-type(5) > div > div:nth-of-type(2) > main > div > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > section:nth-of-type(2)
  workflow_id: bakers-55-overview-board-actual-7
  ```

  #### Contract
  ```yaml
  outputs:
    reference:
      required: true
      schema:
        $ref: '#/definitions/Reference'
      submission: direct
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/references/4ed588f6b6f3e72b/f5732a97073b9299/meta.yml
  ```

  #### Results
  <!-- done -->

