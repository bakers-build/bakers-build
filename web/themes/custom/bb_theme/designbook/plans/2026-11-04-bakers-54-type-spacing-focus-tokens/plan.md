# Plan: tokens
<!-- digest: fe0d24e8df8a1100ab6fb1aaf10826651e49ff50d5742bc47a586b896fd01a80 -->

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

- [x] create-tokens — BAKERS-54 type, spacing and focus tokens

  Instruction: task:create-tokens

  #### Params
  ```yaml
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
  reference_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-54-vorschl-ge-typo/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/c666d120267b60a5
  extract:
    subjects:
      - id: typo-system
        locator:
          kind: figma-node
          value: '68:13'
        samples:
          - view: frame
            state: rest
            structure:
              roots:
                - '68:13'
              nodes:
                - id: '68:13'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '68:13'
                  children: []
            observations:
              typography:
                - node: '68:54'
                  text_style: vorschlag/page-title
                  fontFamily: SF Pro
                  fontWeight: 700
                  fontSize: 24
                  lineHeight: 30
                  letterSpacing: -1
                  label: page-title 24/700/30
                - node: '68:57'
                  text_style: vorschlag/section-title
                  fontFamily: SF Pro
                  fontWeight: 700
                  fontSize: 16
                  lineHeight: 22
                  letterSpacing: -0.5
                  label: section-title 16/700/22
                - node: '68:60'
                  text_style: vorschlag/item-title
                  fontFamily: SF Pro
                  fontWeight: 590
                  fontSize: 14
                  lineHeight: 20
                  letterSpacing: 0
                  label: item-title 14/600/20
                - node: '68:63'
                  text_style: vorschlag/body-strong
                  fontFamily: SF Pro
                  fontWeight: 510
                  fontSize: 13
                  lineHeight: 20
                  letterSpacing: 0
                  label: body-strong 13/500/20
                - node: '68:66'
                  text_style: vorschlag/body
                  fontFamily: SF Pro
                  fontWeight: 400
                  fontSize: 13
                  lineHeight: 20
                  letterSpacing: 0
                  label: body 13/400/20
                - node: '68:69'
                  text_style: vorschlag/prose
                  fontFamily: SF Pro
                  fontWeight: 400
                  fontSize: 13
                  lineHeight: 21
                  letterSpacing: 0
                  label: prose 13/400/21
                - node: '68:72'
                  text_style: vorschlag/label
                  fontFamily: SF Pro
                  fontWeight: 510
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  label: label 12/500/16
                - node: '68:75'
                  text_style: vorschlag/meta
                  fontFamily: SF Pro
                  fontWeight: 400
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  label: meta 12/400/16
                - node: '68:78'
                  text_style: vorschlag/data
                  fontFamily: JetBrains Mono
                  fontWeight: 500
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  label: data 12/500/16
                - node: '68:81'
                  text_style: vorschlag/eyebrow
                  fontFamily: SF Pro
                  fontWeight: 590
                  fontSize: 11
                  lineHeight: 14
                  letterSpacing: 4
                  label: eyebrow 11/600/14
                - node: '68:84'
                  text_style: vorschlag/badge
                  fontFamily: SF Pro
                  fontWeight: 590
                  fontSize: 11
                  lineHeight: 14
                  letterSpacing: 0
                  label: badge 11/600/14
                - node: '68:87'
                  text_style: vorschlag/stat-value
                  fontFamily: SF Pro
                  fontWeight: 590
                  fontSize: 24
                  lineHeight: 28
                  letterSpacing: 0
                  label: stat-value 24/600/28
              properties:
                spacing_roles_px:
                  inline-xs: 4
                  inline: 8
                  stack: 12
                  group: 16
                  gutter: 24
                  section: 32
                heading_space_above_px: 32
                heading_space_below_px: 12
                prose_max_width: 72ch ≈ 620px
                control_height_px: 32
                card_padding_px: 16
                card_radius_px: 7
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - SF Pro
                - JetBrains Mono
            unavailable:
              - property: variable collection 'GAIA · Vorschlag Layout' values
                reason: The spacing variables are not bound to the swatch nodes, so the tools return no variable values; the values come from the swatch sizes and labels.
                required: false
      - id: ci-board
        locator:
          kind: figma-node
          value: '550:8970'
        samples:
          - view: frame
            state: rest
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
                - node: '550:8977'
                  fontFamily: Bricolage Grotesque
                  fontWeight: 700
                  fontSize: 24
                  lineHeight: 30
                  letterSpacing: -0.24
                  fontVariationSettings: '"opsz" 14, "wdth" 100'
                  role: page title
                - node: '550:8978'
                  fontFamily: Spline Sans
                  fontWeight: 400
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  role: page description
                - node: '550:8992'
                  fontFamily: Spline Sans
                  fontWeight: 500
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  role: toolbar label
                - node: '550:9011'
                  fontFamily: Spline Sans
                  fontWeight: 400
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  role: result count
                - node: '550:9016'
                  fontFamily: Spline Sans
                  fontWeight: 600
                  fontSize: 16
                  lineHeight: 22
                  letterSpacing: -0.08
                  role: lane title
                - node: '550:9017'
                  fontFamily: Spline Sans
                  fontWeight: 400
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  role: lane count
                - node: '550:9021'
                  fontFamily: Spline Sans Mono
                  fontWeight: 500
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  role: ticket key
                - node: '550:9024'
                  fontFamily: Spline Sans
                  fontWeight: 600
                  fontSize: 14
                  lineHeight: 20
                  letterSpacing: 0
                  role: card title
                - node: '550:9055'
                  fontFamily: Spline Sans
                  fontWeight: 400
                  fontSize: 12
                  lineHeight: 16
                  letterSpacing: 0
                  role: empty lane
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - Bricolage Grotesque
                - Spline Sans
                - Spline Sans Mono
            unavailable:
              - property: text inside component instances (tabs, pills, badges, buttons, status bar)
                reason: Instance contents were not read node by node; the screenshot shows them.
                required: false
      - id: focus-keyboard
        locator:
          kind: figma-node
          value: '61:3220'
        samples:
          - view: frame
            state: rest
            structure:
              roots:
                - '61:3220'
              nodes:
                - id: '61:3220'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '61:3220'
                  children: []
            observations: {}
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - SF Pro
            unavailable: []
      - id: data-formats
        locator:
          kind: figma-node
          value: '64:3709'
        samples:
          - view: frame
            state: rest
            structure:
              roots:
                - '64:3709'
              nodes:
                - id: '64:3709'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '64:3709'
                  children: []
            observations: {}
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - SF Pro
            unavailable:
              - property: exact parent frames of the rule and example texts
                reason: The nodes are listed under the section root; intermediate table frames are omitted.
                required: false
    parents: []
    images: []
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
      - family: JetBrains Mono
        source: google
        weights:
          - 500
        styles:
          - normal
        files:
          - format: woff2
            style: normal
            src_url: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwGtT0rU.woff2
            local_path: assets/fonts/jetbrains-mono.woff2
      - family: Bricolage Grotesque
        source: google
        weights:
          - 700
        styles:
          - normal
        files:
          - format: woff2
            style: normal
            src_url: https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y996as8bTXq_nANBjzKo3IeZx8z6up5L-iNGfyOPPs.woff2
            local_path: assets/fonts/bricolage-grotesque.woff2
      - family: Spline Sans
        source: google
        weights:
          - 400
          - 500
          - 600
        styles:
          - normal
        files:
          - format: woff2
            style: normal
            src_url: https://fonts.gstatic.com/s/splinesans/v16/_6_7ED73Uf-2WfU2LzycEbAimC0dSh5i.woff2
            local_path: assets/fonts/spline-sans.woff2
      - family: Spline Sans Mono
        source: google
        weights:
          - 500
        styles:
          - normal
        files:
          - format: woff2
            style: normal
            src_url: https://fonts.gstatic.com/s/splinesansmono/v13/R70BjzAei_CDNLfgZxrW6wrZOF2WX5KZmE-Z-lw.woff2
            local_path: assets/fonts/spline-sans-mono.woff2
    captures:
      - subject: typo-system
        view: frame
        state: rest
        path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-54-vorschl-ge-typo/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/c666d120267b60a5/frame--typo-system--rest.png
        width: 1434
        height: 2246
      - subject: ci-board
        view: frame
        state: rest
        path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-54-vorschl-ge-typo/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/c666d120267b60a5/frame--ci-board--rest.png
        width: 1440
        height: 900
      - subject: focus-keyboard
        view: frame
        state: rest
        path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-54-vorschl-ge-typo/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/c666d120267b60a5/frame--focus-keyboard--rest.png
        width: 1759
        height: 1719
      - subject: data-formats
        view: frame
        state: rest
        path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-54-vorschl-ge-typo/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/c666d120267b60a5/frame--data-formats--rest.png
        width: 1502
        height: 1179
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
  outputs:
    design_tokens:
      required: true
      schema:
        $ref: '#/definitions/DesignTokens'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-54-vorschl-ge-typo/web/themes/custom/bb_theme/designbook/design-system/design-tokens.yml
  ```

  #### Results
  <!-- done -->

