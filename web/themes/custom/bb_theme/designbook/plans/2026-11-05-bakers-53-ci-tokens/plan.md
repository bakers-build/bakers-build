# Plan: tokens
<!-- digest: 5e0448538ad14d18238985ca9bd6c430faa05212040664ea5fe2462a9199f0d3 -->

## Schemas
```yaml
definitions:
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
  DesignTokens:
    type: object
    required:
      - primitive
      - semantic
    properties:
      primitive:
        type: object
        title: Primitive Tokens
        description: |
          Raw values only — no references. Common groups: color (hex codes), fontFamily (exact Google Fonts names), fontSize, fontWeight, lineHeight, spacing. Each leaf is a TokenLeaf.
      semantic:
        type: object
        title: Semantic Tokens
        required:
          - color
          - typography
        description: |
          Purpose-based aliases. Values MUST reference primitives via {primitive.<group>.<key>} — no raw values allowed.
        properties:
          color:
            type: object
            title: Semantic Colors
            description: |
              Purpose-based color aliases (primary, secondary, background, surface, foreground, error, …). Each leaf is a TokenLeaf whose $value references a primitive color.
          typography:
            type: object
            title: Semantic Typography
            description: |
              Role-based typography tokens (heading, body, button, …). Each role is a typography TokenLeaf bundling fontFamily, fontSize, fontWeight, and lineHeight references. When derived from a design reference, every HTML element observed in the extract MUST appear as a role.
      component:
        type: object
        title: Component Tokens
        description: Component-specific tokens derived from blueprint required_tokens
        default: {}
      themes:
        type: object
```

## Context
### task:create-tokens (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/tokens/tasks/create-tokens.md)
```
---
trigger:
  steps: [create-tokens]
domain: [tokens]
title: Create Design Tokens
params:
  type: object
  required: [vision]
  properties:
    reference_dir:
      type: string
      description: Absolute published revision directory when deriving tokens from a reference.
    vision:
      path: $DESIGNBOOK_DATA/vision.yml
      workflow: /debo-vision
      type: object
    extract:
      description: Bounded token observations queried from the selected published subjects, views and states.
      $ref: ../../../design/schemas.yml#/DesignReference
      type: object
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      type: object
result:
  type: object
  required: [design_tokens]
  properties:
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      $ref: ../schemas.yml#/DesignTokens
---

# Design Tokens

Produce design tokens from the selected reference observations, or from the
explicit intake decisions when the request has no reference.

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

### ctx:extract-mapping (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/tokens/rules/extract-mapping.md)
```
---
trigger:
  steps: [create-tokens]
---

# Reference-derived tokens

The task's `extract` is the authoritative `DesignReference` for the selected
subjects, views and states. Observed values live in
`subjects[].samples[].observations`, with font dependencies in `fonts[]`.
The source's material keys remain source-specific; preserve their meaning and
units instead of assuming a flat color or typography table.

## Values and provenance

Every primitive value must be supported by the selected observations: colors
and opacity, font families, sizes and weights, line heights, spacing and radii.
A line-height ratio may be calculated from observed line height and font size;
preserve its precision. Semantic names and grouping may be inferred, but new
primitive values require explicit intake decisions identified as additions.
Record the selected revision and scope, and distinguish observations, calculated
values and additions in token descriptions or Designbook extensions.

## Coverage

Represent every observed text treatment in `semantic.typography` and every named
observed color in `semantic.color`. Typography roles reference matching primitives
for family, size, weight, line height and color wherever those values are observed.
Figma text styles are treatments even when no HTML element name is available.
Resolve missing required values during intake; an observation gap is not evidence
for a conventional default. Preserve differences between selected views and states.

## Reference-free input

Only a request without a reference uses the palette, fonts and scales recorded
as intake decisions. A missing or invalid supplied reference blocks the task.

```

### ctx:css-naming (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/blueprints/css-naming.md)
```
---
type: css-naming
name: tailwind
priority: 10
trigger:
  steps: [tokens:intake, create-tokens]
filter:
  frameworks.css: tailwind
---

# Tailwind Token Naming Rules

## Token Layers

Tokens are organized in three layers that build on each other:

### Primitive Tokens

Primitive tokens correspond to standard Tailwind tokens. They define raw values without meaning. Color values are concrete hex values. Color scale keys use Tailwind-conformant hue-plus-scale notation. These tokens are never used directly in markup — they serve only as the basis for semantic tokens.

### Semantic Tokens

Semantic tokens describe purpose and intent, not concrete values. They always reference primitives — never direct values.

- **Sizes** use t-shirt sizes: `sm`, `md`, `lg`, `xl` (and `full` for radii)
- **Colors** use role-based names that describe the intended use

Semantic color names are purpose-oriented (e.g. foreground, background, accent, outline, inverse surface). Semantic sizes apply to spacing, radii, shadows, and layout dimensions.

### Component Tokens

Component tokens are component-specific and reference semantic tokens. They form the third layer and encapsulate component-internal design decisions.

## Palette Construction

Primitive colors are a compact raw palette — not a mirror of semantic roles. Follow these rules:

- Each hue family (blue, green, neutral, red, etc.) has **~5-8 shades** numbered by actual lightness: `50` (lightest) through `950` (darkest)
- Scale numbers reflect the color's position on the lightness axis, not its semantic role
- Keep the primitive palette **as compact as possible** without dropping values the design requires. Every primitive must be referenced by at least one semantic token — if a primitive has no semantic reference, remove it
- Multiple semantic tokens MAY reference the same primitive (e.g., `surface` and `background` can both point to `neutral-50`)
- **Never create a 1:1 mapping from semantic roles to primitives.** If the design reference provides 40 named colors, most of them are semantic — only the distinct base hues and their lightness steps become primitives

## CSS Variable Namespaces

Tailwind automatically generates utility classes for standard namespaces (`--color-*`, `--radius-*`, `--shadow-*`). Non-standard namespaces must always be used via `var()` in class values.

```

### ctx:section (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/section.md)
````
---
type: component
name: section
priority: 10
trigger:
  domain: components.layout
  steps: [create-tokens]
extends:
  DesignTokens:
    properties:
      component:
        required: [section]
        properties:
          section:
            type: object
            required: [padding-y]
            properties:
              padding-y:
                type: object
                $extensions:
                  designbook:
                    renderer: spacing
filter:
  frameworks.component: sdc
---

# Blueprint: Section

A page-builder adapter that combines container + grid with fixed named column slots. Delegates internally to the `container` component.

**Use for:** Layout Builder, Layout Paragraphs, or any page builder that requires fixed, named column slots.

> For manual template usage, prefer composing `container` and `grid` directly.

## Structure

- Delegates to [`container`](container.md) for max-width, padding, background, and theme
- Uses [`grid`](grid.md) internally to arrange columns

## Props
- max_width: enum [sm, md, lg, xl, full] — passed to container
- padding_top: enum [auto, none, sm, md, lg] (default: "auto") — passed to container
- padding_bottom: enum [auto, none, sm, md, lg] (default: "auto") — passed to container
- display_header: boolean (default: true) — passed to container
- theme: string (optional) — passed to container
- columns: enum [1..8] (default: 1) — passed to grid
- gap: enum [none, sm, md, lg] (default: "md") — passed to grid

## Slots
- header, background — passed to container
- column_1..column_8 — named column slots rendered as grid items

## Twig Slot Pattern

All slots MUST be wrapped in `{% block %}` tags for `{% embed %}` compatibility:

```twig
{% block content %}
  {% if content %}{{ content }}{% endif %}
{% endblock %}
```

````

### ctx:grid (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/grid.md)
````
---
type: component
name: grid
priority: 10
trigger:
  domain: components.layout
  steps: [create-tokens]
extends:
  DesignTokens:
    properties:
      component:
        required: [grid]
        properties:
          grid:
            type: object
            required: [gap]
            properties:
              gap:
                type: object
                $extensions:
                  designbook:
                    renderer: gap
filter:
  frameworks.component: sdc
---

# Blueprint: Grid

A responsive grid that arranges items into columns with breakpoint-aware presets.

**Use for:** Card grids, teaser lists, multi-column content — any columnar arrangement.

## Props
- columns: enum [1, 2, 3, 4] (default: 1)
- gap: enum [none, sm, md, lg] (default: "md")

## Slots
- items — grid cells
- content — free-form alternative (use either items or content)

## Twig Slot Pattern

All slots MUST be wrapped in `{% block %}` tags for `{% embed %}` compatibility:

```twig
{% block content %}
  {% if content %}{{ content }}{% endif %}
{% endblock %}
```

## Responsive Column Presets

| `columns` | Mobile | Tablet (md) | Desktop (lg) |
|-----------|--------|-------------|---------------|
| `1` | 1 col | 1 col | 1 col |
| `2` | 1 col | 2 cols | 2 cols |
| `3` | 1 col | 2 cols | 3 cols |
| `4` | 1 col | 2 cols | 4 cols |

## Token Integration

Gap values should come from design tokens (`--grid-gap-sm`, `--grid-gap-md`, `--grid-gap-lg`) — see `layout-constraints.md` rule for enforcement details.

````

### ctx:container (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/container.md)
```
---
type: component
name: container
priority: 10
trigger:
  domain: components
  steps: [create-tokens]
extends:
  DesignTokens:
    required: [component]
    properties:
      component:
        required: [container]
        properties:
          container:
            type: object
            required: [max-width]
            properties:
              max-width:
                type: object
                $extensions:
                  designbook:
                    renderer: container
filter:
  frameworks.component: sdc
---

# Blueprint: Container

A universal structural wrapper that constrains content width, provides horizontal browser-edge padding, and optionally renders a header, background layer, and theme.

**Use for:** Page sections, header/footer wrappers, hero areas, modals — anywhere you need max-width.

## Props
- max_width: enum [sm, md, lg, xl, full] (default: "md")
- padding_top: enum [auto, none, sm, md, lg] (default: "auto")
- padding_bottom: enum [auto, none, sm, md, lg] (default: "auto")
- display_header: boolean (default: true)
- theme: string (optional)

## Slots
- header — optional header content
- background — decorative background layer
- content (required)

## Token Integration

Container max-width values should come from design tokens (`--container-sm`, `--container-md`, etc.).

When the design reference uses a wider wrapper than the default token set provides, add a new size tier (e.g. `2xl`) to both the token file and the container's `max_width` enum.


