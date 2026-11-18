# Plan: tokens
<!-- digest: 6a16518b7af254a578e3bd0b82a3dcf77c53ec55ffb226d22face0f92377a6a3 -->

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

- [x] create-tokens — members and my-time row and section tokens

  Instruction: task:create-tokens

  #### Params
  ```yaml
  reference_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-57-vorschl-ge-mitg/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/96b34e1b9fb7053f
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
      - type: brand_foundation
        url: ../../../../../docs/decisions/brand-foundation.md#current-slogan
        label: Canonical provisional slogan and production-line metaphor; clients are windows onto the line.
      - type: design_system_rule
        url: designbook/design-system/action-pattern.md
        label: The action pattern — binding for every add, edit, cancel and transition surface, without variation. States when an action is confirmed (exactly when it ends or discards the ticket) and what happens instead when a single-step action has a server-side side effect (it is named at the control). Read it before designing any surface that writes.
      - type: claude_design_mcp
        url: https://api.anthropic.com/v1/design/mcp
        label: claude_design MCP — import the bakers.build designs (auth via /design-login). project 6dc13314-59d8-44e4-b81f-dad03ff46dfa; read via get_project/list_files/get_file → screen HTMLs (Dashboard/Ticket/Login/ Logo) + bakers.build Design System.html (token source for design-tokens.yml).
  extract:
    subjects:
      - id: members
        locator:
          kind: figma-node
          value: '71:4410'
        samples:
          - view: desktop
            state: default
            structure:
              roots:
                - '71:4410'
              nodes:
                - id: '71:4410'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4410'
                  children:
                    - '71:4411'
                    - '71:4482'
                - id: '71:4411'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4411'
                  children: []
                - id: '71:4482'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4482'
                  children:
                    - '71:4489'
                    - '71:4494'
                    - '71:4605'
                - id: '71:4489'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4489'
                  children:
                    - '71:4490'
                - id: '71:4490'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4490'
                  children:
                    - '71:4491'
                    - '71:4483'
                - id: '71:4491'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4491'
                  children:
                    - '71:4492'
                    - '71:4493'
                - id: '71:4492'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4492'
                  children: []
                - id: '71:4493'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4493'
                  children: []
                - id: '71:4483'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4483'
                  children: []
                - id: '71:4494'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4494'
                  children:
                    - '71:4495'
                    - '71:4500'
                    - '71:4546'
                    - '71:4553'
                    - '71:4559'
                    - '71:4565'
                    - '71:4589'
                    - '71:4595'
                    - '71:4600'
                - id: '71:4495'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4495'
                  children: []
                - id: '71:4500'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4500'
                  children:
                    - '71:4501'
                - id: '71:4501'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4501'
                  children: []
                - id: '71:4546'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4546'
                  children:
                    - '71:4547'
                    - '71:4548'
                    - '71:4549'
                    - '71:4550'
                    - '71:4551'
                    - '71:4552'
                - id: '71:4547'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4547'
                  children: []
                - id: '71:4548'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4548'
                  children: []
                - id: '71:4549'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4549'
                  children: []
                - id: '71:4550'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4550'
                  children: []
                - id: '71:4551'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4551'
                  children: []
                - id: '71:4552'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4552'
                  children: []
                - id: '71:4553'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4553'
                  children:
                    - '71:4502'
                    - '71:4554'
                    - '71:4555'
                    - '71:4556'
                    - '71:4557'
                    - '71:4558'
                - id: '71:4502'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4502'
                  children: []
                - id: '71:4554'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4554'
                  children:
                    - '71:4503'
                - id: '71:4503'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4503'
                  children: []
                - id: '71:4555'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4555'
                  children:
                    - '71:4504'
                - id: '71:4504'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4504'
                  children: []
                - id: '71:4556'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4556'
                  children:
                    - '71:4510'
                - id: '71:4510'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4510'
                  children: []
                - id: '71:4557'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4557'
                  children:
                    - '71:4518'
                - id: '71:4518'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4518'
                  children: []
                - id: '71:4558'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4558'
                  children:
                    - '71:4519'
                - id: '71:4519'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4519'
                  children: []
                - id: '71:4559'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4559'
                  children:
                    - '71:4524'
                    - '71:4560'
                    - '71:4561'
                    - '71:4562'
                    - '71:4563'
                    - '71:4564'
                - id: '71:4524'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4524'
                  children: []
                - id: '71:4560'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4560'
                  children:
                    - '71:4525'
                - id: '71:4525'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4525'
                  children: []
                - id: '71:4561'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4561'
                  children:
                    - '71:4526'
                - id: '71:4526'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4526'
                  children: []
                - id: '71:4562'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4562'
                  children:
                    - '71:4532'
                - id: '71:4532'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4532'
                  children: []
                - id: '71:4563'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4563'
                  children:
                    - '71:4540'
                - id: '71:4540'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4540'
                  children: []
                - id: '71:4564'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4564'
                  children:
                    - '71:4541'
                - id: '71:4541'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4541'
                  children: []
                - id: '71:4565'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4565'
                  children:
                    - '71:4566'
                - id: '71:4566'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4566'
                  children: []
                - id: '71:4589'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4589'
                  children:
                    - '71:4590'
                    - '71:4591'
                    - '71:4592'
                    - '71:4593'
                    - '71:4594'
                - id: '71:4590'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4590'
                  children: []
                - id: '71:4591'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4591'
                  children: []
                - id: '71:4592'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4592'
                  children: []
                - id: '71:4593'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4593'
                  children: []
                - id: '71:4594'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4594'
                  children: []
                - id: '71:4595'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4595'
                  children:
                    - '71:4567'
                    - '71:4596'
                    - '71:4597'
                    - '71:4598'
                    - '71:4599'
                - id: '71:4567'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4567'
                  children:
                    - '71:4568'
                    - '71:4570'
                    - '71:4571'
                - id: '71:4568'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4568'
                  children: []
                - id: '71:4570'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4570'
                  children: []
                - id: '71:4571'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4571'
                  children: []
                - id: '71:4596'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4596'
                  children:
                    - '71:4572'
                - id: '71:4572'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4572'
                  children: []
                - id: '71:4597'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4597'
                  children:
                    - '71:4573'
                - id: '71:4573'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4573'
                  children: []
                - id: '71:4598'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4598'
                  children:
                    - '71:4574'
                - id: '71:4574'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4574'
                  children: []
                - id: '71:4599'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4599'
                  children:
                    - '71:4575'
                - id: '71:4575'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4575'
                  children: []
                - id: '71:4600'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4600'
                  children:
                    - '71:4576'
                    - '71:4601'
                    - '71:4602'
                    - '71:4603'
                    - '71:4604'
                - id: '71:4576'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4576'
                  children:
                    - '71:4577'
                    - '71:4579'
                    - '71:4580'
                - id: '71:4577'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4577'
                  children: []
                - id: '71:4579'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4579'
                  children: []
                - id: '71:4580'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4580'
                  children: []
                - id: '71:4601'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4601'
                  children:
                    - '71:4581'
                - id: '71:4581'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4581'
                  children: []
                - id: '71:4602'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4602'
                  children:
                    - '71:4582'
                - id: '71:4582'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4582'
                  children: []
                - id: '71:4603'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4603'
                  children:
                    - '71:4583'
                - id: '71:4583'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '71:4583'
                  children: []
                - id: '71:4604'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '71:4604'
                  children:
                    - '71:4584'
                - id: '71:4584'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4584'
                  children: []
                - id: '71:4605'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '71:4605'
                  children: []
            observations:
              typography:
                - role: page-title
                  font-family: Spline Sans
                  font-weight: 700
                  font-size: 24px
                  line-height: 30px
                  color: title
                  nodes:
                    - '71:4492'
                - role: meta
                  font-family: Spline Sans
                  font-weight: 400
                  font-size: 12px
                  line-height: 16px
                  color: text-light
                  nodes:
                    - '71:4493'
                    - '71:4518'
                    - '71:4540'
                    - '71:4574'
                    - '71:4583'
                    - '71:4571'
                    - '71:4580'
                - role: section-title
                  font-family: Spline Sans
                  font-weight: 700
                  font-size: 16px
                  line-height: 22px
                  color: title
                  nodes:
                    - '71:4501'
                    - '71:4566'
                - role: column-label
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 12px
                  line-height: 16px
                  color: text-light
                  nodes:
                    - '71:4547'
                    - '71:4548'
                    - '71:4549'
                    - '71:4550'
                    - '71:4551'
                    - '71:4590'
                    - '71:4591'
                    - '71:4592'
                    - '71:4593'
                - role: body-strong
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 13px
                  line-height: 20px
                  color: text
                  nodes:
                    - '71:4502'
                    - '71:4524'
                    - '71:4570'
                    - '71:4579'
                - role: body
                  font-family: Spline Sans
                  font-weight: 400
                  font-size: 13px
                  line-height: 20px
                  color: text
                  nodes:
                    - '71:4503'
                    - '71:4572'
                    - '71:4581'
                    - '71:4573'
                    - '71:4582'
                - role: badge
                  font-family: Spline Sans
                  font-weight: 600
                  font-size: 11px
                  line-height: '1.2'
                  color: state ink
                  nodes:
                    - '71:4504'
                    - '71:4510'
                    - '71:4526'
                    - '71:4532'
              properties:
                '71:4410':
                  name: 4 · Nachher · Mitglieder
                  box:
                    x: 0
                    'y': 0
                    width: 1440
                    height: 900
                '71:4411':
                  name: Sidebar
                  box:
                    x: 0
                    'y': 0
                    width: 232
                    height: 900
                '71:4482':
                  name: Main
                  box:
                    x: 232
                    'y': 0
                    width: 1208
                    height: 900
                '71:4489':
                  name: Header
                  box:
                    x: 232
                    'y': 0
                    width: 1208
                    height: 83
                '71:4490':
                  name: Frame
                  box:
                    x: 232
                    'y': 0
                    width: 1208
                    height: 82
                '71:4491':
                  name: Frame
                  box:
                    x: 256
                    'y': 16
                    width: 1014
                    height: 50
                '71:4492':
                  name: Members
                  box:
                    x: 256
                    'y': 16
                    width: 107
                    height: 30
                  style:
                    font-family: Spline Sans
                    font-weight: 700
                    font-size: 24px
                    line-height: 30px
                    color: 'var(--color-title) #14171a'
                    letter-spacing: '-0.24px'
                '71:4493':
                  name: keytec · who belongs to this workspace and in which role
                  box:
                    x: 256
                    'y': 50
                    width: 304
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4483':
                  name: Button
                  box:
                    x: 1282
                    'y': 26
                    width: 134
                    height: 30
                  style:
                    background: 'var(--color-primary) #494fe5'
                    height: 30px
                    padding: 0 10px
                    border-radius: var(--radius-sm) 7px
                    gap: 6px
                    font: Spline Sans 700 12px/1.45
                    color: var(--color-on-primary) white
                '71:4494':
                  name: Body (max 960)
                  box:
                    x: 232
                    'y': 83
                    width: 1008
                    height: 789
                  style:
                    display: flex
                    flex-direction: column
                    padding: 16px 24px 24px 24px
                    width: 1008px
                    content-width: 960px
                '71:4495':
                  name: Message
                  box:
                    x: 256
                    'y': 99
                    width: 960
                    height: 36
                  style:
                    background: 'var(--color-state-running-tint) #d9f2ee'
                    height: 36px
                    border-radius: var(--radius-sm) 7px
                    padding: 10px 16px
                    gap: 10px
                '71:4500':
                  name: Frame
                  box:
                    x: 256
                    'y': 135
                    width: 960
                    height: 58
                  style:
                    padding: 24px 0 12px 0
                '71:4501':
                  name: Pending invitations
                  box:
                    x: 256
                    'y': 159
                    width: 144
                    height: 22
                  style:
                    font-family: Spline Sans
                    font-weight: 700
                    font-size: 16px
                    line-height: 22px
                    color: 'var(--color-title) #14171a'
                    letter-spacing: '-0.08px'
                '71:4546':
                  name: Frame
                  box:
                    x: 256
                    'y': 193
                    width: 960
                    height: 33
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    display: flex
                    gap: 16px
                    padding: 8px
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '71:4547':
                  name: Email
                  box:
                    x: 264
                    'y': 201
                    width: 272
                    height: 16
                  style:
                    column-width: flex 1
                '71:4548':
                  name: Team
                  box:
                    x: 552
                    'y': 201
                    width: 160
                    height: 16
                  style:
                    column-width: 160px
                '71:4549':
                  name: Role
                  box:
                    x: 728
                    'y': 201
                    width: 120
                    height: 16
                  style:
                    column-width: 120px
                '71:4550':
                  name: Status
                  box:
                    x: 864
                    'y': 201
                    width: 120
                    height: 16
                  style:
                    column-width: 120px
                '71:4551':
                  name: Invited
                  box:
                    x: 1000
                    'y': 201
                    width: 120
                    height: 16
                  style:
                    column-width: 120px
                '71:4552':
                  name: ''
                  box:
                    x: 1136
                    'y': 201
                    width: 72
                    height: 16
                  style:
                    column-width: 72px
                '71:4553':
                  name: Frame
                  box:
                    x: 256
                    'y': 226
                    width: 960
                    height: 44
                  style:
                    display: flex
                    gap: 16px
                    height: 44px
                    align-items: center
                    padding: 0 8px
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '71:4502':
                  name: lena.fischer@keytec.example
                  box:
                    x: 264
                    'y': 237.5
                    width: 272
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4554':
                  name: Frame
                  box:
                    x: 552
                    'y': 237.5
                    width: 160
                    height: 20
                '71:4503':
                  name: Platform crew
                  box:
                    x: 552
                    'y': 237.5
                    width: 84
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4555':
                  name: Frame
                  box:
                    x: 728
                    'y': 237.5
                    width: 120
                    height: 20
                '71:4504':
                  name: Badge
                  box:
                    x: 728
                    'y': 237.5
                    width: 79
                    height: 20
                  style:
                    height: 20px
                    padding: 0 8px
                    border-radius: var(--radius-sm) 7px
                    gap: 4px
                    font: Spline Sans 600 11px/1.2
                    background: 'var(--color-surface-3) #d6d3ca'
                    color: 'var(--color-state-offline-ink) #444a52'
                '71:4556':
                  name: Frame
                  box:
                    x: 864
                    'y': 237.5
                    width: 120
                    height: 20
                '71:4510':
                  name: Badge
                  box:
                    x: 864
                    'y': 237.5
                    width: 65
                    height: 20
                  style:
                    height: 20px
                    padding: 0 8px
                    border-radius: var(--radius-sm) 7px
                    gap: 4px
                    font: Spline Sans 600 11px/1.2
                    background: 'var(--color-state-lease-tint) #e6ebff'
                    color: 'var(--color-state-lease-ink) #303e82'
                    dot: 8px
                '71:4557':
                  name: Frame
                  box:
                    x: 1000
                    'y': 237.5
                    width: 120
                    height: 20
                '71:4518':
                  name: 12 days ago
                  box:
                    x: 1000
                    'y': 239.5
                    width: 62
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4558':
                  name: Frame
                  box:
                    x: 1136
                    'y': 237.5
                    width: 72
                    height: 20
                '71:4519':
                  name: Button
                  box:
                    x: 1136
                    'y': 232.5
                    width: 64
                    height: 30
                  style:
                    height: 30px
                    padding: 0 10px
                    border-radius: var(--radius-sm) 7px
                    font: Spline Sans 700 12px/1.45
                    color: 'var(--color-text-light) #5b6169'
                    background: none
                '71:4559':
                  name: Frame
                  box:
                    x: 256
                    'y': 270
                    width: 960
                    height: 44
                  style:
                    display: flex
                    gap: 16px
                    height: 44px
                    align-items: center
                    padding: 0 8px
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '71:4524':
                  name: m.vandijk@northwind.example
                  box:
                    x: 264
                    'y': 281.5
                    width: 272
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4560':
                  name: Frame
                  box:
                    x: 552
                    'y': 281.5
                    width: 160
                    height: 20
                '71:4525':
                  name: —
                  box:
                    x: 552
                    'y': 281.5
                    width: 13
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                '71:4561':
                  name: Frame
                  box:
                    x: 728
                    'y': 281.5
                    width: 120
                    height: 20
                '71:4526':
                  name: Badge
                  box:
                    x: 728
                    'y': 281.5
                    width: 61
                    height: 20
                  style:
                    height: 20px
                    padding: 0 8px
                    border-radius: var(--radius-sm) 7px
                    gap: 4px
                    font: Spline Sans 600 11px/1.2
                    background: 'var(--color-surface-3) #d6d3ca'
                    color: 'var(--color-state-offline-ink) #444a52'
                '71:4562':
                  name: Frame
                  box:
                    x: 864
                    'y': 281.5
                    width: 120
                    height: 20
                '71:4532':
                  name: Badge
                  box:
                    x: 864
                    'y': 281.5
                    width: 69
                    height: 20
                  style:
                    height: 20px
                    padding: 0 8px
                    border-radius: var(--radius-sm) 7px
                    gap: 4px
                    font: Spline Sans 600 11px/1.2
                    background: 'var(--color-state-unassigned-tint) #ffe2dd'
                    color: 'var(--color-state-unassigned-ink) #a5301f'
                    dot: 8px
                '71:4563':
                  name: Frame
                  box:
                    x: 1000
                    'y': 281.5
                    width: 120
                    height: 20
                '71:4540':
                  name: 26 days ago
                  box:
                    x: 1000
                    'y': 283.5
                    width: 64
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4564':
                  name: Frame
                  box:
                    x: 1136
                    'y': 281.5
                    width: 72
                    height: 20
                '71:4541':
                  name: Button
                  box:
                    x: 1136
                    'y': 276.5
                    width: 65
                    height: 30
                  style:
                    height: 30px
                    padding: 0 10px
                    border-radius: var(--radius-sm) 7px
                    font: Spline Sans 700 12px/1.45
                    color: 'var(--color-text-light) #5b6169'
                    background: none
                '71:4565':
                  name: Frame
                  box:
                    x: 256
                    'y': 314
                    width: 960
                    height: 66
                  style:
                    padding: 32px 0 12px 0
                '71:4566':
                  name: Members
                  box:
                    x: 256
                    'y': 346
                    width: 72
                    height: 22
                  style:
                    font-family: Spline Sans
                    font-weight: 700
                    font-size: 16px
                    line-height: 22px
                    color: 'var(--color-title) #14171a'
                    letter-spacing: '-0.08px'
                '71:4589':
                  name: Frame
                  box:
                    x: 256
                    'y': 380
                    width: 960
                    height: 33
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    display: flex
                    gap: 16px
                    padding: 8px
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '71:4590':
                  name: Name
                  box:
                    x: 264
                    'y': 388
                    width: 408
                    height: 16
                  style:
                    column-width: flex 1
                '71:4591':
                  name: Team
                  box:
                    x: 688
                    'y': 388
                    width: 160
                    height: 16
                  style:
                    column-width: 160px
                '71:4592':
                  name: Role
                  box:
                    x: 864
                    'y': 388
                    width: 120
                    height: 16
                  style:
                    column-width: 120px
                '71:4593':
                  name: Joined
                  box:
                    x: 1000
                    'y': 388
                    width: 120
                    height: 16
                  style:
                    column-width: 120px
                '71:4594':
                  name: ''
                  box:
                    x: 1136
                    'y': 388
                    width: 72
                    height: 16
                  style:
                    column-width: 72px
                '71:4595':
                  name: Frame
                  box:
                    x: 256
                    'y': 413
                    width: 960
                    height: 44
                  style:
                    display: flex
                    gap: 16px
                    height: 44px
                    align-items: center
                    padding: 0 8px
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '71:4567':
                  name: Frame
                  box:
                    x: 264
                    'y': 422.5
                    width: 408
                    height: 24
                '71:4568':
                  name: Avatar
                  box:
                    x: 264
                    'y': 422.5
                    width: 24
                    height: 24
                  style:
                    size: 24px
                    border-radius: 999px
                    background: 'var(--color-state-unassigned) #ff4e42'
                    font: Spline Sans 700 11px/1
                '71:4570':
                  name: Christian Wiedemann
                  box:
                    x: 296
                    'y': 424.5
                    width: 130
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4571':
                  name: christian.wiedemann@keytec.example
                  box:
                    x: 434
                    'y': 426.5
                    width: 211
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4596':
                  name: Frame
                  box:
                    x: 688
                    'y': 424.5
                    width: 160
                    height: 20
                '71:4572':
                  name: Platform crew
                  box:
                    x: 688
                    'y': 424.5
                    width: 84
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4597':
                  name: Frame
                  box:
                    x: 864
                    'y': 424.5
                    width: 120
                    height: 20
                '71:4573':
                  name: Admin
                  box:
                    x: 864
                    'y': 424.5
                    width: 39
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4598':
                  name: Frame
                  box:
                    x: 1000
                    'y': 424.5
                    width: 120
                    height: 20
                '71:4574':
                  name: 6 Jan 2026
                  box:
                    x: 1000
                    'y': 426.5
                    width: 58
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4599':
                  name: Frame
                  box:
                    x: 1136
                    'y': 424.5
                    width: 72
                    height: 20
                '71:4575':
                  name: ''
                  box:
                    x: 1136
                    'y': 426.5
                    width: 0
                    height: 16
                '71:4600':
                  name: Frame
                  box:
                    x: 256
                    'y': 457
                    width: 960
                    height: 44
                  style:
                    display: flex
                    gap: 16px
                    height: 44px
                    align-items: center
                    padding: 0 8px
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '71:4576':
                  name: Frame
                  box:
                    x: 264
                    'y': 466.5
                    width: 408
                    height: 24
                '71:4577':
                  name: Avatar
                  box:
                    x: 264
                    'y': 466.5
                    width: 24
                    height: 24
                  style:
                    size: 24px
                    border-radius: 999px
                    background: 'var(--color-state-running) #329d93'
                    font: Spline Sans 700 11px/1
                '71:4579':
                  name: Sven Gruber
                  box:
                    x: 296
                    'y': 468.5
                    width: 74
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4580':
                  name: sven.gruber@keytec.example
                  box:
                    x: 378
                    'y': 470.5
                    width: 162
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4601':
                  name: Frame
                  box:
                    x: 688
                    'y': 468.5
                    width: 160
                    height: 20
                '71:4581':
                  name: Design crew
                  box:
                    x: 688
                    'y': 468.5
                    width: 73
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4602':
                  name: Frame
                  box:
                    x: 864
                    'y': 468.5
                    width: 120
                    height: 20
                '71:4582':
                  name: Member
                  box:
                    x: 864
                    'y': 468.5
                    width: 50
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '71:4603':
                  name: Frame
                  box:
                    x: 1000
                    'y': 468.5
                    width: 120
                    height: 20
                '71:4583':
                  name: 6 Jan 2026
                  box:
                    x: 1000
                    'y': 470.5
                    width: 58
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '71:4604':
                  name: Frame
                  box:
                    x: 1136
                    'y': 468.5
                    width: 72
                    height: 20
                '71:4584':
                  name: Button
                  box:
                    x: 1136
                    'y': 463.5
                    width: 68
                    height: 30
                  style:
                    height: 30px
                    padding: 0 10px
                    border-radius: var(--radius-sm) 7px
                    font: Spline Sans 700 12px/1.45
                    color: 'var(--color-text-light) #5b6169'
                    background: none
                '71:4605':
                  name: Status bar
                  box:
                    x: 232
                    'y': 872
                    width: 1208
                    height: 28
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - Spline Sans
                - JetBrains Mono
            unavailable:
              - property: icon binaries
                reason: Icons (info-circle, plus, project, state dots) are the theme's sprite icons; their Figma SVG exports were not downloaded.
                required: false
              - property: interaction states
                reason: Resting frames only; hover, focus and open menus are not drawn.
                required: false
      - id: my-time
        locator:
          kind: figma-node
          value: '72:4801'
        samples:
          - view: desktop
            state: default
            structure:
              roots:
                - '72:4801'
              nodes:
                - id: '72:4801'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4801'
                  children:
                    - '72:4802'
                    - '72:4875'
                - id: '72:4802'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4802'
                  children: []
                - id: '72:4875'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4875'
                  children:
                    - '72:4882'
                    - '72:4894'
                    - '72:4993'
                - id: '72:4882'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4882'
                  children:
                    - '72:4883'
                    - '72:4887'
                - id: '72:4883'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4883'
                  children:
                    - '72:4884'
                    - '72:4876'
                - id: '72:4884'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4884'
                  children:
                    - '72:4885'
                    - '72:4886'
                - id: '72:4885'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4885'
                  children: []
                - id: '72:4886'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4886'
                  children: []
                - id: '72:4876'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4876'
                  children: []
                - id: '72:4887'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4887'
                  children:
                    - '72:4888'
                    - '72:4890'
                    - '72:4892'
                - id: '72:4888'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4888'
                  children: []
                - id: '72:4890'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4890'
                  children: []
                - id: '72:4892'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4892'
                  children: []
                - id: '72:4894'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4894'
                  children:
                    - '72:4895'
                    - '72:4938'
                    - '72:4957'
                    - '72:4976'
                    - '72:4986'
                - id: '72:4895'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4895'
                  children:
                    - '72:4896'
                    - '72:4901'
                    - '72:4911'
                    - '72:4906'
                    - '72:4912'
                    - '72:4918'
                    - '72:4919'
                    - '72:4920'
                - id: '72:4896'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4896'
                  children: []
                - id: '72:4901'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4901'
                  children: []
                - id: '72:4911'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4911'
                  children: []
                - id: '72:4906'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4906'
                  children: []
                - id: '72:4912'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4912'
                  children: []
                - id: '72:4918'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4918'
                  children: []
                - id: '72:4919'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4919'
                  children: []
                - id: '72:4920'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4920'
                  children: []
                - id: '72:4938'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4938'
                  children:
                    - '72:4939'
                    - '72:4940'
                    - '72:4941'
                    - '72:4942'
                    - '72:4943'
                    - '72:4944'
                    - '72:4945'
                    - '72:4946'
                    - '72:4947'
                - id: '72:4939'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4939'
                  children:
                    - '72:4922'
                - id: '72:4922'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4922'
                  children: []
                - id: '72:4940'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4940'
                  children:
                    - '72:4923'
                    - '72:4930'
                - id: '72:4923'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4923'
                  children: []
                - id: '72:4930'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4930'
                  children: []
                - id: '72:4941'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4941'
                  children:
                    - '72:4924'
                    - '72:4931'
                - id: '72:4924'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4924'
                  children: []
                - id: '72:4931'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4931'
                  children: []
                - id: '72:4942'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4942'
                  children:
                    - '72:4925'
                    - '72:4932'
                - id: '72:4925'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4925'
                  children: []
                - id: '72:4932'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4932'
                  children: []
                - id: '72:4943'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4943'
                  children:
                    - '72:4926'
                    - '72:4933'
                - id: '72:4926'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4926'
                  children: []
                - id: '72:4933'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4933'
                  children: []
                - id: '72:4944'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4944'
                  children:
                    - '72:4927'
                    - '72:4934'
                - id: '72:4927'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4927'
                  children: []
                - id: '72:4934'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4934'
                  children: []
                - id: '72:4945'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4945'
                  children:
                    - '72:4928'
                    - '72:4935'
                - id: '72:4928'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4928'
                  children: []
                - id: '72:4935'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4935'
                  children: []
                - id: '72:4946'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4946'
                  children:
                    - '72:4929'
                    - '72:4936'
                - id: '72:4929'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4929'
                  children: []
                - id: '72:4936'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4936'
                  children: []
                - id: '72:4947'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4947'
                  children:
                    - '72:4937'
                - id: '72:4937'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4937'
                  children: []
                - id: '72:4957'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4957'
                  children:
                    - '72:4958'
                    - '72:4959'
                    - '72:4960'
                    - '72:4961'
                    - '72:4962'
                    - '72:4963'
                    - '72:4964'
                    - '72:4965'
                    - '72:4966'
                - id: '72:4958'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4958'
                  children:
                    - '72:4948'
                - id: '72:4948'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4948'
                  children: []
                - id: '72:4959'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4959'
                  children:
                    - '72:4949'
                - id: '72:4949'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4949'
                  children: []
                - id: '72:4960'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4960'
                  children:
                    - '72:4950'
                - id: '72:4950'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4950'
                  children: []
                - id: '72:4961'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4961'
                  children:
                    - '72:4951'
                - id: '72:4951'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4951'
                  children: []
                - id: '72:4962'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4962'
                  children:
                    - '72:4952'
                - id: '72:4952'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4952'
                  children: []
                - id: '72:4963'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4963'
                  children:
                    - '72:4953'
                - id: '72:4953'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4953'
                  children: []
                - id: '72:4964'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4964'
                  children:
                    - '72:4954'
                - id: '72:4954'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4954'
                  children: []
                - id: '72:4965'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4965'
                  children:
                    - '72:4955'
                - id: '72:4955'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4955'
                  children: []
                - id: '72:4966'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4966'
                  children:
                    - '72:4956'
                - id: '72:4956'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4956'
                  children: []
                - id: '72:4976'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4976'
                  children:
                    - '72:4977'
                    - '72:4978'
                    - '72:4979'
                    - '72:4980'
                    - '72:4981'
                    - '72:4982'
                    - '72:4983'
                    - '72:4984'
                    - '72:4985'
                - id: '72:4977'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4977'
                  children:
                    - '72:4967'
                - id: '72:4967'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4967'
                  children: []
                - id: '72:4978'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4978'
                  children:
                    - '72:4968'
                - id: '72:4968'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4968'
                  children: []
                - id: '72:4979'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4979'
                  children:
                    - '72:4969'
                - id: '72:4969'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4969'
                  children: []
                - id: '72:4980'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4980'
                  children:
                    - '72:4970'
                - id: '72:4970'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4970'
                  children: []
                - id: '72:4981'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4981'
                  children:
                    - '72:4971'
                - id: '72:4971'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4971'
                  children: []
                - id: '72:4982'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4982'
                  children:
                    - '72:4972'
                - id: '72:4972'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4972'
                  children: []
                - id: '72:4983'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4983'
                  children:
                    - '72:4973'
                - id: '72:4973'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4973'
                  children: []
                - id: '72:4984'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4984'
                  children:
                    - '72:4974'
                - id: '72:4974'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4974'
                  children: []
                - id: '72:4985'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4985'
                  children:
                    - '72:4975'
                - id: '72:4975'
                  kind: text
                  locator:
                    kind: figma-node
                    value: '72:4975'
                  children: []
                - id: '72:4986'
                  kind: frame
                  locator:
                    kind: figma-node
                    value: '72:4986'
                  children:
                    - '72:4987'
                - id: '72:4987'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4987'
                  children: []
                - id: '72:4993'
                  kind: instance
                  locator:
                    kind: figma-node
                    value: '72:4993'
                  children: []
            observations:
              typography:
                - role: page-title
                  font-family: Spline Sans
                  font-weight: 700
                  font-size: 24px
                  line-height: 30px
                  color: title
                  nodes:
                    - '72:4885'
                - role: meta
                  font-family: Spline Sans
                  font-weight: 400
                  font-size: 12px
                  line-height: 16px
                  color: text-light
                  nodes:
                    - '72:4886'
                - role: period
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 13px
                  line-height: 20px
                  color: text
                  nodes:
                    - '72:4911'
                - role: stat-label
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 12px
                  line-height: 16px
                  color: text-light
                  nodes:
                    - '72:4919'
                - role: stat-value
                  font-family: Spline Sans
                  font-weight: 600
                  font-size: 24px
                  line-height: 28px
                  color: title
                  nodes:
                    - '72:4920'
                - role: column-label
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 12px
                  line-height: 16px
                  color: text-light
                  nodes:
                    - '72:4922'
                    - '72:4923'
                    - '72:4924'
                    - '72:4925'
                    - '72:4926'
                    - '72:4927'
                    - '72:4928'
                    - '72:4929'
                    - '72:4937'
                - role: header-total
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 13px
                  line-height: 20px
                  color: text (non-zero) / text-light (0:00)
                  nodes:
                    - '72:4930'
                    - '72:4931'
                    - '72:4932'
                    - '72:4933'
                    - '72:4934'
                    - '72:4935'
                    - '72:4936'
                - role: body
                  font-family: Spline Sans
                  font-weight: 400
                  font-size: 13px
                  line-height: 20px
                  color: text
                  nodes:
                    - '72:4948'
                    - '72:4967'
                - role: cell-number
                  font-family: SF Pro
                  font-weight: 400
                  font-size: 13px
                  line-height: 20px
                  color: text / text-light for dashes
                  nodes:
                    - '72:4949'
                    - '72:4950'
                    - '72:4955'
                    - '72:4969'
                - role: row-total
                  font-family: Spline Sans
                  font-weight: 500
                  font-size: 13px
                  line-height: 20px
                  color: text
                  nodes:
                    - '72:4956'
                    - '72:4975'
              properties:
                '72:4801':
                  name: 5 · Nachher · Meine Zeit
                  box:
                    x: 0
                    'y': 0
                    width: 1440
                    height: 900
                '72:4802':
                  name: Sidebar
                  box:
                    x: 0
                    'y': 0
                    width: 232
                    height: 900
                '72:4875':
                  name: Main
                  box:
                    x: 232
                    'y': 0
                    width: 1208
                    height: 900
                '72:4882':
                  name: Header
                  box:
                    x: 232
                    'y': 0
                    width: 1208
                    height: 115
                '72:4883':
                  name: Frame
                  box:
                    x: 232
                    'y': 0
                    width: 1208
                    height: 74
                '72:4884':
                  name: Frame
                  box:
                    x: 256
                    'y': 16
                    width: 1035
                    height: 50
                '72:4885':
                  name: My time
                  box:
                    x: 256
                    'y': 16
                    width: 89
                    height: 30
                  style:
                    font-family: Spline Sans
                    font-weight: 700
                    font-size: 24px
                    line-height: 30px
                    color: 'var(--color-title) #14171a'
                    letter-spacing: '-0.24px'
                '72:4886':
                  name: Your recorded hours in keytec
                  box:
                    x: 256
                    'y': 50
                    width: 162
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '72:4876':
                  name: Button
                  box:
                    x: 1303
                    'y': 26
                    width: 113
                    height: 30
                '72:4887':
                  name: Frame
                  box:
                    x: 232
                    'y': 74
                    width: 209
                    height: 40
                '72:4888':
                  name: Tab
                  box:
                    x: 248
                    'y': 74
                    width: 62
                    height: 40
                '72:4890':
                  name: Tab
                  box:
                    x: 318
                    'y': 74
                    width: 66
                    height: 40
                '72:4892':
                  name: Tab
                  box:
                    x: 392
                    'y': 74
                    width: 49
                    height: 40
                '72:4894':
                  name: Body
                  box:
                    x: 232
                    'y': 115
                    width: 1208
                    height: 757
                  style:
                    display: flex
                    flex-direction: column
                    padding: 16px 24px 24px 24px
                '72:4895':
                  name: Toolbar (36)
                  box:
                    x: 256
                    'y': 131
                    width: 1160
                    height: 32
                  style:
                    display: flex
                    gap: 8px
                    align-items: center
                    height: 32px
                '72:4896':
                  name: Segmented control
                  box:
                    x: 256
                    'y': 131
                    width: 101
                    height: 32
                  style:
                    background: 'var(--color-surface-2) #e9e7e0'
                    border: '1px solid var(--color-border) #d6d3ca'
                    border-radius: 8px
                    padding: 3px
                    gap: 2px
                    segment: 'h24 px8 Spline Sans 500 13px/1.45; selected Week on var(--color-surface) #fafaf7 in var(--color-title)'
                '72:4901':
                  name: Button
                  box:
                    x: 365
                    'y': 132
                    width: 28
                    height: 30
                  style:
                    background: 'var(--color-surface) #fafaf7'
                    border: '1px solid var(--color-border) #d6d3ca'
                    height: 30px
                    padding: 0 10px
                    border-radius: var(--radius-sm) 7px
                    font: Spline Sans 700 12px/1.45
                    color: 'var(--color-text) #2c3137'
                '72:4911':
                  name: 2 – 8 Nov 2026
                  box:
                    x: 401
                    'y': 137
                    width: 85
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '72:4906':
                  name: Button
                  box:
                    x: 494
                    'y': 132
                    width: 28
                    height: 30
                  style:
                    background: 'var(--color-surface) #fafaf7'
                    border: '1px solid var(--color-border) #d6d3ca'
                    height: 30px
                    padding: 0 10px
                    border-radius: var(--radius-sm) 7px
                    font: Spline Sans 700 12px/1.45
                    color: 'var(--color-text) #2c3137'
                '72:4912':
                  name: Property pill
                  box:
                    x: 530
                    'y': 133
                    width: 116
                    height: 28
                  style:
                    background: 'var(--color-input) #f1f0ea'
                    border: '1px solid var(--color-control-border) #707888'
                    height: 28px
                    padding: 0 11px
                    border-radius: 999px
                    gap: 6px
                    font: Spline Sans 400 12px/1.45
                '72:4918':
                  name: Frame
                  box:
                    x: 654
                    'y': 146.5
                    width: 637
                    height: 1
                  style:
                    flex: 1 0 0
                '72:4919':
                  name: Week total
                  box:
                    x: 1299
                    'y': 139
                    width: 60
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '72:4920':
                  name: '4:30'
                  box:
                    x: 1367
                    'y': 133
                    width: 49
                    height: 28
                  style:
                    font-family: Spline Sans
                    font-weight: 600
                    font-size: 24px
                    line-height: 28px
                    color: 'var(--color-title) #14171a'
                '72:4938':
                  name: Frame
                  box:
                    x: 256
                    'y': 179
                    width: 1160
                    height: 52
                  style:
                    display: flex
                    height: 52px
                    align-items: center
                    background: 'var(--color-app) #f1f0ea'
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '72:4939':
                  name: Frame
                  box:
                    x: 256
                    'y': 196.5
                    width: 392
                    height: 16
                  style:
                    flex: 1 0 0
                    padding: 0 12px
                '72:4922':
                  name: Project
                  box:
                    x: 268
                    'y': 196.5
                    width: 41
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                '72:4940':
                  name: Frame
                  box:
                    x: 648
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4923':
                  name: Mon 2
                  box:
                    x: 699
                    'y': 186.5
                    width: 33
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4930':
                  name: '0:00'
                  box:
                    x: 705
                    'y': 202.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4941':
                  name: Frame
                  box:
                    x: 744
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4924':
                  name: Tue 3
                  box:
                    x: 799
                    'y': 186.5
                    width: 29
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4931':
                  name: '2:30'
                  box:
                    x: 802
                    'y': 202.5
                    width: 26
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4942':
                  name: Frame
                  box:
                    x: 840
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4925':
                  name: Wed 4
                  box:
                    x: 890
                    'y': 186.5
                    width: 34
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4932':
                  name: '0:00'
                  box:
                    x: 897
                    'y': 202.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4943':
                  name: Frame
                  box:
                    x: 936
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4926':
                  name: Thu 5
                  box:
                    x: 990
                    'y': 186.5
                    width: 30
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4933':
                  name: '0:00'
                  box:
                    x: 993
                    'y': 202.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4944':
                  name: Frame
                  box:
                    x: 1032
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4927':
                  name: Fri 6
                  box:
                    x: 1092
                    'y': 186.5
                    width: 24
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4934':
                  name: '0:00'
                  box:
                    x: 1089
                    'y': 202.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4945':
                  name: Frame
                  box:
                    x: 1128
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4928':
                  name: Sat 7
                  box:
                    x: 1185
                    'y': 186.5
                    width: 27
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4935':
                  name: '0:00'
                  box:
                    x: 1185
                    'y': 202.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4946':
                  name: Frame
                  box:
                    x: 1224
                    'y': 186.5
                    width: 96
                    height: 36
                  style:
                    display: flex
                    flex-direction: column
                    align-items: flex-end
                    width: 96px
                    padding: 0 12px
                '72:4929':
                  name: Sun 8
                  box:
                    x: 1277
                    'y': 186.5
                    width: 31
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4936':
                  name: '2:00'
                  box:
                    x: 1282
                    'y': 202.5
                    width: 26
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4947':
                  name: Frame
                  box:
                    x: 1320
                    'y': 196.5
                    width: 96
                    height: 16
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4937':
                  name: Total
                  box:
                    x: 1377
                    'y': 196.5
                    width: 27
                    height: 16
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 12px
                    line-height: 16px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4957':
                  name: Frame
                  box:
                    x: 256
                    'y': 231
                    width: 1160
                    height: 36
                  style:
                    display: flex
                    height: 36px
                    align-items: center
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '72:4958':
                  name: Frame
                  box:
                    x: 256
                    'y': 238.5
                    width: 392
                    height: 20
                '72:4948':
                  name: keytec · Time capture
                  box:
                    x: 268
                    'y': 238.5
                    width: 125
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '72:4959':
                  name: Frame
                  box:
                    x: 648
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4949':
                  name: –
                  box:
                    x: 724
                    'y': 238.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4960':
                  name: Frame
                  box:
                    x: 744
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4950':
                  name: '2:00'
                  box:
                    x: 799
                    'y': 238.5
                    width: 29
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4961':
                  name: Frame
                  box:
                    x: 840
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4951':
                  name: –
                  box:
                    x: 916
                    'y': 238.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4962':
                  name: Frame
                  box:
                    x: 936
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4952':
                  name: –
                  box:
                    x: 1012
                    'y': 238.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4963':
                  name: Frame
                  box:
                    x: 1032
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4953':
                  name: –
                  box:
                    x: 1108
                    'y': 238.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4964':
                  name: Frame
                  box:
                    x: 1128
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4954':
                  name: –
                  box:
                    x: 1204
                    'y': 238.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4965':
                  name: Frame
                  box:
                    x: 1224
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4955':
                  name: '2:00'
                  box:
                    x: 1279
                    'y': 238.5
                    width: 29
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4966':
                  name: Frame
                  box:
                    x: 1320
                    'y': 238.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4956':
                  name: '4:00'
                  box:
                    x: 1377
                    'y': 238.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4976':
                  name: Frame
                  box:
                    x: 256
                    'y': 267
                    width: 1160
                    height: 36
                  style:
                    display: flex
                    height: 36px
                    align-items: center
                    border-bottom: '1px solid var(--color-border-2) #e9e7e0'
                '72:4977':
                  name: Frame
                  box:
                    x: 256
                    'y': 274.5
                    width: 392
                    height: 20
                '72:4967':
                  name: keytec · Time capture two
                  box:
                    x: 268
                    'y': 274.5
                    width: 150
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                '72:4978':
                  name: Frame
                  box:
                    x: 648
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4968':
                  name: –
                  box:
                    x: 724
                    'y': 274.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4979':
                  name: Frame
                  box:
                    x: 744
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4969':
                  name: '0:30'
                  box:
                    x: 799
                    'y': 274.5
                    width: 29
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4980':
                  name: Frame
                  box:
                    x: 840
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4970':
                  name: –
                  box:
                    x: 916
                    'y': 274.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4981':
                  name: Frame
                  box:
                    x: 936
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4971':
                  name: –
                  box:
                    x: 1012
                    'y': 274.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4982':
                  name: Frame
                  box:
                    x: 1032
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4972':
                  name: –
                  box:
                    x: 1108
                    'y': 274.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4983':
                  name: Frame
                  box:
                    x: 1128
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4973':
                  name: –
                  box:
                    x: 1204
                    'y': 274.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4984':
                  name: Frame
                  box:
                    x: 1224
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4974':
                  name: –
                  box:
                    x: 1300
                    'y': 274.5
                    width: 8
                    height: 20
                  style:
                    font-family: SF Pro
                    font-weight: 400
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text-light) #5b6169'
                    text-align: right
                '72:4985':
                  name: Frame
                  box:
                    x: 1320
                    'y': 274.5
                    width: 96
                    height: 20
                  style:
                    width: 96px
                    padding: 0 12px
                    justify-content: flex-end
                '72:4975':
                  name: '0:30'
                  box:
                    x: 1377
                    'y': 274.5
                    width: 27
                    height: 20
                  style:
                    font-family: Spline Sans
                    font-weight: 500
                    font-size: 13px
                    line-height: 20px
                    color: 'var(--color-text) #2c3137'
                    text-align: right
                '72:4986':
                  name: Frame
                  box:
                    x: 256
                    'y': 303
                    width: 148
                    height: 50
                  style:
                    padding: 10px 0 10px 12px
                '72:4987':
                  name: Button
                  box:
                    x: 268
                    'y': 313
                    width: 136
                    height: 30
                  style:
                    height: 30px
                    padding: 0 10px
                    gap: 6px
                    font: Spline Sans 700 12px/1.45
                    color: 'var(--color-text-light) #5b6169'
                    icon: plus 14px
                '72:4993':
                  name: Status bar
                  box:
                    x: 232
                    'y': 872
                    width: 1208
                    height: 28
            dependencies:
              parent_ids: []
              asset_ids: []
              font_families:
                - Spline Sans
                - SF Pro
                - JetBrains Mono
            unavailable:
              - property: icon binaries
                reason: Icons (info-circle, plus, project, state dots) are the theme's sprite icons; their Figma SVG exports were not downloaded.
                required: false
              - property: interaction states
                reason: Resting frames only; hover, focus and open menus are not drawn.
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
          - 700
        styles:
          - normal
        files:
          - format: woff2
            local_path: assets/fonts/spline-sans.woff2
      - family: JetBrains Mono
        source: google
        weights:
          - 700
        styles:
          - normal
        files:
          - format: woff2
            local_path: assets/fonts/jetbrains-mono.woff2
      - family: SF Pro
        source: system
        weights:
          - 400
        styles:
          - normal
    captures:
      - subject: members
        view: desktop
        state: default
        path: desktop--members--default.png
        width: 1440
        height: 900
      - subject: my-time
        view: desktop
        state: default
        path: desktop--my-time--default.png
        width: 1440
        height: 900
  design_tokens:
    change: 'Add the two table row heights and the section width observed in reference 8c75dc05ca021b53/96b34e1b9fb7053f (members, my-time @ desktop @ default; tokens request fingerprint d8838a19e52864df5316a2c7980a6cc694a7ff80565140742d05264f9f80d4c9). Every observed text treatment and colour already has a semantic role (page-title, meta, section-title, data for column labels, body, body-strong, badge, stat-value; title, text, text-light, border-2, app, surface, surface-2, surface-3, state tints and inks, primary): no typography or colour token changes. The SF Pro face on number cells is a Figma default, not adopted: the theme renders numbers in its sans with tabular figures. Preserve every existing token unchanged.'
    add:
      primitive.layout.row-h-md: 36px; observation 72:4957, 72:4976 (My time body rows 36px high)
      primitive.layout.row-h-lg: 44px; observation 71:4553, 71:4559, 71:4595, 71:4600 (Members and invitation rows 44px high)
      themes.cozy.primitive.layout.row-h-md: '42px; addition (approved spec): cozy keeps its +6px step on row heights'
      themes.cozy.primitive.layout.row-h-lg: '50px; addition (approved spec): cozy keeps its +6px step on row heights'
      component.row.height-md: '{primitive.layout.row-h-md}; a 36px data-table row such as the My time week table'
      component.row.height-lg: '{primitive.layout.row-h-lg}; a 44px roomy table row such as the Members tables'
      component.section.max-width: '960px; observation 71:4494 Body (max 960): content width of a settings section such as Members'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-57-vorschl-ge-mitg/web/themes/custom/bb_theme/designbook/design-system/design-tokens.yml
  ```

  #### Results
  <!-- done -->

