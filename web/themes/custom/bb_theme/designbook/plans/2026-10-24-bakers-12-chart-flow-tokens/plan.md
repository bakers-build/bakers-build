# Plan: tokens
<!-- digest: d0fd7636285e1091ff9e37c9108aeeb00eb4c983be998686da150a0d1325a6da -->

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
### task:create-tokens (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/tokens/tasks/create-tokens.md)
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

### ctx:cli-surface (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/workflow/rules/cli-surface.md)
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

### ctx:extract-mapping (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/tokens/rules/extract-mapping.md)
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

### ctx:css-naming (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/blueprints/css-naming.md)
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

### ctx:section (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/section.md)
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

### ctx:grid (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/grid.md)
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

### ctx:container (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/container.md)
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

- [x] create-tokens — chart-flow colour tokens

  Instruction: task:create-tokens

  #### Params
  ```yaml
  reference_dir: web/themes/custom/bb_theme/designbook/references/3a2b0e29e246a9d7/c8ecb5b726386e24
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
      - Per-ticket workflow state machine (qualification, spec, diagnose, coding, review, done)
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
      - id: flow-chart-week
        locator:
          kind: figma-node
          value: '184:14485'
        samples:
          - view: desktop
            state: default
            structure:
              roots:
                - '184:14485'
              nodes:
                - id: '184:14485'
                  kind: FRAME
                  locator:
                    kind: figma-node
                    value: '184:14485'
                  children:
                    - '184:14486'
                    - '184:14487'
                    - '184:14507'
                    - '184:14510'
                - id: '184:14486'
                  kind: TEXT
                  locator:
                    kind: figma-node
                    value: '184:14486'
                  children: []
                - id: '184:14487'
                  kind: FRAME
                  locator:
                    kind: figma-node
                    value: '184:14487'
                  children: []
                - id: '184:14507'
                  kind: FRAME
                  locator:
                    kind: figma-node
                    value: '184:14507'
                  children:
                    - '184:14508'
                    - '184:14509'
                - id: '184:14508'
                  kind: TEXT
                  locator:
                    kind: figma-node
                    value: '184:14508'
                  children: []
                - id: '184:14509'
                  kind: TEXT
                  locator:
                    kind: figma-node
                    value: '184:14509'
                  children: []
                - id: '184:14510'
                  kind: INSTANCE
                  locator:
                    kind: figma-node
                    value: '184:14510'
                  children:
                    - I184:14510;177:1046
                    - I184:14510;177:1062
                    - I184:14510;177:1063
                    - I184:14510;177:1064
                    - I184:14510;177:1088
                    - I184:14510;177:1091
                - id: I184:14510;177:1046
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14510;177:1046
                  children: []
                - id: I184:14510;177:1062
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14510;177:1062
                  children: []
                - id: I184:14510;177:1063
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14510;177:1063
                  children: []
                - id: I184:14510;177:1064
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14510;177:1064
                  children: []
                - id: I184:14510;177:1088
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14510;177:1088
                  children: []
                - id: I184:14510;177:1091
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14510;177:1091
                  children: []
            observations:
              layout:
                frame:
                  width: 1228
                  height: 466
                  display: flex column
                  gap: 16
                  padding: 24
                  background: var(--color-app,#f1f0ea)
                  border: 1px solid var(--color-border,#d6d3ca)
                  radius: 12
                out_of_scope_note: The subject locator is the whole Zeitraum frame because heading row and Flow chart instance have no smaller common parent. The eyebrow text and the Period range row (instance + "vs. ..." text) are out of scope (separate ticket).
                heading_row:
                  display: flex row
                  align: baseline
                  gap: 10
                  y_in_frame: 103
                  height: 22
                chart:
                  component: Flow chart (component set 177:2019), variant Range=Week, Size=Wide, hover=false
                  component_description: 'Fluss-Diagramm (Entwurf F): neu und done als Linien mit Punkten, Fläche dazwischen rot = Backlog wächst, teal = schrumpft. Range bestimmt die Gruppierung (Tag/Tag/Woche/Monat/Quartal), Size Wide 1160 / Compact 768. Hover zeigt Spalte + Tooltip (Datum, New, Done, Backlog ±).'
                  width: 1160
                  height: 300
                  y_in_frame: 141
                  plot_area:
                    x0: 40
                    x1: 1108
                    width: 1068
                    y_top_value_30: 34
                    y_baseline_value_0: 234
                    px_per_unit: 6.667
                  grid:
                    lines:
                      - value: 30
                        'y': 34
                      - value: 20
                        'y': 100.67
                      - value: 10
                        'y': 167.33
                      - value: 0
                        'y': 234
                    height: 1
                    x: 40
                    width: 1068
                    color: var(--color-border,#d6d3ca)
                  y_axis_labels:
                    values:
                      - '0'
                      - '10'
                      - '20'
                      - '30'
                    right_edge_x: 36
                    vertical: centered on grid line (top = y-8)
                  x_axis_labels:
                    'y': 242
                    centered_on_points: true
                  series:
                    new:
                      color: var(--color-chart-series-a,#494fe5)
                      stroke_width: 2
                      linecap: round
                      linejoin: round
                      interpolation: straight segments (polyline)
                    done:
                      color: var(--proposal/chart-outflow,#0d9488)
                      token_note: chart-outflow is a Figma "proposal/" variable, not an existing project token
                      stroke_width: 2
                      linecap: round
                      linejoin: round
                      interpolation: straight segments (polyline)
                  points:
                    radius: 3.5
                    fill: series colour
                    stroke: '#fafaf7 (surface)'
                    stroke_width: 2
                    emphasized_point:
                      radius: 5.25
                      stroke_width: 2.5
                      note: 'one point per series drawn larger (week: Tue 13, month: day 9 — the day of the peak "new" value)'
                  area_between_lines:
                    backlog_grows:
                      when: new above done
                      fill: var(--color-state-unassigned-tint,#ffe2dd)
                    backlog_shrinks:
                      when: done above new
                      fill: var(--color-state-running-tint,#d9f2ee)
                    segmentation: one fill polygon per day interval, split at line crossings (narrow slices at crossings)
                    draw_order: fills, then done line, then new line, then points
                  end_labels:
                    x: 1118
                    texts:
                      - new
                      - done
                    vertical: next to each series last point
                  ratio:
                    x: right-aligned, left ≈1063-1067
                    'y': 4
                    display: flex row
                    align: center
                    gap: 6
                    texts:
                      - 'done : new'
                      - <ratio>
                  legend:
                    x: 40
                    'y': 282
                    display: flex row
                    gap: 16
                    item_gap: 6
                    items:
                      - swatch: line 16x2 radius 1
                        color: var(--color-chart-series-a,#494fe5)
                        text: new <total>
                      - swatch: line 16x2 radius 1
                        color: var(--proposal/chart-outflow,#0d9488)
                        text: done <total>
                      - swatch: square 10x10 radius 1
                        color: var(--color-state-unassigned-tint,#ffe2dd)
                        text: backlog grows
                      - swatch: square 10x10 radius 1
                        color: var(--color-state-running-tint,#d9f2ee)
                        text: backlog shrinks
                  hover_layers_hidden: Hover column + light tooltip exist in the component (hover=false here); not in scope.
                  x_labels:
                    - Mon 12
                    - Tue 13
                    - Wed 14
                    - Thu 15
                    - Fri 16
                    - Sat 17
                    - Sun 18
                  point_x:
                    - 40
                    - 218
                    - 396
                    - 574
                    - 752
                    - 930
                    - 1108
                  column_width: 178
                  values:
                    new:
                      - 14
                      - 22
                      - 11
                      - 9
                      - 15
                      - 4
                      - 2
                    done:
                      - 12
                      - 10
                      - 13
                      - 18
                      - 21
                      - 3
                      - 1
                  running_section: null
                  ratio_value: '1.01'
                  legend_totals:
                    new: 77
                    done: 78
                  end_label_y:
                    new: 208
                    done: 224
                tokens_observed:
                  color-title: '#14171a'
                  color-text: '#2c3137'
                  color-text-light: '#5b6169'
                  color-border: '#d6d3ca'
                  color-app: '#f1f0ea'
                  color-surface: '#fafaf7'
                  color-surface-3: '#d6d3ca'
                  color-chart-series-a: '#494fe5'
                  proposal/chart-outflow: '#0d9488'
                  color-state-unassigned-tint: '#ffe2dd'
                  color-state-running-tint: '#d9f2ee'
              typography:
                - role: heading
                  style: vorschlag/section-title
                  family: SF Pro
                  weight: 700
                  size: 16
                  line_height: 22
                  letter_spacing_figma: -0.5
                  letter_spacing_px_code: -0.08
                  color: var(--color-title,#14171a)
                - role: caption
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text-light,#5b6169)
                - role: axis-label
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text-light,#5b6169)
                - role: series-end-label
                  style: vorschlag/label
                  family: SF Pro
                  weight: 510
                  size: 12
                  line_height: 16
                  color: 'series colour (new: var(--color-chart-series-a,#494fe5); done: var(--proposal/chart-outflow,#0d9488))'
                - role: ratio-label
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text-light,#5b6169)
                - role: ratio-value
                  style: vorschlag/body-strong
                  family: SF Pro
                  weight: 510
                  size: 13
                  line_height: 20
                  color: var(--color-title,#14171a)
                - role: legend-label
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text,#2c3137)
                - role: eyebrow (out of scope context)
                  style: vorschlag/eyebrow
                  family: SF Pro
                  weight: 590
                  size: 11
                  line_height: 14
                  letter_spacing_px: 0.44
                  transform: uppercase
                  color: var(--color-text-light,#5b6169)
              content:
                - node: '184:14508'
                  text: New vs. done
                - node: '184:14509'
                  text: Per day, UTC
                - node: I184:14510;177:1088
                  text: 'done : new 1.01'
                - node: I184:14510;177:1091
                  text: new 77 · done 78 · backlog grows · backlog shrinks
                - node: '184:14510'
                  text: 'x-axis: Mon 12, Tue 13, Wed 14, Thu 15, Fri 16, Sat 17, Sun 18'
              interactions:
                - state: hover
                  available: false
                  note: Not captured in this subject; flow-chart-tooltip covers the AC tooltip.
              properties:
                figma_component_variant_node: '177:1043'
                instance_node: '184:14510'
                note_instance_child_ids: Instance child ids are I<instance>;<main-component child id> from get_design_context data-node-id (grid0 = baseline grid line 0; backlog fill slices are separate per-interval vectors, not listed).
            dependencies:
              parent_ids: []
              asset_ids:
                - https://www.figma.com/api/mcp/asset/816b740c-81f1-4738-b609-60f02e194dea.svg
                - https://www.figma.com/api/mcp/asset/c31ac3d1-9a99-40c3-902d-73b07692f842.svg
                - https://www.figma.com/api/mcp/asset/a400373c-6d1e-4577-9275-12c37ad9e9c7.svg
              font_families:
                - SF Pro
            unavailable:
              - property: fonts.SF Pro.files
                reason: Figma MCP tools expose family/style/weight only; no font binaries are downloadable for SF Pro (Apple system font, licence-restricted).
                required: false
              - property: source.revision
                reason: Figma MCP tools return no file version id; revision recorded as null.
                required: false
      - id: flow-chart-month
        locator:
          kind: figma-node
          value: '184:14571'
        samples:
          - view: desktop
            state: default
            structure:
              roots:
                - '184:14571'
              nodes:
                - id: '184:14571'
                  kind: FRAME
                  locator:
                    kind: figma-node
                    value: '184:14571'
                  children:
                    - '184:14572'
                    - '184:14573'
                    - '184:14593'
                    - '184:14596'
                - id: '184:14572'
                  kind: TEXT
                  locator:
                    kind: figma-node
                    value: '184:14572'
                  children: []
                - id: '184:14573'
                  kind: FRAME
                  locator:
                    kind: figma-node
                    value: '184:14573'
                  children: []
                - id: '184:14593'
                  kind: FRAME
                  locator:
                    kind: figma-node
                    value: '184:14593'
                  children:
                    - '184:14594'
                    - '184:14595'
                - id: '184:14594'
                  kind: TEXT
                  locator:
                    kind: figma-node
                    value: '184:14594'
                  children: []
                - id: '184:14595'
                  kind: TEXT
                  locator:
                    kind: figma-node
                    value: '184:14595'
                  children: []
                - id: '184:14596'
                  kind: INSTANCE
                  locator:
                    kind: figma-node
                    value: '184:14596'
                  children:
                    - I184:14596;177:1124
                    - I184:14596;177:1157
                    - I184:14596;177:1158
                    - I184:14596;177:1161
                    - I184:14596;177:1212
                    - I184:14596;177:1215
                - id: I184:14596;177:1124
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14596;177:1124
                  children: []
                - id: I184:14596;177:1157
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14596;177:1157
                  children: []
                - id: I184:14596;177:1158
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14596;177:1158
                  children: []
                - id: I184:14596;177:1161
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14596;177:1161
                  children: []
                - id: I184:14596;177:1212
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14596;177:1212
                  children: []
                - id: I184:14596;177:1215
                  kind: LAYER
                  locator:
                    kind: figma-node
                    value: I184:14596;177:1215
                  children: []
            observations:
              layout:
                frame:
                  width: 1228
                  height: 466
                  display: flex column
                  gap: 16
                  padding: 24
                  background: var(--color-app,#f1f0ea)
                  border: 1px solid var(--color-border,#d6d3ca)
                  radius: 12
                out_of_scope_note: The subject locator is the whole Zeitraum frame because heading row and Flow chart instance have no smaller common parent. The eyebrow text and the Period range row (instance + "vs. ..." text) are out of scope (separate ticket).
                heading_row:
                  display: flex row
                  align: baseline
                  gap: 10
                  y_in_frame: 103
                  height: 22
                chart:
                  component: Flow chart (component set 177:2019), variant Range=Month, Size=Wide, hover=false
                  component_description: 'Fluss-Diagramm (Entwurf F): neu und done als Linien mit Punkten, Fläche dazwischen rot = Backlog wächst, teal = schrumpft. Range bestimmt die Gruppierung (Tag/Tag/Woche/Monat/Quartal), Size Wide 1160 / Compact 768. Hover zeigt Spalte + Tooltip (Datum, New, Done, Backlog ±).'
                  width: 1160
                  height: 300
                  y_in_frame: 141
                  plot_area:
                    x0: 40
                    x1: 1108
                    width: 1068
                    y_top_value_30: 34
                    y_baseline_value_0: 234
                    px_per_unit: 6.667
                  grid:
                    lines:
                      - value: 30
                        'y': 34
                      - value: 20
                        'y': 100.67
                      - value: 10
                        'y': 167.33
                      - value: 0
                        'y': 234
                    height: 1
                    x: 40
                    width: 1068
                    color: var(--color-border,#d6d3ca)
                  y_axis_labels:
                    values:
                      - '0'
                      - '10'
                      - '20'
                      - '30'
                    right_edge_x: 36
                    vertical: centered on grid line (top = y-8)
                  x_axis_labels:
                    'y': 242
                    centered_on_points: true
                  series:
                    new:
                      color: var(--color-chart-series-a,#494fe5)
                      stroke_width: 2
                      linecap: round
                      linejoin: round
                      interpolation: straight segments (polyline)
                    done:
                      color: var(--proposal/chart-outflow,#0d9488)
                      token_note: chart-outflow is a Figma "proposal/" variable, not an existing project token
                      stroke_width: 2
                      linecap: round
                      linejoin: round
                      interpolation: straight segments (polyline)
                  points:
                    radius: 3.5
                    fill: series colour
                    stroke: '#fafaf7 (surface)'
                    stroke_width: 2
                    emphasized_point:
                      radius: 5.25
                      stroke_width: 2.5
                      note: 'one point per series drawn larger (week: Tue 13, month: day 9 — the day of the peak "new" value)'
                  area_between_lines:
                    backlog_grows:
                      when: new above done
                      fill: var(--color-state-unassigned-tint,#ffe2dd)
                    backlog_shrinks:
                      when: done above new
                      fill: var(--color-state-running-tint,#d9f2ee)
                    segmentation: one fill polygon per day interval, split at line crossings (narrow slices at crossings)
                    draw_order: fills, then done line, then new line, then points
                  end_labels:
                    x: 1118
                    texts:
                      - new
                      - done
                    vertical: next to each series last point
                  ratio:
                    x: right-aligned, left ≈1063-1067
                    'y': 4
                    display: flex row
                    align: center
                    gap: 6
                    texts:
                      - 'done : new'
                      - <ratio>
                  legend:
                    x: 40
                    'y': 282
                    display: flex row
                    gap: 16
                    item_gap: 6
                    items:
                      - swatch: line 16x2 radius 1
                        color: var(--color-chart-series-a,#494fe5)
                        text: new <total>
                      - swatch: line 16x2 radius 1
                        color: var(--proposal/chart-outflow,#0d9488)
                        text: done <total>
                      - swatch: square 10x10 radius 1
                        color: var(--color-state-unassigned-tint,#ffe2dd)
                        text: backlog grows
                      - swatch: square 10x10 radius 1
                        color: var(--color-state-running-tint,#d9f2ee)
                        text: backlog shrinks
                  hover_layers_hidden: Hover column + light tooltip exist in the component (hover=false here); not in scope.
                  x_labels_shown:
                    - '1'
                    - '4'
                    - '7'
                    - '10'
                    - '13'
                    - '16'
                    - '20'
                  x_label_running_suffix:
                    text: running
                    'y': 258
                    under: '20'
                  point_x_step: 56.21
                  days: 20
                  values:
                    new:
                      - 9
                      - 12
                      - 14
                      - 11
                      - 13
                      - 6
                      - 4
                      - 22
                      - 24
                      - 19
                      - 11
                      - 14
                      - 5
                      - 3
                      - 8
                      - 9
                      - 10
                      - 12
                      - 13
                      - 8
                    done:
                      - 10
                      - 11
                      - 12
                      - 12
                      - 13
                      - 5
                      - 3
                      - 10
                      - 11
                      - 12
                      - 12
                      - 13
                      - 4
                      - 2
                      - 19
                      - 21
                      - 18
                      - 11
                      - 12
                      - 4
                  running_section:
                    span: last interval day 19 -> 20 (x 1051.8 -> 1108); 20 Oct is still running
                    lines: dashed (pre-dashed path, ~1.5px dashes, round caps, stroke 2) in series colour
                    last_points: 'hollow: fill #fafaf7, stroke series colour 2px, r 3.5 (cut / not final value)'
                    fill: area between dashed segments still filled (backlog grows tint in this sample)
                  ratio_value: '0.96'
                  legend_totals:
                    new: 219
                    done: 211
                  end_label_y:
                    new: 172.67
                    done: 199.33
                tokens_observed:
                  color-title: '#14171a'
                  color-text: '#2c3137'
                  color-text-light: '#5b6169'
                  color-border: '#d6d3ca'
                  color-app: '#f1f0ea'
                  color-surface: '#fafaf7'
                  color-surface-3: '#d6d3ca'
                  color-chart-series-a: '#494fe5'
                  proposal/chart-outflow: '#0d9488'
                  color-state-unassigned-tint: '#ffe2dd'
                  color-state-running-tint: '#d9f2ee'
              typography:
                - role: heading
                  style: vorschlag/section-title
                  family: SF Pro
                  weight: 700
                  size: 16
                  line_height: 22
                  letter_spacing_figma: -0.5
                  letter_spacing_px_code: -0.08
                  color: var(--color-title,#14171a)
                - role: caption
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text-light,#5b6169)
                - role: axis-label
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text-light,#5b6169)
                - role: series-end-label
                  style: vorschlag/label
                  family: SF Pro
                  weight: 510
                  size: 12
                  line_height: 16
                  color: 'series colour (new: var(--color-chart-series-a,#494fe5); done: var(--proposal/chart-outflow,#0d9488))'
                - role: ratio-label
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text-light,#5b6169)
                - role: ratio-value
                  style: vorschlag/body-strong
                  family: SF Pro
                  weight: 510
                  size: 13
                  line_height: 20
                  color: var(--color-title,#14171a)
                - role: legend-label
                  style: vorschlag/meta
                  family: SF Pro
                  weight: 400
                  size: 12
                  line_height: 16
                  color: var(--color-text,#2c3137)
                - role: eyebrow (out of scope context)
                  style: vorschlag/eyebrow
                  family: SF Pro
                  weight: 590
                  size: 11
                  line_height: 14
                  letter_spacing_px: 0.44
                  transform: uppercase
                  color: var(--color-text-light,#5b6169)
              content:
                - node: '184:14594'
                  text: New vs. done
                - node: '184:14595'
                  text: Per day, UTC · 20 Oct is still running
                - node: I184:14596;177:1212
                  text: 'done : new 0.96'
                - node: I184:14596;177:1215
                  text: new 219 · done 211 · backlog grows · backlog shrinks
                - node: '184:14596'
                  text: 'x-axis: 1, 4, 7, 10, 13, 16, 20'
              interactions:
                - state: hover
                  available: false
                  note: Not captured in this subject; flow-chart-tooltip covers the AC tooltip.
              properties:
                figma_component_variant_node: '177:1121'
                instance_node: '184:14596'
                note_instance_child_ids: Instance child ids are I<instance>;<main-component child id> from get_design_context data-node-id (grid0 = baseline grid line 0; backlog fill slices are separate per-interval vectors, not listed).
            dependencies:
              parent_ids: []
              asset_ids:
                - https://www.figma.com/api/mcp/asset/3abe401e-c745-4c2d-ae0d-219f5bf57889.svg
                - https://www.figma.com/api/mcp/asset/129e108a-9e2a-4495-a41f-71e18648318c.svg
                - https://www.figma.com/api/mcp/asset/bb63291b-30af-42cc-8908-e1f17ef03447.svg
                - https://www.figma.com/api/mcp/asset/468246bb-feab-4862-9e3e-0eecb9740c70.svg
                - https://www.figma.com/api/mcp/asset/f5385374-dfcf-4c6f-aa50-c516e7d6f755.svg
              font_families:
                - SF Pro
            unavailable:
              - property: fonts.SF Pro.files
                reason: Figma MCP tools expose family/style/weight only; no font binaries are downloadable for SF Pro (Apple system font, licence-restricted).
                required: false
              - property: source.revision
                reason: Figma MCP tools return no file version id; revision recorded as null.
                required: false
              - property: chart.series.stroke_dasharray
                reason: Running segments are exported as pre-dashed SVG paths (separate subpaths), not as a dash property; dash/gap lengths are only derivable from path geometry (~1.5px dash, ~3.5px gap along the segment at 2px stroke, round caps).
                required: false
    parents: []
    images:
      - url: https://www.figma.com/api/mcp/asset/816b740c-81f1-4738-b609-60f02e194dea.svg
        reference_path: assets/flow-chart-week-new.svg
        role: illustration
        alt: new line (week)
        location: main
        width: '1070'
        height: '135.4'
      - url: https://www.figma.com/api/mcp/asset/c31ac3d1-9a99-40c3-902d-73b07692f842.svg
        reference_path: assets/flow-chart-week-done.svg
        role: illustration
        alt: done line (week)
        location: main
        width: '1070'
        height: '135.3'
      - url: https://www.figma.com/api/mcp/asset/a400373c-6d1e-4577-9275-12c37ad9e9c7.svg
        reference_path: assets/flow-chart-week-points.svg
        role: illustration
        alt: points (week)
        location: main
        width: '1160'
        height: '300'
      - url: https://www.figma.com/api/mcp/asset/3abe401e-c745-4c2d-ae0d-219f5bf57889.svg
        reference_path: assets/flow-chart-month-new.svg
        role: illustration
        alt: new line (month)
        location: main
        width: '1013.8'
        height: '142'
      - url: https://www.figma.com/api/mcp/asset/129e108a-9e2a-4495-a41f-71e18648318c.svg
        reference_path: assets/flow-chart-month-done.svg
        role: illustration
        alt: done line (month)
        location: main
        width: '1013.8'
        height: '128.7'
      - url: https://www.figma.com/api/mcp/asset/bb63291b-30af-42cc-8908-e1f17ef03447.svg
        reference_path: assets/flow-chart-month-new-running.svg
        role: illustration
        alt: new running dashed segment
        location: main
        width: '58.2'
        height: '35.4'
      - url: https://www.figma.com/api/mcp/asset/468246bb-feab-4862-9e3e-0eecb9740c70.svg
        reference_path: assets/flow-chart-month-done-running.svg
        role: illustration
        alt: done running dashed segment
        location: main
        width: '58.2'
        height: '55.3'
      - url: https://www.figma.com/api/mcp/asset/f5385374-dfcf-4c6f-aa50-c516e7d6f755.svg
        reference_path: assets/flow-chart-month-points.svg
        role: illustration
        alt: points incl. hollow running points (month)
        location: main
        width: '1160'
        height: '300'
    fonts:
      - family: SF Pro
        source: system
        weights:
          - 400
          - 510
          - 590
          - 700
        styles:
          - normal
        files: []
    captures:
      - subject: flow-chart-week
        view: desktop
        state: default
        path: desktop--flow-chart-week--default.png
        width: 1228
        height: 466
      - subject: flow-chart-month
        view: desktop
        state: default
        path: desktop--flow-chart-month--default.png
        width: 1228
        height: 466
  decisions: 'Add four semantic colour tokens next to chart-series-* in semantic.color (light) and themes.dark.semantic.color, each with $description: chart-flow-new = primitive behind chart-series-a (violet-600 light / violet-400 dark; observed var(--color-chart-series-a,#494fe5)); chart-flow-done = teal-600 light / teal-400 dark (observed Figma proposal chart-outflow #0d9488 = existing primitive teal-600; addition: dark-mode step teal-400 mirrors chart-series-b dark); chart-flow-grows = primitive behind state-unassigned-tint (red-100 light / red-800 dark); chart-flow-shrinks = primitive behind state-running-tint (teal-100 light / teal-800 dark). No new primitives. Preserve every other token unchanged. Regenerate CSS via pnpm run generate:variables. Prepared request fingerprint f8517795afe8a19cbbb0cf6bb3ad189b8c762f232b6989850ec2df3015e3319d (flow-chart-week, flow-chart-month @ default @ desktop).'
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
      path: web/themes/custom/bb_theme/designbook/design-system/design-tokens.yml
  ```

  #### Results
  <!-- done -->

