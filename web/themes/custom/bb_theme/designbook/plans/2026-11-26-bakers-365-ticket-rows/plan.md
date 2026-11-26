# Plan: design-entity
<!-- digest: 82a7f3afd20f159fe0418f34170c93da429bbc8d488008f4eef2cd5f5ab51068 -->

## Schemas
```yaml
definitions:
  ComponentPropsSchema:
    type: object
    title: Component props JSON Schema
    description: |
      JSON Schema object describing the component's props. Reuses SDC's native prop representation. Extra JSON Schema keywords (items, $defs, and similar) are allowed on this object. The empty contract is `{type: object, properties: {}, required: [], additionalProperties: false}`.
    required:
      - type
      - properties
      - required
      - additionalProperties
    additionalProperties: true
    properties:
      type:
        const: object
        description: Props are always a JSON Schema object.
      properties:
        type: object
        description: Per-prop JSON Schema, including item/property schemas for collections.
        additionalProperties: true
      required:
        type: array
        items:
          type: string
        description: Required prop names. Empty when every prop is optional.
      additionalProperties:
        const: false
        description: Unknown props are rejected.
  ComponentSlot:
    type: object
    title: Component slot
    description: One named slot in the component contract.
    required:
      - description
      - required
    properties:
      description:
        type: string
        description: What the slot receives.
        examples:
          - Rendered child entities
          - Heading text
      required:
        type: boolean
        description: Whether the slot must be filled.
  DesignHint:
    type: object
    properties:
      landmark:
        type: string
      rows:
        type: array
        items:
          type: object
          properties:
            bg:
              type: string
            height:
              type: string
            layout:
              type: string
            gap:
              type: string
            padding:
              type: string
            content:
              type: string
      fonts:
        type: object
      interactive:
        type: array
        items:
          type: object
          properties:
            element:
              type: string
            bg:
              type: string
            color:
              type: string
            border_radius:
              type: string
            padding:
              type: string
            box_shadow:
              type: string
      tokens:
        type: object
  Variant:
    type: object
    required:
      - id
    properties:
      id:
        type: string
        pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        description: |
          Variant identifier in snake_case. Used as the story filename segment (`<component>.<id>.story.yml`) and as the key in `.component.yml` `variants:`. Hyphens are forbidden — the segment becomes a JS export name in the generated story (`mark-only` → `export const Mark-only`, a SyntaxError) and must satisfy the same identifier pattern as prop/slot keys.
        examples:
          - main
          - footer
          - vertical
          - horizontal
          - mark_only
      title:
        type: string
        description: Human-readable variant label shown in Storybook.
      description:
        type: string
        description: One-sentence summary of the variant's distinguishing visual or behavioural trait.
  Component:
    type: object
    title: Component
    description: Planned component identity and typed prop/slot contract.
    required:
      - component
      - group
      - props
      - slots
    properties:
      component:
        type: string
        pattern: ^[a-z][a-z0-9_-]*$
        description: |
          Bare component name — NO `provider:` namespace prefix (e.g. `hero`, `content_card`, `active-filters`; never `test_integration_drupal:hero`). Becomes the component directory and file basename (`components/<component>/<component>.component.yml`), so a namespace colon produces an invalid directory and breaks import resolution. The provider namespace is configured separately and is not part of this name.
          A HYPHEN IS ALLOWED, and it was forbidden here by mistake until 2026-09-04. The colon is the hazard this pattern exists for; the hyphen ban was carried over from `Variant.id`, where it IS load-bearing because a variant id becomes a JS export name in the generated story (`mark-only` -> `export const Mark-only`, a SyntaxError). A component name becomes a directory, a file basename and a Storybook TITLE — never a JS identifier — so the same reasoning does not reach it.
          Measured on 2026-09-04, against a theme shipping ten hyphenated components: Drupal's own SDC metadata schema admits `^[a-zA-Z0-9_-]+$`; `ComponentPluginManager` normalises nothing, so `gaia_theme:active-filters` resolves and `gaia_theme:active_filters` raises `ComponentNotFoundException`; and all sixteen stories of those ten rendered in a real browser with zero console errors. The old pattern therefore locked ten working components out of every workflow in this skill, with no defect to show for it.
        examples:
          - hero
          - content_card
          - stage_teaser
          - active-filters
      props:
        $ref: '#/definitions/ComponentPropsSchema'
      slots:
        type: object
        description: |
          Slot contract keyed by slot name. Empty object is a valid empty contract. Each value is a ComponentSlot.
        additionalProperties:
          $ref: '#/definitions/ComponentSlot'
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
      group:
        type: string
        description: Storybook group / directory family for the component.
        examples:
          - layout
          - content
          - navigation
      description:
        type: string
        description: Purpose of the component. Variants and design_hint stay alongside.
      design_hint:
        $ref: '#/definitions/DesignHint'
      variants:
        type: array
        default: []
        items:
          $ref: '#/definitions/Variant'
  PropertyNode:
    type: object
    title: Property Node
    description: One visible element from the captured source. Source-agnostic — a future Figma walker would return the same shape.
    required:
      - id
      - child_ids
      - label
      - kind
      - bbox
      - style
      - source
    properties:
      id:
        type: string
        description: Deterministic node ID. Walker-chosen (DOM uses hash of dom_path + bbox).
        examples:
          - n_8a3f21bc
      parent_id:
        type: string
        description: ID of this node's parent PropertyNode. Absent for the root — walkers MUST omit the key for the root node rather than emit null.
        examples:
          - n_8a3f21bc
      child_ids:
        type: array
        description: Child node IDs in reading / visual order.
        items:
          type: string
      label:
        type: string
        description: Human-readable name. Heading text, layer name, ARIA label, or text content.
        examples:
          - Site Header
          - Buy now
          - Pricing
      kind:
        type: string
        description: Coarse element category — drives consumer reasoning even when specific style fields are missing.
        enum:
          - section
          - container
          - text
          - heading
          - image
          - icon
          - button
          - input
          - link
          - list
          - list-item
          - form
          - media
      role:
        type: string
        description: Normalized semantic role. Strong for DOM (HTML5 landmarks + ARIA). Optional.
        enum:
          - banner
          - navigation
          - main
          - contentinfo
          - search
          - form
          - complementary
          - region
      heading_context:
        type: string
        description: Nearest preceding section / heading text. The strongest source-agnostic anchor for region matching.
        examples:
          - Pricing
          - Frequently asked questions
      bbox:
        type: object
        description: Pixel coordinates relative to the viewport.
        required:
          - x
          - 'y'
          - width
          - height
        properties:
          x:
            type: number
            description: Left edge in px
          'y':
            type: number
            description: Top edge in px
          width:
            type: number
            description: Width in px
          height:
            type: number
            description: Height in px
      text:
        type: string
        description: Visible text content, trimmed, max 200 chars.
      href:
        type: string
        description: Absolute or root-relative URL for link nodes.
      src:
        type: string
        description: Asset URL or path for media nodes.
      alt:
        type: string
        description: Alt text or accessible name.
      style:
        type: object
        title: Curated Style
        description: Source-agnostic curated style block. Walkers map their native properties (CSS computed style, Figma layout/fills/typography) onto this shape.
        required:
          - padding
          - margin
          - background
          - foreground
        properties:
          layout:
            type: string
            description: Layout primitive.
            enum:
              - flex-row
              - flex-col
              - grid
              - stack
              - absolute
              - none
          main_axis_align:
            type: string
            description: Main-axis alignment.
            enum:
              - start
              - center
              - end
              - space-between
              - space-around
              - space-evenly
          cross_axis_align:
            type: string
            description: Cross-axis alignment.
            enum:
              - start
              - center
              - end
              - stretch
              - baseline
          gap:
            type: string
            description: Gap between flex / grid items, normalized in px.
            examples:
              - 16px
              - 8px 24px
          padding:
            type: string
            description: Normalized "<top> <right> <bottom> <left>" or shorthand.
            examples:
              - 0 32 0 32
              - '16'
          margin:
            type: string
            description: Same normalization as padding.
          border:
            type: string
            description: Border shorthand.
            examples:
              - '1px solid #e5e7eb'
          border_radius:
            type: string
            examples:
              - 4px
              - 9999px
          background:
            type: string
            description: Resolved hex color, or url() / image ref.
            examples:
              - '#ffffff'
              - linear-gradient(...)
              - url(/hero.jpg)
          foreground:
            type: string
            description: Text or icon color (resolved hex).
            examples:
              - '#111111'
          font_family:
            type: string
            examples:
              - Inter, sans-serif
          font_size:
            type: string
            examples:
              - 16px
              - 1.125rem
          font_weight:
            type: string
            examples:
              - '400'
              - '600'
          line_height:
            type: string
            examples:
              - '1.5'
              - 24px
              - normal
          letter_spacing:
            type: string
            examples:
              - normal
              - 0.02em
              - 0.5px
          text_transform:
            type: string
            enum:
              - uppercase
              - lowercase
              - capitalize
      source:
        type: object
        title: Source Locator
        description: Walker-specific identification. `locator` is opaque to consumers; `raw` carries the unmapped native data when deep dives are needed.
        required:
          - locator
        properties:
          locator:
            type: string
            description: Walker-defined — DOM path for the URL walker.
            examples:
              - body > header
          raw:
            type: object
            description: Walker-specific extra fields. Opaque to consumers — only loaded when explicitly requested. Keys vary by walker.
            additionalProperties: true
      overrides:
        type: object
        description: |
          Per-breakpoint deviations from the mobile-first base. Each key is a breakpoint name (e.g. `sm`, `xl`); values list what changes at that breakpoint. Absent when the node is identical across breakpoints. Consume as responsive utilities: base `style` → base classes, `overrides.<bp>` → the matching `<bp>:` prefix.
        additionalProperties:
          type: object
          properties:
            hidden:
              type: boolean
              description: Element not rendered at this breakpoint; `false` on a base-hidden node means it is revealed here.
            style:
              type: object
              description: Only the style properties that differ from the base `style` at this breakpoint.
            bbox:
              type: object
              description: Bounding box at this breakpoint when it differs from the base.
              properties:
                x:
                  type: number
                  description: Left edge in px
                'y':
                  type: number
                  description: Top edge in px
                width:
                  type: number
                  description: Width in px
                height:
                  type: number
                  description: Height in px
        examples:
          - xl:
              hidden: false
              style:
                layout: flex-row
  RegionProperties:
    type: object
    title: Region Properties
    description: |
      Authoritative element properties for the region the current task covers.
      Produced by the region-properties code resolver from the rendered DOM.
      When `matched_via !== "none"`, `style` values are ground truth — markup
      and CSS MUST use them where present. Falls back to the state's source dump
      plus design hints only for properties not in the bag.
    required:
      - matched_via
      - nodes
    properties:
      matched_via:
        type: string
        description: Which heuristic located the region root.
        enum:
          - role
          - heading
          - label
          - bbox
          - none
      root_id:
        type: string
        description: ID of the region root inside `nodes`. Absent when matched_via === "none".
        examples:
          - n_8a3f21bc
      base_breakpoint:
        type: string
        description: |
          Smallest captured breakpoint — the mobile-first base for node `style`. Larger-breakpoint deltas live in each node's `overrides`. Absent for single-viewport captures.
        examples:
          - sm
      nodes:
        type: array
        description: All PropertyNodes in the region subtree. Hierarchy via parent_id / child_ids. Empty when matched_via === "none".
        items:
          $ref: '#/definitions/PropertyNode'
  SdcComponent:
    title: SDC Component Metadata
    description: |
      The `.component.yml` file declaring an SDC component's metadata, props, slots and variants to Drupal and the Storybook addon.

      NAMING — directory name equals file base name; always kebab-case (`button/button.component.yml`, `nav-main/nav-main.component.yml`). Components are visually descriptive, never domain-specific: `card` ✅, `article-card` ❌; `grid` ✅, `article-teaser-grid` ❌.

      YAML QUOTING — all string values use double quotes (`"`). Single quotes cause parser errors in the SDC Storybook addon.

      STORIES LIVE IN SEPARATE FILES — never declare stories inside `.component.yml`. Every component MUST set `thirdPartySettings.sdcStorybook.disableBasicStory: true`. Story files (`<component>.<story-name>.story.yml`) are not part of the SDC schema itself, but in designbook they are required: every component always ships at least `<component>.default.story.yml` so it has a Storybook entry and can be visually verified.

      VARIANTS — when two components share the same props and slots but differ only in layout or visual arrangement, implement them as variants of a single component. Each variant listed here needs a matching `<component>.<variant-id>.story.yml`. Never declare a `variant` prop under `props.properties` when `variants:` is populated — the `variants:` block is the canonical source.

      CO-LOCATED ASSETS — `<name>.css` and `<name>.js` placed next to `<name>.twig` are auto-discovered by the SDC addon. Never declare them in `.component.yml`. Use `libraryDependencies` / `libraryOverrides` only when the component pulls in an external library (slider, lightbox, chart) or extends another component's library.
    type: object
    required:
      - name
      - status
      - group
    properties:
      $schema:
        type: string
        const: https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json
        description: Path to the SDC JSON Schema. Always this exact URL.
      name:
        type: string
        description: Human-readable display name shown in Storybook navigation. Title case, free-form.
        examples:
          - Button
          - Card
          - Navigation
      status:
        type: string
        enum:
          - stable
          - experimental
          - deprecated
        description: Lifecycle state. `stable` for production-ready; `experimental` for in-development; `deprecated` for scheduled removal.
      group:
        type: string
        examples:
          - Action
          - Data Display
          - Form
          - Navigation
          - Layout
          - Shell
        description: |
          Top-level Storybook category. Also the middle segment of the derived CSF story id after sanitize (see sdc-components story-address rule). Reuse an existing group when one fits; the examples are suggestions, not a closed list.
      description:
        type: string
        description: One-sentence summary of the component's purpose and typical usage context.
      provider:
        type: string
        description: |
          Drupal SDC namespace (module/theme name) that owns the component. Maps to a Twig namespace in `.storybook/main.js`. Resolve the literal `COMPONENT_NAMESPACE` placeholder to the concrete provider from config at generation time — never leave the placeholder in the written file.
        examples:
          - test_integration_drupal
          - designbook_design
      props:
        type: object
        description: |
          JSON Schema object describing the component's typed props. Always `type: object` with `properties:` and optional `required:`. Type mapping — `string` → `type: string`, `boolean` → `type: boolean`, `number` → `type: number` or `type: integer`, `array` → `type: array`, `object` → `type: object`. Enums are declared with `enum:` on the prop. Never declare a `variant` prop when the top-level `variants:` block exists. Omit the entire `props:` section when there are no props.
        properties:
          type:
            type: string
            const: object
            description: Always literally `object` — props are declared as a JSON Schema object type.
          properties:
            type: object
            description: |
              Map of prop-name to JSON Schema type definition. Prop names MUST match `^[A-Za-z_][A-Za-z0-9_]*$` (snake_case or camelCase). Hyphens are forbidden — Twig cannot read `{{ my-prop }}` and the SDC addon emits unquoted JS identifiers from these keys.
            propertyNames:
              pattern: ^[A-Za-z_][A-Za-z0-9_]*$
          required:
            type: array
            description: Names of required props that MUST be passed for the component to render correctly. Omit when empty.
            items:
              type: string
      slots:
        type: object
        description: |
          Map of slot-name to slot metadata (`title`, `description`). Slots receive pre-rendered content from the caller. Slot names MUST match `^[A-Za-z_][A-Za-z0-9_]*$` — snake_case preferred (`main_content` ✅, `mainContent` ⚠️, `main-content` ❌). Hyphens are forbidden: slots become Twig `{% block <name> %}` tags, and Twig identifiers cannot contain hyphens. Omit the `slots:` section when the component has none.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        additionalProperties:
          type: object
          properties:
            title:
              type: string
              description: Human-readable slot label.
            description:
              type: string
              description: One-sentence summary of what content belongs in this slot.
      variants:
        type: object
        description: |
          Map of variant-id to variant metadata. Variant IDs MUST match `^[A-Za-z_][A-Za-z0-9_]*$` (snake_case or camelCase). Hyphens are forbidden: the Storybook SDC addon emits `export const ${capitalize(variantId)} = …` and `Mark-only` is not a valid JS identifier. Each variant must have a matching `<component>.<variant-id>.story.yml`. Omit the `variants:` section when the component has none.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        additionalProperties:
          type: object
          properties:
            title:
              type: string
              description: Human-readable variant label shown in Storybook.
            description:
              type: string
              description: One-sentence summary of the variant's distinguishing visual or behavioural trait.
      libraryDependencies:
        type: array
        description: |
          External Drupal library handles loaded together with this component (`module/library`). Use only for third-party widgets (slider, lightbox, chart) or to depend on another component's library. Omit when the component only uses its auto-discovered `<name>.css` / `<name>.js`.
        items:
          type: string
      libraryOverrides:
        type: object
        description: |
          Overrides for the component's auto-generated library. Use only when augmenting or replacing the asset wiring the SDC addon derives from `<name>.css` / `<name>.js`. Omit when the auto-discovered assets are sufficient.
      thirdPartySettings:
        type: object
        description: |
          Vendor-specific settings. The `sdcStorybook.disableBasicStory: true` entry is MANDATORY for every component — it suppresses the auto-generated basic story so the explicit `.story.yml` files are used instead.
        required:
          - sdcStorybook
        properties:
          sdcStorybook:
            type: object
            required:
              - disableBasicStory
            properties:
              disableBasicStory:
                type: boolean
                const: true
                description: Always `true`. Suppresses Drupal's auto-generated basic story so the explicit `.story.yml` files drive Storybook.
  SdcTemplate:
    title: SDC Twig Template
    description: |
      The `<component>.twig` file that renders an SDC component. Not JSON — this schema describes structural and rendering constraints the AI must honour when generating Twig markup.

      ONE FILE PER COMPONENT — a single `.twig` file holds all variants inline via `{% if variant == '...' %}` branches (or class-set patterns). Never create partial/sub twig files per variant.

      SINGLE ROOT ELEMENT — each template has exactly one root element. No fragments.

      `attributes` ON ROOT — the root element MUST include the Drupal `attributes` object so classes merge correctly:
        `<div{{ attributes.addClass([...]) }}>`


      SLOT RENDERING — render slots directly, no wrapper unless the content requires one:
        `{% if content %}{{ content }}{% endif %}`


      LAYOUT COMPONENTS — for layout components (`container`, `section`, `grid`, and any component whose `group` is `Layout`), every slot MUST be wrapped in `{% block <slotname> %}` tags. This is required for `{% embed %}` compatibility; without `{% block %}` tags, embedding templates cannot override the slot and content silently disappears. Applies to ALL slots including optional ones (`background`, `header`).

      VARIANT CONDITIONALS — use `{% if variant == '<id>' %}` blocks or conditional class sets. Example:
        `{% set card_classes = variant == 'horizontal' ? ['card', 'card-side'] : ['card'] %}`


      NAMESPACE RESOLUTION — never leave the literal `COMPONENT_NAMESPACE` token in generated twig. Resolve to the concrete provider (e.g. `test_integration_drupal`) at generation time.

      SHELL COMPONENTS — header, footer and page templates are full UI components with real HTML, not structural slot-only wrappers. They live alongside other components under `$DESIGNBOOK_HOME/components/`.

      NO HARDCODED COLORS — never hardcode color values in Twig. Use design-token CSS custom properties (`color: var(--color-primary)`, `background: var(--color-surface)`) or utility classes derived from them.
    type: string
  SdcStoryNode:
    title: SDC Story Node
    description: |
      A single content item in a story slot. The `type` field (required) selects one of three shapes below.

      IMAGE URLS — images in story files MUST use placeholder service URLs (e.g. `https://placehold.co/600x400`). Local file paths do not exist in Storybook and will not render.
    type: object
    required:
      - type
    properties:
      type:
        type: string
        enum:
          - element
          - component
          - image
        description: |
          Discriminator — picks which shape applies (see `oneOf` below):
          - `element` → renders inline HTML. Requires `value`. Optional: `tag`, `attributes`.
          - `component` → nests another SDC component. Requires `component` (fully qualified `<provider>:<name>`). Optional: `props`, `slots`.
          - `image` → embeds a placeholder image. Requires `uri` (external URL). Optional: `attributes`.
    oneOf:
      - title: Element Node
        description: |
          Renders inline HTML. MUST use `value:` for text — the key `content:` is NOT supported and causes `undefined` to render.
        required:
          - type
          - value
        properties:
          type:
            type: string
            const: element
          value:
            type: string
            description: Text or HTML to render. Use `value:` — never `content:`.
            examples:
              - Hello World
              - <strong>Bold text</strong>
          tag:
            type: string
            description: HTML wrapper tag. Defaults to `div` when omitted.
            examples:
              - p
              - h2
              - div
              - span
              - button
          attributes:
            type: object
            description: HTML attributes applied to the wrapper tag (e.g. `class`, `id`).
      - title: Component Node
        description: Nests another SDC component inside a slot.
        required:
          - type
          - component
        properties:
          type:
            type: string
            const: component
          component:
            type: string
            description: Fully qualified component reference in `<provider>:<component-name>` format.
            examples:
              - test_integration_drupal:navigation
              - designbook_design:card
          props:
            type: object
            description: Prop overrides for the nested component. Keys must match `^[A-Za-z_][A-Za-z0-9_]*$` (snake_case or camelCase, no hyphens).
            propertyNames:
              pattern: ^[A-Za-z_][A-Za-z0-9_]*$
          slots:
            type: object
            description: Slot content overrides for the nested component (same `SdcStoryNode` array format). Slot-name keys must match `^[A-Za-z_][A-Za-z0-9_]*$`.
            propertyNames:
              pattern: ^[A-Za-z_][A-Za-z0-9_]*$
      - title: Image Node
        description: Embeds an image into a slot.
        required:
          - type
          - uri
        properties:
          type:
            type: string
            const: image
          uri:
            type: string
            description: Placeholder image URL — MUST be an external placeholder service. Never a local path.
            examples:
              - https://placehold.co/600x400
              - https://placehold.co/1200x630/png
          attributes:
            type: object
            description: HTML attributes for the image element (e.g. `class`, `alt`).
  SdcStory:
    title: SDC Story File
    description: |
      A `<component>.<story-name>.story.yml` file describing one visually distinct rendering of a component.

      FLAT FORMAT — top-level keys are `component`, `name`, `variant`, `props`, `slots`. Select a declared variant via the top-level `variant` field — never `props.variant`. There is no `stories:` wrapper.

      ONE STORY PER FILE — never combine multiple stories via `---` YAML document separators. Each meaningful story gets its own file.

      FILENAME PATTERN — `[component-name].[story-name].story.yml` with a mandatory name segment. Use `default` as the story name for the primary/single story (`footer.default.story.yml`). Variant stories use the variant id as the name segment (`card.vertical.story.yml`, `card.horizontal.story.yml`).

      YAML QUOTING — always double quotes.

      VISUAL DISTINCTNESS — every story should demonstrate a visually distinct state. Good candidates: one file per layout variant, content-length extremes, state variations (empty slots, missing optional props), context/page scenarios. Avoid stories that look identical but differ only in invisible props.
    type: object
    required:
      - component
    properties:
      component:
        type: string
        description: |
          Fully qualified component reference in `<provider>:<component-name>` format. The `<provider>` prefix is mandatory. Look up the concrete provider from the target component's own `.component.yml` → `provider:` field. The provider maps to a Twig namespace configured in `.storybook/main.js` → `sdcStorybookOptions.namespaces`; without it the SDC addon cannot resolve the component path.
        examples:
          - test_integration_drupal:header
          - designbook_design:entity-article
      name:
        type: string
        description: Story name shown in Storybook. Use `Default` for the primary story.
      variant:
        type: string
        description: Selects one of the component's declared `variants:` IDs for this story. This is the story's variant-selection channel — never re-declare the choice as `props.variant`.
      props:
        type: object
        description: Prop overrides for this story. Keys match prop names declared in the component's `.component.yml` (snake_case or camelCase, no hyphens). Never a `variant` key — variant selection uses the story's top-level `variant` field.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
      slots:
        type: object
        description: |
          Slot content for this story. Each key is a slot name (snake_case, matching `.component.yml`); each value is an array of `SdcStoryNode` objects. Slot names MUST match `^[A-Za-z_][A-Za-z0-9_]*$` — hyphens are forbidden because the component's slots map to Twig `{% block <name> %}` tags.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        additionalProperties:
          type: array
          items:
            $ref: '#/definitions/SdcStoryNode'
  StorybookBuild:
    type: object
    title: Successful Storybook build evidence
    required:
      - command
      - cwd
      - exitCode
      - stdout
    properties:
      command:
        type: string
        minLength: 1
        description: Actual build command.
      cwd:
        type: string
        minLength: 1
        description: Absolute Storybook application directory.
      exitCode:
        type: integer
        const: 0
        description: Successful process exit code.
      stdout:
        type: string
        minLength: 1
        description: Captured build output.
  StorybookIndex:
    type: array
    title: Refreshed Storybook entries
    description: |
      Actual index entries for the story IDs fixed during intake (derived CSF ids for written components plus exact live-index ids for retained stories), captured after the component build.
    minItems: 1
    items:
      type: object
      required:
        - id
      properties:
        id:
          type: string
          minLength: 1
          description: Story ID returned by the refreshed Storybook index.
      additionalProperties: true
      description: Preserves the index entry fields supplied by Storybook, such as title, name and importPath.
  BundleRef:
    type: object
    description: One entity_type + bundle pair — the each-binding that scopes a create-sample-data task to a single data/ file.
    required:
      - entity_type
      - bundle
    properties:
      entity_type:
        type: string
        description: Entity type key from the data model (e.g. node, taxonomy_term, media, view).
        examples:
          - node
          - taxonomy_term
          - media
      bundle:
        type: string
        description: Bundle key under the entity type (e.g. topic, event, image, recent_articles).
        examples:
          - topic
          - event
          - image
  PlannedSampleRecord:
    type: object
    title: Planned sample record
    description: One record the sample-data task will write or update.
    required:
      - id
      - summary
      - values
    properties:
      id:
        type: string
        description: Unique record identifier within the bundle.
        examples:
          - signage-1
          - item-a
      summary:
        type: string
        description: Short intended content for fields not listed in values.
      values:
        type: object
        description: |
          Concrete fields needed by planned bindings, references, and composition. Keys are field machine names. A field whose data-model type is `component_tree` holds a ComponentNode[] tree (see scenes ComponentNode).
        additionalProperties: true
  SampleDataBundle:
    type: array
    description: Bare record array for one entity_type.bundle file under data/; every record carries a __designbook block
    items:
      type: object
      required:
        - id
      properties:
        id:
          type: string
          description: Unique record identifier within the bundle.
          examples:
            - '1'
            - '2'
            - shelter-1
        __designbook:
          type: object
          required:
            - section
          properties:
            section:
              description: 'Section tag used by JSONata `in` operator in scene select: expressions. A record may belong to one section (string) or multiple sections (array of strings). Use ''$["my-section" in __designbook.section]'' — works for both forms.'
              oneOf:
                - type: string
                - type: array
                  items:
                    type: string
  EntityMapping:
    type: object
    title: Entity mapping identity
    description: Entity type, bundle and concrete view or form mode for one mapping task.
    required:
      - entity_type
      - bundle
    properties:
      entity_type:
        type: string
        description: Entity type key from the data model.
        examples:
          - paragraph
          - node
      bundle:
        type: string
        description: Bundle key under the entity type.
        examples:
          - signage
          - article
      mode_kind:
        type: string
        enum:
          - view
          - form
        default: view
        description: |
          Which half of the bundle this mapping builds — `view` (reading half, written to entity-mapping/) or `form` (editing half, written to form-mapping/). Defaults to `view` so a caller that omits it (e.g. design-screen) is unchanged.
      view_mode:
        type: string
        description: View mode machine name; required and non-empty when mode_kind is view.
        examples:
          - full
          - teaser
          - default
      form_mode:
        type: string
        description: Form mode machine name; required and non-empty when mode_kind is form.
        examples:
          - default
          - inline
    allOf:
      - if:
          properties:
            mode_kind:
              const: form
          required:
            - mode_kind
        then:
          required:
            - form_mode
          properties:
            form_mode:
              type: string
              minLength: 1
        else:
          required:
            - view_mode
          properties:
            view_mode:
              type: string
              minLength: 1
  MappingChildEntity:
    type: object
    title: Referenced child entity
    description: Child entity rendered into a reference slot, including its view mode.
    required:
      - entity_type
      - bundle
      - view_mode
    properties:
      entity_type:
        type: string
        description: Child entity type from the data model.
        examples:
          - paragraph
          - node
          - media
      bundle:
        type: string
        description: Child bundle from the data model.
        examples:
          - signage_item
          - article
          - image
      view_mode:
        type: string
        minLength: 1
        description: View mode used to render each referenced child.
        examples:
          - full
          - teaser
  MappingWrap:
    type: object
    title: Wrapper component
    description: |
      Wraps a slot binding's field in a component node. Each level names exactly one of `prop` or `slot`: it takes the nested `wrap` when present, else the binding's field. Image and reference fields go into the innermost level's `slot`.
    required:
      - component
    additionalProperties: false
    properties:
      component:
        type: string
        description: Qualified wrapper component ID with a contract.
        examples:
          - ns:list_cell
      props:
        type: object
        description: |
          Props of the wrapper; each key is a wrapper prop. A value `{ field, path? }` reads that field of the mapped bundle (never an image or reference field); any other value is a literal matching the prop's type.
        additionalProperties: true
        examples:
          - caption: Versions
          - tone: neutral
            label:
              field: field_status
      prop:
        type: string
        description: Wrapper prop that takes the nested wrap or the field value. Exclusive with slot.
        pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        examples:
          - value
      slot:
        type: string
        description: Wrapper slot that takes the nested wrap or the field value. Exclusive with prop.
        pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        examples:
          - content
      wrap:
        $ref: '#/definitions/MappingWrap'
        description: Inner wrapper placed into this level's prop or slot.
  MappingBinding:
    type: object
    title: Field binding
    description: |
      One source field bound to one component prop or slot. A prop takes one binding; several slot bindings fill the same slot in binding order. A `path` array selects a structured-field member. `entity` is present only on a reference slot. `wrap` places the field inside a wrapper component on a slot binding.
    required:
      - field
    additionalProperties: false
    properties:
      field:
        type: string
        description: Data-model field machine name.
        examples:
          - field_title
          - field_signage_item
          - field_downloads
      path:
        type: array
        description: Optional path within a structured field. The first field remains a real model field.
        items:
          type: string
        examples:
          - - value
      prop:
        type: string
        description: Target prop name. Exclusive with slot.
        pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        examples:
          - title
          - style
      slot:
        type: string
        description: Target slot name. Exclusive with prop. Several bindings may name the same slot.
        pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        examples:
          - items
          - image
          - meta
      entity:
        $ref: '#/definitions/MappingChildEntity'
      wrap:
        $ref: '#/definitions/MappingWrap'
    oneOf:
      - required:
          - prop
        not:
          required:
            - slot
      - required:
          - slot
        not:
          required:
            - prop
  ComponentNode:
    type: object
    required:
      - component
    description: Render a UI component directly.
    properties:
      component:
        type: string
        description: provider:component-name format (e.g. $COMPONENT_NAMESPACE:card)
      props:
        type: object
        description: |
          Data/configuration values passed to the component. Keys must match `^[A-Za-z_][A-Za-z0-9_]*$` (snake_case or camelCase) — they map directly to SDC component props, which Twig cannot read when hyphenated.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
      slots:
        type: object
        description: |
          Named content slots. Values can be: string, SceneNode, or array of SceneNode. Slot-name keys must match `^[A-Za-z_][A-Za-z0-9_]*$` — hyphens are forbidden because slots become Twig `{% block <name> %}` tags in the underlying SDC component.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        additionalProperties:
          oneOf:
            - type: string
            - $ref: '#/definitions/SceneNode'
            - type: array
              items:
                oneOf:
                  - type: string
                  - $ref: '#/definitions/SceneNode'
      story:
        type: string
        description: Load args from an existing story variant.
  EntityNode:
    type: object
    required:
      - entity
    description: |
      Render an entity from sample data via JSONata mapping. The same node type addresses two things, distinguished by the value's prefix: a single entity (`entity_type.bundle`) or a View — a listing of several contents (`view.<id>`).
    properties:
      entity:
        type: string
        description: |
          A single entity as `entity_type.bundle` (e.g. `node.article`), or a View — a listing — as `view.<id>` (e.g. `view.landing_teasers`). `view.<id>` is the address for any listing of multiple contents; the renderer resolves the view's rows.
        examples:
          - node.article
          - view.landing_teasers
      view_mode:
        type: string
        description: Which view mode to use for entity mapping.
      record:
        type: integer
        default: 0
        description: Sample data record index.
      records:
        type: array
        items:
          type: integer
        description: |
          Demo-only shorthand. Expands to separate entries per index. Do NOT use for listing pages — use view.* entities instead.
  SceneRefNode:
    type: object
    required:
      - scene
    description: Embed another scene and fill its $variable placeholders.
    properties:
      scene:
        type: string
        description: source:sceneName format (e.g. design-system:shell)
      with:
        type: object
        description: |
          Fills $variable placeholders in the referenced scene. Keys are variable names (without $), values are SceneNode arrays or strings. Keys MUST match `^[A-Za-z_][A-Za-z0-9_]*$` — they become `$variable` placeholders resolved via JSONata, which rejects hyphens in identifiers.
        propertyNames:
          pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        additionalProperties:
          oneOf:
            - type: string
            - type: array
              items:
                $ref: '#/definitions/SceneNode'
  ImageNode:
    type: object
    required:
      - image
    description: |
      Render an image using a named image style from config.image_style in data-model.yml. Resolved by imageStyleBuilder into a designbook:image ComponentNode.
    properties:
      image:
        type: string
        description: Name of an image style bundle defined under config.image_style in data-model.yml (e.g. hero, "16_9", "4_3").
      alt:
        type: string
        description: Alt text for the image.
      src:
        type: string
        description: |
          Optional custom image path. When omitted, the configured image provider generates a placeholder URL. When provided, CSS aspect-ratio is applied instead.
  SceneNode:
    description: |
      Duck-typed by its identifying key. Exactly one of: component (ComponentNode), entity (EntityNode), scene (SceneRefNode), image (ImageNode).
    oneOf:
      - $ref: '#/definitions/ComponentNode'
      - $ref: '#/definitions/EntityNode'
      - $ref: '#/definitions/SceneRefNode'
      - $ref: '#/definitions/ImageNode'
  SceneDef:
    type: object
    required:
      - name
      - items
    properties:
      name:
        type: string
        description: Display name in Storybook sidebar.
      docs:
        type: string
      section:
        type: string
        description: Section ID for data loading.
      group:
        type: string
      theme:
        type: string
      items:
        type: array
        items:
          $ref: '#/definitions/SceneNode'
  SceneFile:
    type: object
    required:
      - id
      - title
    properties:
      id:
        type: string
        description: Section/shell identifier for Designbook overview pages.
      title:
        type: string
        description: Human-readable title for overview page.
      description:
        type: string
        description: Section description for overview page.
      status:
        type: string
        enum:
          - planned
          - in-progress
          - done
      order:
        type: integer
        description: Display order in Storybook sidebar.
      group:
        type: string
        description: |
          Bare story group, e.g. `Designbook/Sections/Wayfinding`. The indexer titles scene exports `<group>/Scenes`, so the group itself never ends in `/Scenes`. Falls back to name.
        examples:
          - Designbook/Sections/Wayfinding
        not:
          pattern: /Scenes$
      scenes:
        type: array
        items:
          $ref: '#/definitions/SceneDef'
  SceneId:
    type: string
    description: |
      Unique scene identifier. References `SceneDef.name` in a scenes.yml file. Used by capture, verify, and triage tasks to address a single scene.
    examples:
      - shell
      - hero
      - footer
      - article-detail
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
  StorybookChecks:
    type: array
    title: Successful browser observations
    description: Actual browser results and observations for the concrete stories, viewports and interactions fixed during intake.
    minItems: 1
    items:
      type: object
      required:
        - url
        - result
        - observations
      properties:
        url:
          type: string
          minLength: 1
          description: Actual checked story URL.
        result:
          type: object
          description: Complete CHECK_RESULT returned by the browser check, including its measured diagnostics.
          required:
            - ok
          properties:
            ok:
              type: boolean
              const: true
              description: The real browser check succeeded.
          additionalProperties: true
        observations:
          type: object
          minProperties: 1
          description: Observed values keyed by the intake's declared appearance, behavior and responsive criteria, supported by browser logs or captures.
          additionalProperties: true
  CompositionComponentSnapshot:
    type: object
    title: Frozen component snapshot
    description: Existing component contract copied into the sealed plan.
    required:
      - id
      - contract
      - source
      - hash
    properties:
      id:
        type: string
        description: Qualified component ID (namespace:name).
        examples:
          - test_integration_vue:signage
      contract:
        $ref: '#/definitions/Component'
      source:
        type: string
        description: Source path of the existing artifact.
      hash:
        type: string
        description: Content hash of the frozen source.
  CompositionMappingSnapshot:
    type: object
    title: Frozen mapping snapshot
    description: Existing mapping reused by the plan, with its declared binding contract.
    required:
      - identity
      - source
      - hash
    properties:
      identity:
        type: object
        description: Entity type, bundle and mode that identify the mapping file.
        required:
          - entity_type
          - bundle
        properties:
          entity_type:
            type: string
            description: Entity type key.
          bundle:
            type: string
            description: Bundle key.
          mode_kind:
            type: string
            enum:
              - view
              - form
            description: View or form half.
          view_mode:
            type: string
            description: View mode when mode_kind is view.
          form_mode:
            type: string
            description: Form mode when mode_kind is form.
      component:
        type: string
        description: Qualified target component ID of a field-map mapping. Omitted when the bundle has a component_tree field.
      bindings:
        type: array
        description: Declared field bindings of a field-map mapping. Omitted when the bundle has a component_tree field.
        items:
          $ref: '#/definitions/MappingBinding'
      source:
        type: string
        description: Source path of the existing mapping expression.
      hash:
        type: string
        description: Content hash of the frozen source.
  CompositionSampleSnapshot:
    type: object
    title: Frozen sample pool
    description: Ordered sample records for one bundle, used to resolve scene and reference indexes.
    required:
      - entity_type
      - bundle
      - records
    properties:
      entity_type:
        type: string
        description: Entity type of the pool.
      bundle:
        type: string
        description: Bundle of the pool.
      records:
        type: array
        description: Ordered records after planned writes are applied.
        items:
          type: object
          required:
            - id
          properties:
            id:
              type: string
              description: Record identifier within the bundle.
            summary:
              type: string
              description: Short remaining content.
            values:
              type: object
              description: |
                Concrete field values. Extra keys are field names from the data model. A `component_tree` field holds a ComponentNode[] tree.
              additionalProperties: true
  CompositionSceneSnapshot:
    type: object
    title: Frozen scene file
    description: Parsed baseline scene file used for sibling preservation and substitutions.
    required:
      - path
      - file
    properties:
      path:
        type: string
        description: Scene file path relative to DESIGNBOOK_DATA.
      file:
        $ref: '#/definitions/SceneFile'
      hash:
        type: string
        description: Content hash of the frozen source.
  CompositionInputs:
    type: object
    title: Frozen composition inputs
    description: |
      Baseline artifacts needed to validate and render a writing design plan. Arrays are empty when nothing is reused. Foundation workflows omit this object.
    required:
      - components
      - mappings
      - samples
      - scenes
      - data_model
    properties:
      components:
        type: array
        description: Existing component contracts in the reachable set.
        items:
          $ref: '#/definitions/CompositionComponentSnapshot'
      mappings:
        type: array
        description: Existing mapping descriptors in the reachable set.
        items:
          $ref: '#/definitions/CompositionMappingSnapshot'
      samples:
        type: array
        description: Existing sample pools in the reachable set.
        items:
          $ref: '#/definitions/CompositionSampleSnapshot'
      scenes:
        type: array
        description: Existing scene files in the reachable set.
        items:
          $ref: '#/definitions/CompositionSceneSnapshot'
      data_model:
        type: object
        description: |
          Parsed data-model.yml. Bundles live under content.<entity_type>.<bundle> (config entities under config.<entity_type>.<bundle>); image styles under config.image_style. Extra keys are the file's own sections.
        additionalProperties: true
      namespace:
        type: string
        description: |
          Configured component namespace. `plan build` seals it from `component.namespace`; it qualifies bare planned component writes.
        examples:
          - test_integration_drupal
      data_dir:
        type: string
        description: Configured Designbook data root, sealed by plan build to resolve scene filesystem aliases from frozen snapshots.
```

## Composition
```yaml
components:
  - id: bb_theme:list
    source: /var/www/html/web/themes/custom/bb_theme/components/list/list.component.yml
    hash: 619d22e2fe8043e4f5a100085a82f2192b854131eb4c5838f58ce736c135eb37
    contract:
      component: list
      group: data-display
      description: |-
        A listing WITHOUT COLUMNS, and it owns its items. It is `table`'s twin below the header and nothing else: the same cell, keyed by the same map, rendered by the same macro. What it does not have is the one thing that makes a table a table — a header cell that sorts — and that absence is why these are two components and not one with a flag. A list has no header, so there is nothing to sort and nothing to align down, which is precisely the statement `layout` makes: putting values in cells promises a comparison, and a membership or a run is a person or an event with a few properties, not a row of comparable figures.

        IT ABSORBED THREE LIST-ENTRY COMPONENTS whose only job was to be one item of something — a run line, a membership row and a label/value pair — and their arguments came with them rather than being lost. The membership entry defended itself in a forty-line block comment: a member list is not tabular data, nobody scans a role down a column, and aligning the properties to a grid would draw a table in flexbox. That argument is true and it is now `layout: cards`; the markup it used to own lives in one place for every listing in the theme.

        LISTINGS HAND OVER ROWS THROUGH THE `rows` SLOT, and that reverses the old rule that `items` is a prop and never a slot. A listing row is an entity rendered in its row view mode (a `list_item` filled with field output), so its look lives on the entity, not in each view, and a mapping can bind a field to a slot. When `rows` is filled the list renders the `<ul role="list">` around those rows and ignores `items`. `items` stays for lists that are not listings — a block's property rows, the run history, the admin views — where a cell is DATA keyed by name. A patterned item renders through the same `list_item`, so the row markup has one home. The other slot is `empty`, a sentence a screen writes rather than a value a listing carries.

        A CELL IS THE SAME NINE KINDS `table` DECLARES — `text` (`value`, `emphasis: default|faint|strong`), `mono` (`value`), `link` (`value`, `url`, `mono?`), `badge` (`label`, `tone`, `dot?`, `icon?`, `suffix?`, `suffix_datetime?`, `suffix_title?`, `mono?`, `mine?`, `url?`), `person` (`display_name`, `initials`, `color`, `mail?`), `picker` (`label`, `value_labels`, `options`, `picker_id`, `multiple?`, `open?`, `icon?`, `clearable?`, `clear_label?`, `creatable?`, `create_label?`, `name?`, `searchable?`, `selected_chips?`, `selected?`, `autosave?`, `status?`, `invalid?`), `masked` (`value?`, `revealed?`), `action` (`label`, `icon?`, `icon_only?`, `variant?`, `href?`, `hx?` {`get?`, `target?`, `select?`, `swap?`}) and `rendered` (`markup`) — and their field list is declared once, in `table.component.yml`, beside the `cell()` macro that reads it. It is deliberately not copied here: one macro renders both containers, and a second copy of its schema is a second copy that drifts. An unknown or absent `kind` renders the value as plain text, so a mapping mistake shows as unstyled content rather than as an empty item.

        `rendered` WAS MISSING FROM THIS SCHEMA ONLY, and that is what BB-435 corrected rather than invented. The kind is `table`'s ninth, the shared `cell()` macro this component imports has always rendered it, and `list.twig` hands every cell to that macro without inspecting its kind — so the markup path existed and only the enum here refused it, which made a `rendered` cell handed to `list` an invalid prop for no reason a reader could find. Its `markup` carries the same contract it carries on `table`: the value must be a `MarkupInterface` object, never a plain string and never a render array, because Twig prints the object unescaped and exactly once and escapes the string.

        `action` IS THE ONE KIND THAT IS NOT A VALUE, and a LIST ROW NEVER CARRIES IT. A list row only opens its entity's detail page — one link in the primary cell, the whole row the hit area — and offers no other action: no row buttons, no action menus, no row submits, no inline controls; the actions live on the detail page. The kind stays because the shared `cell()` macro serves `table` too, where it belongs to the exempt time-sheet grids (Submission review, Worklog week), whose rows are the actions, and to tables on a detail page; in `list` it is legal only in a `plain` block on a detail page. List-level controls not tied to a row (filters, search, create new) sit outside the list.

        IT RENDERS A REAL `<ul>` OF `<li>`, which is the accessibility half of the change. The entries it absorbed had to carry `role="listitem"` themselves and rely on a generic container being told to say `role="list"`, because neither of them was a list; a real list needs no such arrangement, and the `role="list"` here is only Tailwind's own reset being undone.
      props:
        type: object
        properties:
          pattern:
            type: object
            title: Row pattern
            description: 'Optional, and what turns an item into a LISTING ROW (BB-592): the GitLab-style row the projects, groups, tickets and runs listings share. Each region lists cell keys in display order — `avatar` (optional: a compact mark that leads the row on the left, before the text, and never shrinks), `headline` (identity and key facts, one wrapping line), `meta` (secondary facts, a faint caption line beneath), `description` (optional: one short plain-text line beneath the meta line that wraps inside the row) `right` (compact cells at the right edge) and `right_meta` (an optional faint caption line beneath them, right-aligned); the right block is a small column of those two lines that flows beneath the left block on a narrow viewport. A key whose cell is absent is skipped, so an optional fact leaves no gap; a cell no region names is not rendered. `captions` maps a key to a short visible caption shown faintly before its value ("Owner", "Took"), because a row has no header to say what a value is. A patterned item whose headline carries a link is clickable as a whole: a click on the row''s own surface (not on a control, a link or a text selection) forwards to that first headline link, declared with Alpine on the `<li>` and marked `cursor-pointer`. Without `pattern` the item renders its cells in map order, exactly as before.'
            properties:
              avatar:
                type: array
                title: Avatar keys
                items:
                  type: string
              headline:
                type: array
                title: Headline keys
                items:
                  type: string
              meta:
                type: array
                title: Meta line keys
                items:
                  type: string
              description:
                type: array
                title: Description keys
                items:
                  type: string
              right:
                type: array
                title: Right column keys
                items:
                  type: string
              captions:
                type: object
                title: Visible captions
                additionalProperties:
                  type: string
              right_meta:
                type: array
                title: Right meta keys
                items:
                  type: string
          layout:
            type: string
            enum:
              - lines
              - cards
              - plain
            title: Density
            description: 'The two densities the tree actually has, and the reason this is a prop rather than a second component: the items and the cells are identical, only the treatment differs. `lines` is dense — one line per item, a hairline between them, no surface of its own — and it is the run list. `cards` gives each item its own surface, border and radius, and it is the members list, whose entries are read one at a time rather than scanned down. `plain` is a block''s property rows — no line, hover fill or inset; the enclosing block carries the separation, the label cell takes the fixed 96px `list.plain.label-width` track and a row is at least the 32px `list.plain.row-height`, on every inspector. A row with one text, mono, link or picker value gives it the rest of the line: text is cut to one line with the full value in its title, and a picker cuts its own value. The label stays level with the first line of a taller value. Default `lines`. A listing row carries no `action` cell (it only opens its detail page); should a non-listing use place `action` cells in `lines`, they form one group at the right edge, in their own order, and the group wraps as a whole when the line is full.'
            default: lines
          spacing:
            type: string
            enum:
              - default
              - comfortable
            title: Spacing
            description: '`comfortable` gives card items more room — row gap and vertical padding at semantic spacing role 3 — for lists read person by person, such as members. Only `layout: cards` reads it. Default `default`.'
            default: default
          items:
            type: array
            title: Items
            description: The items, as DATA. Each is an optional link target, an optional status accent and a map of cells — never a rendered entry, which is what the absorbed components were.
            items:
              type: object
              properties:
                url:
                  type: string
                  title: Item target
                  description: 'Where this item points. Carried as `data-item-url` on the `<li>` rather than rendered as an anchor: an item with several cells has no single thing to wrap, and an anchor around all of them would swallow the interactive cell. The VISIBLE affordance is a `link` cell; this is the machine-readable target a later interaction layer reads.'
                accent:
                  type: string
                  enum:
                    - running
                    - attention
                    - critical
                    - wait
                    - idle
                  title: Status accent
                  description: The leading status rail. `wait` and `critical` additionally tint the whole item, because a thing that needs a person is the one state the absorbed entries made loud, and the tint is what a `wait` or `critical` badge's `-ink` colour is legible against. `critical` is the danger role of a failed run or of a Needs attention row whose reason is red; `wait` is a thing nobody is acting on.
                detail:
                  type: string
                  title: Detail line
                  description: 'One short sentence on a line of its own beneath the item''s cells, such as why a run failed or what its claim waits for. It takes the ink of the item''s accent: red for `critical` and `wait`, amber for `attention`, light text otherwise. Omitted means no line. Read by an item without `pattern`; a patterned row has its `description` region instead.'
                detail_title:
                  type: string
                  title: Detail on hover
                  description: The full text of a `detail` that was shortened, shown on hover as the line's title. Omitted when the detail is already complete.
                cells:
                  type: object
                  title: Cells
                  description: The item's values, keyed by a name of the mapping's choosing — there are no columns here, so the key names the value rather than addressing a column. The ten kinds and their fields are declared once, in `table.component.yml`, beside the one macro that renders them.
                  additionalProperties:
                    type: object
                    properties:
                      kind:
                        type: string
                        enum:
                          - text
                          - mono
                          - link
                          - badge
                          - person
                          - picker
                          - masked
                          - action
                          - rendered
                          - status
                          - time
                        title: Cell kind
        required: []
        additionalProperties: false
      slots:
        rows:
          description: 'The listing''s rendered rows, each one `list_item` (`<li>`): in Drupal the entities of a View in their row view mode. Filled, it wins over `items`.'
          required: false
        empty:
          description: What to show when there is nothing to list — a sentence that names WHAT is absent, which is a thing a screen knows and a listing does not. It is the second slot, and it is content because a sentence is content.
          required: false
  - id: bb_theme:list_item
    source: /var/www/html/web/themes/custom/bb_theme/components/list_item/list_item.component.yml
    hash: 525e08b379f88849bc2892f3c6a85f8ca400c5c5057cb5fbcd4a8634ac650d27
    contract:
      component: list_item
      group: data-display
      description: 'ONE LISTING ROW, the GitLab-style row every listing shares: an optional leading `avatar`, a `headline` line (identity and key facts), a faint `meta` line, an optional `description` line, and a compact right-hand column of `right` cells over a faint `right_meta` caption line that flows beneath the left block on a narrow viewport. It is one `<li>` and lives in `list`''s `rows` slot. Each region is a slot of `list_cell` values in display order; an empty cell renders nothing and a region whose cells are all empty is omitted, so an optional fact leaves no gap. A row of one or two left lines sits tight at least one list row high. A row whose headline carries a link is clickable as a whole: a click on the row''s own surface (not on a control, a link or a text selection) forwards to that first headline link. In Drupal a row is an entity rendered in a row view mode; `list`''s patterned `items` render through this component too, so the row markup has one home.'
      props:
        type: object
        properties:
          accent:
            type: string
            title: Status accent
            description: 'The leading status rail: `running` (teal, a conductor holds the row), `attention` (amber, in review), `critical` and `wait` (red, which also tint the row), `idle` (none). Omitted means no rail.'
            enum:
              - running
              - attention
              - critical
              - wait
              - idle
          url:
            type: string
            title: Item target
            description: Machine-readable target, carried as `data-item-url`; the visible link is a headline cell.
        required: []
        additionalProperties: false
      slots:
        avatar:
          description: A compact mark leading the row, before the text; it never shrinks.
          required: false
        headline:
          description: Identity and key facts on one wrapping line; its first link is the row's link.
          required: false
        meta:
          description: Secondary facts on a faint caption line beneath the headline.
          required: false
        description:
          description: One short plain-text line beneath the meta line.
          required: false
        right:
          description: Compact values at the right edge.
          required: false
        right_meta:
          description: A faint caption line beneath the right values, right-aligned.
          required: false
  - id: bb_theme:list_cell
    source: /var/www/html/web/themes/custom/bb_theme/components/list_cell/list_cell.component.yml
    hash: 9a2795cc3f7542a8741ecdc93b03279bfc32635bf4985e169642b3b7ec4dedca
    contract:
      component: list_cell
      group: data-display
      description: 'One value of a listing row (`list_item`): a field''s rendered output in its `value` slot, with an optional faint caption before it ("Versions", "Owner"), because a row has no header to say what a value is. A cell whose value renders nothing (no text and no control or image) renders nothing at all, so an optional fact leaves no gap; with `fallback` it renders that text faintly instead, as the right-hand column''s em-dash does. `align: end` is the right-hand column''s form: a small wrapping flex group, right-aligned, so one multi-value field (a badge per conductor) wraps instead of shrinking each badge. `primary` marks the headline cell that carries the row''s own link: on a narrow viewport that link becomes a touch target.'
      props:
        type: object
        properties:
          key:
            type: string
            title: Key
            description: Names the value, as `data-cell` (a field id in Drupal).
          caption:
            type: string
            title: Caption
            description: A short visible caption shown faintly before the value.
          fallback:
            type: string
            title: Fallback
            description: Faint text shown when the value is empty; omitted renders nothing.
          align:
            type: string
            title: Alignment
            enum:
              - start
              - end
            default: start
          primary:
            type: boolean
            title: Primary
            description: The headline cell holding the row's link; it is a touch target below md.
            default: false
        required: []
        additionalProperties: false
      slots:
        value:
          description: The rendered value, such as one field's formatter output.
          required: false
  - id: bb_theme:badge
    source: /var/www/html/web/themes/custom/bb_theme/components/badge/badge.component.yml
    hash: f803dcc8a5811e563d65810e8a357a0e290ffe054b0230b908854b778df86aab
    contract:
      component: badge
      group: data-display
      description: |-
        ONE badge. A short piece of labelled data — a state name, a count, a taxonomy label, a priority, a lease holder, a refresh state — rendered as one span tinted by `tone`. It absorbed four components that were each a badge with one detail added: `status-pill` (a dot before the label), `claim-badge` (a lock glyph and a mono machine id), `refresh_indicator` (a relative time after the label) and `status-dot` (the dot alone, with no props and no story of its own). Those four details are now `dot`, `icon` and `suffix`, which is why there is one tint table in the theme instead of four copies that agreed by hand. The four old variants (`state`, `token`, `label`, `priority`) and the `priority` prop collapsed into `tone`: they encoded a colour and a weight, never a different kind of thing, and a priority is now simply `{ label: P2, tone: neutral }`.

        `mono` AND `mine` ARE A DELIBERATE, HUMAN-APPROVED DEPARTURE from the one-badge contract's `label` + `tone` + optional dot (human, 2026-08-22). The first absorption pass mapped the lease badge onto `tone: neutral` + `icon: lock` and lost three things it carried, and two of them are not decoration. The indigo tint came back as `tone: lease`, which the token layer already had a tint/ink pair for and no tone reached. `mono` came back because a lease is held by a MACHINE ID, and a machine id set in the body face is a machine id a reader mistakes for prose. `mine` came back because the outline answered a question no tone can answer: not what state this badge is in, but WHOSE lease it is — your own session's hold on a thing versus somebody else's, which is the difference between "wait" and "act". A boolean that changes the answer to a question is data, and dropping it to keep the prop list short would have made the badge shorter and the screen less true.
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The badge's text. Required — a badge that says nothing is a decoration, and a screen reader gets nothing from it.
          tone:
            type: string
            enum:
              - running
              - attention
              - wait
              - critical
              - lease
              - idle
              - stale
              - offline
              - neutral
            title: Tone
            description: |-
              The colour vocabulary, and the only one. `running`/`attention`/`wait`/`critical`/`lease` are the five tones that reach a tint/ink token pair; `stale` and `offline` are hollow-ring dots with no tint pair of their own, and `idle` has no token at all — all three therefore read on the quiet surface. Default `neutral`.

              `critical` and `wait` share the red pair on purpose and are still two tones, because they are two statements. `wait` says nobody is acting on this; `critical` says this one is first. The absorbed `priority` variant rendered P1 through that red pair, and after the absorption P1 borrowed `wait` — visually right and semantically false, since a P1 somebody is actively working is not waiting for anybody. `critical` is the name for the red that ranks rather than the red that stalls, and it maps onto the pair that already exists rather than asking the token layer for a colour nobody chose.

              `lease` is the indigo pair `--color-state-lease-tint`/`--color-state-lease-ink`, which the token layer has always carried and which no tone reached until the claim badge was folded in here.
            default: neutral
          dot:
            type: boolean
            title: Leading dot
            description: Draws the tone as a dot before the label. The dot is `aria-hidden`, because the label beside it already says what the colour means — which is what the old bare dot could not do.
            default: false
          icon:
            type: string
            title: Icon name
            description: 'An icon from the `bakers` sprite, drawn before the label — `lock` for a held lease. Decorative: the label carries the meaning.'
          mono:
            type: boolean
            title: Monospaced
            description: 'Sets the whole badge in the mono face, for a label that is a MACHINE NAME rather than a word — a machine id holding a lease, a branch, a key. It is not a style knob: the face is what tells a reader that the string is to be matched character by character rather than read, which is the one thing the absorbed claim badge carried that neither `tone` nor `icon` could say.'
            default: false
          mine:
            type: boolean
            title: Held by the reader
            description: 'Draws a thin outline in the tone''s own colour, for a badge that names something belonging to the READER rather than to somebody else. It exists for exactly one question the absorbed claim badge answered and no tone can: whose lease this is. Your own session''s hold and another machine''s hold are the same state and demand opposite responses, so the difference is data and not decoration. Pair it with `tone: lease`; on any other tone the outline states nothing.'
            default: false
          suffix:
            type: string
            title: Suffix
            description: A quiet trailing value the label qualifies — a relative time, a count. Rendered in sans with tabular figures at the smallest step, faint, so it reads as an annotation of the label rather than a second label. Mono is for machine values only.
          suffix_datetime:
            type: string
            title: Suffix instant, ISO 8601
            description: Set when the suffix is a point in time; the suffix then renders as `bb_theme:time` with its exact date on hover.
          suffix_title:
            type: string
            title: Suffix full date shown on hover
          list_item:
            type: boolean
            title: Is a list item
            description: 'Emits `role="listitem"`. It is a prop and not a guess because a badge cannot know whether it is a direct child of a `role="list"` container, and `role="list"`/`role="listitem"` must be direct parent and child or a browser drops both. The caller that sets `bb_theme:zone`''s `list: true` around a set of badges sets this too. IT HAS NO CONSUMING SURFACE LEFT: the labels surface used to be the one, and it is a `list` node now — a real `<ul>` of `<li>`, with the badges as cells — so nothing in the theme pairs this prop with a `role="list"` container any more. It is still set by the label mapping, which renders one label standalone and cannot know its container, and it still has a story of its own; removing it is therefore a change to those two as well and belongs to whoever retires them. This is the prop that exists only until a container owns its own items, and the container now does.'
            default: false
        required:
          - label
        additionalProperties: false
      slots: {}
  - id: bb_theme:person
    source: /var/www/html/web/themes/custom/bb_theme/components/person/person.component.yml
    hash: 3eee4ed35c8a3c02ed445d6de33605da00f5a60c642696bebec4dba90306bf50
    contract:
      component: person
      group: data-display
      description: 'ONE identity, rendered the same way everywhere: the initials circle, the display name, and the mail address beneath it. It exists because four different rows of the organisation surface name a person — a workspace or project member, a group''s owner, a project''s owner, a team''s owner — and a fragment repeated four times drifts in four directions. The initials circle is this component''s own markup rather than a component of its own: it had one, and once every direct caller was repointed here the only thing composing it was this file, which is the single-caller component the theme forbids. It is also the mapping target of `user.user.compact`, so a person read out of the sample data and a person written into a story render identically. An app account has no mail address; the line is then absent rather than blank, because a dash where an address belongs reads as a missing value rather than as a kind of account that has none.'
      props:
        type: object
        properties:
          variant:
            type: string
            enum:
              - full
              - compact
              - profile
            title: Variant
            description: '`full` is the circle with the name and the mail beneath it — an identity that is the subject of its row. `compact` is one line and no mail, for an identity that is a control or a cell: the circle plus the name where a name is given, and the circle alone where it is not. `profile` is the subject of a whole page — the account overview: a large mark centred above the name in the display type role, with `subtitle` beneath and no mail. Default `full`.'
            default: full
          display_name:
            type: string
            title: Display name
            description: The person's own name. `user.display_name` in the model, which is computed. Optional in `compact`, where a caller that already renders its own label wants the circle alone.
          initials:
            type: string
            title: Initials
            description: The two or three letters drawn in the circle. The one required prop — a circle with nothing in it identifies nobody. Rendered whenever `picture` is absent.
          picture:
            type: string
            title: Profile picture URL
            description: 'A rendered image URL for the circle, e.g. `user.user_picture` (BB-507). Optional: initials are the fallback for any account without one, which is why initials stays the required prop.'
          image_fit:
            type: string
            enum:
              - cover
              - contain
            title: Image fit
            description: How `picture` fills the mark. `cover` crops it to the circle, the right fit for a profile picture. `contain` centres the whole image inside the circle without cropping, for a project or group image of any aspect ratio. Default `cover`.
            default: cover
          subtitle:
            type: string
            title: Subtitle
            description: One secondary line beneath the name, e.g. the developer title. Rendered in `full` and `profile`, omitted when empty; `compact` has no room for it.
          subtitle_datetime:
            type: string
            title: Subtitle instant, ISO 8601
            description: Set when the subtitle is a point in time (a review's date); the subtitle then renders as `bb_theme:time` with its full date on hover.
          subtitle_title:
            type: string
            title: Subtitle full date shown on hover
          mail:
            type: string
            title: Email
            description: Rendered beneath the name, and only in `full`. Omit it for an app account, which has none.
          color:
            type: string
            enum:
              - running
              - attention
              - unassigned
              - lease
              - offline
            title: Colour key
            description: 'Which token tints the circle. PASSED IN, NEVER DERIVED: a deterministic per-user colour is a decision about a user, not about a span, so whoever knows the user picks the key and this template only maps it onto a token.'
          size:
            type: string
            enum:
              - sm
              - md
            title: Size
            description: The circle's scale. `md` for a member list, where the row is the person; `sm` for an owner cell, where the person is one column of something else.
          url:
            type: string
            title: Url
            description: Optional destination. When set, the identity is a link — the signed-in account in the rail foot points at the account's own profile.
        required:
          - initials
        additionalProperties: false
      slots: {}
mappings: []
samples:
  - entity_type: bb_ticket
    bundle: bb_ticket
    records:
      - id: '1'
        values:
          id: '1'
          created: '2026-06-01T08:00:00+00:00'
          changed: '2026-06-30T16:45:00+00:00'
          project_id: '1'
          identifier: BB-142
          workflow: bb_work
          title: Add designbook entity view-mode for bb_ticket
          description: <p>We need a <strong>full</strong> view-mode render for <code>bb_ticket</code> so designers can preview ticket detail layouts without hitting live Drupal data.</p><p>Scope includes the state-flow bar, comment timeline, and reference chips for labels, parent, and blockers.</p>
          state: working
          ticket_type: '4'
          recipe: '8'
          labels:
            - '1'
            - '2'
          assignee_user_id: '1'
          reviewers:
            - '2'
            - '3'
          priority: 2
          parent_id: '2'
          blocked_by:
            - '3'
            - '5'
          origin: https://gitlab.example.com/bakers/bakers/-/issues/142
          links:
            - uri: https://gitlab.example.com/bakers/bakers/-/merge_requests/88
              title: MR !88 — designbook entity view-mode
              options:
                bakers:
                  kind: mr
            - uri: https://gitlab.example.com/bakers/bakers/-/tree/bakers/bb-142-designbook-entity-view-mode
              title: bakers/bb-142-designbook-entity-view-mode
              options:
                bakers:
                  kind: branch
            - uri: https://gitlab.example.com/bakers/bakers/-/pipelines/48213
              title: 'Pipeline #48213 (passed)'
              options:
                bakers:
                  kind: ci
            - uri: https://bakers.example.com/docs/designbook
              title: Designbook docs
              options:
                bakers:
                  kind: doc
            - uri: https://gitlab.example.com/bakers/bakers/-/jobs/48213/artifacts/file/playwright-report/index.html
              title: Playwright BDD report — 48 scenarios
              options:
                bakers:
                  kind: report
                  passed: 46
                  failed: 2
                  duration: 3m 41s
            - uri: https://bb-142.ddev.site/bakers/ticket
              title: Tickets screen on the bb-142 worktree
              options:
                bakers:
                  kind: ddev
          comments:
            - '1'
            - '2'
            - '3'
          pending_reviews:
            - '9'
          branch_name: bakers/bb-142-designbook-entity-view-mode
          closed: false
          closed_date: null
          number: 142
          conductor_id: '1'
          time_estimate: 14400
          time_spent: 10800
          environments:
            - '2'
          env_vars: |
            BB_TARGET=develop
          metrics:
            - name: coverage
              value: '84.2000'
              unit: percent
              recorded: '2026-06-28T14:30:00+00:00'
          cleaned_up: true
          owner_user_id: '1'
          referenced_tickets: []
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Add designbook entity view-mode for bb_ticket</a>
          identifier_link: BB-142
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-142</a>
          state_icon: Working
          state_icon_formatted: <span role="img" aria-label="Working" title="Working" class="inline-flex shrink-0 items-center text-text"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-running"></use></svg></span>
          priority_label: Medium
          priority_tone: neutral
          created_formatted: 3 days ago
          owner_name: Christian Wiedemann
          owner_initials: CW
          owner_color: attention
          assignee_name: Christian Wiedemann
          assignee_initials: CW
          assignee_color: attention
          conductor_label: cw · framework
          conductor_mine: true
          stall_reason: ''
          stall_suffix: ''
          run_summary: 5 runs · last running
          run_summary_tone: running
          run_summary_suffix: 12 minutes ago
          row_accent: running
      - id: '2'
        values:
          id: '2'
          created: '2026-05-10T10:00:00+00:00'
          changed: '2026-06-20T11:00:00+00:00'
          project_id: '1'
          identifier: BB-100
          number: 100
          workflow: bb_work
          title: Designbook coverage for core bakers.build entities
          description: <p>Umbrella ticket tracking design-entity workflows across ticket, project, comment, and term bundles. Hierarchy rides on parent_id/sub_tickets; there is no epic workflow.</p>
          state: qualification
          ticket_type: '7'
          recipe: '8'
          labels:
            - '1'
          assignee_user_id: '2'
          priority: 1
          parent_id: null
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/100
          links: []
          comments: []
          branch_name: null
          closed: false
          closed_date: null
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Designbook coverage for core bakers.build entities</a>
          identifier_link: BB-100
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-100</a>
          state_icon: Qualification
          state_icon_formatted: <span role="img" aria-label="Qualification" title="Qualification" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: High
          priority_tone: critical
          created_formatted: 2 weeks ago
          owner_name: ''
          owner_initials: ''
          owner_color: ''
          assignee_name: Sven Gruber
          assignee_initials: SG
          assignee_color: unassigned
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: ''
      - id: '3'
        values:
          id: '3'
          created: '2026-05-20T09:30:00+00:00'
          changed: '2026-06-05T13:00:00+00:00'
          project_id: '1'
          identifier: BB-110
          number: 110
          workflow: bb_work
          title: Ship data-model schema for bb_ticket bundle
          description: <p>Formalize the field list and reference targets for <em>bb_ticket</em> in <code>designbook/data-model.yml</code>.</p>
          state: qualification
          ticket_type: '4'
          recipe: '8'
          labels:
            - '1'
          assignee_user_id: '1'
          priority: 3
          parent_id: '2'
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/110
          links: []
          comments: []
          branch_name: null
          closed: false
          closed_date: null
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Ship data-model schema for bb_ticket bundle</a>
          identifier_link: BB-110
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-110</a>
          state_icon: Qualification
          state_icon_formatted: <span role="img" aria-label="Qualification" title="Qualification" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: Low
          priority_tone: neutral
          created_formatted: 2 weeks ago
          owner_name: ''
          owner_initials: ''
          owner_color: ''
          assignee_name: Christian Wiedemann
          assignee_initials: CW
          assignee_color: attention
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: ''
      - id: '4'
        values:
          id: '4'
          created: '2026-05-25T14:00:00+00:00'
          changed: '2026-06-10T09:15:00+00:00'
          project_id: '1'
          identifier: BB-118
          number: 118
          workflow: bb_work
          title: Draft ticket_detail component spec
          description: <p>Write the SDC spec for the ticket detail full-view component, covering slots for state bar and comment timeline.</p>
          state: plan
          ticket_type: '4'
          recipe: '8'
          labels:
            - '2'
          assignee_user_id: '2'
          priority: 2
          parent_id: '2'
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/118
          links: []
          comments: []
          branch_name: bakers/bb-118-ticket-detail-spec
          closed: false
          closed_date: null
          __designbook:
            section: bb_ticket
          owner_user_id: '1'
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Draft ticket_detail component spec</a>
          identifier_link: BB-118
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-118</a>
          state_icon: Plan
          state_icon_formatted: <span role="img" aria-label="Plan" title="Plan" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: Medium
          priority_tone: neutral
          created_formatted: 3 weeks ago
          owner_name: Christian Wiedemann
          owner_initials: CW
          owner_color: attention
          assignee_name: Sven Gruber
          assignee_initials: SG
          assignee_color: unassigned
          conductor_label: ''
          conductor_mine: false
          stall_reason: no conductor
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: ''
      - id: '5'
        values:
          id: '5'
          created: '2026-05-15T08:45:00+00:00'
          changed: '2026-06-25T17:20:00+00:00'
          project_id: '1'
          identifier: BB-105
          number: 105
          workflow: bb_work
          title: Review comment-event rendering for typed comments
          description: <p>Confirm <code>spec</code>, <code>summary</code>, and plain <code>comment</code> types each render with distinct visual treatment in the timeline.</p>
          state: review
          ticket_type: '4'
          recipe: '8'
          labels:
            - '2'
            - '3'
          assignee_user_id: '1'
          priority: 2
          parent_id: '2'
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/105
          links:
            - uri: https://gitlab.example.com/bakers/bakers/-/merge_requests/80
              title: MR !80 — comment-event rendering
              options:
                bakers:
                  kind: mr
          comments: []
          branch_name: bakers/bb-105-comment-event-review
          closed: false
          closed_date: null
          __designbook:
            section: bb_ticket
          owner_user_id: '2'
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Review comment-event rendering for typed comments</a>
          identifier_link: BB-105
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-105</a>
          state_icon: Review
          state_icon_formatted: <span role="img" aria-label="Review" title="Review" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: Medium
          priority_tone: neutral
          created_formatted: 1 week ago
          owner_name: Sven Gruber
          owner_initials: SG
          owner_color: unassigned
          assignee_name: Christian Wiedemann
          assignee_initials: CW
          assignee_color: attention
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: attention
      - id: '6'
        values:
          id: '6'
          created: '2026-04-01T08:00:00+00:00'
          changed: '2026-04-20T12:00:00+00:00'
          project_id: '1'
          identifier: BB-90
          number: 90
          workflow: bb_work
          title: Bootstrap bb_theme SDC scaffolding
          description: <p>Initial scaffolding for the theme's single-directory components used by designbook.</p>
          state: done
          ticket_type: '4'
          recipe: '8'
          labels:
            - '3'
          assignee_user_id: '2'
          priority: 3
          parent_id: null
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/90
          links: []
          comments: []
          branch_name: bakers/bb-90-sdc-scaffolding
          closed: true
          closed_date: '2026-04-20T12:00:00+00:00'
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Bootstrap bb_theme SDC scaffolding</a>
          identifier_link: BB-90
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-90</a>
          state_icon: Done
          state_icon_formatted: <span role="img" aria-label="Done" title="Done" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: Low
          priority_tone: neutral
          created_formatted: 2 weeks ago
          owner_name: ''
          owner_initials: ''
          owner_color: ''
          assignee_name: Sven Gruber
          assignee_initials: SG
          assignee_color: unassigned
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: ''
      - id: '7'
        values:
          id: '7'
          created: '2026-06-15T10:00:00+00:00'
          changed: '2026-06-30T16:40:00+00:00'
          project_id: '1'
          identifier: BB-145
          number: 145
          workflow: bb_work
          title: Comment feed region in ticket_detail
          description: <p>Render the ticket comment timeline inside the full view-mode.</p>
          state: working
          ticket_type: '4'
          recipe: '8'
          labels:
            - '2'
          assignee_user_id: '1'
          priority: 2
          parent_id: '1'
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/145
          links: []
          comments: []
          branch_name: bakers/bb-145-comment-feed-region
          closed: false
          closed_date: null
          __designbook:
            section: bb_ticket
          owner_user_id: '1'
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Comment feed region in ticket_detail</a>
          identifier_link: BB-145
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-145</a>
          state_icon: Working
          state_icon_formatted: <span role="img" aria-label="Working" title="Working" class="inline-flex shrink-0 items-center text-text"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-running"></use></svg></span>
          priority_label: Medium
          priority_tone: neutral
          created_formatted: 2 days ago
          owner_name: Christian Wiedemann
          owner_initials: CW
          owner_color: attention
          assignee_name: Christian Wiedemann
          assignee_initials: CW
          assignee_color: attention
          conductor_label: ''
          conductor_mine: false
          stall_reason: frozen
          stall_suffix: 2 hours ago
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: ''
      - id: '8'
        values:
          id: '8'
          created: '2026-06-16T09:00:00+00:00'
          changed: '2026-06-29T14:10:00+00:00'
          project_id: '1'
          identifier: BB-146
          number: 146
          workflow: bb_work
          title: Runs, sub-tickets and footprint sections
          description: <p>Add reverse/aggregate regions (runs, sub-tickets, footprint) to the full view-mode.</p>
          state: review
          ticket_type: '4'
          recipe: '8'
          labels:
            - '2'
            - '3'
          assignee_user_id: '2'
          priority: 3
          parent_id: '1'
          blocked_by: []
          origin: https://gitlab.example.com/bakers/bakers/-/issues/146
          links: []
          comments: []
          branch_name: bakers/bb-146-reverse-sections
          closed: false
          closed_date: null
          __designbook:
            section: bb_ticket
          owner_user_id: '4'
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Runs, sub-tickets and footprint sections</a>
          identifier_link: BB-146
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-146</a>
          state_icon: Review
          state_icon_formatted: <span role="img" aria-label="Review" title="Review" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: Low
          priority_tone: neutral
          created_formatted: 4 days ago
          owner_name: bakers.build agent
          owner_initials: BA
          owner_color: offline
          assignee_name: Sven Gruber
          assignee_initials: SG
          assignee_color: unassigned
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: attention
      - id: '9'
        values:
          id: '9'
          created: '2026-06-08T09:00:00+00:00'
          changed: '2026-06-29T16:20:00+00:00'
          project_id: '2'
          identifier: NWS-80
          number: 80
          workflow: bb_work
          title: Checkout address step rewrite
          description: <p>Rebuild the address step of the checkout flow so it validates postcodes per country and keeps entered data on a failed submit.</p>
          state: working
          ticket_type: '4'
          recipe: '8'
          labels:
            - '2'
          assignee_user_id: '3'
          priority: 1
          parent_id: null
          blocked_by: []
          origin: https://gitlab.example.com/northwind/shop/-/issues/80
          links:
            - uri: https://gitlab.example.com/northwind/shop/-/merge_requests/41
              title: MR !41 — checkout address step
              options:
                bakers:
                  kind: mr
          comments:
            - '4'
            - '5'
            - '6'
            - '7'
          branch_name: feat/nws-80-checkout-address-step
          closed: false
          closed_date: null
          conductor_id: '2'
          time_estimate: 21600
          time_spent: 12600
          environments:
            - '3'
          env_vars: |
            NWS_TARGET=staging
          metrics:
            - name: coverage
              value: '71.5000'
              unit: percent
              recorded: '2026-06-29T16:20:00+00:00'
          cleaned_up: false
          owner_user_id: '3'
          referenced_tickets: []
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Checkout address step rewrite</a>
          identifier_link: NWS-80
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">NWS-80</a>
          state_icon: Working
          state_icon_formatted: <span role="img" aria-label="Working" title="Working" class="inline-flex shrink-0 items-center text-text"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-running"></use></svg></span>
          priority_label: High
          priority_tone: critical
          created_formatted: 5 hours ago
          owner_name: Marieke van Dijk
          owner_initials: MV
          owner_color: lease
          assignee_name: Marieke van Dijk
          assignee_initials: MV
          assignee_color: lease
          conductor_label: mvd · shop
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: 1 run · last done
          run_summary_tone: idle
          run_summary_suffix: 1 day ago
          row_accent: running
      - id: '10'
        values:
          id: '10'
          created: '2026-06-11T10:30:00+00:00'
          changed: '2026-06-27T09:45:00+00:00'
          project_id: '2'
          identifier: NWS-81
          number: 81
          workflow: bb_work
          title: Cart total ignores per-item discounts
          description: <p>The cart summary sums list prices, so a per-item discount is applied at payment but never shown in the total the customer sees.</p>
          state: review
          ticket_type: '5'
          recipe: '8'
          labels:
            - '3'
          assignee_user_id: '4'
          priority: 1
          parent_id: null
          blocked_by: []
          origin: https://gitlab.example.com/northwind/shop/-/issues/81
          links: []
          comments: []
          branch_name: fix/nws-81-cart-total-discounts
          closed: false
          closed_date: null
          owner_user_id: '3'
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Cart total ignores per-item discounts</a>
          identifier_link: NWS-81
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">NWS-81</a>
          state_icon: Review
          state_icon_formatted: <span role="img" aria-label="Review" title="Review" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: High
          priority_tone: critical
          created_formatted: 6 days ago
          owner_name: Marieke van Dijk
          owner_initials: MV
          owner_color: lease
          assignee_name: bakers.build agent
          assignee_initials: BA
          assignee_color: offline
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: attention
      - id: '11'
        values:
          id: '11'
          created: '2026-06-24T14:00:00+00:00'
          changed: '2026-06-26T08:10:00+00:00'
          project_id: '2'
          identifier: NWS-82
          number: 82
          workflow: bb_work
          title: Move the staging deploy onto the shared runner
          description: <p>Staging still builds on the retired dedicated runner. Move the pipeline to the shared runner pool and drop the runner-specific cache paths.</p>
          state: qualification
          ticket_type: '6'
          recipe: '9'
          labels:
            - '1'
          assignee_user_id: '3'
          priority: 3
          parent_id: null
          blocked_by: []
          origin: https://gitlab.example.com/northwind/shop/-/issues/82
          links: []
          comments: []
          branch_name: null
          closed: false
          closed_date: null
          environments:
            - '3'
          owner_user_id: '3'
          __designbook:
            section: bb_ticket
          title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Move the staging deploy onto the shared runner</a>
          identifier_link: NWS-82
          identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">NWS-82</a>
          state_icon: Qualification
          state_icon_formatted: <span role="img" aria-label="Qualification" title="Qualification" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
          priority_label: Low
          priority_tone: neutral
          created_formatted: 1 week ago
          owner_name: Marieke van Dijk
          owner_initials: MV
          owner_color: lease
          assignee_name: Marieke van Dijk
          assignee_initials: MV
          assignee_color: lease
          conductor_label: ''
          conductor_mine: false
          stall_reason: ''
          stall_suffix: ''
          run_summary: ''
          run_summary_tone: ''
          run_summary_suffix: ''
          row_accent: ''
scenes: []
data_model:
  content:
    bb_project:
      bb_project:
        title: bakers.build project
        purpose: 'The work unit: key, next_number, repository, environments. BB-462 D7 REVERSES what this field used to say: the project carries NO membership or role of its own any more — it is deregistered from og.settings entirely, and its three roles (non-member, member, lead) are deleted from both config paths. Visibility now comes from bb_project.teams (D4): a project is visible to the members of a team it names, or to a workspace admin. The two levels that grant rights are the workspace (create/edit/delete rights, via bb_workspace-bb_workspace-{contributor,lead}) and, per-project, its teams (visibility only — a team carries no rights of its own, BB-462 D3). A screen must not offer a permission control on the project.'
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
          epics:
            template: field-map
            label: Epics
          list_item:
            template: field-map
            label: List item
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          group_id:
            type: reference
            title: Group
            required: true
            multiple: false
            reference: bb_group
          name:
            type: string
            title: Name
            required: true
            multiple: false
          description:
            type: string
            title: Description
            description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
            required: false
            multiple: false
          image:
            type: image
            title: Image
            description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under project-images, shown uncropped as the listing row's leading avatar; initials when absent.
            required: false
            multiple: false
          repository:
            type: object
            title: Repository
            description: 'The project repository (URL, default branch, branch naming convention). Single-valued: a project has at most one repository.'
            required: false
            multiple: false
            settings:
              properties:
                url: string
                default_branch: string
                branch_convention: string
          coder_config:
            type: object
            title: Coder config
            required: false
            multiple: false
          env_vars:
            type: text
            title: Environment variables
            description: Project defaults supplied to hooks and the agent on every run, as .env-style KEY=value lines. A parent ticket and the ticket itself override a key set here. Readable by anyone who can view this project.
            required: false
            multiple: false
          teams:
            type: reference
            title: Teams
            description: 'The teams this project belongs to. A project belongs to AT LEAST ONE team, so the field is required and multi-valued. The assignment is STRUCTURE and confers no rights: it makes the team the project''s structural parent, and team membership is not a source of ticket visibility. Visibility stays at direct project membership or workspace see-all (BB-419, which deliberately left BbWorkspaceReadScope untouched).'
            required: true
            multiple: true
            reference: bb_team
          key:
            type: string
            title: Identifier prefix
            description: Ticket identifier prefix, e.g. BB in BB-328. A change applies only to tickets created afterwards.
            required: false
            multiple: false
          next_number:
            type: integer
            title: Next number
            description: Next per-project ticket number; floors to max(number)+1 on allocation.
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
          environments:
            type: reference
            title: Environments
            description: Managed environments belonging to this project.
            required: false
            multiple: true
            reference: bb_environment
            computed: true
            readonly: true
          open_tickets:
            type: integer
            title: Open tickets
            description: 'Computed, internal: the project''s tickets not yet closed. The listing row shows it as a ticket badge.'
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_tickets:
            type: integer
            title: Conductor tickets
            description: 'Computed, internal: the project''s tickets a conductor currently holds. The listing row shows it as a conductor badge.'
            required: false
            multiple: false
            computed: true
            readonly: true
          closed_tickets:
            type: integer
            title: Closed tickets
            description: 'Computed, internal: the project''s closed tickets. The listing row shows it as a check badge.'
            required: false
            multiple: false
            computed: true
            readonly: true
          initials:
            type: string
            title: Initials
            description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          avatar_color:
            type: string
            title: Avatar colour
            description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the project id. Present so the avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          avatar_picture:
            type: string
            title: Avatar picture
            description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_comment:
      bb_comment:
        title: bakers.build comment
        view_modes:
          full:
            template: field-map
          teaser:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          ticket_id:
            type: reference
            title: Ticket
            required: true
            multiple: false
            reference: bb_ticket
          author:
            type: reference
            title: Author
            required: true
            multiple: false
            reference: user
          body:
            type: text
            title: Body
            required: true
            multiple: false
          type:
            type: string
            title: Type
            description: Free text, not an enum (BB-227). Values in use include comment, qualification, spec, test and acceptance, so a screen must render an unknown value rather than assume a closed set.
            required: true
            multiple: false
          author_name:
            type: string
            title: Author name
            required: false
            multiple: false
            computed: true
            readonly: true
          author_initials:
            type: string
            title: Author initials
            required: false
            multiple: false
            computed: true
            readonly: true
          author_color:
            type: string
            title: Author colour
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
      review:
        title: bakers.build review comment
        purpose: A private review of a ticket. Drafts stay with the assigned author; submitted reviews wait for the current assignee; accepted reviews publish into the ordinary comment timeline. Rejected reviews stay unpublished. The Boolean published flag is server-owned.
        view_modes:
          full:
            template: field-map
          teaser:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          ticket_id:
            type: reference
            title: Ticket
            required: true
            multiple: false
            reference: bb_ticket
          author:
            type: reference
            title: Author
            required: true
            multiple: false
            reference: user
          body:
            type: text
            title: Body
            required: true
            multiple: false
          type:
            type: string
            title: Type
            required: true
            multiple: false
          status:
            type: boolean
            title: Published
            required: false
            multiple: false
          review_state:
            type: string
            title: Review state
            required: false
            multiple: false
            settings:
              allowed_values:
                draft: Draft
                submitted: Submitted
                accepted: Accepted
                rejected: Rejected
          submitted_at:
            type: datetime
            title: Submitted at
            required: false
            multiple: false
          decided_at:
            type: datetime
            title: Decided at
            required: false
            multiple: false
          decided_by:
            type: reference
            title: Decided by
            required: false
            multiple: false
            reference: user
          author_name:
            type: string
            title: Author name
            required: false
            multiple: false
            computed: true
            readonly: true
          author_initials:
            type: string
            title: Author initials
            required: false
            multiple: false
            computed: true
            readonly: true
          author_color:
            type: string
            title: Author colour
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_activity:
      bb_activity:
        title: bakers.build activity
        purpose: 'One persisted ticket event per row: `created` when a ticket is created, `status_changed` per state change (with the step''s summary comment, and with the run it closed and that run''s conductor when an agent did the work), `claimed` only for the first run outside qualification, and `run_ended` when a run ends failed, expired or cancelled without moving the ticket. Writes come only from the bb_activity kinds, called where the change happens. Each row is this bundle''s `full` view mode (`bb_theme:event` with a structured lead); there is no second activity view mode.'
        view_modes:
          full:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          ticket_id:
            type: reference
            title: Ticket
            required: true
            multiple: false
            reference: bb_ticket
          kind:
            type: string
            title: Kind
            description: '`created`, `status_changed`, `claimed` or `run_ended`. Tags: created, status, started (claimed) and the run outcome for run_ended.'
            required: true
            multiple: false
            settings:
              allowed_values:
                - created
                - status_changed
                - claimed
                - run_ended
          actor:
            type: reference
            title: Actor
            required: false
            multiple: false
            reference: user
          workflow:
            type: string
            title: Workflow
            required: false
            multiple: false
          previous_state:
            type: string
            title: Previous state
            required: false
            multiple: false
          new_state:
            type: string
            title: New state
            required: false
            multiple: false
          step:
            type: string
            title: Step
            description: The run's state_at_start for claimed and run_ended rows. Unused for created and status rows.
            required: false
            multiple: false
          run_id:
            type: reference
            title: Run
            required: false
            multiple: false
            reference: bb_run
            description: The run a claimed or run_ended row reports, or the run a status change closed. Empty for created rows and human status changes; its presence makes the row an agent row.
          conductor_id:
            type: reference
            title: Conductor
            required: false
            multiple: false
            reference: bb_conductor
            description: The conductor of the referenced run.
          comment_id:
            type: reference
            title: Summary comment
            description: The ticket's summary comment published since the ticket entered the state a status row leaves. Empty when none.
            required: false
            multiple: false
            reference: bb_comment
          claim_key:
            type: string
            title: Claim key
            required: false
            multiple: false
            description: The claimed run's UUID; unique, guards a second claimed row for the same run. NULL on other kinds.
          ticket_identifier:
            type: string
            title: Ticket identifier
            description: Computed from ticket_id.identifier so the event body can name the ticket without the mapping joining collections.
            required: false
            multiple: false
            computed: true
            readonly: true
          author_name:
            type: string
            title: Author name
            required: false
            multiple: false
            computed: true
            readonly: true
            description: The run's model (else harness, else agent) on rows with a viewable run; otherwise the actor's display name.
          author_initials:
            type: string
            title: Author initials
            required: false
            multiple: false
            computed: true
            readonly: true
          author_color:
            type: string
            title: Author colour
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_label:
            type: string
            title: Conductor label
            description: Computed from conductor_id.label.
            required: false
            multiple: false
            computed: true
            readonly: true
          run_harness:
            type: string
            title: Run harness
            description: Computed from run_id.harness; shown beside the model on agent rows.
            required: false
            multiple: false
            computed: true
            readonly: true
          run_duration:
            type: string
            title: Run duration
            description: Computed from run_id duration_s (or started_at to the row time), formatted.
            required: false
            multiple: false
            computed: true
            readonly: true
          run_outcome:
            type: string
            title: Run outcome
            description: 'Computed from run_id.state on run_ended rows: failed, expired or cancelled.'
            required: false
            multiple: false
            computed: true
            readonly: true
          run_error_line:
            type: string
            title: Run error line
            description: Computed first non-empty line of a failed run's error log.
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
          changed: Activity rows are immutable; nothing writes a changed stamp.
    bb_conductor:
      bb_conductor:
        title: bakers.build conductor
        view_modes:
          full:
            template: field-map
          list_item:
            template: field-map
            label: List item
          list_item_user:
            template: field-map
            label: List item (user)
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          machine_id:
            type: string
            title: Machine ID
            required: true
            multiple: false
          label:
            type: string
            title: Label
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
          status:
            type: string
            title: Status
            required: false
            multiple: false
            settings:
              allowed_values:
                online: Online
                offline: Offline
          project_id:
            type: reference
            title: Project
            required: true
            multiple: false
            reference: bb_project
          states:
            type: string
            title: States
            description: The claimable ticket states this conductor picks up.
            required: false
            multiple: true
            settings:
              allowed_values:
                - qualification
                - plan
                - working
                - review
          workspace_root:
            type: string
            title: Workspace root
            required: false
            multiple: false
          active:
            type: boolean
            title: Active
            description: Whether the conductor may be assigned and claim work; separate from online/offline status.
            required: false
            multiple: false
          max_parallel:
            type: integer
            title: Max parallel
            required: false
            multiple: false
          current_load:
            type: integer
            title: Current load
            required: false
            multiple: false
          last_seen:
            type: datetime
            title: Last seen
            required: false
            multiple: false
          lease_expires_at:
            type: datetime
            title: Lease expires at
            required: false
            multiple: false
          conductor_name:
            type: string
            title: Conductor name
            description: The config-file stem `--conductor <name>` selects.
            required: false
            multiple: false
          last_pid:
            type: integer
            title: Last PID
            description: Reported by the serve loop that owns the process; used by a verified stop.
            required: false
            multiple: false
          node_status:
            type: string
            title: Node status
            description: running | stale | offline — the shared liveness vocabulary.
            required: false
            multiple: false
            computed: true
            readonly: true
          node_states_label:
            type: string
            title: Claimed states
            required: false
            multiple: false
            computed: true
            readonly: true
          node_load_label:
            type: string
            title: Load
            required: false
            multiple: false
            computed: true
            readonly: true
          last_seen_label:
            type: string
            title: Last seen
            required: false
            multiple: false
            computed: true
            readonly: true
          reported_load:
            type: integer
            title: Reported load
            description: The load the conductor reported on its last poll. The listing row shows it as a run badge.
            required: false
            multiple: false
            computed: true
            readonly: true
          owner_label:
            type: string
            title: Owner
            description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the owner''s display name. Present so the row has a value for the Owner cell.'
            required: false
            multiple: false
            computed: true
            readonly: true
          project_label:
            type: string
            title: Project
            description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the project''s name. Present so the user listing''s row has a value for the Project cell.'
            required: false
            multiple: false
            computed: true
            readonly: true
          status_label:
            type: string
            title: Status label
            description: 'Design-only. Not a Drupal field: the bb_status_badge formatter labels the status from its allowed values. Present so the badge component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          status_tone:
            type: string
            title: Status tone
            description: 'Design-only. Not a Drupal field: the bb_status_badge formatter keys the tone on the status (online running, offline offline). Present so the badge component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_machine:
      bb_machine:
        title: bakers.build machine
        purpose: 'Host capacity for concurrent runs, owned by one user account. Capacity (max_parallel / current_load) belongs to the machine, not to each per-project conductor; a conductor links its machine. host_key is the machine-context stem, not the composed conductor registration key. Machines are not in the workspace read scope: the owner sees them under the account Machines listing, and the full view is the machine page /user/{user}/machine/{bb_machine}.'
        view_modes:
          full:
            template: field-map
          list_item:
            template: field-map
            label: List item
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          name:
            type: string
            title: Name
            required: true
            multiple: false
          host_key:
            type: string
            title: Host key
            description: Machine-context machine_id stem, unique per machine.
            required: true
            multiple: false
          max_parallel:
            type: integer
            title: Max parallel
            description: Concurrent runs this machine accepts; default 5.
            required: false
            multiple: false
          current_load:
            type: integer
            title: Current load
            description: Runs currently claimed on this machine; default 0.
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
            settings:
              target_type: user
          owner_label:
            type: string
            title: Owner label
            description: Display name of the owner, read through owner_user_id; the machine page shows it.
            required: false
            multiple: false
            computed: true
            readonly: true
          last_run:
            type: datetime
            title: Last run
            description: 'Computed, internal: when the machine last started a run. The listing row shows it relative, captioned "Last run".'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_group:
      bb_group:
        title: bakers.build group
        purpose: The customer. Bundles projects and carries the cost centre for re-invoicing. Carries NO permissions and is NOT an OG group — og.settings registers only bb_workspace and bb_team since BB-462 D7 deregisters bb_project — it is not a rights level, so no screen may offer a permission control on it.
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
          list_item:
            template: field-map
            label: List item
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          name:
            type: string
            title: Name
            required: true
            multiple: false
          description:
            type: string
            title: Description
            description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
            required: false
            multiple: false
          image:
            type: image
            title: Image
            description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under group-images, shown uncropped as the listing row's leading avatar; initials when absent.
            required: false
            multiple: false
          billing_profile:
            type: object
            title: Billing profile
            description: 'The customer COST CENTRE for re-invoicing. Same field type and name as bb_workspace.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. Both exist; neither replaces the other.'
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
          workspace_id:
            type: reference
            title: Workspace
            description: The tenant this customer belongs to. Built by BB-316; on feat/bb-315-multi-workspace, not yet on develop.
            required: false
            multiple: false
            reference: bb_workspace
          projects:
            type: integer
            title: Projects
            description: 'Computed, internal: the number of the group''s projects the reader may view. The listing row shows it as a project badge.'
            required: false
            multiple: false
            computed: true
            readonly: true
          initials:
            type: string
            title: Initials
            description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          avatar_color:
            type: string
            title: Avatar colour
            description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the group id. Present so the avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          avatar_picture:
            type: string
            title: Avatar picture
            description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_ticket:
      bb_ticket:
        title: bakers.build ticket
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
          list_item:
            template: field-map
            label: List item
          list_item_mine:
            template: field-map
            label: List item (my work)
          list_item_compact:
            template: field-map
            label: List item (compact)
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          project_id:
            type: reference
            title: Project
            required: false
            multiple: false
            reference: bb_project
          identifier:
            type: string
            title: Identifier
            required: true
            multiple: false
          workflow:
            type: string
            title: Workflow
            required: false
            multiple: false
            settings:
              allowed_values:
                - bb_work
          title:
            type: string
            title: Title
            required: true
            multiple: false
          description:
            type: text
            title: Description
            required: false
            multiple: false
          state:
            type: string
            title: State
            description: One of the ticket's workflow states; which subset applies is decided by `workflow`. `human_input` is not a state.
            required: false
            multiple: false
            settings:
              allowed_values:
                - qualification
                - plan
                - working
                - review
                - done
                - cancelled
          ticket_type:
            type: reference
            title: Type
            description: The ticket's type term (vocabulary `type`). A ticket whose type term is named `epic` is an epic.
            required: false
            multiple: false
            reference: bb_term
          recipe:
            type: reference
            title: Recipe
            description: The ticket's recipe term (vocabulary `recipe`).
            required: false
            multiple: false
            reference: bb_term
          labels:
            type: reference
            title: Labels
            required: false
            multiple: true
            reference: bb_term
            description: The ticket's label terms (vocabulary `label`).
          assignee_user_id:
            type: reference
            title: Assignee user
            required: false
            multiple: false
            reference: user
          reviewers:
            type: reference
            title: Reviewers
            required: false
            multiple: true
            reference: user
          priority:
            type: integer
            title: Priority
            required: false
            multiple: false
            settings:
              allowed_values:
                '1': High
                '2': Medium
                '3': Low
          parent_id:
            type: reference
            title: Parent ticket
            required: false
            multiple: false
            reference: bb_ticket
          blocked_by:
            type: reference
            title: Blocked by
            required: false
            multiple: true
            reference: bb_ticket
          origin:
            type: string
            title: Origin URL
            required: false
            multiple: false
          links:
            type: link
            title: Links
            description: Typed links (uri, title, options.bakers.kind); kind is server-derived.
            required: false
            multiple: true
          comments:
            type: reference
            title: Comments
            required: false
            multiple: true
            reference: bb_comment
            computed: true
            readonly: true
          pending_reviews:
            type: reference
            title: Pending reviews
            description: Submitted reviews awaiting a decision by the current assignee (computed; never writable). Private; not part of the ordinary comment timeline.
            required: false
            multiple: true
            reference: bb_comment
            computed: true
            readonly: true
          branch_name:
            type: string
            title: Branch name
            required: false
            multiple: false
          closed:
            type: boolean
            title: Closed
            required: false
            multiple: false
          frozen:
            type: boolean
            title: Frozen
            description: Operator hold. A frozen ticket is not claimable; an active run is left running.
            required: false
            multiple: false
          frozen_at:
            type: datetime
            title: Frozen at
            description: When the operator hold started. Server-stamped, cleared on unfreeze.
            required: false
            multiple: false
            readonly: true
          closed_date:
            type: datetime
            title: Closed date
            required: false
            multiple: false
          number:
            type: integer
            title: Number
            description: Per-project running number, allocated once on first save and frozen.
            required: false
            multiple: false
            readonly: true
          conductor_id:
            type: reference
            title: Conductor
            description: Assigning a conductor is what starts a run.
            required: false
            multiple: false
            reference: bb_conductor
          time_estimate:
            type: integer
            title: Estimated time
            description: Estimated effort in SECONDS, proposed at qualification, confirmed by a human.
            required: false
            multiple: false
          time_spent:
            type: integer
            title: Spent time
            description: Accounted effort in SECONDS, proposed at review, confirmed by a human.
            required: false
            multiple: false
          referenced_tickets:
            type: reference
            title: Referenced tickets
            description: Tickets carried by this deployment (the release batch).
            required: false
            multiple: true
            reference: bb_ticket
          environments:
            type: reference
            title: Environments
            description: The managed environments this ticket concerns.
            required: false
            multiple: true
            reference: bb_environment
          env_vars:
            type: text
            title: Environment variables
            description: .env-style KEY=value lines. Inherited by sub-tickets. Readable by anyone who can view this ticket.
            required: false
            multiple: false
          metrics:
            type: object
            title: Metrics
            description: Named success metrics for this ticket.
            required: false
            multiple: true
            settings:
              properties:
                name: string
                value: string
                unit: string
                recorded: datetime
          cleaned_up:
            type: boolean
            title: Cleaned up
            description: The herdr worktree has been torn down. Distinct from `closed`.
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
          base_branch:
            type: string
            title: Base branch
            description: Parent's branch, else the first project repo default_branch, else "main".
            required: false
            multiple: false
            computed: true
            readonly: true
          effective_env_vars:
            type: text
            title: Effective environment variables
            description: env_vars resolved along the parent chain (child wins).
            required: false
            multiple: false
            computed: true
            readonly: true
          sub_tickets:
            type: reference
            title: Sub-tickets
            description: Reverse reference; parent_id is the source of truth.
            required: false
            multiple: true
            reference: bb_ticket
            computed: true
            readonly: true
          runs:
            type: reference
            title: Runs
            description: Reverse reference; bb_run.ticket_id is the source of truth.
            required: false
            multiple: true
            reference: bb_run
            computed: true
            readonly: true
          derived_status:
            type: string
            title: Derived status
            description: idle | running | … — derived from the ticket's active runs.
            required: false
            multiple: false
            computed: true
            readonly: true
          stall_reason:
            type: string
            title: Stall reason
            description: 'Why this ticket is standing still: frozen, blocked, no conductor, or failing. Empty for a moving or closed ticket.'
            required: false
            multiple: false
            computed: true
            readonly: true
          claim_machine:
            type: string
            title: Claim machine
            required: false
            multiple: false
            computed: true
            readonly: true
          since_label:
            type: string
            title: Since
            description: Humanised age of the current state, e.g. "3 minutes".
            required: false
            multiple: false
            computed: true
            readonly: true
          assignee_initials:
            type: string
            title: Assignee initials
            required: false
            multiple: false
            computed: true
            readonly: true
          assignee_name:
            type: string
            title: Assignee name
            required: false
            multiple: false
            computed: true
            readonly: true
          assignee_color:
            type: string
            title: Assignee colour
            required: false
            multiple: false
            computed: true
            readonly: true
          state_flow:
            type: string
            title: State flow
            description: Comma-separated states of the ticket's workflow, in order.
            required: false
            multiple: false
            computed: true
            readonly: true
          edit_url:
            type: url
            title: Edit URL
            required: false
            multiple: false
            computed: true
            readonly: true
          row_accent:
            type: string
            title: Row accent
            description: 'Computed, internal: the listing row''s accent rail, attention in the review phase, running while a conductor holds the ticket, otherwise none.'
            required: false
            multiple: false
            computed: true
            readonly: true
          run_summary:
            type: string
            title: Run summary
            description: 'Computed, internal: the run count and the latest run''s state, as the bb_run_summary formatter''s badge label ("5 runs · last running").'
            required: false
            multiple: false
            computed: true
            readonly: true
          run_summary_tone:
            type: string
            title: Run summary tone
            description: 'Design-only. Not a Drupal field: bb_run_summary keys the badge tone on the latest run''s state. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          run_summary_suffix:
            type: string
            title: Run summary time
            description: 'Design-only. Not a Drupal field: bb_run_summary appends the latest run''s relative time. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          stall_suffix:
            type: string
            title: Stall time
            description: 'Design-only. Not a Drupal field: bb_stall_reason appends how long a frozen ticket has been frozen. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          identifier_link:
            type: string
            title: Identifier link
            description: 'Design-only. Not a Drupal field: bb_ticket_identifier_cell renders `identifier` as a mono link to the ticket, while the compact row prints it plain. The value is the identifier; its `_formatted` companion carries the link.'
            required: false
            multiple: false
            computed: true
            readonly: true
          state_icon:
            type: string
            title: State icon
            description: 'Design-only. Not a Drupal field: bb_ticket_state_icon_cell draws the state as an icon labelled with the state (running phase full, otherwise faint). The value is the label; its `_formatted` companion carries the mark.'
            required: false
            multiple: false
            computed: true
            readonly: true
          priority_label:
            type: string
            title: Priority label
            description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell labels the priority from its allowed values. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          priority_tone:
            type: string
            title: Priority tone
            description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell marks the highest priority critical. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_label:
            type: string
            title: Conductor label
            description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_mine:
            type: boolean
            title: Conductor is the reader's
            description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          owner_name:
            type: string
            title: Owner name
            description: 'Design-only. Not a Drupal field: bb_ticket_owner_cell draws the owner as a person cell. Present so the person component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          owner_initials:
            type: string
            title: Owner initials
            description: 'Design-only. Not a Drupal field: the owner''s person initials. Present so the person component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          owner_color:
            type: string
            title: Owner colour
            description: 'Design-only. Not a Drupal field: the owner''s person colour. Present so the person component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field; sample data carries it as the record key.
          uuid: Entity key; the designbook model addresses records by `id`.
    bb_term:
      type:
        title: bakers.build ticket type
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
        fields:
          name:
            type: string
            title: Name
            required: true
            multiple: false
          description:
            type: string
            title: Description
            description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
            required: false
            multiple: false
          weight:
            type: integer
            title: Weight
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
          vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
          langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
          created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
          changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
      recipe:
        title: bakers.build recipe
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
        fields:
          name:
            type: string
            title: Name
            required: true
            multiple: false
          description:
            type: string
            title: Description
            description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
            required: false
            multiple: false
          weight:
            type: integer
            title: Weight
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
          vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
          langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
          created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
          changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
      label:
        title: bakers.build label
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
        fields:
          name:
            type: string
            title: Name
            required: true
            multiple: false
          description:
            type: string
            title: Description
            description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
            required: false
            multiple: false
          weight:
            type: integer
            title: Weight
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
          vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
          langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
          created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
          changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
    bb_run:
      bb_run:
        title: bakers.build run
        view_modes:
          full:
            template: field-map
          overlay:
            template: field-map
          teaser:
            template: field-map
          list_item:
            template: field-map
            label: List item
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          ticket_id:
            type: reference
            title: Ticket
            required: false
            multiple: false
            reference: bb_ticket
          conductor_id:
            type: reference
            title: Conductor
            required: false
            multiple: false
            reference: bb_conductor
          state:
            type: string
            title: Run state
            required: true
            multiple: false
            settings:
              allowed_values:
                - claimed
                - running
                - done
                - expired
                - failed
          claim_expires_at:
            type: datetime
            title: Claim expires at
            required: false
            multiple: false
          state_at_start:
            type: string
            title: Ticket state at start
            required: false
            multiple: false
          started_at:
            type: datetime
            title: Started at
            required: false
            multiple: false
          heartbeat:
            type: datetime
            title: Heartbeat
            required: false
            multiple: false
          worktree_path:
            type: string
            title: Worktree path
            required: false
            multiple: false
          log:
            type: text
            title: Log
            required: false
            multiple: false
          closed:
            type: boolean
            title: Closed
            required: false
            multiple: false
          closed_date:
            type: datetime
            title: Closed date
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            description: The run's owning account — comes from the conductor, never the session.
            required: false
            multiple: false
            reference: user
          agent:
            type: string
            title: Agent
            required: false
            multiple: false
          harness:
            type: string
            title: Harness
            description: Id of the agent harness package that drove the session, e.g. claude or codex.
            required: false
            multiple: false
          model:
            type: string
            title: Model
            description: The candidate's configured model, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
            required: false
            multiple: false
          model_version:
            type: string
            title: Model version
            description: The candidate's configured exact version, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
            required: false
            multiple: false
          error_log:
            type: text
            title: Error log
            description: Cause of a terminal dispatch/setup failure (state `failed`).
            required: false
            multiple: false
          tokens:
            type: integer
            title: Tokens
            description: First of the six per-run footprint fields (BB-132), written by the run-owning conductor at close. Not the ticket's `time_spent`.
            required: false
            multiple: false
          duration_s:
            type: integer
            title: Duration in seconds
            required: false
            multiple: false
          agent_turns:
            type: integer
            title: Agent turns
            required: false
            multiple: false
          tool_calls:
            type: integer
            title: Tool calls
            required: false
            multiple: false
          user_prompts:
            type: integer
            title: User prompts
            required: false
            multiple: false
          user_prompt_words:
            type: integer
            title: User prompt words
            required: false
            multiple: false
          state_flow:
            type: string
            title: State flow
            required: false
            multiple: false
            computed: true
            readonly: true
          duration:
            type: string
            title: Duration
            description: Humanised closed_date − started_at, e.g. "1m 12s".
            required: false
            multiple: false
            computed: true
            readonly: true
          ticket_identifier:
            type: string
            title: Ticket identifier
            description: 'Design-only. Not a Drupal field: the row reaches the ticket''s identifier through ticket_id, rendered by bb_ticket_identifier_cell as a mono link to the ticket. Present so the headline cell has a value.'
            required: false
            multiple: false
            computed: true
            readonly: true
          state_label:
            type: string
            title: State label
            description: 'Design-only. Not a Drupal field: bb_ticket_state_cell labels the run state from the bb_run workflow. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          state_tone:
            type: string
            title: State tone
            description: 'Design-only. Not a Drupal field: bb_ticket_state_cell keys the tone on the state (BbRun::STATE_MARKS). Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_label:
            type: string
            title: Conductor label
            description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_mine:
            type: boolean
            title: Conductor is the reader's
            description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_environment:
      bb_environment:
        title: bakers.build environment
        purpose: A managed deployment target of a project — the thing a ship ticket stamps and a verification ticket verifies against.
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          name:
            type: string
            title: Name
            required: true
            multiple: false
          project_id:
            type: reference
            title: Project
            required: true
            multiple: false
            reference: bb_project
          base_url:
            type: url
            title: Base URL
            required: false
            multiple: false
          tier:
            type: string
            title: Tier
            required: false
            multiple: false
            settings:
              allowed_values:
                production: Production
                staging: Staging
                development: Development
                other: Other
          branch:
            type: string
            title: Branch
            description: The git branch this environment deploys from.
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    user:
      user:
        title: User
        purpose: A person or app account. Modelled as the entity type `user` with its single bundle, because that is what every reference in this model targets.
        view_modes:
          full:
            template: field-map
          compact:
            template: field-map
            label: Compact
        form_modes:
          default:
            template: field-map
        fields:
          user_picture:
            type: image
            title: Profile picture
            description: Core image field; also switches on social_auth's own avatar download at login (BB-507 D3).
            required: false
            multiple: false
          field_full_name:
            type: string
            title: Full name
            description: Additive (BB-507 D4) — does not replace or derive display_name.
            required: false
            multiple: false
          name:
            type: string
            title: Username
            required: true
            multiple: false
          mail:
            type: string
            title: Email
            required: false
            multiple: false
          status:
            type: boolean
            title: Active
            required: false
            multiple: false
          roles:
            type: string
            title: Roles
            description: Machine names, e.g. bb_session.
            required: false
            multiple: true
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          access:
            type: datetime
            title: Last access
            required: false
            multiple: false
          login:
            type: datetime
            title: Last login
            required: false
            multiple: false
          timezone:
            type: string
            title: Timezone
            required: false
            multiple: false
          display_name:
            type: string
            title: Display name
            required: false
            multiple: false
            computed: true
            readonly: true
          initials:
            type: string
            title: Initials
            description: 'Design-only. Not a Drupal field: the ticket and comment entities expose assignee_initials / author_initials instead. Present so an avatar component has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
          pass: Authentication internal; no bakers.build screen renders or edits a password hash.
          init: Authentication internal (initial email); never rendered.
          preferred_langcode: Localisation internal; bakers.build is English-only.
          preferred_admin_langcode: Localisation internal; bakers.build is English-only.
          default_langcode: Entity key for translations; bakers.build users are single-language.
          changed: Drupal's user entity has no `changed` field; `access` and `login` carry recency.
    bb_profile:
      bb_profile:
        title: bakers.build profile
        purpose: 'What a person tells bakers.build about themselves, one per user and workspace (unique on uid + workspace_id): their position, their background handed to AI assistants as context, and their favorite projects. Replaces the user fields field_developer_title and field_bb_background. Edited on the Profile tab /user/{user}/profile for the workspace in context; the entity has no view display.'
        form_modes:
          default:
            template: field-map
        fields:
          uid:
            type: reference
            title: Owner
            required: true
            multiple: false
            reference: user
          workspace_id:
            type: reference
            title: Workspace
            required: true
            multiple: false
            reference: bb_workspace
          position:
            type: string
            title: Position
            description: Free text, at most 255 characters; placeholder "e.g. Product Lead".
            required: false
            multiple: false
          background:
            type: text
            title: What should bakers.build know about your background?
            description: Optional long text (string_long) handed to AI assistants as context, e.g. "Drupal developer, confident with PHP; little DevOps experience."
            required: false
            multiple: false
          favorite_projects:
            type: reference
            title: Favorite projects
            description: Projects this person marked as favorite in this workspace; not on the form.
            required: false
            multiple: true
            reference: bb_project
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_workspace:
      bb_workspace:
        title: bakers.build workspace
        purpose: 'The tenancy root: the object that says this data belongs to operator X and not operator Y. It holds all people and decides WHICH RIGHTS an account holds — BB-462 makes the workspace the ONLY level that carries rights: admin/contributor/guest (D2). Visibility of a project is a separate, per-team question (D4) that carries no rights of its own. Is an OG group (registered in og.settings) with the roles non-member, member, contributor, lead (labelled "Admin") and guest — five, not six: `owner`/`admin` were already consolidated into `lead` by BB-359 D12, and the machine principal `app` is GONE (BB-462 D9, its rank is answered entirely from OAuth scope now). Built by BB-316; the role set is BB-462''s.'
        view_modes:
          full:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          name:
            type: string
            title: Name
            required: true
            multiple: false
          description:
            type: string
            title: Description
            description: Optional plain text, one or two sentences, at most 280 characters; shown under the workspace's name in the switcher panel and on the join screen, absent when empty.
            required: false
            multiple: false
          image:
            type: image
            title: Image
            description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately and shown uncropped as the workspace's mark in the switcher and on the join screen; initials when absent.
            required: false
            multiple: false
          billing_profile:
            type: object
            title: Billing profile
            description: 'The CONTRACT or SUBSCRIPTION this tenant is served under. Same field type and name as bb_group.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. There is no `contract` field and there will not be one — the billing profile IS the contract level.'
            required: false
            multiple: false
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_team:
      bb_team:
        title: bakers.build team
        purpose: 'The stable crew, cutting across customer projects, and since BB-419 also their structural parent: a project is assigned to teams n:m through bb_project.teams and belongs to at least one. BB-462 D4 REVERSES what this field used to say: the assignment now DECIDES VISIBILITY — an account sees exactly the projects of the teams it belongs to (or every project, if it holds the workspace admin tier) — while still granting no RIGHTS of its own; a team answers "what do you see", the workspace alone answers "what may you do" (D2/D3). Is an OG group (registered in og.settings) with the roles non-member, member, lead (BB-456 D9, team-scoped statistics visibility) and owner (BB-462 D3, manages the team itself — who may join it and its own settings). The implicit member rank stays empty by design: team membership is a visibility fact, not a rights tier.'
        view_modes:
          full:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          name:
            type: string
            title: Name
            required: true
            multiple: false
          workspace_id:
            type: reference
            title: Workspace
            required: true
            multiple: false
            reference: bb_workspace
          projects:
            type: reference
            title: Projects
            description: The projects assigned to this team. Derived from bb_project.teams and never stored here, so the two directions cannot disagree.
            required: false
            multiple: true
            reference: bb_project
            computed: true
            readonly: true
          owner_user_id:
            type: reference
            title: Owner
            required: false
            multiple: false
            reference: user
    og_membership:
      default:
        title: OG membership
        purpose: 'Membership is ONE mechanism, modelled once: a user x group row reused by workspace and team rather than re-invented per level. This is NOT a bakers.build invention — it is contrib Organic Groups'' own og_membership entity, whose only bundle is `default` (og.og_membership_type.default). BB-462 D7 REVERSES what this field used to say: og.settings now registers only bb_workspace and bb_team as OG groups — bb_project is deregistered entirely, and every membership row anchored on a project is deleted by that ticket''s migration. BB-318 bridges the remaining rows into bakers.build''s query access. A screen reads membership here, never from a field on the group.'
        view_modes:
          teaser:
            template: field-map
          full:
            template: field-map
        fields:
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          changed:
            type: datetime
            title: Changed
            required: false
            multiple: false
          type:
            type: string
            title: Membership type
            description: OG's bundle key — in code an entity reference to the og_membership_type config entity. Modelled as its value set rather than as a reference because bakers.build ships exactly one instance, og.og_membership_type.default, and no screen renders or chooses it.
            required: false
            multiple: false
            settings:
              allowed_values:
                - default
          uid:
            type: reference
            title: User
            description: The member. OG's own field name — not `user_id`.
            required: true
            multiple: false
            reference: user
          entity_type:
            type: string
            title: Group entity type
            description: Which level this membership is in. A workspace or project membership grants rights; a team membership does not, because the team carries no permissions.
            required: false
            multiple: false
            settings:
              allowed_values:
                - bb_workspace
                - bb_project
                - bb_team
          entity_bundle:
            type: string
            title: Group bundle
            description: Bundle of the group entity. Each of the three types has one bundle of its own name.
            required: false
            multiple: false
          entity_id:
            type: string
            title: Group entity ID
            description: Id of the group named by entity_type. A plain STRING in OG, not a reference, because the target entity type varies per row — so no screen can rely on an entity-reference widget here.
            required: false
            multiple: false
          state:
            type: string
            title: State
            description: Defaults to active. Only an active membership grants what its roles carry.
            required: true
            multiple: false
            settings:
              allowed_values:
                - active
                - pending
                - blocked
          roles:
            type: reference
            title: Roles
            description: 'MULTI-VALUE (OG sets cardinality unlimited) and a reference to og_role config objects by their full id, e.g. bb_workspace-bb_workspace-lead. The `member` role is never stored: OgMembership::preSave() revokes it and getRoles() prepends it on read, so a row that looks role-less is still a member.'
            required: false
            multiple: true
            reference: og_role
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
          language: Entity key; bakers.build memberships are single-language and no screen renders a language.
    bb_addon:
      bb_addon:
        title: bakers.build addon
        purpose: An addon definition at one version (name@version), registered by the conductors that run it. Entity access is admin-only; workspace leads see the addons in the workspace Settings › Addons tab, one row per name at its newest version with all its versions and the conductors of the current workspace that run each version. The definition is immutable once registered and may carry an inline SVG icon. Read-only on every screen.
        view_modes:
          list_item:
            template: field-map
            label: List item
        fields:
          name:
            type: string
            title: Name
            description: Machine name of the addon, e.g. ports. Together with version it forms the name@version key.
            required: true
            multiple: false
          version:
            type: string
            title: Version
            description: Semantic version string, e.g. 1.2.3.
            required: true
            multiple: false
          contract:
            type: integer
            title: Contract
            description: Version of the addon definition contract the addon implements, e.g. 1.
            required: true
            multiple: false
          definition:
            type: text
            title: Definition
            description: 'Immutable JSON addon definition: label, views, actions and an optional inline SVG icon. The Settings › Addons tab shows only its label and icon.'
            required: true
            multiple: false
          conductors:
            type: reference
            title: Conductors
            description: Conductors that registered (run) this addon version.
            required: false
            multiple: true
            reference: bb_conductor
            settings:
              target_type: bb_conductor
          created:
            type: datetime
            title: Created
            required: false
            multiple: false
          label:
            type: string
            title: Label
            description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter prints the definition''s label. Present so the headline cell has a value.'
            required: false
            multiple: false
            computed: true
            readonly: true
          versions_label:
            type: string
            title: Versions
            description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter lists every version of the name once, newest first. Present so the Versions cell has a value.'
            required: false
            multiple: false
            computed: true
            readonly: true
          initials:
            type: string
            title: Initials
            description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter draws the initials of the label. Present so the avatar has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          avatar_color:
            type: string
            title: Avatar colour
            description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter keys the avatar colour on the addon id. Present so the avatar has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
          conductor_badges:
            type: string
            title: Conductors
            description: 'Design-only. Not a Drupal field: the bb_addon_conductors formatter renders `conductors` as one dotted badge per conductor and version ("<conductor> <version>", running when online, offline otherwise), or "No conductor in this workspace". The value lists the badges as text; its `_formatted` companion carries the rendered badges.'
            required: false
            multiple: false
            computed: true
            readonly: true
          avatar_picture:
            type: string
            title: Avatar picture
            description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter turns the definition''s inline SVG icon into a data URI; empty for initials. Present so the avatar has a prop.'
            required: false
            multiple: false
            computed: true
            readonly: true
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
  config:
    image_style:
      avatar:
        aspect_ratio: '1:1'
    omitted:
      bb_core.bb_vocabulary: The vocabulary IS the bb_term bundle; no screen renders it as an object of its own.
      view.environments: Drupal has no environments View, and no list of environments exists yet. The bb_project environments field is hidden on the project full display; only its referenced names show on the project properties detail card (BbEntityDetailCardForm). Ship tickets show their environments as chips in the ticket inspector. The view.environments mapping is ahead of the backend and has no Drupal counterpart.
    og_role:
      og_role:
        title: OG role
        purpose: 'The role vocabulary of the OG groups — what a Settings screen assigns a person on a workspace or a team. Contrib Organic Groups'' own config entity. AS-IS, MEASURED IN config/sync AT BB-462: NINE objects, not ten — bb_project carries no role at all any more (D7 deregisters it as an OG group entirely). Five for bb_workspace (non-member, member, contributor, lead, guest) and four for bb_team (non-member, member, lead, owner). `app` is GONE (D9: a conductor''s OAuth identity is bound to its owning user, so it sees exactly what that user''s own rank sees — no separate machine rank exists to list here). `owner` is NEW (D3): governs the team itself, who may join it and its own settings. The key is the Drupal config-name PREFIX, so this is one entry per config entity TYPE; the instances live in sample data. Three facts a screen must not get wrong. First, `permissions` is NOT an empty list on every role: bb_workspace-lead and -contributor carry real permission strings (create/edit/delete rights), bb_workspace-guest carries read-only, and bb_team-owner carries `manage members`/`update group`. It IS empty on exactly four: the three non-member roles and bb_team-bb_team-member — the implicit member rank is deliberately emptied everywhere (D1: OG ranks are additive and cannot be narrowed, so any right left on an implicit rank is inherited by every membership including guests). Second, `is_admin` is FALSE on all nine. Third, "a workspace admin sees every project of their workspace" (D4) is a VISIBILITY rule computed from the rank id, never an OG admin flag or a project-level role — there is no project-level role left to read at all. TARGET: product roles are OG ranks only; team ownership is the one new rank this ticket adds.'
        fields:
          id:
            type: string
            title: Machine name
            description: Composed as <group_type>-<group_bundle>-<role name>, e.g. bb_workspace-bb_workspace-lead. This full id is what og_membership.roles references.
            required: true
            multiple: false
          label:
            type: string
            title: Label
            description: The human name a Settings screen shows, e.g. "Administrator".
            required: true
            multiple: false
          weight:
            type: integer
            title: Weight
            description: Display order within a group type; 0 for non-member, rising to 5 for the workspace app role.
            required: false
            multiple: false
          is_admin:
            type: boolean
            title: Is admin
            description: FALSE on every shipped role — measured in config/sync at BB-435 across all ten og.og_role objects, and the role it used to name does not exist. Read the role id, never this flag. See the purpose above.
            required: false
            multiple: false
          permissions:
            type: string
            title: Permissions
            description: OG permission strings. Empty in exactly four of the ten shipped roles — the three non-member roles and bb_team-bb_team-member — see the purpose above before designing anything that edits this.
            required: false
            multiple: true
          group_type:
            type: string
            title: Group entity type
            required: true
            multiple: false
            settings:
              allowed_values:
                - bb_workspace
                - bb_project
                - bb_team
          group_bundle:
            type: string
            title: Group bundle
            required: true
            multiple: false
          role_type:
            type: string
            title: Role type
            description: '`required` for the two roles OG creates for every group (non-member, member); `standard` for the roles bakers.build adds. A screen must not offer to delete a required role.'
            required: true
            multiple: false
            settings:
              allowed_values:
                - required
                - standard
        omitted:
          uuid: Config entities carry a uuid that is not part of the modelled key set and is never rendered.
          group_id: Null in all ten shipped roles. OG sets it only for a role scoped to one single group instance, which bakers.build ships none of, so no screen renders it.
    view:
      addons:
        title: Addons
        purpose: Lists every registered addon once, at its newest version, with the conductors of the routed workspace that run any of its versions.
        base_table: bb_addon
        items_per_page: 50
        columns:
          - icon
          - label
          - name
          - versions
          - contract
          - conductors
        displays:
          default:
            plugin: default
          settings:
            plugin: page
            path: /_workspace/%bb_workspace/settings/addons
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_addon records the View lists; Drupal renders each row as the addon in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_addon
                bundle: bb_addon
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: bb_empty.'
            required: false
            multiple: false
      conductors:
        title: Conductors
        purpose: |-
          Two listings of bb_conductor. The user-area rail item (user_list) is the
          conductors assigned to the account in the URL, any workspace. The project
          tab (project_list) is that project's conductors, any owner. Both walk
          project_id then group_id because bb_conductor carries no workspace field
          of its own. Both joins are INNER: a conductor whose project or group is
          gone has no workspace to be listed under.
        base_table: bb_conductor
        items_per_page: 50
        columns:
          - conductor_id
          - label
          - status
          - reported_load
          - owner_user_id
          - last_seen
        displays:
          default:
            plugin: default
          project_list:
            plugin: page
            path: /_workspace/%bb_workspace/project/%bb_project/conductors
          user_list:
            plugin: page
            path: /user/%user/conductors
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_conductor records the View lists; Drupal renders each row as the conductor in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_conductor
                bundle: bb_conductor
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: text_custom.'
            required: false
            multiple: false
      conductor_tickets:
        title: Conductor tickets
        purpose: |-
          Tickets occupying one conductor. The occupancy source supplies explicit
          numeric ticket ids; this view never lists by ticket conductor_id and has
          no page route.
        base_table: bb_ticket
        columns:
          - identifier
          - title
        displays:
          default:
            plugin: default
          occupancy:
            plugin: embed
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item_compact` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_ticket
                bundle: bb_ticket
                view_mode: list_item_compact
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: text_custom.'
            required: false
            multiple: false
      groups:
        title: Groups
        purpose: Lists the groups of the routed workspace. The Groups page owns the create-group action. A group organizes customer and cost-centre data; it grants no permissions.
        base_table: bb_group
        items_per_page: 50
        columns:
          - name_avatar
          - name
          - description
          - projects
          - changed
        displays:
          default:
            plugin: default
          workspace_list:
            plugin: page
            path: /_workspace/%bb_workspace/groups
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_group records the View lists; Drupal renders each row as the group in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_group
                bundle: bb_group
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: bb_empty.'
            required: false
            multiple: false
      machines:
        title: Machines
        purpose: |-
          The user-area rail item (user_list) is the machines assigned to the
          account in the URL, any workspace.
        base_table: bb_machine
        items_per_page: 50
        columns:
          - name
          - max_parallel
          - current_load
          - owner_user_id
          - last_run
        displays:
          default:
            plugin: default
          user_list:
            plugin: page
            path: /user/%user/machines
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_machine records the View lists; Drupal renders each row as the machine in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_machine
                bundle: bb_machine
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: text_custom.'
            required: false
            multiple: false
      project_board:
        title: Project board
        purpose: |-
          Four-column project board of bb_ticket on the tickets Search API
          index. The page display owns the route. Each lifecycle column is a
          bb_board_column attachment with its own mini pager. Column membership is the indexed work_state value.
          Parent focus applies to every display; the page header summarizes the whole matching selection.
        base_table: search_api_index_bb_tickets
        items_per_page: 10
        columns:
          - identifier
        displays:
          default:
            plugin: default
          backlog:
            plugin: bb_board_column
          done:
            plugin: bb_board_column
          intake:
            plugin: bb_board_column
          project_board:
            plugin: page
            path: /_workspace/%bb_workspace/project/%bb_project/board
          working:
            plugin: bb_board_column
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_ticket records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_ticket
                bundle: bb_ticket
                view_mode: default
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
      projects:
        title: Projects
        purpose: |-
          The projects of the workspace named in the URL, five columns. A LISTING IS A
          VIEW: the row this replaced was a bb_project.bb_project.teaser view mode,
          and BB-389 removed it because a list row was never a view mode.

          THE ROWS COME FROM THE URL, and that is this view's own argument rather than the
          query-access layer's doing. BbWorkspaceReadScope resolves an ACCOUNT's scope —
          the union of every OG membership, with no workspace parameter — so for a user
          who belongs to several workspaces it admits more rows than the URL asked for.
          The `workspace_id` argument narrows to the one workspace, walking the group_id
          relationship because bb_project carries no workspace field of its own. Its
          `default_action` is `access denied` rather than a fallback to all: a view that
          listed every workspace the moment a route stopped supplying the parameter is how
          ambient scoping turns into a disclosure. Query access stays the floor
          underneath — the two layers answer two different questions.

          THE TWO RELATIONSHIPS DISAGREE ABOUT `required` ON PURPOSE. owner_user_id is a
          LEFT JOIN, and the reason stated here used to be that BbProject::owner_user_id
          is not setRequired(TRUE). That is now FALSE — the field has carried
          setRequired(TRUE) since 66780aa93 — and the LEFT JOIN is still right, so only
          the rationale is corrected. setRequired() is a VALIDATION constraint on a write
          to the project; it is not delete protection on the account referenced. bb_core
          guards that nowhere — no preDelete, no cascade, no reference constraint — so a
          stored project can still be left pointing at a deleted user, and an inner join
          on it drops the whole project from this listing the moment that happens: no
          message, no empty cell, no row. group_id stays an INNER JOIN, and for a positive
          reason rather than the same one: it carries the workspace argument, so a project
          whose group is gone has no workspace to be listed under, and the honest answer
          is no workspace rather than every workspace. That the referenced rows can vanish
          at all is a data-integrity gap, not this listing's to paper over.

          TWO DESIGNED COLUMNS ARE ABSENT, NAMED HERE RATHER THAN LEFT TO AN EMPTY SPACE.
          Teams is absent, and the reason stated here used to be that bb_project carries
          no `teams` field at all. That is now FALSE, in the same way the owner_user_id
          sentence above was: BB-419 added `teams` as a required, unlimited-cardinality
          entity_reference (BbProject.php), so the n:m assignment DOES exist and the
          cancelled BB-356 no longer describes the state of the field. What is true is
          that this listing still renders no teams column, and no decision has been
          recorded that it should not — so this is an open question about the listing
          rather than a structural impossibility, and it is named as one here instead of
          being justified by a field that is gone from the reasoning. Environments is
          absent for a reason that does still hold: it is a COUNT over a multi-value
          entity reference and core views has no field for that; a column showing the
          first referenced environment instead of the count would be a different and
          wrong value.

          IT COMPOSES A CANVAS WHOSE HEADING LIVES IN THE SHELL. The screen title,
          tabs and New-project action are the `page_header` island on
          `island.profile.bb_shell`. This display's tree is `bb_theme:canvas`
          with a `bb_theme:zone` in `main` wrapping `view_rows` plus `view_pager`.
          The `empty` area is untouched, because ui_patterns' own `view_rows` source
          renders a view's empty areas when it has no rows.

          THE ROWS ARE STILL CORE'S `table` WITH `row: type: fields`, AND NOT FOR THE
          REASON D1 GAVE. D1 priced the alternative as a bespoke ui_patterns Source, and that
          is not what it costs: a PRESENTER TEMPLATE — a markup-free template that
          transforms what views handed it and include()s the component, reached by core's
          own theme suggestion (ViewExecutable::buildThemeFunctions() emits
          views_view_table__projects) — needs no plugin and would leave this file exactly
          as it is. What IS true is that site building cannot do it: `rows` is a PROP
          holding an array of objects, and no shipped ui_patterns source serves such a
          prop type — ui_patterns_views's view_rows declares `prop_types: [slot]`, and
          across all 22 shipped sources the prop types are attributes, boolean, enum,
          enum_list, enum_set, identifier, links, list, number, slot, string, url and
          variant. That absence is the condition under which a presenter is the right
          answer rather than a trick. BB-413 owns that template; when it lands this
          listing renders through bb_theme:table with no change here.
        base_table: bb_project
        items_per_page: 50
        columns:
          - name_avatar
          - name
          - key
          - description
          - open_tickets
          - conductor_tickets
          - closed_tickets
          - created
        displays:
          default:
            plugin: default
          workspace_list:
            plugin: page
            path: /_workspace/%bb_workspace/projects
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_project records the View lists; Drupal renders each row as the project in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_project
                bundle: bb_project
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: bb_empty.'
            required: false
            multiple: false
      runs:
        title: Runs
        base_table: search_api_index_bb_runs
        items_per_page: 10
        columns:
          - identifier
          - state
          - state_at_start
          - conductor_id
          - agent
          - started_at
          - duration_s
        displays:
          default:
            plugin: default
          project_runs:
            plugin: page
            path: /_workspace/%bb_workspace/project/%bb_project/runs
          team_runs:
            plugin: page
            path: /_workspace/%bb_workspace/team/%bb_team/runs
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_run records the View lists; Drupal renders each row as the run in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_run
                bundle: bb_run
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          header:
            type: text
            title: Header
            description: 'Drupal header area: views_filters_summary.'
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: bb_contextual_empty.'
            required: false
            multiple: false
      tickets:
        title: Tickets
        base_table: search_api_index_bb_tickets
        items_per_page: 10
        columns:
          - state
          - title
          - priority
          - identifier
          - created
          - owner
          - conductor
          - stall_reason
          - run_count
          - assignee
        displays:
          default:
            plugin: default
          my_work:
            plugin: page
            path: /_workspace/%bb_workspace/tickets
          page_1:
            plugin: page
            path: /_workspace/%bb_workspace/tickets/all
          project_tickets:
            plugin: page
            path: /_workspace/%bb_workspace/project/%bb_project/tickets
          team_tickets:
            plugin: page
            path: /_workspace/%bb_workspace/team/%bb_team/tickets
        view_modes:
          default:
            template: list-view
        fields:
          rows:
            type: view_rows
            title: Rows
            description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item` view mode.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_ticket
                bundle: bb_ticket
                view_mode: list_item
          items_per_page:
            type: integer
            title: Items per page
            required: false
            multiple: false
          header:
            type: text
            title: Header
            description: 'Drupal header area: views_filters_summary.'
            required: false
            multiple: false
          empty:
            type: text
            title: Empty
            description: 'Drupal empty area: bb_contextual_empty.'
            required: false
            multiple: false
namespace: bb_theme
data_dir: /var/www/html/web/themes/custom/bb_theme/designbook
```

## Context
### task:refresh-components (task, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/tasks/refresh-components.md)
```
---
title: Refresh built components
trigger:
  steps: [refresh-components]
params:
  type: object
  required: [command, cwd, index_url, story_ids]
  properties:
    command: {type: string, description: Storybook build command resolved during intake.}
    cwd: {type: string, description: Absolute Storybook application directory.}
    index_url: {type: string, description: Absolute live Storybook index URL resolved during intake.}
    story_ids:
      type: array
      minItems: 1
      description: >
        CSF story ids for the frozen component+variant selection. For components
        written in this run, derive each id from namespace + group + component +
        variant via the active component-framework story-address rule. For retained
        existing stories, copy the exact id from the live index. The list is the
        fixed scope checklist for those identities.
      items: {type: string}
result:
  type: object
  required: [build, index]
  properties:
    build:
      $ref: ../schemas.yml#/StorybookBuild
    index:
      $ref: ../schemas.yml#/StorybookIndex
---

# Refresh built components

Produce successful build evidence and refreshed index entries for every selected `story_ids` value after the declared component writes. The live Storybook instance reflects those writes before dependent mappings or scenes are produced.

`story_ids` is the fixed scope checklist for this run: the union of (1) CSF ids **derived** from each written component’s frozen identity (`namespace` + `group` + `component` + `variant`) under the active component-framework story-address rule, and (2) exact live-index ids for any retained existing stories. Selection stays that identity set; the refresh proves those addresses exist after the build.

Completion: `build` contains the actual successful command result, and `index` contains every selected story from the refreshed live inventory. Missing selected stories block the task; target selection stays fixed.

```

### task:create-sample-data (task, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/skills/sample-data/tasks/create-sample-data.md)
```
---
title: 'Create Sample Data: {{ bundle.entity_type }}.{{ bundle.bundle }}'
trigger:
  steps:
    - create-sample-data
domain:
  - sample-data
params:
  type: object
  required:
    - section_id
    - bundle
    - data_model
    - components_dir
    - records
  properties:
    section_id:
      type: string
      description: Section identifier — becomes the __designbook.section tag value on every generated record
    bundle:
      $ref: ../schemas.yml#/BundleRef
    sample_data_bundles:
      type: array
      description: >-
        The entity_type+bundle pairs to generate, supplied by intake (rendered entities + their reference
        targets). The fixed inventory from which intake declares concrete tasks.
      items:
        $ref: ../schemas.yml#/BundleRef
    entities:
      type: array
      default: []
    data_model:
      path: $DESIGNBOOK_DATA/data-model.yml
      workflow: /debo-data-model
      type: object
    components_dir:
      path: $DESIGNBOOK_DIRS_COMPONENTS
      type: string
      description: Available components — required for canvas bundle generation (rule canvas.md)
    records:
      type: array
      description: Ordered records to write or update. Length is the count; each entry names id, summary and values.
      items:
        $ref: ../schemas.yml#/PlannedSampleRecord
result:
  type: object
  required:
    - sample-data
  properties:
    sample-data:
      path: $DESIGNBOOK_DATA/data/{{ bundle.entity_type }}.{{ bundle.bundle }}.yml
      $ref: ../schemas.yml#/SampleDataBundle
      validators:
        - data
---

# Sample Data

## Result: sample-data

Produce the complete sample pool for the selected bundle. The written pool contains the declared `records` in order. Apply only the record/field changes fixed by intake; retain unrelated records and fields, stable IDs, order and existing section tags. Add the requested section tag without discarding other tags.

Reuse a sufficient pool without scheduling a write. When more samples are necessary, preserve existing records and append only the declared shortfall with unused IDs. A selected record update preserves its identity. Preserve other bundles and all unrelated model/display configuration.

Completion: every sample selector and required field recorded by intake resolves, with the preserved data unchanged. Bundles outside the selected scope remain untouched; an excluded bundle never replaces its existing pool with an empty result.

```

### task:map-entity--design-screen (task, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/tasks/map-entity--design-screen.md)
```
---
title: >-
  Map Entity: {{ mapping.entity_type }}.{{ mapping.bundle }}.{{ mapping.mode_kind = 'form' ? mapping.form_mode
  : mapping.view_mode }}
trigger:
  steps:
    - design-screen:map-entity
    - design-entity:map-entity
    - design-component:map-entity
    - design-shell:map-entity
domain:
  - data-mapping
params:
  type: object
  required:
    - mapping
    - data_model
  properties:
    mapping:
      type: object
      $ref: ../schemas.yml#/EntityMapping
    data_model:
      path: $DESIGNBOOK_DATA/data-model.yml
      workflow: debo-data-model
      type: object
    component:
      type: string
      description: >
        Qualified target component ID (`namespace:name`) for a field-map mapping.
        Omitted when the mapped bundle carries a `component_tree` field — that tree
        is the composition, passed through from sample records.
      examples: [test_integration_vue:signage]
    bindings:
      type: array
      description: >
        Field-to-prop and field-to-slot bindings for the target component.
        Empty or omitted when the mapped bundle carries a `component_tree` field.
      items:
        $ref: ../schemas.yml#/MappingBinding
result:
  type: object
  required:
    - entity-mapping
  properties:
    entity-mapping:
      path: >-
        $DESIGNBOOK_DATA/{{ mapping.mode_kind = 'form' ? 'form-mapping' : 'entity-mapping' }}/{{
        mapping.entity_type }}.{{ mapping.bundle }}.{{ mapping.mode_kind = 'form' ? mapping.form_mode :
        mapping.view_mode }}.jsonata
      validators:
        - entity-mapping
---

# Map Entity

Produce the complete mapping expression for the one entity type, bundle and mode selected by `mapping`. A field-map mapping targets `component` and binds exactly the listed `bindings`. A mapping whose bundle has a `component_tree` field passes that field through from the sample records. Apply the requested field-output delta to the existing expression when present, preserving unrelated assignments and references.

Retain other view/form modes, bundles, model/display settings and sample records. Any necessary model, sample or consumer changes are separate outputs/tasks declared by intake. Reuse components that already satisfy the mapping.

Completion: the selected mapping expresses the requested delta. Field-map mappings bind exactly the declared fields; `component_tree` mappings evaluate to the sealed sample tree. All preserved assignments remain equivalent. The saved definition includes the standalone preview and concrete mapped-field browser observations.

```

### task:validate (task, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/tasks/validate.md)
```
---
title: "Validate"
trigger:
  steps: [validate]
params:
  type: object
  required: [story_url]
  properties:
    story_url:
      type: string
      resolve: story_url
      from: scene_id
result:
  type: object
  required: [build, checks]
  properties:
    build:
      $ref: ../schemas.yml#/StorybookBuild
    checks:
      $ref: ../schemas.yml#/StorybookChecks
---

# Validate Story

Produce successful final build and browser evidence for `story_url` after all
declared artifact writes. The live story reflects those writes and satisfies the
appearance, interaction, responsive and preservation criteria fixed during intake.

Completion: the final build succeeds, every declared browser check passes, and
recorded observations establish the intake criteria on the current rendered story.

```

### ctx:cli-surface (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/workflow/rules/cli-surface.md)
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

### ctx:variant-transport (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/variant-transport.md)
```
---
trigger:
  steps: [write-component, refresh-components, validate, create-scene-file, write-scene, map-entity]
  domain: [components, scenes]
---

# Variant Transport

`variants:` in a component's definition is the **single declaration site** for a
component's variant set — the enumerated set of variant IDs a component supports.
No render path re-declares that set. Selecting *among* the declared variants happens
through exactly one channel per render path; a render path never carries two competing
variant-selection channels at once.

## Render-Path Matrix

| Render path | Selection channel | Notes |
|---|---|---|
| Story file (`<component>.<variant>.story.yml`) | Top-level `variant` field | The story identity already encodes the variant in its filename; the top-level `variant` field is the single selection channel for that file. A `variant` key nested under `props` is a second, competing declaration and is forbidden. |
| Scene/mapping node (a scene, entity view-mode, or shell composition placing a component instance) | `props.variant` | The renderer forwards only a node's `props` to the component; a top-level `variant:` key on a scene/mapping node is silently ignored. `props.variant` is the correct — and only — selection channel here. |
| Backend-driven selection (`variant_id`) | The `variant_id` field of the backend's own component-selection mechanism | `variant_id` is a backend transport detail carrying an already-resolved variant choice into the render call. It does not create a second source of truth alongside `variants:`, and it is a different field name from both `variant` (story) and `props.variant` (scene node) — do not conflate the three. |

A component's `.component.yml` never declares a `variant` (or `*_variant`) property
under `props.properties` — that would create a second, competing declaration of the
variant set alongside `variants:`. This constraint is independent of the render-path
matrix above: it governs the component's own schema, not how a consumer selects among
the variants that schema declares.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| VARIANT-01 | error | A `.component.yml`'s `props`/`props.properties` never declares a `variant` or `*_variant` property when `variants:` is populated | body |
| VARIANT-02 | error | A `.story.yml` file selects its variant via the top-level `variant` field, never via a `variant` key nested under `props` | body |

```

### ctx:typed-component-boundary (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/typed-component-boundary.md)
````
---
trigger:
  steps: [write-component, refresh-components, validate, create-scene-file, write-scene, map-entity]
  domain: [components, scenes]
---

# Typed Component Boundary

A component varies only through named typed props or declared variants — never through
an open-ended prop that hands a caller raw styling material to fill in. A caller selects
*what* the component is (a variant) or supplies *typed values* (a size enum, a color
token, a boolean flag); it never supplies *how* the component looks by injecting a class
string, style string, or similar free-form styling payload.

## Permitted: Attribute/Class Merge at the Component's Own Root Element

A component may merge caller-supplied HTML attributes (including a `class` attribute)
onto **its own root element**, for the caller's own integration needs (test hooks,
layout-context spacing utilities applied by the parent that owns that spacing decision).
This is attribute passthrough at the boundary the component itself controls — the
component's internal structure and its own variation are untouched by what comes through.

## Forbidden: An Open `class`/`classes` Prop the Caller Fills In

A component must not declare a `class` or `classes` prop in its own schema as the
mechanism through which a caller selects the component's appearance. If a caller can put
arbitrary layout, color, size, or spacing classes into that prop and have the component
render differently as a result, the prop has become an undeclared, untyped variant
channel — every distinct value is an undocumented variant the component's schema never
enumerates.

**Wrong** (open prop used to steer the component's own appearance):

```yaml
props:
  properties:
    classes:
      type: string
      description: Additional classes for color and spacing
```

```
{{ classes }}  <!-- caller decides: bg-blue-500 px-4 py-2, or bg-red-500 px-8 py-1, ... -->
```

**Correct** (typed props / declared variants for anything the component varies by):

```yaml
props:
  properties:
    size:
      type: string
      enum: [sm, md, lg]
    tone:
      type: string
      enum: [neutral, accent]
variants: [default, compact]
```

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| TYPED-01 | error | A component's `props`/`props.properties` does not declare a `class` or `classes` property used to inject layout classes (spacing, positioning, grid/flex placement) that a caller fills in to change the component's own layout | body |
| TYPED-02 | error | A component's `props`/`props.properties` does not declare a `class` or `classes` property used to inject color, size, or padding variation that a caller fills in to steer the component's appearance | body |
| TYPED-03 | error | A component's `props`/`props.properties` does not declare a new open `class`/`classes` prop as a general styling escape hatch; appearance variation is expressed via named typed props or `variants:` instead | body |

````

### ctx:component-contract-index (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/component-contract-index.md)
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

### ctx:sdc-components (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/components/rules/sdc-components.md)
````
---
trigger:
  steps: [write-component, refresh-components, validate]
  paths: ['$DESIGNBOOK_HOME/components/**/*.component.yml']
filter:
  frameworks.component: sdc
---

# SDC Component Rules

Format and logic constraints for the three SDC artefacts. Build patterns and markup
templates live in [schemas.yml](../schemas.yml) and [blueprints/](../blueprints/).

## Global

### Naming

- Component directory + file basenames: **kebab-case** (`nav-main/nav-main.*`).
- **Slot keys and prop keys: snake_case**. Story field names and Twig variable references mirror these exactly — hyphens silently break Twig (`{{ main-content }}` parses as subtraction and falls back to empty).
- Filename matches directory name.
- Components visually descriptive, never domain-specific: `card` not `article-card`.

### group

`group:` required. Reuse an existing group when one fits; suggested groups: `Action`, `Data Display`, `Form`, `Navigation`, `Layout`, `Shell`.

### Storybook story address

Freeze identity in the plan as `namespace` + `group` + `component` + `variant`. Derive every CSF story id and story URL from that identity.

The SDC Storybook addon builds:

```text
title = {namespace}/{group}/{name}
id    = sanitize(title)--sanitize(variant)
```

`sanitize` lowercases and turns spaces/underscores/other non-alphanumerics into `-` (CSF `toId`). Examples:

| namespace | group | component `name` / dir | variant | CSF story id |
|---|---|---|---|---|
| `test_integration_drupal` | `Shell` | `Header` / `header` | `default` | `test-integration-drupal-shell-header--default` |
| `test_integration_drupal` | `Action` | `Button` / `button` | `primary` | `test-integration-drupal-action-button--primary` |
| `test_integration_drupal` | `Data Display` | `Icon` / `icon` | `default` | `test-integration-drupal-data-display-icon--default` |

`group: Shell` → segment `shell`. `group: Data Display` → segment `data-display`. The middle segment is always the declared `group`.

When `group` is absent, the addon falls back to title group `SDC` → segment `sdc`. That fallback applies only to retained existing stories that already lack `group` in the live index. Every new or rewritten component declares `group:` and therefore uses the group-derived segment above.

`refresh-components.story_ids` and every `validate` / capture story address for components written in this run use these derived ids. Retained fixture stories keep the exact id already present in the live index.

### File Set

Required artefacts per component, all kebab-case:

- `<name>.component.yml` — metadata + schema
- `<name>.twig` — markup, one file, all variants inline
- `<name>.<variant>.story.yml` — one file per variant. SDC itself does not require this, but designbook does: every component always ships at least `<name>.default.story.yml` so it has a Storybook entry and can be visually verified.

Co-located assets (auto-discovered — do **not** declare them in `.component.yml`):

- `<name>.css` — component-scoped styles (optional)
- `<name>.js` — the component's JavaScript. Co-located `<name>.js` is the **default, auto-discovered integration point for any component JS** — interaction, progressive enhancement, third-party widget wiring, whatever the component needs. Picked up by filename and active in Storybook — Drupal behaviors are attached after each render, both in the component's own story and in the designbook-generated scene and entity view-mode stories the component is placed into. The JS approach is not fixed: the `js-behavior` blueprint offers a `Drupal.behaviors` starting point, but a project may use another (Alpine, vanilla, …) — blueprints are overridable. Add it when the component needs scripting; omit when it doesn't.

`libraryDependencies` / `libraryOverrides` in `.component.yml` is only required when the component pulls in an **external** library (third-party widget like a slider, lightbox, chart) or extends another component's library. For plain co-located `<name>.css` / `<name>.js`, the SDC addon picks them up by filename — no YAML wiring.

### YAML Quoting

Always double quotes (`"`) in every YAML file. Single quotes break the SDC Storybook addon parser.

### Namespace Substitution

`DESIGNBOOK_COMPONENT_NAMESPACE` is a literal placeholder — replace with the resolved namespace value before writing the file.

## .component.yml

- `thirdPartySettings.sdcStorybook.disableBasicStory: true` mandatory on every component — disables auto-generated basic stories since explicit `.story.yml` files are always provided.
- `variants:` is the canonical source for variant definitions. Never declare `variant` under `props.properties` when `variants:` is already defined top-level.
- Empty `variants`, `props`, or `slots` are omitted entirely — never written as empty blocks.
- Same props + same slots, different markup → single component with variants.
- Different props or slots → separate components.
- Stories never live inside `.component.yml`.

## .twig

- **One root element** with `attributes.addClass`: `<div{{ attributes.addClass(['name']) }}>`. No fragments.
- **Filter the class array, not the `attributes` object.** A filter applied to the `addClass(...)` return value runs against the `Attribute` object and stringifies it to `[object map]`, emitting broken markup like `<header[object map]>` that breaks tag nesting. Filter the array *inside* the call.
  - ❌ `{{ attributes.addClass(['a', cond ? 'b'])|filter(c => c) }}` → `[object map]`
  - ✅ `{{ attributes.addClass(['a', cond ? 'b']|filter(c => c)) }}`
- **One `.twig` file per component**. Variants inline with `{% if variant == '…' %}` blocks. Never `<name>--<variant>.twig` — the SDC addon imports every `.twig` in the directory and partials collide.
- **Slot rendering conditional**: `{% if slot %}{{ slot }}{% endif %}`. No wrapper unless the surrounding markup requires it.
- **Layout components** (`container`, `section`, `grid`) wrap each slot in `{% block <slot> %}…{% endblock %}` for `{% embed %}` compatibility. Non-layout components do not.
- **No hardcoded colors** — use CSS custom properties from design tokens or utility classes derived from them.
- **CSS framework routing**: read `@designbook-css-$DESIGNBOOK_FRAMEWORK_CSS/SKILL.md` for class names. It is the single source of truth — do not invent class naming.
- **Slots over inline markup**: when markup contains other components or interactive elements (buttons, links, icons), use slots — never inline component markup that could be a slot.

## .story.yml

- **One file per variant**: `<name>.<variant>.story.yml`. Default story is `<name>.default.story.yml`. The name segment is mandatory — never `<name>.story.yml`.
- **Flat format** — top-level keys are `component`, `name`, `props`, `slots`. Select a declared variant through the story file's own selection channel (its filename/story identity), never by placing `variant` under `props`. See [variant-transport.md](../../../designbook/design/rules/variant-transport.md) for the full render-path matrix. No `stories:` wrapper.
- **One story per file** — never combine multiple stories using `---` YAML document separators.
- **Story node `type:`** ∈ `element`, `component`, `image`.
- **Placeholder images** use service URLs (`https://placehold.co/600x400`). Local file paths are not served by Storybook.
- **Component refs include provider prefix**: `<namespace>:<name>`. The provider maps to a Twig namespace configured in `.storybook/main.js` → `sdcStorybookOptions.namespaces`. Without it, the SDC addon cannot resolve the component path.
- **Visually distinct states** — every story file must show a meaningful visual difference. Stories that look identical (differ only in invisible props) are not allowed.

````

### ctx:match-reference-entity (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/skills/sample-data/rules/match-reference-entity.md)
```
---
trigger:
  domain: sample-data
---

# Generate Sample Data From the Published Reference Record

When a component/entity story is compared with a captured record, its sample
must carry that record's observed field values. Otherwise the comparison measures
content drift as well as appearance drift.

Use the record identity, rendered values and assets from the bound published
revision. Apply the [reference intake](../../../design/rules/reference-prerequisite.md)
when the identity or required observations are missing. Source record inspection
and rendered-DOM capture belong to that separate reference preparation.

Convert the captured values into the project's sample-data shape for the selected
`{ entity_type, bundle }`, retaining fields that its mapping renders. Resolve
embedded/inline images into the project's inline-image sample shape using the
captured asset and metadata. Preserve observed empty values; an empty title does
not invalidate the selected record.

Where stored values and rendered observations differ because of formatting or
display transforms, match the rendered observations in the bound revision.
Completion: the sample's identity, visible values and image metadata match that
revision; later source changes require a new reference revision.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| MATCH-REF-01 | error | Sample values match the bound revision's rendered observations for the selected record | sample-data record |
| MATCH-REF-02 | warning | Observed empty identifying fields are preserved for the selected record | sample-data record |
| MATCH-REF-03 | warning | Embedded/inline images use the project's inline-image sample shape and captured metadata | sample-data record |

```

### ctx:component-tree (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/skills/sample-data/rules/component-tree.md)
```
---
trigger:
  domain: sample-data
---

# Rule: Component-Tree Sample Fields

A data-model field of type `component_tree` carries its bundle's composition. The field type alone selects this contract; the field name, entity type and view-mode template play no part. A bundle declares at most one such field.

Every planned record carries that field under its machine name as a `ComponentNode[]`; an empty array is valid. At every depth of the tree:

- each array member is a component node (`component`, optional `props`, optional `slots`); entity, scene and image nodes belong to scenes;
- each slot value is a text string or a `ComponentNode[]`;
- each `component` id is a planned component write or a frozen baseline contract, and each prop exists on that contract.

`plan build` validates every record, including records no scene selects, and `plan tree` shows each record's tree under its entity.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| CT-01 | error | Each planned record carries the bundle's single `component_tree` field as a `ComponentNode[]` | records.values |
| CT-02 | error | Every `component` id in the tree is a planned write or a frozen baseline contract, and every prop exists on that contract | records.values |
| CT-03 | error | Every slot value is a string or a `ComponentNode[]`, and every array member at any depth is a component node | records.values |

```

### ctx:story-image-node-renderer (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/story-image-node-renderer.md)
```
---
trigger:
  steps: [write-component, create-sample-data]
  domain: [components, sample-data]
  paths: ['$DESIGNBOOK_HOME/components/**/*.story.yml']
---

# Component Stories Need Their Own ImageNode Renderer

A designbook ImageNode (`{ image: <style>, src, alt }`) is turned into rendered
image markup by the entity-mapping pipeline's image builder. That builder runs
only for the **entity/record-driven stories** generated from a mapping plus
sample data — not for a component's own **standalone/docs story** (a plain
`*.story.yml` slot value written by hand or by the component-authoring stage).

A bare ImageNode placed directly in a component story's slot therefore falls
through every built-in story-node renderer (component reference, element,
markup, plain image-by-URL) and gets serialized as an opaque object — the
component story shows the raw object literal where the image should be, instead
of an `<img>`.

## The fix — register a custom story-node renderer once

Register one additional story-node renderer, globally, in the Storybook
configuration used by the SDC/component-story addon. Match any value shaped like
a designbook ImageNode (has an `image` key, is not itself a component/element
node) and render a plain `<img>` from its `src`/`alt`, falling back to the
project's shared placeholder image when `src` is absent. This also needs to fire
for an ImageNode nested inside another component's slot (e.g. a wrapper
component that composes an image with surrounding chrome).

Notes:

- The renderer's output must be a string the addon can embed directly into the
  generated story markup (e.g. return a JSON-stringified HTML string, mirroring
  how the addon's other built-in node renderers return their markup).
- This is a one-time addon-configuration change — it covers every component's
  image slots. Do not work around the broken rendering by editing each story
  file individually.
- The entity/record-driven story remains the authoritative visual surface (it
  runs the real image-rendering pipeline); the component story's `<img>` is a
  lightweight preview stand-in.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| SIMG-01 | error | No component/docs story renders a raw serialized object where an image slot should be | rendered component story |
| SIMG-02 | warning | A custom story-node renderer for the designbook ImageNode shape is registered in the Storybook/addon configuration | Storybook config |

```

### ctx:local-image-assets (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/local-image-assets.md)
```
---
trigger:
  steps: [write-component, map-entity, create-sample-data]
  domain: [components, data-mapping, sample-data]
---

# Story and Sample Images Are Local, Committed Assets

A component story or sample-data record renders in a headless preview (Storybook)
with no access to a live backend. An image `src` pointing at a production/staging
URL, a CDN, or a backend-internal file path (e.g. a Drupal `public://` or
`/sites/default/files/…` style path) 404s there, depends on an external host being
reachable, and does not reflect how the real backend actually renders the field.

## The rule

1. **Render path stays the same as production.** A story or sample record still
   emits an ImageNode/EntityNode through the project's normal image-rendering path
   (see the backend integration's own image-field rule). Only the `src` value
   changes for preview purposes — never hardcode an `<img>` tag to work around a
   broken image path.

2. **`src` in a story or sample record is a LOCAL, committed asset.** Download the
   real reference image once into the project's static asset directory (the
   directory the preview server serves at its root), and reference it with a
   root-relative local path. Never an absolute/external URL, never a
   backend-internal storage path, never an invented filename that does not exist
   on disk.

3. **When no real content asset exists yet**, use the project's shared placeholder
   image mechanism instead of inventing a new per-file external URL (a public
   placeholder-image service, a random CDN link, etc.). A project typically already
   has an image-provider fallback for this case — reach for it before adding a new
   external dependency.

## Responsive support with a single downloaded original

- A single downloaded original still supports per-breakpoint aspect-ratio
  responsiveness when the image-rendering path derives it from style/breakpoint
  configuration rather than from the file itself.
- Multi-resolution `srcset` generally requires multiple source files. If a case
  genuinely needs it, download several sizes into the asset directory and build the
  `srcset` explicitly — this is an opt-in extension, not the default expectation for
  every image.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| LIMG-01 | error | No image `src` in any story/sample-data file is an absolute/external URL, a CDN link, or a backend-internal storage path | story files, sample-data files |
| LIMG-02 | error | Every image still renders through the project's normal image-rendering node (ImageNode/EntityNode) — no hardcoded `<img>` added to work around a broken path | component markup + mapping |
| LIMG-03 | warning | Story/sample `src` values point at a committed local asset that exists on disk under the preview server's static root | static asset directory |
| LIMG-04 | warning | A missing real content asset uses the project's shared placeholder mechanism rather than a newly invented external URL | story files, sample-data files |

```

### ctx:entity-reference-rendering (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/entity-reference-rendering.md)
````
---
trigger:
  steps: [design-screen:intake, design-entity:intake, design-component:intake, design-shell:intake, create-sample-data, map-entity, write-scene]
---

# Entity Reference Rendering

Entity references render as entities in scene, mapping, and sample-data planning output.
They are not component props and they are not inline child data. Components may expose
slots that receive rendered child entities, but component generation does not resolve
entity references.

## Renderable Entity Closure

When a workflow produces `entity_mappings` and `sample_data_bundles`, those results MUST
contain the full renderable entity closure:

- Start with every entity the workflow explicitly renders.
- Recursively traverse each rendered bundle's `type: reference` fields whose target exists
  under `data_model.content`.
- Add every reached bundle to `entity_mappings` with the view mode used for that render.
- Add every reached `{ entity_type, bundle }` pair to `sample_data_bundles`.
- Order referenced child bundles before parents.

A field whose own data-model `type` is `image` may emit an ImageNode directly. A field
whose data-model `type` is `reference` is never that image shortcut, even when it targets a
media bundle.

If any task reaches a renderable `type: reference` target that is missing from
`entity_mappings` or `sample_data_bundles`, stop and repair the planning result before
generating files. Do not compensate by inlining the child record data into the parent.

## Sample Data Output

Sample data for a `type: reference` field stores references to target records, not embedded
target records. For content entities, the field value is the target record id (or an array
of target record ids for multi-value fields). The referenced bundle's own data file contains
the target fields.

```yaml
field_items:
  - "1"
  - "2"
```

```yaml
# Wrong: referenced child records are embedded in the parent record.
field_items:
  - field_title: "Child title"
```

## Mapping Output

JSONata mapping output MUST place rendered entity references in slots or as top-level
items. A mapping MUST NOT read fields from a referenced record through the parent record
and MUST NOT pass referenced entities through `props`.

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:parent",
  "slots": {
    "items": [
      { "entity": "paragraph.item", "view_mode": "full", "record": 0 }
    ]
  }
}
```

The referenced entity's own mapping is responsible for its fields and component choice.
Use the parent reference field value only to select the target record index/id for the
EntityNode.

````

### ctx:link-2 (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/sample-data/rules/link.md)
````
---
trigger:
  steps: [create-sample-data]
filter:
  backend: drupal
---

# Sample Template: link

Applies when a when `field_type` matching is active for `link`.

## Output Structure

Generate structured link data. Do not generate HTML anchor strings; entity mappings and
components need machine-readable labels and URLs to choose the reference-visible treatment.

```yaml
field_cta:
  title: "Learn More"
  url: "https://example.com/page"
```

Multi-value link fields are arrays of the same object shape:

```yaml
field_links:
  - title: "Learn More"
    url: "https://example.com/page"
```

````

### ctx:image (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/sample-data/rules/image.md)
````
---
trigger:
  domain: sample-data
filter:
  backend: drupal
---

# Sample Template: image

Applies when a field has `sample_template.template: image`, or when `field_type` matching is active for `image`.

## Output Structure

Generate an object with `alt` (required) and optionally `src`. **Do NOT generate `<img>` HTML tags** — image rendering is handled by the image style system at display time.

```yaml
field_hero_image:
  alt: "Aerial view of modern glass office building"
```

If the user has placed custom images in the project, reference them via `src`:

```yaml
field_hero_image:
  alt: "Company headquarters"
  src: "/images/headquarters.jpg"
```

When no `src` is provided, the image provider (configured in `designbook.config.yml`) generates placeholder images automatically at render time.

## Settings

| Key    | Default | Description                                                                          |
|--------|---------|--------------------------------------------------------------------------------------|
| `hint` | —       | Context for the image subject (e.g. `"hero"`, `"product thumbnail"`, `"avatar"`). Used to generate descriptive alt text. |

## Rules

- Output an object with `alt` key — never an `<img>` tag or HTML string.
- Alt text must be descriptive and derived from the `hint` or field name context.
- Each record in the same bundle should have **different, varied alt text** to show content variety.
- Never use `public://` paths, invented filenames, or placeholder service URLs in `data.yml` image fields.
- The `src` field is optional — omit it to let the image provider generate placeholders.

````

### ctx:formatted-text (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/sample-data/rules/formatted-text.md)
````
---
trigger:
  steps: [create-sample-data]
filter:
  backend: drupal
---

# Sample Template: formatted-text

Applies when `field_type` matching is active for `formatted_text` / `text_with_summary` / `text_long`.

## Output Structure

Generate simple markup:

```yaml
body: "<p>First paragraph content.</p><p>Second paragraph with <strong>emphasis</strong>.</p>"
```



````

### ctx:sample-records (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/skills/sample-data/blueprints/sample-records.md)
```
---
type: blueprint
name: sample-records
trigger:
  steps: [create-sample-data]
---

# Sample Records

For a new pool, use these starting counts when intake has no more specific needs: six for a non-full listing/teaser/card mode, three for full layout-builder/canvas, and one for other full modes or config entities. Intake fixes the actual records and counts from the scene's selectors; a sufficient existing pool takes precedence.

Choose field values from the model's explicit sample template and settings, then the matching field-type guidance, then realistic scalar text. For reference serialization, follow the [sample format](../resources/format.md).

When a field bound to a slot displays differently from its raw value in the design (a formatted number, date, price or relative time), write the raw `<field>` value and its display string as a [formatted companion](../resources/format.md#formatted-companions).

```

### ctx:scenes-constraints (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/scenes-constraints.md)
````
---
trigger:
  steps: [create-scene-file, write-scene, map-entity]
  paths: ['$DESIGNBOOK_DATA/**/*.scenes.yml']
---

# Scenes Critical Constraints

Intake fixes the component identities used by scene and mapping outputs (`namespace` + `group` + `component` + `variant`) and the CSF story ids **derived** from them. If this run writes components, the saved graph includes `refresh-components` after those writes and before dependent scene or mapping work. Every dependent task consumes that predecessor’s refreshed `index` result through an explicit input. A refresh supplies artifact data for those declared (derived) IDs only; newly discovered scope blocks the run. Every prerequisite is an explicit task, never a runtime preflight added by this rule.

> Full `*.scenes.yml` format and `SceneNode` types: see [scenes/schemas.yml](../../scenes/schemas.yml).

> ⛔ **`component:` values MUST always use `provider:component` format.**
> Resolve the provider from the saved configuration before submission.
> Use the concrete literal (e.g. `test_integration_drupal:header`), never just
> `header` or an environment placeholder. `done` does not substitute variables.

```yaml
# ✅ Correct — provider prefix on every component, including nested slots
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:card"
  slots:
    media:
      - component: "$DESIGNBOOK_COMPONENT_NAMESPACE:image"
        props:
          src: https://placehold.co/400x300

# ❌ Wrong — missing provider prefix
- component: card
  slots:
    media:
      - component: image
```

> ⛔ **No `type: element` in scenes.** Use plain strings/markup for text content. `type: element` is only valid in `*.story.yml` files.

Slots accept three value types:
1. **Component references** — objects with a `component` property
2. **Plain strings / markup** — rendered as raw HTML/text content, **only as the direct scalar slot value**. ⛔ A string placed as an *array element* is passed to the component renderer (which expects a component node) and silently becomes `null` — the text just disappears. Put text in a scalar slot value, or wrap it in a component/element node when it must sit in an array alongside components.
3. **`$content` / `$variable`** — special placeholder variables

```yaml
# ✅ Correct — plain string in slot
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:heading"
  slots:
    text: "Welcome to the Blog"

# ❌ Wrong — string as an ARRAY element silently renders as null
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:header"
  slots:
    logo:
      - "Designbook"        # disappears — array items go through the component renderer

# ✅ Correct — text as a scalar slot value, components in the array
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:nav"
  slots:
    brand: "Home"           # scalar string renders
    items:
      - component: "$DESIGNBOOK_COMPONENT_NAMESPACE:link"
        props:
          href: "/about"

# ❌ Wrong — type: element is story-only
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:heading"
  slots:
    text:
      - type: element
        tag: span
        value: "Welcome to the Blog"
```

> ⛔ **Rendered content belongs in slots — never props.** Markup strings, component
> reference nodes, and entity reference nodes (`{ entity, view_mode, record }`) MUST be
> slot values. `props` carry scalar data only (strings, numbers, booleans, plain data
> objects/arrays) — never markup, never component/entity nodes. The renderer resolves
> component and entity references only inside `slots` (and at the top level of a scene /
> mapping); a reference placed in `props` is passed through verbatim and never resolved,
> so the component receives `{ entity, … }` objects instead of rendered content and
> renders empty. This applies identically to `*.scenes.yml` and to `map-entity` `.jsonata`
> output — a mapping output is a scene node tree.

```yaml
# ✅ Correct — entity ref in a slot → resolved into the parent's rendered output
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:signage"
  props: { overlapping: true }
  slots:
    items:
      - { entity: "paragraph.signage_item", view_mode: "full", record: 0 }

# ❌ Wrong — entity ref in a prop → never resolved, renders empty
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:signage"
  props:
    items:
      - { entity: "paragraph.signage_item", view_mode: "full", record: 0 }
```

> ⛔ **Select a component variant via `props.variant` only.** The renderer passes
> only a node's `props` to the component — a top-level `variant:` key on a scene/story
> node is silently ignored and the component renders its default. Put the variant id
> under `props`.

```yaml
# ✅ Correct — variant chosen via props
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:button"
  props:
    variant: primary

# ❌ Wrong — top-level variant is ignored, renders default
- component: "$DESIGNBOOK_COMPONENT_NAMESPACE:button"
  variant: primary
```

> ⛔ **Shell scenes: inline all slots.** Header and footer MUST inline ALL sub-component slots — never use `story: default` alone.

## Slot HTML: Inline Styles Only

> ⛔ **Slot HTML in scene files MUST use inline `style=""` attributes — never CSS framework utility classes.**

Scene YAML files are not included in CSS build tool source paths. Utility classes written in slot HTML will not be compiled and will have no effect at runtime.

```yaml
# ✅ Correct — inline styles always work
slots:
  logo: '<img src="/logo.png" alt="Logo" style="height:47px;width:auto;">'

# ❌ Wrong — utility classes are not compiled from scene YAML
slots:
  logo: '<img src="/logo.png" alt="Logo" class="h-12 w-auto">'
```

This applies to all markup strings in slot values. Props never carry markup (see the
rendered-content rule above). Component templates can use utility classes freely since
they are in configured source paths.


````

### ctx:referenced-content-view-mode (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/referenced-content-view-mode.md)
```
---
trigger:
  steps: [write-component, map-entity]
  domain: [components, data-mapping]
---

# Referenced Content Renders ONLY via Its Own View Mode

Reinforces [entity-reference-rendering.md](entity-reference-rendering.md): a parent
must never reach through an entity/record reference and render the child's fields
(title, image, link, text) inside its own or a bespoke item markup. Every resolved
reference is rendered by the **referenced bundle's own view mode**, and the parent
only supplies the **slot** where that rendered output lands.

## The rule

1. **Emit one referenced-entity render node per item**, placed into a parent slot.
   The mapping/rendering engine resolves the referenced bundle's own
   entity-mapping/view-mode and self-renders the child; the parent's own mapping
   never reads the child's field values.

2. **No bespoke per-item component exists solely to render a referenced child's
   fields.** A component whose entire purpose is repeating a referenced child's
   title/image/link inside a parent-owned wrapper is the anti-pattern this rule
   removes. That markup belongs to the **referenced bundle's own view-mode
   component + mapping**, not a sibling component the parent inlines.

3. **Different markup for the same reference → a dedicated view mode, still
   entity-rendered.** When a reference needs to render differently from an
   existing view mode, do not hand-roll the alternate markup in the parent.
   Add the new view-mode display and its own entity-mapping to the appropriate
   component, and reference it by name. The parent still only renders the slot.

4. **Reuse an existing shared view-mode component** for any reference that already
   has a suitable rendering; introduce a new view-mode component only when the
   markup is genuinely distinct from what already exists.

5. **This applies to any referenceable child**, not just top-level content
   entities — a referenced sub-record (paragraph, block, fragment) is rendered the
   same way: through its own bundle's view-mode render node, with the parent
   (tab strip, grid, carousel chrome) supplying only the slot.

6. **Sample data for a referenced-entity render node lives in that bundle's own
   sample-data record**, keyed for lookup by the rendering engine — never inlined
   into the parent's sample-data record as embedded child field values.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| RVM-01 | error | A multi-value entity/record reference renders each child as its own render node in a slot — the parent does not render child fields itself | parent mapping + markup |
| RVM-02 | error | No bespoke component exists solely to render a referenced child's fields; that markup lives in the referenced bundle's own view-mode component | components |
| RVM-03 | error | Distinct reference markup has its own dedicated view mode + entity-mapping; it is not hand-rolled in the parent | view-mode config + entity-mapping |
| RVM-04 | warning | A reference that already has a suitable shared view-mode component reuses it instead of introducing a new one | mapping |
| RVM-05 | warning | Referenced-entity sample data lives in that bundle's own sample-data record, not inlined in the parent's record | sample-data |

```

### ctx:presenter-composition (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/presenter-composition.md)
```
---
trigger:
  steps: [map-entity, write-scene]
  domain: [data-mapping, components, scenes]
---

# Presenter Composition

A presenter — an entity-mapping, form-mapping, or scene/mapping node — owns the *decisions*
around a render: which entity/record feeds it, whether and how many times a component
appears, and which slot or variant it lands in. It never owns the *visible* result of those
decisions. Anything a viewer can see — a run of markup, a layout structure, a repeated
visual pattern — is a component's output, addressed by the presenter, not authored inside it.

## What a presenter owns

- **Data flow** — reading fields off the mapped entity/record and routing values into a
  component's `props`.
- **Conditions** — branching on field values or entity state to pick a component, a variant,
  or a slot.
- **Loops** — iterating a multi-value field or referenced collection into repeated slot
  items (see [entity-reference-rendering.md](entity-reference-rendering.md) for how
  referenced entities are resolved and placed).
- **Render metadata** — view-mode/form-mode selection, `EntityNode`/record references, and
  other bookkeeping the renderer consumes, never visual output itself.
- **Slots** — routing rendered entities/components into a parent component's declared
  slots.
- **Variant selection** — choosing among a target component's declared `variants:` via
  `props.variant`, per [variant-transport.md](variant-transport.md).

## What a presenter must not own

New visible, reusable markup. If a render needs something the viewer sees that no existing
component already produces, that something is a component — the presenter only decides
*whether* and *with what data* it appears. A presenter that inlines markup to avoid
creating or extending a component has taken over a component's job; the visual result then
exists nowhere a component boundary can validate, vary, or reuse it.

## Component inventory check is mandatory before new markup

Before a presenter/mapping introduces anything a viewer would see that is not already the
addressing of an existing component (a prop, a slot assignment, a variant choice), check
the current component inventory (the built/refreshed Storybook index) for a component that
already satisfies the need. Record the outcome of that check — which existing component
was reused, or why none satisfied the need and a new/extended component was required —
alongside the change (e.g. in the task's completion notes or the change's commit/PR
description). Skipping the check, or introducing new markup without recording the
decision, is not a shortcut — it is exactly the failure this rule exists to catch.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| COMPOSE-01 | error | An entity-mapping/form-mapping/scene-mapping node does not emit visible markup (raw HTML/text structure) itself — every visual result is addressed through a `component` reference, its `props`, and its `slots` | body |
| COMPOSE-02 | error | A presenter/mapping expresses data flow, conditions, loops, render metadata, slot routing, and variant selection only — not new component-equivalent presentation structure | body |
| COMPOSE-03 | warning | Before new visible markup is introduced, the component inventory was checked and the reuse decision (reused vs. new/extended component, and why) is recorded alongside the change | change record |

```

### ctx:inline-image (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/rules/inline-image.md)
````
---
trigger:
  domain: data-mapping
filter:
  backend: drupal
---

# Inline Image Policy for Pulled-Up Media References

Some paragraph/content bundles render an image field **inline** in the source
design (the image is visually part of the parent's own layout, not a
self-contained rendered child entity). For that case, render the referenced
media's image **inline on the parent via an image-style ImageNode** — not as a
self-rendering `media.image` child EntityNode, and not as a hardcoded `<img src>`
in the markup.

This relaxes the project's `image-fields` invariant #3 (a `type: reference` media
field normally emits an EntityNode that self-renders). For the inline case the
referenced media's image is pulled up and emitted as an **ImageNode in a slot of
the parent**, exactly as invariant #2 (`type: image` → ImageNode via image style)
already prescribes. The image still renders through the configured image style
(correct derivative, aspect ratio, responsive breakpoints) via the image-style
builder — never a raw original-file `<img>`.

Direct `type: image` field-map bindings follow [image-fields.md](image-fields.md).
A media `type: reference` slot uses the EntityNode mapping when `entity` is
specified; pulling a nested media image into its parent's slot is outside that
binding contract. Scene `items` may also include ImageNodes.

## The rule

1. **Define an image-style bundle** for the image under `config.image_style` in
   `data-model.yml` (see the `image-style-config` rule). Derive its aspect ratio
   (and optional breakpoints) from the actual rendered size of the image in the
   design reference, not a guess.

2. **Emit an ImageNode in a slot** of the parent component (images are always
   slots, never props):

   ```jsonata
   "slots": {
     "image": [
       {
         "image": "<style_name>",           /* config.image_style bundle */
         "src":   <resolved image url>,      /* real content image */
         "alt":   <field>.alt
       }
     ]
   }
   ```

   Resolve `src` from the referenced media's actual image field. `src` carries
   the real image; `image: <style_name>` applies the configured style/aspect
   ratio at render time. Omit `src` only for a genuine placeholder.

3. **The parent's Twig renders the slot** (e.g. `{{ image }}`) — the image-style
   builder places the rendered image markup there. Do not hardcode an `<img>` tag
   with a field URL in the Twig.

4. **Keep the self-rendering EntityNode pattern for true stock media** — when the
   media is a genuinely independent, reusable rendered entity (its own view mode,
   shared across contexts rather than visually fused into one parent's layout),
   keep the standard EntityNode-in-slot pattern instead of pulling the image up.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| INLINE-IMG-01 | warning | An inline-in-layout image is emitted as an ImageNode (`{ image: <style>, src, alt }`) in a parent slot — not a `media.image` child EntityNode, not a raw `<img>` in Twig | entity-mapping jsonata + component twig |
| INLINE-IMG-02 | error | `image` names an image-style bundle defined under `config.image_style` in data-model.yml — no image without an image style | data-model.yml + jsonata |
| INLINE-IMG-03 | warning | `src` resolves from the referenced media's actual image field; `aspect_ratio` matches the image's actual rendered size in the design reference | jsonata + data-model.yml |

````

### ctx:image-fields (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/rules/image-fields.md)
````
---
trigger:
  domain: data-mapping
  paths: ['$DESIGNBOOK_DATA/*/*.jsonata']
filter:
  backend: drupal
---

# Rule: Image Field Mapping

Hard constraints for mapping image and reference fields in entity-mapping JSONata expressions.

For a field-map image binding, declare `field` and `slot`. The planner reads the
image style from the field's `settings.image_style` and validates it against
`config.image_style`. The compiled mapping emits ImageNodes carrying each sample
image's `src` and `alt`; absent images yield an empty slot. Bind the whole image
field, without `path` or an `entity` descriptor. Submit the `expected_mapping`
returned by `plan instructions`.

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
{ "image": "<style_name>", "src": <field>.src, "alt": <field>.alt }
```

The `<style_name>` MUST reference a bundle defined under `config.image_style` in `data-model.yml`. No image without an image style. Image styles are produced by the `data-model` workflow (`image-style-config`).

### 3. `type: reference` fields emit EntityNode

When the data-model field type is `reference`, the JSONata mapping emits an EntityNode. The referenced entity renders itself — the mapping does not access the referenced entity's data.

```jsonata
{ "entity": "<entity_type>.<bundle>", "view_mode": "<view_mode>", "record": <index> }
```

This applies to ALL reference types — media, paragraph, node, taxonomy_term, etc. What the referenced entity produces (ImageNode, ComponentNode, etc.) is that entity's own mapping concern.

````

### ctx:formatted-companion (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/rules/formatted-companion.md)
```
---
trigger:
  domain: data-mapping
filter:
  backend: drupal
---

# Rule: Formatted Companion

`<field>_formatted` is a sample-data display companion of the declared `<field>`, never a Drupal
field. Drupal produces that display itself: `<field>` in a slot renders through its field
formatter.

## Constraints

- The export holds no `field.storage.*`, no `field.field.*`, no placement and no content value
  named after `<field>_formatted`.

```

### ctx:field-cardinality (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/rules/field-cardinality.md)
````
---
trigger:
  domain: data-mapping
  paths: ['$DESIGNBOOK_DATA/*/*.jsonata']
filter:
  backend: drupal
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

### ctx:views (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/views.md)
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
  frameworks.component: sdc
---

# Blueprint: View Mapping — Build-Form Decision

Applies when `map-entity` runs for a View (`entity_type: view` — a `config.view` bundle). The same
blueprint also binds the view's Drupal config at `sync-to:transform` through its
`trigger.config_name: 'views.view.*'` — the config-name binding `form-display` and
`layout-builder-display` use — so a view binds like the other displays, not by prose alone.

## The view's build form decides its composition

A view's `build_form` (the same backend-neutral `template` axis every other surface uses, sourced
from `entity_mapping.templates`) splits into two branches. Resolve the branch first — it decides
whether a view-presenter exists at all.

### Branch: Display Builder

When the view's page build form is a Display Builder form, the view binds **directly** through
the Display Builder page config — the same mechanism a Canvas or Layout-Builder page uses for its
own build form. The concrete config owner is the page's own config entity (the `page_layout`-style
config the Display Builder build form emits), carrying the view binding inline or by reference.

**No view-presenter exists in this branch.** The view wrapper, its rows, its pager, and its
exposed filter are all expressed through that one config owner — there is no separate Twig
wrapper to author.

### Branch: without Display Builder

Without a Display Builder build form, the view wrapper **is** a presenter-template: theme methods
are the only way to produce the wrapper markup, so `sync-to` generates a presenter-template
(Twig) for it. That presenter-template **composes** the view component — it does not reimplement
the view — and passes each of the following through as rendered slots, each supplied by its own
binding rather than reconstructed in the wrapper:

- **rows** — the enumerated row output (see "Row rendering" below);
- **empty-state** — the view's no-results presentation;
- **exposed form** — the exposed-filter form markup;
- **pager** — the pager markup.

The presenter-template's only job is composition — routing each already-rendered region into its
slot. It never rebuilds a region's markup itself.

## Row rendering is its own declarative contract

In both branches, row rendering binds through **UI Patterns**: the view's style/row plugin carries
the shared `{component_id, variant_id, props, slots}` block, so each row is an SDC component
render, not a raw view field. This is the declarative half and it stays identical across both
branches — a view template names it once, on the row/style plugin, and neither branch's wrapper
(presenter-template or Display Builder config) reconstructs a row component from field output.

The row component is the one the row bundle's view mode maps to (its `field-map`); the view's own
`config.view.<id>` `view_modes` `template` is its build form and decides only the wrapper branch.

## Container ownership

Exactly one owner sits beneath the view entity — the Display Builder config owner in that branch,
or the presenter-template wrapper in the other. A Scene that renders a view as its main content
carries the view entity **unwrapped**: the Scene node names the view; it does not itself introduce
a second container around it. Whichever branch applies supplies the one container the rendered
view lives in.

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

## Optional wrapper (summary)

When a `view-summary` wrapper component exists, wrap the same enumerated array in the
wrapper's `rows` slot — still self-contained (rows are enumerated, never read from `$`):

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:view-summary",
  "slots": {
    "rows": [
      { "type": "entity", "entity_type": "<row_entity_type>", "bundle": "<row_bundle>", "view_mode": "<row_view_mode>", "record": 0 },
      { "type": "entity", "entity_type": "<row_entity_type>", "bundle": "<row_bundle>", "view_mode": "<row_view_mode>", "record": 1 }
    ]
  }
}
```

The pager region itself binds through its own dedicated binding, not through this wrapper slot.

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
content — base table, row bundle/view-mode, filters, sort, and the build-form template.

Bind the view's **row output to its SDC component through the shared UI Patterns block** — the
`{component_id, variant_id, props, slots}` mechanism (see `ui-patterns.md`): the view's row/style
plugin carries that block, so a rendered list is a component render — the same UI-Patterns
manifestation a `field-map` display uses — not a raw view row. The row bundle's view mode
names the component the rows bind to.

This authors only the **UI-Patterns half** (the row style). Which unit emits the **wrapper** —
the Display Builder page config, or a generated presenter-template with pager and exposed filter
passed through as slots — follows the build-form branch above. A view is the combination of the
row-style config and its wrapper; neither half is a whole view on its own.

The concrete config keys come from `prepared`; treat the row-binding intent here as the starting
point, not a fixed key layout.

````

### ctx:ui-patterns (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/ui-patterns.md)
````
---
type: data-mapping
name: ui-patterns
priority: 5
trigger:
  domain: data-mapping
filter:
  backend: drupal
  frameworks.component: sdc
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

### ctx:presenter-template (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/presenter-template.md)
````
---
type: data-mapping
name: presenter-template
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
  frameworks.component: sdc
---

# Blueprint: Presenter-Template (Twig)

Starting point for the Twig theme template `sync-to` writes for a `template: presenter` surface —
a form or exposed filter whose presentation Drupal produces only through theme markup, not through
UI-Patterns display config. The display config still binds the surface to its SDC (authored by the
matching display-unit pattern); this blueprint is the theme-markup *how* that config points at. A
UI-Patterns-bindable surface (`template: field-map`) needs no presenter-template. A pager is its own
presenter surface — see `data-mapping/blueprints/pager.md`.

## Where the file lands

The presenter-template is a Twig file in the active theme's templates directory, generated
alongside the surface's display config (not in the config-sync directory). Follow the theme's
normal template layout — group by surface **type** under `templates/<type>/`, not under a
`presenter/` folder, and use Drupal's **base theme-hook** name for the surface — unified, not
per-entity: `templates/forms/form.html.twig` for a form, `templates/views/views-view.html.twig` for
a view template. Reach for the double-hyphen **suggestion**
(`form--<form-id>.html.twig`, `views-view--<view-id>.html.twig`) only as the **exception**, when one
specific form or view genuinely needs its own template diverging from the base. Never name a form or
view presenter after an entity/node display.

## Fields render through their formatter; chrome is the Twig's job

A presenter-template renders the theme-methods-only chrome — the form element ordering and markup,
the exposed-filter form — and lets each field render through its own formatter output.
Field-rendered content (rich text, body, a single `title` or `link`/CTA) is emitted as its
rendered field markup, the same content that a read display places in a slot; the Twig never
re-stringifies a raw storage value into an escaped scalar. Control and attribute values (a variant
key, an icon id, a link `url` fed to an attribute) may be read directly.

## Per-surface guidance

- **Edit form (`form_mode`).** Render the form's render array through the theme layer, ordering
  and grouping the widgets as the design reference shows. The form display config stays minimal
  (its binding identity); the arrangement lives in this Twig.
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

### ctx:pager-2 (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/pager.md)
```
---
type: data-mapping
name: pager
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
  frameworks.component: sdc
---

# Blueprint: Pager Mapping

Starting point for binding a view's pager region to its own Pager SDC component, independent of
the view's `build_form`. A view's wrapper may live behind a Display Builder page config or behind a
generated presenter-template — either way, the pager binds through this same dedicated binding, not
through the view wrapper's own markup.

## The Pager Is Its Own Presenter

The generic Drupal `pager` theme hook is the only way to produce pager markup — no UI-Patterns
display config renders a pager's page-link list. So the pager path is always: generic `pager`
theme hook → Pager presenter-template (the theme-markup composition, per
`presenter-template.md`) → Pager SDC component (`components/blueprints/pager.md`), passed typed
props and slots rather than reconstructed markup.

The presenter-template composes the Pager component; it never re-derives a page-link list from raw
variables itself. Each page-link, the previous/next controls, and the current-page indicator route
into the component's props/slots as already-resolved values.

## Configurations

A pager mapping distinguishes which configuration the theme hook is producing, since the values
available differ between them:

- **Standard pager** — a full page-link list (first, previous, page numbers with ellipses, next,
  last) plus the current page.
- **Mini pager** — previous/next controls only, no enumerated page-link list.
- **Infinite-scroll pager** — a "load more" / auto-load control that requests the next result batch
  instead of navigating to a numbered page. It uses its own Pager component instance through its own
  presenter — see "Infinite Scroll vs. a Hand-Placed Load-More Control" below.
- **No pager** — the result set fits on one page (or paging is disabled); the mapping omits the
  pager region entirely rather than rendering an empty or disabled pager.

Resolve the configuration from the view/pager plugin's own setting before mapping — do not guess
from a fixed default.

## Only Map Values the Theme Hook Actually Provides

The pager preprocess supplies, at most: a heading id, a current-page indicator, a set of page-link
items (each with its target and label) split into first/previous/pages/next/last groups, and
markers for whether ellipses precede or follow the enumerated page range. A mini pager reduces that
set to previous/next only.

**Never invent a total item count, a total page count, or a "page X of Y" string when the theme
hook does not supply one.** If the source data does not carry a total, the pager mapping renders
only from the values the hook exposes — first/previous/pages/next/last links and the current
indicator — and leaves any "of N" affordance out rather than computing or guessing it.

## Infinite Scroll vs. a Hand-Placed Load-More Control

An infinite-scroll pager is a real pager configuration — it renders through its own Pager component
instance, composed by its own presenter, exactly like the standard and mini configurations. It is
not a manually authored button dropped beside a numbered pager.

A design reference showing a "load more" control alongside a standard (numbered) pager on the same
region is a design-reference conflict, not two mapping targets: a region gets exactly one pager
configuration. Never map both a standard pager's page-link list and a separately hand-placed
load-more control into the same region.

```

### ctx:layout-builder (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/layout-builder.md)
````
---
type: data-mapping
name: layout-builder
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
---

# Blueprint: Layout Builder — Passthrough Mapping

Applies when `map-entity` runs for a view mode with `template: layout-builder` (i.e. a node bundle's full view mode that uses Layout Builder). The current plan-param contract is a single target component plus field bindings; a layout-builder section list cannot be expressed there, so `plan build` rejects that selected mapping with the target and unsupported structure.

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

The Scene still drives *which* bundles and views become config units (sync-to intake). The
section *composition* for a `layout-builder` template is not authored into the display YAML;
tests that need a reachable rendered page seed the override layout after import (fixture seed).
This is an overridable starting point — a project whose Layout-Builder export differs replaces it.

````

### ctx:form-display (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/form-display.md)
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

For a bundle's `form_modes`, the sync-to intake emits up to two config names per mode:

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

### ctx:field-map (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/field-map.md)
````
---
type: data-mapping
name: field-map
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
  frameworks.component: sdc
---

# Blueprint: Field Map

Applies when a view mode declares `template: field-map`. The plan names one target `component` and a `bindings` list. `plan instructions` for the map-entity step includes `expected_mapping`, the compiled JSONata `plan done` AST-compares against. A bundle with a `component_tree` field maps by passing that field through instead; a mapping whose view-mode template is layout-builder or another non-field-map structure without such a field is rejected at `plan build` with the selected target and unsupported structure.

## Pattern

One wrapping component. Props read field paths. Reference slots `$map` the field ids and `$lookup` each id in the inlined sample-pool index (stable record id → array index).

```jsonata
(
  $fields := $;
  [
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:teaser",
      "props": {
        "title": $fields.field_title,
        "text": $fields.field_teaser_text
      },
      "slots": {
        "items": $map($fields.field_items, function($id) {
          {
            "entity": "paragraph.item",
            "view_mode": "full",
            "record": $lookup({ "item-a": 0, "item-b": 1 }, $string($id))
          }
        })
      }
    }
  ]
)
```

The `$lookup` object is the referenced bundle's sample pool, keyed by record id in pool order.

## Image Field Mapping

Map a media entity reference (`type: reference`) into the image slot with `entity`, using the same `$map` / `$lookup` template as other reference slots. `plan instructions` `expected_mapping` is this compiled wrapper:

```jsonata
(
  $fields := $;
  [
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
      "props": {
        "title": $fields.field_title
      },
      "slots": {
        "image": $map($fields.field_image, function($id) {
          {
            "entity": "media.image",
            "view_mode": "teaser",
            "record": $lookup({ "img-1": 0, "img-2": 1 }, $string($id))
          }
        })
      }
    }
  ]
)
```

## Several Fields in One Slot

Several bindings may name the same slot; the slot then holds one array in binding order. A binding with `wrap` places its field inside a wrapper component with fixed props, in the wrapper prop or slot that `wrap` names:

```yaml
bindings:
  - { field: field_title, prop: title }
  - { field: field_tagline, slot: meta }
  - field: field_version
    slot: meta
    wrap: { component: "$DESIGNBOOK_COMPONENT_NAMESPACE:list_cell", props: { caption: Version }, prop: value }
```

compiles to

```jsonata
(
  $fields := $;
  [
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:teaser",
      "props": {
        "title": $fields.field_title
      },
      "slots": {
        "meta": [$fields.field_tagline, { "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:list_cell", "props": { "caption": "Version", "value": $fields.field_version } }]
      }
    }
  ]
)
```

A `wrap.props` value `{ field, path? }` reads that field of the mapped bundle instead of a literal. A nested `wrap` goes into the outer wrapper's `prop` or `slot`; the binding's field goes into the innermost wrapper:

```yaml
  - field: field_version
    slot: meta
    wrap:
      component: "$DESIGNBOOK_COMPONENT_NAMESPACE:list_cell"
      props: { caption: Version }
      slot: content
      wrap:
        component: "$DESIGNBOOK_COMPONENT_NAMESPACE:badge"
        props: { tone: { field: field_channel } }
        prop: label
```

compiles its `meta` item to

```jsonata
{ "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:list_cell", "props": { "caption": "Version" }, "slots": { "content": { "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:badge", "props": { "tone": $fields.field_channel, "label": $fields.field_version } } } }
```

## Rules

- Output is a JSONata array expression returning one wrapping `ComponentNode`
- Input (`$`) is the sample data record for this entity from `data.yml`
- Use `$fields.` plus dot notation for field access: `$fields.field_image.alt`
- Every bound value comes from a declared field path (`$fields.<field>`)
- Provider prefix must be resolved at generation time: `DESIGNBOOK_COMPONENT_NAMESPACE:component-name`
- Reference fields (`type: reference`) emit `{ "entity": "<entity_type>.<bundle>", "view_mode": "...", "record": $lookup({ "<id>": <index> }, $string($id)) }` nodes as slot values of the wrapping component. The renderer resolves refs inside slots and at top level.
- Image slots use that same reference-slot template; `plan instructions` `expected_mapping` is the expression to submit
- A slot with one binding keeps that binding's single value; a slot with several bindings is one array of their items in binding order, image and reference `$map` items unwrapped inside it
- A prop takes exactly one binding
- `wrap` sits on a slot binding only; image and reference fields go into the innermost `wrap.slot` and never into a field-valued `wrap.props` entry

## Supported Settings

- `primary_image_field` — name of the media reference field mapped to the component's image slot with the reference-slot template above.
- `formatters` — map `<field>: { type, settings }` in `view_modes.<vm>.settings`; overrides the formatter derived for `<field>` where it fills a slot in that view mode.

```yaml
view_modes:
  full:
    template: field-map
    settings:
      formatters:
        field_rating: { type: number_unformatted, settings: {} }
```

````

### ctx:canvas (blueprint, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook-drupal/data-mapping/blueprints/canvas.md)
````
---
type: data-mapping
name: canvas
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
---

# Blueprint: Canvas — Passthrough Mapping

Starting point for `map-entity` on a `canvas_page` bundle's full view mode (`template: canvas`). The page's composition is the sample tree in its `component_tree` field `components`, so the mapping passes that field through: no wrapping component, no field bindings, no entity references.

## JSONata Pattern

```jsonata
(
  $record := $;
  $record.components
)
```

## Example sample tree

The mapping above returns this tree unchanged, nested sections and all:

```yaml
components:
  - component: "$COMPONENT_NAMESPACE:section"
    props:
      max_width: "lg"
    slots:
      column_1:
        - component: "$COMPONENT_NAMESPACE:hero"
          slots:
            content:
              - component: "$COMPONENT_NAMESPACE:rich-snippet"
                props:
                  headline: "Welcome to our site"
```

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

### ctx:playwright-validate (rule, source: /var/www/html/web/themes/custom/bb_theme/node_modules/.pnpm/storybook-addon-designbook@0.18.0_playwright@1.61.1_react-dom@19.2.7_react@19.2.7__reac_656b9a2aaea1b8147d75228627a6cfec/node_modules/storybook-addon-designbook/dist/skills/designbook/design/rules/playwright-validate.md)
```
---
name: designbook:design:playwright-validate
trigger:
  steps: [validate]
---

# Playwright Validate (Execution)

Hard constraints for verifying that a Storybook story renders. Applies to every `validate` step.

## Prerequisites

Use the concrete `story_url`, viewport, selectors and observations fixed by intake. For components written in this run, intake declares a Storybook build/restart and index refresh before dependent verification. Their results confirm known IDs; they cannot select new stories or expand scope. A missing prerequisite blocks the saved run.

## Render check

Use the Playwright CLI session skeleton documented in [`cli-playwright.md`](../../resources/cli-playwright.md#validate-story-render) (open → goto → resize → wait → eval → close), then read:

- `#storybook-root` `textContent` and element children. `innerText` of a closed `<details>` omits CSS-shown descendants; `textContent` and child elements still count.
- Overlay wrappers `.sb-errordisplay` and `#preview-loader-error`. A wrapper whose computed `display` is other than `none` is a visible render error. `#error-message` lives inside that wrapper and stays `display: block` even when the wrapper is hidden.
- Font load state: for each text descendant of `#storybook-root`, take the first name in computed `font-family`. When that name is a non-generic family, `document.fonts.check('1em "<name>"')` is true. Generic first names (`serif`, `sans-serif`, `system-ui`, …) are the resolved stack for that node.

## Pass criteria

The stage only completes when ALL are true:

- `#storybook-root` has element children, or its `textContent` is non-empty.
- Overlay wrappers `.sb-errordisplay` and `#preview-loader-error` have computed `display: none`.
- The Storybook log for the current session has no unresolved compilation errors referencing the scene or its components.
- Every non-generic first `font-family` name on a text descendant of `#storybook-root` passes `document.fonts.check`.
- Every component the scene renders that has an `interactive[]` entry with a `behavior` is functional: run the `steps` of its first non-rest state against the rendered iframe and confirm the trigger's `aria` attribute flips, or the `target` changes visibility. A trigger that does nothing when exercised is a major issue — static markup with no behavior passes the render checks above but is not done.

## Failure protocol

Record the failed check and concrete cause in the execution
[problems sidecar](../../resources/workflow-execution.md) beside the plan, leave
the task pending, and continue with the next unfinished task. Retry only within
the saved task's declared checks and prerequisites before logging. Additional
artifact targets or requirements need a new intake and definition. Completion
of a single validate task still requires the declared semantic and interaction
observations as well as a nonempty, error-free render — a logged failure is not
a pass.

```

## Steps

### Step: refresh-components
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:component-contract-index, ctx:sdc-components]

- [x] refresh-components — row-components

  Instruction: task:refresh-components

  #### Params
  ```yaml
  command: npx storybook build --output-dir storybook-static
  cwd: /var/www/html/web/themes/custom/bb_theme
  index_url: http://localhost:6006/index.json
  story_ids:
    - bb-theme-data-display-list-item--default
    - bb-theme-data-display-list-cell--default
    - bb-theme-data-display-badge--default
    - bb-theme-data-display-person--default
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    index:
      required: true
      schema:
        $ref: '#/definitions/StorybookIndex'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

### Step: create-sample-data
Context: [ctx:cli-surface, ctx:match-reference-entity, ctx:component-tree, ctx:story-image-node-renderer, ctx:local-image-assets, ctx:entity-reference-rendering, ctx:link-2, ctx:image, ctx:formatted-text, ctx:sample-records]

- [x] create-sample-data — bb_ticket-rows

  Instruction: task:create-sample-data

  #### Params
  ```yaml
  section_id: tickets
  bundle:
    entity_type: bb_ticket
    bundle: bb_ticket
  data_model:
    content:
      bb_project:
        bb_project:
          title: bakers.build project
          purpose: 'The work unit: key, next_number, repository, environments. BB-462 D7 REVERSES what this field used to say: the project carries NO membership or role of its own any more — it is deregistered from og.settings entirely, and its three roles (non-member, member, lead) are deleted from both config paths. Visibility now comes from bb_project.teams (D4): a project is visible to the members of a team it names, or to a workspace admin. The two levels that grant rights are the workspace (create/edit/delete rights, via bb_workspace-bb_workspace-{contributor,lead}) and, per-project, its teams (visibility only — a team carries no rights of its own, BB-462 D3). A screen must not offer a permission control on the project.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            epics:
              template: field-map
              label: Epics
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            group_id:
              type: reference
              title: Group
              required: true
              multiple: false
              reference: bb_group
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under project-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            repository:
              type: object
              title: Repository
              description: 'The project repository (URL, default branch, branch naming convention). Single-valued: a project has at most one repository.'
              required: false
              multiple: false
              settings:
                properties:
                  url: string
                  default_branch: string
                  branch_convention: string
            coder_config:
              type: object
              title: Coder config
              required: false
              multiple: false
            env_vars:
              type: text
              title: Environment variables
              description: Project defaults supplied to hooks and the agent on every run, as .env-style KEY=value lines. A parent ticket and the ticket itself override a key set here. Readable by anyone who can view this project.
              required: false
              multiple: false
            teams:
              type: reference
              title: Teams
              description: 'The teams this project belongs to. A project belongs to AT LEAST ONE team, so the field is required and multi-valued. The assignment is STRUCTURE and confers no rights: it makes the team the project''s structural parent, and team membership is not a source of ticket visibility. Visibility stays at direct project membership or workspace see-all (BB-419, which deliberately left BbWorkspaceReadScope untouched).'
              required: true
              multiple: true
              reference: bb_team
            key:
              type: string
              title: Identifier prefix
              description: Ticket identifier prefix, e.g. BB in BB-328. A change applies only to tickets created afterwards.
              required: false
              multiple: false
            next_number:
              type: integer
              title: Next number
              description: Next per-project ticket number; floors to max(number)+1 on allocation.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            environments:
              type: reference
              title: Environments
              description: Managed environments belonging to this project.
              required: false
              multiple: true
              reference: bb_environment
              computed: true
              readonly: true
            open_tickets:
              type: integer
              title: Open tickets
              description: 'Computed, internal: the project''s tickets not yet closed. The listing row shows it as a ticket badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_tickets:
              type: integer
              title: Conductor tickets
              description: 'Computed, internal: the project''s tickets a conductor currently holds. The listing row shows it as a conductor badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            closed_tickets:
              type: integer
              title: Closed tickets
              description: 'Computed, internal: the project''s closed tickets. The listing row shows it as a check badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the project id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              description: Free text, not an enum (BB-227). Values in use include comment, qualification, spec, test and acceptance, so a screen must render an unknown value rather than assume a closed set.
              required: true
              multiple: false
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
        review:
          title: bakers.build review comment
          purpose: A private review of a ticket. Drafts stay with the assigned author; submitted reviews wait for the current assignee; accepted reviews publish into the ordinary comment timeline. Rejected reviews stay unpublished. The Boolean published flag is server-owned.
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              required: true
              multiple: false
            status:
              type: boolean
              title: Published
              required: false
              multiple: false
            review_state:
              type: string
              title: Review state
              required: false
              multiple: false
              settings:
                allowed_values:
                  draft: Draft
                  submitted: Submitted
                  accepted: Accepted
                  rejected: Rejected
            submitted_at:
              type: datetime
              title: Submitted at
              required: false
              multiple: false
            decided_at:
              type: datetime
              title: Decided at
              required: false
              multiple: false
            decided_by:
              type: reference
              title: Decided by
              required: false
              multiple: false
              reference: user
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_activity:
        bb_activity:
          title: bakers.build activity
          purpose: 'One persisted ticket event per row: `created` when a ticket is created, `status_changed` per state change (with the step''s summary comment, and with the run it closed and that run''s conductor when an agent did the work), `claimed` only for the first run outside qualification, and `run_ended` when a run ends failed, expired or cancelled without moving the ticket. Writes come only from the bb_activity kinds, called where the change happens. Each row is this bundle''s `full` view mode (`bb_theme:event` with a structured lead); there is no second activity view mode.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            kind:
              type: string
              title: Kind
              description: '`created`, `status_changed`, `claimed` or `run_ended`. Tags: created, status, started (claimed) and the run outcome for run_ended.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - created
                  - status_changed
                  - claimed
                  - run_ended
            actor:
              type: reference
              title: Actor
              required: false
              multiple: false
              reference: user
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
            previous_state:
              type: string
              title: Previous state
              required: false
              multiple: false
            new_state:
              type: string
              title: New state
              required: false
              multiple: false
            step:
              type: string
              title: Step
              description: The run's state_at_start for claimed and run_ended rows. Unused for created and status rows.
              required: false
              multiple: false
            run_id:
              type: reference
              title: Run
              required: false
              multiple: false
              reference: bb_run
              description: The run a claimed or run_ended row reports, or the run a status change closed. Empty for created rows and human status changes; its presence makes the row an agent row.
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
              description: The conductor of the referenced run.
            comment_id:
              type: reference
              title: Summary comment
              description: The ticket's summary comment published since the ticket entered the state a status row leaves. Empty when none.
              required: false
              multiple: false
              reference: bb_comment
            claim_key:
              type: string
              title: Claim key
              required: false
              multiple: false
              description: The claimed run's UUID; unique, guards a second claimed row for the same run. NULL on other kinds.
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: Computed from ticket_id.identifier so the event body can name the ticket without the mapping joining collections.
              required: false
              multiple: false
              computed: true
              readonly: true
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
              description: The run's model (else harness, else agent) on rows with a viewable run; otherwise the actor's display name.
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: Computed from conductor_id.label.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_harness:
              type: string
              title: Run harness
              description: Computed from run_id.harness; shown beside the model on agent rows.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_duration:
              type: string
              title: Run duration
              description: Computed from run_id duration_s (or started_at to the row time), formatted.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_outcome:
              type: string
              title: Run outcome
              description: 'Computed from run_id.state on run_ended rows: failed, expired or cancelled.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_error_line:
              type: string
              title: Run error line
              description: Computed first non-empty line of a failed run's error log.
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            changed: Activity rows are immutable; nothing writes a changed stamp.
      bb_conductor:
        bb_conductor:
          title: bakers.build conductor
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_user:
              template: field-map
              label: List item (user)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            machine_id:
              type: string
              title: Machine ID
              required: true
              multiple: false
            label:
              type: string
              title: Label
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            status:
              type: string
              title: Status
              required: false
              multiple: false
              settings:
                allowed_values:
                  online: Online
                  offline: Offline
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            states:
              type: string
              title: States
              description: The claimable ticket states this conductor picks up.
              required: false
              multiple: true
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
            workspace_root:
              type: string
              title: Workspace root
              required: false
              multiple: false
            active:
              type: boolean
              title: Active
              description: Whether the conductor may be assigned and claim work; separate from online/offline status.
              required: false
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              required: false
              multiple: false
            last_seen:
              type: datetime
              title: Last seen
              required: false
              multiple: false
            lease_expires_at:
              type: datetime
              title: Lease expires at
              required: false
              multiple: false
            conductor_name:
              type: string
              title: Conductor name
              description: The config-file stem `--conductor <name>` selects.
              required: false
              multiple: false
            last_pid:
              type: integer
              title: Last PID
              description: Reported by the serve loop that owns the process; used by a verified stop.
              required: false
              multiple: false
            node_status:
              type: string
              title: Node status
              description: running | stale | offline — the shared liveness vocabulary.
              required: false
              multiple: false
              computed: true
              readonly: true
            node_states_label:
              type: string
              title: Claimed states
              required: false
              multiple: false
              computed: true
              readonly: true
            node_load_label:
              type: string
              title: Load
              required: false
              multiple: false
              computed: true
              readonly: true
            last_seen_label:
              type: string
              title: Last seen
              required: false
              multiple: false
              computed: true
              readonly: true
            reported_load:
              type: integer
              title: Reported load
              description: The load the conductor reported on its last poll. The listing row shows it as a run badge.
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_label:
              type: string
              title: Owner
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the owner''s display name. Present so the row has a value for the Owner cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            project_label:
              type: string
              title: Project
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the project''s name. Present so the user listing''s row has a value for the Project cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_label:
              type: string
              title: Status label
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter labels the status from its allowed values. Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_tone:
              type: string
              title: Status tone
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter keys the tone on the status (online running, offline offline). Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_machine:
        bb_machine:
          title: bakers.build machine
          purpose: 'Host capacity for concurrent runs, owned by one user account. Capacity (max_parallel / current_load) belongs to the machine, not to each per-project conductor; a conductor links its machine. host_key is the machine-context stem, not the composed conductor registration key. Machines are not in the workspace read scope: the owner sees them under the account Machines listing, and the full view is the machine page /user/{user}/machine/{bb_machine}.'
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            host_key:
              type: string
              title: Host key
              description: Machine-context machine_id stem, unique per machine.
              required: true
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              description: Concurrent runs this machine accepts; default 5.
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              description: Runs currently claimed on this machine; default 0.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
              settings:
                target_type: user
            owner_label:
              type: string
              title: Owner label
              description: Display name of the owner, read through owner_user_id; the machine page shows it.
              required: false
              multiple: false
              computed: true
              readonly: true
            last_run:
              type: datetime
              title: Last run
              description: 'Computed, internal: when the machine last started a run. The listing row shows it relative, captioned "Last run".'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_group:
        bb_group:
          title: bakers.build group
          purpose: The customer. Bundles projects and carries the cost centre for re-invoicing. Carries NO permissions and is NOT an OG group — og.settings registers only bb_workspace and bb_team since BB-462 D7 deregisters bb_project — it is not a rights level, so no screen may offer a permission control on it.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under group-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The customer COST CENTRE for re-invoicing. Same field type and name as bb_workspace.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. Both exist; neither replaces the other.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              description: The tenant this customer belongs to. Built by BB-316; on feat/bb-315-multi-workspace, not yet on develop.
              required: false
              multiple: false
              reference: bb_workspace
            projects:
              type: integer
              title: Projects
              description: 'Computed, internal: the number of the group''s projects the reader may view. The listing row shows it as a project badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the group id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_ticket:
        bb_ticket:
          title: bakers.build ticket
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_mine:
              template: field-map
              label: List item (my work)
            list_item_compact:
              template: field-map
              label: List item (compact)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            project_id:
              type: reference
              title: Project
              required: false
              multiple: false
              reference: bb_project
            identifier:
              type: string
              title: Identifier
              required: true
              multiple: false
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_work
            title:
              type: string
              title: Title
              required: true
              multiple: false
            description:
              type: text
              title: Description
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: One of the ticket's workflow states; which subset applies is decided by `workflow`. `human_input` is not a state.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
                  - done
                  - cancelled
            ticket_type:
              type: reference
              title: Type
              description: The ticket's type term (vocabulary `type`). A ticket whose type term is named `epic` is an epic.
              required: false
              multiple: false
              reference: bb_term
            recipe:
              type: reference
              title: Recipe
              description: The ticket's recipe term (vocabulary `recipe`).
              required: false
              multiple: false
              reference: bb_term
            labels:
              type: reference
              title: Labels
              required: false
              multiple: true
              reference: bb_term
              description: The ticket's label terms (vocabulary `label`).
            assignee_user_id:
              type: reference
              title: Assignee user
              required: false
              multiple: false
              reference: user
            reviewers:
              type: reference
              title: Reviewers
              required: false
              multiple: true
              reference: user
            priority:
              type: integer
              title: Priority
              required: false
              multiple: false
              settings:
                allowed_values:
                  '1': High
                  '2': Medium
                  '3': Low
            parent_id:
              type: reference
              title: Parent ticket
              required: false
              multiple: false
              reference: bb_ticket
            blocked_by:
              type: reference
              title: Blocked by
              required: false
              multiple: true
              reference: bb_ticket
            origin:
              type: string
              title: Origin URL
              required: false
              multiple: false
            links:
              type: link
              title: Links
              description: Typed links (uri, title, options.bakers.kind); kind is server-derived.
              required: false
              multiple: true
            comments:
              type: reference
              title: Comments
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            pending_reviews:
              type: reference
              title: Pending reviews
              description: Submitted reviews awaiting a decision by the current assignee (computed; never writable). Private; not part of the ordinary comment timeline.
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            branch_name:
              type: string
              title: Branch name
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            frozen:
              type: boolean
              title: Frozen
              description: Operator hold. A frozen ticket is not claimable; an active run is left running.
              required: false
              multiple: false
            frozen_at:
              type: datetime
              title: Frozen at
              description: When the operator hold started. Server-stamped, cleared on unfreeze.
              required: false
              multiple: false
              readonly: true
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            number:
              type: integer
              title: Number
              description: Per-project running number, allocated once on first save and frozen.
              required: false
              multiple: false
              readonly: true
            conductor_id:
              type: reference
              title: Conductor
              description: Assigning a conductor is what starts a run.
              required: false
              multiple: false
              reference: bb_conductor
            time_estimate:
              type: integer
              title: Estimated time
              description: Estimated effort in SECONDS, proposed at qualification, confirmed by a human.
              required: false
              multiple: false
            time_spent:
              type: integer
              title: Spent time
              description: Accounted effort in SECONDS, proposed at review, confirmed by a human.
              required: false
              multiple: false
            referenced_tickets:
              type: reference
              title: Referenced tickets
              description: Tickets carried by this deployment (the release batch).
              required: false
              multiple: true
              reference: bb_ticket
            environments:
              type: reference
              title: Environments
              description: The managed environments this ticket concerns.
              required: false
              multiple: true
              reference: bb_environment
            env_vars:
              type: text
              title: Environment variables
              description: .env-style KEY=value lines. Inherited by sub-tickets. Readable by anyone who can view this ticket.
              required: false
              multiple: false
            metrics:
              type: object
              title: Metrics
              description: Named success metrics for this ticket.
              required: false
              multiple: true
              settings:
                properties:
                  name: string
                  value: string
                  unit: string
                  recorded: datetime
            cleaned_up:
              type: boolean
              title: Cleaned up
              description: The herdr worktree has been torn down. Distinct from `closed`.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            base_branch:
              type: string
              title: Base branch
              description: Parent's branch, else the first project repo default_branch, else "main".
              required: false
              multiple: false
              computed: true
              readonly: true
            effective_env_vars:
              type: text
              title: Effective environment variables
              description: env_vars resolved along the parent chain (child wins).
              required: false
              multiple: false
              computed: true
              readonly: true
            sub_tickets:
              type: reference
              title: Sub-tickets
              description: Reverse reference; parent_id is the source of truth.
              required: false
              multiple: true
              reference: bb_ticket
              computed: true
              readonly: true
            runs:
              type: reference
              title: Runs
              description: Reverse reference; bb_run.ticket_id is the source of truth.
              required: false
              multiple: true
              reference: bb_run
              computed: true
              readonly: true
            derived_status:
              type: string
              title: Derived status
              description: idle | running | … — derived from the ticket's active runs.
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_reason:
              type: string
              title: Stall reason
              description: 'Why this ticket is standing still: frozen, blocked, no conductor, or failing. Empty for a moving or closed ticket.'
              required: false
              multiple: false
              computed: true
              readonly: true
            claim_machine:
              type: string
              title: Claim machine
              required: false
              multiple: false
              computed: true
              readonly: true
            since_label:
              type: string
              title: Since
              description: Humanised age of the current state, e.g. "3 minutes".
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_initials:
              type: string
              title: Assignee initials
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_name:
              type: string
              title: Assignee name
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_color:
              type: string
              title: Assignee colour
              required: false
              multiple: false
              computed: true
              readonly: true
            state_flow:
              type: string
              title: State flow
              description: Comma-separated states of the ticket's workflow, in order.
              required: false
              multiple: false
              computed: true
              readonly: true
            edit_url:
              type: url
              title: Edit URL
              required: false
              multiple: false
              computed: true
              readonly: true
            row_accent:
              type: string
              title: Row accent
              description: 'Computed, internal: the listing row''s accent rail, attention in the review phase, running while a conductor holds the ticket, otherwise none.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary:
              type: string
              title: Run summary
              description: 'Computed, internal: the run count and the latest run''s state, as the bb_run_summary formatter''s badge label ("5 runs · last running").'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_tone:
              type: string
              title: Run summary tone
              description: 'Design-only. Not a Drupal field: bb_run_summary keys the badge tone on the latest run''s state. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_suffix:
              type: string
              title: Run summary time
              description: 'Design-only. Not a Drupal field: bb_run_summary appends the latest run''s relative time. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_suffix:
              type: string
              title: Stall time
              description: 'Design-only. Not a Drupal field: bb_stall_reason appends how long a frozen ticket has been frozen. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            identifier_link:
              type: string
              title: Identifier link
              description: 'Design-only. Not a Drupal field: bb_ticket_identifier_cell renders `identifier` as a mono link to the ticket, while the compact row prints it plain. The value is the identifier; its `_formatted` companion carries the link.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_icon:
              type: string
              title: State icon
              description: 'Design-only. Not a Drupal field: bb_ticket_state_icon_cell draws the state as an icon labelled with the state (running phase full, otherwise faint). The value is the label; its `_formatted` companion carries the mark.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_label:
              type: string
              title: Priority label
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell labels the priority from its allowed values. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_tone:
              type: string
              title: Priority tone
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell marks the highest priority critical. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_name:
              type: string
              title: Owner name
              description: 'Design-only. Not a Drupal field: bb_ticket_owner_cell draws the owner as a person cell. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_initials:
              type: string
              title: Owner initials
              description: 'Design-only. Not a Drupal field: the owner''s person initials. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_color:
              type: string
              title: Owner colour
              description: 'Design-only. Not a Drupal field: the owner''s person colour. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field; sample data carries it as the record key.
            uuid: Entity key; the designbook model addresses records by `id`.
      bb_term:
        type:
          title: bakers.build ticket type
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        recipe:
          title: bakers.build recipe
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        label:
          title: bakers.build label
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
      bb_run:
        bb_run:
          title: bakers.build run
          view_modes:
            full:
              template: field-map
            overlay:
              template: field-map
            teaser:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: false
              multiple: false
              reference: bb_ticket
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
            state:
              type: string
              title: Run state
              required: true
              multiple: false
              settings:
                allowed_values:
                  - claimed
                  - running
                  - done
                  - expired
                  - failed
            claim_expires_at:
              type: datetime
              title: Claim expires at
              required: false
              multiple: false
            state_at_start:
              type: string
              title: Ticket state at start
              required: false
              multiple: false
            started_at:
              type: datetime
              title: Started at
              required: false
              multiple: false
            heartbeat:
              type: datetime
              title: Heartbeat
              required: false
              multiple: false
            worktree_path:
              type: string
              title: Worktree path
              required: false
              multiple: false
            log:
              type: text
              title: Log
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              description: The run's owning account — comes from the conductor, never the session.
              required: false
              multiple: false
              reference: user
            agent:
              type: string
              title: Agent
              required: false
              multiple: false
            harness:
              type: string
              title: Harness
              description: Id of the agent harness package that drove the session, e.g. claude or codex.
              required: false
              multiple: false
            model:
              type: string
              title: Model
              description: The candidate's configured model, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            model_version:
              type: string
              title: Model version
              description: The candidate's configured exact version, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            error_log:
              type: text
              title: Error log
              description: Cause of a terminal dispatch/setup failure (state `failed`).
              required: false
              multiple: false
            tokens:
              type: integer
              title: Tokens
              description: First of the six per-run footprint fields (BB-132), written by the run-owning conductor at close. Not the ticket's `time_spent`.
              required: false
              multiple: false
            duration_s:
              type: integer
              title: Duration in seconds
              required: false
              multiple: false
            agent_turns:
              type: integer
              title: Agent turns
              required: false
              multiple: false
            tool_calls:
              type: integer
              title: Tool calls
              required: false
              multiple: false
            user_prompts:
              type: integer
              title: User prompts
              required: false
              multiple: false
            user_prompt_words:
              type: integer
              title: User prompt words
              required: false
              multiple: false
            state_flow:
              type: string
              title: State flow
              required: false
              multiple: false
              computed: true
              readonly: true
            duration:
              type: string
              title: Duration
              description: Humanised closed_date − started_at, e.g. "1m 12s".
              required: false
              multiple: false
              computed: true
              readonly: true
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: 'Design-only. Not a Drupal field: the row reaches the ticket''s identifier through ticket_id, rendered by bb_ticket_identifier_cell as a mono link to the ticket. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_label:
              type: string
              title: State label
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell labels the run state from the bb_run workflow. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_tone:
              type: string
              title: State tone
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell keys the tone on the state (BbRun::STATE_MARKS). Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_environment:
        bb_environment:
          title: bakers.build environment
          purpose: A managed deployment target of a project — the thing a ship ticket stamps and a verification ticket verifies against.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            base_url:
              type: url
              title: Base URL
              required: false
              multiple: false
            tier:
              type: string
              title: Tier
              required: false
              multiple: false
              settings:
                allowed_values:
                  production: Production
                  staging: Staging
                  development: Development
                  other: Other
            branch:
              type: string
              title: Branch
              description: The git branch this environment deploys from.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      user:
        user:
          title: User
          purpose: A person or app account. Modelled as the entity type `user` with its single bundle, because that is what every reference in this model targets.
          view_modes:
            full:
              template: field-map
            compact:
              template: field-map
              label: Compact
          form_modes:
            default:
              template: field-map
          fields:
            user_picture:
              type: image
              title: Profile picture
              description: Core image field; also switches on social_auth's own avatar download at login (BB-507 D3).
              required: false
              multiple: false
            field_full_name:
              type: string
              title: Full name
              description: Additive (BB-507 D4) — does not replace or derive display_name.
              required: false
              multiple: false
            name:
              type: string
              title: Username
              required: true
              multiple: false
            mail:
              type: string
              title: Email
              required: false
              multiple: false
            status:
              type: boolean
              title: Active
              required: false
              multiple: false
            roles:
              type: string
              title: Roles
              description: Machine names, e.g. bb_session.
              required: false
              multiple: true
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            access:
              type: datetime
              title: Last access
              required: false
              multiple: false
            login:
              type: datetime
              title: Last login
              required: false
              multiple: false
            timezone:
              type: string
              title: Timezone
              required: false
              multiple: false
            display_name:
              type: string
              title: Display name
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the ticket and comment entities expose assignee_initials / author_initials instead. Present so an avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            pass: Authentication internal; no bakers.build screen renders or edits a password hash.
            init: Authentication internal (initial email); never rendered.
            preferred_langcode: Localisation internal; bakers.build is English-only.
            preferred_admin_langcode: Localisation internal; bakers.build is English-only.
            default_langcode: Entity key for translations; bakers.build users are single-language.
            changed: Drupal's user entity has no `changed` field; `access` and `login` carry recency.
      bb_profile:
        bb_profile:
          title: bakers.build profile
          purpose: 'What a person tells bakers.build about themselves, one per user and workspace (unique on uid + workspace_id): their position, their background handed to AI assistants as context, and their favorite projects. Replaces the user fields field_developer_title and field_bb_background. Edited on the Profile tab /user/{user}/profile for the workspace in context; the entity has no view display.'
          form_modes:
            default:
              template: field-map
          fields:
            uid:
              type: reference
              title: Owner
              required: true
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            position:
              type: string
              title: Position
              description: Free text, at most 255 characters; placeholder "e.g. Product Lead".
              required: false
              multiple: false
            background:
              type: text
              title: What should bakers.build know about your background?
              description: Optional long text (string_long) handed to AI assistants as context, e.g. "Drupal developer, confident with PHP; little DevOps experience."
              required: false
              multiple: false
            favorite_projects:
              type: reference
              title: Favorite projects
              description: Projects this person marked as favorite in this workspace; not on the form.
              required: false
              multiple: true
              reference: bb_project
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_workspace:
        bb_workspace:
          title: bakers.build workspace
          purpose: 'The tenancy root: the object that says this data belongs to operator X and not operator Y. It holds all people and decides WHICH RIGHTS an account holds — BB-462 makes the workspace the ONLY level that carries rights: admin/contributor/guest (D2). Visibility of a project is a separate, per-team question (D4) that carries no rights of its own. Is an OG group (registered in og.settings) with the roles non-member, member, contributor, lead (labelled "Admin") and guest — five, not six: `owner`/`admin` were already consolidated into `lead` by BB-359 D12, and the machine principal `app` is GONE (BB-462 D9, its rank is answered entirely from OAuth scope now). Built by BB-316; the role set is BB-462''s.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; shown under the workspace's name in the switcher panel and on the join screen, absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately and shown uncropped as the workspace's mark in the switcher and on the join screen; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The CONTRACT or SUBSCRIPTION this tenant is served under. Same field type and name as bb_group.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. There is no `contract` field and there will not be one — the billing profile IS the contract level.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_team:
        bb_team:
          title: bakers.build team
          purpose: 'The stable crew, cutting across customer projects, and since BB-419 also their structural parent: a project is assigned to teams n:m through bb_project.teams and belongs to at least one. BB-462 D4 REVERSES what this field used to say: the assignment now DECIDES VISIBILITY — an account sees exactly the projects of the teams it belongs to (or every project, if it holds the workspace admin tier) — while still granting no RIGHTS of its own; a team answers "what do you see", the workspace alone answers "what may you do" (D2/D3). Is an OG group (registered in og.settings) with the roles non-member, member, lead (BB-456 D9, team-scoped statistics visibility) and owner (BB-462 D3, manages the team itself — who may join it and its own settings). The implicit member rank stays empty by design: team membership is a visibility fact, not a rights tier.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            projects:
              type: reference
              title: Projects
              description: The projects assigned to this team. Derived from bb_project.teams and never stored here, so the two directions cannot disagree.
              required: false
              multiple: true
              reference: bb_project
              computed: true
              readonly: true
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
      og_membership:
        default:
          title: OG membership
          purpose: 'Membership is ONE mechanism, modelled once: a user x group row reused by workspace and team rather than re-invented per level. This is NOT a bakers.build invention — it is contrib Organic Groups'' own og_membership entity, whose only bundle is `default` (og.og_membership_type.default). BB-462 D7 REVERSES what this field used to say: og.settings now registers only bb_workspace and bb_team as OG groups — bb_project is deregistered entirely, and every membership row anchored on a project is deleted by that ticket''s migration. BB-318 bridges the remaining rows into bakers.build''s query access. A screen reads membership here, never from a field on the group.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            type:
              type: string
              title: Membership type
              description: OG's bundle key — in code an entity reference to the og_membership_type config entity. Modelled as its value set rather than as a reference because bakers.build ships exactly one instance, og.og_membership_type.default, and no screen renders or chooses it.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - default
            uid:
              type: reference
              title: User
              description: The member. OG's own field name — not `user_id`.
              required: true
              multiple: false
              reference: user
            entity_type:
              type: string
              title: Group entity type
              description: Which level this membership is in. A workspace or project membership grants rights; a team membership does not, because the team carries no permissions.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            entity_bundle:
              type: string
              title: Group bundle
              description: Bundle of the group entity. Each of the three types has one bundle of its own name.
              required: false
              multiple: false
            entity_id:
              type: string
              title: Group entity ID
              description: Id of the group named by entity_type. A plain STRING in OG, not a reference, because the target entity type varies per row — so no screen can rely on an entity-reference widget here.
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: Defaults to active. Only an active membership grants what its roles carry.
              required: true
              multiple: false
              settings:
                allowed_values:
                  - active
                  - pending
                  - blocked
            roles:
              type: reference
              title: Roles
              description: 'MULTI-VALUE (OG sets cardinality unlimited) and a reference to og_role config objects by their full id, e.g. bb_workspace-bb_workspace-lead. The `member` role is never stored: OgMembership::preSave() revokes it and getRoles() prepends it on read, so a row that looks role-less is still a member.'
              required: false
              multiple: true
              reference: og_role
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            language: Entity key; bakers.build memberships are single-language and no screen renders a language.
      bb_addon:
        bb_addon:
          title: bakers.build addon
          purpose: An addon definition at one version (name@version), registered by the conductors that run it. Entity access is admin-only; workspace leads see the addons in the workspace Settings › Addons tab, one row per name at its newest version with all its versions and the conductors of the current workspace that run each version. The definition is immutable once registered and may carry an inline SVG icon. Read-only on every screen.
          view_modes:
            list_item:
              template: field-map
              label: List item
          fields:
            name:
              type: string
              title: Name
              description: Machine name of the addon, e.g. ports. Together with version it forms the name@version key.
              required: true
              multiple: false
            version:
              type: string
              title: Version
              description: Semantic version string, e.g. 1.2.3.
              required: true
              multiple: false
            contract:
              type: integer
              title: Contract
              description: Version of the addon definition contract the addon implements, e.g. 1.
              required: true
              multiple: false
            definition:
              type: text
              title: Definition
              description: 'Immutable JSON addon definition: label, views, actions and an optional inline SVG icon. The Settings › Addons tab shows only its label and icon.'
              required: true
              multiple: false
            conductors:
              type: reference
              title: Conductors
              description: Conductors that registered (run) this addon version.
              required: false
              multiple: true
              reference: bb_conductor
              settings:
                target_type: bb_conductor
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            label:
              type: string
              title: Label
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter prints the definition''s label. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            versions_label:
              type: string
              title: Versions
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter lists every version of the name once, newest first. Present so the Versions cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter draws the initials of the label. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter keys the avatar colour on the addon id. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_badges:
              type: string
              title: Conductors
              description: 'Design-only. Not a Drupal field: the bb_addon_conductors formatter renders `conductors` as one dotted badge per conductor and version ("<conductor> <version>", running when online, offline otherwise), or "No conductor in this workspace". The value lists the badges as text; its `_formatted` companion carries the rendered badges.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter turns the definition''s inline SVG icon into a data URI; empty for initials. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
    config:
      image_style:
        avatar:
          aspect_ratio: '1:1'
      omitted:
        bb_core.bb_vocabulary: The vocabulary IS the bb_term bundle; no screen renders it as an object of its own.
        view.environments: Drupal has no environments View, and no list of environments exists yet. The bb_project environments field is hidden on the project full display; only its referenced names show on the project properties detail card (BbEntityDetailCardForm). Ship tickets show their environments as chips in the ticket inspector. The view.environments mapping is ahead of the backend and has no Drupal counterpart.
      og_role:
        og_role:
          title: OG role
          purpose: 'The role vocabulary of the OG groups — what a Settings screen assigns a person on a workspace or a team. Contrib Organic Groups'' own config entity. AS-IS, MEASURED IN config/sync AT BB-462: NINE objects, not ten — bb_project carries no role at all any more (D7 deregisters it as an OG group entirely). Five for bb_workspace (non-member, member, contributor, lead, guest) and four for bb_team (non-member, member, lead, owner). `app` is GONE (D9: a conductor''s OAuth identity is bound to its owning user, so it sees exactly what that user''s own rank sees — no separate machine rank exists to list here). `owner` is NEW (D3): governs the team itself, who may join it and its own settings. The key is the Drupal config-name PREFIX, so this is one entry per config entity TYPE; the instances live in sample data. Three facts a screen must not get wrong. First, `permissions` is NOT an empty list on every role: bb_workspace-lead and -contributor carry real permission strings (create/edit/delete rights), bb_workspace-guest carries read-only, and bb_team-owner carries `manage members`/`update group`. It IS empty on exactly four: the three non-member roles and bb_team-bb_team-member — the implicit member rank is deliberately emptied everywhere (D1: OG ranks are additive and cannot be narrowed, so any right left on an implicit rank is inherited by every membership including guests). Second, `is_admin` is FALSE on all nine. Third, "a workspace admin sees every project of their workspace" (D4) is a VISIBILITY rule computed from the rank id, never an OG admin flag or a project-level role — there is no project-level role left to read at all. TARGET: product roles are OG ranks only; team ownership is the one new rank this ticket adds.'
          fields:
            id:
              type: string
              title: Machine name
              description: Composed as <group_type>-<group_bundle>-<role name>, e.g. bb_workspace-bb_workspace-lead. This full id is what og_membership.roles references.
              required: true
              multiple: false
            label:
              type: string
              title: Label
              description: The human name a Settings screen shows, e.g. "Administrator".
              required: true
              multiple: false
            weight:
              type: integer
              title: Weight
              description: Display order within a group type; 0 for non-member, rising to 5 for the workspace app role.
              required: false
              multiple: false
            is_admin:
              type: boolean
              title: Is admin
              description: FALSE on every shipped role — measured in config/sync at BB-435 across all ten og.og_role objects, and the role it used to name does not exist. Read the role id, never this flag. See the purpose above.
              required: false
              multiple: false
            permissions:
              type: string
              title: Permissions
              description: OG permission strings. Empty in exactly four of the ten shipped roles — the three non-member roles and bb_team-bb_team-member — see the purpose above before designing anything that edits this.
              required: false
              multiple: true
            group_type:
              type: string
              title: Group entity type
              required: true
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            group_bundle:
              type: string
              title: Group bundle
              required: true
              multiple: false
            role_type:
              type: string
              title: Role type
              description: '`required` for the two roles OG creates for every group (non-member, member); `standard` for the roles bakers.build adds. A screen must not offer to delete a required role.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - required
                  - standard
          omitted:
            uuid: Config entities carry a uuid that is not part of the modelled key set and is never rendered.
            group_id: Null in all ten shipped roles. OG sets it only for a role scoped to one single group instance, which bakers.build ships none of, so no screen renders it.
      view:
        addons:
          title: Addons
          purpose: Lists every registered addon once, at its newest version, with the conductors of the routed workspace that run any of its versions.
          base_table: bb_addon
          items_per_page: 50
          columns:
            - icon
            - label
            - name
            - versions
            - contract
            - conductors
          displays:
            default:
              plugin: default
            settings:
              plugin: page
              path: /_workspace/%bb_workspace/settings/addons
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_addon records the View lists; Drupal renders each row as the addon in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_addon
                  bundle: bb_addon
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        conductors:
          title: Conductors
          purpose: |-
            Two listings of bb_conductor. The user-area rail item (user_list) is the
            conductors assigned to the account in the URL, any workspace. The project
            tab (project_list) is that project's conductors, any owner. Both walk
            project_id then group_id because bb_conductor carries no workspace field
            of its own. Both joins are INNER: a conductor whose project or group is
            gone has no workspace to be listed under.
          base_table: bb_conductor
          items_per_page: 50
          columns:
            - conductor_id
            - label
            - status
            - reported_load
            - owner_user_id
            - last_seen
          displays:
            default:
              plugin: default
            project_list:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/conductors
            user_list:
              plugin: page
              path: /user/%user/conductors
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_conductor records the View lists; Drupal renders each row as the conductor in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_conductor
                  bundle: bb_conductor
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        conductor_tickets:
          title: Conductor tickets
          purpose: |-
            Tickets occupying one conductor. The occupancy source supplies explicit
            numeric ticket ids; this view never lists by ticket conductor_id and has
            no page route.
          base_table: bb_ticket
          columns:
            - identifier
            - title
          displays:
            default:
              plugin: default
            occupancy:
              plugin: embed
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item_compact` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item_compact
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        groups:
          title: Groups
          purpose: Lists the groups of the routed workspace. The Groups page owns the create-group action. A group organizes customer and cost-centre data; it grants no permissions.
          base_table: bb_group
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - description
            - projects
            - changed
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/groups
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_group records the View lists; Drupal renders each row as the group in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_group
                  bundle: bb_group
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        machines:
          title: Machines
          purpose: |-
            The user-area rail item (user_list) is the machines assigned to the
            account in the URL, any workspace.
          base_table: bb_machine
          items_per_page: 50
          columns:
            - name
            - max_parallel
            - current_load
            - owner_user_id
            - last_run
          displays:
            default:
              plugin: default
            user_list:
              plugin: page
              path: /user/%user/machines
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_machine records the View lists; Drupal renders each row as the machine in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_machine
                  bundle: bb_machine
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        project_board:
          title: Project board
          purpose: |-
            Four-column project board of bb_ticket on the tickets Search API
            index. The page display owns the route. Each lifecycle column is a
            bb_board_column attachment with its own mini pager. Column membership is the indexed work_state value.
            Parent focus applies to every display; the page header summarizes the whole matching selection.
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - identifier
          displays:
            default:
              plugin: default
            backlog:
              plugin: bb_board_column
            done:
              plugin: bb_board_column
            intake:
              plugin: bb_board_column
            project_board:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/board
            working:
              plugin: bb_board_column
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row with the `fields` row plugin.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: default
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
        projects:
          title: Projects
          purpose: |-
            The projects of the workspace named in the URL, five columns. A LISTING IS A
            VIEW: the row this replaced was a bb_project.bb_project.teaser view mode,
            and BB-389 removed it because a list row was never a view mode.

            THE ROWS COME FROM THE URL, and that is this view's own argument rather than the
            query-access layer's doing. BbWorkspaceReadScope resolves an ACCOUNT's scope —
            the union of every OG membership, with no workspace parameter — so for a user
            who belongs to several workspaces it admits more rows than the URL asked for.
            The `workspace_id` argument narrows to the one workspace, walking the group_id
            relationship because bb_project carries no workspace field of its own. Its
            `default_action` is `access denied` rather than a fallback to all: a view that
            listed every workspace the moment a route stopped supplying the parameter is how
            ambient scoping turns into a disclosure. Query access stays the floor
            underneath — the two layers answer two different questions.

            THE TWO RELATIONSHIPS DISAGREE ABOUT `required` ON PURPOSE. owner_user_id is a
            LEFT JOIN, and the reason stated here used to be that BbProject::owner_user_id
            is not setRequired(TRUE). That is now FALSE — the field has carried
            setRequired(TRUE) since 66780aa93 — and the LEFT JOIN is still right, so only
            the rationale is corrected. setRequired() is a VALIDATION constraint on a write
            to the project; it is not delete protection on the account referenced. bb_core
            guards that nowhere — no preDelete, no cascade, no reference constraint — so a
            stored project can still be left pointing at a deleted user, and an inner join
            on it drops the whole project from this listing the moment that happens: no
            message, no empty cell, no row. group_id stays an INNER JOIN, and for a positive
            reason rather than the same one: it carries the workspace argument, so a project
            whose group is gone has no workspace to be listed under, and the honest answer
            is no workspace rather than every workspace. That the referenced rows can vanish
            at all is a data-integrity gap, not this listing's to paper over.

            TWO DESIGNED COLUMNS ARE ABSENT, NAMED HERE RATHER THAN LEFT TO AN EMPTY SPACE.
            Teams is absent, and the reason stated here used to be that bb_project carries
            no `teams` field at all. That is now FALSE, in the same way the owner_user_id
            sentence above was: BB-419 added `teams` as a required, unlimited-cardinality
            entity_reference (BbProject.php), so the n:m assignment DOES exist and the
            cancelled BB-356 no longer describes the state of the field. What is true is
            that this listing still renders no teams column, and no decision has been
            recorded that it should not — so this is an open question about the listing
            rather than a structural impossibility, and it is named as one here instead of
            being justified by a field that is gone from the reasoning. Environments is
            absent for a reason that does still hold: it is a COUNT over a multi-value
            entity reference and core views has no field for that; a column showing the
            first referenced environment instead of the count would be a different and
            wrong value.

            IT COMPOSES A CANVAS WHOSE HEADING LIVES IN THE SHELL. The screen title,
            tabs and New-project action are the `page_header` island on
            `island.profile.bb_shell`. This display's tree is `bb_theme:canvas`
            with a `bb_theme:zone` in `main` wrapping `view_rows` plus `view_pager`.
            The `empty` area is untouched, because ui_patterns' own `view_rows` source
            renders a view's empty areas when it has no rows.

            THE ROWS ARE STILL CORE'S `table` WITH `row: type: fields`, AND NOT FOR THE
            REASON D1 GAVE. D1 priced the alternative as a bespoke ui_patterns Source, and that
            is not what it costs: a PRESENTER TEMPLATE — a markup-free template that
            transforms what views handed it and include()s the component, reached by core's
            own theme suggestion (ViewExecutable::buildThemeFunctions() emits
            views_view_table__projects) — needs no plugin and would leave this file exactly
            as it is. What IS true is that site building cannot do it: `rows` is a PROP
            holding an array of objects, and no shipped ui_patterns source serves such a
            prop type — ui_patterns_views's view_rows declares `prop_types: [slot]`, and
            across all 22 shipped sources the prop types are attributes, boolean, enum,
            enum_list, enum_set, identifier, links, list, number, slot, string, url and
            variant. That absence is the condition under which a presenter is the right
            answer rather than a trick. BB-413 owns that template; when it lands this
            listing renders through bb_theme:table with no change here.
          base_table: bb_project
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - key
            - description
            - open_tickets
            - conductor_tickets
            - closed_tickets
            - created
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/projects
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_project records the View lists; Drupal renders each row as the project in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_project
                  bundle: bb_project
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        runs:
          title: Runs
          base_table: search_api_index_bb_runs
          items_per_page: 10
          columns:
            - identifier
            - state
            - state_at_start
            - conductor_id
            - agent
            - started_at
            - duration_s
          displays:
            default:
              plugin: default
            project_runs:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/runs
            team_runs:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/runs
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_run records the View lists; Drupal renders each row as the run in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_run
                  bundle: bb_run
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
        tickets:
          title: Tickets
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - state
            - title
            - priority
            - identifier
            - created
            - owner
            - conductor
            - stall_reason
            - run_count
            - assignee
          displays:
            default:
              plugin: default
            my_work:
              plugin: page
              path: /_workspace/%bb_workspace/tickets
            page_1:
              plugin: page
              path: /_workspace/%bb_workspace/tickets/all
            project_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/tickets
            team_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/tickets
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
  components_dir: /var/www/html/web/themes/custom/bb_theme/components
  records:
    - id: '1'
      summary: 'BB-142: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Add designbook entity view-mode for bb_ticket</a>
        identifier_link: BB-142
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-142</a>
        state_icon: Working
        state_icon_formatted: <span role="img" aria-label="Working" title="Working" class="inline-flex shrink-0 items-center text-text"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-running"></use></svg></span>
        priority_label: Medium
        priority_tone: neutral
        created_formatted: 3 days ago
        owner_name: Christian Wiedemann
        owner_initials: CW
        owner_color: attention
        assignee_name: Christian Wiedemann
        assignee_initials: CW
        assignee_color: attention
        conductor_label: cw · framework
        conductor_mine: true
        stall_reason: ''
        stall_suffix: ''
        run_summary: 5 runs · last running
        run_summary_tone: running
        run_summary_suffix: 12 minutes ago
        row_accent: running
    - id: '2'
      summary: 'BB-100: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Designbook coverage for core bakers.build entities</a>
        identifier_link: BB-100
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-100</a>
        state_icon: Qualification
        state_icon_formatted: <span role="img" aria-label="Qualification" title="Qualification" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: High
        priority_tone: critical
        created_formatted: 2 weeks ago
        owner_name: ''
        owner_initials: ''
        owner_color: ''
        assignee_name: Sven Gruber
        assignee_initials: SG
        assignee_color: unassigned
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: ''
    - id: '3'
      summary: 'BB-110: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Ship data-model schema for bb_ticket bundle</a>
        identifier_link: BB-110
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-110</a>
        state_icon: Qualification
        state_icon_formatted: <span role="img" aria-label="Qualification" title="Qualification" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: Low
        priority_tone: neutral
        created_formatted: 2 weeks ago
        owner_name: ''
        owner_initials: ''
        owner_color: ''
        assignee_name: Christian Wiedemann
        assignee_initials: CW
        assignee_color: attention
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: ''
    - id: '4'
      summary: 'BB-118: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        owner_user_id: '1'
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Draft ticket_detail component spec</a>
        identifier_link: BB-118
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-118</a>
        state_icon: Plan
        state_icon_formatted: <span role="img" aria-label="Plan" title="Plan" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: Medium
        priority_tone: neutral
        created_formatted: 3 weeks ago
        owner_name: Christian Wiedemann
        owner_initials: CW
        owner_color: attention
        assignee_name: Sven Gruber
        assignee_initials: SG
        assignee_color: unassigned
        conductor_label: ''
        conductor_mine: false
        stall_reason: no conductor
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: ''
    - id: '5'
      summary: 'BB-105: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        owner_user_id: '2'
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Review comment-event rendering for typed comments</a>
        identifier_link: BB-105
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-105</a>
        state_icon: Review
        state_icon_formatted: <span role="img" aria-label="Review" title="Review" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: Medium
        priority_tone: neutral
        created_formatted: 1 week ago
        owner_name: Sven Gruber
        owner_initials: SG
        owner_color: unassigned
        assignee_name: Christian Wiedemann
        assignee_initials: CW
        assignee_color: attention
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: attention
    - id: '6'
      summary: 'BB-90: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Bootstrap bb_theme SDC scaffolding</a>
        identifier_link: BB-90
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-90</a>
        state_icon: Done
        state_icon_formatted: <span role="img" aria-label="Done" title="Done" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: Low
        priority_tone: neutral
        created_formatted: 2 weeks ago
        owner_name: ''
        owner_initials: ''
        owner_color: ''
        assignee_name: Sven Gruber
        assignee_initials: SG
        assignee_color: unassigned
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: ''
    - id: '7'
      summary: 'BB-145: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        owner_user_id: '1'
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Comment feed region in ticket_detail</a>
        identifier_link: BB-145
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-145</a>
        state_icon: Working
        state_icon_formatted: <span role="img" aria-label="Working" title="Working" class="inline-flex shrink-0 items-center text-text"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-running"></use></svg></span>
        priority_label: Medium
        priority_tone: neutral
        created_formatted: 2 days ago
        owner_name: Christian Wiedemann
        owner_initials: CW
        owner_color: attention
        assignee_name: Christian Wiedemann
        assignee_initials: CW
        assignee_color: attention
        conductor_label: ''
        conductor_mine: false
        stall_reason: frozen
        stall_suffix: 2 hours ago
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: ''
    - id: '8'
      summary: 'BB-146: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        owner_user_id: '4'
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Runs, sub-tickets and footprint sections</a>
        identifier_link: BB-146
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">BB-146</a>
        state_icon: Review
        state_icon_formatted: <span role="img" aria-label="Review" title="Review" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: Low
        priority_tone: neutral
        created_formatted: 4 days ago
        owner_name: bakers.build agent
        owner_initials: BA
        owner_color: offline
        assignee_name: Sven Gruber
        assignee_initials: SG
        assignee_color: unassigned
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: attention
    - id: '9'
      summary: 'NWS-80: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Checkout address step rewrite</a>
        identifier_link: NWS-80
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">NWS-80</a>
        state_icon: Working
        state_icon_formatted: <span role="img" aria-label="Working" title="Working" class="inline-flex shrink-0 items-center text-text"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-running"></use></svg></span>
        priority_label: High
        priority_tone: critical
        created_formatted: 5 hours ago
        owner_name: Marieke van Dijk
        owner_initials: MV
        owner_color: lease
        assignee_name: Marieke van Dijk
        assignee_initials: MV
        assignee_color: lease
        conductor_label: mvd · shop
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: 1 run · last done
        run_summary_tone: idle
        run_summary_suffix: 1 day ago
        row_accent: running
    - id: '10'
      summary: 'NWS-81: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Cart total ignores per-item discounts</a>
        identifier_link: NWS-81
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">NWS-81</a>
        state_icon: Review
        state_icon_formatted: <span role="img" aria-label="Review" title="Review" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: High
        priority_tone: critical
        created_formatted: 6 days ago
        owner_name: Marieke van Dijk
        owner_initials: MV
        owner_color: lease
        assignee_name: bakers.build agent
        assignee_initials: BA
        assignee_color: offline
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: attention
    - id: '11'
      summary: 'NWS-82: unchanged fields kept; adds the listing row''s formatted cells, people, badges and accent.'
      values:
        title_formatted: <a href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">Move the staging deploy onto the shared runner</a>
        identifier_link: NWS-82
        identifier_link_formatted: <a class="font-mono text-data text-text no-underline max-md:inline-flex max-md:items-center max-md:min-h-touch max-md:min-w-touch hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href="/?path=/story/designbook-sections-my-work-scenes--ticket-detail">NWS-82</a>
        state_icon: Qualification
        state_icon_formatted: <span role="img" aria-label="Qualification" title="Qualification" class="inline-flex shrink-0 items-center text-text-faint"><svg class="icon inline-block shrink-0" width="20" height="20" aria-hidden="true" focusable="false"><use href="/themes/custom/bb_theme/dist/assets/icons/sprite.svg#status-prepare"></use></svg></span>
        priority_label: Low
        priority_tone: neutral
        created_formatted: 1 week ago
        owner_name: Marieke van Dijk
        owner_initials: MV
        owner_color: lease
        assignee_name: Marieke van Dijk
        assignee_initials: MV
        assignee_color: lease
        conductor_label: ''
        conductor_mine: false
        stall_reason: ''
        stall_suffix: ''
        run_summary: ''
        run_summary_tone: ''
        run_summary_suffix: ''
        row_accent: ''
  ```

  #### Contract
  ```yaml
  outputs:
    sample-data:
      required: true
      schema:
        $ref: '#/definitions/SampleDataBundle'
      submission: data
      validators:
        - data
      path: /var/www/html/web/themes/custom/bb_theme/designbook/data/bb_ticket.bb_ticket.yml
      glob: /var/www/html/web/themes/custom/bb_theme/designbook/data/*.*.yml
  ```

  #### Results
  <!-- done -->

### Step: map-entity
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:scenes-constraints, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:local-image-assets, ctx:entity-reference-rendering, ctx:inline-image, ctx:image-fields, ctx:formatted-companion, ctx:field-cardinality, ctx:views, ctx:ui-patterns, ctx:presenter-template, ctx:pager-2, ctx:layout-builder, ctx:form-display, ctx:field-map, ctx:canvas]

- [x] map-entity--design-screen — bb_ticket.list_item

  Instruction: task:map-entity--design-screen

  #### Params
  ```yaml
  mapping:
    entity_type: bb_ticket
    bundle: bb_ticket
    mode_kind: view
    view_mode: list_item
  data_model:
    content:
      bb_project:
        bb_project:
          title: bakers.build project
          purpose: 'The work unit: key, next_number, repository, environments. BB-462 D7 REVERSES what this field used to say: the project carries NO membership or role of its own any more — it is deregistered from og.settings entirely, and its three roles (non-member, member, lead) are deleted from both config paths. Visibility now comes from bb_project.teams (D4): a project is visible to the members of a team it names, or to a workspace admin. The two levels that grant rights are the workspace (create/edit/delete rights, via bb_workspace-bb_workspace-{contributor,lead}) and, per-project, its teams (visibility only — a team carries no rights of its own, BB-462 D3). A screen must not offer a permission control on the project.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            epics:
              template: field-map
              label: Epics
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            group_id:
              type: reference
              title: Group
              required: true
              multiple: false
              reference: bb_group
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under project-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            repository:
              type: object
              title: Repository
              description: 'The project repository (URL, default branch, branch naming convention). Single-valued: a project has at most one repository.'
              required: false
              multiple: false
              settings:
                properties:
                  url: string
                  default_branch: string
                  branch_convention: string
            coder_config:
              type: object
              title: Coder config
              required: false
              multiple: false
            env_vars:
              type: text
              title: Environment variables
              description: Project defaults supplied to hooks and the agent on every run, as .env-style KEY=value lines. A parent ticket and the ticket itself override a key set here. Readable by anyone who can view this project.
              required: false
              multiple: false
            teams:
              type: reference
              title: Teams
              description: 'The teams this project belongs to. A project belongs to AT LEAST ONE team, so the field is required and multi-valued. The assignment is STRUCTURE and confers no rights: it makes the team the project''s structural parent, and team membership is not a source of ticket visibility. Visibility stays at direct project membership or workspace see-all (BB-419, which deliberately left BbWorkspaceReadScope untouched).'
              required: true
              multiple: true
              reference: bb_team
            key:
              type: string
              title: Identifier prefix
              description: Ticket identifier prefix, e.g. BB in BB-328. A change applies only to tickets created afterwards.
              required: false
              multiple: false
            next_number:
              type: integer
              title: Next number
              description: Next per-project ticket number; floors to max(number)+1 on allocation.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            environments:
              type: reference
              title: Environments
              description: Managed environments belonging to this project.
              required: false
              multiple: true
              reference: bb_environment
              computed: true
              readonly: true
            open_tickets:
              type: integer
              title: Open tickets
              description: 'Computed, internal: the project''s tickets not yet closed. The listing row shows it as a ticket badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_tickets:
              type: integer
              title: Conductor tickets
              description: 'Computed, internal: the project''s tickets a conductor currently holds. The listing row shows it as a conductor badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            closed_tickets:
              type: integer
              title: Closed tickets
              description: 'Computed, internal: the project''s closed tickets. The listing row shows it as a check badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the project id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              description: Free text, not an enum (BB-227). Values in use include comment, qualification, spec, test and acceptance, so a screen must render an unknown value rather than assume a closed set.
              required: true
              multiple: false
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
        review:
          title: bakers.build review comment
          purpose: A private review of a ticket. Drafts stay with the assigned author; submitted reviews wait for the current assignee; accepted reviews publish into the ordinary comment timeline. Rejected reviews stay unpublished. The Boolean published flag is server-owned.
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              required: true
              multiple: false
            status:
              type: boolean
              title: Published
              required: false
              multiple: false
            review_state:
              type: string
              title: Review state
              required: false
              multiple: false
              settings:
                allowed_values:
                  draft: Draft
                  submitted: Submitted
                  accepted: Accepted
                  rejected: Rejected
            submitted_at:
              type: datetime
              title: Submitted at
              required: false
              multiple: false
            decided_at:
              type: datetime
              title: Decided at
              required: false
              multiple: false
            decided_by:
              type: reference
              title: Decided by
              required: false
              multiple: false
              reference: user
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_activity:
        bb_activity:
          title: bakers.build activity
          purpose: 'One persisted ticket event per row: `created` when a ticket is created, `status_changed` per state change (with the step''s summary comment, and with the run it closed and that run''s conductor when an agent did the work), `claimed` only for the first run outside qualification, and `run_ended` when a run ends failed, expired or cancelled without moving the ticket. Writes come only from the bb_activity kinds, called where the change happens. Each row is this bundle''s `full` view mode (`bb_theme:event` with a structured lead); there is no second activity view mode.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            kind:
              type: string
              title: Kind
              description: '`created`, `status_changed`, `claimed` or `run_ended`. Tags: created, status, started (claimed) and the run outcome for run_ended.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - created
                  - status_changed
                  - claimed
                  - run_ended
            actor:
              type: reference
              title: Actor
              required: false
              multiple: false
              reference: user
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
            previous_state:
              type: string
              title: Previous state
              required: false
              multiple: false
            new_state:
              type: string
              title: New state
              required: false
              multiple: false
            step:
              type: string
              title: Step
              description: The run's state_at_start for claimed and run_ended rows. Unused for created and status rows.
              required: false
              multiple: false
            run_id:
              type: reference
              title: Run
              required: false
              multiple: false
              reference: bb_run
              description: The run a claimed or run_ended row reports, or the run a status change closed. Empty for created rows and human status changes; its presence makes the row an agent row.
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
              description: The conductor of the referenced run.
            comment_id:
              type: reference
              title: Summary comment
              description: The ticket's summary comment published since the ticket entered the state a status row leaves. Empty when none.
              required: false
              multiple: false
              reference: bb_comment
            claim_key:
              type: string
              title: Claim key
              required: false
              multiple: false
              description: The claimed run's UUID; unique, guards a second claimed row for the same run. NULL on other kinds.
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: Computed from ticket_id.identifier so the event body can name the ticket without the mapping joining collections.
              required: false
              multiple: false
              computed: true
              readonly: true
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
              description: The run's model (else harness, else agent) on rows with a viewable run; otherwise the actor's display name.
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: Computed from conductor_id.label.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_harness:
              type: string
              title: Run harness
              description: Computed from run_id.harness; shown beside the model on agent rows.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_duration:
              type: string
              title: Run duration
              description: Computed from run_id duration_s (or started_at to the row time), formatted.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_outcome:
              type: string
              title: Run outcome
              description: 'Computed from run_id.state on run_ended rows: failed, expired or cancelled.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_error_line:
              type: string
              title: Run error line
              description: Computed first non-empty line of a failed run's error log.
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            changed: Activity rows are immutable; nothing writes a changed stamp.
      bb_conductor:
        bb_conductor:
          title: bakers.build conductor
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_user:
              template: field-map
              label: List item (user)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            machine_id:
              type: string
              title: Machine ID
              required: true
              multiple: false
            label:
              type: string
              title: Label
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            status:
              type: string
              title: Status
              required: false
              multiple: false
              settings:
                allowed_values:
                  online: Online
                  offline: Offline
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            states:
              type: string
              title: States
              description: The claimable ticket states this conductor picks up.
              required: false
              multiple: true
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
            workspace_root:
              type: string
              title: Workspace root
              required: false
              multiple: false
            active:
              type: boolean
              title: Active
              description: Whether the conductor may be assigned and claim work; separate from online/offline status.
              required: false
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              required: false
              multiple: false
            last_seen:
              type: datetime
              title: Last seen
              required: false
              multiple: false
            lease_expires_at:
              type: datetime
              title: Lease expires at
              required: false
              multiple: false
            conductor_name:
              type: string
              title: Conductor name
              description: The config-file stem `--conductor <name>` selects.
              required: false
              multiple: false
            last_pid:
              type: integer
              title: Last PID
              description: Reported by the serve loop that owns the process; used by a verified stop.
              required: false
              multiple: false
            node_status:
              type: string
              title: Node status
              description: running | stale | offline — the shared liveness vocabulary.
              required: false
              multiple: false
              computed: true
              readonly: true
            node_states_label:
              type: string
              title: Claimed states
              required: false
              multiple: false
              computed: true
              readonly: true
            node_load_label:
              type: string
              title: Load
              required: false
              multiple: false
              computed: true
              readonly: true
            last_seen_label:
              type: string
              title: Last seen
              required: false
              multiple: false
              computed: true
              readonly: true
            reported_load:
              type: integer
              title: Reported load
              description: The load the conductor reported on its last poll. The listing row shows it as a run badge.
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_label:
              type: string
              title: Owner
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the owner''s display name. Present so the row has a value for the Owner cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            project_label:
              type: string
              title: Project
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the project''s name. Present so the user listing''s row has a value for the Project cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_label:
              type: string
              title: Status label
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter labels the status from its allowed values. Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_tone:
              type: string
              title: Status tone
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter keys the tone on the status (online running, offline offline). Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_machine:
        bb_machine:
          title: bakers.build machine
          purpose: 'Host capacity for concurrent runs, owned by one user account. Capacity (max_parallel / current_load) belongs to the machine, not to each per-project conductor; a conductor links its machine. host_key is the machine-context stem, not the composed conductor registration key. Machines are not in the workspace read scope: the owner sees them under the account Machines listing, and the full view is the machine page /user/{user}/machine/{bb_machine}.'
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            host_key:
              type: string
              title: Host key
              description: Machine-context machine_id stem, unique per machine.
              required: true
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              description: Concurrent runs this machine accepts; default 5.
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              description: Runs currently claimed on this machine; default 0.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
              settings:
                target_type: user
            owner_label:
              type: string
              title: Owner label
              description: Display name of the owner, read through owner_user_id; the machine page shows it.
              required: false
              multiple: false
              computed: true
              readonly: true
            last_run:
              type: datetime
              title: Last run
              description: 'Computed, internal: when the machine last started a run. The listing row shows it relative, captioned "Last run".'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_group:
        bb_group:
          title: bakers.build group
          purpose: The customer. Bundles projects and carries the cost centre for re-invoicing. Carries NO permissions and is NOT an OG group — og.settings registers only bb_workspace and bb_team since BB-462 D7 deregisters bb_project — it is not a rights level, so no screen may offer a permission control on it.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under group-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The customer COST CENTRE for re-invoicing. Same field type and name as bb_workspace.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. Both exist; neither replaces the other.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              description: The tenant this customer belongs to. Built by BB-316; on feat/bb-315-multi-workspace, not yet on develop.
              required: false
              multiple: false
              reference: bb_workspace
            projects:
              type: integer
              title: Projects
              description: 'Computed, internal: the number of the group''s projects the reader may view. The listing row shows it as a project badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the group id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_ticket:
        bb_ticket:
          title: bakers.build ticket
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_mine:
              template: field-map
              label: List item (my work)
            list_item_compact:
              template: field-map
              label: List item (compact)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            project_id:
              type: reference
              title: Project
              required: false
              multiple: false
              reference: bb_project
            identifier:
              type: string
              title: Identifier
              required: true
              multiple: false
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_work
            title:
              type: string
              title: Title
              required: true
              multiple: false
            description:
              type: text
              title: Description
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: One of the ticket's workflow states; which subset applies is decided by `workflow`. `human_input` is not a state.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
                  - done
                  - cancelled
            ticket_type:
              type: reference
              title: Type
              description: The ticket's type term (vocabulary `type`). A ticket whose type term is named `epic` is an epic.
              required: false
              multiple: false
              reference: bb_term
            recipe:
              type: reference
              title: Recipe
              description: The ticket's recipe term (vocabulary `recipe`).
              required: false
              multiple: false
              reference: bb_term
            labels:
              type: reference
              title: Labels
              required: false
              multiple: true
              reference: bb_term
              description: The ticket's label terms (vocabulary `label`).
            assignee_user_id:
              type: reference
              title: Assignee user
              required: false
              multiple: false
              reference: user
            reviewers:
              type: reference
              title: Reviewers
              required: false
              multiple: true
              reference: user
            priority:
              type: integer
              title: Priority
              required: false
              multiple: false
              settings:
                allowed_values:
                  '1': High
                  '2': Medium
                  '3': Low
            parent_id:
              type: reference
              title: Parent ticket
              required: false
              multiple: false
              reference: bb_ticket
            blocked_by:
              type: reference
              title: Blocked by
              required: false
              multiple: true
              reference: bb_ticket
            origin:
              type: string
              title: Origin URL
              required: false
              multiple: false
            links:
              type: link
              title: Links
              description: Typed links (uri, title, options.bakers.kind); kind is server-derived.
              required: false
              multiple: true
            comments:
              type: reference
              title: Comments
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            pending_reviews:
              type: reference
              title: Pending reviews
              description: Submitted reviews awaiting a decision by the current assignee (computed; never writable). Private; not part of the ordinary comment timeline.
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            branch_name:
              type: string
              title: Branch name
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            frozen:
              type: boolean
              title: Frozen
              description: Operator hold. A frozen ticket is not claimable; an active run is left running.
              required: false
              multiple: false
            frozen_at:
              type: datetime
              title: Frozen at
              description: When the operator hold started. Server-stamped, cleared on unfreeze.
              required: false
              multiple: false
              readonly: true
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            number:
              type: integer
              title: Number
              description: Per-project running number, allocated once on first save and frozen.
              required: false
              multiple: false
              readonly: true
            conductor_id:
              type: reference
              title: Conductor
              description: Assigning a conductor is what starts a run.
              required: false
              multiple: false
              reference: bb_conductor
            time_estimate:
              type: integer
              title: Estimated time
              description: Estimated effort in SECONDS, proposed at qualification, confirmed by a human.
              required: false
              multiple: false
            time_spent:
              type: integer
              title: Spent time
              description: Accounted effort in SECONDS, proposed at review, confirmed by a human.
              required: false
              multiple: false
            referenced_tickets:
              type: reference
              title: Referenced tickets
              description: Tickets carried by this deployment (the release batch).
              required: false
              multiple: true
              reference: bb_ticket
            environments:
              type: reference
              title: Environments
              description: The managed environments this ticket concerns.
              required: false
              multiple: true
              reference: bb_environment
            env_vars:
              type: text
              title: Environment variables
              description: .env-style KEY=value lines. Inherited by sub-tickets. Readable by anyone who can view this ticket.
              required: false
              multiple: false
            metrics:
              type: object
              title: Metrics
              description: Named success metrics for this ticket.
              required: false
              multiple: true
              settings:
                properties:
                  name: string
                  value: string
                  unit: string
                  recorded: datetime
            cleaned_up:
              type: boolean
              title: Cleaned up
              description: The herdr worktree has been torn down. Distinct from `closed`.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            base_branch:
              type: string
              title: Base branch
              description: Parent's branch, else the first project repo default_branch, else "main".
              required: false
              multiple: false
              computed: true
              readonly: true
            effective_env_vars:
              type: text
              title: Effective environment variables
              description: env_vars resolved along the parent chain (child wins).
              required: false
              multiple: false
              computed: true
              readonly: true
            sub_tickets:
              type: reference
              title: Sub-tickets
              description: Reverse reference; parent_id is the source of truth.
              required: false
              multiple: true
              reference: bb_ticket
              computed: true
              readonly: true
            runs:
              type: reference
              title: Runs
              description: Reverse reference; bb_run.ticket_id is the source of truth.
              required: false
              multiple: true
              reference: bb_run
              computed: true
              readonly: true
            derived_status:
              type: string
              title: Derived status
              description: idle | running | … — derived from the ticket's active runs.
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_reason:
              type: string
              title: Stall reason
              description: 'Why this ticket is standing still: frozen, blocked, no conductor, or failing. Empty for a moving or closed ticket.'
              required: false
              multiple: false
              computed: true
              readonly: true
            claim_machine:
              type: string
              title: Claim machine
              required: false
              multiple: false
              computed: true
              readonly: true
            since_label:
              type: string
              title: Since
              description: Humanised age of the current state, e.g. "3 minutes".
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_initials:
              type: string
              title: Assignee initials
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_name:
              type: string
              title: Assignee name
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_color:
              type: string
              title: Assignee colour
              required: false
              multiple: false
              computed: true
              readonly: true
            state_flow:
              type: string
              title: State flow
              description: Comma-separated states of the ticket's workflow, in order.
              required: false
              multiple: false
              computed: true
              readonly: true
            edit_url:
              type: url
              title: Edit URL
              required: false
              multiple: false
              computed: true
              readonly: true
            row_accent:
              type: string
              title: Row accent
              description: 'Computed, internal: the listing row''s accent rail, attention in the review phase, running while a conductor holds the ticket, otherwise none.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary:
              type: string
              title: Run summary
              description: 'Computed, internal: the run count and the latest run''s state, as the bb_run_summary formatter''s badge label ("5 runs · last running").'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_tone:
              type: string
              title: Run summary tone
              description: 'Design-only. Not a Drupal field: bb_run_summary keys the badge tone on the latest run''s state. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_suffix:
              type: string
              title: Run summary time
              description: 'Design-only. Not a Drupal field: bb_run_summary appends the latest run''s relative time. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_suffix:
              type: string
              title: Stall time
              description: 'Design-only. Not a Drupal field: bb_stall_reason appends how long a frozen ticket has been frozen. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            identifier_link:
              type: string
              title: Identifier link
              description: 'Design-only. Not a Drupal field: bb_ticket_identifier_cell renders `identifier` as a mono link to the ticket, while the compact row prints it plain. The value is the identifier; its `_formatted` companion carries the link.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_icon:
              type: string
              title: State icon
              description: 'Design-only. Not a Drupal field: bb_ticket_state_icon_cell draws the state as an icon labelled with the state (running phase full, otherwise faint). The value is the label; its `_formatted` companion carries the mark.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_label:
              type: string
              title: Priority label
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell labels the priority from its allowed values. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_tone:
              type: string
              title: Priority tone
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell marks the highest priority critical. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_name:
              type: string
              title: Owner name
              description: 'Design-only. Not a Drupal field: bb_ticket_owner_cell draws the owner as a person cell. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_initials:
              type: string
              title: Owner initials
              description: 'Design-only. Not a Drupal field: the owner''s person initials. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_color:
              type: string
              title: Owner colour
              description: 'Design-only. Not a Drupal field: the owner''s person colour. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field; sample data carries it as the record key.
            uuid: Entity key; the designbook model addresses records by `id`.
      bb_term:
        type:
          title: bakers.build ticket type
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        recipe:
          title: bakers.build recipe
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        label:
          title: bakers.build label
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
      bb_run:
        bb_run:
          title: bakers.build run
          view_modes:
            full:
              template: field-map
            overlay:
              template: field-map
            teaser:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: false
              multiple: false
              reference: bb_ticket
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
            state:
              type: string
              title: Run state
              required: true
              multiple: false
              settings:
                allowed_values:
                  - claimed
                  - running
                  - done
                  - expired
                  - failed
            claim_expires_at:
              type: datetime
              title: Claim expires at
              required: false
              multiple: false
            state_at_start:
              type: string
              title: Ticket state at start
              required: false
              multiple: false
            started_at:
              type: datetime
              title: Started at
              required: false
              multiple: false
            heartbeat:
              type: datetime
              title: Heartbeat
              required: false
              multiple: false
            worktree_path:
              type: string
              title: Worktree path
              required: false
              multiple: false
            log:
              type: text
              title: Log
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              description: The run's owning account — comes from the conductor, never the session.
              required: false
              multiple: false
              reference: user
            agent:
              type: string
              title: Agent
              required: false
              multiple: false
            harness:
              type: string
              title: Harness
              description: Id of the agent harness package that drove the session, e.g. claude or codex.
              required: false
              multiple: false
            model:
              type: string
              title: Model
              description: The candidate's configured model, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            model_version:
              type: string
              title: Model version
              description: The candidate's configured exact version, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            error_log:
              type: text
              title: Error log
              description: Cause of a terminal dispatch/setup failure (state `failed`).
              required: false
              multiple: false
            tokens:
              type: integer
              title: Tokens
              description: First of the six per-run footprint fields (BB-132), written by the run-owning conductor at close. Not the ticket's `time_spent`.
              required: false
              multiple: false
            duration_s:
              type: integer
              title: Duration in seconds
              required: false
              multiple: false
            agent_turns:
              type: integer
              title: Agent turns
              required: false
              multiple: false
            tool_calls:
              type: integer
              title: Tool calls
              required: false
              multiple: false
            user_prompts:
              type: integer
              title: User prompts
              required: false
              multiple: false
            user_prompt_words:
              type: integer
              title: User prompt words
              required: false
              multiple: false
            state_flow:
              type: string
              title: State flow
              required: false
              multiple: false
              computed: true
              readonly: true
            duration:
              type: string
              title: Duration
              description: Humanised closed_date − started_at, e.g. "1m 12s".
              required: false
              multiple: false
              computed: true
              readonly: true
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: 'Design-only. Not a Drupal field: the row reaches the ticket''s identifier through ticket_id, rendered by bb_ticket_identifier_cell as a mono link to the ticket. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_label:
              type: string
              title: State label
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell labels the run state from the bb_run workflow. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_tone:
              type: string
              title: State tone
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell keys the tone on the state (BbRun::STATE_MARKS). Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_environment:
        bb_environment:
          title: bakers.build environment
          purpose: A managed deployment target of a project — the thing a ship ticket stamps and a verification ticket verifies against.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            base_url:
              type: url
              title: Base URL
              required: false
              multiple: false
            tier:
              type: string
              title: Tier
              required: false
              multiple: false
              settings:
                allowed_values:
                  production: Production
                  staging: Staging
                  development: Development
                  other: Other
            branch:
              type: string
              title: Branch
              description: The git branch this environment deploys from.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      user:
        user:
          title: User
          purpose: A person or app account. Modelled as the entity type `user` with its single bundle, because that is what every reference in this model targets.
          view_modes:
            full:
              template: field-map
            compact:
              template: field-map
              label: Compact
          form_modes:
            default:
              template: field-map
          fields:
            user_picture:
              type: image
              title: Profile picture
              description: Core image field; also switches on social_auth's own avatar download at login (BB-507 D3).
              required: false
              multiple: false
            field_full_name:
              type: string
              title: Full name
              description: Additive (BB-507 D4) — does not replace or derive display_name.
              required: false
              multiple: false
            name:
              type: string
              title: Username
              required: true
              multiple: false
            mail:
              type: string
              title: Email
              required: false
              multiple: false
            status:
              type: boolean
              title: Active
              required: false
              multiple: false
            roles:
              type: string
              title: Roles
              description: Machine names, e.g. bb_session.
              required: false
              multiple: true
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            access:
              type: datetime
              title: Last access
              required: false
              multiple: false
            login:
              type: datetime
              title: Last login
              required: false
              multiple: false
            timezone:
              type: string
              title: Timezone
              required: false
              multiple: false
            display_name:
              type: string
              title: Display name
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the ticket and comment entities expose assignee_initials / author_initials instead. Present so an avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            pass: Authentication internal; no bakers.build screen renders or edits a password hash.
            init: Authentication internal (initial email); never rendered.
            preferred_langcode: Localisation internal; bakers.build is English-only.
            preferred_admin_langcode: Localisation internal; bakers.build is English-only.
            default_langcode: Entity key for translations; bakers.build users are single-language.
            changed: Drupal's user entity has no `changed` field; `access` and `login` carry recency.
      bb_profile:
        bb_profile:
          title: bakers.build profile
          purpose: 'What a person tells bakers.build about themselves, one per user and workspace (unique on uid + workspace_id): their position, their background handed to AI assistants as context, and their favorite projects. Replaces the user fields field_developer_title and field_bb_background. Edited on the Profile tab /user/{user}/profile for the workspace in context; the entity has no view display.'
          form_modes:
            default:
              template: field-map
          fields:
            uid:
              type: reference
              title: Owner
              required: true
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            position:
              type: string
              title: Position
              description: Free text, at most 255 characters; placeholder "e.g. Product Lead".
              required: false
              multiple: false
            background:
              type: text
              title: What should bakers.build know about your background?
              description: Optional long text (string_long) handed to AI assistants as context, e.g. "Drupal developer, confident with PHP; little DevOps experience."
              required: false
              multiple: false
            favorite_projects:
              type: reference
              title: Favorite projects
              description: Projects this person marked as favorite in this workspace; not on the form.
              required: false
              multiple: true
              reference: bb_project
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_workspace:
        bb_workspace:
          title: bakers.build workspace
          purpose: 'The tenancy root: the object that says this data belongs to operator X and not operator Y. It holds all people and decides WHICH RIGHTS an account holds — BB-462 makes the workspace the ONLY level that carries rights: admin/contributor/guest (D2). Visibility of a project is a separate, per-team question (D4) that carries no rights of its own. Is an OG group (registered in og.settings) with the roles non-member, member, contributor, lead (labelled "Admin") and guest — five, not six: `owner`/`admin` were already consolidated into `lead` by BB-359 D12, and the machine principal `app` is GONE (BB-462 D9, its rank is answered entirely from OAuth scope now). Built by BB-316; the role set is BB-462''s.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; shown under the workspace's name in the switcher panel and on the join screen, absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately and shown uncropped as the workspace's mark in the switcher and on the join screen; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The CONTRACT or SUBSCRIPTION this tenant is served under. Same field type and name as bb_group.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. There is no `contract` field and there will not be one — the billing profile IS the contract level.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_team:
        bb_team:
          title: bakers.build team
          purpose: 'The stable crew, cutting across customer projects, and since BB-419 also their structural parent: a project is assigned to teams n:m through bb_project.teams and belongs to at least one. BB-462 D4 REVERSES what this field used to say: the assignment now DECIDES VISIBILITY — an account sees exactly the projects of the teams it belongs to (or every project, if it holds the workspace admin tier) — while still granting no RIGHTS of its own; a team answers "what do you see", the workspace alone answers "what may you do" (D2/D3). Is an OG group (registered in og.settings) with the roles non-member, member, lead (BB-456 D9, team-scoped statistics visibility) and owner (BB-462 D3, manages the team itself — who may join it and its own settings). The implicit member rank stays empty by design: team membership is a visibility fact, not a rights tier.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            projects:
              type: reference
              title: Projects
              description: The projects assigned to this team. Derived from bb_project.teams and never stored here, so the two directions cannot disagree.
              required: false
              multiple: true
              reference: bb_project
              computed: true
              readonly: true
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
      og_membership:
        default:
          title: OG membership
          purpose: 'Membership is ONE mechanism, modelled once: a user x group row reused by workspace and team rather than re-invented per level. This is NOT a bakers.build invention — it is contrib Organic Groups'' own og_membership entity, whose only bundle is `default` (og.og_membership_type.default). BB-462 D7 REVERSES what this field used to say: og.settings now registers only bb_workspace and bb_team as OG groups — bb_project is deregistered entirely, and every membership row anchored on a project is deleted by that ticket''s migration. BB-318 bridges the remaining rows into bakers.build''s query access. A screen reads membership here, never from a field on the group.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            type:
              type: string
              title: Membership type
              description: OG's bundle key — in code an entity reference to the og_membership_type config entity. Modelled as its value set rather than as a reference because bakers.build ships exactly one instance, og.og_membership_type.default, and no screen renders or chooses it.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - default
            uid:
              type: reference
              title: User
              description: The member. OG's own field name — not `user_id`.
              required: true
              multiple: false
              reference: user
            entity_type:
              type: string
              title: Group entity type
              description: Which level this membership is in. A workspace or project membership grants rights; a team membership does not, because the team carries no permissions.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            entity_bundle:
              type: string
              title: Group bundle
              description: Bundle of the group entity. Each of the three types has one bundle of its own name.
              required: false
              multiple: false
            entity_id:
              type: string
              title: Group entity ID
              description: Id of the group named by entity_type. A plain STRING in OG, not a reference, because the target entity type varies per row — so no screen can rely on an entity-reference widget here.
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: Defaults to active. Only an active membership grants what its roles carry.
              required: true
              multiple: false
              settings:
                allowed_values:
                  - active
                  - pending
                  - blocked
            roles:
              type: reference
              title: Roles
              description: 'MULTI-VALUE (OG sets cardinality unlimited) and a reference to og_role config objects by their full id, e.g. bb_workspace-bb_workspace-lead. The `member` role is never stored: OgMembership::preSave() revokes it and getRoles() prepends it on read, so a row that looks role-less is still a member.'
              required: false
              multiple: true
              reference: og_role
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            language: Entity key; bakers.build memberships are single-language and no screen renders a language.
      bb_addon:
        bb_addon:
          title: bakers.build addon
          purpose: An addon definition at one version (name@version), registered by the conductors that run it. Entity access is admin-only; workspace leads see the addons in the workspace Settings › Addons tab, one row per name at its newest version with all its versions and the conductors of the current workspace that run each version. The definition is immutable once registered and may carry an inline SVG icon. Read-only on every screen.
          view_modes:
            list_item:
              template: field-map
              label: List item
          fields:
            name:
              type: string
              title: Name
              description: Machine name of the addon, e.g. ports. Together with version it forms the name@version key.
              required: true
              multiple: false
            version:
              type: string
              title: Version
              description: Semantic version string, e.g. 1.2.3.
              required: true
              multiple: false
            contract:
              type: integer
              title: Contract
              description: Version of the addon definition contract the addon implements, e.g. 1.
              required: true
              multiple: false
            definition:
              type: text
              title: Definition
              description: 'Immutable JSON addon definition: label, views, actions and an optional inline SVG icon. The Settings › Addons tab shows only its label and icon.'
              required: true
              multiple: false
            conductors:
              type: reference
              title: Conductors
              description: Conductors that registered (run) this addon version.
              required: false
              multiple: true
              reference: bb_conductor
              settings:
                target_type: bb_conductor
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            label:
              type: string
              title: Label
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter prints the definition''s label. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            versions_label:
              type: string
              title: Versions
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter lists every version of the name once, newest first. Present so the Versions cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter draws the initials of the label. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter keys the avatar colour on the addon id. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_badges:
              type: string
              title: Conductors
              description: 'Design-only. Not a Drupal field: the bb_addon_conductors formatter renders `conductors` as one dotted badge per conductor and version ("<conductor> <version>", running when online, offline otherwise), or "No conductor in this workspace". The value lists the badges as text; its `_formatted` companion carries the rendered badges.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter turns the definition''s inline SVG icon into a data URI; empty for initials. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
    config:
      image_style:
        avatar:
          aspect_ratio: '1:1'
      omitted:
        bb_core.bb_vocabulary: The vocabulary IS the bb_term bundle; no screen renders it as an object of its own.
        view.environments: Drupal has no environments View, and no list of environments exists yet. The bb_project environments field is hidden on the project full display; only its referenced names show on the project properties detail card (BbEntityDetailCardForm). Ship tickets show their environments as chips in the ticket inspector. The view.environments mapping is ahead of the backend and has no Drupal counterpart.
      og_role:
        og_role:
          title: OG role
          purpose: 'The role vocabulary of the OG groups — what a Settings screen assigns a person on a workspace or a team. Contrib Organic Groups'' own config entity. AS-IS, MEASURED IN config/sync AT BB-462: NINE objects, not ten — bb_project carries no role at all any more (D7 deregisters it as an OG group entirely). Five for bb_workspace (non-member, member, contributor, lead, guest) and four for bb_team (non-member, member, lead, owner). `app` is GONE (D9: a conductor''s OAuth identity is bound to its owning user, so it sees exactly what that user''s own rank sees — no separate machine rank exists to list here). `owner` is NEW (D3): governs the team itself, who may join it and its own settings. The key is the Drupal config-name PREFIX, so this is one entry per config entity TYPE; the instances live in sample data. Three facts a screen must not get wrong. First, `permissions` is NOT an empty list on every role: bb_workspace-lead and -contributor carry real permission strings (create/edit/delete rights), bb_workspace-guest carries read-only, and bb_team-owner carries `manage members`/`update group`. It IS empty on exactly four: the three non-member roles and bb_team-bb_team-member — the implicit member rank is deliberately emptied everywhere (D1: OG ranks are additive and cannot be narrowed, so any right left on an implicit rank is inherited by every membership including guests). Second, `is_admin` is FALSE on all nine. Third, "a workspace admin sees every project of their workspace" (D4) is a VISIBILITY rule computed from the rank id, never an OG admin flag or a project-level role — there is no project-level role left to read at all. TARGET: product roles are OG ranks only; team ownership is the one new rank this ticket adds.'
          fields:
            id:
              type: string
              title: Machine name
              description: Composed as <group_type>-<group_bundle>-<role name>, e.g. bb_workspace-bb_workspace-lead. This full id is what og_membership.roles references.
              required: true
              multiple: false
            label:
              type: string
              title: Label
              description: The human name a Settings screen shows, e.g. "Administrator".
              required: true
              multiple: false
            weight:
              type: integer
              title: Weight
              description: Display order within a group type; 0 for non-member, rising to 5 for the workspace app role.
              required: false
              multiple: false
            is_admin:
              type: boolean
              title: Is admin
              description: FALSE on every shipped role — measured in config/sync at BB-435 across all ten og.og_role objects, and the role it used to name does not exist. Read the role id, never this flag. See the purpose above.
              required: false
              multiple: false
            permissions:
              type: string
              title: Permissions
              description: OG permission strings. Empty in exactly four of the ten shipped roles — the three non-member roles and bb_team-bb_team-member — see the purpose above before designing anything that edits this.
              required: false
              multiple: true
            group_type:
              type: string
              title: Group entity type
              required: true
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            group_bundle:
              type: string
              title: Group bundle
              required: true
              multiple: false
            role_type:
              type: string
              title: Role type
              description: '`required` for the two roles OG creates for every group (non-member, member); `standard` for the roles bakers.build adds. A screen must not offer to delete a required role.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - required
                  - standard
          omitted:
            uuid: Config entities carry a uuid that is not part of the modelled key set and is never rendered.
            group_id: Null in all ten shipped roles. OG sets it only for a role scoped to one single group instance, which bakers.build ships none of, so no screen renders it.
      view:
        addons:
          title: Addons
          purpose: Lists every registered addon once, at its newest version, with the conductors of the routed workspace that run any of its versions.
          base_table: bb_addon
          items_per_page: 50
          columns:
            - icon
            - label
            - name
            - versions
            - contract
            - conductors
          displays:
            default:
              plugin: default
            settings:
              plugin: page
              path: /_workspace/%bb_workspace/settings/addons
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_addon records the View lists; Drupal renders each row as the addon in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_addon
                  bundle: bb_addon
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        conductors:
          title: Conductors
          purpose: |-
            Two listings of bb_conductor. The user-area rail item (user_list) is the
            conductors assigned to the account in the URL, any workspace. The project
            tab (project_list) is that project's conductors, any owner. Both walk
            project_id then group_id because bb_conductor carries no workspace field
            of its own. Both joins are INNER: a conductor whose project or group is
            gone has no workspace to be listed under.
          base_table: bb_conductor
          items_per_page: 50
          columns:
            - conductor_id
            - label
            - status
            - reported_load
            - owner_user_id
            - last_seen
          displays:
            default:
              plugin: default
            project_list:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/conductors
            user_list:
              plugin: page
              path: /user/%user/conductors
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_conductor records the View lists; Drupal renders each row as the conductor in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_conductor
                  bundle: bb_conductor
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        conductor_tickets:
          title: Conductor tickets
          purpose: |-
            Tickets occupying one conductor. The occupancy source supplies explicit
            numeric ticket ids; this view never lists by ticket conductor_id and has
            no page route.
          base_table: bb_ticket
          columns:
            - identifier
            - title
          displays:
            default:
              plugin: default
            occupancy:
              plugin: embed
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item_compact` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item_compact
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        groups:
          title: Groups
          purpose: Lists the groups of the routed workspace. The Groups page owns the create-group action. A group organizes customer and cost-centre data; it grants no permissions.
          base_table: bb_group
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - description
            - projects
            - changed
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/groups
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_group records the View lists; Drupal renders each row as the group in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_group
                  bundle: bb_group
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        machines:
          title: Machines
          purpose: |-
            The user-area rail item (user_list) is the machines assigned to the
            account in the URL, any workspace.
          base_table: bb_machine
          items_per_page: 50
          columns:
            - name
            - max_parallel
            - current_load
            - owner_user_id
            - last_run
          displays:
            default:
              plugin: default
            user_list:
              plugin: page
              path: /user/%user/machines
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_machine records the View lists; Drupal renders each row as the machine in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_machine
                  bundle: bb_machine
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        project_board:
          title: Project board
          purpose: |-
            Four-column project board of bb_ticket on the tickets Search API
            index. The page display owns the route. Each lifecycle column is a
            bb_board_column attachment with its own mini pager. Column membership is the indexed work_state value.
            Parent focus applies to every display; the page header summarizes the whole matching selection.
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - identifier
          displays:
            default:
              plugin: default
            backlog:
              plugin: bb_board_column
            done:
              plugin: bb_board_column
            intake:
              plugin: bb_board_column
            project_board:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/board
            working:
              plugin: bb_board_column
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row with the `fields` row plugin.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: default
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
        projects:
          title: Projects
          purpose: |-
            The projects of the workspace named in the URL, five columns. A LISTING IS A
            VIEW: the row this replaced was a bb_project.bb_project.teaser view mode,
            and BB-389 removed it because a list row was never a view mode.

            THE ROWS COME FROM THE URL, and that is this view's own argument rather than the
            query-access layer's doing. BbWorkspaceReadScope resolves an ACCOUNT's scope —
            the union of every OG membership, with no workspace parameter — so for a user
            who belongs to several workspaces it admits more rows than the URL asked for.
            The `workspace_id` argument narrows to the one workspace, walking the group_id
            relationship because bb_project carries no workspace field of its own. Its
            `default_action` is `access denied` rather than a fallback to all: a view that
            listed every workspace the moment a route stopped supplying the parameter is how
            ambient scoping turns into a disclosure. Query access stays the floor
            underneath — the two layers answer two different questions.

            THE TWO RELATIONSHIPS DISAGREE ABOUT `required` ON PURPOSE. owner_user_id is a
            LEFT JOIN, and the reason stated here used to be that BbProject::owner_user_id
            is not setRequired(TRUE). That is now FALSE — the field has carried
            setRequired(TRUE) since 66780aa93 — and the LEFT JOIN is still right, so only
            the rationale is corrected. setRequired() is a VALIDATION constraint on a write
            to the project; it is not delete protection on the account referenced. bb_core
            guards that nowhere — no preDelete, no cascade, no reference constraint — so a
            stored project can still be left pointing at a deleted user, and an inner join
            on it drops the whole project from this listing the moment that happens: no
            message, no empty cell, no row. group_id stays an INNER JOIN, and for a positive
            reason rather than the same one: it carries the workspace argument, so a project
            whose group is gone has no workspace to be listed under, and the honest answer
            is no workspace rather than every workspace. That the referenced rows can vanish
            at all is a data-integrity gap, not this listing's to paper over.

            TWO DESIGNED COLUMNS ARE ABSENT, NAMED HERE RATHER THAN LEFT TO AN EMPTY SPACE.
            Teams is absent, and the reason stated here used to be that bb_project carries
            no `teams` field at all. That is now FALSE, in the same way the owner_user_id
            sentence above was: BB-419 added `teams` as a required, unlimited-cardinality
            entity_reference (BbProject.php), so the n:m assignment DOES exist and the
            cancelled BB-356 no longer describes the state of the field. What is true is
            that this listing still renders no teams column, and no decision has been
            recorded that it should not — so this is an open question about the listing
            rather than a structural impossibility, and it is named as one here instead of
            being justified by a field that is gone from the reasoning. Environments is
            absent for a reason that does still hold: it is a COUNT over a multi-value
            entity reference and core views has no field for that; a column showing the
            first referenced environment instead of the count would be a different and
            wrong value.

            IT COMPOSES A CANVAS WHOSE HEADING LIVES IN THE SHELL. The screen title,
            tabs and New-project action are the `page_header` island on
            `island.profile.bb_shell`. This display's tree is `bb_theme:canvas`
            with a `bb_theme:zone` in `main` wrapping `view_rows` plus `view_pager`.
            The `empty` area is untouched, because ui_patterns' own `view_rows` source
            renders a view's empty areas when it has no rows.

            THE ROWS ARE STILL CORE'S `table` WITH `row: type: fields`, AND NOT FOR THE
            REASON D1 GAVE. D1 priced the alternative as a bespoke ui_patterns Source, and that
            is not what it costs: a PRESENTER TEMPLATE — a markup-free template that
            transforms what views handed it and include()s the component, reached by core's
            own theme suggestion (ViewExecutable::buildThemeFunctions() emits
            views_view_table__projects) — needs no plugin and would leave this file exactly
            as it is. What IS true is that site building cannot do it: `rows` is a PROP
            holding an array of objects, and no shipped ui_patterns source serves such a
            prop type — ui_patterns_views's view_rows declares `prop_types: [slot]`, and
            across all 22 shipped sources the prop types are attributes, boolean, enum,
            enum_list, enum_set, identifier, links, list, number, slot, string, url and
            variant. That absence is the condition under which a presenter is the right
            answer rather than a trick. BB-413 owns that template; when it lands this
            listing renders through bb_theme:table with no change here.
          base_table: bb_project
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - key
            - description
            - open_tickets
            - conductor_tickets
            - closed_tickets
            - created
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/projects
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_project records the View lists; Drupal renders each row as the project in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_project
                  bundle: bb_project
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        runs:
          title: Runs
          base_table: search_api_index_bb_runs
          items_per_page: 10
          columns:
            - identifier
            - state
            - state_at_start
            - conductor_id
            - agent
            - started_at
            - duration_s
          displays:
            default:
              plugin: default
            project_runs:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/runs
            team_runs:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/runs
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_run records the View lists; Drupal renders each row as the run in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_run
                  bundle: bb_run
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
        tickets:
          title: Tickets
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - state
            - title
            - priority
            - identifier
            - created
            - owner
            - conductor
            - stall_reason
            - run_count
            - assignee
          displays:
            default:
              plugin: default
            my_work:
              plugin: page
              path: /_workspace/%bb_workspace/tickets
            page_1:
              plugin: page
              path: /_workspace/%bb_workspace/tickets/all
            project_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/tickets
            team_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/tickets
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
  component: bb_theme:list_item
  bindings:
    - field: row_accent
      prop: accent
    - field: state_icon
      slot: avatar
      wrap:
        component: bb_theme:list_cell
        props:
          key: state
        slot: value
    - field: title
      slot: headline
      wrap:
        component: bb_theme:list_cell
        props:
          key: title
          primary: true
        slot: value
    - field: priority_label
      slot: headline
      wrap:
        component: bb_theme:list_cell
        props:
          key: priority
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone:
              field: priority_tone
          prop: label
    - field: identifier_link
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: identifier
        slot: value
    - field: created
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: created
          caption: Created
        slot: value
    - field: owner_name
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: owner
          caption: by
        slot: value
        wrap:
          component: bb_theme:person
          props:
            variant: compact
            size: sm
            initials:
              field: owner_initials
            color:
              field: owner_color
          prop: display_name
    - field: conductor_label
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: conductor
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone: lease
            mono: true
            icon: lock
            mine:
              field: conductor_mine
          prop: label
    - field: stall_reason
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: stall_reason
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone: wait
            dot: true
            suffix:
              field: stall_suffix
          prop: label
    - field: run_summary
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: run_summary
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone:
              field: run_summary_tone
            icon: run
            suffix:
              field: run_summary_suffix
          prop: label
    - field: assignee_initials
      slot: right
      wrap:
        component: bb_theme:list_cell
        props:
          key: assignee
          fallback: —
          align: end
        slot: value
        wrap:
          component: bb_theme:person
          props:
            variant: compact
            size: sm
            display_name: ''
            color:
              field: assignee_color
          prop: initials
  ```

  #### Contract
  ```yaml
  outputs:
    entity-mapping:
      required: true
      schema: {}
      submission: data
      validators:
        - entity-mapping
      path: /var/www/html/web/themes/custom/bb_theme/designbook/entity-mapping/bb_ticket.bb_ticket.list_item.jsonata
      glob: /var/www/html/web/themes/custom/bb_theme/designbook/*/*.*.*.jsonata
  ```

  #### Results
  <!-- done -->

- [x] map-entity--design-screen — bb_ticket.list_item_mine

  Instruction: task:map-entity--design-screen

  #### Params
  ```yaml
  mapping:
    entity_type: bb_ticket
    bundle: bb_ticket
    mode_kind: view
    view_mode: list_item_mine
  data_model:
    content:
      bb_project:
        bb_project:
          title: bakers.build project
          purpose: 'The work unit: key, next_number, repository, environments. BB-462 D7 REVERSES what this field used to say: the project carries NO membership or role of its own any more — it is deregistered from og.settings entirely, and its three roles (non-member, member, lead) are deleted from both config paths. Visibility now comes from bb_project.teams (D4): a project is visible to the members of a team it names, or to a workspace admin. The two levels that grant rights are the workspace (create/edit/delete rights, via bb_workspace-bb_workspace-{contributor,lead}) and, per-project, its teams (visibility only — a team carries no rights of its own, BB-462 D3). A screen must not offer a permission control on the project.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            epics:
              template: field-map
              label: Epics
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            group_id:
              type: reference
              title: Group
              required: true
              multiple: false
              reference: bb_group
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under project-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            repository:
              type: object
              title: Repository
              description: 'The project repository (URL, default branch, branch naming convention). Single-valued: a project has at most one repository.'
              required: false
              multiple: false
              settings:
                properties:
                  url: string
                  default_branch: string
                  branch_convention: string
            coder_config:
              type: object
              title: Coder config
              required: false
              multiple: false
            env_vars:
              type: text
              title: Environment variables
              description: Project defaults supplied to hooks and the agent on every run, as .env-style KEY=value lines. A parent ticket and the ticket itself override a key set here. Readable by anyone who can view this project.
              required: false
              multiple: false
            teams:
              type: reference
              title: Teams
              description: 'The teams this project belongs to. A project belongs to AT LEAST ONE team, so the field is required and multi-valued. The assignment is STRUCTURE and confers no rights: it makes the team the project''s structural parent, and team membership is not a source of ticket visibility. Visibility stays at direct project membership or workspace see-all (BB-419, which deliberately left BbWorkspaceReadScope untouched).'
              required: true
              multiple: true
              reference: bb_team
            key:
              type: string
              title: Identifier prefix
              description: Ticket identifier prefix, e.g. BB in BB-328. A change applies only to tickets created afterwards.
              required: false
              multiple: false
            next_number:
              type: integer
              title: Next number
              description: Next per-project ticket number; floors to max(number)+1 on allocation.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            environments:
              type: reference
              title: Environments
              description: Managed environments belonging to this project.
              required: false
              multiple: true
              reference: bb_environment
              computed: true
              readonly: true
            open_tickets:
              type: integer
              title: Open tickets
              description: 'Computed, internal: the project''s tickets not yet closed. The listing row shows it as a ticket badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_tickets:
              type: integer
              title: Conductor tickets
              description: 'Computed, internal: the project''s tickets a conductor currently holds. The listing row shows it as a conductor badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            closed_tickets:
              type: integer
              title: Closed tickets
              description: 'Computed, internal: the project''s closed tickets. The listing row shows it as a check badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the project id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              description: Free text, not an enum (BB-227). Values in use include comment, qualification, spec, test and acceptance, so a screen must render an unknown value rather than assume a closed set.
              required: true
              multiple: false
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
        review:
          title: bakers.build review comment
          purpose: A private review of a ticket. Drafts stay with the assigned author; submitted reviews wait for the current assignee; accepted reviews publish into the ordinary comment timeline. Rejected reviews stay unpublished. The Boolean published flag is server-owned.
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              required: true
              multiple: false
            status:
              type: boolean
              title: Published
              required: false
              multiple: false
            review_state:
              type: string
              title: Review state
              required: false
              multiple: false
              settings:
                allowed_values:
                  draft: Draft
                  submitted: Submitted
                  accepted: Accepted
                  rejected: Rejected
            submitted_at:
              type: datetime
              title: Submitted at
              required: false
              multiple: false
            decided_at:
              type: datetime
              title: Decided at
              required: false
              multiple: false
            decided_by:
              type: reference
              title: Decided by
              required: false
              multiple: false
              reference: user
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_activity:
        bb_activity:
          title: bakers.build activity
          purpose: 'One persisted ticket event per row: `created` when a ticket is created, `status_changed` per state change (with the step''s summary comment, and with the run it closed and that run''s conductor when an agent did the work), `claimed` only for the first run outside qualification, and `run_ended` when a run ends failed, expired or cancelled without moving the ticket. Writes come only from the bb_activity kinds, called where the change happens. Each row is this bundle''s `full` view mode (`bb_theme:event` with a structured lead); there is no second activity view mode.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            kind:
              type: string
              title: Kind
              description: '`created`, `status_changed`, `claimed` or `run_ended`. Tags: created, status, started (claimed) and the run outcome for run_ended.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - created
                  - status_changed
                  - claimed
                  - run_ended
            actor:
              type: reference
              title: Actor
              required: false
              multiple: false
              reference: user
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
            previous_state:
              type: string
              title: Previous state
              required: false
              multiple: false
            new_state:
              type: string
              title: New state
              required: false
              multiple: false
            step:
              type: string
              title: Step
              description: The run's state_at_start for claimed and run_ended rows. Unused for created and status rows.
              required: false
              multiple: false
            run_id:
              type: reference
              title: Run
              required: false
              multiple: false
              reference: bb_run
              description: The run a claimed or run_ended row reports, or the run a status change closed. Empty for created rows and human status changes; its presence makes the row an agent row.
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
              description: The conductor of the referenced run.
            comment_id:
              type: reference
              title: Summary comment
              description: The ticket's summary comment published since the ticket entered the state a status row leaves. Empty when none.
              required: false
              multiple: false
              reference: bb_comment
            claim_key:
              type: string
              title: Claim key
              required: false
              multiple: false
              description: The claimed run's UUID; unique, guards a second claimed row for the same run. NULL on other kinds.
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: Computed from ticket_id.identifier so the event body can name the ticket without the mapping joining collections.
              required: false
              multiple: false
              computed: true
              readonly: true
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
              description: The run's model (else harness, else agent) on rows with a viewable run; otherwise the actor's display name.
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: Computed from conductor_id.label.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_harness:
              type: string
              title: Run harness
              description: Computed from run_id.harness; shown beside the model on agent rows.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_duration:
              type: string
              title: Run duration
              description: Computed from run_id duration_s (or started_at to the row time), formatted.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_outcome:
              type: string
              title: Run outcome
              description: 'Computed from run_id.state on run_ended rows: failed, expired or cancelled.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_error_line:
              type: string
              title: Run error line
              description: Computed first non-empty line of a failed run's error log.
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            changed: Activity rows are immutable; nothing writes a changed stamp.
      bb_conductor:
        bb_conductor:
          title: bakers.build conductor
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_user:
              template: field-map
              label: List item (user)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            machine_id:
              type: string
              title: Machine ID
              required: true
              multiple: false
            label:
              type: string
              title: Label
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            status:
              type: string
              title: Status
              required: false
              multiple: false
              settings:
                allowed_values:
                  online: Online
                  offline: Offline
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            states:
              type: string
              title: States
              description: The claimable ticket states this conductor picks up.
              required: false
              multiple: true
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
            workspace_root:
              type: string
              title: Workspace root
              required: false
              multiple: false
            active:
              type: boolean
              title: Active
              description: Whether the conductor may be assigned and claim work; separate from online/offline status.
              required: false
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              required: false
              multiple: false
            last_seen:
              type: datetime
              title: Last seen
              required: false
              multiple: false
            lease_expires_at:
              type: datetime
              title: Lease expires at
              required: false
              multiple: false
            conductor_name:
              type: string
              title: Conductor name
              description: The config-file stem `--conductor <name>` selects.
              required: false
              multiple: false
            last_pid:
              type: integer
              title: Last PID
              description: Reported by the serve loop that owns the process; used by a verified stop.
              required: false
              multiple: false
            node_status:
              type: string
              title: Node status
              description: running | stale | offline — the shared liveness vocabulary.
              required: false
              multiple: false
              computed: true
              readonly: true
            node_states_label:
              type: string
              title: Claimed states
              required: false
              multiple: false
              computed: true
              readonly: true
            node_load_label:
              type: string
              title: Load
              required: false
              multiple: false
              computed: true
              readonly: true
            last_seen_label:
              type: string
              title: Last seen
              required: false
              multiple: false
              computed: true
              readonly: true
            reported_load:
              type: integer
              title: Reported load
              description: The load the conductor reported on its last poll. The listing row shows it as a run badge.
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_label:
              type: string
              title: Owner
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the owner''s display name. Present so the row has a value for the Owner cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            project_label:
              type: string
              title: Project
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the project''s name. Present so the user listing''s row has a value for the Project cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_label:
              type: string
              title: Status label
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter labels the status from its allowed values. Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_tone:
              type: string
              title: Status tone
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter keys the tone on the status (online running, offline offline). Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_machine:
        bb_machine:
          title: bakers.build machine
          purpose: 'Host capacity for concurrent runs, owned by one user account. Capacity (max_parallel / current_load) belongs to the machine, not to each per-project conductor; a conductor links its machine. host_key is the machine-context stem, not the composed conductor registration key. Machines are not in the workspace read scope: the owner sees them under the account Machines listing, and the full view is the machine page /user/{user}/machine/{bb_machine}.'
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            host_key:
              type: string
              title: Host key
              description: Machine-context machine_id stem, unique per machine.
              required: true
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              description: Concurrent runs this machine accepts; default 5.
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              description: Runs currently claimed on this machine; default 0.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
              settings:
                target_type: user
            owner_label:
              type: string
              title: Owner label
              description: Display name of the owner, read through owner_user_id; the machine page shows it.
              required: false
              multiple: false
              computed: true
              readonly: true
            last_run:
              type: datetime
              title: Last run
              description: 'Computed, internal: when the machine last started a run. The listing row shows it relative, captioned "Last run".'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_group:
        bb_group:
          title: bakers.build group
          purpose: The customer. Bundles projects and carries the cost centre for re-invoicing. Carries NO permissions and is NOT an OG group — og.settings registers only bb_workspace and bb_team since BB-462 D7 deregisters bb_project — it is not a rights level, so no screen may offer a permission control on it.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under group-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The customer COST CENTRE for re-invoicing. Same field type and name as bb_workspace.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. Both exist; neither replaces the other.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              description: The tenant this customer belongs to. Built by BB-316; on feat/bb-315-multi-workspace, not yet on develop.
              required: false
              multiple: false
              reference: bb_workspace
            projects:
              type: integer
              title: Projects
              description: 'Computed, internal: the number of the group''s projects the reader may view. The listing row shows it as a project badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the group id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_ticket:
        bb_ticket:
          title: bakers.build ticket
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_mine:
              template: field-map
              label: List item (my work)
            list_item_compact:
              template: field-map
              label: List item (compact)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            project_id:
              type: reference
              title: Project
              required: false
              multiple: false
              reference: bb_project
            identifier:
              type: string
              title: Identifier
              required: true
              multiple: false
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_work
            title:
              type: string
              title: Title
              required: true
              multiple: false
            description:
              type: text
              title: Description
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: One of the ticket's workflow states; which subset applies is decided by `workflow`. `human_input` is not a state.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
                  - done
                  - cancelled
            ticket_type:
              type: reference
              title: Type
              description: The ticket's type term (vocabulary `type`). A ticket whose type term is named `epic` is an epic.
              required: false
              multiple: false
              reference: bb_term
            recipe:
              type: reference
              title: Recipe
              description: The ticket's recipe term (vocabulary `recipe`).
              required: false
              multiple: false
              reference: bb_term
            labels:
              type: reference
              title: Labels
              required: false
              multiple: true
              reference: bb_term
              description: The ticket's label terms (vocabulary `label`).
            assignee_user_id:
              type: reference
              title: Assignee user
              required: false
              multiple: false
              reference: user
            reviewers:
              type: reference
              title: Reviewers
              required: false
              multiple: true
              reference: user
            priority:
              type: integer
              title: Priority
              required: false
              multiple: false
              settings:
                allowed_values:
                  '1': High
                  '2': Medium
                  '3': Low
            parent_id:
              type: reference
              title: Parent ticket
              required: false
              multiple: false
              reference: bb_ticket
            blocked_by:
              type: reference
              title: Blocked by
              required: false
              multiple: true
              reference: bb_ticket
            origin:
              type: string
              title: Origin URL
              required: false
              multiple: false
            links:
              type: link
              title: Links
              description: Typed links (uri, title, options.bakers.kind); kind is server-derived.
              required: false
              multiple: true
            comments:
              type: reference
              title: Comments
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            pending_reviews:
              type: reference
              title: Pending reviews
              description: Submitted reviews awaiting a decision by the current assignee (computed; never writable). Private; not part of the ordinary comment timeline.
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            branch_name:
              type: string
              title: Branch name
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            frozen:
              type: boolean
              title: Frozen
              description: Operator hold. A frozen ticket is not claimable; an active run is left running.
              required: false
              multiple: false
            frozen_at:
              type: datetime
              title: Frozen at
              description: When the operator hold started. Server-stamped, cleared on unfreeze.
              required: false
              multiple: false
              readonly: true
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            number:
              type: integer
              title: Number
              description: Per-project running number, allocated once on first save and frozen.
              required: false
              multiple: false
              readonly: true
            conductor_id:
              type: reference
              title: Conductor
              description: Assigning a conductor is what starts a run.
              required: false
              multiple: false
              reference: bb_conductor
            time_estimate:
              type: integer
              title: Estimated time
              description: Estimated effort in SECONDS, proposed at qualification, confirmed by a human.
              required: false
              multiple: false
            time_spent:
              type: integer
              title: Spent time
              description: Accounted effort in SECONDS, proposed at review, confirmed by a human.
              required: false
              multiple: false
            referenced_tickets:
              type: reference
              title: Referenced tickets
              description: Tickets carried by this deployment (the release batch).
              required: false
              multiple: true
              reference: bb_ticket
            environments:
              type: reference
              title: Environments
              description: The managed environments this ticket concerns.
              required: false
              multiple: true
              reference: bb_environment
            env_vars:
              type: text
              title: Environment variables
              description: .env-style KEY=value lines. Inherited by sub-tickets. Readable by anyone who can view this ticket.
              required: false
              multiple: false
            metrics:
              type: object
              title: Metrics
              description: Named success metrics for this ticket.
              required: false
              multiple: true
              settings:
                properties:
                  name: string
                  value: string
                  unit: string
                  recorded: datetime
            cleaned_up:
              type: boolean
              title: Cleaned up
              description: The herdr worktree has been torn down. Distinct from `closed`.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            base_branch:
              type: string
              title: Base branch
              description: Parent's branch, else the first project repo default_branch, else "main".
              required: false
              multiple: false
              computed: true
              readonly: true
            effective_env_vars:
              type: text
              title: Effective environment variables
              description: env_vars resolved along the parent chain (child wins).
              required: false
              multiple: false
              computed: true
              readonly: true
            sub_tickets:
              type: reference
              title: Sub-tickets
              description: Reverse reference; parent_id is the source of truth.
              required: false
              multiple: true
              reference: bb_ticket
              computed: true
              readonly: true
            runs:
              type: reference
              title: Runs
              description: Reverse reference; bb_run.ticket_id is the source of truth.
              required: false
              multiple: true
              reference: bb_run
              computed: true
              readonly: true
            derived_status:
              type: string
              title: Derived status
              description: idle | running | … — derived from the ticket's active runs.
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_reason:
              type: string
              title: Stall reason
              description: 'Why this ticket is standing still: frozen, blocked, no conductor, or failing. Empty for a moving or closed ticket.'
              required: false
              multiple: false
              computed: true
              readonly: true
            claim_machine:
              type: string
              title: Claim machine
              required: false
              multiple: false
              computed: true
              readonly: true
            since_label:
              type: string
              title: Since
              description: Humanised age of the current state, e.g. "3 minutes".
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_initials:
              type: string
              title: Assignee initials
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_name:
              type: string
              title: Assignee name
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_color:
              type: string
              title: Assignee colour
              required: false
              multiple: false
              computed: true
              readonly: true
            state_flow:
              type: string
              title: State flow
              description: Comma-separated states of the ticket's workflow, in order.
              required: false
              multiple: false
              computed: true
              readonly: true
            edit_url:
              type: url
              title: Edit URL
              required: false
              multiple: false
              computed: true
              readonly: true
            row_accent:
              type: string
              title: Row accent
              description: 'Computed, internal: the listing row''s accent rail, attention in the review phase, running while a conductor holds the ticket, otherwise none.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary:
              type: string
              title: Run summary
              description: 'Computed, internal: the run count and the latest run''s state, as the bb_run_summary formatter''s badge label ("5 runs · last running").'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_tone:
              type: string
              title: Run summary tone
              description: 'Design-only. Not a Drupal field: bb_run_summary keys the badge tone on the latest run''s state. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_suffix:
              type: string
              title: Run summary time
              description: 'Design-only. Not a Drupal field: bb_run_summary appends the latest run''s relative time. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_suffix:
              type: string
              title: Stall time
              description: 'Design-only. Not a Drupal field: bb_stall_reason appends how long a frozen ticket has been frozen. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            identifier_link:
              type: string
              title: Identifier link
              description: 'Design-only. Not a Drupal field: bb_ticket_identifier_cell renders `identifier` as a mono link to the ticket, while the compact row prints it plain. The value is the identifier; its `_formatted` companion carries the link.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_icon:
              type: string
              title: State icon
              description: 'Design-only. Not a Drupal field: bb_ticket_state_icon_cell draws the state as an icon labelled with the state (running phase full, otherwise faint). The value is the label; its `_formatted` companion carries the mark.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_label:
              type: string
              title: Priority label
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell labels the priority from its allowed values. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_tone:
              type: string
              title: Priority tone
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell marks the highest priority critical. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_name:
              type: string
              title: Owner name
              description: 'Design-only. Not a Drupal field: bb_ticket_owner_cell draws the owner as a person cell. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_initials:
              type: string
              title: Owner initials
              description: 'Design-only. Not a Drupal field: the owner''s person initials. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_color:
              type: string
              title: Owner colour
              description: 'Design-only. Not a Drupal field: the owner''s person colour. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field; sample data carries it as the record key.
            uuid: Entity key; the designbook model addresses records by `id`.
      bb_term:
        type:
          title: bakers.build ticket type
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        recipe:
          title: bakers.build recipe
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        label:
          title: bakers.build label
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
      bb_run:
        bb_run:
          title: bakers.build run
          view_modes:
            full:
              template: field-map
            overlay:
              template: field-map
            teaser:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: false
              multiple: false
              reference: bb_ticket
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
            state:
              type: string
              title: Run state
              required: true
              multiple: false
              settings:
                allowed_values:
                  - claimed
                  - running
                  - done
                  - expired
                  - failed
            claim_expires_at:
              type: datetime
              title: Claim expires at
              required: false
              multiple: false
            state_at_start:
              type: string
              title: Ticket state at start
              required: false
              multiple: false
            started_at:
              type: datetime
              title: Started at
              required: false
              multiple: false
            heartbeat:
              type: datetime
              title: Heartbeat
              required: false
              multiple: false
            worktree_path:
              type: string
              title: Worktree path
              required: false
              multiple: false
            log:
              type: text
              title: Log
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              description: The run's owning account — comes from the conductor, never the session.
              required: false
              multiple: false
              reference: user
            agent:
              type: string
              title: Agent
              required: false
              multiple: false
            harness:
              type: string
              title: Harness
              description: Id of the agent harness package that drove the session, e.g. claude or codex.
              required: false
              multiple: false
            model:
              type: string
              title: Model
              description: The candidate's configured model, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            model_version:
              type: string
              title: Model version
              description: The candidate's configured exact version, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            error_log:
              type: text
              title: Error log
              description: Cause of a terminal dispatch/setup failure (state `failed`).
              required: false
              multiple: false
            tokens:
              type: integer
              title: Tokens
              description: First of the six per-run footprint fields (BB-132), written by the run-owning conductor at close. Not the ticket's `time_spent`.
              required: false
              multiple: false
            duration_s:
              type: integer
              title: Duration in seconds
              required: false
              multiple: false
            agent_turns:
              type: integer
              title: Agent turns
              required: false
              multiple: false
            tool_calls:
              type: integer
              title: Tool calls
              required: false
              multiple: false
            user_prompts:
              type: integer
              title: User prompts
              required: false
              multiple: false
            user_prompt_words:
              type: integer
              title: User prompt words
              required: false
              multiple: false
            state_flow:
              type: string
              title: State flow
              required: false
              multiple: false
              computed: true
              readonly: true
            duration:
              type: string
              title: Duration
              description: Humanised closed_date − started_at, e.g. "1m 12s".
              required: false
              multiple: false
              computed: true
              readonly: true
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: 'Design-only. Not a Drupal field: the row reaches the ticket''s identifier through ticket_id, rendered by bb_ticket_identifier_cell as a mono link to the ticket. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_label:
              type: string
              title: State label
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell labels the run state from the bb_run workflow. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_tone:
              type: string
              title: State tone
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell keys the tone on the state (BbRun::STATE_MARKS). Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_environment:
        bb_environment:
          title: bakers.build environment
          purpose: A managed deployment target of a project — the thing a ship ticket stamps and a verification ticket verifies against.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            base_url:
              type: url
              title: Base URL
              required: false
              multiple: false
            tier:
              type: string
              title: Tier
              required: false
              multiple: false
              settings:
                allowed_values:
                  production: Production
                  staging: Staging
                  development: Development
                  other: Other
            branch:
              type: string
              title: Branch
              description: The git branch this environment deploys from.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      user:
        user:
          title: User
          purpose: A person or app account. Modelled as the entity type `user` with its single bundle, because that is what every reference in this model targets.
          view_modes:
            full:
              template: field-map
            compact:
              template: field-map
              label: Compact
          form_modes:
            default:
              template: field-map
          fields:
            user_picture:
              type: image
              title: Profile picture
              description: Core image field; also switches on social_auth's own avatar download at login (BB-507 D3).
              required: false
              multiple: false
            field_full_name:
              type: string
              title: Full name
              description: Additive (BB-507 D4) — does not replace or derive display_name.
              required: false
              multiple: false
            name:
              type: string
              title: Username
              required: true
              multiple: false
            mail:
              type: string
              title: Email
              required: false
              multiple: false
            status:
              type: boolean
              title: Active
              required: false
              multiple: false
            roles:
              type: string
              title: Roles
              description: Machine names, e.g. bb_session.
              required: false
              multiple: true
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            access:
              type: datetime
              title: Last access
              required: false
              multiple: false
            login:
              type: datetime
              title: Last login
              required: false
              multiple: false
            timezone:
              type: string
              title: Timezone
              required: false
              multiple: false
            display_name:
              type: string
              title: Display name
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the ticket and comment entities expose assignee_initials / author_initials instead. Present so an avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            pass: Authentication internal; no bakers.build screen renders or edits a password hash.
            init: Authentication internal (initial email); never rendered.
            preferred_langcode: Localisation internal; bakers.build is English-only.
            preferred_admin_langcode: Localisation internal; bakers.build is English-only.
            default_langcode: Entity key for translations; bakers.build users are single-language.
            changed: Drupal's user entity has no `changed` field; `access` and `login` carry recency.
      bb_profile:
        bb_profile:
          title: bakers.build profile
          purpose: 'What a person tells bakers.build about themselves, one per user and workspace (unique on uid + workspace_id): their position, their background handed to AI assistants as context, and their favorite projects. Replaces the user fields field_developer_title and field_bb_background. Edited on the Profile tab /user/{user}/profile for the workspace in context; the entity has no view display.'
          form_modes:
            default:
              template: field-map
          fields:
            uid:
              type: reference
              title: Owner
              required: true
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            position:
              type: string
              title: Position
              description: Free text, at most 255 characters; placeholder "e.g. Product Lead".
              required: false
              multiple: false
            background:
              type: text
              title: What should bakers.build know about your background?
              description: Optional long text (string_long) handed to AI assistants as context, e.g. "Drupal developer, confident with PHP; little DevOps experience."
              required: false
              multiple: false
            favorite_projects:
              type: reference
              title: Favorite projects
              description: Projects this person marked as favorite in this workspace; not on the form.
              required: false
              multiple: true
              reference: bb_project
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_workspace:
        bb_workspace:
          title: bakers.build workspace
          purpose: 'The tenancy root: the object that says this data belongs to operator X and not operator Y. It holds all people and decides WHICH RIGHTS an account holds — BB-462 makes the workspace the ONLY level that carries rights: admin/contributor/guest (D2). Visibility of a project is a separate, per-team question (D4) that carries no rights of its own. Is an OG group (registered in og.settings) with the roles non-member, member, contributor, lead (labelled "Admin") and guest — five, not six: `owner`/`admin` were already consolidated into `lead` by BB-359 D12, and the machine principal `app` is GONE (BB-462 D9, its rank is answered entirely from OAuth scope now). Built by BB-316; the role set is BB-462''s.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; shown under the workspace's name in the switcher panel and on the join screen, absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately and shown uncropped as the workspace's mark in the switcher and on the join screen; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The CONTRACT or SUBSCRIPTION this tenant is served under. Same field type and name as bb_group.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. There is no `contract` field and there will not be one — the billing profile IS the contract level.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_team:
        bb_team:
          title: bakers.build team
          purpose: 'The stable crew, cutting across customer projects, and since BB-419 also their structural parent: a project is assigned to teams n:m through bb_project.teams and belongs to at least one. BB-462 D4 REVERSES what this field used to say: the assignment now DECIDES VISIBILITY — an account sees exactly the projects of the teams it belongs to (or every project, if it holds the workspace admin tier) — while still granting no RIGHTS of its own; a team answers "what do you see", the workspace alone answers "what may you do" (D2/D3). Is an OG group (registered in og.settings) with the roles non-member, member, lead (BB-456 D9, team-scoped statistics visibility) and owner (BB-462 D3, manages the team itself — who may join it and its own settings). The implicit member rank stays empty by design: team membership is a visibility fact, not a rights tier.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            projects:
              type: reference
              title: Projects
              description: The projects assigned to this team. Derived from bb_project.teams and never stored here, so the two directions cannot disagree.
              required: false
              multiple: true
              reference: bb_project
              computed: true
              readonly: true
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
      og_membership:
        default:
          title: OG membership
          purpose: 'Membership is ONE mechanism, modelled once: a user x group row reused by workspace and team rather than re-invented per level. This is NOT a bakers.build invention — it is contrib Organic Groups'' own og_membership entity, whose only bundle is `default` (og.og_membership_type.default). BB-462 D7 REVERSES what this field used to say: og.settings now registers only bb_workspace and bb_team as OG groups — bb_project is deregistered entirely, and every membership row anchored on a project is deleted by that ticket''s migration. BB-318 bridges the remaining rows into bakers.build''s query access. A screen reads membership here, never from a field on the group.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            type:
              type: string
              title: Membership type
              description: OG's bundle key — in code an entity reference to the og_membership_type config entity. Modelled as its value set rather than as a reference because bakers.build ships exactly one instance, og.og_membership_type.default, and no screen renders or chooses it.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - default
            uid:
              type: reference
              title: User
              description: The member. OG's own field name — not `user_id`.
              required: true
              multiple: false
              reference: user
            entity_type:
              type: string
              title: Group entity type
              description: Which level this membership is in. A workspace or project membership grants rights; a team membership does not, because the team carries no permissions.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            entity_bundle:
              type: string
              title: Group bundle
              description: Bundle of the group entity. Each of the three types has one bundle of its own name.
              required: false
              multiple: false
            entity_id:
              type: string
              title: Group entity ID
              description: Id of the group named by entity_type. A plain STRING in OG, not a reference, because the target entity type varies per row — so no screen can rely on an entity-reference widget here.
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: Defaults to active. Only an active membership grants what its roles carry.
              required: true
              multiple: false
              settings:
                allowed_values:
                  - active
                  - pending
                  - blocked
            roles:
              type: reference
              title: Roles
              description: 'MULTI-VALUE (OG sets cardinality unlimited) and a reference to og_role config objects by their full id, e.g. bb_workspace-bb_workspace-lead. The `member` role is never stored: OgMembership::preSave() revokes it and getRoles() prepends it on read, so a row that looks role-less is still a member.'
              required: false
              multiple: true
              reference: og_role
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            language: Entity key; bakers.build memberships are single-language and no screen renders a language.
      bb_addon:
        bb_addon:
          title: bakers.build addon
          purpose: An addon definition at one version (name@version), registered by the conductors that run it. Entity access is admin-only; workspace leads see the addons in the workspace Settings › Addons tab, one row per name at its newest version with all its versions and the conductors of the current workspace that run each version. The definition is immutable once registered and may carry an inline SVG icon. Read-only on every screen.
          view_modes:
            list_item:
              template: field-map
              label: List item
          fields:
            name:
              type: string
              title: Name
              description: Machine name of the addon, e.g. ports. Together with version it forms the name@version key.
              required: true
              multiple: false
            version:
              type: string
              title: Version
              description: Semantic version string, e.g. 1.2.3.
              required: true
              multiple: false
            contract:
              type: integer
              title: Contract
              description: Version of the addon definition contract the addon implements, e.g. 1.
              required: true
              multiple: false
            definition:
              type: text
              title: Definition
              description: 'Immutable JSON addon definition: label, views, actions and an optional inline SVG icon. The Settings › Addons tab shows only its label and icon.'
              required: true
              multiple: false
            conductors:
              type: reference
              title: Conductors
              description: Conductors that registered (run) this addon version.
              required: false
              multiple: true
              reference: bb_conductor
              settings:
                target_type: bb_conductor
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            label:
              type: string
              title: Label
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter prints the definition''s label. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            versions_label:
              type: string
              title: Versions
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter lists every version of the name once, newest first. Present so the Versions cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter draws the initials of the label. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter keys the avatar colour on the addon id. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_badges:
              type: string
              title: Conductors
              description: 'Design-only. Not a Drupal field: the bb_addon_conductors formatter renders `conductors` as one dotted badge per conductor and version ("<conductor> <version>", running when online, offline otherwise), or "No conductor in this workspace". The value lists the badges as text; its `_formatted` companion carries the rendered badges.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter turns the definition''s inline SVG icon into a data URI; empty for initials. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
    config:
      image_style:
        avatar:
          aspect_ratio: '1:1'
      omitted:
        bb_core.bb_vocabulary: The vocabulary IS the bb_term bundle; no screen renders it as an object of its own.
        view.environments: Drupal has no environments View, and no list of environments exists yet. The bb_project environments field is hidden on the project full display; only its referenced names show on the project properties detail card (BbEntityDetailCardForm). Ship tickets show their environments as chips in the ticket inspector. The view.environments mapping is ahead of the backend and has no Drupal counterpart.
      og_role:
        og_role:
          title: OG role
          purpose: 'The role vocabulary of the OG groups — what a Settings screen assigns a person on a workspace or a team. Contrib Organic Groups'' own config entity. AS-IS, MEASURED IN config/sync AT BB-462: NINE objects, not ten — bb_project carries no role at all any more (D7 deregisters it as an OG group entirely). Five for bb_workspace (non-member, member, contributor, lead, guest) and four for bb_team (non-member, member, lead, owner). `app` is GONE (D9: a conductor''s OAuth identity is bound to its owning user, so it sees exactly what that user''s own rank sees — no separate machine rank exists to list here). `owner` is NEW (D3): governs the team itself, who may join it and its own settings. The key is the Drupal config-name PREFIX, so this is one entry per config entity TYPE; the instances live in sample data. Three facts a screen must not get wrong. First, `permissions` is NOT an empty list on every role: bb_workspace-lead and -contributor carry real permission strings (create/edit/delete rights), bb_workspace-guest carries read-only, and bb_team-owner carries `manage members`/`update group`. It IS empty on exactly four: the three non-member roles and bb_team-bb_team-member — the implicit member rank is deliberately emptied everywhere (D1: OG ranks are additive and cannot be narrowed, so any right left on an implicit rank is inherited by every membership including guests). Second, `is_admin` is FALSE on all nine. Third, "a workspace admin sees every project of their workspace" (D4) is a VISIBILITY rule computed from the rank id, never an OG admin flag or a project-level role — there is no project-level role left to read at all. TARGET: product roles are OG ranks only; team ownership is the one new rank this ticket adds.'
          fields:
            id:
              type: string
              title: Machine name
              description: Composed as <group_type>-<group_bundle>-<role name>, e.g. bb_workspace-bb_workspace-lead. This full id is what og_membership.roles references.
              required: true
              multiple: false
            label:
              type: string
              title: Label
              description: The human name a Settings screen shows, e.g. "Administrator".
              required: true
              multiple: false
            weight:
              type: integer
              title: Weight
              description: Display order within a group type; 0 for non-member, rising to 5 for the workspace app role.
              required: false
              multiple: false
            is_admin:
              type: boolean
              title: Is admin
              description: FALSE on every shipped role — measured in config/sync at BB-435 across all ten og.og_role objects, and the role it used to name does not exist. Read the role id, never this flag. See the purpose above.
              required: false
              multiple: false
            permissions:
              type: string
              title: Permissions
              description: OG permission strings. Empty in exactly four of the ten shipped roles — the three non-member roles and bb_team-bb_team-member — see the purpose above before designing anything that edits this.
              required: false
              multiple: true
            group_type:
              type: string
              title: Group entity type
              required: true
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            group_bundle:
              type: string
              title: Group bundle
              required: true
              multiple: false
            role_type:
              type: string
              title: Role type
              description: '`required` for the two roles OG creates for every group (non-member, member); `standard` for the roles bakers.build adds. A screen must not offer to delete a required role.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - required
                  - standard
          omitted:
            uuid: Config entities carry a uuid that is not part of the modelled key set and is never rendered.
            group_id: Null in all ten shipped roles. OG sets it only for a role scoped to one single group instance, which bakers.build ships none of, so no screen renders it.
      view:
        addons:
          title: Addons
          purpose: Lists every registered addon once, at its newest version, with the conductors of the routed workspace that run any of its versions.
          base_table: bb_addon
          items_per_page: 50
          columns:
            - icon
            - label
            - name
            - versions
            - contract
            - conductors
          displays:
            default:
              plugin: default
            settings:
              plugin: page
              path: /_workspace/%bb_workspace/settings/addons
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_addon records the View lists; Drupal renders each row as the addon in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_addon
                  bundle: bb_addon
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        conductors:
          title: Conductors
          purpose: |-
            Two listings of bb_conductor. The user-area rail item (user_list) is the
            conductors assigned to the account in the URL, any workspace. The project
            tab (project_list) is that project's conductors, any owner. Both walk
            project_id then group_id because bb_conductor carries no workspace field
            of its own. Both joins are INNER: a conductor whose project or group is
            gone has no workspace to be listed under.
          base_table: bb_conductor
          items_per_page: 50
          columns:
            - conductor_id
            - label
            - status
            - reported_load
            - owner_user_id
            - last_seen
          displays:
            default:
              plugin: default
            project_list:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/conductors
            user_list:
              plugin: page
              path: /user/%user/conductors
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_conductor records the View lists; Drupal renders each row as the conductor in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_conductor
                  bundle: bb_conductor
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        conductor_tickets:
          title: Conductor tickets
          purpose: |-
            Tickets occupying one conductor. The occupancy source supplies explicit
            numeric ticket ids; this view never lists by ticket conductor_id and has
            no page route.
          base_table: bb_ticket
          columns:
            - identifier
            - title
          displays:
            default:
              plugin: default
            occupancy:
              plugin: embed
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item_compact` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item_compact
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        groups:
          title: Groups
          purpose: Lists the groups of the routed workspace. The Groups page owns the create-group action. A group organizes customer and cost-centre data; it grants no permissions.
          base_table: bb_group
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - description
            - projects
            - changed
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/groups
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_group records the View lists; Drupal renders each row as the group in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_group
                  bundle: bb_group
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        machines:
          title: Machines
          purpose: |-
            The user-area rail item (user_list) is the machines assigned to the
            account in the URL, any workspace.
          base_table: bb_machine
          items_per_page: 50
          columns:
            - name
            - max_parallel
            - current_load
            - owner_user_id
            - last_run
          displays:
            default:
              plugin: default
            user_list:
              plugin: page
              path: /user/%user/machines
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_machine records the View lists; Drupal renders each row as the machine in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_machine
                  bundle: bb_machine
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        project_board:
          title: Project board
          purpose: |-
            Four-column project board of bb_ticket on the tickets Search API
            index. The page display owns the route. Each lifecycle column is a
            bb_board_column attachment with its own mini pager. Column membership is the indexed work_state value.
            Parent focus applies to every display; the page header summarizes the whole matching selection.
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - identifier
          displays:
            default:
              plugin: default
            backlog:
              plugin: bb_board_column
            done:
              plugin: bb_board_column
            intake:
              plugin: bb_board_column
            project_board:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/board
            working:
              plugin: bb_board_column
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row with the `fields` row plugin.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: default
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
        projects:
          title: Projects
          purpose: |-
            The projects of the workspace named in the URL, five columns. A LISTING IS A
            VIEW: the row this replaced was a bb_project.bb_project.teaser view mode,
            and BB-389 removed it because a list row was never a view mode.

            THE ROWS COME FROM THE URL, and that is this view's own argument rather than the
            query-access layer's doing. BbWorkspaceReadScope resolves an ACCOUNT's scope —
            the union of every OG membership, with no workspace parameter — so for a user
            who belongs to several workspaces it admits more rows than the URL asked for.
            The `workspace_id` argument narrows to the one workspace, walking the group_id
            relationship because bb_project carries no workspace field of its own. Its
            `default_action` is `access denied` rather than a fallback to all: a view that
            listed every workspace the moment a route stopped supplying the parameter is how
            ambient scoping turns into a disclosure. Query access stays the floor
            underneath — the two layers answer two different questions.

            THE TWO RELATIONSHIPS DISAGREE ABOUT `required` ON PURPOSE. owner_user_id is a
            LEFT JOIN, and the reason stated here used to be that BbProject::owner_user_id
            is not setRequired(TRUE). That is now FALSE — the field has carried
            setRequired(TRUE) since 66780aa93 — and the LEFT JOIN is still right, so only
            the rationale is corrected. setRequired() is a VALIDATION constraint on a write
            to the project; it is not delete protection on the account referenced. bb_core
            guards that nowhere — no preDelete, no cascade, no reference constraint — so a
            stored project can still be left pointing at a deleted user, and an inner join
            on it drops the whole project from this listing the moment that happens: no
            message, no empty cell, no row. group_id stays an INNER JOIN, and for a positive
            reason rather than the same one: it carries the workspace argument, so a project
            whose group is gone has no workspace to be listed under, and the honest answer
            is no workspace rather than every workspace. That the referenced rows can vanish
            at all is a data-integrity gap, not this listing's to paper over.

            TWO DESIGNED COLUMNS ARE ABSENT, NAMED HERE RATHER THAN LEFT TO AN EMPTY SPACE.
            Teams is absent, and the reason stated here used to be that bb_project carries
            no `teams` field at all. That is now FALSE, in the same way the owner_user_id
            sentence above was: BB-419 added `teams` as a required, unlimited-cardinality
            entity_reference (BbProject.php), so the n:m assignment DOES exist and the
            cancelled BB-356 no longer describes the state of the field. What is true is
            that this listing still renders no teams column, and no decision has been
            recorded that it should not — so this is an open question about the listing
            rather than a structural impossibility, and it is named as one here instead of
            being justified by a field that is gone from the reasoning. Environments is
            absent for a reason that does still hold: it is a COUNT over a multi-value
            entity reference and core views has no field for that; a column showing the
            first referenced environment instead of the count would be a different and
            wrong value.

            IT COMPOSES A CANVAS WHOSE HEADING LIVES IN THE SHELL. The screen title,
            tabs and New-project action are the `page_header` island on
            `island.profile.bb_shell`. This display's tree is `bb_theme:canvas`
            with a `bb_theme:zone` in `main` wrapping `view_rows` plus `view_pager`.
            The `empty` area is untouched, because ui_patterns' own `view_rows` source
            renders a view's empty areas when it has no rows.

            THE ROWS ARE STILL CORE'S `table` WITH `row: type: fields`, AND NOT FOR THE
            REASON D1 GAVE. D1 priced the alternative as a bespoke ui_patterns Source, and that
            is not what it costs: a PRESENTER TEMPLATE — a markup-free template that
            transforms what views handed it and include()s the component, reached by core's
            own theme suggestion (ViewExecutable::buildThemeFunctions() emits
            views_view_table__projects) — needs no plugin and would leave this file exactly
            as it is. What IS true is that site building cannot do it: `rows` is a PROP
            holding an array of objects, and no shipped ui_patterns source serves such a
            prop type — ui_patterns_views's view_rows declares `prop_types: [slot]`, and
            across all 22 shipped sources the prop types are attributes, boolean, enum,
            enum_list, enum_set, identifier, links, list, number, slot, string, url and
            variant. That absence is the condition under which a presenter is the right
            answer rather than a trick. BB-413 owns that template; when it lands this
            listing renders through bb_theme:table with no change here.
          base_table: bb_project
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - key
            - description
            - open_tickets
            - conductor_tickets
            - closed_tickets
            - created
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/projects
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_project records the View lists; Drupal renders each row as the project in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_project
                  bundle: bb_project
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        runs:
          title: Runs
          base_table: search_api_index_bb_runs
          items_per_page: 10
          columns:
            - identifier
            - state
            - state_at_start
            - conductor_id
            - agent
            - started_at
            - duration_s
          displays:
            default:
              plugin: default
            project_runs:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/runs
            team_runs:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/runs
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_run records the View lists; Drupal renders each row as the run in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_run
                  bundle: bb_run
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
        tickets:
          title: Tickets
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - state
            - title
            - priority
            - identifier
            - created
            - owner
            - conductor
            - stall_reason
            - run_count
            - assignee
          displays:
            default:
              plugin: default
            my_work:
              plugin: page
              path: /_workspace/%bb_workspace/tickets
            page_1:
              plugin: page
              path: /_workspace/%bb_workspace/tickets/all
            project_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/tickets
            team_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/tickets
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
  component: bb_theme:list_item
  bindings:
    - field: row_accent
      prop: accent
    - field: state_icon
      slot: avatar
      wrap:
        component: bb_theme:list_cell
        props:
          key: state
        slot: value
    - field: title
      slot: headline
      wrap:
        component: bb_theme:list_cell
        props:
          key: title
          primary: true
        slot: value
    - field: priority_label
      slot: headline
      wrap:
        component: bb_theme:list_cell
        props:
          key: priority
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone:
              field: priority_tone
          prop: label
    - field: identifier_link
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: identifier
        slot: value
    - field: created
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: created
          caption: Created
        slot: value
    - field: owner_name
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: owner
          caption: by
        slot: value
        wrap:
          component: bb_theme:person
          props:
            variant: compact
            size: sm
            initials:
              field: owner_initials
            color:
              field: owner_color
          prop: display_name
    - field: stall_reason
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: stall_reason
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone: wait
            dot: true
            suffix:
              field: stall_suffix
          prop: label
    - field: run_summary
      slot: meta
      wrap:
        component: bb_theme:list_cell
        props:
          key: run_summary
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone:
              field: run_summary_tone
            icon: run
            suffix:
              field: run_summary_suffix
          prop: label
    - field: conductor_label
      slot: right
      wrap:
        component: bb_theme:list_cell
        props:
          key: conductor
          fallback: —
          align: end
        slot: value
        wrap:
          component: bb_theme:badge
          props:
            tone: lease
            mono: true
            icon: lock
            mine:
              field: conductor_mine
          prop: label
  ```

  #### Contract
  ```yaml
  outputs:
    entity-mapping:
      required: true
      schema: {}
      submission: data
      validators:
        - entity-mapping
      path: /var/www/html/web/themes/custom/bb_theme/designbook/entity-mapping/bb_ticket.bb_ticket.list_item_mine.jsonata
      glob: /var/www/html/web/themes/custom/bb_theme/designbook/*/*.*.*.jsonata
  ```

  #### Results
  <!-- done -->

- [x] map-entity--design-screen — bb_ticket.list_item_compact

  Instruction: task:map-entity--design-screen

  #### Params
  ```yaml
  mapping:
    entity_type: bb_ticket
    bundle: bb_ticket
    mode_kind: view
    view_mode: list_item_compact
  data_model:
    content:
      bb_project:
        bb_project:
          title: bakers.build project
          purpose: 'The work unit: key, next_number, repository, environments. BB-462 D7 REVERSES what this field used to say: the project carries NO membership or role of its own any more — it is deregistered from og.settings entirely, and its three roles (non-member, member, lead) are deleted from both config paths. Visibility now comes from bb_project.teams (D4): a project is visible to the members of a team it names, or to a workspace admin. The two levels that grant rights are the workspace (create/edit/delete rights, via bb_workspace-bb_workspace-{contributor,lead}) and, per-project, its teams (visibility only — a team carries no rights of its own, BB-462 D3). A screen must not offer a permission control on the project.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            epics:
              template: field-map
              label: Epics
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            group_id:
              type: reference
              title: Group
              required: true
              multiple: false
              reference: bb_group
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under project-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            repository:
              type: object
              title: Repository
              description: 'The project repository (URL, default branch, branch naming convention). Single-valued: a project has at most one repository.'
              required: false
              multiple: false
              settings:
                properties:
                  url: string
                  default_branch: string
                  branch_convention: string
            coder_config:
              type: object
              title: Coder config
              required: false
              multiple: false
            env_vars:
              type: text
              title: Environment variables
              description: Project defaults supplied to hooks and the agent on every run, as .env-style KEY=value lines. A parent ticket and the ticket itself override a key set here. Readable by anyone who can view this project.
              required: false
              multiple: false
            teams:
              type: reference
              title: Teams
              description: 'The teams this project belongs to. A project belongs to AT LEAST ONE team, so the field is required and multi-valued. The assignment is STRUCTURE and confers no rights: it makes the team the project''s structural parent, and team membership is not a source of ticket visibility. Visibility stays at direct project membership or workspace see-all (BB-419, which deliberately left BbWorkspaceReadScope untouched).'
              required: true
              multiple: true
              reference: bb_team
            key:
              type: string
              title: Identifier prefix
              description: Ticket identifier prefix, e.g. BB in BB-328. A change applies only to tickets created afterwards.
              required: false
              multiple: false
            next_number:
              type: integer
              title: Next number
              description: Next per-project ticket number; floors to max(number)+1 on allocation.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            environments:
              type: reference
              title: Environments
              description: Managed environments belonging to this project.
              required: false
              multiple: true
              reference: bb_environment
              computed: true
              readonly: true
            open_tickets:
              type: integer
              title: Open tickets
              description: 'Computed, internal: the project''s tickets not yet closed. The listing row shows it as a ticket badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_tickets:
              type: integer
              title: Conductor tickets
              description: 'Computed, internal: the project''s tickets a conductor currently holds. The listing row shows it as a conductor badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            closed_tickets:
              type: integer
              title: Closed tickets
              description: 'Computed, internal: the project''s closed tickets. The listing row shows it as a check badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the project id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              description: Free text, not an enum (BB-227). Values in use include comment, qualification, spec, test and acceptance, so a screen must render an unknown value rather than assume a closed set.
              required: true
              multiple: false
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
        review:
          title: bakers.build review comment
          purpose: A private review of a ticket. Drafts stay with the assigned author; submitted reviews wait for the current assignee; accepted reviews publish into the ordinary comment timeline. Rejected reviews stay unpublished. The Boolean published flag is server-owned.
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            author:
              type: reference
              title: Author
              required: true
              multiple: false
              reference: user
            body:
              type: text
              title: Body
              required: true
              multiple: false
            type:
              type: string
              title: Type
              required: true
              multiple: false
            status:
              type: boolean
              title: Published
              required: false
              multiple: false
            review_state:
              type: string
              title: Review state
              required: false
              multiple: false
              settings:
                allowed_values:
                  draft: Draft
                  submitted: Submitted
                  accepted: Accepted
                  rejected: Rejected
            submitted_at:
              type: datetime
              title: Submitted at
              required: false
              multiple: false
            decided_at:
              type: datetime
              title: Decided at
              required: false
              multiple: false
            decided_by:
              type: reference
              title: Decided by
              required: false
              multiple: false
              reference: user
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_activity:
        bb_activity:
          title: bakers.build activity
          purpose: 'One persisted ticket event per row: `created` when a ticket is created, `status_changed` per state change (with the step''s summary comment, and with the run it closed and that run''s conductor when an agent did the work), `claimed` only for the first run outside qualification, and `run_ended` when a run ends failed, expired or cancelled without moving the ticket. Writes come only from the bb_activity kinds, called where the change happens. Each row is this bundle''s `full` view mode (`bb_theme:event` with a structured lead); there is no second activity view mode.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: true
              multiple: false
              reference: bb_ticket
            kind:
              type: string
              title: Kind
              description: '`created`, `status_changed`, `claimed` or `run_ended`. Tags: created, status, started (claimed) and the run outcome for run_ended.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - created
                  - status_changed
                  - claimed
                  - run_ended
            actor:
              type: reference
              title: Actor
              required: false
              multiple: false
              reference: user
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
            previous_state:
              type: string
              title: Previous state
              required: false
              multiple: false
            new_state:
              type: string
              title: New state
              required: false
              multiple: false
            step:
              type: string
              title: Step
              description: The run's state_at_start for claimed and run_ended rows. Unused for created and status rows.
              required: false
              multiple: false
            run_id:
              type: reference
              title: Run
              required: false
              multiple: false
              reference: bb_run
              description: The run a claimed or run_ended row reports, or the run a status change closed. Empty for created rows and human status changes; its presence makes the row an agent row.
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
              description: The conductor of the referenced run.
            comment_id:
              type: reference
              title: Summary comment
              description: The ticket's summary comment published since the ticket entered the state a status row leaves. Empty when none.
              required: false
              multiple: false
              reference: bb_comment
            claim_key:
              type: string
              title: Claim key
              required: false
              multiple: false
              description: The claimed run's UUID; unique, guards a second claimed row for the same run. NULL on other kinds.
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: Computed from ticket_id.identifier so the event body can name the ticket without the mapping joining collections.
              required: false
              multiple: false
              computed: true
              readonly: true
            author_name:
              type: string
              title: Author name
              required: false
              multiple: false
              computed: true
              readonly: true
              description: The run's model (else harness, else agent) on rows with a viewable run; otherwise the actor's display name.
            author_initials:
              type: string
              title: Author initials
              required: false
              multiple: false
              computed: true
              readonly: true
            author_color:
              type: string
              title: Author colour
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: Computed from conductor_id.label.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_harness:
              type: string
              title: Run harness
              description: Computed from run_id.harness; shown beside the model on agent rows.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_duration:
              type: string
              title: Run duration
              description: Computed from run_id duration_s (or started_at to the row time), formatted.
              required: false
              multiple: false
              computed: true
              readonly: true
            run_outcome:
              type: string
              title: Run outcome
              description: 'Computed from run_id.state on run_ended rows: failed, expired or cancelled.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_error_line:
              type: string
              title: Run error line
              description: Computed first non-empty line of a failed run's error log.
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            changed: Activity rows are immutable; nothing writes a changed stamp.
      bb_conductor:
        bb_conductor:
          title: bakers.build conductor
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_user:
              template: field-map
              label: List item (user)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            machine_id:
              type: string
              title: Machine ID
              required: true
              multiple: false
            label:
              type: string
              title: Label
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            status:
              type: string
              title: Status
              required: false
              multiple: false
              settings:
                allowed_values:
                  online: Online
                  offline: Offline
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            states:
              type: string
              title: States
              description: The claimable ticket states this conductor picks up.
              required: false
              multiple: true
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
            workspace_root:
              type: string
              title: Workspace root
              required: false
              multiple: false
            active:
              type: boolean
              title: Active
              description: Whether the conductor may be assigned and claim work; separate from online/offline status.
              required: false
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              required: false
              multiple: false
            last_seen:
              type: datetime
              title: Last seen
              required: false
              multiple: false
            lease_expires_at:
              type: datetime
              title: Lease expires at
              required: false
              multiple: false
            conductor_name:
              type: string
              title: Conductor name
              description: The config-file stem `--conductor <name>` selects.
              required: false
              multiple: false
            last_pid:
              type: integer
              title: Last PID
              description: Reported by the serve loop that owns the process; used by a verified stop.
              required: false
              multiple: false
            node_status:
              type: string
              title: Node status
              description: running | stale | offline — the shared liveness vocabulary.
              required: false
              multiple: false
              computed: true
              readonly: true
            node_states_label:
              type: string
              title: Claimed states
              required: false
              multiple: false
              computed: true
              readonly: true
            node_load_label:
              type: string
              title: Load
              required: false
              multiple: false
              computed: true
              readonly: true
            last_seen_label:
              type: string
              title: Last seen
              required: false
              multiple: false
              computed: true
              readonly: true
            reported_load:
              type: integer
              title: Reported load
              description: The load the conductor reported on its last poll. The listing row shows it as a run badge.
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_label:
              type: string
              title: Owner
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the owner''s display name. Present so the row has a value for the Owner cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            project_label:
              type: string
              title: Project
              description: 'Design-only. Not a Drupal field: the entity_reference_label formatter prints the project''s name. Present so the user listing''s row has a value for the Project cell.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_label:
              type: string
              title: Status label
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter labels the status from its allowed values. Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            status_tone:
              type: string
              title: Status tone
              description: 'Design-only. Not a Drupal field: the bb_status_badge formatter keys the tone on the status (online running, offline offline). Present so the badge component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_machine:
        bb_machine:
          title: bakers.build machine
          purpose: 'Host capacity for concurrent runs, owned by one user account. Capacity (max_parallel / current_load) belongs to the machine, not to each per-project conductor; a conductor links its machine. host_key is the machine-context stem, not the composed conductor registration key. Machines are not in the workspace read scope: the owner sees them under the account Machines listing, and the full view is the machine page /user/{user}/machine/{bb_machine}.'
          view_modes:
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            host_key:
              type: string
              title: Host key
              description: Machine-context machine_id stem, unique per machine.
              required: true
              multiple: false
            max_parallel:
              type: integer
              title: Max parallel
              description: Concurrent runs this machine accepts; default 5.
              required: false
              multiple: false
            current_load:
              type: integer
              title: Current load
              description: Runs currently claimed on this machine; default 0.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
              settings:
                target_type: user
            owner_label:
              type: string
              title: Owner label
              description: Display name of the owner, read through owner_user_id; the machine page shows it.
              required: false
              multiple: false
              computed: true
              readonly: true
            last_run:
              type: datetime
              title: Last run
              description: 'Computed, internal: when the machine last started a run. The listing row shows it relative, captioned "Last run".'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_group:
        bb_group:
          title: bakers.build group
          purpose: The customer. Bundles projects and carries the cost centre for re-invoicing. Carries NO permissions and is NOT an OG group — og.settings registers only bb_workspace and bb_team since BB-462 D7 deregisters bb_project — it is not a rights level, so no screen may offer a permission control on it.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; rendered beneath the listing row's meta line and absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately under group-images, shown uncropped as the listing row's leading avatar; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The customer COST CENTRE for re-invoicing. Same field type and name as bb_workspace.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. Both exist; neither replaces the other.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              description: The tenant this customer belongs to. Built by BB-316; on feat/bb-315-multi-workspace, not yet on develop.
              required: false
              multiple: false
              reference: bb_workspace
            projects:
              type: integer
              title: Projects
              description: 'Computed, internal: the number of the group''s projects the reader may view. The listing row shows it as a project badge.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_entity_avatar formatter draws the initials from the name. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: Drupal keys the avatar colour on the group id. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the URL Drupal derives from `image` in the avatar image style; empty for initials. Present so the avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_ticket:
        bb_ticket:
          title: bakers.build ticket
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
            list_item:
              template: field-map
              label: List item
            list_item_mine:
              template: field-map
              label: List item (my work)
            list_item_compact:
              template: field-map
              label: List item (compact)
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            project_id:
              type: reference
              title: Project
              required: false
              multiple: false
              reference: bb_project
            identifier:
              type: string
              title: Identifier
              required: true
              multiple: false
            workflow:
              type: string
              title: Workflow
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_work
            title:
              type: string
              title: Title
              required: true
              multiple: false
            description:
              type: text
              title: Description
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: One of the ticket's workflow states; which subset applies is decided by `workflow`. `human_input` is not a state.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - qualification
                  - plan
                  - working
                  - review
                  - done
                  - cancelled
            ticket_type:
              type: reference
              title: Type
              description: The ticket's type term (vocabulary `type`). A ticket whose type term is named `epic` is an epic.
              required: false
              multiple: false
              reference: bb_term
            recipe:
              type: reference
              title: Recipe
              description: The ticket's recipe term (vocabulary `recipe`).
              required: false
              multiple: false
              reference: bb_term
            labels:
              type: reference
              title: Labels
              required: false
              multiple: true
              reference: bb_term
              description: The ticket's label terms (vocabulary `label`).
            assignee_user_id:
              type: reference
              title: Assignee user
              required: false
              multiple: false
              reference: user
            reviewers:
              type: reference
              title: Reviewers
              required: false
              multiple: true
              reference: user
            priority:
              type: integer
              title: Priority
              required: false
              multiple: false
              settings:
                allowed_values:
                  '1': High
                  '2': Medium
                  '3': Low
            parent_id:
              type: reference
              title: Parent ticket
              required: false
              multiple: false
              reference: bb_ticket
            blocked_by:
              type: reference
              title: Blocked by
              required: false
              multiple: true
              reference: bb_ticket
            origin:
              type: string
              title: Origin URL
              required: false
              multiple: false
            links:
              type: link
              title: Links
              description: Typed links (uri, title, options.bakers.kind); kind is server-derived.
              required: false
              multiple: true
            comments:
              type: reference
              title: Comments
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            pending_reviews:
              type: reference
              title: Pending reviews
              description: Submitted reviews awaiting a decision by the current assignee (computed; never writable). Private; not part of the ordinary comment timeline.
              required: false
              multiple: true
              reference: bb_comment
              computed: true
              readonly: true
            branch_name:
              type: string
              title: Branch name
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            frozen:
              type: boolean
              title: Frozen
              description: Operator hold. A frozen ticket is not claimable; an active run is left running.
              required: false
              multiple: false
            frozen_at:
              type: datetime
              title: Frozen at
              description: When the operator hold started. Server-stamped, cleared on unfreeze.
              required: false
              multiple: false
              readonly: true
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            number:
              type: integer
              title: Number
              description: Per-project running number, allocated once on first save and frozen.
              required: false
              multiple: false
              readonly: true
            conductor_id:
              type: reference
              title: Conductor
              description: Assigning a conductor is what starts a run.
              required: false
              multiple: false
              reference: bb_conductor
            time_estimate:
              type: integer
              title: Estimated time
              description: Estimated effort in SECONDS, proposed at qualification, confirmed by a human.
              required: false
              multiple: false
            time_spent:
              type: integer
              title: Spent time
              description: Accounted effort in SECONDS, proposed at review, confirmed by a human.
              required: false
              multiple: false
            referenced_tickets:
              type: reference
              title: Referenced tickets
              description: Tickets carried by this deployment (the release batch).
              required: false
              multiple: true
              reference: bb_ticket
            environments:
              type: reference
              title: Environments
              description: The managed environments this ticket concerns.
              required: false
              multiple: true
              reference: bb_environment
            env_vars:
              type: text
              title: Environment variables
              description: .env-style KEY=value lines. Inherited by sub-tickets. Readable by anyone who can view this ticket.
              required: false
              multiple: false
            metrics:
              type: object
              title: Metrics
              description: Named success metrics for this ticket.
              required: false
              multiple: true
              settings:
                properties:
                  name: string
                  value: string
                  unit: string
                  recorded: datetime
            cleaned_up:
              type: boolean
              title: Cleaned up
              description: The herdr worktree has been torn down. Distinct from `closed`.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
            base_branch:
              type: string
              title: Base branch
              description: Parent's branch, else the first project repo default_branch, else "main".
              required: false
              multiple: false
              computed: true
              readonly: true
            effective_env_vars:
              type: text
              title: Effective environment variables
              description: env_vars resolved along the parent chain (child wins).
              required: false
              multiple: false
              computed: true
              readonly: true
            sub_tickets:
              type: reference
              title: Sub-tickets
              description: Reverse reference; parent_id is the source of truth.
              required: false
              multiple: true
              reference: bb_ticket
              computed: true
              readonly: true
            runs:
              type: reference
              title: Runs
              description: Reverse reference; bb_run.ticket_id is the source of truth.
              required: false
              multiple: true
              reference: bb_run
              computed: true
              readonly: true
            derived_status:
              type: string
              title: Derived status
              description: idle | running | … — derived from the ticket's active runs.
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_reason:
              type: string
              title: Stall reason
              description: 'Why this ticket is standing still: frozen, blocked, no conductor, or failing. Empty for a moving or closed ticket.'
              required: false
              multiple: false
              computed: true
              readonly: true
            claim_machine:
              type: string
              title: Claim machine
              required: false
              multiple: false
              computed: true
              readonly: true
            since_label:
              type: string
              title: Since
              description: Humanised age of the current state, e.g. "3 minutes".
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_initials:
              type: string
              title: Assignee initials
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_name:
              type: string
              title: Assignee name
              required: false
              multiple: false
              computed: true
              readonly: true
            assignee_color:
              type: string
              title: Assignee colour
              required: false
              multiple: false
              computed: true
              readonly: true
            state_flow:
              type: string
              title: State flow
              description: Comma-separated states of the ticket's workflow, in order.
              required: false
              multiple: false
              computed: true
              readonly: true
            edit_url:
              type: url
              title: Edit URL
              required: false
              multiple: false
              computed: true
              readonly: true
            row_accent:
              type: string
              title: Row accent
              description: 'Computed, internal: the listing row''s accent rail, attention in the review phase, running while a conductor holds the ticket, otherwise none.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary:
              type: string
              title: Run summary
              description: 'Computed, internal: the run count and the latest run''s state, as the bb_run_summary formatter''s badge label ("5 runs · last running").'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_tone:
              type: string
              title: Run summary tone
              description: 'Design-only. Not a Drupal field: bb_run_summary keys the badge tone on the latest run''s state. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            run_summary_suffix:
              type: string
              title: Run summary time
              description: 'Design-only. Not a Drupal field: bb_run_summary appends the latest run''s relative time. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            stall_suffix:
              type: string
              title: Stall time
              description: 'Design-only. Not a Drupal field: bb_stall_reason appends how long a frozen ticket has been frozen. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            identifier_link:
              type: string
              title: Identifier link
              description: 'Design-only. Not a Drupal field: bb_ticket_identifier_cell renders `identifier` as a mono link to the ticket, while the compact row prints it plain. The value is the identifier; its `_formatted` companion carries the link.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_icon:
              type: string
              title: State icon
              description: 'Design-only. Not a Drupal field: bb_ticket_state_icon_cell draws the state as an icon labelled with the state (running phase full, otherwise faint). The value is the label; its `_formatted` companion carries the mark.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_label:
              type: string
              title: Priority label
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell labels the priority from its allowed values. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            priority_tone:
              type: string
              title: Priority tone
              description: 'Design-only. Not a Drupal field: bb_ticket_priority_cell marks the highest priority critical. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_name:
              type: string
              title: Owner name
              description: 'Design-only. Not a Drupal field: bb_ticket_owner_cell draws the owner as a person cell. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_initials:
              type: string
              title: Owner initials
              description: 'Design-only. Not a Drupal field: the owner''s person initials. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            owner_color:
              type: string
              title: Owner colour
              description: 'Design-only. Not a Drupal field: the owner''s person colour. Present so the person component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field; sample data carries it as the record key.
            uuid: Entity key; the designbook model addresses records by `id`.
      bb_term:
        type:
          title: bakers.build ticket type
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        recipe:
          title: bakers.build recipe
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
        label:
          title: bakers.build label
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: A plain string_long with no text format, so a screen must not offer rich-text rendering for it.
              required: false
              multiple: false
            weight:
              type: integer
              title: Weight
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            vid: The bundle key. The vocabulary IS the bb_term bundle; no screen renders it as an object of its own, and the file name data/bb_term.<bundle>.yml already carries it.
            langcode: Entity key; bakers.build terms are single-language and no screen renders a language.
            created: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
            changed: bb_term extends ContentEntityBase directly and has no created/changed timestamps.
      bb_run:
        bb_run:
          title: bakers.build run
          view_modes:
            full:
              template: field-map
            overlay:
              template: field-map
            teaser:
              template: field-map
            list_item:
              template: field-map
              label: List item
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            ticket_id:
              type: reference
              title: Ticket
              required: false
              multiple: false
              reference: bb_ticket
            conductor_id:
              type: reference
              title: Conductor
              required: false
              multiple: false
              reference: bb_conductor
            state:
              type: string
              title: Run state
              required: true
              multiple: false
              settings:
                allowed_values:
                  - claimed
                  - running
                  - done
                  - expired
                  - failed
            claim_expires_at:
              type: datetime
              title: Claim expires at
              required: false
              multiple: false
            state_at_start:
              type: string
              title: Ticket state at start
              required: false
              multiple: false
            started_at:
              type: datetime
              title: Started at
              required: false
              multiple: false
            heartbeat:
              type: datetime
              title: Heartbeat
              required: false
              multiple: false
            worktree_path:
              type: string
              title: Worktree path
              required: false
              multiple: false
            log:
              type: text
              title: Log
              required: false
              multiple: false
            closed:
              type: boolean
              title: Closed
              required: false
              multiple: false
            closed_date:
              type: datetime
              title: Closed date
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              description: The run's owning account — comes from the conductor, never the session.
              required: false
              multiple: false
              reference: user
            agent:
              type: string
              title: Agent
              required: false
              multiple: false
            harness:
              type: string
              title: Harness
              description: Id of the agent harness package that drove the session, e.g. claude or codex.
              required: false
              multiple: false
            model:
              type: string
              title: Model
              description: The candidate's configured model, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            model_version:
              type: string
              title: Model version
              description: The candidate's configured exact version, or the raw transcript model id when unconfigured. Empty only when both are unresolved.
              required: false
              multiple: false
            error_log:
              type: text
              title: Error log
              description: Cause of a terminal dispatch/setup failure (state `failed`).
              required: false
              multiple: false
            tokens:
              type: integer
              title: Tokens
              description: First of the six per-run footprint fields (BB-132), written by the run-owning conductor at close. Not the ticket's `time_spent`.
              required: false
              multiple: false
            duration_s:
              type: integer
              title: Duration in seconds
              required: false
              multiple: false
            agent_turns:
              type: integer
              title: Agent turns
              required: false
              multiple: false
            tool_calls:
              type: integer
              title: Tool calls
              required: false
              multiple: false
            user_prompts:
              type: integer
              title: User prompts
              required: false
              multiple: false
            user_prompt_words:
              type: integer
              title: User prompt words
              required: false
              multiple: false
            state_flow:
              type: string
              title: State flow
              required: false
              multiple: false
              computed: true
              readonly: true
            duration:
              type: string
              title: Duration
              description: Humanised closed_date − started_at, e.g. "1m 12s".
              required: false
              multiple: false
              computed: true
              readonly: true
            ticket_identifier:
              type: string
              title: Ticket identifier
              description: 'Design-only. Not a Drupal field: the row reaches the ticket''s identifier through ticket_id, rendered by bb_ticket_identifier_cell as a mono link to the ticket. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_label:
              type: string
              title: State label
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell labels the run state from the bb_run workflow. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            state_tone:
              type: string
              title: State tone
              description: 'Design-only. Not a Drupal field: bb_ticket_state_cell keys the tone on the state (BbRun::STATE_MARKS). Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_label:
              type: string
              title: Conductor label
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell prints the conductor''s label as a mono lease badge. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_mine:
              type: boolean
              title: Conductor is the reader's
              description: 'Design-only. Not a Drupal field: bb_ticket_conductor_cell marks the badge when the conductor belongs to the reader. Present so the badge has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_environment:
        bb_environment:
          title: bakers.build environment
          purpose: A managed deployment target of a project — the thing a ship ticket stamps and a verification ticket verifies against.
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            project_id:
              type: reference
              title: Project
              required: true
              multiple: false
              reference: bb_project
            base_url:
              type: url
              title: Base URL
              required: false
              multiple: false
            tier:
              type: string
              title: Tier
              required: false
              multiple: false
              settings:
                allowed_values:
                  production: Production
                  staging: Staging
                  development: Development
                  other: Other
            branch:
              type: string
              title: Branch
              description: The git branch this environment deploys from.
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      user:
        user:
          title: User
          purpose: A person or app account. Modelled as the entity type `user` with its single bundle, because that is what every reference in this model targets.
          view_modes:
            full:
              template: field-map
            compact:
              template: field-map
              label: Compact
          form_modes:
            default:
              template: field-map
          fields:
            user_picture:
              type: image
              title: Profile picture
              description: Core image field; also switches on social_auth's own avatar download at login (BB-507 D3).
              required: false
              multiple: false
            field_full_name:
              type: string
              title: Full name
              description: Additive (BB-507 D4) — does not replace or derive display_name.
              required: false
              multiple: false
            name:
              type: string
              title: Username
              required: true
              multiple: false
            mail:
              type: string
              title: Email
              required: false
              multiple: false
            status:
              type: boolean
              title: Active
              required: false
              multiple: false
            roles:
              type: string
              title: Roles
              description: Machine names, e.g. bb_session.
              required: false
              multiple: true
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            access:
              type: datetime
              title: Last access
              required: false
              multiple: false
            login:
              type: datetime
              title: Last login
              required: false
              multiple: false
            timezone:
              type: string
              title: Timezone
              required: false
              multiple: false
            display_name:
              type: string
              title: Display name
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the ticket and comment entities expose assignee_initials / author_initials instead. Present so an avatar component has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            pass: Authentication internal; no bakers.build screen renders or edits a password hash.
            init: Authentication internal (initial email); never rendered.
            preferred_langcode: Localisation internal; bakers.build is English-only.
            preferred_admin_langcode: Localisation internal; bakers.build is English-only.
            default_langcode: Entity key for translations; bakers.build users are single-language.
            changed: Drupal's user entity has no `changed` field; `access` and `login` carry recency.
      bb_profile:
        bb_profile:
          title: bakers.build profile
          purpose: 'What a person tells bakers.build about themselves, one per user and workspace (unique on uid + workspace_id): their position, their background handed to AI assistants as context, and their favorite projects. Replaces the user fields field_developer_title and field_bb_background. Edited on the Profile tab /user/{user}/profile for the workspace in context; the entity has no view display.'
          form_modes:
            default:
              template: field-map
          fields:
            uid:
              type: reference
              title: Owner
              required: true
              multiple: false
              reference: user
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            position:
              type: string
              title: Position
              description: Free text, at most 255 characters; placeholder "e.g. Product Lead".
              required: false
              multiple: false
            background:
              type: text
              title: What should bakers.build know about your background?
              description: Optional long text (string_long) handed to AI assistants as context, e.g. "Drupal developer, confident with PHP; little DevOps experience."
              required: false
              multiple: false
            favorite_projects:
              type: reference
              title: Favorite projects
              description: Projects this person marked as favorite in this workspace; not on the form.
              required: false
              multiple: true
              reference: bb_project
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_workspace:
        bb_workspace:
          title: bakers.build workspace
          purpose: 'The tenancy root: the object that says this data belongs to operator X and not operator Y. It holds all people and decides WHICH RIGHTS an account holds — BB-462 makes the workspace the ONLY level that carries rights: admin/contributor/guest (D2). Visibility of a project is a separate, per-team question (D4) that carries no rights of its own. Is an OG group (registered in og.settings) with the roles non-member, member, contributor, lead (labelled "Admin") and guest — five, not six: `owner`/`admin` were already consolidated into `lead` by BB-359 D12, and the machine principal `app` is GONE (BB-462 D9, its rank is answered entirely from OAuth scope now). Built by BB-316; the role set is BB-462''s.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            description:
              type: string
              title: Description
              description: Optional plain text, one or two sentences, at most 280 characters; shown under the workspace's name in the switcher panel and on the join screen, absent when empty.
              required: false
              multiple: false
            image:
              type: image
              title: Image
              description: Optional single image (png, gif, jpg, webp; 2 MB), stored privately and shown uncropped as the workspace's mark in the switcher and on the join screen; initials when absent.
              required: false
              multiple: false
            billing_profile:
              type: object
              title: Billing profile
              description: 'The CONTRACT or SUBSCRIPTION this tenant is served under. Same field type and name as bb_group.billing_profile, deliberately, and a different meaning: contract or subscription at the top, customer cost centre below. There is no `contract` field and there will not be one — the billing profile IS the contract level.'
              required: false
              multiple: false
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
      bb_team:
        bb_team:
          title: bakers.build team
          purpose: 'The stable crew, cutting across customer projects, and since BB-419 also their structural parent: a project is assigned to teams n:m through bb_project.teams and belongs to at least one. BB-462 D4 REVERSES what this field used to say: the assignment now DECIDES VISIBILITY — an account sees exactly the projects of the teams it belongs to (or every project, if it holds the workspace admin tier) — while still granting no RIGHTS of its own; a team answers "what do you see", the workspace alone answers "what may you do" (D2/D3). Is an OG group (registered in og.settings) with the roles non-member, member, lead (BB-456 D9, team-scoped statistics visibility) and owner (BB-462 D3, manages the team itself — who may join it and its own settings). The implicit member rank stays empty by design: team membership is a visibility fact, not a rights tier.'
          view_modes:
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            name:
              type: string
              title: Name
              required: true
              multiple: false
            workspace_id:
              type: reference
              title: Workspace
              required: true
              multiple: false
              reference: bb_workspace
            projects:
              type: reference
              title: Projects
              description: The projects assigned to this team. Derived from bb_project.teams and never stored here, so the two directions cannot disagree.
              required: false
              multiple: true
              reference: bb_project
              computed: true
              readonly: true
            owner_user_id:
              type: reference
              title: Owner
              required: false
              multiple: false
              reference: user
      og_membership:
        default:
          title: OG membership
          purpose: 'Membership is ONE mechanism, modelled once: a user x group row reused by workspace and team rather than re-invented per level. This is NOT a bakers.build invention — it is contrib Organic Groups'' own og_membership entity, whose only bundle is `default` (og.og_membership_type.default). BB-462 D7 REVERSES what this field used to say: og.settings now registers only bb_workspace and bb_team as OG groups — bb_project is deregistered entirely, and every membership row anchored on a project is deleted by that ticket''s migration. BB-318 bridges the remaining rows into bakers.build''s query access. A screen reads membership here, never from a field on the group.'
          view_modes:
            teaser:
              template: field-map
            full:
              template: field-map
          fields:
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            changed:
              type: datetime
              title: Changed
              required: false
              multiple: false
            type:
              type: string
              title: Membership type
              description: OG's bundle key — in code an entity reference to the og_membership_type config entity. Modelled as its value set rather than as a reference because bakers.build ships exactly one instance, og.og_membership_type.default, and no screen renders or chooses it.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - default
            uid:
              type: reference
              title: User
              description: The member. OG's own field name — not `user_id`.
              required: true
              multiple: false
              reference: user
            entity_type:
              type: string
              title: Group entity type
              description: Which level this membership is in. A workspace or project membership grants rights; a team membership does not, because the team carries no permissions.
              required: false
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            entity_bundle:
              type: string
              title: Group bundle
              description: Bundle of the group entity. Each of the three types has one bundle of its own name.
              required: false
              multiple: false
            entity_id:
              type: string
              title: Group entity ID
              description: Id of the group named by entity_type. A plain STRING in OG, not a reference, because the target entity type varies per row — so no screen can rely on an entity-reference widget here.
              required: false
              multiple: false
            state:
              type: string
              title: State
              description: Defaults to active. Only an active membership grants what its roles carry.
              required: true
              multiple: false
              settings:
                allowed_values:
                  - active
                  - pending
                  - blocked
            roles:
              type: reference
              title: Roles
              description: 'MULTI-VALUE (OG sets cardinality unlimited) and a reference to og_role config objects by their full id, e.g. bb_workspace-bb_workspace-lead. The `member` role is never stored: OgMembership::preSave() revokes it and getRoles() prepends it on read, so a row that looks role-less is still a member.'
              required: false
              multiple: true
              reference: og_role
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
            language: Entity key; bakers.build memberships are single-language and no screen renders a language.
      bb_addon:
        bb_addon:
          title: bakers.build addon
          purpose: An addon definition at one version (name@version), registered by the conductors that run it. Entity access is admin-only; workspace leads see the addons in the workspace Settings › Addons tab, one row per name at its newest version with all its versions and the conductors of the current workspace that run each version. The definition is immutable once registered and may carry an inline SVG icon. Read-only on every screen.
          view_modes:
            list_item:
              template: field-map
              label: List item
          fields:
            name:
              type: string
              title: Name
              description: Machine name of the addon, e.g. ports. Together with version it forms the name@version key.
              required: true
              multiple: false
            version:
              type: string
              title: Version
              description: Semantic version string, e.g. 1.2.3.
              required: true
              multiple: false
            contract:
              type: integer
              title: Contract
              description: Version of the addon definition contract the addon implements, e.g. 1.
              required: true
              multiple: false
            definition:
              type: text
              title: Definition
              description: 'Immutable JSON addon definition: label, views, actions and an optional inline SVG icon. The Settings › Addons tab shows only its label and icon.'
              required: true
              multiple: false
            conductors:
              type: reference
              title: Conductors
              description: Conductors that registered (run) this addon version.
              required: false
              multiple: true
              reference: bb_conductor
              settings:
                target_type: bb_conductor
            created:
              type: datetime
              title: Created
              required: false
              multiple: false
            label:
              type: string
              title: Label
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter prints the definition''s label. Present so the headline cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            versions_label:
              type: string
              title: Versions
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter lists every version of the name once, newest first. Present so the Versions cell has a value.'
              required: false
              multiple: false
              computed: true
              readonly: true
            initials:
              type: string
              title: Initials
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter draws the initials of the label. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_color:
              type: string
              title: Avatar colour
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter keys the avatar colour on the addon id. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
            conductor_badges:
              type: string
              title: Conductors
              description: 'Design-only. Not a Drupal field: the bb_addon_conductors formatter renders `conductors` as one dotted badge per conductor and version ("<conductor> <version>", running when online, offline otherwise), or "No conductor in this workspace". The value lists the badges as text; its `_formatted` companion carries the rendered badges.'
              required: false
              multiple: false
              computed: true
              readonly: true
            avatar_picture:
              type: string
              title: Avatar picture
              description: 'Design-only. Not a Drupal field: the bb_addon_definition formatter turns the definition''s inline SVG icon into a data URI; empty for initials. Present so the avatar has a prop.'
              required: false
              multiple: false
              computed: true
              readonly: true
          omitted:
            id: Entity key, not a modelled field.
            uuid: Entity key.
    config:
      image_style:
        avatar:
          aspect_ratio: '1:1'
      omitted:
        bb_core.bb_vocabulary: The vocabulary IS the bb_term bundle; no screen renders it as an object of its own.
        view.environments: Drupal has no environments View, and no list of environments exists yet. The bb_project environments field is hidden on the project full display; only its referenced names show on the project properties detail card (BbEntityDetailCardForm). Ship tickets show their environments as chips in the ticket inspector. The view.environments mapping is ahead of the backend and has no Drupal counterpart.
      og_role:
        og_role:
          title: OG role
          purpose: 'The role vocabulary of the OG groups — what a Settings screen assigns a person on a workspace or a team. Contrib Organic Groups'' own config entity. AS-IS, MEASURED IN config/sync AT BB-462: NINE objects, not ten — bb_project carries no role at all any more (D7 deregisters it as an OG group entirely). Five for bb_workspace (non-member, member, contributor, lead, guest) and four for bb_team (non-member, member, lead, owner). `app` is GONE (D9: a conductor''s OAuth identity is bound to its owning user, so it sees exactly what that user''s own rank sees — no separate machine rank exists to list here). `owner` is NEW (D3): governs the team itself, who may join it and its own settings. The key is the Drupal config-name PREFIX, so this is one entry per config entity TYPE; the instances live in sample data. Three facts a screen must not get wrong. First, `permissions` is NOT an empty list on every role: bb_workspace-lead and -contributor carry real permission strings (create/edit/delete rights), bb_workspace-guest carries read-only, and bb_team-owner carries `manage members`/`update group`. It IS empty on exactly four: the three non-member roles and bb_team-bb_team-member — the implicit member rank is deliberately emptied everywhere (D1: OG ranks are additive and cannot be narrowed, so any right left on an implicit rank is inherited by every membership including guests). Second, `is_admin` is FALSE on all nine. Third, "a workspace admin sees every project of their workspace" (D4) is a VISIBILITY rule computed from the rank id, never an OG admin flag or a project-level role — there is no project-level role left to read at all. TARGET: product roles are OG ranks only; team ownership is the one new rank this ticket adds.'
          fields:
            id:
              type: string
              title: Machine name
              description: Composed as <group_type>-<group_bundle>-<role name>, e.g. bb_workspace-bb_workspace-lead. This full id is what og_membership.roles references.
              required: true
              multiple: false
            label:
              type: string
              title: Label
              description: The human name a Settings screen shows, e.g. "Administrator".
              required: true
              multiple: false
            weight:
              type: integer
              title: Weight
              description: Display order within a group type; 0 for non-member, rising to 5 for the workspace app role.
              required: false
              multiple: false
            is_admin:
              type: boolean
              title: Is admin
              description: FALSE on every shipped role — measured in config/sync at BB-435 across all ten og.og_role objects, and the role it used to name does not exist. Read the role id, never this flag. See the purpose above.
              required: false
              multiple: false
            permissions:
              type: string
              title: Permissions
              description: OG permission strings. Empty in exactly four of the ten shipped roles — the three non-member roles and bb_team-bb_team-member — see the purpose above before designing anything that edits this.
              required: false
              multiple: true
            group_type:
              type: string
              title: Group entity type
              required: true
              multiple: false
              settings:
                allowed_values:
                  - bb_workspace
                  - bb_project
                  - bb_team
            group_bundle:
              type: string
              title: Group bundle
              required: true
              multiple: false
            role_type:
              type: string
              title: Role type
              description: '`required` for the two roles OG creates for every group (non-member, member); `standard` for the roles bakers.build adds. A screen must not offer to delete a required role.'
              required: true
              multiple: false
              settings:
                allowed_values:
                  - required
                  - standard
          omitted:
            uuid: Config entities carry a uuid that is not part of the modelled key set and is never rendered.
            group_id: Null in all ten shipped roles. OG sets it only for a role scoped to one single group instance, which bakers.build ships none of, so no screen renders it.
      view:
        addons:
          title: Addons
          purpose: Lists every registered addon once, at its newest version, with the conductors of the routed workspace that run any of its versions.
          base_table: bb_addon
          items_per_page: 50
          columns:
            - icon
            - label
            - name
            - versions
            - contract
            - conductors
          displays:
            default:
              plugin: default
            settings:
              plugin: page
              path: /_workspace/%bb_workspace/settings/addons
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_addon records the View lists; Drupal renders each row as the addon in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_addon
                  bundle: bb_addon
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        conductors:
          title: Conductors
          purpose: |-
            Two listings of bb_conductor. The user-area rail item (user_list) is the
            conductors assigned to the account in the URL, any workspace. The project
            tab (project_list) is that project's conductors, any owner. Both walk
            project_id then group_id because bb_conductor carries no workspace field
            of its own. Both joins are INNER: a conductor whose project or group is
            gone has no workspace to be listed under.
          base_table: bb_conductor
          items_per_page: 50
          columns:
            - conductor_id
            - label
            - status
            - reported_load
            - owner_user_id
            - last_seen
          displays:
            default:
              plugin: default
            project_list:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/conductors
            user_list:
              plugin: page
              path: /user/%user/conductors
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_conductor records the View lists; Drupal renders each row as the conductor in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_conductor
                  bundle: bb_conductor
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        conductor_tickets:
          title: Conductor tickets
          purpose: |-
            Tickets occupying one conductor. The occupancy source supplies explicit
            numeric ticket ids; this view never lists by ticket conductor_id and has
            no page route.
          base_table: bb_ticket
          columns:
            - identifier
            - title
          displays:
            default:
              plugin: default
            occupancy:
              plugin: embed
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item_compact` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item_compact
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        groups:
          title: Groups
          purpose: Lists the groups of the routed workspace. The Groups page owns the create-group action. A group organizes customer and cost-centre data; it grants no permissions.
          base_table: bb_group
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - description
            - projects
            - changed
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/groups
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_group records the View lists; Drupal renders each row as the group in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_group
                  bundle: bb_group
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        machines:
          title: Machines
          purpose: |-
            The user-area rail item (user_list) is the machines assigned to the
            account in the URL, any workspace.
          base_table: bb_machine
          items_per_page: 50
          columns:
            - name
            - max_parallel
            - current_load
            - owner_user_id
            - last_run
          displays:
            default:
              plugin: default
            user_list:
              plugin: page
              path: /user/%user/machines
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_machine records the View lists; Drupal renders each row as the machine in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_machine
                  bundle: bb_machine
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: text_custom.'
              required: false
              multiple: false
        project_board:
          title: Project board
          purpose: |-
            Four-column project board of bb_ticket on the tickets Search API
            index. The page display owns the route. Each lifecycle column is a
            bb_board_column attachment with its own mini pager. Column membership is the indexed work_state value.
            Parent focus applies to every display; the page header summarizes the whole matching selection.
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - identifier
          displays:
            default:
              plugin: default
            backlog:
              plugin: bb_board_column
            done:
              plugin: bb_board_column
            intake:
              plugin: bb_board_column
            project_board:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/board
            working:
              plugin: bb_board_column
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row with the `fields` row plugin.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: default
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
        projects:
          title: Projects
          purpose: |-
            The projects of the workspace named in the URL, five columns. A LISTING IS A
            VIEW: the row this replaced was a bb_project.bb_project.teaser view mode,
            and BB-389 removed it because a list row was never a view mode.

            THE ROWS COME FROM THE URL, and that is this view's own argument rather than the
            query-access layer's doing. BbWorkspaceReadScope resolves an ACCOUNT's scope —
            the union of every OG membership, with no workspace parameter — so for a user
            who belongs to several workspaces it admits more rows than the URL asked for.
            The `workspace_id` argument narrows to the one workspace, walking the group_id
            relationship because bb_project carries no workspace field of its own. Its
            `default_action` is `access denied` rather than a fallback to all: a view that
            listed every workspace the moment a route stopped supplying the parameter is how
            ambient scoping turns into a disclosure. Query access stays the floor
            underneath — the two layers answer two different questions.

            THE TWO RELATIONSHIPS DISAGREE ABOUT `required` ON PURPOSE. owner_user_id is a
            LEFT JOIN, and the reason stated here used to be that BbProject::owner_user_id
            is not setRequired(TRUE). That is now FALSE — the field has carried
            setRequired(TRUE) since 66780aa93 — and the LEFT JOIN is still right, so only
            the rationale is corrected. setRequired() is a VALIDATION constraint on a write
            to the project; it is not delete protection on the account referenced. bb_core
            guards that nowhere — no preDelete, no cascade, no reference constraint — so a
            stored project can still be left pointing at a deleted user, and an inner join
            on it drops the whole project from this listing the moment that happens: no
            message, no empty cell, no row. group_id stays an INNER JOIN, and for a positive
            reason rather than the same one: it carries the workspace argument, so a project
            whose group is gone has no workspace to be listed under, and the honest answer
            is no workspace rather than every workspace. That the referenced rows can vanish
            at all is a data-integrity gap, not this listing's to paper over.

            TWO DESIGNED COLUMNS ARE ABSENT, NAMED HERE RATHER THAN LEFT TO AN EMPTY SPACE.
            Teams is absent, and the reason stated here used to be that bb_project carries
            no `teams` field at all. That is now FALSE, in the same way the owner_user_id
            sentence above was: BB-419 added `teams` as a required, unlimited-cardinality
            entity_reference (BbProject.php), so the n:m assignment DOES exist and the
            cancelled BB-356 no longer describes the state of the field. What is true is
            that this listing still renders no teams column, and no decision has been
            recorded that it should not — so this is an open question about the listing
            rather than a structural impossibility, and it is named as one here instead of
            being justified by a field that is gone from the reasoning. Environments is
            absent for a reason that does still hold: it is a COUNT over a multi-value
            entity reference and core views has no field for that; a column showing the
            first referenced environment instead of the count would be a different and
            wrong value.

            IT COMPOSES A CANVAS WHOSE HEADING LIVES IN THE SHELL. The screen title,
            tabs and New-project action are the `page_header` island on
            `island.profile.bb_shell`. This display's tree is `bb_theme:canvas`
            with a `bb_theme:zone` in `main` wrapping `view_rows` plus `view_pager`.
            The `empty` area is untouched, because ui_patterns' own `view_rows` source
            renders a view's empty areas when it has no rows.

            THE ROWS ARE STILL CORE'S `table` WITH `row: type: fields`, AND NOT FOR THE
            REASON D1 GAVE. D1 priced the alternative as a bespoke ui_patterns Source, and that
            is not what it costs: a PRESENTER TEMPLATE — a markup-free template that
            transforms what views handed it and include()s the component, reached by core's
            own theme suggestion (ViewExecutable::buildThemeFunctions() emits
            views_view_table__projects) — needs no plugin and would leave this file exactly
            as it is. What IS true is that site building cannot do it: `rows` is a PROP
            holding an array of objects, and no shipped ui_patterns source serves such a
            prop type — ui_patterns_views's view_rows declares `prop_types: [slot]`, and
            across all 22 shipped sources the prop types are attributes, boolean, enum,
            enum_list, enum_set, identifier, links, list, number, slot, string, url and
            variant. That absence is the condition under which a presenter is the right
            answer rather than a trick. BB-413 owns that template; when it lands this
            listing renders through bb_theme:table with no change here.
          base_table: bb_project
          items_per_page: 50
          columns:
            - name_avatar
            - name
            - key
            - description
            - open_tickets
            - conductor_tickets
            - closed_tickets
            - created
          displays:
            default:
              plugin: default
            workspace_list:
              plugin: page
              path: /_workspace/%bb_workspace/projects
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_project records the View lists; Drupal renders each row as the project in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_project
                  bundle: bb_project
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_empty.'
              required: false
              multiple: false
        runs:
          title: Runs
          base_table: search_api_index_bb_runs
          items_per_page: 10
          columns:
            - identifier
            - state
            - state_at_start
            - conductor_id
            - agent
            - started_at
            - duration_s
          displays:
            default:
              plugin: default
            project_runs:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/runs
            team_runs:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/runs
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_run records the View lists; Drupal renders each row as the run in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_run
                  bundle: bb_run
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
        tickets:
          title: Tickets
          base_table: search_api_index_bb_tickets
          items_per_page: 10
          columns:
            - state
            - title
            - priority
            - identifier
            - created
            - owner
            - conductor
            - stall_reason
            - run_count
            - assignee
          displays:
            default:
              plugin: default
            my_work:
              plugin: page
              path: /_workspace/%bb_workspace/tickets
            page_1:
              plugin: page
              path: /_workspace/%bb_workspace/tickets/all
            project_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/project/%bb_project/tickets
            team_tickets:
              plugin: page
              path: /_workspace/%bb_workspace/team/%bb_team/tickets
          view_modes:
            default:
              template: list-view
          fields:
            rows:
              type: view_rows
              title: Rows
              description: bb_ticket records the View lists; Drupal renders each row as the ticket in its `list_item` view mode.
              required: true
              multiple: true
              sample_template:
                template: views
                settings:
                  entity_type: bb_ticket
                  bundle: bb_ticket
                  view_mode: list_item
            items_per_page:
              type: integer
              title: Items per page
              required: false
              multiple: false
            header:
              type: text
              title: Header
              description: 'Drupal header area: views_filters_summary.'
              required: false
              multiple: false
            empty:
              type: text
              title: Empty
              description: 'Drupal empty area: bb_contextual_empty.'
              required: false
              multiple: false
  component: bb_theme:list_item
  bindings:
    - field: identifier
      slot: headline
      wrap:
        component: bb_theme:list_cell
        props:
          key: identifier
        slot: value
    - field: title
      slot: headline
      wrap:
        component: bb_theme:list_cell
        props:
          key: title
          primary: true
        slot: value
  ```

  #### Contract
  ```yaml
  outputs:
    entity-mapping:
      required: true
      schema: {}
      submission: data
      validators:
        - entity-mapping
      path: /var/www/html/web/themes/custom/bb_theme/designbook/entity-mapping/bb_ticket.bb_ticket.list_item_compact.jsonata
      glob: /var/www/html/web/themes/custom/bb_theme/designbook/*/*.*.*.jsonata
  ```

  #### Results
  <!-- done -->

### Step: validate
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:playwright-validate, ctx:component-contract-index, ctx:sdc-components]

- [x] validate — entities-bb-ticket-bb-ticket--list-item

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/entities-bb-ticket-bb-ticket--list-item
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    checks:
      required: true
      schema:
        $ref: '#/definitions/StorybookChecks'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

- [x] validate — entities-bb-ticket-bb-ticket--list-item-mine

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/entities-bb-ticket-bb-ticket--list-item-mine
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    checks:
      required: true
      schema:
        $ref: '#/definitions/StorybookChecks'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

- [x] validate — entities-bb-ticket-bb-ticket--list-item-compact

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/entities-bb-ticket-bb-ticket--list-item-compact
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    checks:
      required: true
      schema:
        $ref: '#/definitions/StorybookChecks'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

- [x] validate — config-view-tickets--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/config-view-tickets--default
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    checks:
      required: true
      schema:
        $ref: '#/definitions/StorybookChecks'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

- [x] validate — config-view-conductor-tickets--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/config-view-conductor-tickets--default
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    checks:
      required: true
      schema:
        $ref: '#/definitions/StorybookChecks'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

- [x] validate — designbook-sections-my-work-scenes--ticket-list

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/designbook-sections-my-work-scenes--ticket-list
  ```

  #### Contract
  ```yaml
  outputs:
    build:
      required: true
      schema:
        $ref: '#/definitions/StorybookBuild'
      submission: data
      validators: []
    checks:
      required: true
      schema:
        $ref: '#/definitions/StorybookChecks'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