```

## Steps

### Step: create-tokens
Context: [ctx:cli-surface, ctx:extract-mapping, ctx:css-naming, ctx:section, ctx:grid, ctx:container]

- [x] create-tokens — create-tokens — CI light and dark from the Figma board reference

  Instruction: task:create-tokens

  #### Params
  ```yaml
  reference_dir: web/themes/custom/bb_theme/designbook/references/5ec63e9416185263/5912f5b2e076896e
  vision:
    product_name: bakers.build
    description: bakers.build is an AI-first ticket system for working through issues. Tickets are imported from different ticket systems, then follow a canonical workflow, and are pulled and worked off by a bakers.build conductor.
    problems:
      - title: Issues are scattered across many ticket systems
        solution: bakers.build imports tickets from different sources into one canonical model and workflow.
      - title: Working issues manually is slow and unfocused
        solution: 'AI-first: tickets follow a state-machine workflow and a bakers.build conductor pulls and works them off automatically.'
      - title: No single view of what agents are doing
        solution: A monitoring dashboard/board shows ticket state, active runs and conductor load.
    features:
      - Ticket import from multiple ticket systems into a canonical model
      - Per-ticket workflow state machine (bb_work: qualification, plan, working, review, done, cancelled)
      - bakers.build conductor pulls and dispatches tickets to AI agents
      - AI agents work off issues end-to-end
      - Monitoring dashboard and board for tickets, runs and conductors
    design_reference:
      type: claude_design
      url: https://claude.ai/design/p/6dc13314-59d8-44e4-b81f-dad03ff46dfa
      label: bakers.build screens (Claude Design)
    references:
      - type: design_system_rule
        url: designbook/design-system/action-pattern.md
        label: The action pattern — binding for every add, edit, cancel and transition surface, without variation. States when an action is confirmed (exactly when it ends or discards the ticket) and what happens instead when a single-step action has a server-side side effect (it is named at the control). Read it before designing any surface that writes.
      - type: claude_design_mcp
        url: https://api.anthropic.com/v1/design/mcp
        label: claude_design MCP — import the bakers.build designs (auth via /design-login). project 6dc13314-59d8-44e4-b81f-dad03ff46dfa; read via get_project/list_files/get_file → screen HTMLs (Dashboard/Ticket/Login/ Logo) + bakers.build Design System.html (token source for design-tokens.yml).
  extract:
    subjects:
      - id: board-light
        locator:
          kind: figma-node
          value: '550:8970'
        samples:
          - view: desktop
            state: ci-light
            structure:
              roots:
                - '550:8970'
              nodes:
                - id: '550:8970'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '550:8970'
                  children: []
            observations:
              typography:
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-title,#2b2116)
                  nodes:
                    - I550:8971;79:854;46:160
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - I550:8971;79:856;7:134
                    - I550:8971;79:857;7:134
                    - I550:8971;79:926;7:134
                    - I550:8971;79:859;7:134
                    - I550:8971;79:867;45:226
                    - I550:8971;79:868;45:226
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-link,#2b2116)
                  nodes:
                    - I550:8971;79:858;7:139
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - I550:8971;79:863
                    - I550:9008;43:141
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1'
                  letter_spacing: null
                  color: var(--color-state-ink,#2b2116)
                  nodes:
                    - I550:8971;79:867;45:229;7:257
                    - I550:8971;79:868;45:229;7:261
                    - I550:8971;79:870;46:168;45:160
                    - I550:8994;7:255
                    - I550:8997;7:261
                    - I550:9000;7:255
                    - I550:9003;7:259
                    - I550:9048;7:255
                    - I550:9071;7:261
                    - I550:9083;7:255
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#2b2116)
                  nodes:
                    - I550:8971;79:870;46:166
                - font_family: SF Pro
                  font_style: Bold
                  font_weight: 700
                  font_size: 14.97px
                  line_height: '1'
                  letter_spacing: null
                  color: var(--color-state-ink,#2b2116)
                  nodes:
                    - I550:8975;7:259
                - font_family: Bricolage Grotesque
                  font_style: Bold
                  font_weight: 700
                  font_size: 24px
                  line_height: 30px
                  letter_spacing: '-0.24px'
                  color: var(--color-title,#2b2116)
                  nodes:
                    - '550:8977'
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - '550:8978'
                    - '550:8995'
                    - '550:8998'
                    - '550:9001'
                    - '550:9004'
                    - '550:9011'
                    - '550:9017'
                    - '550:9053'
                    - '550:9055'
                    - '550:9060'
                    - '550:9089'
                - font_family: Spline Sans
                  font_style: Medium
                  font_weight: 500
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - I550:8980;7:143
                    - I550:8982;7:143
                    - I550:8983;7:143
                    - I550:8984;7:143
                    - I550:8985;7:143
                    - I550:8986;7:143
                - font_family: Spline Sans
                  font_style: Medium
                  font_weight: 500
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#2b2116)
                  nodes:
                    - I550:8981;7:145
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - I550:8989;52:702
                    - I550:8989;52:703
                    - I550:8990;52:702
                    - I550:8990;52:703
                    - I550:9010;44:257
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#2b2116)
                  nodes:
                    - I550:8989;52:704
                    - I550:8990;52:704
                - font_family: Spline Sans
                  font_style: Medium
                  font_weight: 500
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - '550:8992'
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text,#2b2116)
                  nodes:
                    - '550:9006'
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-link,#2b2116)
                  nodes:
                    - I550:9010;44:256
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-link,#2b2116)
                  nodes:
                    - I550:9010;44:258
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 16px
                  line_height: 22px
                  letter_spacing: '-0.08px'
                  color: var(--color-title,#2b2116)
                  nodes:
                    - '550:9016'
                    - '550:9052'
                    - '550:9059'
                    - '550:9088'
                - font_family: Spline Sans Mono
                  font_style: Medium
                  font_weight: 500
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - '550:9021'
                    - '550:9031'
                    - '550:9041'
                    - '550:9064'
                    - '550:9076'
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-state-unassigned-ink,#8a2a1b)
                  nodes:
                    - I550:9023;44:199
                    - I550:9033;44:199
                    - I550:9043;44:199
                    - I550:9066;44:199
                    - I550:9078;44:199
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 14px
                  line_height: 20px
                  letter_spacing: null
                  color: var(--color-text,#2b2116)
                  nodes:
                    - '550:9024'
                    - '550:9034'
                    - '550:9044'
                    - '550:9067'
                    - '550:9079'
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-state-offline-ink,#4a3e30)
                  nodes:
                    - I550:9026;44:157
                    - I550:9036;44:157
                    - I550:9046;44:157
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-state-running-ink,#3d3224)
                  nodes:
                    - I550:9069;44:171
                    - I550:9081;44:171
                    - I550:9091;46:180
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#2b2116)
                  nodes:
                    - I550:9090;7:163
                - font_family: Spline Sans Mono
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-text-light,#63584a)
                  nodes:
                    - I550:9091;46:181
              properties:
                figma_mode: light
                variables:
                  colors:
                    var(--color-surface-2): '#f0e9dc'
                    var(--color-title): '#2b2116'
                    var(--color-text-light): '#63584a'
                    var(--color-border-2): '#ede6d8'
                    var(--color-primary): '#2b2116'
                    var(--color-link): '#2b2116'
                    var(--color-state-ink): '#2b2116'
                    var(--color-avatar-b): '#cfe69a'
                    var(--color-avatar-c): '#eac6a4'
                    var(--color-avatar-a): '#f4afc0'
                    var(--color-text): '#2b2116'
                    var(--color-text-faint): '#63584a'
                    var(--color-border): '#e0d6c4'
                    var(--color-app): '#f7f2e8'
                    var(--color-input): '#fffdf8'
                    var(--color-control-border): '#857a68'
                    var(--color-state-unassigned): '#c8432f'
                    var(--color-type-bug): '#c8432f'
                    var(--color-state-unassigned-ink): '#8a2a1b'
                    var(--color-state-unassigned-tint): '#f8d9d0'
                    var(--color-state-offline): '#8a7860'
                    var(--color-state-offline-ink): '#4a3e30'
                    var(--color-surface-3): '#e6ddcd'
                    var(--color-surface): '#fffdf8'
                    var(--color-state-attention-mark): '#8f6b00'
                    var(--color-state-running): '#8a7860'
                    var(--color-state-running-ink): '#3d3224'
                    var(--color-state-running-tint): '#efe9de'
                  spacing_and_radius:
                    var(--radius-full): '999'
                    var(--spacing-space-2): '8'
                    var(--spacing-space-1): '4'
                    var(--radius-xs): '5'
                    var(--spacing-space-3): '12'
                    var(--spacing-space-4): '16'
                    var(--radius-sm): '7'
                  note: 'get_variable_defs on the frame: every variable bound in its subtree, resolved for this frame mode'
                variable_bindings_by_node:
                  '550:9015':
                    var(--color-state-unassigned): '#c8432f'
                  '550:9020':
                    var(--color-type-bug): '#c8432f'
                  '550:9051':
                    var(--color-state-attention-mark): '#8f6b00'
                  '550:9058':
                    var(--color-state-running): '#8a7860'
                  '550:9087':
                    var(--color-state-offline): '#8a7860'
                  '550:9026':
                    var(--color-state-offline): '#8a7860'
                    var(--color-state-offline-ink): '#4a3e30'
                    var(--spacing-space-1): '4'
                    var(--spacing-space-2): '8'
                    var(--radius-sm): '7'
                    var(--color-surface-3): '#e6ddcd'
                  '550:9069':
                    var(--color-state-running): '#8a7860'
                    var(--color-state-running-ink): '#3d3224'
                    var(--spacing-space-1): '4'
                    var(--spacing-space-2): '8'
                    var(--radius-sm): '7'
                    var(--color-state-running-tint): '#efe9de'
                  '550:9091':
                    var(--color-state-running): '#8a7860'
                    var(--color-state-running-ink): '#3d3224'
                    var(--color-text-light): '#63584a'
                    var(--spacing-space-1): '4'
                    var(--spacing-space-2): '8'
                    var(--radius-sm): '7'
                    var(--color-state-running-tint): '#efe9de'
                    var(--spacing-space-3): '12'
                    var(--color-app): '#f7f2e8'
                    var(--color-border): '#e0d6c4'
                  '550:8971':
                    var(--radius-full): '999'
                    var(--color-surface-2): '#f0e9dc'
                    var(--color-title): '#2b2116'
                    var(--color-text-light): '#63584a'
                    var(--spacing-space-2): '8'
                    var(--spacing-space-1): '4'
                    var(--radius-xs): '5'
                    var(--spacing-space-3): '12'
                    var(--spacing-space-4): '16'
                    var(--color-border-2): '#ede6d8'
                    var(--radius-sm): '7'
                    var(--color-primary): '#2b2116'
                    var(--color-link): '#2b2116'
                    var(--color-state-ink): '#2b2116'
                    var(--color-avatar-b): '#cfe69a'
                    var(--color-avatar-c): '#eac6a4'
                    var(--color-avatar-a): '#f4afc0'
                    var(--color-text): '#2b2116'
                    var(--color-text-faint): '#63584a'
                    var(--color-border): '#e0d6c4'
                    var(--color-app): '#f7f2e8'
                  '550:8989':
                    var(--color-text-light): '#63584a'
                    var(--color-text): '#2b2116'
                    var(--radius-full): '999'
                    var(--color-input): '#fffdf8'
                    var(--color-control-border): '#857a68'
                raw_radii_not_variables:
                  - 999px
                  - 10px
                  - 7px
                  - 2px
                regions:
                  page_background:
                    - '550:8970'
                  main:
                    - '550:8972'
                  sidebar:
                    - '550:8971'
                  sidebar_workspace:
                    - I550:8971;79:853
                    - I550:8971;79:854
                  sidebar_navigation:
                    - I550:8971;79:855
                  sidebar_nav_items:
                    - I550:8971;79:856
                    - I550:8971;79:857
                    - I550:8971;79:858
                    - I550:8971;79:926
                    - I550:8971;79:859
                    - I550:8971;79:867
                    - I550:8971;79:868
                  sidebar_nav_active:
                    - I550:8971;79:858
                    - I550:8971;79:858;45:223
                    - I550:8971;79:858;7:139
                  sidebar_teams_heading:
                    - I550:8971;79:860
                  sidebar_footer_account_bar:
                    - I550:8971;79:870
                  sidebar_mode_toggle:
                    - I550:8971;79:870;46:170
                    - I550:8971;79:870;46:171
                  sidebar_collapse_toggle:
                    - I550:8971;79:871
                  header:
                    - '550:8973'
                  header_project_avatar:
                    - '550:8975'
                  header_title:
                    - '550:8977'
                  header_subtitle:
                    - '550:8978'
                  header_tabs:
                    - '550:8979'
                  header_tab_active:
                    - '550:8981'
                  filter_toolbar:
                    - '550:8987'
                  filter_text_input:
                    - '550:8988'
                  filter_property_pills:
                    - '550:8989'
                    - '550:8990'
                  assignee_toggles:
                    - '550:8991'
                  assignee_toggle_items:
                    - '550:8993'
                    - '550:8996'
                    - '550:8999'
                    - '550:9002'
                  assignee_avatars:
                    - '550:8994'
                    - '550:8997'
                    - '550:9000'
                    - '550:9003'
                  assignee_unassigned_pill:
                    - '550:9005'
                  filter_clear_button:
                    - '550:9008'
                  active_filters:
                    - '550:9009'
                  active_filter_chip:
                    - '550:9010'
                  active_filter_count_text:
                    - '550:9011'
                  lanes:
                    - '550:9012'
                  lane_columns:
                    - '550:9013'
                    - '550:9049'
                    - '550:9056'
                  lane_headers:
                    - '550:9014'
                    - '550:9050'
                    - '550:9057'
                  lane_state_dots:
                    - '550:9015'
                    - '550:9051'
                    - '550:9058'
                    - '550:9087'
                  lane_counts:
                    - '550:9017'
                    - '550:9053'
                    - '550:9060'
                    - '550:9089'
                  cards:
                    - '550:9018'
                    - '550:9028'
                    - '550:9038'
                    - '550:9061'
                    - '550:9073'
                  card_working_accent:
                    - '550:9072'
                    - '550:9084'
                  card_type_dots:
                    - '550:9020'
                    - '550:9030'
                    - '550:9040'
                    - '550:9063'
                    - '550:9075'
                  card_ticket_keys:
                    - '550:9021'
                    - '550:9031'
                    - '550:9041'
                    - '550:9064'
                    - '550:9076'
                  card_titles:
                    - '550:9024'
                    - '550:9034'
                    - '550:9044'
                    - '550:9067'
                    - '550:9079'
                  card_priority_badges:
                    - '550:9023'
                    - '550:9033'
                    - '550:9043'
                    - '550:9066'
                    - '550:9078'
                  card_step_badges:
                    - '550:9026'
                    - '550:9036'
                    - '550:9046'
                    - '550:9069'
                    - '550:9081'
                  card_avatars:
                    - '550:9048'
                    - '550:9071'
                    - '550:9083'
                  lane_empty:
                    - '550:9054'
                    - '550:9055'
                  lane_done_collapsed:
                    - '550:9085'
                  lane_done_button:
                    - '550:9090'
                  status_bar:
                    - '550:9091'
                  status_bar_refresh_badge:
                    - I550:9091;46:178
                nodes:
                  '550:8970':
                    name: CI · Light · Board
                    fill: var(--color-surface,#fffdf8)
                    layout: flex-row
                    align: start
                  '550:8971':
                    name: Sidebar
                    fill: var(--color-app,#f7f2e8)
                    stroke: var(--color-border,#e0d6c4)
                    stroke_sides: right
                    stroke_width: 1px
                    stroke_style: solid
                    layout: flex-column
                    align: start
                    width: 232px
                  I550:8971;79:853:
                    name: Workspace
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_sides: bottom
                    stroke_width: 1px
                    stroke_style: solid
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    align: center
                    padding_x: var(--spacing-space-3,12px)
                    padding_y: var(--spacing-space-4,16px)
                  I550:8971;79:854:
                    name: Workspace switcher
                    layout: flex-row
                    gap: var(--spacing-space-2,8px)
                    height: 32px
                    align: center
                    padding_x: var(--spacing-space-1,4px)
                    radius: var(--radius-xs,5px)
                  I550:8971;79:854;46:163:
                    name: Workspace logo
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-surface-2,#f0e9dc)
                    stroke_style: solid
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:8971;79:854;46:160:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-title,#2b2116)
                    text: keytec
                  I550:8971;79:855:
                    name: Navigation
                    layout: flex-column
                    gap: var(--spacing-space-1,4px)
                    align: start
                    padding: var(--spacing-space-3,12px)
                  I550:8971;79:856:
                    name: Nav · My work
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:856;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: My work
                  I550:8971;79:857:
                    name: Nav · Groups
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:857;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Groups
                  I550:8971;79:858:
                    name: Nav · Projects
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:858;45:223:
                    name: Tint
                    fill: var(--color-primary,#2b2116)
                    opacity: 0.1
                    radius: var(--radius-sm,7px)
                  I550:8971;79:858;7:139:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-link,#2b2116)
                    text: Projects
                  I550:8971;79:926:
                    name: Nav · Project tickets
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_left: 40px
                    padding_right: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:926;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Tickets
                  I550:8971;79:859:
                    name: Nav · Settings
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:859;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Settings
                  I550:8971;79:860:
                    name: Teams heading
                    layout: flex-row
                    gap: var(--spacing-space-3,12px)
                    height: 40px
                    align: center
                    padding_left: var(--spacing-space-3,12px)
                  I550:8971;79:863:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: Teams
                  I550:8971;79:865:
                    name: Add team
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-sm,7px)
                    width: 30px
                    height: 30px
                  I550:8971;79:867:
                    name: Nav · Team A
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:867;45:229:
                    name: Avatar
                    fill: var(--color-avatar-b,#cfe69a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:8971;79:867;45:229;7:257:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: TA
                  I550:8971;79:867;45:226:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Team A
                  I550:8971;79:868:
                    name: Nav · Team B
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:8971;79:868;45:229:
                    name: Avatar
                    fill: var(--color-avatar-c,#eac6a4)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:8971;79:868;45:229;7:261:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: TB
                  I550:8971;79:868;45:226:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Team B
                  I550:8971;79:870:
                    name: Account bar
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_style: solid
                    stroke_sides: top
                    stroke_width: 1px
                    layout: flex-row
                    gap: var(--spacing-space-2,8px)
                    height: 53px
                    align: center
                    padding: var(--spacing-space-3,12px)
                  I550:8971;79:870;46:167:
                    name: Identity
                    layout: flex-row
                    gap: var(--spacing-space-2,8px)
                    align: center
                  I550:8971;79:870;46:168:
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 28px
                    height: 28px
                  I550:8971;79:870;46:168;45:160:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: CW
                  I550:8971;79:870;46:166:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text,#2b2116)
                    text: cw
                  I550:8971;79:870;46:170:
                    name: Mode toggle
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 28px
                    height: 28px
                  I550:8971;79:871:
                    name: Collapse toggle
                    fill: var(--color-surface-2,#f0e9dc)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#e0d6c4)
                    stroke_style: solid
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 28px
                    height: 28px
                  '550:8972':
                    name: Main
                    layout: flex-column
                    align: start
                  '550:8973':
                    name: Header
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_sides: bottom
                    stroke_width: 1px
                    stroke_style: solid
                    layout: flex-column
                    align: start
                  '550:8974':
                    name: Frame
                    layout: flex-row
                    gap: 12px
                    align: center
                    padding_bottom: 8px
                    padding_top: 16px
                    padding_x: 24px
                  '550:8975':
                    name: Avatar
                    fill: var(--color-avatar-b,#cfe69a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,1165.5px)
                    width: 28px
                    height: 28px
                  I550:8975;7:259:
                    name: null
                    font_family: SF Pro
                    font_style: Bold
                    font_weight: 700
                    line_height: '1'
                    font_size: 14.97px
                    color: var(--color-state-ink,#2b2116)
                    font_variation_settings: '"wdth" 100'
                    text: G
                  '550:8976':
                    name: Frame
                    layout: flex-column
                    gap: 4px
                    align: start
                  '550:8977':
                    name: null
                    font_family: Bricolage Grotesque
                    font_style: Bold
                    font_weight: 700
                    line_height: 30px
                    font_size: 24px
                    color: var(--color-title,#2b2116)
                    letter_spacing: '-0.24px'
                    font_variation_settings: '"opsz" 14, "wdth" 100'
                    text: GAIA
                  '550:8978':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: key GAIA · group Gaia
                  '550:8979':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: start
                    padding_left: 16px
                  '550:8980':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8980;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Overview
                  '550:8981':
                    name: Tab
                    stroke: var(--color-primary,#2b2116)
                    stroke_sides: bottom
                    stroke_width: 2px
                    stroke_style: solid
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8981;7:145:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text,#2b2116)
                    text: Board
                  '550:8982':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8982;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Stats
                  '550:8983':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8983;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Tickets
                  '550:8984':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8984;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Time
                  '550:8985':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8985;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Runs
                  '550:8986':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:8986;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#63584a)
                    text: Conductors
                  '550:8987':
                    name: Filter toolbar (36)
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding_top: 16px
                    padding_x: 24px
                  '550:8988':
                    name: Text input
                    fill: var(--color-input,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-control-border,#857a68)
                    stroke_style: solid
                    layout: flex-row
                    height: 32px
                    align: center
                    padding_x: var(--spacing-space-3,12px)
                    radius: var(--radius-sm,7px)
                    width: 240px
                  '550:8989':
                    name: Property pill
                    fill: var(--color-input,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-control-border,#857a68)
                    stroke_style: solid
                    layout: flex-row
                    gap: 6px
                    height: 28px
                    align: center
                    padding_x: 11px
                    radius: var(--radius-full,999px)
                  I550:8989;52:702:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: State
                  I550:8989;52:703:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: ·
                  I550:8989;52:704:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text,#2b2116)
                    text: All
                  '550:8990':
                    name: Property pill
                    fill: var(--color-input,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-control-border,#857a68)
                    stroke_style: solid
                    layout: flex-row
                    gap: 6px
                    height: 28px
                    align: center
                    padding_x: 11px
                    radius: var(--radius-full,999px)
                  I550:8990;52:702:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: Priority
                  I550:8990;52:703:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: ·
                  I550:8990;52:704:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text,#2b2116)
                    text: High
                  '550:8991':
                    name: Assignee toggles
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_left: 8px
                  '550:8992':
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: Assignee
                  '550:8993':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:8994':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:8994;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: CW
                  '550:8995':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '18'
                  '550:8996':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:8997':
                    name: Avatar
                    fill: var(--color-avatar-c,#eac6a4)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:8997;7:261:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: PG
                  '550:8998':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '3'
                  '550:8999':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:9000':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9000;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: DS
                  '550:9001':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '1'
                  '550:9002':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:9003':
                    name: Avatar
                    fill: var(--color-avatar-b,#cfe69a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9003;7:259:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: RK
                  '550:9004':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '1'
                  '550:9005':
                    name: Frame
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#e0d6c4)
                    stroke_style: solid
                    layout: flex-row
                    align: start
                    padding_x: 8px
                    padding_y: 3px
                    radius: 999px
                  '550:9006':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text,#2b2116)
                    text: Unassigned · 21
                  '550:9008':
                    name: Button
                    layout: flex-row
                    gap: 6px
                    height: 30px
                    align: center
                    justify: center
                    padding_x: 10px
                    radius: var(--radius-sm,7px)
                  I550:9008;43:141:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: Clear filters
                  '550:9009':
                    name: Active filters
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding_bottom: 12px
                    padding_left: 24px
                    padding_top: 8px
                  '550:9010':
                    name: Filter chip
                    layout: flex-row
                    gap: 3px
                    height: 27px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-xs,5px)
                  I550:9010;44:255:
                    name: Tint
                    fill: var(--color-primary,#2b2116)
                    opacity: 0.1
                    radius: var(--radius-xs,5px)
                  I550:9010;44:256:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-link,#2b2116)
                    text: Priority
                  I550:9010;44:257:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: is
                  I550:9010;44:258:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-link,#2b2116)
                    text: High
                  '550:9011':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: 5 of 44 open tickets
                  '550:9012':
                    name: Lanes
                    layout: flex-row
                    gap: 16px
                    align: start
                    padding_x: 24px
                  '550:9013':
                    name: Lane
                    fill: var(--color-surface-2,#f0e9dc)
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 8px
                    radius: 10px
                    width: 330px
                  '550:9014':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding: 4px
                  '550:9015':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-unassigned,#c8432f)
                  '550:9016':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#2b2116)
                    letter_spacing: '-0.08px'
                    text: Not assigned
                  '550:9017':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '3'
                  '550:9018':
                    name: Frame
                    fill: var(--color-surface,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9019':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9020':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#c8432f)
                  '550:9021':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: GAIA-281
                  '550:9023':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#f8d9d0)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9023;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#8a2a1b)
                    text: P1
                  '550:9024':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#2b2116)
                    width: 282px
                    text: 'Runs dispatch to the wrong agent: three conductors with divergent agent configs'
                  '550:9025':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9026':
                    name: Badge
                    fill: var(--color-surface-3,#e6ddcd)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9026;44:153:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8a7860)
                  I550:9026;44:157:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-offline-ink,#4a3e30)
                    text: diagnose
                  '550:9028':
                    name: Frame
                    fill: var(--color-surface,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9029':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9030':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#c8432f)
                  '550:9031':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: GAIA-307
                  '550:9033':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#f8d9d0)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9033;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#8a2a1b)
                    text: P1
                  '550:9034':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#2b2116)
                    width: 282px
                    text: 'Expired runs are never closed: 1333 stand open because no path closes them'
                  '550:9035':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9036':
                    name: Badge
                    fill: var(--color-surface-3,#e6ddcd)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9036;44:153:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8a7860)
                  I550:9036;44:157:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-offline-ink,#4a3e30)
                    text: diagnose
                  '550:9038':
                    name: Frame
                    fill: var(--color-surface,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9039':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9040':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#c8432f)
                  '550:9041':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: GAIA-348
                  '550:9043':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#f8d9d0)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9043;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#8a2a1b)
                    text: P1
                  '550:9044':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#2b2116)
                    width: 282px
                    text: Conductor start fails with HTTP 403 when gaia_project_manager writes its record
                  '550:9045':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9046':
                    name: Badge
                    fill: var(--color-surface-3,#e6ddcd)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9046;44:153:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8a7860)
                  I550:9046;44:157:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-offline-ink,#4a3e30)
                    text: qualification
                  '550:9048':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9048;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: CW
                  '550:9049':
                    name: Lane
                    fill: var(--color-surface-2,#f0e9dc)
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 8px
                    radius: 10px
                    width: 330px
                  '550:9050':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding: 4px
                  '550:9051':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-attention-mark,#8f6b00)
                  '550:9052':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#2b2116)
                    letter_spacing: '-0.08px'
                    text: Intake
                  '550:9053':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '0'
                  '550:9054':
                    name: Frame
                    layout: flex-column
                    align: start
                    padding_x: 8px
                    padding_y: 16px
                  '550:9055':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: No ticket matches these filters.
                  '550:9056':
                    name: Lane
                    fill: var(--color-surface-2,#f0e9dc)
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 8px
                    radius: 10px
                    width: 330px
                  '550:9057':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding: 4px
                  '550:9058':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#8a7860)
                  '550:9059':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#2b2116)
                    letter_spacing: '-0.08px'
                    text: Working
                  '550:9060':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '2'
                  '550:9061':
                    name: Frame
                    fill: var(--color-surface,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9062':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9063':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#c8432f)
                  '550:9064':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: GAIA-365
                  '550:9066':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#f8d9d0)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9066;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#8a2a1b)
                    text: P1
                  '550:9067':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#2b2116)
                    width: 282px
                    text: gaia deployment tickets ignore every project whose key is not GAIA
                  '550:9068':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9069':
                    name: Badge
                    fill: var(--color-state-running-tint,#efe9de)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9069;44:167:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#8a7860)
                  I550:9069;44:171:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-running-ink,#3d3224)
                    text: review
                  '550:9071':
                    name: Avatar
                    fill: var(--color-avatar-c,#eac6a4)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9071;7:261:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: PG
                  '550:9072':
                    name: Rectangle
                    fill: var(--color-state-running,#8a7860)
                    height: 106px
                    radius: 2px
                    width: 3px
                  '550:9073':
                    name: Frame
                    fill: var(--color-surface,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#ede6d8)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9074':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9075':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#c8432f)
                  '550:9076':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: GAIA-393
                  '550:9078':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#f8d9d0)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9078;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#8a2a1b)
                    text: P1
                  '550:9079':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#2b2116)
                    width: 282px
                    text: Conductor reap leaks worktree DDEV environments
                  '550:9080':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9081':
                    name: Badge
                    fill: var(--color-state-running-tint,#efe9de)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9081;44:167:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#8a7860)
                  I550:9081;44:171:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-running-ink,#3d3224)
                    text: review
                  '550:9083':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9083;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#2b2116)
                    text: CW
                  '550:9084':
                    name: Rectangle
                    fill: var(--color-state-running,#8a7860)
                    height: 106px
                    radius: 2px
                    width: 3px
                  '550:9085':
                    name: Lane · Done (collapsed)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#e0d6c4)
                    stroke_style: dashed
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 10px
                    width: 160px
                  '550:9086':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9087':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8a7860)
                  '550:9088':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#2b2116)
                    letter_spacing: '-0.08px'
                    text: Done
                  '550:9089':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#63584a)
                    text: '636'
                  '550:9090':
                    name: Button
                    fill: var(--color-surface,#fffdf8)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#e0d6c4)
                    stroke_style: solid
                    layout: flex-row
                    gap: 6px
                    height: 30px
                    align: center
                    justify: center
                    padding_x: 10px
                    radius: var(--radius-sm,7px)
                  I550:9090;7:163:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text,#2b2116)
                    text: Show done
                  '550:9091':
                    name: Status bar
                    fill: var(--color-app,#f7f2e8)
                    stroke: var(--color-border,#e0d6c4)
                    stroke_style: solid
                    stroke_sides: top
                    stroke_width: 1px
                    layout: flex-row
                    height: 28px
                    align: center
                    padding_x: var(--spacing-space-3,12px)
                  I550:9091;46:178:
                    name: Refresh indicator
                    fill: var(--color-state-running-tint,#efe9de)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9091;46:179:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#8a7860)
                  I550:9091;46:180:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-running-ink,#3d3224)
                    text: Auto-refresh on
                  I550:9091;46:181:
                    name: null
                    font_family: Spline Sans Mono
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-text-light,#63584a)
                    text: updated 4s ago
                source_assets:
                  - name: workspace-logo
                    figma_layer_names:
                      - Workspace logo
                    role: logo
                    format: png
                    location: sidebar
                    width: 24px
                    height: 24px
                    stroke_resolved: null
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:854;46:163
                  - name: icon-chevron-down
                    figma_layer_names:
                      - icon/chevron-down
                    role: icon
                    format: svg
                    location: sidebar
                    width: 14px
                    height: 14px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:854;46:161
                      - I550:8971;79:861
                  - name: icon-ticket
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:856;7:131
                      - I550:8971;79:926;7:131
                  - name: icon-dashboard
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:857;7:131
                  - name: icon-project
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#2b2116'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:858;7:136
                  - name: icon-settings
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:859;7:131
                  - name: icon-team
                    figma_layer_names:
                      - icon/team
                    role: icon
                    format: svg
                    location: sidebar
                    width: 14px
                    height: 14px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:862
                  - name: icon-plus
                    figma_layer_names:
                      - icon/plus
                    role: icon
                    format: svg
                    location: sidebar
                    width: 12px
                    height: 12px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:866
                  - name: chevron-projects
                    figma_layer_names:
                      - Chevron · Projects
                    role: icon
                    format: svg
                    location: sidebar
                    width: 14px
                    height: 14px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:933
                  - name: icon-palette
                    figma_layer_names:
                      - icon/palette
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:870;46:171
                  - name: icon-panel-left
                    figma_layer_names:
                      - icon/panel-left
                    role: icon
                    format: svg
                    location: sidebar
                    width: 12px
                    height: 12px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8971;79:872
                  - name: icon-status-running
                    figma_layer_names:
                      - icon/project
                    role: icon
                    format: svg
                    location: main
                    width: 14px
                    height: 14px
                    stroke_resolved: '#63584a'
                    fill_resolved: '#63584a'
                    nodes:
                      - I550:8989;52:700
                  - name: icon-alert-triangle
                    figma_layer_names:
                      - icon/project
                    role: icon
                    format: svg
                    location: main
                    width: 14px
                    height: 14px
                    stroke_resolved: '#63584a'
                    fill_resolved: null
                    nodes:
                      - I550:8990;52:700
                hidden_nodes:
                  - node: I550:8971;83:1104
                    name: Nav · Insights
                    kind: instance
                    note: hidden in Figma (get_metadata hidden=true); absent from get_design_context
                component_notes: |-
                  ## Sidebar
                  **Node ID:** 46:578

                  Workspace sidebar (components/sidebar + gaia-rail menu, GAIA-673). My work (ticket icon), Groups, Projects (expands on project routes with child &quot;Tickets&quot;), Settings (workspace leads only), Teams heading. Active per page: My work = /tickets, My time, Stats; Project = project overview/board/stats/runs; Project tickets = ticket detail &amp; project ticket list; Settings = settings/members; None = live behaviour where no rail URL matches.

                  ## Workspace switcher
                  **Node ID:** 46:164

                  Workspace switcher (components/account\_switcher) at the top of the sidebar: logo + workspace name + chevron.

                  ## Workspace logo
                  **Node ID:** 46:158

                  Workspace / project logo mark (24, round, surface-2 ring). Image fill from the keytec logo; swap image per workspace.

                  ## Nav item
                  **Node ID:** 7:140

                  Sidebar nav item (components/menu\_item + sidebar). h40, radius sm, px 12, gap 12. Active: primary @10% tint + semibold primary label. Kind=Team shows the team mark (avatar sm) instead of an icon.

                  ## Avatar
                  **Node ID:** 7:262

                  Person mark (components/person): initials in state-ink on a state hue. sm 24 / md 28, eyebrow-size bold initials.

                  ## Account bar
                  **Node ID:** 46:176

                  Sidebar footer: account identity (avatar md + name) and the palette (mode toggle) button.

                  ## icon/palette
                  **Node ID:** 34:204

                  GAIA theme icon palette (assets/icons/src/palette.svg). Recolor via instance stroke/fill override.

                  ## Tab
                  **Node ID:** 7:146

                  Tab (components/tab): 13 medium, px 8, h 40; active = text colour + 2px primary underline.

                  ## Text input
                  **Node ID:** 47:443

                  Text input (components/form\_input): h38, radius sm, input surface + control-border hairline.

                  ## Property pill
                  **Node ID:** 52:715

                  Property chip in the ticket composer (components/option\_picker / property\_pill): icon, field, value. Workflow = primary tint + primary hairline, bold.

                  ## icon/status-running
                  **Node ID:** 34:232

                  GAIA theme icon status-running (assets/icons/src/status-running.svg). Recolor via instance stroke/fill override.

                  ## Button
                  **Node ID:** 7:169

                  GAIA button (components/button). Variants neutral / primary / ghost / danger (outline only). Height 30, radius sm, caption bold. Icon only = 30×30, label becomes aria-label.

                  ## Filter chip
                  **Node ID:** 44:259

                  Active filter summary chip (active-filters). Primary @10% tint, radius xs, h27.

                  ## Badge
                  **Node ID:** 44:250

                  GAIA badge (components/badge). One badge contract: label + tone + optional dot/icon. Tones map to state tint/ink pairs (wait = critical = unassigned pair). Stale/Offline have no tint pair → quiet surface + hollow ring dot. Mono for machine ids / conductors. Height 20, px 8, radius sm, 11 semibold.

                  ## Status bar
                  **Node ID:** 46:182

                  Bottom status bar of the shell (components/status\_bar) with the auto-refresh indicator badge.
                sources: get_metadata (structure, bounds), get_design_context on the frame (fills, strokes, radii, spacing, typography with variable names), get_variable_defs on the frame and on dot/badge/status-bar/sidebar/pill nodes (variable map of this mode), exported SVG assets (resolved dot and icon colours)
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - Spline Sans
                - SF Pro
                - Bricolage Grotesque
                - Spline Sans Mono
            unavailable:
              - property: source.revision
                reason: Figma MCP tools return no file version id
                required: false
              - property: fonts.Spline Sans.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: fonts.SF Pro.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: fonts.Bricolage Grotesque.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: fonts.Spline Sans Mono.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: images.workspace-logo
                reason: 'logo binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the PNG export https://www.figma.com/api/mcp/asset/699edf0f-24a8-4b5d-b249-799900893ab8.png is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-chevron-down
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/1292c80b-d03b-440c-8395-3fb0404a25f8.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-ticket
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/a2791079-77e7-49ed-b30b-0be150387afb.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-dashboard
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/71dea017-402f-48e4-92e7-962de5f90ed8.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-project
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/71b8eb7d-f146-40d0-9fbd-f18a7c5801b4.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-settings
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/5f0d7124-c635-4312-9595-8ff7a458bf9b.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-team
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/d6fd4983-cde4-430b-bf33-3d3ee681913b.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-plus
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/1de9a8fc-a25e-4176-930a-e535785f150a.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.chevron-projects
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/c117555f-d7d9-482a-b884-a342069e7441.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-palette
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/ba324110-8eec-40e0-840d-2db0bfe77748.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-panel-left
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/5223d7a2-719d-4222-a746-9aad7e5bc678.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-status-running
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/0a007d9b-8c7d-4a93-afb2-adc04f0fa374.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-alert-triangle
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/a1075ccc-182e-47d1-ba72-6993694f8aa7.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: typography.variables
                reason: get_variable_defs returns no typography (font family/size/line-height) variables for these frames and get_design_context exposes no text style names; typography is recorded as literal values per text node
                required: false
              - property: icons.stroke.variable
                reason: icons are exported as SVG with resolved hex strokes only; get_variable_defs rejects instance-internal node ids, so the per-icon stroke variable binding cannot be read (resolved hex and the frame variable with that value are recorded)
                required: false
              - property: interactions.hover_focus_pressed
                reason: the frame shows the rest state only (plus the active tab and active nav item); hover, focus and pressed states are not in the selected frame
                required: false
              - property: content.550:8988.placeholder
                reason: 'the Text input instance renders no children in get_design_context: no placeholder, value or icon is drawn in the frame'
                required: false
              - property: effects
                reason: get_design_context reports no shadow or blur on any node in this frame (absence observed; Figma effect styles not otherwise queryable)
                required: false
      - id: board-dark
        locator:
          kind: figma-node
          value: '550:9238'
        samples:
          - view: desktop
            state: ci-dark
            structure:
              roots:
                - '550:9238'
              nodes:
                - id: '550:9238'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '550:9238'
                  children: []
            observations:
              typography:
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-title,#fbf5ea)
                  nodes:
                    - I550:9239;79:854;46:160
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - I550:9239;79:856;7:134
                    - I550:9239;79:857;7:134
                    - I550:9239;79:926;7:134
                    - I550:9239;79:859;7:134
                    - I550:9239;79:867;45:226
                    - I550:9239;79:868;45:226
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-link,#f3ce3a)
                  nodes:
                    - I550:9239;79:858;7:139
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - I550:9239;79:863
                    - I550:9276;43:141
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1'
                  letter_spacing: null
                  color: var(--color-state-ink,#17120b)
                  nodes:
                    - I550:9239;79:867;45:229;7:257
                    - I550:9239;79:868;45:229;7:261
                    - I550:9239;79:870;46:168;45:160
                    - I550:9262;7:255
                    - I550:9265;7:261
                    - I550:9268;7:255
                    - I550:9271;7:259
                    - I550:9316;7:255
                    - I550:9339;7:261
                    - I550:9351;7:255
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#f5ebda)
                  nodes:
                    - I550:9239;79:870;46:166
                - font_family: SF Pro
                  font_style: Bold
                  font_weight: 700
                  font_size: 14.97px
                  line_height: '1'
                  letter_spacing: null
                  color: var(--color-state-ink,#17120b)
                  nodes:
                    - I550:9243;7:259
                - font_family: Bricolage Grotesque
                  font_style: Bold
                  font_weight: 700
                  font_size: 24px
                  line_height: 30px
                  letter_spacing: '-0.24px'
                  color: var(--color-title,#fbf5ea)
                  nodes:
                    - '550:9245'
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - '550:9246'
                    - '550:9263'
                    - '550:9266'
                    - '550:9269'
                    - '550:9272'
                    - '550:9279'
                    - '550:9285'
                    - '550:9321'
                    - '550:9323'
                    - '550:9328'
                    - '550:9357'
                - font_family: Spline Sans
                  font_style: Medium
                  font_weight: 500
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - I550:9248;7:143
                    - I550:9250;7:143
                    - I550:9251;7:143
                    - I550:9252;7:143
                    - I550:9253;7:143
                    - I550:9254;7:143
                - font_family: Spline Sans
                  font_style: Medium
                  font_weight: 500
                  font_size: 13px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#f5ebda)
                  nodes:
                    - I550:9249;7:145
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - I550:9257;52:702
                    - I550:9257;52:703
                    - I550:9258;52:702
                    - I550:9258;52:703
                    - I550:9278;44:257
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#f5ebda)
                  nodes:
                    - I550:9257;52:704
                    - I550:9258;52:704
                - font_family: Spline Sans
                  font_style: Medium
                  font_weight: 500
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - '550:9260'
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text,#f5ebda)
                  nodes:
                    - '550:9274'
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-link,#f3ce3a)
                  nodes:
                    - I550:9278;44:256
                - font_family: Spline Sans
                  font_style: Regular
                  font_weight: 400
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-link,#f3ce3a)
                  nodes:
                    - I550:9278;44:258
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 16px
                  line_height: 22px
                  letter_spacing: '-0.08px'
                  color: var(--color-title,#fbf5ea)
                  nodes:
                    - '550:9284'
                    - '550:9320'
                    - '550:9327'
                    - '550:9356'
                - font_family: Spline Sans Mono
                  font_style: Medium
                  font_weight: 500
                  font_size: 12px
                  line_height: 16px
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - '550:9289'
                    - '550:9299'
                    - '550:9309'
                    - '550:9332'
                    - '550:9344'
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-state-unassigned-ink,#f6b8a8)
                  nodes:
                    - I550:9291;44:199
                    - I550:9301;44:199
                    - I550:9311;44:199
                    - I550:9334;44:199
                    - I550:9346;44:199
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 14px
                  line_height: 20px
                  letter_spacing: null
                  color: var(--color-text,#f5ebda)
                  nodes:
                    - '550:9292'
                    - '550:9302'
                    - '550:9312'
                    - '550:9335'
                    - '550:9347'
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-state-offline-ink,#cdbfa9)
                  nodes:
                    - I550:9294;44:157
                    - I550:9304;44:157
                    - I550:9314;44:157
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-state-running-ink,#e3d6c1)
                  nodes:
                    - I550:9337;44:171
                    - I550:9349;44:171
                    - I550:9359;46:180
                - font_family: Spline Sans
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 12px
                  line_height: '1.45'
                  letter_spacing: null
                  color: var(--color-text,#f5ebda)
                  nodes:
                    - I550:9358;7:163
                - font_family: Spline Sans Mono
                  font_style: SemiBold
                  font_weight: 600
                  font_size: 11px
                  line_height: '1.2'
                  letter_spacing: null
                  color: var(--color-text-light,#bca98d)
                  nodes:
                    - I550:9359;46:181
              properties:
                figma_mode: dark
                variables:
                  colors:
                    var(--color-surface-2): '#2b2116'
                    var(--color-title): '#fbf5ea'
                    var(--color-text-light): '#bca98d'
                    var(--color-border-2): '#33281c'
                    var(--color-primary): '#f3ce3a'
                    var(--color-link): '#f3ce3a'
                    var(--color-state-ink): '#17120b'
                    var(--color-avatar-b): '#bfe07a'
                    var(--color-avatar-c): '#e3b48a'
                    var(--color-text): '#f5ebda'
                    var(--color-text-faint): '#bca98d'
                    var(--color-border): '#45372a'
                    var(--color-app): '#17120b'
                    var(--color-input): '#1d160e'
                    var(--color-control-border): '#8e7b62'
                    var(--color-avatar-a): '#f4afc0'
                    var(--color-state-unassigned): '#e8644e'
                    var(--color-type-bug): '#e8644e'
                    var(--color-state-unassigned-ink): '#f6b8a8'
                    var(--color-state-unassigned-tint): '#4e2018'
                    var(--color-state-offline): '#8e7b62'
                    var(--color-state-offline-ink): '#cdbfa9'
                    var(--color-surface-3): '#3a2e20'
                    var(--color-surface): '#221a11'
                    var(--color-state-attention-mark): '#f3ce3a'
                    var(--color-state-running): '#a8977e'
                    var(--color-state-running-ink): '#e3d6c1'
                    var(--color-state-running-tint): '#3a2e20'
                  spacing_and_radius:
                    var(--radius-full): '999'
                    var(--spacing-space-2): '8'
                    var(--spacing-space-1): '4'
                    var(--radius-xs): '5'
                    var(--spacing-space-3): '12'
                    var(--spacing-space-4): '16'
                    var(--radius-sm): '7'
                  note: 'get_variable_defs on the frame: every variable bound in its subtree, resolved for this frame mode'
                variable_bindings_by_node:
                  '550:9283':
                    var(--color-state-unassigned): '#e8644e'
                  '550:9288':
                    var(--color-type-bug): '#e8644e'
                  '550:9319':
                    var(--color-state-attention-mark): '#f3ce3a'
                  '550:9326':
                    var(--color-state-running): '#a8977e'
                  '550:9355':
                    var(--color-state-offline): '#8e7b62'
                  '550:9294':
                    var(--color-state-offline): '#8e7b62'
                    var(--color-state-offline-ink): '#cdbfa9'
                    var(--spacing-space-1): '4'
                    var(--spacing-space-2): '8'
                    var(--radius-sm): '7'
                    var(--color-surface-3): '#3a2e20'
                  '550:9337':
                    var(--color-state-running): '#a8977e'
                    var(--color-state-running-ink): '#e3d6c1'
                    var(--spacing-space-1): '4'
                    var(--spacing-space-2): '8'
                    var(--radius-sm): '7'
                    var(--color-state-running-tint): '#3a2e20'
                  '550:9359':
                    var(--color-state-running): '#a8977e'
                    var(--color-state-running-ink): '#e3d6c1'
                    var(--color-text-light): '#bca98d'
                    var(--spacing-space-1): '4'
                    var(--spacing-space-2): '8'
                    var(--radius-sm): '7'
                    var(--color-state-running-tint): '#3a2e20'
                    var(--spacing-space-3): '12'
                    var(--color-app): '#17120b'
                    var(--color-border): '#45372a'
                  '550:9239':
                    var(--radius-full): '999'
                    var(--color-surface-2): '#2b2116'
                    var(--color-title): '#fbf5ea'
                    var(--color-text-light): '#bca98d'
                    var(--spacing-space-2): '8'
                    var(--spacing-space-1): '4'
                    var(--radius-xs): '5'
                    var(--spacing-space-3): '12'
                    var(--spacing-space-4): '16'
                    var(--color-border-2): '#33281c'
                    var(--radius-sm): '7'
                    var(--color-primary): '#f3ce3a'
                    var(--color-link): '#f3ce3a'
                    var(--color-state-ink): '#17120b'
                    var(--color-avatar-b): '#bfe07a'
                    var(--color-avatar-c): '#e3b48a'
                    var(--color-text): '#f5ebda'
                    var(--color-text-faint): '#bca98d'
                    var(--color-border): '#45372a'
                    var(--color-app): '#17120b'
                  '550:9257':
                    var(--color-text-light): '#bca98d'
                    var(--color-text): '#f5ebda'
                    var(--radius-full): '999'
                    var(--color-input): '#1d160e'
                    var(--color-control-border): '#8e7b62'
                raw_radii_not_variables:
                  - 999px
                  - 10px
                  - 7px
                  - 2px
                regions:
                  page_background:
                    - '550:9238'
                  main:
                    - '550:9240'
                  sidebar:
                    - '550:9239'
                  sidebar_workspace:
                    - I550:9239;79:853
                    - I550:9239;79:854
                  sidebar_navigation:
                    - I550:9239;79:855
                  sidebar_nav_items:
                    - I550:9239;79:856
                    - I550:9239;79:857
                    - I550:9239;79:858
                    - I550:9239;79:926
                    - I550:9239;79:859
                    - I550:9239;79:867
                    - I550:9239;79:868
                  sidebar_nav_active:
                    - I550:9239;79:858
                    - I550:9239;79:858;45:223
                    - I550:9239;79:858;7:139
                  sidebar_teams_heading:
                    - I550:9239;79:860
                  sidebar_footer_account_bar:
                    - I550:9239;79:870
                  sidebar_mode_toggle:
                    - I550:9239;79:870;46:170
                    - I550:9239;79:870;46:171
                  sidebar_collapse_toggle:
                    - I550:9239;79:871
                  header:
                    - '550:9241'
                  header_project_avatar:
                    - '550:9243'
                  header_title:
                    - '550:9245'
                  header_subtitle:
                    - '550:9246'
                  header_tabs:
                    - '550:9247'
                  header_tab_active:
                    - '550:9249'
                  filter_toolbar:
                    - '550:9255'
                  filter_text_input:
                    - '550:9256'
                  filter_property_pills:
                    - '550:9257'
                    - '550:9258'
                  assignee_toggles:
                    - '550:9259'
                  assignee_toggle_items:
                    - '550:9261'
                    - '550:9264'
                    - '550:9267'
                    - '550:9270'
                  assignee_avatars:
                    - '550:9262'
                    - '550:9265'
                    - '550:9268'
                    - '550:9271'
                  assignee_unassigned_pill:
                    - '550:9273'
                  filter_clear_button:
                    - '550:9276'
                  active_filters:
                    - '550:9277'
                  active_filter_chip:
                    - '550:9278'
                  active_filter_count_text:
                    - '550:9279'
                  lanes:
                    - '550:9280'
                  lane_columns:
                    - '550:9281'
                    - '550:9317'
                    - '550:9324'
                  lane_headers:
                    - '550:9282'
                    - '550:9318'
                    - '550:9325'
                  lane_state_dots:
                    - '550:9283'
                    - '550:9319'
                    - '550:9326'
                    - '550:9355'
                  lane_counts:
                    - '550:9285'
                    - '550:9321'
                    - '550:9328'
                    - '550:9357'
                  cards:
                    - '550:9286'
                    - '550:9296'
                    - '550:9306'
                    - '550:9329'
                    - '550:9341'
                  card_working_accent:
                    - '550:9340'
                    - '550:9352'
                  card_type_dots:
                    - '550:9288'
                    - '550:9298'
                    - '550:9308'
                    - '550:9331'
                    - '550:9343'
                  card_ticket_keys:
                    - '550:9289'
                    - '550:9299'
                    - '550:9309'
                    - '550:9332'
                    - '550:9344'
                  card_titles:
                    - '550:9292'
                    - '550:9302'
                    - '550:9312'
                    - '550:9335'
                    - '550:9347'
                  card_priority_badges:
                    - '550:9291'
                    - '550:9301'
                    - '550:9311'
                    - '550:9334'
                    - '550:9346'
                  card_step_badges:
                    - '550:9294'
                    - '550:9304'
                    - '550:9314'
                    - '550:9337'
                    - '550:9349'
                  card_avatars:
                    - '550:9316'
                    - '550:9339'
                    - '550:9351'
                  lane_empty:
                    - '550:9322'
                    - '550:9323'
                  lane_done_collapsed:
                    - '550:9353'
                  lane_done_button:
                    - '550:9358'
                  status_bar:
                    - '550:9359'
                  status_bar_refresh_badge:
                    - I550:9359;46:178
                nodes:
                  '550:9238':
                    name: CI · Dark · Board
                    fill: var(--color-surface,#221a11)
                    layout: flex-row
                    align: start
                  '550:9239':
                    name: Sidebar
                    fill: var(--color-app,#17120b)
                    stroke: var(--color-border,#45372a)
                    stroke_sides: right
                    stroke_width: 1px
                    stroke_style: solid
                    layout: flex-column
                    align: start
                    width: 232px
                  I550:9239;79:853:
                    name: Workspace
                    stroke: var(--color-border-2,#33281c)
                    stroke_sides: bottom
                    stroke_width: 1px
                    stroke_style: solid
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    align: center
                    padding_x: var(--spacing-space-3,12px)
                    padding_y: var(--spacing-space-4,16px)
                  I550:9239;79:854:
                    name: Workspace switcher
                    layout: flex-row
                    gap: var(--spacing-space-2,8px)
                    height: 32px
                    align: center
                    padding_x: var(--spacing-space-1,4px)
                    radius: var(--radius-xs,5px)
                  I550:9239;79:854;46:163:
                    name: Workspace logo
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-surface-2,#2b2116)
                    stroke_style: solid
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9239;79:854;46:160:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-title,#fbf5ea)
                    text: keytec
                  I550:9239;79:855:
                    name: Navigation
                    layout: flex-column
                    gap: var(--spacing-space-1,4px)
                    align: start
                    padding: var(--spacing-space-3,12px)
                  I550:9239;79:856:
                    name: Nav · My work
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:856;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: My work
                  I550:9239;79:857:
                    name: Nav · Groups
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:857;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Groups
                  I550:9239;79:858:
                    name: Nav · Projects
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:858;45:223:
                    name: Tint
                    fill: var(--color-primary,#f3ce3a)
                    opacity: 0.1
                    radius: var(--radius-sm,7px)
                  I550:9239;79:858;7:139:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-link,#f3ce3a)
                    text: Projects
                  I550:9239;79:926:
                    name: Nav · Project tickets
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_left: 40px
                    padding_right: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:926;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Tickets
                  I550:9239;79:859:
                    name: Nav · Settings
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:859;7:134:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Settings
                  I550:9239;79:860:
                    name: Teams heading
                    layout: flex-row
                    gap: var(--spacing-space-3,12px)
                    height: 40px
                    align: center
                    padding_left: var(--spacing-space-3,12px)
                  I550:9239;79:863:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: Teams
                  I550:9239;79:865:
                    name: Add team
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-sm,7px)
                    width: 30px
                    height: 30px
                  I550:9239;79:867:
                    name: Nav · Team A
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:867;45:229:
                    name: Avatar
                    fill: var(--color-avatar-b,#bfe07a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9239;79:867;45:229;7:257:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: TA
                  I550:9239;79:867;45:226:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Team A
                  I550:9239;79:868:
                    name: Nav · Team B
                    layout: flex-row
                    gap: 12px
                    height: 40px
                    align: center
                    padding_x: 12px
                    radius: var(--radius-sm,7px)
                  I550:9239;79:868;45:229:
                    name: Avatar
                    fill: var(--color-avatar-c,#e3b48a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9239;79:868;45:229;7:261:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: TB
                  I550:9239;79:868;45:226:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Team B
                  I550:9239;79:870:
                    name: Account bar
                    stroke: var(--color-border-2,#33281c)
                    stroke_style: solid
                    stroke_sides: top
                    stroke_width: 1px
                    layout: flex-row
                    gap: var(--spacing-space-2,8px)
                    height: 53px
                    align: center
                    padding: var(--spacing-space-3,12px)
                  I550:9239;79:870;46:167:
                    name: Identity
                    layout: flex-row
                    gap: var(--spacing-space-2,8px)
                    align: center
                  I550:9239;79:870;46:168:
                    name: Avatar
                    fill: var(--color-avatar-c,#e3b48a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 28px
                    height: 28px
                  I550:9239;79:870;46:168;45:160:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: CW
                  I550:9239;79:870;46:166:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text,#f5ebda)
                    text: cw
                  I550:9239;79:870;46:170:
                    name: Mode toggle
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 28px
                    height: 28px
                  I550:9239;79:871:
                    name: Collapse toggle
                    fill: var(--color-surface-2,#2b2116)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#45372a)
                    stroke_style: solid
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 28px
                    height: 28px
                  '550:9240':
                    name: Main
                    layout: flex-column
                    align: start
                  '550:9241':
                    name: Header
                    stroke: var(--color-border-2,#33281c)
                    stroke_sides: bottom
                    stroke_width: 1px
                    stroke_style: solid
                    layout: flex-column
                    align: start
                  '550:9242':
                    name: Frame
                    layout: flex-row
                    gap: 12px
                    align: center
                    padding_bottom: 8px
                    padding_top: 16px
                    padding_x: 24px
                  '550:9243':
                    name: Avatar
                    fill: var(--color-avatar-b,#bfe07a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,1165.5px)
                    width: 28px
                    height: 28px
                  I550:9243;7:259:
                    name: null
                    font_family: SF Pro
                    font_style: Bold
                    font_weight: 700
                    line_height: '1'
                    font_size: 14.97px
                    color: var(--color-state-ink,#17120b)
                    font_variation_settings: '"wdth" 100'
                    text: G
                  '550:9244':
                    name: Frame
                    layout: flex-column
                    gap: 4px
                    align: start
                  '550:9245':
                    name: null
                    font_family: Bricolage Grotesque
                    font_style: Bold
                    font_weight: 700
                    line_height: 30px
                    font_size: 24px
                    color: var(--color-title,#fbf5ea)
                    letter_spacing: '-0.24px'
                    font_variation_settings: '"opsz" 14, "wdth" 100'
                    text: GAIA
                  '550:9246':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: key GAIA · group Gaia
                  '550:9247':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: start
                    padding_left: 16px
                  '550:9248':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9248;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Overview
                  '550:9249':
                    name: Tab
                    stroke: var(--color-primary,#f3ce3a)
                    stroke_sides: bottom
                    stroke_width: 2px
                    stroke_style: solid
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9249;7:145:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text,#f5ebda)
                    text: Board
                  '550:9250':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9250;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Stats
                  '550:9251':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9251;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Tickets
                  '550:9252':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9252;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Time
                  '550:9253':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9253;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Runs
                  '550:9254':
                    name: Tab
                    layout: flex-row
                    height: 40px
                    align: center
                    padding_x: 8px
                  I550:9254;7:143:
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: '1.45'
                    font_size: 13px
                    color: var(--color-text-light,#bca98d)
                    text: Conductors
                  '550:9255':
                    name: Filter toolbar (36)
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding_top: 16px
                    padding_x: 24px
                  '550:9256':
                    name: Text input
                    fill: var(--color-input,#1d160e)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-control-border,#8e7b62)
                    stroke_style: solid
                    layout: flex-row
                    height: 32px
                    align: center
                    padding_x: var(--spacing-space-3,12px)
                    radius: var(--radius-sm,7px)
                    width: 240px
                  '550:9257':
                    name: Property pill
                    fill: var(--color-input,#1d160e)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-control-border,#8e7b62)
                    stroke_style: solid
                    layout: flex-row
                    gap: 6px
                    height: 28px
                    align: center
                    padding_x: 11px
                    radius: var(--radius-full,999px)
                  I550:9257;52:702:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: State
                  I550:9257;52:703:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: ·
                  I550:9257;52:704:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text,#f5ebda)
                    text: All
                  '550:9258':
                    name: Property pill
                    fill: var(--color-input,#1d160e)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-control-border,#8e7b62)
                    stroke_style: solid
                    layout: flex-row
                    gap: 6px
                    height: 28px
                    align: center
                    padding_x: 11px
                    radius: var(--radius-full,999px)
                  I550:9258;52:702:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: Priority
                  I550:9258;52:703:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: ·
                  I550:9258;52:704:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text,#f5ebda)
                    text: High
                  '550:9259':
                    name: Assignee toggles
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_left: 8px
                  '550:9260':
                    name: null
                    font_family: Spline Sans
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: Assignee
                  '550:9261':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:9262':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9262;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: CW
                  '550:9263':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '18'
                  '550:9264':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:9265':
                    name: Avatar
                    fill: var(--color-avatar-c,#e3b48a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9265;7:261:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: PG
                  '550:9266':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '3'
                  '550:9267':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:9268':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9268;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: DS
                  '550:9269':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '1'
                  '550:9270':
                    name: Frame
                    layout: flex-row
                    gap: 4px
                    align: center
                    padding_x: 4px
                    padding_y: 2px
                    radius: 999px
                  '550:9271':
                    name: Avatar
                    fill: var(--color-avatar-b,#bfe07a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9271;7:259:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: RK
                  '550:9272':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '1'
                  '550:9273':
                    name: Frame
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#45372a)
                    stroke_style: solid
                    layout: flex-row
                    align: start
                    padding_x: 8px
                    padding_y: 3px
                    radius: 999px
                  '550:9274':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text,#f5ebda)
                    text: Unassigned · 21
                  '550:9276':
                    name: Button
                    layout: flex-row
                    gap: 6px
                    height: 30px
                    align: center
                    justify: center
                    padding_x: 10px
                    radius: var(--radius-sm,7px)
                  I550:9276;43:141:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: Clear filters
                  '550:9277':
                    name: Active filters
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding_bottom: 12px
                    padding_left: 24px
                    padding_top: 8px
                  '550:9278':
                    name: Filter chip
                    layout: flex-row
                    gap: 3px
                    height: 27px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-xs,5px)
                  I550:9278;44:255:
                    name: Tint
                    fill: var(--color-primary,#f3ce3a)
                    opacity: 0.1
                    radius: var(--radius-xs,5px)
                  I550:9278;44:256:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-link,#f3ce3a)
                    text: Priority
                  I550:9278;44:257:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: is
                  I550:9278;44:258:
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-link,#f3ce3a)
                    text: High
                  '550:9279':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: 5 of 44 open tickets
                  '550:9280':
                    name: Lanes
                    layout: flex-row
                    gap: 16px
                    align: start
                    padding_x: 24px
                  '550:9281':
                    name: Lane
                    fill: var(--color-surface-2,#2b2116)
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 8px
                    radius: 10px
                    width: 330px
                  '550:9282':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding: 4px
                  '550:9283':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-unassigned,#e8644e)
                  '550:9284':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#fbf5ea)
                    letter_spacing: '-0.08px'
                    text: Not assigned
                  '550:9285':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '3'
                  '550:9286':
                    name: Frame
                    fill: var(--color-surface,#221a11)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#33281c)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9287':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9288':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#e8644e)
                  '550:9289':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: GAIA-281
                  '550:9291':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#4e2018)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9291;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#f6b8a8)
                    text: P1
                  '550:9292':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#f5ebda)
                    width: 282px
                    text: 'Runs dispatch to the wrong agent: three conductors with divergent agent configs'
                  '550:9293':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9294':
                    name: Badge
                    fill: var(--color-surface-3,#3a2e20)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9294;44:153:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8e7b62)
                  I550:9294;44:157:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-offline-ink,#cdbfa9)
                    text: diagnose
                  '550:9296':
                    name: Frame
                    fill: var(--color-surface,#221a11)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#33281c)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9297':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9298':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#e8644e)
                  '550:9299':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: GAIA-307
                  '550:9301':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#4e2018)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9301;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#f6b8a8)
                    text: P1
                  '550:9302':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#f5ebda)
                    width: 282px
                    text: 'Expired runs are never closed: 1333 stand open because no path closes them'
                  '550:9303':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9304':
                    name: Badge
                    fill: var(--color-surface-3,#3a2e20)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9304;44:153:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8e7b62)
                  I550:9304;44:157:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-offline-ink,#cdbfa9)
                    text: diagnose
                  '550:9306':
                    name: Frame
                    fill: var(--color-surface,#221a11)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#33281c)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9307':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9308':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#e8644e)
                  '550:9309':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: GAIA-348
                  '550:9311':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#4e2018)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9311;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#f6b8a8)
                    text: P1
                  '550:9312':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#f5ebda)
                    width: 282px
                    text: Conductor start fails with HTTP 403 when gaia_project_manager writes its record
                  '550:9313':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9314':
                    name: Badge
                    fill: var(--color-surface-3,#3a2e20)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9314;44:153:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8e7b62)
                  I550:9314;44:157:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-offline-ink,#cdbfa9)
                    text: qualification
                  '550:9316':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9316;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: CW
                  '550:9317':
                    name: Lane
                    fill: var(--color-surface-2,#2b2116)
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 8px
                    radius: 10px
                    width: 330px
                  '550:9318':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding: 4px
                  '550:9319':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-attention-mark,#f3ce3a)
                  '550:9320':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#fbf5ea)
                    letter_spacing: '-0.08px'
                    text: Intake
                  '550:9321':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '0'
                  '550:9322':
                    name: Frame
                    layout: flex-column
                    align: start
                    padding_x: 8px
                    padding_y: 16px
                  '550:9323':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: No ticket matches these filters.
                  '550:9324':
                    name: Lane
                    fill: var(--color-surface-2,#2b2116)
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 8px
                    radius: 10px
                    width: 330px
                  '550:9325':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                    padding: 4px
                  '550:9326':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#a8977e)
                  '550:9327':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#fbf5ea)
                    letter_spacing: '-0.08px'
                    text: Working
                  '550:9328':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '2'
                  '550:9329':
                    name: Frame
                    fill: var(--color-surface,#221a11)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#33281c)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9330':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9331':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#e8644e)
                  '550:9332':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: GAIA-365
                  '550:9334':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#4e2018)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9334;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#f6b8a8)
                    text: P1
                  '550:9335':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#f5ebda)
                    width: 282px
                    text: gaia deployment tickets ignore every project whose key is not GAIA
                  '550:9336':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9337':
                    name: Badge
                    fill: var(--color-state-running-tint,#3a2e20)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9337;44:167:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#a8977e)
                  I550:9337;44:171:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-running-ink,#e3d6c1)
                    text: review
                  '550:9339':
                    name: Avatar
                    fill: var(--color-avatar-c,#e3b48a)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9339;7:261:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: PG
                  '550:9340':
                    name: Rectangle
                    fill: var(--color-state-running,#a8977e)
                    height: 106px
                    radius: 2px
                    width: 3px
                  '550:9341':
                    name: Frame
                    fill: var(--color-surface,#221a11)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border-2,#33281c)
                    stroke_style: solid
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 7px
                  '550:9342':
                    name: Frame
                    layout: flex-row
                    gap: 6px
                    align: center
                  '550:9343':
                    name: Ellipse
                    width: 7px
                    height: 7px
                    fill: var(--color-type-bug,#e8644e)
                  '550:9344':
                    name: null
                    font_family: Spline Sans Mono
                    font_style: Medium
                    font_weight: 500
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: GAIA-393
                  '550:9346':
                    name: Badge
                    fill: var(--color-state-unassigned-tint,#4e2018)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9346;44:199:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-unassigned-ink,#f6b8a8)
                    text: P1
                  '550:9347':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 20px
                    font_size: 14px
                    color: var(--color-text,#f5ebda)
                    width: 282px
                    text: Conductor reap leaks worktree DDEV environments
                  '550:9348':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9349':
                    name: Badge
                    fill: var(--color-state-running-tint,#3a2e20)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9349;44:167:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#a8977e)
                  I550:9349;44:171:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-running-ink,#e3d6c1)
                    text: review
                  '550:9351':
                    name: Avatar
                    fill: var(--color-avatar-a,#f4afc0)
                    layout: flex-row
                    align: center
                    justify: center
                    radius: var(--radius-full,999px)
                    width: 24px
                    height: 24px
                  I550:9351;7:255:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1'
                    font_size: 11px
                    color: var(--color-state-ink,#17120b)
                    text: CW
                  '550:9352':
                    name: Rectangle
                    fill: var(--color-state-running,#a8977e)
                    height: 106px
                    radius: 2px
                    width: 3px
                  '550:9353':
                    name: Lane · Done (collapsed)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#45372a)
                    stroke_style: dashed
                    layout: flex-column
                    gap: 8px
                    align: start
                    padding: 12px
                    radius: 10px
                    width: 160px
                  '550:9354':
                    name: Frame
                    layout: flex-row
                    gap: 8px
                    align: center
                  '550:9355':
                    name: Ellipse
                    width: 8px
                    height: 8px
                    fill: var(--color-state-offline,#8e7b62)
                  '550:9356':
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: 22px
                    font_size: 16px
                    color: var(--color-title,#fbf5ea)
                    letter_spacing: '-0.08px'
                    text: Done
                  '550:9357':
                    name: null
                    font_family: Spline Sans
                    font_style: Regular
                    font_weight: 400
                    line_height: 16px
                    font_size: 12px
                    color: var(--color-text-light,#bca98d)
                    text: '636'
                  '550:9358':
                    name: Button
                    fill: var(--color-surface,#221a11)
                    stroke_sides: all
                    stroke_width: 1px
                    stroke: var(--color-border,#45372a)
                    stroke_style: solid
                    layout: flex-row
                    gap: 6px
                    height: 30px
                    align: center
                    justify: center
                    padding_x: 10px
                    radius: var(--radius-sm,7px)
                  I550:9358;7:163:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.45'
                    font_size: 12px
                    color: var(--color-text,#f5ebda)
                    text: Show done
                  '550:9359':
                    name: Status bar
                    fill: var(--color-app,#17120b)
                    stroke: var(--color-border,#45372a)
                    stroke_style: solid
                    stroke_sides: top
                    stroke_width: 1px
                    layout: flex-row
                    height: 28px
                    align: center
                    padding_x: var(--spacing-space-3,12px)
                  I550:9359;46:178:
                    name: Refresh indicator
                    fill: var(--color-state-running-tint,#3a2e20)
                    layout: flex-row
                    gap: var(--spacing-space-1,4px)
                    height: 20px
                    align: center
                    padding_x: var(--spacing-space-2,8px)
                    radius: var(--radius-sm,7px)
                  I550:9359;46:179:
                    name: Dot
                    width: 8px
                    height: 8px
                    fill: var(--color-state-running,#a8977e)
                  I550:9359;46:180:
                    name: null
                    font_family: Spline Sans
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-state-running-ink,#e3d6c1)
                    text: Auto-refresh on
                  I550:9359;46:181:
                    name: null
                    font_family: Spline Sans Mono
                    font_style: SemiBold
                    font_weight: 600
                    line_height: '1.2'
                    font_size: 11px
                    color: var(--color-text-light,#bca98d)
                    text: updated 4s ago
                source_assets:
                  - name: workspace-logo
                    figma_layer_names:
                      - Workspace logo
                    role: logo
                    format: png
                    location: sidebar
                    width: 24px
                    height: 24px
                    stroke_resolved: null
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:854;46:163
                  - name: icon-chevron-down
                    figma_layer_names:
                      - icon/chevron-down
                    role: icon
                    format: svg
                    location: sidebar
                    width: 14px
                    height: 14px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:854;46:161
                      - I550:9239;79:861
                  - name: icon-ticket
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:856;7:131
                      - I550:9239;79:926;7:131
                  - name: icon-dashboard
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:857;7:131
                  - name: icon-project
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#f3ce3a'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:858;7:136
                  - name: icon-settings
                    figma_layer_names:
                      - icon/inbox
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:859;7:131
                  - name: icon-team
                    figma_layer_names:
                      - icon/team
                    role: icon
                    format: svg
                    location: sidebar
                    width: 14px
                    height: 14px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:862
                  - name: icon-plus
                    figma_layer_names:
                      - icon/plus
                    role: icon
                    format: svg
                    location: sidebar
                    width: 12px
                    height: 12px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:866
                  - name: chevron-projects
                    figma_layer_names:
                      - Chevron · Projects
                    role: icon
                    format: svg
                    location: sidebar
                    width: 14px
                    height: 14px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:933
                  - name: icon-palette
                    figma_layer_names:
                      - icon/palette
                    role: icon
                    format: svg
                    location: sidebar
                    width: 16px
                    height: 16px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:870;46:171
                  - name: icon-panel-left
                    figma_layer_names:
                      - icon/panel-left
                    role: icon
                    format: svg
                    location: sidebar
                    width: 12px
                    height: 12px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9239;79:872
                  - name: icon-status-running
                    figma_layer_names:
                      - icon/project
                    role: icon
                    format: svg
                    location: main
                    width: 14px
                    height: 14px
                    stroke_resolved: '#bca98d'
                    fill_resolved: '#bca98d'
                    nodes:
                      - I550:9257;52:700
                  - name: icon-alert-triangle
                    figma_layer_names:
                      - icon/project
                    role: icon
                    format: svg
                    location: main
                    width: 14px
                    height: 14px
                    stroke_resolved: '#bca98d'
                    fill_resolved: null
                    nodes:
                      - I550:9258;52:700
                hidden_nodes:
                  - node: I550:9239;83:1104
                    name: Nav · Insights
                    kind: instance
                    note: hidden in Figma (get_metadata hidden=true); absent from get_design_context
                component_notes: |-
                  ## Sidebar
                  **Node ID:** 46:578

                  Workspace sidebar (components/sidebar + gaia-rail menu, GAIA-673). My work (ticket icon), Groups, Projects (expands on project routes with child &quot;Tickets&quot;), Settings (workspace leads only), Teams heading. Active per page: My work = /tickets, My time, Stats; Project = project overview/board/stats/runs; Project tickets = ticket detail &amp; project ticket list; Settings = settings/members; None = live behaviour where no rail URL matches.

                  ## Workspace switcher
                  **Node ID:** 46:164

                  Workspace switcher (components/account\_switcher) at the top of the sidebar: logo + workspace name + chevron.

                  ## Workspace logo
                  **Node ID:** 46:158

                  Workspace / project logo mark (24, round, surface-2 ring). Image fill from the keytec logo; swap image per workspace.

                  ## Nav item
                  **Node ID:** 7:140

                  Sidebar nav item (components/menu\_item + sidebar). h40, radius sm, px 12, gap 12. Active: primary @10% tint + semibold primary label. Kind=Team shows the team mark (avatar sm) instead of an icon.

                  ## Avatar
                  **Node ID:** 7:262

                  Person mark (components/person): initials in state-ink on a state hue. sm 24 / md 28, eyebrow-size bold initials.

                  ## Account bar
                  **Node ID:** 46:176

                  Sidebar footer: account identity (avatar md + name) and the palette (mode toggle) button.

                  ## icon/palette
                  **Node ID:** 34:204

                  GAIA theme icon palette (assets/icons/src/palette.svg). Recolor via instance stroke/fill override.

                  ## Tab
                  **Node ID:** 7:146

                  Tab (components/tab): 13 medium, px 8, h 40; active = text colour + 2px primary underline.

                  ## Text input
                  **Node ID:** 47:443

                  Text input (components/form\_input): h38, radius sm, input surface + control-border hairline.

                  ## Property pill
                  **Node ID:** 52:715

                  Property chip in the ticket composer (components/option\_picker / property\_pill): icon, field, value. Workflow = primary tint + primary hairline, bold.

                  ## icon/status-running
                  **Node ID:** 34:232

                  GAIA theme icon status-running (assets/icons/src/status-running.svg). Recolor via instance stroke/fill override.

                  ## Button
                  **Node ID:** 7:169

                  GAIA button (components/button). Variants neutral / primary / ghost / danger (outline only). Height 30, radius sm, caption bold. Icon only = 30×30, label becomes aria-label.

                  ## Filter chip
                  **Node ID:** 44:259

                  Active filter summary chip (active-filters). Primary @10% tint, radius xs, h27.

                  ## Badge
                  **Node ID:** 44:250

                  GAIA badge (components/badge). One badge contract: label + tone + optional dot/icon. Tones map to state tint/ink pairs (wait = critical = unassigned pair). Stale/Offline have no tint pair → quiet surface + hollow ring dot. Mono for machine ids / conductors. Height 20, px 8, radius sm, 11 semibold.

                  ## Status bar
                  **Node ID:** 46:182

                  Bottom status bar of the shell (components/status\_bar) with the auto-refresh indicator badge.
                sources: get_metadata (structure, bounds), get_design_context on the frame (fills, strokes, radii, spacing, typography with variable names), get_variable_defs on the frame and on dot/badge/status-bar/sidebar/pill nodes (variable map of this mode), exported SVG assets (resolved dot and icon colours)
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - Spline Sans
                - SF Pro
                - Bricolage Grotesque
                - Spline Sans Mono
            unavailable:
              - property: source.revision
                reason: Figma MCP tools return no file version id
                required: false
              - property: fonts.Spline Sans.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: fonts.SF Pro.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: fonts.Bricolage Grotesque.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: fonts.Spline Sans Mono.files
                reason: 'font binaries not downloaded: the font switch is a separate ticket, this capture is for colours, surfaces and structure'
                required: false
              - property: images.workspace-logo
                reason: 'logo binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the PNG export https://www.figma.com/api/mcp/asset/3263d9ce-9cfd-4d4f-a7fe-2f1036bd9405.png is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-chevron-down
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/21e925ac-c216-4b75-85bf-7b281df714bd.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-ticket
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/78679e6e-97b7-48cd-8ceb-3ad3c88ee2ef.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-dashboard
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/3fff6f71-6ff6-4b93-923a-fa7e71a923dd.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-project
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/c7e769e8-6965-43bd-9ca2-f3f1537473c8.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-settings
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/8e4cf291-a2f6-4e09-a83a-71fcf2ae2a9f.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-team
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/60bad68a-3f30-4196-98ad-84f502e52721.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-plus
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/67795322-3652-4668-8bfe-1d33422d3d88.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.chevron-projects
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/0a5337bb-ef63-4f78-8a18-7a505cb247d0.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-palette
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/2b591ebc-caba-4e32-a8f8-59e2d295af4c.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-panel-left
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/435a5c48-20f4-4750-85ee-f91cfb2145ef.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-status-running
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/a3b6dad6-dc25-4882-9548-5c7a85b2ba9c.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: images.icon-alert-triangle
                reason: 'icon binary not stored in the revision (images[] needs a stored assets/ file): this capture is for colours, surfaces and structure; the SVG export https://www.figma.com/api/mcp/asset/11a9eefa-f9d4-4674-862c-3da7cb1ecf81.svg is temporary (7 days); its nodes, size and resolved colour are in observations.properties.source_assets'
                required: false
              - property: typography.variables
                reason: get_variable_defs returns no typography (font family/size/line-height) variables for these frames and get_design_context exposes no text style names; typography is recorded as literal values per text node
                required: false
              - property: icons.stroke.variable
                reason: icons are exported as SVG with resolved hex strokes only; get_variable_defs rejects instance-internal node ids, so the per-icon stroke variable binding cannot be read (resolved hex and the frame variable with that value are recorded)
                required: false
              - property: interactions.hover_focus_pressed
                reason: the frame shows the rest state only (plus the active tab and active nav item); hover, focus and pressed states are not in the selected frame
                required: false
              - property: content.550:9256.placeholder
                reason: 'the Text input instance renders no children in get_design_context: no placeholder, value or icon is drawn in the frame'
                required: false
              - property: effects
                reason: get_design_context reports no shadow or blur on any node in this frame (absence observed; Figma effect styles not otherwise queryable)
                required: false
    parents: []
    images: []
    fonts:
      - family: Spline Sans
        source: google
        weights:
          - 400
          - 500
          - 600
        styles:
          - normal
        files: []
      - family: SF Pro
        source: other
        weights:
          - 700
        styles:
          - normal
        files: []
      - family: Bricolage Grotesque
        source: google
        weights:
          - 700
        styles:
          - normal
        files: []
      - family: Spline Sans Mono
        source: google
        weights:
          - 500
          - 600
        styles:
          - normal
        files: []
    captures:
      - subject: board-light
        view: desktop
        state: ci-light
        path: desktop--board-light--ci-light.png
        width: 1440
        height: 900
      - subject: board-dark
        view: desktop
        state: ci-dark
        path: desktop--board-dark--ci-dark.png
        width: 1440
        height: 900
  decisions: 'CI look of BAKERS-53 from the approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark @ desktop; tokens package request fingerprints ci-light dbd597a32ed828b1da5ca8fc625e88deb7e8033edd9d9cf2dc7b01dc9d84d9c7, ci-dark dfeedba9c7f40da1f527b391a281864e29ab282c108d9d2ba2a57d404d64081f) and the approved spec: seven brand primitives flour #F5EBDA, rye #2B2116, butter #F3CE3A, lime #BFE07A, rose #F4AFC0, crust #B8692E, muted #8A7860; a semantic value equal to a brand colour aliases its primitive, other values stay hex. Semantic colours equal the decision table in docs/decisions/app-appearance.md in light (semantic.color) and dark (themes.dark.semantic.color), every table token listed explicitly in dark; new tokens state-attention-mark, state-review, state-done, state-offline-ink, avatar-a to avatar-d (names as the Figma variables). Light chart values darkened to 3:1 (Q1): chart-series-b and type-feature #718F39, chart-series-c #A28317, chart-series-d #DE5779; chart-flow-new crust/#D28A50, chart-flow-done #718F39/lime, chart-flow-grows #F8D9D0/#4E2018, chart-flow-shrinks #E8F1D6/#2F3A1A (Q9). focusRing.color aliases rye; semantic focus-ring keeps its route through it. Skin themes harbor, grove, ember, iris and their -dark variants are removed; cozy and dark stay. Old primitive scales neutral, violet, red, teal, amber, indigo are removed because nothing references them any more. Every Figma colour variable of both frames (28 per mode) equals the resolved target value. Typography, spacing and radius tokens stay unchanged (the font switch is a separate ticket).'
  ```

  #### Contract
  ```yaml
  outputs:
    design_tokens:
      required: true
      schema:
        $ref: '#/definitions/DesignTokens'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/designbook/design-system/design-tokens.yml
  ```

  #### Results
  <!-- done -->

