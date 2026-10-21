# Plan: design-screen
<!-- digest: 784ba93863f97a1637af32e4bf7de9c098c3cb4d2644abe3a23af9897c94ae5e -->

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
          Measured on 2026-09-04, against a theme shipping ten hyphenated components: Drupal's own SDC metadata schema admits `^[a-zA-Z0-9_-]+$`; `ComponentPluginManager` normalises nothing, so `bb_theme:active-filters` resolves and `bb_theme:active_filters` raises `ComponentNotFoundException`; and all sixteen stories of those ten rendered in a real browser with zero console errors. The old pattern therefore locked ten working components out of every workflow in this skill, with no defect to show for it.
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
  MappingBinding:
    type: object
    title: Field binding
    description: |
      One source field bound to exactly one component prop or slot. A `path` array selects a structured-field member. `entity` is present only on a reference slot.
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
        description: Target slot name. Exclusive with prop.
        pattern: ^[A-Za-z_][A-Za-z0-9_]*$
        examples:
          - items
          - image
      entity:
        $ref: '#/definitions/MappingChildEntity'
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
  - id: bb_theme:account_switcher
    contract:
      component: account_switcher
      group: Shell
      props:
        type: object
        properties:
          workspace_label:
            type: string
            title: Workspace name
          workspace_initials:
            type: string
            title: Workspace mark initials
          workspace_color:
            type: string
            title: Workspace mark colour key
            enum:
              - running
              - attention
              - unassigned
              - lease
              - offline
          workspace_picture:
            type: string
            title: Workspace picture URL
            description: 'Optional image URL for the current workspace''s mark, shown whole (`image_fit: contain`). Empty or absent: the initials circle.'
          multiple:
            type: boolean
            title: Multiple workspaces
            description: There is more than one workspace to switch to. Renders the disclosure button and panel; false renders a plain label with no chevron and no panel. Default true.
            default: true
          collapsed:
            type: boolean
            title: Collapsed
            description: Show the mark only — the rail is collapsed.
          id:
            type: string
            title: Id
            description: Base id; the workspace panel derives its id from it.
        required:
          - workspace_label
        additionalProperties: false
      slots:
        workspace_panel:
          description: The disclosed workspace list.
          required: false
      variants:
        - id: collapsed
          title: Collapsed
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/account_switcher/account_switcher.component.yml
    hash: 24871b4edea9471e20d39ea62a471cb56e01d368cf532f452fd0156382d44129
  - id: bb_theme:active-filters
    contract:
      component: active-filters
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Accessible name
            description: Names the summary region, so a screen reader reaching it knows the chips describe the list below rather than being controls for it.
          facets:
            type: array
            title: Chosen facets
            description: One entry per facet that has a value. A facet with no value is simply absent — an empty chip would claim a constraint that is not there.
            items:
              type: object
              properties:
                field:
                  type: string
                  title: Field name
                  description: The facet's own name as the operator reads it, e.g. `State`.
                operator:
                  type: string
                  title: Operator
                  description: Overrides the derived operator. Left out, one value reads `is` and several read `is either of`; set it where the field's own vocabulary differs — `includes any of` for labels, `is not` for a negation.
                values:
                  type: array
                  title: Chosen values
                  description: The values themselves, rendered in full. The number of them is what decides the operator when none is given.
                  items:
                    type: string
                remove_url:
                  type: string
                  title: Removal address
                  description: The address this list would be at without this facet — the current URL minus this facet's whole entry, computed by the caller because only the caller knows the address. Left out, the chip renders no dismiss affordance, which is the honest rendering for a caller that cannot answer it.
          empty_label:
            type: string
            title: Unfiltered statement
            description: What the summary says when no facet is chosen, e.g. `All tickets`. Rendered instead of the chips, never beside them — an empty strip would read as a rendering fault rather than as an unfiltered list.
        required: []
        additionalProperties: false
      slots:
        chips:
          description: Already-rendered chips, for a caller that cannot hand over the applied set as data. Filled, it replaces `facets`; rendering to nothing is what states an unfiltered list, so a caller that fills it with an always-present wrapper makes `empty_label` unreachable again.
          required: false
        meta:
          description: Trailing region, right-aligned — on the tickets list the `collection-position` indicator, so "what am I looking at" and "where in it am I" are answered on one line.
          required: false
      variants:
        - id: chips_only
          title: Chips only
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/active-filters/active-filters.component.yml
    hash: 27b48477d4de484fe779cdcdf2232e7f7def6e20576e48f209def9f2eeab3ed7
  - id: bb_theme:badge
    contract:
      component: badge
      group: Data Display
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
            description: A quiet trailing value the label qualifies — a relative time, a count. Rendered in mono at the smallest step so it reads as an annotation of the label rather than a second label.
          list_item:
            type: boolean
            title: Is a list item
            description: 'Emits `role="listitem"`. It is a prop and not a guess because a badge cannot know whether it is a direct child of a `role="list"` container, and `role="list"`/`role="listitem"` must be direct parent and child or a browser drops both. The caller that sets `bb_theme:zone`''s `list: true` around a set of badges sets this too. IT HAS NO CONSUMING SURFACE LEFT: the labels surface used to be the one, and it is a `list` node now — a real `<ul>` of `<li>`, with the badges as cells — so nothing in the theme pairs this prop with a `role="list"` container any more. It is still set by the label mapping, which renders one label standalone and cannot know its container, and it still has a story of its own; removing it is therefore a change to those two as well and belongs to whoever retires them. This is the prop that exists only until a container owns its own items, and the container now does.'
            default: false
        required:
          - label
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/badge/badge.component.yml
    hash: 0d58f81aa338fb1f2866f8a842778909ef57ac6aea803b54c0c501df073b07fc
  - id: bb_theme:board
    contract:
      component: board
      group: Data Display
      props:
        type: object
        properties:
          columns:
            type: array
            title: Columns
            description: 'The columns, in render order, as DATA — never rendered column components, which is what the removed `columns` slot used to take. The order is the board''s: a card does not choose a column, it is placed in one.'
            items:
              type: object
              properties:
                name:
                  type: string
                  title: Phase name
                  description: Phase heading.
                count:
                  type: integer
                  title: Card count
                  description: Legacy count; operational boards derive the visible count.
                dot:
                  type: string
                  enum:
                    - running
                    - attention
                  title: Header tone
                  description: Present where the phase itself has a status worth showing; the header badge then carries the tone and a dot. Absent, the header is the name alone — a dot with nothing to say is worse than no dot.
                cards:
                  type: array
                  title: Cards
                  description: The cards in this column, each a plain-data record of `board-card`'s own props plus the three values its footer line is composed from. Empty or absent, the column shows the `empty` slot.
                  items:
                    type: object
                    properties:
                      identifier:
                        type: string
                        title: Card identifier
                      title:
                        type: string
                        title: Card title
                      status:
                        type: string
                        enum:
                          - running
                          - attention
                          - needs_input
                          - wait
                          - idle
                        title: Derived status
                        description: The card's accent edge, and the tone of the footer's state badge. One value, read twice by design — never two values that can disagree.
                      priority:
                        type: string
                        enum:
                          - p1
                          - p2
                          - p3
                        title: Priority label
                      type:
                        type: string
                        title: Type key
                        description: Drives the card colour. Accepts the short key or the workflow id; the leading prefix is stripped for the lookup.
                      state:
                        type: string
                        title: Workflow state key
                        description: The card's EXACT state, rendered as the LABEL of the footer's dotted badge. The column carries only the phase, so this is the only place the state is legible — and it is text, never colour alone.
                      url:
                        type: string
                        title: Canonical URL
                      lease:
                        type: string
                        title: Machine holding the lease
                        description: 'The machine id, rendered as a mono lease badge with a lock. Absent where no lease is held, and absent rather than empty: a badge with no label would claim a machine owns the card.'
                      assignee_name:
                        type: string
                        title: Assignee name
                      assignee_initials:
                        type: string
                        title: Assignee initials
                        description: The presence of initials is what puts an assignee on the footer at all; an unassigned card renders none rather than an empty avatar.
                      assignee_color:
                        type: string
                        enum:
                          - running
                          - attention
                          - unassigned
                          - lease
                          - offline
                        title: Assignee avatar colour key
                      assignee_id:
                        type: string
                        title: Assignee ID; empty means unassigned
                      lane_id:
                        type: string
                        title: Owner lane ID; empty means unassigned
                      closed_date:
                        type: string
                        title: ISO 8601 closing timestamp; empty means unavailable
                      blocked:
                        type: boolean
                        default: false
          controls_enabled:
            type: boolean
            default: false
            title: Operational controls
          details_default:
            type: boolean
            default: false
            title: Initial Details state
            description: True for developer contexts (including dual roles), false for PM contexts.
          as_of:
            type: string
            title: Clock for closing-date filters
            description: ISO 8601 timestamp used to exclude future closing dates; defaults to the current time.
          filter_title:
            type: string
            title: Filter label
            description: Visible label of the operational people filter. The Project Board preview passes the Drupal control's label; other stories may omit it and keep the generic default.
          filter_options:
            type: object
            title: Filter choices
            properties:
              lanes:
                type: array
                items:
                  type: object
                  required:
                    - value
                    - label
                  properties:
                    value:
                      type: string
                    label:
                      type: string
        required: []
        additionalProperties: false
      slots:
        empty:
          description: 'What a column with no cards shows — a sentence that names WHAT is absent over what period, which is a thing a screen knows and a board does not. ONE slot rather than one per column, exactly as `table` and `list` have one: a slot per column would be a slot per item again, which is the escape hatch the container exists to close.'
          required: false
        toolbar:
          description: Exposed people filter. When filled, the board does not paint its own select. Designbook stories leave this empty and keep the Alpine control.
          required: false
        column_views:
          description: Four paged column displays. When filled, the board does not iterate the columns prop. Designbook stories leave this empty and keep the data columns.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/board/board.component.yml
    hash: f20218bed278a2a549a5178e7de2dc07565b9d30951482302641479e5562c501
  - id: bb_theme:board-card
    contract:
      component: board-card
      group: Data Display
      props:
        type: object
        properties:
          identifier:
            type: string
            title: Identifier
          title:
            type: string
            title: Title
          status:
            type: string
            enum:
              - running
              - attention
              - needs_input
              - wait
              - idle
            title: Derived status (accent edge)
          priority:
            type: string
            enum:
              - p1
              - p2
              - p3
            title: Priority label
          type:
            type: string
            title: Kind — drives the card colour
            description: Accepts the short type or the bb_<type> workflow id; the leading bb_ is stripped for the colour lookup.
          state:
            type: string
            title: Workflow state key (e.g. backlog, todo, coding)
          blocked:
            type: boolean
            title: Blocked
            default: false
            description: A dependency marker, independent of health and workflow state.
          url:
            type: string
            title: Canonical URL
          lease:
            type: string
            title: Machine holding the lease
            description: Rendered in the footer when the footer slot is empty. Absent rather than empty when no lease is held.
          assignee_name:
            type: string
            title: Assignee name
          assignee_initials:
            type: string
            title: Assignee initials
          assignee_color:
            type: string
            enum:
              - running
              - attention
              - unassigned
              - lease
              - offline
            title: Assignee avatar colour key
        required:
          - identifier
          - title
        additionalProperties: false
      slots:
        footer:
          description: 'Footer line, in this order: the lease badge where a lease is held, a spacer, a dotted badge whose label is the card''s EXACT workflow state as text (spec, diagnose, pre_deployment — the column carries only the phase), then the assignee. When this slot is empty the card composes that line from its lease, state and assignee props. The state must never be conveyed by colour alone: the badge''s label is what names it, while its dot and the card''s accent edge encode the derived status.'
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/board-card/board-card.component.yml
    hash: 5ddd6a18a37d47e652d9ff538f2115f4c43029aaa8837ed67af3c5d635840ca8
  - id: bb_theme:brand
    contract:
      component: brand
      group: Shell
      props:
        type: object
        properties:
          size:
            type: string
            enum:
              - default
              - compact
            title: Size
            description: '`default` is the full mark onboarding uses. `compact` is the 128px mark the gate chrome uses, so a gate page''s message rather than its mark is the dominant element. Compact marks are images, leaving the screen its h1; their geometry comes from `component.brand.compact.*` and does not follow the layout density.'
            default: default
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/brand/brand.component.yml
    hash: 6085734d03be52bc0ae373c1571b583abbe9bfe74745bf751b9dafa20043136b
  - id: bb_theme:breadcrumb
    contract:
      component: breadcrumb
      group: Layout
      props:
        type: object
        properties:
          label:
            type: string
            title: Accessible name
            description: aria-label for the trail. Defaults to Breadcrumb.
          items:
            type: array
            title: Crumbs
            description: Ordered trail. Each item has a label; url is optional and omitted on the current place.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Label
                url:
                  type: string
                  title: URL
              required:
                - label
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/breadcrumb/breadcrumb.component.yml
    hash: 6edbcb59f44cb811d7039905ec7de84fbea0d08bfb7d07e325468373ed3606a9
  - id: bb_theme:button
    contract:
      component: button
      group: Action
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
          href:
            type: string
            title: Href
            description: When set the control renders as an anchor instead of a button.
          type:
            type: string
            title: Button type attribute
            enum:
              - button
              - submit
              - reset
          disabled:
            type: boolean
            title: Disabled
          icon_only:
            type: boolean
            title: Icon only
            description: Render the icon alone and move the label into aria-label.
          tone:
            type: string
            enum:
              - wait
              - attention
              - running
              - critical
              - idle
            title: Tone
            description: Optional fill from the badge token vocabulary, for a control that is also a labelled state (Board work-state and priority chips). When set it replaces the variant colours. The label still names the value.
        required:
          - label
        additionalProperties: false
      slots:
        icon:
          description: Optional leading icon rendered before the label.
          required: false
      variants:
        - id: neutral
          title: Neutral
        - id: primary
          title: Primary
        - id: ghost
          title: Ghost
        - id: danger
          title: Danger
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/button/button.component.yml
    hash: ee5192cc4f14d86cc8a36c851add215d824738972ca77fd2d278a1f461c8be98
  - id: bb_theme:canvas
    contract:
      component: canvas
      group: Layout
      props:
        type: object
        properties: {}
        required: []
        additionalProperties: false
      slots:
        header:
          description: Full-width region above the grid — normally a `page_header`, which owns the screen's single `<h1>` and, on an entity place, its tabs.
          required: false
        filters:
          description: 'Leading 236px aside, sticky and absent when unfilled — normally a `filters` component. It is a region of the canvas rather than a layout of its own, so a list screen and a detail screen share one grid (D8). BEING STICKY MAKES IT A STACKING CONTEXT, which is why it also carries a `z-index` above the content grid (`lg:z-40`, below `dialog`''s 50): without one, `main`''s positioned table cells paint over every panel a facet control in this aside opens, and the panel becomes unclickable while staying reachable by keyboard (BB-413 R8). The cure is the `z-index` rather than dropping the stick or clipping the aside — a facet opened low in a long list must be able to open past this aside''s own bottom edge.'
          required: false
        main:
          description: 'The main region — `minmax(0,1fr)`, so it can shrink beside its asides instead of forcing the grid wider. It carries the screen''s route-bearing content: the entity, the view''s rows, the board. It is a vertical stack with a `space-5` gap, so the region owns the rhythm between its children; a single child stretches to the full width.'
          required: false
        inspector:
          description: 'Trailing 320px column, sticky and absent when unfilled — normally an `inspector` of `meta_row` properties. Named for its canonical filler, as `header` is for `page_header`. The `sticky` sits on the grid ITEM, as `filters`'' does, so its containing block is the full-height grid area rather than a cell `self-start` has shrunk to its content (BB-414). WHEN A STORY COMPOSES THIS SLOT, the inspector''s rail is ONE `list` node: a container owns its items, so two properties are two ITEMS of one list rather than two entry components. That is a fact about `list` and `inspector`, not about this component — `canvas` is unchanged by it; only what a story composes into the slot is.'
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/canvas/canvas.component.yml
    hash: 352a315e5ea47bd7573b8a6316ea5abaa417cb1ca7dbc16b2826f29db08b59b0
  - id: bb_theme:collapsible
    contract:
      component: collapsible
      group: Layout
      props:
        type: object
        properties:
          open:
            type: boolean
            title: Open
            default: false
            description: Whether the collapsible starts open. Rendered with `{% if open %}` gating the `open` attribute, so the closed state still renders correctly when the prop is false or absent.
        required: []
        additionalProperties: false
      slots:
        label:
          description: Summary content — the always-visible heading row that toggles the collapsible.
          required: false
        content:
          description: The collapsible content, hidden until it is opened. When it is empty the component renders nothing, using `zone`'s emptiness test.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/collapsible/collapsible.component.yml
    hash: 27bbc8046fa0ccc426fa30cae3dd92d957fb538d516a57402cae5f528ebb84fc
  - id: bb_theme:collection-position
    contract:
      component: collection-position
      group: Data Display
      props:
        type: object
        properties:
          from:
            type: integer
            title: First shown position (1-based)
          to:
            type: integer
            title: Last shown position (1-based)
          total:
            type: integer
            title: Collection size
            description: When absent or null the label degrades to an honest `?` rather than a zero or a guess.
          noun:
            type: string
            title: Plural noun for the collection
            description: Rendered after the total, e.g. `tickets`. Only shown in the known-total case.
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/collection-position/collection-position.component.yml
    hash: 35babdbfb0224be63c6c6fd8e526f6a71bb38c5a0cbbf77e89ae6b68e4801d6a
  - id: bb_theme:copied
    contract:
      component: copied
      group: Data Display
      props:
        type: object
        properties:
          message:
            type: string
            title: Message
            description: The confirmation text. Empty renders the overlay hidden.
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/copied/copied.component.yml
    hash: 603dc9d8cd399a5e9460fee5d28788c859ddcd525ecb7116a51ab2fb46286567
  - id: bb_theme:dialog
    contract:
      component: dialog
      group: Shell
      props:
        type: object
        properties:
          open:
            type: boolean
            title: Open
            description: The dialog's own open state, rendered as the open attribute.
          title:
            type: string
            title: Title
            description: Rendered in the title row, and referenced by aria-labelledby unless label overrides the name.
          label:
            type: string
            title: Accessible label
            description: Overrides the accessible name when it must differ from the visible title. It replaces the aria-labelledby reference rather than sitting beside it, because aria-labelledby wins the name computation and would leave this dead.
          id:
            type: string
            title: Id
            description: Id a trigger elsewhere points its aria-controls at; the title derives its own id from it.
          dismissible:
            type: boolean
            title: Dismissible
            description: Render the ghost icon-only close button in the title row.
        required:
          - title
        additionalProperties: false
      slots:
        context:
          description: The head's breadcrumb segment, rendered before the title with a separator. Holds the context control — an option_picker carrying the project or team the surface acts in, pre-filled from context and changeable. It is deliberately not part of the body, because context is not a field.
          required: false
        message:
          description: 'Form-level refusal or note, rendered above the body: a server 422, a missing project, an empty title. Normally a message component with status error.'
          required: false
        body:
          description: The dialog's content — the form's fields, or the prose of a confirmation.
          required: false
        actions:
          description: The action row. Exactly one submit plus cancel for a create or edit; two actions for a confirmation.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/dialog/dialog.component.yml
    hash: 19958ad6855a3e2e651d9e2447dad221905c9dd61a96e0044e8eea90bd8b4747
  - id: bb_theme:empty-state
    contract:
      component: empty-state
      group: Data Display
      props:
        type: object
        properties:
          message:
            type: string
            title: Message
            description: What is absent, and over what period. A full statement, not a placeholder.
          icon:
            type: string
            title: Icon
            description: Small decorative icon beside the existing list message; defaults to inbox.
          compact:
            type: boolean
            title: Compact
            description: Compact list usage; the existing message is preserved.
        required:
          - message
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/empty-state/empty-state.component.yml
    hash: 4dbfb8ae5ba5adb267bb25e885c1037c4270135f2eca1e2ce898f0b45ba47b5d
  - id: bb_theme:event
    contract:
      component: event
      group: Data Display
      props:
        type: object
        properties:
          author_name:
            type: string
            title: Author name
          author_initials:
            type: string
            title: Author initials
          author_color:
            type: string
            enum:
              - running
              - attention
              - unassigned
              - lease
              - offline
            title: Author avatar colour key
          role:
            type: string
            enum:
              - agent
              - human
            title: Author role tag
          tag:
            type: string
            title: Tag — free text; drives the typed accent when it is a known value, otherwise renders with the neutral accent. Absent renders no tag.
          timestamp:
            type: string
            title: Posted-at label
          body:
            type: string
            title: Rendered body markup; absent when the structured lead is used
          subject_label:
            type: string
            title: Subject label, shown first and linked when subject_url is set
          subject_url:
            type: string
            title: Subject URL
          statement:
            type: string
            title: What happened, after the subject
          facts:
            type: array
            items:
              type: string
            title: Secondary facts, joined by middots
          links:
            type: array
            items:
              type: object
              properties:
                title:
                  type: string
                url:
                  type: string
            title: Links after the facts
          detail:
            type: string
            title: One preformatted line, e.g. an error
        required:
          - author_name
          - author_initials
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/event/event.component.yml
    hash: aec7d40f41c5534f84cb5f23b9ed334abfcbd0fc9938d5a1314c8d1805d41c8a
  - id: bb_theme:filters
    contract:
      component: filters
      group: Layout
      props:
        type: object
        properties:
          title:
            type: string
            title: Aside heading
            description: Small heading above the controls, e.g. `Filters`. Rendered as an eyebrow, and it IS the `<summary>` the collapse is operated by — omit it and the panel gets a chevron-only toggle.
          label:
            type: string
            title: Accessible name
            description: The region's own accessible name — the aside's in `panel`, the search landmark's in `bar` — since a heading alone does not name it for a screen reader.
          collapsed:
            type: boolean
            title: Filter panel collapsed
            default: false
            description: 'Whether the filter panel starts collapsed. Named for the deviation rather than for the state — `collapsed` and not `open` — because the panel''s resting state is EXPANDED: a filter panel nobody can see is not a filter panel, so an absent prop must leave the controls visible. `sidebar` names its own collapse the same way. It is passed through to the composed `collapsible` as `open: not collapsed`. What it no longer does is hand the width back to the results: the 236px track belongs to `canvas` now, which is the price of this component not owning a layout.'
          layout:
            type: string
            enum:
              - panel
              - bar
            default: panel
            title: Layout
            description: '`panel` (default) is the collapsible aside of facet controls, filled with `bg-app` so it reads as a surface. `bar` is the search toolbar directly above the rows: a `role="search"` region with the same surface, no heading and no collapse, whose controls form one wrapping row — the first control grows, later ones keep their own width — and which submits its fields'' form itself (a select on change, a text field 500ms after typing), because those fields sit outside the exposed `<form>`. `title` and `collapsed` apply to `panel` only.'
        required: []
        additionalProperties: false
      slots:
        controls:
          description: The narrowing controls, one per field, stacked in the aside. Normally `option_picker` components — the same pill grammar the dialogs use, so a filter reads and announces itself exactly like a property. Renamed from `facets` with the vocabulary (D8).
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/filters/filters.component.yml
    hash: f26fcdeca912be00aec8645cdcabab66cb056c46362caafd4d2bf62661e9db6b
  - id: bb_theme:form
    contract:
      component: form
      group: Form
      props:
        type: object
        properties:
          lead_label:
            type: string
            title: The name of the lead row
            description: The accessible name of the row that holds the lead — the field name of the one property that is not a peer. A prop rather than a reading off the lead itself, because the lead is rendered by the caller. Omit it and the row carries no group role.
        required: []
        additionalProperties: false
      slots:
        lead:
          description: The property that constrains the rest, or cannot be changed cheaply afterwards. It sits on its own row above the lines, separated by a rule, and renders heavier — a property_pill with prominent set. AT MOST ONE, a cardinality this slot cannot express and the form display enforces instead. Omit it and no lead row is rendered.
          required: false
        lines:
          description: A large title line and a smaller description line beneath it — `bb_theme:form_input` / `bb_theme:form_textarea` (BB-420 Task 31 retired the bespoke, borderless `text_line`; every editable field is now a real form element, which costs the no-box, no-border look this surface used to have here). Each line carries its identity in its placeholder. The title is an input and the description a textarea, because a title is one line and a description is not.
          required: false
        pills:
          description: Every peer property of the surface, as a property_pill in one row that wraps rather than stacks. It is one row and not a list of rows because that is the rule; a vertical stack of pills is the labelled form this grammar rejects.
          required: false
        actions:
          description: 'One primary submit plus one secondary action, which is Cancel or a create-another toggle and never a second submit. Left EMPTY where the form is the body of a dialog: the hull already renders an action row of its own, and two would be two answers to "how do I finish".'
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/form/form.component.yml
    hash: 124294aed03cef25c78b1b1cc2c1dea66fed8be5f4d18862092582699bb8d970
  - id: bb_theme:form_input
    contract:
      component: form_input
      group: Form
      props:
        type: object
        properties:
          type:
            type: string
            title: HTML input type
          name:
            type: string
            title: Name attribute
          id:
            type: string
            title: ID attribute
          value:
            type: string
            title: Value
          placeholder:
            type: string
            title: Placeholder
          autocomplete:
            type: string
            title: Autocomplete token
          required:
            type: boolean
            title: Required
          disabled:
            type: boolean
            title: Disabled
          readonly:
            type: boolean
            title: Readonly
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/form_input/form_input.component.yml
    hash: 675b45a60e704968c3d2e5e1bbff40de03186621e4a969a079bec026f407fd8f
  - id: bb_theme:form_label
    contract:
      component: form_label
      group: Form
      props:
        type: object
        properties:
          for:
            type: string
            title: For (target input id)
          title_display:
            type: string
            enum:
              - before
              - after
              - invisible
            title: Title display
          inline:
            type: boolean
            title: Inline (checkbox/radio row label)
        required: []
        additionalProperties: false
      slots:
        title:
          description: The label text content.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/form_label/form_label.component.yml
    hash: 2e6396a466af4f1480b4f52bd6cb92724f5fc6af400443dc216c14a4e314015b
  - id: bb_theme:form_select
    contract:
      component: form_select
      group: Form
      props:
        type: object
        properties:
          name:
            type: string
            title: Name attribute
          id:
            type: string
            title: ID attribute
          options:
            type: array
            title: Options
            description: 'Options in display order. An entry is `{ value, label, selected }`; an entry with `type: optgroup` groups its own `options` under `label`.'
            items:
              type: object
              properties:
                type:
                  type: string
                  enum:
                    - option
                    - optgroup
                  title: Entry type
                value:
                  type: string
                  title: Value
                label:
                  type: string
                  title: Label
                selected:
                  type: boolean
                  title: Selected
                options:
                  type: array
                  title: Group options
                  items:
                    type: object
                    properties:
                      value:
                        type: string
                      label:
                        type: string
                      selected:
                        type: boolean
          multiple:
            type: boolean
            title: Multiple
          required:
            type: boolean
            title: Required
          disabled:
            type: boolean
            title: Disabled
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/form_select/form_select.component.yml
    hash: 5b18b23cf6d6e55e535d1a0be372bf454de0c11748f098f2f1ccff2d8474d053
  - id: bb_theme:form_textarea
    contract:
      component: form_textarea
      group: Form
      props:
        type: object
        properties:
          name:
            type: string
            title: Name attribute
          id:
            type: string
            title: ID attribute
          value:
            type: string
            title: Value
          placeholder:
            type: string
            title: Placeholder
          rows:
            type: integer
            title: Visible row count
          autocomplete:
            type: string
            title: Autocomplete token
          required:
            type: boolean
            title: Required
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/form_textarea/form_textarea.component.yml
    hash: a34d750cfb19a70d0e18017607ee67400514e4db39679f4f519a258a7251f0b0
  - id: bb_theme:gate
    contract:
      component: gate
      group: Shell
      props:
        type: object
        properties:
          title:
            type: string
            title: Title
            description: The card's heading. A prop rather than a slot because it is a scalar the page layout supplies once for every screen this chrome frames.
          description:
            type: string
            title: Description
            description: 'One sentence under the heading, naming what this gate is for. Optional: a chooser whose list speaks for itself needs none.'
        required: []
        additionalProperties: false
      slots:
        mark:
          description: The product mark above the heading. A slot and not a prop because a mark is rendered content — an icon component or an image — and props carry scalar data only.
          required: false
        content:
          description: 'The one region a screen fills. A scene opens with `scene: "design-system:gate"` and fills exactly this, the same way a product screen fills `shell`''s `content`.'
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/gate/gate.component.yml
    hash: 3bfa960e4c9634a4ec56079de63c42d2b56635af77669b2753f8cf10b177174b
  - id: bb_theme:gate_form
    contract:
      component: gate_form
      group: Shell
      props:
        type: object
        properties:
          align:
            type: string
            enum:
              - start
              - center
            title: Alignment
            description: '`center` centres the copy and the action row, for a short decision such as confirming a device sign-in. Default `start`.'
            default: start
        required: []
        additionalProperties: false
      slots:
        content:
          description: The form's rendered children — copy, form items and the action row — in their own order.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/gate_form/gate_form.component.yml
    hash: f65146c06e68936cb783237e2ca67134174d548e1130def0f68f93391e74d0a4
  - id: bb_theme:icon
    contract:
      component: icon
      group: Media
      props:
        type: object
        properties:
          name:
            type: string
            title: Name
            description: Icon id = sprite symbol / source file name (user, team, project, dashboard, eye, arrow-right, lock, alert-triangle, x-circle, info-circle, plus).
          size:
            type: string
            title: Size
            enum:
              - xs
              - sm
              - md
              - lg
              - xl
            default: md
            description: xs 12 · sm 14 · md 16 · lg 20 · xl 24 (px).
        required:
          - name
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/icon/icon.component.yml
    hash: fbf14d0bd08b02377f3ea657209c3907bc66b39a2af7eb6c471857498b1e9e94
  - id: bb_theme:image_crop
    contract:
      component: image_crop
      group: Form
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The image field's label; describes the Edit crop button.
          id:
            type: string
            title: Id
            description: Base id; the dialog title id is derived from it.
          src:
            type: string
            title: Image URL
            description: URL of the original image. Empty until a file is chosen.
          width:
            type: integer
            title: Width
            description: Original width in pixels.
          height:
            type: integer
            title: Height
            description: Original height in pixels.
          crop:
            type: string
            title: Saved crop
            description: JSON {x, y, size} of the saved square; empty for the centred default.
          input_id:
            type: string
            title: File input id
            description: Id of the field's file input; the visible Choose button is its label. Absent when a saved file replaces the input.
          hint:
            type: string
            title: Hint
            description: Accepted formats, shown under the buttons.
        required:
          - label
        additionalProperties: false
      slots:
        upload:
          description: The field's own file input, kept in the document and visually hidden.
          required: false
        remove:
          description: The field's Remove button, present for a saved file.
          required: false
        rest:
          description: Hidden values and optional alt or title fields, rendered below the control.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/image_crop/image_crop.component.yml
    hash: fd561600626ed95fe985bdc986a54f4fd1d1731f5603d75d22fd5d57d399ad55
  - id: bb_theme:inspector
    contract:
      component: inspector
      group: Layout
      props:
        type: object
        properties:
          surface:
            type: boolean
            title: Surface
            description: 'Default false. When true the rail is ONE lifted panel (`bg-surface`, `border-border-2`, `rounded-sm`, `p-4`) and every DIRECT child of `rows` is a block: blocks are separated by exactly one quiet divider, with the block rhythm set here, and the footer is the last block behind one divider. Rows inside a block should use `list` layout `plain`, which draws no line of its own, so no line ever doubles. Without it the rail renders exactly as before.'
        required: []
        additionalProperties: false
      slots:
        rows:
          description: The meta_row components, in the fixed order the caller's fields are read.
          required: false
        footer:
          description: 'Optional intervention footer at the bottom of the rail, after a divider (GitHub issue-sidebar pattern): the exceptional actions a human may take on the record — a danger outline Cancel ticket — and a low-prominence More settings link. Renders nothing when empty.'
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/inspector/inspector.component.yml
    hash: 74cb860edadf049fddd4dc7b74743fe105ca585093c30a20912f3595e4c9ce9d
  - id: bb_theme:link-group
    contract:
      component: link-group
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: Small uppercase eyebrow header rendered above the rows.
          links:
            type: array
            title: Links
            description: 'One row per link, dispatched on `kind`: the report row (title, counts, duration) for `report`, the plain row (icon, title) otherwise. Ignored when the `rows` slot is filled.'
            items:
              type: object
              properties:
                url:
                  type: string
                  title: URL
                title:
                  type: string
                  title: Link title
                kind:
                  type: string
                  title: Link kind
                  enum:
                    - mr
                    - branch
                    - ci
                    - report
                    - ddev
                    - design
                    - doc
                target:
                  type: string
                  title: Link target
                  description: _blank (default) opens a new tab. _self stays in this tab for in-app pages.
                  enum:
                    - _blank
                    - _self
                passed:
                  type: integer
                  title: Passed count
                failed:
                  type: integer
                  title: Failed count
                duration:
                  type: string
                  title: Duration label
        required: []
        additionalProperties: false
      slots:
        rows:
          description: Composition escape hatch — row markup the caller places itself, for a case the `kind` dispatch does not cover. Wins over the `links` prop when filled.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/link-group/link-group.component.yml
    hash: 68199f555a61724caf8786a6b030b423899926161d29e4f3f3b462b7b155aa1f
  - id: bb_theme:list
    contract:
      component: list
      group: Data Display
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
            description: 'The two densities the tree actually has, and the reason this is a prop rather than a second component: the items and the cells are identical, only the treatment differs. `lines` is dense — one line per item, a hairline between them, no surface of its own — and it is the run list. `cards` gives each item its own surface, border and radius, and it is the members list, whose entries are read one at a time rather than scanned down. `plain` is a block''s property rows — no line, hover fill or inset; the enclosing block carries the separation, and the label cell takes a fixed `w-28` track. Default `lines`.'
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
                    - wait
                    - idle
                  title: Status accent
                  description: The leading status rail. `wait` additionally tints the whole item, because a thing nobody is acting on is the one state the absorbed entries made loud, and the tint is what a `wait` badge's `-ink` colour is legible against.
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
                        title: Cell kind
        required: []
        additionalProperties: false
      slots:
        empty:
          description: What to show when there is nothing to list — a sentence that names WHAT is absent, which is a thing a screen knows and a listing does not. It is the only slot, and it is content because a sentence is content.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/list/list.component.yml
    hash: 6193dd01bee7ed6c94ec8a1966dd9ab51a1531e4af339724d895bc749cfa6e88
  - id: bb_theme:log-viewer
    contract:
      component: log-viewer
      group: Data Display
      props:
        type: object
        properties:
          text:
            type: string
            title: Log text
            description: The raw log. Rendered verbatim with whitespace preserved; never treated as markup.
          caption:
            type: string
            title: Caption
            description: What this log is, e.g. "Error log". Rendered with the line count beside it.
        required:
          - text
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/log-viewer/log-viewer.component.yml
    hash: 924cd447d17e43d6942288c4c483ec00387179cd0b6a2082eaee1428de272b4e
  - id: bb_theme:menu_item
    contract:
      component: menu_item
      group: Shell
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
          url:
            type: string
            title: URL
          current:
            type: boolean
            title: Current
            description: The row is the reader's current location.
            default: false
          mark:
            type: object
            title: Mark
            description: 'Optional leading mark, rendered as a compact `person` (`sm`, image shown whole): the entry''s image, else its initials.'
            properties:
              initials:
                type: string
                title: Initials
              color:
                type: string
                enum:
                  - running
                  - attention
                  - unassigned
                  - lease
                  - offline
                title: Colour key
              picture:
                type: string
                title: Picture URL
          description:
            type: string
            title: Description
            description: Optional secondary text beneath the label, its line breaks kept; absent when empty.
        required:
          - label
          - url
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/menu_item/menu_item.component.yml
    hash: 90a78271a16028940bc033506afc5f00d2c157f73bff8919a44926e64c1392ee
  - id: bb_theme:message
    contract:
      component: message
      group: Data Display
      props:
        type: object
        properties:
          status:
            type: string
            enum:
              - status
              - warning
              - error
            title: Status
            description: Tint, border and icon. status = teal, warning = amber, error = red.
        required: []
        additionalProperties: false
      slots:
        body:
          description: The message text / rendered Drupal messages for this status region.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/message/message.component.yml
    hash: fe6824d9e57c46ac6a910205bd059da27bbd92d12f4fc3ffcae730ccc713c6d4
  - id: bb_theme:mode_toggle
    contract:
      component: mode_toggle
      group: Action
      props:
        type: object
        properties:
          mode:
            type: string
            enum:
              - light
              - dark
            title: Mode
            description: Current colour mode, for static rendering only -- the runtime source of truth is html[data-mode], read and flipped by js/skin.src.js.
          label:
            type: string
            title: Accessible label
            description: aria-label for the button.
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/mode_toggle/mode_toggle.component.yml
    hash: c01921678f4053b88263cfb942b1ede29a0a5e54ac932bb0ac85298ae04055b0
  - id: bb_theme:nav
    contract:
      component: nav
      group: Navigation
      props:
        type: object
        properties:
          items:
            type: array
            title: Items
            description: Menu tree. A link entry carries title, url, icon and in_active_trail; a group heading carries title and heading, and may carry icon. Any entry may carry open, mark, action, menu and below.
            items:
              type: object
              properties:
                title:
                  type: string
                  title: Title
                url:
                  type: string
                  title: Url
                  description: The destination. A group heading has none.
                full_page:
                  type: boolean
                  title: Full page
                  description: Disable inherited HTMX boost for a full document navigation.
                  default: false
                at_end:
                  type: boolean
                  title: At end
                  description: Start a group anchored at the bottom of the available navigation space.
                  default: false
                icon:
                  type: string
                  title: Icon
                  description: Sprite symbol id rendered before the label. Replaced by mark when both are set.
                in_active_trail:
                  type: boolean
                  title: In active trail
                heading:
                  type: boolean
                  title: Group heading
                  description: 'Render the whole row as one disclosure button rather than as a link: no href, no aria-current, and the children are not indented.'
                open:
                  type: boolean
                  title: Open
                  description: Per-entry disclosure state. Overrides the coarse expanded prop, which is what makes "Workspace and Teams open, Settings closed" expressible.
                mark:
                  type: object
                  title: Mark
                  description: An initials mark rendered through `person` in place of the icon. What distinguishes a team row from an icon-led entry, in the collapsed rail too.
                  properties:
                    initials:
                      type: string
                    color:
                      type: string
                      enum:
                        - running
                        - attention
                        - unassigned
                        - lease
                        - offline
                action:
                  type: object
                  title: Row action
                  description: One create affordance, rendered as the button component in its ghost + icon_only variant. Earned only by a row that IS the list receiving the addition; a row that merely links to a screen carries none.
                  properties:
                    icon:
                      type: string
                    label:
                      type: string
                    href:
                      type: string
                      title: Href
                      description: Optional destination. Renders the existing action control as a link when set.
                    attributes:
                      title: Attributes
                      description: Optional Drupal Attribute object forwarded to the action control, including dialog request attributes.
                menu:
                  type: object
                  title: Dot menu
                  description: 'One overflow menu: a disclosure over a ul[role=menu] of role=menuitem links. Deliberately not option_picker/option_list, whose role=option would announce an action as a selectable value.'
                  properties:
                    label:
                      type: string
                    open:
                      type: boolean
                    items:
                      type: array
                      items:
                        type: object
                        properties:
                          label:
                            type: string
                          url:
                            type: string
                below:
                  type: array
                  title: Children
          collapsed:
            type: boolean
            title: Collapsed
            description: 'Icon-only rendering: labels, row actions and dot menus are hidden. Link rows stay as their icons, a group heading that carries an icon stays as that icon, and team rows stay as their marks. A heading without an icon is hidden.'
          expanded:
            type: boolean
            title: Sub-navigation disclosed
            description: Coarse default for every disclosure. Defaults to true for the settings_open variant; an entry in the active trail is disclosed regardless, and a per-entry open wins over both.
          id:
            type: string
            title: Id
            description: Base id; every disclosure panel derives its id from it.
          label:
            type: string
            title: Accessible label for the navigation landmark
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: main
          title: Main
        - id: settings_open
          title: Settings open
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/nav/nav.component.yml
    hash: f40990111b82a63b6c8d164746ae3f4fba2eb9ef07378b12e2fba99a39176a74
  - id: bb_theme:note
    contract:
      component: note
      group: Data Display
      props:
        type: object
        properties:
          lead:
            type: string
            title: Lead
            description: 'The short state the note follows from, rendered slightly stronger before the body — e.g. `Set` or `Cleared`. Optional: a note that has no state to lead with renders its body alone.'
          tone:
            type: string
            enum:
              - neutral
              - attention
            title: Tone
            description: Which colour the leading hairline takes, and the ONLY thing a tone may change. `neutral` is the default and means nothing at all, which is what an aside beneath a control should mean. `attention` is for a note a reader must not skim past; it tints the rule and stops there, because an icon or a background here would be a status announcement for something that has not happened.
            default: neutral
        required: []
        additionalProperties: false
      slots:
        body:
          description: What will happen, in one plain sentence, in the future tense. It has not happened yet — that is the whole difference between this and a message.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/note/note.component.yml
    hash: 50f357ce93996e8f7f4ba927687795f29e12f1d6c278c8f899feaa4e44256300
  - id: bb_theme:onboarding
    contract:
      component: onboarding
      group: Shell
      props:
        type: object
        properties:
          title:
            type: string
            title: Title
            description: Current-step heading, and the frame's single h1.
          description:
            type: string
            title: Description
            description: One sentence explaining the current step.
        required: []
        additionalProperties: false
      slots:
        mark:
          description: The product mark, above the step's heading.
          required: false
        content:
          description: The wizard form, inside the surface card below the copy.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/onboarding/onboarding.component.yml
    hash: 6a74064fbb336cc9b75929e6a7647dbd449ca41e992f082865ffc23361e7b08c
  - id: bb_theme:option_list
    contract:
      component: option_list
      group: Action
      props:
        type: object
        properties:
          clearable:
            type: boolean
            title: Clearable
            description: Prepend the clear row as the first row of the list. It carries the same marker as every other row and shows the checkmark when nothing else is selected, which is what makes "cleared" a value the operator picks rather than an absence they have to produce.
          clear_label:
            type: string
            title: Clear row label
            description: 'Label of the clear row. Defaults to an em-dashed none marker: — none —. Name the field''s own empty state where it reads better ("No conductor").'
          clear_url:
            type: string
            title: Clear row address
            description: 'The address this list would be at with nothing chosen. Given one, the clear row becomes a LINK to it — which is how a facet is reset without submitting anything. The row carries no form control of its own, deliberately: an empty submitted value in a GET query is a real constraint to a search backend rather than the absence of one, so a control here narrowed the result set to nothing instead of widening it. Omit it where clearing is a no-op, i.e. where nothing is chosen; the row then stays the presentational marker that says so. A caller that holds no address renders no link rather than a dead one.'
          clear_control:
            type: boolean
            title: Clear row is a form control
            description: Default false. When true on a single-value control list with `clearable` and no `clear_url`, the clear row is a radio of the same name posting "", so a form can empty the field. Opt-in, because for a facet an empty value matches nothing. Ignored for a multi-value list.
          creatable:
            type: boolean
            description: Append a create row as the LAST row of the panel, so a picker can offer to create the thing being looked for without leaving the dialog. It is a button in a presentational row rather than a listbox option, because an action is not a value. Rendered and reachable; it writes nothing here.
            title: Creatable
          create_label:
            type: string
            title: Create row noun
            description: 'The thing being created, as it reads in the invitation: "label" gives "+ New label". The disclosure handler replaces the invitation with the typed query when there is one.'
          input_name:
            type: string
            title: Form control name
            description: When set, every row carries a real form control of this name, so the list SELECTS rather than merely displaying a selection. Without it the rows stay presentational, which is what every caller before the facets needed. The control is what makes a facet operable with JavaScript disabled — the same standard the panel's native <details> is held to.
          submit_name:
            type: string
            title: Submit trigger name
            description: 'When set, every option row IS a named submit trigger of the enclosing form — `<button type="submit">` carrying this name and the row''s own value — so picking a value and submitting it are one act. This is the shape an `option_picker` in its `inline` variant needs, and it is what makes that variant''s contract honest instead of worked around: the inline variant emits no hidden inputs "because the pick is the write", so there is no later submit for a value-carrying input to reach. On the server the `name=value` pair identifies which row was pressed — several controls sharing one name and distinguished by value, which is the mechanism a form''s ordinary buttons already use — so reading the pick back needs nothing new. Exclusive with `input_name`, and this one wins: a row cannot be both a value to carry and the submission of that value, and a caller stating both has stated the write-now intention too. Every submit row carries `formnovalidate`, because this control submits ONE field''s value while sitting in a form that may hold another field''s constraint, and the browser refuses a submit for an empty required field before any script sees the event. The clear row and the create row are untouched by this mode: clearing is an ADDRESS and carries no control at all, and creating is already a real button.'
          input_type:
            type: string
            enum:
              - checkbox
              - radio
            title: Control kind
            description: 'Follows the field, not the styling: `checkbox` for a field that holds several values, `radio` for one. Paired with `multiple`, which is the ARIA half of the same fact.'
          multiple:
            type: boolean
            title: Multiple
            description: Mark the listbox multi-selectable. It paints no marker box; in every mode unselected rows show no marker at all and selected rows show only the checkmark, while the marker keeps its fixed space so labels never shift.
          name:
            type: string
            title: Field name
            description: The field this list belongs to. Carried as a data attribute so the disclosure handler and a later write can find the rows of one field.
          options:
            type: array
            title: Options
            description: The rows, in the order they are offered.
            items:
              type: object
              properties:
                value:
                  type: string
                label:
                  type: string
                selected:
                  type: boolean
                description:
                  type: string
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: single
          title: Single
        - id: multiple
          title: Multiple
        - id: form
          title: Form
        - id: submit
          title: Submit
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/option_list/option_list.component.yml
    hash: d2957bdaa847002c775129ef0632c139db43c006f8d6aa21454716c9d215512c
  - id: bb_theme:option_picker
    contract:
      component: option_picker
      group: Action
      props:
        type: object
        properties:
          label:
            type: string
            title: Field name
            description: The field's own name. Shown ON the pill both when nothing is set and beside the value when something is, and used to derive the accessible name when aria_label is not given — so a pill can never be read as a value nor come out nameless. The inline variant omits it visibly, because its row already carries it.
          value_label:
            type: string
            title: Current value label
            description: The displayed value, for a field that holds ONE. Rendered beside the field name on a pill, and it IS the trigger on the inline variant. For several values use value_labels instead — a pre-joined string still renders, as one long value with no count.
          value_labels:
            type: array
            title: Current value labels
            description: 'The selected values as a list, which is what a multi-value field passes. Rendered as the first value plus a `+N` count, so the pill states how many are set instead of hiding it: `multiple` used to be visible only as the `[]` on a submitted input name. The full list still reaches the operator through the title attribute and the accessible name.'
            items:
              type: string
          aria_label:
            type: string
            title: Accessible name
            description: The state-carrying accessible name, in the form "Change conductor. Currently no conductor is set." Rendered for both variants, because with no visible label this is the only name the control has. Derived from label and value_label when omitted, so it is never empty.
          icon:
            type: string
            title: Leading icon
            description: Sprite symbol drawn before the text. A pill is icon plus text; the icon is what makes a row of pills scannable at a glance.
          prominent:
            type: boolean
            title: Prominent
            description: Render this pill visually heavier, for a property that is not a peer of the others in its row. Use it for at most one pill — on the create dialog that is workflow, which decides the ticket's whole state flow and cannot be changed cheaply afterwards. Ignored by the inline variant.
          open:
            type: boolean
            title: Panel open
            description: Drives aria-expanded on the trigger and hidden on the panel. The disclosure handler flips the same two attributes at runtime.
          multiple:
            type: boolean
            title: Multiple
            description: 'The field holds several values at once. Two things follow, and until the second iteration only the first existed: the hidden inputs submit under `name[]` rather than `name`, AND the trigger renders the selection as the first of value_labels plus a `+N` count instead of pretending there is one value. The panel''s side of multi-select belongs to option_list (aria-multiselectable, a marker box per row) and is deliberately not duplicated here.'
          searchable:
            type: boolean
            title: Searchable
            description: Render a search input at the top of the panel. The disclosure handler filters the rendered rows on input, hiding non-matching ones with the hidden attribute. It does not FETCH candidates — that half is still a boundary.
          selected_chips:
            type: boolean
            title: Selected chips
            description: Opt-in. Render each selected value as its own removable chip beside the trigger, identified by value rather than by label index, so two accounts that share a display name can be removed independently. Other pickers keep the first-value-plus-count trigger. A chip's remove control is a type=button and does not submit the enclosing form.
          selected:
            type: array
            title: Selected identities
            description: The currently selected values as `{value, label}` rows. Used when selected_chips is on so a removal names the account it will drop.
            items:
              type: object
              properties:
                value:
                  type: string
                label:
                  type: string
          search_url:
            type: string
            title: Server search URL
            description: With searchable set, the search box fetches option_list rows for the typed text from this URL (as the `q` parameter) and swaps them into the panel instead of filtering the rendered rows, so candidates beyond the first rendered page are found. Unset keeps the local filter.
          search_label:
            type: string
            description: Accessible name of the search box. Defaults to the placeholder, because a placeholder is not a reliable accessible name on its own and this control must have one.
            title: Search field accessible name
          search_placeholder:
            type: string
            title: Search placeholder
          name:
            type: string
            title: Field name
            description: The name the hidden inputs of the field variant submit under.
          values:
            type: array
            title: Selected values
            description: The values the field variant submits as hidden inputs. The inline variant emits none, because the pick is the write.
            items:
              type: string
          id:
            type: string
            title: Id
            description: Base id; the panel derives its id from it unless panel_id is given.
          panel_id:
            type: string
            title: Panel id
            description: Explicit id for the panel, which the trigger points its aria-controls at.
        required: []
        additionalProperties: false
      slots:
        options:
          description: The panel's option rows — normally an option_list component.
          required: false
      variants:
        - id: facet
          title: Facet
        - id: field
          title: Field
        - id: inline
          title: Inline
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/option_picker/option_picker.component.yml
    hash: 1a54efb9956b95f60784c184760f88b58223feff505fe3340641321e78391823
  - id: bb_theme:page_header
    contract:
      component: page_header
      group: Layout
      props:
        type: object
        properties:
          title:
            type: string
            title: Screen title
            description: What this screen is. Rendered as the region's h1.
          description:
            type: string
            title: Sub-line
            description: One line of context beneath the title, where the screen needs it.
        required: []
        additionalProperties: false
      slots:
        breadcrumb:
          description: Optional trail ABOVE the title row, still inside this header. Normally a `breadcrumb` component. Empty is the normal case and renders no extra row — Default and With tabs stay one title row. Not a Drupal breadcrumb region.
          required: false
        leading:
          description: Optional mark to the left of the title — a project logo beside the name. Renders in the title row, outside the h1, so the mark is not part of the heading's accessible name. Filling nothing is the normal case and the title row is unchanged.
          required: false
        heading:
          description: 'Replaces the `title` prop''s plain text INSIDE the h1, for the case where a screen''s heading is the thing being edited. A screen that shows one object — the workspace screen — carries that object''s name as its heading, and the name is a reversible field, so it is edited in place: the heading holds a `bb_theme:form_input` (BB-420 Task 31; formerly the bespoke `text_line`) rather than a string. Filling nothing is the normal case and renders the `title` prop exactly as before. The h1 is kept rather than swapped for a div: an editable heading is still the region''s heading, and a text input contributes its value to the heading''s accessible name.'
          required: false
        actions:
          description: Right-aligned actions this screen owns — typically the icon-only primary add action. Leave it empty on a screen that cannot add, and the affordance is then absent rather than disabled.
          required: false
        tabs:
          description: The faces of an entity place, rendered BELOW the title row and above this header's bottom border so the active tab reads as attached to the body it reveals — normally a `tabs` component. D7 folds them in here rather than into a second chrome component whose only content would be a header and a tab row. Empty on every screen that is not an entity place, and the header then renders exactly one row.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/page_header/page_header.component.yml
    hash: c68588f65d95b6aa5dc50f5c52c34c3feb07f242ba3831a49d9dc9d81e802277
  - id: bb_theme:person
    contract:
      component: person
      group: Data Display
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
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/person/person.component.yml
    hash: 9284c8b604112224d9ad0e50b37adf23feb395dd31d170605ec13a68ced13c56
  - id: bb_theme:property_pill
    contract:
      component: property_pill
      group: Form
      props:
        type: object
        properties:
          name:
            type: string
            title: Submitted field name
          label:
            type: string
            title: Field name shown on the pill
            description: Not optional in practice. It is what the pill shows while nothing is set, and it is what keeps an unset pill from rendering a bare dash.
          value_label:
            type: string
            title: Current value
          value_labels:
            type: array
            title: Current values
            items:
              type: string
          aria_label:
            type: string
            title: Accessible name
            description: The state-carrying accessible name. Left to option_picker to derive from the field name and the value when omitted, so it is never empty — pass it where the derived sentence would not agree in number.
          icon:
            type: string
            title: Leading sprite symbol
          picker_id:
            type: string
            title: Id of the pill and its panel
          prominent:
            type: boolean
            title: The lead of its surface
            description: Renders heavier. Set by the one property that is not a peer of the others; the surface's own lead row is what places it, and the at-most-one rule is enforced where the regions are read.
          open:
            type: boolean
            title: Panel open
          multiple:
            type: boolean
            title: Holds several values
          searchable:
            type: boolean
            title: Render the panel search box
          selected_chips:
            type: boolean
            title: Render each selected value as a removable chip
          selected:
            type: array
            title: Selected identities
            items:
              type: object
              properties:
                value:
                  type: string
                label:
                  type: string
          search_placeholder:
            type: string
            title: Search placeholder
          search_url:
            type: string
            title: Server search URL
            description: Forwarded to option_picker; the search box fetches the rows for the typed text from it.
          fallback:
            type: boolean
            title: Render a no-JavaScript fallback list
            description: Adds the rows as radios (checkboxes when multiple) under the field's name inside noscript, so the field can be set without JavaScript.
          search_label:
            type: string
            title: Search box accessible name
          values:
            type: array
            title: Values submitted as hidden inputs
            items:
              type: string
          clearable:
            type: boolean
            title: Panel carries a clear row first
          clear_label:
            type: string
            title: Label of the clear row
          creatable:
            type: boolean
            title: Panel carries a create row last
          create_label:
            type: string
            title: Noun the create row names
          options:
            type: array
            title: The panel's rows
            description: Plain option data, handed to option_list. Rendered content never reaches this component — the panel is composed here from these values.
            items:
              type: object
              properties:
                value:
                  type: string
                label:
                  type: string
                description:
                  type: string
                selected:
                  type: boolean
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/property_pill/property_pill.component.yml
    hash: 7e64dd11558cbc88d06b4c0e05d3c383720337d38a26b4ea520740f99d4908d6
  - id: bb_theme:rich-text
    contract:
      component: rich-text
      group: Data Display
      props:
        type: object
        properties:
          body:
            type: string
            title: The processed value of one rich-text field
            description: 'Already rendered by the text format — never a raw source string, and never markup a caller assembled. What reaches this prop is what the field formatter produced, which is why it is safe to be a prop at all: it is one value of one field, not a composition. IT IS NOT `required`, AND THAT IS FORCED RATHER THAN LENIENT (BB-414). ui_patterns removes every empty prop value before SDC validates the component — `ComponentElementBuilder::isPropValueEmpty()` returns TRUE for any falsy value and drops the key from `#props` — so a required prop bound to a Drupal field can never be satisfied once the field is empty, and SDC then refuses the ENTIRE render from inside Twig: a ticket with no description answered 500 for the whole screen, not for the About zone. With the requirement gone the template renders nothing at all for an empty body, and the calling `zone` drops itself when its content comes back empty. Measured: `/bakers/ticket/GL-E2E-DROPSH` 500 → 200.'
          size:
            type: string
            enum:
              - default
              - compact
            title: Density
            description: '`default` is the rhythm of a body that is the subject of its region. `compact` tightens the space between blocks and the table cell padding, for a body that is one item of a listing; typography, colours and semantics are identical in both.'
          clamp:
            type: boolean
            title: Clamp a long body
            description: Default false. When true and Alpine runs, a prose body is clamped to five lines and a `Show more` / `Show less` toggle appears only if it overflows; without JavaScript the full text shows. A body containing a table ignores clamp and always renders in full, scrolling horizontally inside the component when it is wider than the region. In clamp mode `attributes` go on a wrapper around body and toggle.
          label:
            type: string
            title: Accessible name of the table scroll region
            description: Used as `aria-label` when the body contains a table and the root is a keyboard-focusable region. Callers pass a name tied to the content context (About uses "Description"; a comment uses "spec by …"). When omitted or blank the component default is "Formatted content". Unused for prose-only bodies, which are not regions.
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/rich-text/rich-text.component.yml
    hash: 99ed5d6b167c9572775d387489efee5a6b2855042fe4dd93c323e5be9b268b22
  - id: bb_theme:segmented_control
    contract:
      component: segmented_control
      group: Action
      props:
        type: object
        properties:
          label:
            type: string
            title: Accessible name
            description: aria-label for the segmented control group (e.g. Closed rows).
          state:
            type: string
            title: Alpine state key
            description: Ancestor Alpine data key for in-page buttons. When set, items with `value` render as buttons that assign this key.
          items:
            type: array
            title: Positions
            description: Ordered mutually exclusive positions. Link filters set url and exactly one active true. In-page filters set value and the sibling `state` prop.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Label
                  description: Position text.
                url:
                  type: string
                  title: URL
                value:
                  type: string
                  title: Value
                  description: In-page filter value assigned to `state` on click.
                active:
                  type: boolean
                  title: Active
                  description: Selected link position; rendered as aria-current=page.
              required:
                - label
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/segmented_control/segmented_control.component.yml
    hash: ed407420204d0c7e270fd5cc00365644b63424c0f6449c729411e4ffe02095aa
  - id: bb_theme:setup_command
    contract:
      component: setup_command
      group: Action
      props:
        type: object
        properties:
          command:
            type: string
            title: Command
            description: The exact command line shown in the pre/code block.
          label:
            type: string
            title: Label
            description: Accessible purpose of the Copy control, used as aria-label.
        required:
          - command
          - label
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/setup_command/setup_command.component.yml
    hash: 30c136368f944b47f84913ca63c7cc01eb3db91c8cdc22c2df6883b2a4b106e7
  - id: bb_theme:setup_paths
    contract:
      component: setup_paths
      group: Action
      props:
        type: object
        properties:
          client:
            type: string
            title: Initial client
            description: Starting Alpine `client` value. Defaults to claude.
          filter_label:
            type: string
            title: Filter label
            description: Accessible name for the Agent segmented control.
          items:
            type: array
            title: Agent positions
            description: Segmented control items with label and value.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Label
                value:
                  type: string
                  title: Value
              required:
                - label
                - value
        required: []
        additionalProperties: false
      slots:
        intro:
          description: Line above the panels, typically "Install the bakers.build plugin first".
          required: false
        claude:
          description: Commands shown when client is claude.
          required: false
        codex:
          description: Commands shown when client is codex.
          required: false
        after:
          description: Shared content below both panels, typically the bakers:init prompt.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/setup_paths/setup_paths.component.yml
    hash: 8127e95fb95b0735a7a9a2158a637b91239b60e6267212bac3e729fdde343c97
  - id: bb_theme:shell
    contract:
      component: shell
      group: Shell
      props:
        type: object
        properties: {}
        required: []
        additionalProperties: false
      slots:
        sidebar:
          description: The shell's navigation landmark — normally the sidebar component, which carries the workspace switcher at its head, the primary navigation, and the signed-in account at its foot.
          required: false
        content:
          description: Main content area where screens and section scenes inject their content.
          required: false
        footer:
          description: Bottom bar of the shell — normally the status bar component with the auto-refresh indicator.
          required: false
        overlay:
          description: Overlay layer stacked above the shell — the dialog surface.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/shell/shell.component.yml
    hash: 64dc22bde5273c378a7b68757cd0750416373280f147cb31a88a1704c76a27ff
  - id: bb_theme:sidebar
    contract:
      component: sidebar
      group: Shell
      props:
        type: object
        properties:
          collapsed:
            type: boolean
            title: Collapsed
            description: Render the icon-only rail. The toggle flips the same state at runtime.
          id:
            type: string
            title: Id
            description: Base id for the rail; the collapsible body derives its id from it.
          label:
            type: string
            title: Accessible label for the rail landmark
        required: []
        additionalProperties: false
      slots:
        workspace:
          description: Workspace switcher at the head of the rail.
          required: false
        navigation:
          description: Primary navigation — the rail is the navigation landmark.
          required: false
        actions:
          description: Optional actions at the foot of the rail.
          required: false
      variants:
        - id: expanded
          title: Expanded
        - id: collapsed
          title: Collapsed
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/sidebar/sidebar.component.yml
    hash: 9fd9593f63b9a4106a91084d02cc943f486fe1370f5872c0371757fcfbf621f4
  - id: bb_theme:stat-breakdown
    contract:
      component: stat-breakdown
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The figure's own name, rendered as the block heading.
          columns:
            type: array
            title: Columns
            minItems: 1
            description: The trailing period columns, in display order.
            items:
              type: object
              properties:
                key:
                  type: string
                  title: Column key
                  description: The key each row's counts are stored under.
                label:
                  type: string
                  title: Header label
                  description: The column heading.
              required:
                - key
                - label
          entries:
            type: array
            title: Rows
            description: One entry per axis value. Empty renders the named absence instead.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Row label
                  description: The row's name, already resolved by the caller, including the explicit wording used for entries that could not be attributed.
                counts:
                  type: object
                  title: Counts
                  description: The row's values, keyed by the column keys.
              required:
                - label
                - counts
          empty:
            type: string
            title: Empty message
            description: The sentence shown when there are no entries, naming what is absent and over what period.
          source:
            type: string
            title: Source
            description: Where the figure is read from, available in a native Data source disclosure.
        required:
          - label
          - columns
          - entries
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.component.yml
    hash: a1ca534cb1a8e56e3d79eefbedf76fd06f01d0eb9c62dc58a4627bd76cf4af36
  - id: bb_theme:stat-comparison
    contract:
      component: stat-comparison
      group: Data Display
      props:
        type: object
        properties:
          chart:
            type: object
            title: Chart
            description: Values and labels for the client-side comparison plot.
            properties:
              state:
                type: string
                enum:
                  - ready
                  - empty
                title: State
              label:
                type: string
                title: Label
              value_label:
                type: string
                title: Value axis caption
              labels:
                type: array
                title: Category labels
                description: One label per position on the shared X axis.
                items:
                  type: string
              series:
                type: array
                title: Series
                items:
                  type: object
                  properties:
                    key:
                      type: string
                    style:
                      type: string
                      enum:
                        - a
                        - b
                        - c
                        - d
                        - e
                        - f
                    label:
                      type: string
                    latest_value:
                      type:
                        - string
                        - 'null'
                    values:
                      type: array
                      title: Points
                      description: 'One point per category label, in category order. `y: null` is a gap the line spans. A point is an object rather than a bare number so a gap is never a null array element.'
                      items:
                        type: object
                        properties:
                          x:
                            type: string
                          'y':
                            type:
                              - number
                              - 'null'
              rows:
                type: array
                items:
                  type: object
                  properties:
                    date:
                      type: string
                    values:
                      type: array
                      items:
                        type: string
                title: Rows
                description: The exact-value table beside the canvas. Named `rows` rather than `entries` because Twing json_encode duck-types a Map by calling `thing.entries()`.
            required:
              - state
              - label
              - series
        required:
          - chart
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/stat-comparison/stat-comparison.component.yml
    hash: 980987b1917c82485f80f345b8e53de385d5e8de752847cf5ae931dc73b669df
  - id: bb_theme:stat-ratio
    contract:
      component: stat-ratio
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The figure's own name, rendered as the block heading.
          quotients:
            type: array
            title: Quotients
            minItems: 3
            maxItems: 3
            description: The derived value per trailing period, in display order.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Period
                  description: The period this quotient covers.
                value:
                  type: string
                  title: Value
                  description: The quotient, already formatted - two decimals, or an em-dash where there was nothing to divide by.
              required:
                - label
                - value
          numerator_label:
            type: string
            title: Numerator
            description: The name of the figure on top of the division.
          denominator_label:
            type: string
            title: Denominator
            description: The name of the figure underneath it.
          source:
            type: string
            title: Source
            description: Where the figure is read from, available in a native Data source disclosure.
        required:
          - label
          - quotients
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/stat-ratio/stat-ratio.component.yml
    hash: 2f93dfe43c9fc870324eaf28adf2b472306c39699db5c1152034d2fef93d7a28
  - id: bb_theme:stat-series
    contract:
      component: stat-series
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The figure's own name, rendered as the block heading.
          days:
            type: array
            title: Days
            minItems: 1
            description: The points in chronological order, oldest first.
            items:
              type: object
              properties:
                date:
                  type: string
                  title: Date
                  description: ISO YYYY-MM-DD, used for the shape's accessible description.
                label:
                  type: string
                  title: Axis label
                  description: The short caption drawn under the point, e.g. a weekday.
                count:
                  type: integer
                  title: Count
                  description: The value at this point.
              required:
                - date
                - label
                - count
          source:
            type: string
            title: Source
            description: Where the figure is read from, available in a native Data source disclosure.
        required:
          - label
          - days
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/stat-series/stat-series.component.yml
    hash: dd4e1ebf5f83d0d7bcb25eb138d55088649816f9456bf944aa3c733a928a77fc
  - id: bb_theme:stat-tile
    contract:
      component: stat-tile
      group: Data Display
      props:
        type: object
        properties:
          value:
            type: string
            title: Value
            description: The figure itself, already formatted by the caller. A string rather than a number so a tile can read "3" or "—" or "1.4k" without the component owning a number format.
          label:
            type: string
            title: Label
            description: What the value counts. The tile's accessible name is built from label and value together.
          source:
            type: string
            title: Source
            description: Where the figure is read from — an `entity_type.field`, an endpoint, or the file whose flag decides the set. Rendered as the tile's faint footnote (BB-333 D11/C3).
          window:
            type: string
            title: Window
            description: The period the figure covers, where it has one (`last 24 h`, `rolling 30 d`). A tile that counts a present state carries none.
          tone:
            type: string
            enum:
              - neutral
              - running
              - attention
            title: Tone
            description: 'Optional accent on the value. Never the only carrier of meaning: the label and the value say the same thing in text, so the tile stays readable in greyscale (BB-333 C2).'
          size:
            type: string
            enum:
              - default
              - compact
            title: Size
            description: '`default` is the dashboard tile. `compact` is the same figure at the density of an inspector row — smaller type and padding — for a count that sits beside a description rather than filling a dashboard band.'
            default: default
        required:
          - value
          - label
          - source
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/stat-tile/stat-tile.component.yml
    hash: 1e2c41fb4e247229e4445443e105533de984d48b8ecc9df1d4953f05b6870c49
  - id: bb_theme:stat-windows
    contract:
      component: stat-windows
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The figure's own name, rendered as the block heading.
          windows:
            type: array
            title: Windows
            minItems: 3
            maxItems: 3
            description: The three trailing totals in display order.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Period
                  description: The period this total covers, e.g. "Last 24 hours".
                value:
                  type: string
                  title: Value
                  description: The figure, already formatted by the caller. A string rather than a number so the component owns no number format.
              required:
                - label
                - value
          source:
            type: string
            title: Source
            description: Where the figure is read from, available in a native Data source disclosure.
        required:
          - label
          - windows
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/stat-windows/stat-windows.component.yml
    hash: 226c497a911ab109da3be4d770a93f019646f68a810c7941e447f3449987d2fa
  - id: bb_theme:state-flow
    contract:
      component: state-flow
      group: Data Display
      props:
        type: object
        properties:
          states:
            type: array
            title: Ordered workflow state ids
            items:
              type: string
          current:
            type: string
            title: The currently-active state id (highlighted)
          label:
            type: string
            title: aria-label for the nav
        required:
          - states
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/state-flow/state-flow.component.yml
    hash: b5b3aa2e7f5864e8aa4c2516b9bb6008d58a925d33b6cd588568a8b38b35cbcf
  - id: bb_theme:status_bar
    contract:
      component: status_bar
      group: Shell
      props:
        type: object
        properties:
          label:
            type: string
            title: Leading status text
        required: []
        additionalProperties: false
      slots:
        refresh:
          description: Auto-refresh indicator, aligned to the right.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/status_bar/status_bar.component.yml
    hash: 148b14403fb8e6ab2cbf6da6b58dfe51cece669567a30998844fcb81e2de9d4f
  - id: bb_theme:summary-band
    contract:
      component: summary-band
      group: Data Display
      props:
        type: object
        properties: {}
        required: []
        additionalProperties: false
      slots:
        flow:
          description: Where the subject stands — an ordered chain with a current link. Renders left in the header strip.
          required: false
        summary:
          description: What was done, as one timeline entry rather than a component of this band's own. Renders beneath the header strip.
          required: false
        links:
          description: The evidence — what was tested and how a reader can test it. Rendered BELOW the summary as one wrapping row of groups, never beside it.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/summary-band/summary-band.component.yml
    hash: 672b6306cad10a1b81ff62a9d8332be81a4913f225e7db26775888dc9595bbfc
  - id: bb_theme:surface_card
    contract:
      component: surface_card
      group: Layout
      props:
        type: object
        properties: {}
        required: []
        additionalProperties: false
      slots:
        header:
          description: Optional content above a top divider — normally a `tabs` component switching what `content` shows. Renders nothing when empty, with no divider.
          required: false
        content:
          description: The card's body.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/surface_card/surface_card.component.yml
    hash: de4bb90b66ea22efabeeac8dd8ce0875df763f85727c68024cdb9ad05410976f
  - id: bb_theme:tab
    contract:
      component: tab
      group: Navigation
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: Link text, used when no `link` slot is given.
          url:
            type: string
            title: URL
            description: Destination, used when no `link` slot is given.
          active:
            type: boolean
            title: Active
            description: The current place; rendered as aria-current=page.
            default: false
        required: []
        additionalProperties: false
      slots:
        link:
          description: A ready link render element (Drupal's local-task link), printed whole with the tab classes added.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/tab/tab.component.yml
    hash: 569b6d22e3f773b7ebc417723a5374372bdcaaa1c6ec22196f3854527a136214
  - id: bb_theme:table
    contract:
      component: table
      group: Data Display
      props:
        type: object
        properties:
          live_sums:
            type: boolean
            title: Live sums
            description: 'Totals follow typing: `text` cells with a `sum` show their `seconds` plus every change typed into the `input` cells naming that key, before the form is saved. For an editable timesheet.'
          columns:
            type: array
            title: Columns
            description: 'The column set, in render order. It replaces the old `headers` array, and the difference is the `key`: a header without one cannot be keyed against a cell, which is how a three-column table came to render nine-cell rows. The columns are the TABLE''S order — a row does not get to choose one.'
            items:
              type: object
              properties:
                key:
                  type: string
                  title: Column key
                  description: The key a row addresses this column's cell by. Unique within the column set; a row's `cells` map is keyed by it.
                label:
                  type: string
                  title: Header label
                  description: The header text. An action column carries an empty label, like every other action column here.
                sort:
                  type: string
                  enum:
                    - none
                    - asc
                    - desc
                  title: Sort state
                  description: Present on a SORTABLE column, absent on one that cannot be sorted — never `none` as a way of saying "not sortable", which would render a sort link that sorts nothing. `none` means this column can be sorted and currently is not; `asc`/`desc` mean it is the column the list is ordered by. Rendered as `aria-sort` on the cell, so the state is readable without seeing the indicator.
                url:
                  type: string
                  title: Sort URL
                  description: Where the header link points — the query the view re-sorts with. A Drupal view supplies it; in the designbook it is a rendered, reachable, inert href like every other action here.
                num:
                  type: boolean
                  title: Numeric
                  description: Right-aligned and tabular, for a column of numbers or durations that is read down rather than across.
                row_header:
                  type: boolean
                  title: Row header
                  description: The column whose cell names its row, such as the person or project of a week grid. Its body cell renders as a row header (`<th scope="row">`), so a screen reader announces every other cell of the row with it, and it stays in view at the left edge when the table scrolls sideways.
          rows:
            type: array
            title: Rows
            description: The rows, as DATA. Each row is an optional link target, an optional status accent and a map of cells keyed by column key — never a rendered row, which is what the removed `body` slot used to take.
            items:
              type: object
              properties:
                url:
                  type: string
                  title: Row target
                  description: 'Where this row points, carried as `data-row-url` on the `<tr>` rather than rendered as an anchor: a `<tr>` cannot be wrapped in a link, and inventing one inside a cell would add a `<td>` no column asked for. NO CALLER IN THE PRODUCT FILLS IT, and that is the state of it rather than a defect. `views-view-table.html.twig` used to ask the row entity for a target through `BbTableRowInterface`; the interface is deleted and the ask went with it, measured first — no JavaScript and no CSS in this theme read the attribute, and its only readers were the tests asserting it. The prop stays because the component''s contract is not the binding''s: hand a row a `url` and the attribute is still emitted, which `table.delivery.story.yml` and `table.unassigned.story.yml` show. The VISIBLE affordance of a row remains a `link` cell in a column of its own, which is what every live surface uses.'
                accent:
                  type: string
                  enum:
                    - running
                    - attention
                    - wait
                    - idle
                  title: Status accent
                  description: The leading status rail on the row's first cell. `wait` additionally tints the whole row, because a ticket nobody is acting on is the one state the deleted row components made loud, and the tint is what the `wait` badge's `-ink` colour is legible against.
                cells:
                  type: object
                  title: Cells
                  description: 'The row''s values, keyed by column key. A cell is plain data with a `kind` — `text` | `mono` | `link` | `badge` | `person` | `picker` | `masked` | `action` | `rendered` | `status` — and one macro renders all ten. An unknown or absent `kind` renders the value as plain text, so a mapping mistake shows up as unstyled content rather than as an empty cell; plain text keeps its value''s line breaks. A value shape the kinds cannot express is the signal to add a new kind DELIBERATELY, never to reintroduce a slot — and that rule has now been exercised twice. `action` was the eighth: the first seven all render a value the record HOLDS, none of them was a control, and a row action had nowhere to go. `rendered` is the ninth, and it arrived when the ticket list was bound through core''s own `table` views style over nine real Views FIELDS, each rendering itself through its own formatter — so what reaches the cell is markup another layer already produced and whose face this component did not decide. A slot would be the wrong answer for it for the same reason it was the wrong answer for a row: a slot lets a caller inject a whole `<td>` and escape the keying this container exists to enforce, while a `rendered` cell is still ADDRESSED BY ITS COLUMN and still emits exactly the one `<td>` that column asked for. SIX OF A CELL''S FIELDS ARE OPTIONAL STRINGS the macro hands straight to a composed component — `icon`, `suffix`, `mail`, `clear_label`, `create_label` and `picker_id`. Omitting any of them is legal and renders nothing: `cell()` passes an empty string rather than the NULL a composed component types as a string and core''s validator rejects. The `bare` story is what covers that, because a guard nothing renders is closed but not covered.'
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
                          - input
                        title: Cell kind
                      value:
                        type: string
                        title: Value
                        description: The value of a `text`, `mono`, `link` or `masked` cell.
                      working:
                        type: boolean
                        title: Working
                        description: 'A `status` cell: TRUE draws a filled disc (the row is in coding), FALSE or absent draws an empty dashed ring. The cell''s `label` (the exact state) is its tooltip and accessible name. The rail, not this glyph, carries occupancy and review.'
                      name_hidden:
                        type: boolean
                        title: Name hidden
                        description: A `person` cell rendered as the circle alone, e.g. a list row's right-hand assignee. The `display_name` becomes the tooltip and the accessible name instead of visible text. Ignored when `mail` makes the cell a full identity.
                      emphasis:
                        type: string
                        enum:
                          - default
                          - faint
                          - strong
                        title: Text emphasis
                        description: The three emphases the five deleted row templates carried between them, for `text` cells.
                      url:
                        type: string
                        title: Link target
                        description: 'The address of a `link` cell, or — on a `badge` cell — what makes the badge a LINKED CHIP: the badge is wrapped in an anchor to this address (focus ring on the pill, dimmed on hover). Related tickets render this way, one `badge` cell per ticket with `mono: true` and `tone: neutral`, so the chips wrap side by side. Without it a badge is not a link. `full_load` applies to both.'
                      mono:
                        type: boolean
                        title: Monospaced
                        description: 'A `link` or a `badge` whose text is a machine name — an identifier, a branch, a key, the machine holding a lease. The face is the information: it says the string is to be matched character by character rather than read.'
                      full_load:
                        type: boolean
                        title: Full document load
                        description: 'A `link` cell whose target must be reached as a WHOLE DOCUMENT rather than swapped in, emitted as `data-hx-boost="false"` on the anchor. It is for a link that points at a FORM PAGE inside a boosted island: an island fragment does not run the response pipeline that replaces a form''s `#action` placeholder, so a boosted navigation would render the form with an unreplaced `form_action_p_…` action that posts to a 404. The joinable row on the workspace overview is the case — it links to the join confirm form. Omitted or false keeps the row inside the island''s boosted navigation, which is right for every link that targets another rendered row rather than a form.'
                      external:
                        type: boolean
                        title: External address
                        description: A `link` cell whose target lies outside bakers.build — a preview or tunnel address an addon reports. It reads as a link in prose (`text-link`, underlined) rather than as a row affordance, and opens in a new tab with `noopener`.
                      label:
                        type: string
                        title: Label
                        description: The text of a `badge`, the exact state of a `status`, the field name of a `picker`, or the name of an `action`. On an icon-only `action` it is the accessible name and is expected to be a SENTENCE naming the effect, because `button` moves it into `aria-label`.
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
                        title: Badge tone
                      dot:
                        type: boolean
                        title: Badge dot
                      icon:
                        type: string
                        title: Icon name
                        description: The sprite name of a `badge`'s leading icon, a `picker`'s trigger icon or an `action`'s icon. On a `picker` it is `option_picker`'s own prop — the icon sits on the trigger, which is why the field goes there and the clear/create fields go to `option_list`.
                      suffix:
                        type: string
                        title: Badge suffix
                        description: The trailing count or duration on a `badge` — "14m" beside a running state. Optional; an omitted suffix renders nothing.
                      mine:
                        type: boolean
                        title: Held by the reader
                        description: 'Outlines a `badge` cell that names something belonging to the READER rather than to somebody else — a lease your own session holds. Whose, not what: the same state demands opposite responses depending on the answer, so it is data. Pairs with `tone: lease`.'
                      display_name:
                        type: string
                        title: Person name
                      initials:
                        type: string
                        title: Person initials
                      color:
                        type: string
                        title: Person colour key
                      mail:
                        type: string
                        title: Person mail
                        description: 'A `person` cell''s mail address, and the field the cell''s VARIANT is derived from: a cell handed one is the subject of its row and renders `full`, one without it is a control or a cell and renders `compact`. Optional; omitting it is how a table row asks for the compact identity.'
                      picture:
                        type: string
                        title: Person picture URL
                        description: Optional image URL for a `person` cell's mark; the initials stay the fallback.
                      image_fit:
                        type: string
                        enum:
                          - cover
                          - contain
                        title: Person picture fit
                        description: 'How the picture fills the mark (`person`''s `image_fit`): `cover` crops, `contain` centres the whole image. Default `cover`.'
                      size:
                        type: string
                        enum:
                          - sm
                          - md
                        title: Person mark size
                        description: Overrides the size derived from `mail`; a listing row's leading avatar asks for `md` without a mail.
                      value_labels:
                        type: array
                        title: Picked values
                        description: The selected values of a `picker` cell, rendered as the first plus a `+N` count.
                        items:
                          type: string
                      options:
                        type: array
                        title: Picker options
                        description: The option rows the picker offers, as plain data. The macro renders them through `option_list`, so the panel markup exists in one place only.
                        items:
                          type: object
                          properties:
                            value:
                              type: string
                            label:
                              type: string
                            selected:
                              type: boolean
                            description:
                              type: string
                      multiple:
                        type: boolean
                        title: Several values at once
                        description: 'The field a `picker` cell edits holds several values. It is carried rather than derived from how many values are picked, because `aria-multiselectable` is a statement about the FIELD: a multi-value field currently holding one value would otherwise be announced as a single choice, and a single-value field would grow checkable rows. Default `false`.'
                      searchable:
                        type: boolean
                        title: Panel search box
                        description: Forwarded to `option_picker`. Default false, so existing pickers stay a closed list.
                      selected_chips:
                        type: boolean
                        title: Removable selected chips
                        description: Opt-in. Forwards to `option_picker` so a multi-value field can show each selected identity as a chip. Default false.
                      selected:
                        type: array
                        title: Selected identities
                        description: '`{value, label}` rows for selected_chips, so a removal names the account rather than a label index.'
                        items:
                          type: object
                          properties:
                            value:
                              type: string
                            label:
                              type: string
                      picker_id:
                        type: string
                        title: Picker id
                        description: The picker's base id, which its panel derives its own id from. One per cell — two pickers sharing an id would open together.
                      open:
                        type: boolean
                        title: Picker open
                        description: 'The panel''s open state, as a prop rather than a click: Storybook never calls `Drupal.attachBehaviors`, and a closed picker renders identically to a missing one.'
                      clearable:
                        type: boolean
                        title: The field can be emptied
                        description: 'A `picker` panel opens with a CLEAR ROW as its first option, which is the only way this design lets a field be unset — `option_list` argues it at length: the row belongs to the listbox, so "no conductor" reads as a value the operator chose rather than as an absence they must produce. Without it a rail can set a field and never empty it, which is a lost capability and not a lost decoration. Declared by `option_list`, which is where the cell passes it.'
                      clear_label:
                        type: string
                        title: Clear row label
                        description: What the clear row says — "Unassigned", "No priority", "No conductor", "No labels". It is per FIELD and never a generic word, because the sentence a reader picks is about that field; `option_list` falls back to `— none —` only where nothing was said.
                      creatable:
                        type: boolean
                        title: A value can be created from the panel
                        description: A `picker` panel ends with a create row — a real `<button>`, not a `role="option"`, because an action is not a selectable value. Rendered and reachable; it creates nothing until these pickers have an endpoint. Declared by `option_list`.
                      create_label:
                        type: string
                        title: Created noun
                        description: The noun the create row invites — "+ New label". Singular, and the thing being created rather than the field it goes into.
                      variant:
                        type: string
                        enum:
                          - primary
                          - ghost
                          - danger
                        title: Action weight
                        description: 'An `action` cell''s weight, from `button`''s own variants. Default `ghost`: a row action is secondary to the row it sits on, and a listing where every item carries a primary-weight control emphasises nothing. `danger` is the quiet outline for an intervention on the row''s record — Cancel run on a running run.'
                      icon_only:
                        type: boolean
                        title: Icon-only action
                        description: An `action` renders its icon alone and `button` moves the `label` into `aria-label`. This is what lets a row action be a sentence-long accessible name without printing that sentence on every item — the reason a `text` cell was the wrong answer for it.
                      name:
                        type: string
                        title: Submitted field name
                        description: 'A `picker` cell''s form field name — the key its value is POSTED under. Optional; absent, the macro derives a name from `label|lower` and renders no form control, which is right for an inert scene only. Set, `option_picker` receives it and `option_list` receives it as `input_name` too, so every option row carries a real radio (single) or checkbox (`name[]`, `multiple`) checked from `selected` — the same `name` / `name[]` input shape a `property_pill` posts, with a native `change` event for an autosaving form. The inline picker itself still writes no hidden input, so nothing posts twice. It also sets `option_list`''s `clear_control`: on a single-value field the clear row is a radio of the same name with the value "" (checked when nothing is selected), so the field can be emptied by posting; on a multi-value field the clear row unchecks every box. The accessible name keeps reading `label`.'
                      href:
                        type: string
                        title: Action address
                        description: An `action` cell's address. Optional; set, the action renders as `button`'s anchor form (`<a href>`), so it works without JavaScript — the dialog route's plain, non-wrapper URL. Absent, the action is the `<button type="button">` it always was.
                      hx:
                        type: object
                        title: Action htmx request
                        description: 'An `action` cell''s htmx request, as the attribute set a create trigger carries (`CreateActionSourceBase`): each key that is set becomes a `data-hx-<key>` attribute on the control, so a row action can open a dialog — `get` the wrapper-format dialog URL, `target` the overlay (`#bakers-overlay`), `select` `dialog`, `swap` `innerHTML`. Normally paired with `href`. An `input` cell uses the same set on its corner entry link, paired with `url`.'
                        additionalProperties: false
                        properties:
                          get:
                            type: string
                            title: hx-get
                          target:
                            type: string
                            title: hx-target
                          select:
                            type: string
                            title: hx-select
                          swap:
                            type: string
                            title: hx-swap
                      revealed:
                        type: boolean
                        title: Revealed
                        description: A `masked` cell shows its value instead of the dots. Normally no value reaches this component at all — masking happens upstream in the formatter that reads the field, so there is nothing sensitive in the render context to leak.
                      error:
                        type: string
                        title: Input error
                        description: An `input` cell's field error, shown under the input and tied to it with aria-describedby; the input is marked invalid.
                      hint:
                        type: string
                        title: Input hint
                        description: An `input` cell's state marker, e.g. Proposed.
                      url_label:
                        type: string
                        title: Input link label
                        description: Accessible name of an `input` cell's corner `url` icon link; defaults to Details.
                      hidden:
                        type: object
                        title: Hidden inputs
                        description: An `input` cell's hidden name => value pairs, e.g. the entry id and version a save checks for staleness.
                        additionalProperties:
                          type: string
                      autofocus:
                        type: boolean
                        title: Focus this input
                        description: An `input` cell that receives focus, e.g. the first invalid cell.
                      stored:
                        type: integer
                        title: Stored seconds
                        description: An `input` cell's stored value in seconds, the base its typed change is measured against.
                      sums:
                        type: array
                        title: Live total keys
                        description: The `sum` keys of the totals an `input` cell's typed change moves while `live_sums` is on.
                        items:
                          type: string
                      sum:
                        type: string
                        title: Live total key
                        description: A `text` cell that shows a live total; inputs naming this key move it.
                      seconds:
                        type: integer
                        title: Total base seconds
                        description: A live total `text` cell's stored seconds.
                      markup:
                        type: string
                        title: Rendered markup
                        description: 'The already-rendered markup of a `rendered` cell. DECLARED `string`, BUT THE VALUE MUST BE A `MarkupInterface` OBJECT, and that pair is measured rather than stylistic. SDC''s class-type escape hatch — a prop whose `type` names a class — is TOP-LEVEL ONLY: `ComponentValidator::getClassProps()` loops `props.properties` once and never recurses, so a field at `rows[].cells.<key>.markup` cannot be typed as `MarkupInterface` at all. It does not need to be: `MarkupInterface extends \JsonSerializable` and the validator sees props through a json round-trip, so the object arrives as its string and satisfies `string`. What makes the object MANDATORY is Twig — it prints a `MarkupInterface` unescaped and exactly once, and it ESCAPES a plain string — so a caller handing over a string prints tag soup at the reader, and `|raw` on a string would be blind unescaping of content this component never inspected. A render ARRAY is rejected outright, and that rejection is load-bearing: it is what forces a Views field handler''s output to be rendered before it is mapped.'
        required: []
        additionalProperties: false
      slots:
        empty:
          description: Collapsed/empty confirmation content (collapsed variant) — the ONE surviving slot. The strip is a sentence a screen writes, not a value a listing carries.
          required: false
      variants:
        - id: collapsed
          title: Collapsed
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/table/table.component.yml
    hash: 4982aa79dabaee8587288a068735d01340164fb8745c5d6decb998b60cf91c3f
  - id: bb_theme:tabs
    contract:
      component: tabs
      group: Navigation
      props:
        type: object
        properties:
          label:
            type: string
            title: Accessible name
            description: aria-label for the tab list (e.g. Project sections).
          items:
            type: array
            title: Tabs
            description: Ordered tabs, each rendered as `tab`. One item should set active true. Not used when `tab_items` is given.
            items:
              type: object
              properties:
                label:
                  type: string
                  title: Label
                  description: Tab text. Named label (not title) so sample data cannot be mistaken for rail navigation titles.
                url:
                  type: string
                  title: URL
                active:
                  type: boolean
                  title: Active
                  description: Selected tab; rendered as aria-current=page.
              required:
                - label
                - url
        required: []
        additionalProperties: false
      slots:
        tab_items:
          description: Already rendered `tab` entries (Drupal's local-task primary or secondary row), printed whole instead of `items`.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/tabs/tabs.component.yml
    hash: 0c8508a7e90225bb8c448a6ff451136505a2c95236e5f32b46b17432cd8af3b8
  - id: bb_theme:text
    contract:
      component: text
      group: Data Display
      props:
        type: object
        properties:
          text:
            type: string
            title: Text
            description: The copy, printed escaped; its line breaks are kept.
          as:
            type: string
            enum:
              - p
              - span
              - h1
              - h2
            title: Element
            description: The HTML element. Ignored when `href` is set. Default `p`.
            default: p
          size:
            type: string
            enum:
              - body
              - caption
              - h3
              - display
              - gate-body
            title: Size
            description: 'Typographic role: body, caption, the h3 step, `display` (the 24px bold page-title role) or `gate-body` (the 16px body of a standalone gate result). Default `body`.'
            default: body
          tone:
            type: string
            enum:
              - default
              - light
              - faint
            title: Tone
            description: 'Text colour role: the default text colour, the lighter secondary one, or the faint tertiary one. Ignored when `href` is set.'
            default: default
          align:
            type: string
            enum:
              - start
              - center
            title: Alignment
            default: start
          tracking:
            type: string
            enum:
              - normal
              - widest
            title: Letter spacing
            description: '`widest` spaces a code a reader copies character by character.'
            default: normal
          href:
            type: string
            title: Link URL
            description: Renders the run as a link in the link colour.
        required:
          - text
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/text/text.component.yml
    hash: 9f8c14d7c9a0c5c5e4b999c1f5d64cb173650fdfe88eb064cd53403957c803ea
  - id: bb_theme:toast
    contract:
      component: toast
      group: Data Display
      props:
        type: object
        properties:
          message:
            type: string
            title: Message
            description: The confirmation text. Empty renders the toast hidden.
        required: []
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/toast/toast.component.yml
    hash: 7ef7b98fdcebf32a8f1f25fd22e2e4768c57f32c28aef6c1a8e943efe1400d54
  - id: bb_theme:week-strip
    contract:
      component: week-strip
      group: Data Display
      props:
        type: object
        properties:
          label:
            type: string
            title: Accessible name of the strip
            description: E.g. "Days of week 2026-11-02".
          days:
            type: array
            title: The seven days, Monday first
            minItems: 7
            maxItems: 7
            items:
              type: object
              required:
                - weekday
                - date
                - total
                - url
                - aria_label
              properties:
                weekday:
                  type: string
                  title: Short weekday name
                date:
                  type: string
                  title: Day of month
                total:
                  type: string
                  title: Recorded time as H:MM
                url:
                  type: string
                  title: Address of that day
                active:
                  type: boolean
                  title: The selected day
                aria_label:
                  type: string
                  title: Accessible name of the day link
          total_label:
            type: string
            title: Label of the week total
          total:
            type: string
            title: Week total as H:MM
        required:
          - label
          - days
          - total_label
          - total
        additionalProperties: false
      slots: {}
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/week-strip/week-strip.component.yml
    hash: 6a7620c3991aba32682f893ffd76399422ffd12b4d92ccb2cbe913958d6bc762
  - id: bb_theme:zone
    contract:
      component: zone
      group: Layout
      props:
        type: object
        properties:
          heading_size:
            type: string
            enum:
              - section
              - display
            title: Heading size
            description: Use display for a peer section matching the page title; defaults to section.
          inset:
            type: string
            enum:
              - none
              - sm
              - md
              - lg
            title: Inset
            description: 'Padding on BOTH axes, from one scale: `none` = 0, `sm` = 12px, `md` = 20px (the default), `lg` = 24px at default density, and 18px, 30px and 36px under cozy (Tailwind''s `p-3`/`p-5`/`p-6`, which scale with the density''s `--spacing`). One property and one scale on purpose: `section` shipped `padding_x` and `padding_y` whose shared vocabulary resolved to different sizes per axis, and sixteen scenes then corrected its default by hand (F6, F7). The default is the value those sixteen corrections were reaching for, so a zone that says nothing is already right.'
          gap:
            type: string
            enum:
              - none
              - sm
              - md
              - lg
            title: Gap
            description: 'Distance between the cells of the content grid, from `component.zone.gap.*`, which point at the space scale: `none` = 0, `sm` = `space-3` (12px, 16px cozy), `md` = `space-5` (20px, 24px cozy, the default), `lg` = `space-6` (24px, 32px cozy).'
          direction:
            type: string
            enum:
              - column
              - row
              - fill
            title: Direction
            description: '`fill` is one row for a single field and its submit (or a search and its sort): the first cell takes the remaining width, every later cell keeps its intrinsic width on one line, and all cells align to the bottom edge, so a button lines up with the input rather than with the field label. It wraps only when the row cannot fit — below the first cell''s basis the later cells move to a new line, capped at the row width — so a narrow column never overflows. How the content is arranged. `column` (the default) is the `columns`-wide grid. `row` is a WRAPPING row whose children keep their intrinsic widths — which is what `section`''s `justify_items: start` was working around: a grid cell blockifies its child, so an `inline-flex` badge became a full-width rounded rectangle and a list of labels rendered as a column of them instead of as pills (F9). In `row`, `columns` has nothing to do and is ignored.'
          align:
            type: string
            enum:
              - start
              - center
            title: Alignment
            description: '`center` centres the heading, the description and the cells, for a short standalone result — a heading, a sentence and one action inside a card. Default `start`.'
            default: start
          columns:
            type: integer
            enum:
              - 1
              - 2
              - 3
              - 4
            title: Columns
            description: Number of columns the content grid renders at `lg` and above, narrowing to two at `md` and one below it. Only meaningful when `direction` is `column`. Defaults to 1.
          description:
            type: string
            title: Description
            description: 'The block''s sub-line, rendered below the `<h2>` in the same treatment `page_header` gives the screen''s sub-line — one level of type smaller and recessive. It exists because ten block headers in the delivered scenes needed one and `zone` had none (BB-378 D14 did not think of it), so they were written as block-level `<span>`s with inline styles inside the `heading` slot — scene YAML sits outside the CSS build''s source paths, so a utility class written there is never compiled and inline styles were the only thing that worked. A prop is the better answer: it is reviewable, it is styled once here, and it keeps the heading slot for the heading. Omitted means no element, never an empty one. It does NOT truncate: a block sub-line is a sentence and wraps, where a screen sub-line is an identity line on one row.'
          list:
            type: boolean
            title: Content is an ARIA list
            description: 'Opt-in, default `false`, so a zone that says nothing renders a plain content grid. When true the content container itself (never the outer `<section>`) gets `role="list"`. A stack of plain `<div>` rows otherwise gives a screen reader neither a table nor a list — no item count and no way to navigate the members as a set. This is deliberately ARIA rather than a `<ul>`/`<li>` rewrite of a layout primitive used across the whole theme. A caller that sets this is responsible for giving each direct child of the content slot `role="listitem"` (`badge` takes a `list_item` prop for exactly this) — `role="list"`/`role="listitem"` must be direct parent/child in the accessibility tree, or a browser drops both roles. NO SURFACE IN THIS THEME SETS IT ANY MORE: every listing that did is a `list` node now, which renders a real `<ul>` of `<li>` and needs none of this arrangement. The prop stays because the pairing is still the only answer for a caller that has no container to reach for, and because removing it is a change to `zone`, which this listing work does not touch.'
        required: []
        additionalProperties: false
      slots:
        heading:
          description: The zone's heading, rendered as `<h2>` in the one style a zone heading has. Plain text is the normal case; rich markup (an icon, a count badge) is supported and inherits the same style. Leave it empty and no heading element is rendered at all.
          required: false
        actions:
          description: Actions this zone owns, right-aligned on the heading row — an add affordance for the list the zone holds. Empty means the zone owns no action, and nothing is rendered rather than something disabled.
          required: false
        content:
          description: The zone's body. Each direct child becomes a cell of the content grid, or an item of the wrapping row when `direction` is `row`.
          required: false
    source: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components/zone/zone.component.yml
    hash: a7ff1fab554aecb5902e46ad2e4fe4e8f4b2835274884ee868514a16735b2b6e
mappings: []
samples: []
scenes:
  - path: design-system/design-system.scenes.yml
    file:
      id: debo-design-system
      title: Design System
      description: 'The bakers.build application shell: a collapsible left navigation rail beside a main column that stacks the screen content and the status bar, with the overlay layer for dialogs. BB-332''s action-pattern scenes used to sit here too, because the pattern crosses every section; BB-335 moved every TICKET scene of them into `sections/tickets/tickets.section.scenes.yml`, where the surfaces they demonstrate live. The written rule stayed put: `design-system/action-pattern.md` is still the single copy, and it still binds every section. What is left here is the shell itself — including the deliberate absence of an add action in the chrome, which is a fact about the CHROME rather than about any screen. BB-341 then replaced the navigation this shell carries with the decided information architecture; Groups later joined as its own leaf, so the rail order is My work · Groups · Projects · Settings · Teams. Team row overflow menus and the Team settings dialog were retired: open the team, use the Members tab (IA D12). BB-378 made this file the ONLY place the shell is declared: every screen scene in every section starts with `scene: "design-system:shell"` and fills `content` through `with:`, so the rail and the status bar exist once. BB-503 removed the header/top bar entirely — the shell has no top chrome at all — and moved identity into the rail, where it SPLITS: the workspace switcher (the new `account_switcher`, replacing the retired `workspace_switcher`) at the rail HEAD, and the signed-in account at the rail FOOT as a plain `bb_theme:person` avatar, replacing the retired `user_menu`. The layout rules those screens obey are written in `designbook/design-system/layout.md`.'
      status: planned
      order: 0
      group: Designbook/Design System
      scenes:
        - name: shell
          group: Shell
          section: shell
          docs: |-
            THE ONE SHELL. This scene is what every screen inherits: a section scene opens with `scene: "design-system:shell"` and fills `content` through `with:`, so the rail and the status bar are declared here and nowhere else (BB-378 D1). Before that they were retyped in all four scene files, and commit a60bb0e7 — "align sections with product IA (four places)" — is the receipt for what that cost.
            Its `content` slot is therefore the `$content` PLACEHOLDER rather than a screen, and its `overlay` carries a second one, `$overlay`. Rendered as its own story neither marker has anything to substitute and both show as literal text: that is the injection point made visible, not a rendering fault. What a screen puts in `content` is exactly one `canvas` (D2); what it puts in `$overlay` is its create or confirm surface, or the empty string when it opens none. Both are written up in `designbook/design-system/layout.md`.
            BB-503 REMOVED THE HEADER ENTIRELY. There is no top bar and no `header` slot: neither `shell.component.yml` nor `shell.twig` declares one. The search affordance and its command palette are retired with it and return in a later ticket with a trigger of their own. Identity splits across the rail: the workspace switcher, `account_switcher`, stays at the rail HEAD, filling the sidebar's `workspace` slot — the same position the retired `workspace_switcher` held. It is a disclosure control only when `multiple` is true — with a single workspace it is a plain label, chevron and panel both dropped, because a switcher with nothing to switch to is not a control. The signed-in account moved to the rail FOOT, filling `actions`, as a plain, non-interactive avatar (`bb_theme:person` compact) — there is nothing to switch about it, so it carries no chevron and no panel either.
            The bakers.build application shell with the sidebar expanded, carrying the information architecture the IA target (docs/specs/ia-home-nav-roles-decisions.md) decided, with Groups as its own leaf: My work, Groups, Projects, Settings (workspace entity + Labels on one screen; no separate Labels rail entry; workspace has no members surface), and Teams (with create affordance and one row per team).
            READ HERE (BB-341 C1/C2/C3, Groups inserted as a sibling leaf). Top-level order: My work, Groups, Projects, then Settings as a leaf, then Teams as a GROUP HEADING (disclosure, no destination). Neither heading nor leaves indent children — a team row sits at rail level and is told apart by its MARK. A team row does not expand further. Teams is open here (shell demo default); Settings is closed by default. Groups and Projects are separate destinations; neither is a child of the other.
            The `[+]` on Teams is not a hole in BB-332's rule but the same rule one surface further in. The chrome carries no entity-add action — there is no top bar and the rail's foot carries only identity — because the chrome cannot know whether the screen under it accepts an addition. The Teams row is not generic chrome: it IS the list of teams, its target is the rows directly beneath it, and it never speaks for the screen under it. The false side of that conditional is this chrome itself: nothing in the rail carries an entity-add action, and the injection point below it is empty, so nothing here promises an addition on behalf of a screen it cannot see. The positive side is a screen that owns its own plus — `ticket-list (add action)` in the tickets section.
            NOT SHOWN, deliberately. Nothing binds to a real team: teams do not exist in code yet, so every row, mark and menu target here is sample data. My work is the home (open tickets assigned to the current user; see docs/specs/ia-home-nav-roles-decisions.md). And no JavaScript runs in Storybook, so every disclosure is a markup observation rather than an interaction — which is exactly why each state is a prop rendered as an attribute.
            ONE ISLAND BOUNDARY CROSSES THIS SHELL, AND STORYBOOK RENDERS NONE OF IT (BB-396 D15, amended BB-503). An island is a render array contributed by `IslandWrapper` at request time, so this scene cannot render one and must not pretend to: what follows names the boundary so a reader of the design knows where it falls, and nothing here simulates a swap, a boost or a fragment request. Storybook has no htmx and gets none.
            WHERE IT FALLS, read off the shipped `display_builder_page_layout.page_layout.bb_shell` and not invented here. The `sidebar` slot below is wrapped by `island-rail`, whose swap target is `#island-content`. The `content` slot — the `$content` placeholder every screen fills — is wrapped by `island-content`, and by D1 that is the page's ONE swap target, addressed by its DOM id rather than by a class or a `closest` selector. `header` no longer exists; `footer` and `overlay` stay outside both boundaries: the status bar and any dialog are never replaced.
            SO THE ASYMMETRY IN THIS SCENE'S OWN PROSE IS AN ISLAND FACT (D3, module fact F6). `island-rail` names `#island-content` as its target and does NOT ride along — it sits outside the boundary it points at, so a navigation replaces the content and leaves the rail's active entry as it was. That is the mechanism behind "THE RAIL SHOWS THE SHELL'S OWN STATE" which the screen scenes state from the other side: in Storybook the trail is a prop, in Drupal it is the route, and after a swap it is simply stale. Buying a correct trail would mean re-rendering the whole menu tree on every click.
            AND `island-content` RUNS IN CONFIGURATION MODE, which is a declared deviation the human chose to keep rather than a gap. Its `swap_target` is EMPTY — `IslandBoost::to(NULL)`, "the container itself", because it is already the main fragment and cannot ride along with itself. Configuration mode means the container is built from the page layout and resolves to no island plugin, so the server never re-renders it alone: a boosted navigation is answered with the ORDINARY WHOLE PAGE and the client narrows it to this boundary with `hx-select`. That is enough for a container that only ever RENDERS, and it is not enough for one that mutates — an island that changes content needs a plugin.
            KNOWN DIVERGENCE (BB-503). `island.profile.bb_shell.yml` still places `bb_theme:topbar` in `shell_topbar`; this ticket deliberately leaves that live config untouched, so a `recipe-test` world built from this branch fails to render the shell until the follow-up `designbook-to-config` ticket reconciles it.
          items:
            - component: bb_theme:shell
              slots:
                sidebar:
                  component: bb_theme:sidebar
                  props:
                    collapsed: false
                    label: Workspace navigation
                  slots:
                    workspace:
                      component: bb_theme:account_switcher
                      props:
                        workspace_label: keytec
                        workspace_initials: KT
                        workspace_color: running
                        multiple: true
                        collapsed: false
                        workspace_picture: /themes/custom/bb_theme/assets/brand/bakers-tui-braid-v2.png
                      slots:
                        workspace_panel:
                          - component: bb_theme:menu_item
                            props:
                              label: keytec
                              url: /keytec/tickets
                              current: true
                              mark:
                                initials: KE
                                color: running
                                picture: /themes/custom/bb_theme/assets/brand/bakers-tui-braid-v2.png
                          - component: bb_theme:menu_item
                            props:
                              label: bakers.build
                              url: /bakers/tickets
                              current: false
                              mark:
                                initials: GA
                                color: attention
                                picture: ''
                    navigation:
                      component: bb_theme:nav
                      props:
                        variant: main
                        label: Primary
                        items:
                          - title: My work
                            url: /admin/bakers/work
                            icon: ticket
                            in_active_trail: true
                            below: []
                          - title: Groups
                            url: /admin/bakers/group
                            icon: dashboard
                            in_active_trail: false
                            below: []
                          - title: Projects
                            url: /admin/bakers/project
                            icon: project
                            in_active_trail: false
                            below: []
                          - title: Settings
                            url: /admin/bakers/settings
                            icon: settings
                            in_active_trail: false
                            below: []
                          - title: Teams
                            heading: true
                            icon: team
                            open: true
                            action:
                              icon: plus
                              label: New team
                            below:
                              - title: Team A
                                url: /admin/bakers/team/team-a
                                in_active_trail: false
                                mark:
                                  initials: TA
                                  color: running
                              - title: Team B
                                url: /admin/bakers/team/team-b
                                in_active_trail: false
                                mark:
                                  initials: TB
                                  color: lease
                    actions:
                      - component: bb_theme:person
                        props:
                          variant: compact
                          display_name: cw
                          initials: CW
                          color: lease
                          size: md
                      - component: bb_theme:mode_toggle
                        props:
                          mode: light
                          label: Choose theme
                content: $content
                footer:
                  component: bb_theme:status_bar
                  slots:
                    refresh:
                      component: bb_theme:badge
                      props:
                        label: Auto-refresh on
                        tone: running
                        dot: true
                        suffix: updated 4s ago
                overlay: $overlay
        - name: shell collapsed
          group: Shell
          section: shell
          docs: |-
            The same shell with the sidebar collapsed. Every navigation surface the expanded rail reaches is still reachable: the link rows stay as their icons and the TEAM ROWS STAY AS THEIR MARKS — ticket, dashboard, project, settings, the two team marks. Hiding the teams would have made a surface unreachable in one of the two delivered states, which is the one thing a 56px rail must not do.
            What goes is what a 56px rail cannot honour: the labels, the two group heading rows and the Teams create affordance (no per-team overflow menu). A heading is a label with a chevron and has nothing left when the label goes, and a control whose target is a hidden list is a control that lies. Each of them carries `data-collapse-hidden`, the sidebar's own generic contract, so the rail never has to know what the navigation is made of.
            BB-503: there is no top bar to keep unchanged any more. The account switcher at the rail head renders its `collapsed` variant here — the mark alone, label and chevron dropped, the same way the retired workspace switcher reduced to its mark. The signed-in account at the rail foot reduces to its mark the same way. Content, status bar and overlay boundary are unchanged. Its `content` is the same `$content` injection point the expanded shell carries: this is the collapsed state of the ONE shell, not a second one.
          items:
            - component: bb_theme:shell
              slots:
                sidebar:
                  component: bb_theme:sidebar
                  props:
                    collapsed: true
                    label: Workspace navigation
                  slots:
                    workspace:
                      component: bb_theme:account_switcher
                      props:
                        variant: collapsed
                        workspace_label: keytec
                        workspace_initials: KT
                        workspace_color: running
                        multiple: true
                        collapsed: true
                    navigation:
                      component: bb_theme:nav
                      props:
                        variant: main
                        collapsed: true
                        label: Primary
                        items:
                          - title: My work
                            url: /admin/bakers/work
                            icon: ticket
                            in_active_trail: true
                            below: []
                          - title: Groups
                            url: /admin/bakers/group
                            icon: dashboard
                            in_active_trail: false
                            below: []
                          - title: Projects
                            url: /admin/bakers/project
                            icon: project
                            in_active_trail: false
                            below: []
                          - title: Settings
                            url: /admin/bakers/settings
                            icon: settings
                            in_active_trail: false
                            below: []
                          - title: Teams
                            heading: true
                            icon: team
                            open: true
                            action:
                              icon: plus
                              label: New team
                            below:
                              - title: Team A
                                url: /admin/bakers/team/team-a
                                in_active_trail: false
                                mark:
                                  initials: TA
                                  color: running
                              - title: Team B
                                url: /admin/bakers/team/team-b
                                in_active_trail: false
                                mark:
                                  initials: TB
                                  color: lease
                    actions:
                      - component: bb_theme:person
                        props:
                          variant: compact
                          initials: CW
                          color: lease
                          size: md
                      - component: bb_theme:mode_toggle
                        props:
                          mode: light
                          label: Choose theme
                content: $content
                footer:
                  component: bb_theme:status_bar
                  slots:
                    refresh:
                      component: bb_theme:badge
                      props:
                        label: Auto-refresh on
                        tone: running
                        dot: true
                        suffix: updated 4s ago
                overlay: $overlay
        - name: gate
          group: Shell
          section: shell
          docs: |-
            THE SECOND CHROME, and the peer of the shell above rather than a state of it (BB-415 D6). It frames everything that stands BEFORE the product — a surface that is, by definition, outside every workspace — and its first and only inhabitant is the workspace chooser, in `sections/gate/gate.section.scenes.yml`.

            WHY A SCREEN OUTSIDE EVERY WORKSPACE CANNOT USE THE SHELL. The rail is workspace-ambient: `BbRailSource::railItem()` emits no My work row on a route that carries no workspace, so the shell here would render a navigation whose entries lead nowhere. That reads as a defect rather than as a state, and no amount of prop-setting on the shell fixes it — the absence is in the ROUTE, not in the props.

            IT IS DECLARED HERE FOR EXACTLY THE REASON THE SHELL IS. BB-378 made this file the only place a chrome may be declared, so that a screen scene opens with `scene: "design-system:<chrome>"` and fills `content` rather than retyping the frame. Two chromes now means two declarations in one file, not two files.

            ITS `content` IS THE `$content` PLACEHOLDER, the same injection point the shell carries, so the substitution mechanism is identical and a reader who knows one knows the other. Rendered as its own story the marker has nothing to substitute and shows as literal text: that is the injection point made visible, not a rendering fault.

            NO OVERLAY, NO SEARCH, NO STATUS BAR, and each absence is a decision rather than an omission. Search reaches tickets, runs and conductors — all workspace-scoped, none of them reachable from a page whose whole point is that no workspace has been chosen yet. So when search returns in its own ticket (BB-503 retired the `command_palette` component together with its only trigger), the gate is the one surface that must still not carry it. A status bar reports an auto-refresh over data that is not being shown. And `action-pattern.md` puts every create or confirm surface in the shell's `$overlay`; a gate opens none, because the one action it offers is choosing, and choosing is a navigation.

            NO ISLAND BOUNDARY CROSSES IT EITHER, which is the other half of what makes it small. The shell's `island-rail` and `island-content` exist so a navigation can replace the content and leave the rail as it was; a gate has no rail to leave, and every link on it leaves the gate entirely. Storybook renders no island in any case (BB-396 D15) and this scene simulates none.

            THE TITLE IS THE PRODUCT NAME AND NOT THE SCREEN'S QUESTION, which is a correction made while the
            chooser was being built rather than a preference. One page layout matches `/home` and therefore
            frames BOTH of the controller's 200 answers — the chooser and the named absence — so a chrome
            titled "Choose a workspace" would have told an operator who belongs to no workspace to choose one.
            The chrome says who is asking; the content says what is being asked. A screen's own sentence
            belongs in `content`, exactly where its data does.
          items:
            - component: bb_theme:gate
              props:
                title: ''
              slots:
                mark:
                  component: bb_theme:brand
                  props:
                    size: compact
                content: $content
        - name: onboarding
          group: Shell
          section: shell
          docs: |-
            THE ONBOARDING WIZARD CHROME. Brand, optional step copy and the form
            card stack in one centred column. Screens open with
            `scene: "design-system:onboarding"` and fill `content`, `title` and
            `description`.
          items:
            - component: bb_theme:onboarding
              props:
                title: $title
                description: $description
              slots:
                mark:
                  component: bb_theme:brand
                content: $content
        - name: team-create-action
          group: Shell
          items:
            - component: bb_theme:shell
              slots:
                sidebar:
                  component: bb_theme:sidebar
                  props:
                    collapsed: false
                    label: Workspace navigation
                  slots:
                    navigation:
                      component: bb_theme:nav
                      props:
                        items:
                          - title: Teams
                            heading: true
                            icon: team
                            open: true
                            action:
                              label: New team
                              icon: plus
                              href: /bakers/team/create
                            below: []
                content: $content
        - name: account-shell
          group: Shell
          section: shell
          docs: 'Own-account rail: Account, Conductors and Machines stay at the top. Workspaces (/home) and Log out form a bottom group, in that order, above the footer identity. Both use full-page navigation and remain reachable collapsed or in a short viewport.'
          items:
            - component: bb_theme:shell
              slots:
                sidebar:
                  component: bb_theme:sidebar
                  props:
                    collapsed: false
                    label: Account navigation
                  slots:
                    workspace:
                      component: bb_theme:account_switcher
                      props:
                        workspace_label: Workspaces
                        workspace_initials: ''
                        workspace_color: running
                        multiple: true
                        collapsed: false
                      slots:
                        workspace_panel:
                          - component: bb_theme:menu_item
                            props:
                              label: keytec
                              url: /keytec/tickets
                              current: true
                              mark:
                                initials: KE
                                color: running
                                picture: /themes/custom/bb_theme/assets/brand/bakers-tui-braid-v2.png
                          - component: bb_theme:menu_item
                            props:
                              label: bakers.build
                              url: /bakers/tickets
                              current: false
                              mark:
                                initials: GA
                                color: attention
                                picture: ''
                    navigation:
                      component: bb_theme:nav
                      props:
                        variant: main
                        label: Primary
                        items:
                          - title: Account
                            url: /?path=/story/designbook-sections-user-scenes--account-overview
                            icon: settings
                            in_active_trail: true
                            below: []
                          - title: Conductors
                            url: /user/1/conductors
                            icon: conductor
                            in_active_trail: false
                            below: []
                          - title: Machines
                            url: /user/1/machines
                            icon: machine
                            in_active_trail: false
                            below: []
                          - title: Workspaces
                            url: /home
                            icon: dashboard
                            full_page: true
                            at_end: true
                          - title: Log out
                            url: /user/logout/confirm
                            icon: log-out
                            in_active_trail: false
                            below: []
                            full_page: true
                    actions:
                      - component: bb_theme:person
                        props:
                          variant: compact
                          display_name: cw
                          initials: CW
                          color: lease
                          size: md
                      - component: bb_theme:mode_toggle
                        props:
                          mode: light
                          label: Choose theme
                content: $content
                footer:
                  component: bb_theme:status_bar
                  slots:
                    refresh:
                      component: bb_theme:badge
                      props:
                        label: Auto-refresh on
                        tone: running
                        dot: true
                        suffix: updated 4s ago
                overlay: $overlay
    hash: 9c1764047f6a7ba620e1538d15dd4aeb1726294bb3cc524f8f1743ef240cc9f2
  - path: sections/projects/projects.section.scenes.yml
    file:
      id: projects
      group: Designbook/Sections/Projects
      title: Projects
      description: |
        **Product place: Projects** and **Groups** (two nav top-level entries), plus the
        **Conductors** and **Machines** listings (BB-619) as sibling user-area rail items with Account. List of projects, then
        **project detail** (lead surface) when a row is opened; Groups is its own list. IA:
        `docs/specs/ia-home-nav-roles-decisions.md`, plan: `docs/specs/project-lead-surface.plan.md`
        (BB-358).

        **Product section map (replaces BB-331 six-way nav sections):**

        | Section id | Product place | Rail |
        |---|---|---|
        | `tickets` | My work (+ ticket detail/actions) | My work |
        | `projects` | Groups list; Projects list + **project detail**; Conductors list + conductor Overview; Machines list | Groups; Projects; user-area Conductors; user-area Machines |
        | `settings` | Settings (workspace + labels) + team detail | Settings; Teams rows |

        Retired as product sections: `dashboard`, `board`, `runs` (no rail; board/runs
        content folds into project detail, team detail, or ticket detail).

        **Screens**

        - `projects` — project **list** only: project table with Title search above it. Environments and
          members hang on the **project**, not on this list — they belong on project detail. Groups is a
          sibling rail destination, not a block on this list.
        - `groups` — Groups **list**: groups table with Title search above it, the sentence that a group
          grants no permissions, and New group.
        - `conductors` — Conductors **list** (BB-619): Title search and this account's
          conductors (linked label, status, reported load), reached from the person
          mark as Conductors. Read-only: no create control. The
          project Conductors tab is the project's conductors and reuses this listing chrome.
          Machines is the sibling listing of this account's machines.
        - `machines` — Machines **list** (BB-619): Title search and this account's
          machines (linked name, host key, load, max parallel), reached from the
          person mark as Machines. Read-only listing; View and Edit live on the row.
        - `machine-detail-overview` — one machine's View: host key, max parallel,
          current load, workspace, owner. Two tabs, View and Edit.
        - `conductor-detail-overview` — one conductor's Overview: Activities beside one Identity card
          (label, conductor ID, project, machine, owner). One tab. Sample id 1 is inactive; id 2 is active.
        - `project-detail` — entity chrome = header + **tabs** (IA D12). **No project-edit route.**
          Tab set (BB-454, seven tabs — `Delivery` retired in favour of the broader `Stats`, `Tickets`
          joins as its own tab which BB-428 had already delivered without this scene reflecting it):
          1. **Overview** (default) — the project's `full` view mode is the tab body (`canvas` with page_header, main, inspector). Mark beside a plain title, key · group caption, tabs (no search, no team switcher). Description then **Activities** in `main` (`bb_activity` `event` rows; `empty-state` when none). Inspector: Properties, Epics. Count figures belong on the Board. Settings is the write surface.
          2. **Board** — operational board and active conductor capacity
          3. **Tickets** — this project's tickets (native Views listing; no Designbook body of its own)
          4. **Stats** — closed-work delivery lookback (Week|Month) **and** crew load, one tab
          5. **Runs** — this project's runs (native Views listing since BB-454; a follow-up may still
             design its body)
          6. **Members** — the project's people: one `list`, and the add form that writes them
          7. **Settings** — Environments, with its add
          Scenes: `project-detail-overview`, `project-detail-board`, `project-detail-stats`,
          `project-detail-runs`, `project-detail-members`, `project-detail-settings`
          (+ `project-detail-overview-teams-open`, `project-detail-overview-flowing`). `Tickets` reuses the `tickets` section's own
          `ticket-list` scene rather than a new one — the tab is reachable and correctly named, and the
          listing itself is not a second Designbook artifact.

          **Members IS ITS OWN FACE, and Settings no longer carries it** (BB-435). It was item 5 of this
          set as one of "two blocks on one tab" beside Environments, which filed the same object under
          infrastructure here and under people on the team screen — the team detail has had a Members face
          since BB-419. One object cannot be two kinds of thing depending on which screen is open, so the
          block moved out and Settings kept Environments alone.

        **Board model** — Not assigned (open, no conductor), Intake (open, conductor
        and qualification), Working (open, conductor, every other state). Done is
        closed tickets. Work-state chips are all four; the three open ones start
        active and Done is off, so the Done column stays detached until that chip
        is on. Summary chips filter State, Assignee, Priority, Work state and Parent.
        The Done column owns the 10 / 25 / 50
        size (default 10) in the operational component story. Details splits only
        Working by exact workflow state. Blocked and Cancelled remain textual markers.
        The legacy four-phase component story remains a generic compatibility example.

        **Action surface:** `project-create` (dialog over the list). Team assignment is edited on
        **Settings**, not via a header switcher on Overview.

        **Groups is its own screen**, opened by the Groups rail entry. Create from that screen's `[+]`.
        A group still has no entity-detail page.

        **Layout.** Every scene here inherits the one shell (`scene: "design-system:shell"`) and fills its
        `content` with exactly one `canvas`; headings, regions and spacing follow
        `designbook/design-system/layout.md`, which is the rule document for the layout layer.
      status: in-progress
      order: 2
      user_flows: |
        - Open Projects; open a row → project **Overview** (default).
        - Project identity on Overview is the mark, the title and the key · group caption — **no** project-edit page. Reversible writes live on Settings.
        - **Board** tab for operational work; **Stats** for statistics, **Tickets** / **Runs** for
          native listings.
        - **Members** tab: the project's people as a list; add through the form on that face, change a
          member's role on the member's own item, remove from the item that names them.
        - **Settings** tab: Environments, with its add.
        - On Projects: the project table with Title search; create via `[+]` dialog (owner/teams, not
          full roster).
        - On Groups: the groups table with Title search; create via `[+]`.
      ui_requirements: |
        **Entities read**

        - `view.projects` — the project table and the projects side of the n:m team assignment. A LISTING IS
          A VIEW, and the View owns the table: six columns and their rows come from
          `entity-mapping/view.projects.default.jsonata`, which reads `name`, `key`, `teams`, `group_id`
          and `owner_user_id`. The `bb_project.bb_project.teaser` view mode this replaced is gone — a
          listing row was never a view mode.
        - `view.groups` — the Groups screen. Five columns; reads `name`, `billing_profile` and
          `owner_user_id`.
        - `view.environments` — **project detail only**. Four columns; reads `name`, `base_url`, `tier`,
          `branch`. Not on the projects list.
        - `og_membership.default` — **project detail** (and team) member items, `teaser`. Reads `uid`,
          `entity_type`, `entity_id`, `state`, `roles`. Not on the projects list.
        - `user.user` — every person on member rows, `compact`. Reads `display_name`, `initials`,
          `mail`, `status`.

        **LIST SCREEN SHAPES.** Projects and groups are TABLES on separate screens: values compared down a
        column, headers with sort where a Drupal view can order. A multi-value teams cell or computed
        environment count carries no sort rather than a fake one. Environments and members are **not**
        list blocks — they hang on the project and ship with project-detail, environments as a table on
        **Settings** and members as a `list` on their own **Members** face. A MEMBER LIST IS A LIST, NOT A
        TABLE, which is the `settings` section's rule and reaches this screen too: no columns and no header
        row, on the project exactly as on the team. Members are therefore not the table presenter's to
        claim.

        **The divergence is scoped and deliberate.** `board-card` (BB-334/335) keeps its pattern
        unchanged; this reshape is BB-338's organisation surfaces only. (`node-row` belonged in that list
        until BB-378 deleted it — reachable from no Designbook scene.) The tickets table left the list
        when every listing became a View: it is `view.tickets`, the same shape as the two list screens,
        so the pattern the sentence used to protect is now shared rather than diverged. Said here rather
        than left silent, so the next author reads a decision instead of an inconsistency.

        **Filters**: Title search on each list screen — a visible associated Title label, input name
        `title`, empty default, and NO submit button — composed in `canvas.main` above the View table.
        The field submits itself: Enter, or the autosubmit the exposed form already runs on the ticket
        list, so a second control that says "now do it" never appears. Not a
        `canvas.filters` aside and not shell chrome. Empty input means no title restriction. Storybook
        demonstrates appearance, not server-side filtering. The workspace still comes from the shell
        switcher rather than from a control here.

        **Not a filter**: the workspace, for the same reason it is not one anywhere else (BB-327). The
        screens here are scoped to workspace 1 accordingly: the project table lists the two projects of
        that workspace and not the third, which belongs to the other tenant.

        **Which surfaces grant permissions, and how a screen says so.** The workspace and the project are
        the only two rights levels, so the member rows on this screen carry a role. A group carries none —
        `og.settings` registers only the workspace and the project as OG groups — and the Groups screen
        therefore states in words that it grants no permissions, because an absent column is not by itself
        a statement: an operator who finds no role cell cannot otherwise tell whether the surface grants
        nothing or the screen forgot the column. The rule is enforced one level below the screen, in
        `og_membership.default.teaser.jsonata`, which branches on `entity_type`.

        **UI patterns: everything inline, and one dialog.** Everything reversible is edited inline with
        `option_picker` in its `inline` variant — a role, a team assignment — where the pick IS the write:
        no save button, no per-field dirty state, no confirmation, because none of these fields has the
        conductor's server-side side effect. The one surface that creates a PROJECT is a centered `dialog`
        in the shell's `overlay` slot, exactly as `designbook/design-system/action-pattern.md` prescribes;
        it was a full-page route through this ticket's design gate and the human reversed that at the
        coding gate, which is why the pattern document now records **no exception at all**. There is **no
        edit route and no edit dialog**. Adding a MEMBER is a form on the Members face rather than a
        dialog, for the reason set out under *Project members* below — it is an addition to the face it
        sits in, with no list context to lose, which is the condition the dialog rule is written for.

        **Project members (on the Members face, not this list) need three affordances.**

        **A MEMBER IS ADDED THROUGH A FORM, AND ONLY THERE** (BB-435). This sentence used to say the
        opposite — "Add is an assignment (picker; pick IS the write — never a second create dialog beside
        `project-create`)" — and it is deleted rather than softened, because it contradicted the rule it
        sat beside. Adding a person to a group CREATES an `og_membership`; it is not a reversible field
        edit, and *Inline edit*'s reason does not reach it: there is no value to put back. So the add
        surface is a form the operator SUBMITS, which gives the addition a moment that can be abandoned.
        There is no second way in — no inline picker, no autocomplete that commits on select, and no route.
        The form serves the team screen and this one from one place, parameterised by the group it is
        rendering for.

        **It is a form in the MAIN CONTENT, not a dialog**, and that is a decision with a reason rather
        than an exception being taken. `action-pattern.md` reserves the centered `dialog` for a create
        surface that has a LIST CONTEXT to lose; this control lives inside the face it changes, and a
        successful submit re-renders that face and nothing else — the tab strip, the rail and the shell
        stay where the operator left them. A dialog would take the list away in order to add to it.

        Remove is SINGLE-STEP AND NAMES ITS EFFECT: the rule confirms an action exactly when it ends or
        discards the ticket; a membership removal does neither, so there is no confirmation. The control
        names the effect — "Remove Sven Gruber from the project. Revokes their access." — via
        `og_membership.default.teaser.jsonata`.

        The role is changed on the member's own item, with `option_picker` in its `inline` variant: a role
        IS reversible, so here the pick genuinely is the write — no save button, no dirty state, no
        confirmation. A project ships exactly two roles, `lead` and `member`, and `member` is
        `role_type: required`, so it is never stored and an empty `roles` array IS a member. A TEAM member
        item now carries the same role control (BB-456 D9 ships the team its first `role_type: standard`
        role, `lead`), so this face and the team's own share one code path — the form reads the role
        vocabulary, never the entity type.

        **Both interactive cells — role and remove — render as `rendered` cells**, the ninth cell kind
        (BB-435). A cell is DATA, and the panel markup of a picker or a button exists in exactly one
        place — `option_list` and `button` — so `MemberItemBuilder` builds each control's render array
        once and a `#pre_render` on the form wrapper turns it into markup at render time; the cell only
        ever addresses that markup by its key. `markup` must be a `MarkupInterface` object, never a string
        and never a render array, which is why Twig prints it unescaped and exactly once where it would
        escape a plain string. This replaces what used to be a `picker` cell for the role and an `action`
        cell for remove — the eighth kind, still used elsewhere for a row control that IS the record's own
        value rather than markup deferred from a component another layer already produced.

        **ALL THREE NOW WRITE, and this paragraph used to say none of them did.** Its claim — "nothing in
        this theme has ever written a membership — so the control is rendered and reachable and writes
        nothing, exactly like every other pick on these screens" — was true when it was written and is
        false now. Adding, changing a role and removing each store an `og_membership` and each survive a
        reload. What still writes nothing is every OTHER pick on these screens; members are no longer one
        of them, and that is the difference this section had to stop hiding.

        **The n:m team assignment lives on `bb_project.teams`** and nowhere else, because `bb_team`
        carries only `name`, `workspace_id` and `owner_user_id`. Both ends therefore read and edit one
        field, which is why the assignment reads the same from this screen and from the team screen in the
        `workspace` section.

        **The Drupal binding for these listings is the VIEW**, not an entity view display — which is now
        what the designbook side says too. The `teaser` view modes existed only because a row had to be
        renderable in Storybook somehow, and `entity: "view.<id>"` is that somehow, so the workaround is
        gone rather than renamed. In Drupal a list row is bound by the view:
        `config/sync/views.view.active_tickets.yml` renders its rows with `row: type: ui_patterns` and
        names the component directly. This section generates neither the view nor the display — no
        `sync-to` was run and no `config/sync` file was touched.

        **Nothing posts IN A SCENE**, which is a statement about the medium and no longer about the
        product. Storybook posts nowhere and never calls `Drupal.attachBehaviors`, so every `[+]`, picker,
        create row and inline control here is rendered, reachable and inert, and every open state in these
        scenes is a **prop** rendered as an accessible attribute — `aria-expanded` plus `hidden` — never a
        CSS class. Overview identity is a plain title (no search, no team switcher). What changed
        with BB-435 is what the same markup does on the SERVER: the three member affordances write real
        `og_membership` entities there. A scene proves the shape; the browser suite proves the behaviour,
        and neither stands in for the other.

        **Single-entity records are selected by pinned id** (`select: "$[id='1']"`), never by tag: the
        sample data carries `__designbook.section` values that predate these section ids, so no record is
        tagged for this section and a tag-selecting scene would find nothing. The same choice BB-335
        made, for the same reason. **A LISTING selects nothing** — a `view.<id>` node is self-contained and
        its mapping enumerates the rows, which is why the tables here carry no `select:` at all.
      scenes:
        - name: projects
          group: Screens
          section: projects
          docs: |-
            THE PROJECTS LIST. Opened by the top-level `Projects` rail entry. One listing only: the project table, with Title search above it. Environments and members hang on the project entity and live on **project detail** — not as pinned-project blocks on this list. Groups is its own rail destination (`groups` in this section) and is not a block here.
            THE TABLE IS SCOPED TO WORKSPACE 1. Two projects, not three. The teams cell is the projects-side half of the n:m relation. The Environments column is a count on the row, not a second table of environment records.
            TITLE SEARCH sits in the listing zone, above the View table: a visible Title label associated with the `title` input, empty by default, and NO submit button — the field submits itself on Enter or by autosubmit. Appearance only — Storybook does not filter.
            Nothing posts and nothing opens. Every `[+]` and every picker is rendered, reachable and inert.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Projects
                            description: keytec · 2 projects · the work unit that decides which tickets you can see
                          slots:
                            actions:
                              component: bb_theme:button
                              props:
                                variant: primary
                                label: New project
                                icon_only: true
                                href: /admin/bakers/project/add
                              slots:
                                icon:
                                  component: bb_theme:icon
                                  props:
                                    name: plus
                                    size: sm
                      main:
                        - component: bb_theme:zone
                          slots:
                            content:
                              - component: bb_theme:zone
                                props:
                                  direction: row
                                  inset: none
                                  gap: sm
                                slots:
                                  content:
                                    - component: bb_theme:form_label
                                      props:
                                        for: edit-title
                                      slots:
                                        title: Title
                                    - component: bb_theme:form_input
                                      props:
                                        type: text
                                        name: title
                                        id: edit-title
                                        value: ''
                              - entity: view.projects
                                view_mode: default
        - name: groups
          group: Screens
          section: projects
          docs: |-
            THE GROUPS LIST. Opened by the top-level `Groups` rail entry. One listing only: the groups table, with Title search above it. A group grants no permissions — rights come from the workspace and the project only. Groups are for create / billing context beside the projects they bundle; they are not a membership surface.
            THE TABLE IS SCOPED TO WORKSPACE 1. One group, not two. Northwind belongs to the other tenant.
            TITLE SEARCH sits in the listing zone, above the View table: a visible Title label associated with the `title` input, empty by default, and NO submit button — the field submits itself on Enter or by autosubmit. Appearance only — Storybook does not filter.
            The New group affordance lives on this screen's header, matching New project on Projects. The listing zone has no heading of its own: the page header already names Groups.
            Nothing posts and nothing opens. Every `[+]` is rendered, reachable and inert.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Groups
                            description: keytec · 1 group · the customer and its cost centre
                          slots:
                            actions:
                              component: bb_theme:button
                              props:
                                variant: primary
                                label: New group
                                icon_only: true
                              slots:
                                icon:
                                  component: bb_theme:icon
                                  props:
                                    name: plus
                                    size: sm
                      main:
                        - component: bb_theme:zone
                          props:
                            description: A group grants no permissions — rights come from the workspace and the project only.
                          slots:
                            content:
                              - component: bb_theme:zone
                                props:
                                  direction: row
                                  inset: none
                                  gap: sm
                                slots:
                                  content:
                                    - component: bb_theme:form_label
                                      props:
                                        for: edit-title
                                      slots:
                                        title: Title
                                    - component: bb_theme:form_input
                                      props:
                                        type: text
                                        name: title
                                        id: edit-title
                                        value: ''
                              - entity: view.groups
                                view_mode: default
        - name: group-detail-overview
          group: Screens
          section: projects
          docs: |-
            ONE GROUP's OVERVIEW, the canonical face of the group screen. Reached by clicking a group's name in the Groups listing — `/{workspace}/group/{id}` is Overview because a default local task IS the base route.
            THE SCREEN OWNS THE CHROME, exactly as `project-detail-overview` does: `page_header` carries the group's image as a compact mark beside its name, and two tabs — Overview (active) and Settings. The tabs are a screen-level fact no single-record mapping can know.
            THE BODY IS THE ENTITY'S OWN VIEW MODE: `canvas.main` places one `bb_group.bb_group` `full` entity node, selected on this group's id: the Activities feed of the group's projects' tickets beside read-only cards — Properties first (Name, Workspace, Owner), then Identity (Description).
            NOTHING ON OVERVIEW SAVES. Settings edits name, description and image, gated on `update` access. Storybook cannot render an island, so the tabs are plain links and `active` is a prop.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: keytec
                            description: Group · the customer and its cost centre
                          slots:
                            leading:
                              component: bb_theme:person
                              props:
                                variant: compact
                                size: md
                                initials: KE
                                color: attention
                                image_fit: contain
                                picture: /themes/custom/bb_theme/assets/brand/bakers-tui-braid-v2.png
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Group sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--group-detail-overview
                                    active: true
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--group-detail-overview
                      main:
                        - entity: bb_group.bb_group
                          view_mode: full
                          select: $[id='1']
        - name: conductors
          group: Screens
          section: projects
          docs: |-
            THE CONDUCTORS LIST. Opened from the user area Conductors tab. One listing: this account's conductors, with Title search above it. Each row is the linked label (registration id when the label is blank), status, and reported load. There is no create control — registration stays with the conductor process.
            THE TABLE IS THIS ACCOUNT'S CONDUCTORS. Two sample conductors. Title search sits in the listing zone, above the View table: a visible Title label associated with the `title` input, empty by default, and NO submit button. Appearance only — Storybook does not filter.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Conductors
                            description: The claim-and-dispatch loops of this workspace
                      main:
                        - component: bb_theme:zone
                          slots:
                            content:
                              - component: bb_theme:zone
                                props:
                                  direction: row
                                  inset: none
                                  gap: sm
                                slots:
                                  content:
                                    - component: bb_theme:form_label
                                      props:
                                        for: edit-title
                                      slots:
                                        title: Title
                                    - component: bb_theme:form_input
                                      props:
                                        type: text
                                        name: title
                                        id: edit-title
                                        value: ''
                              - entity: view.conductors
                                view_mode: default
        - name: conductor-detail-overview
          group: Screens
          section: projects
          docs: |-
            ONE CONDUCTOR's OVERVIEW, the canonical face of the conductor screen. Reached by clicking a conductor's name in the Conductors listing — `/{workspace}/conductor/{id}` is Overview because a default local task IS the base route.
            THE SCREEN OWNS THE CHROME: `page_header` carries the conductor name and one tab — Overview — with `Overview` active. There is no Settings tab.
            THE BODY IS THE ENTITY'S OWN VIEW MODE: `canvas.main` places one `bb_conductor.bb_conductor` `full` entity node, selected on this conductor's id. Its mapping, like the Drupal display, emits a canvas of its own — the Activities feed in `main` and one Identity card in `inspector` — so the card is not composed here. The screen shows no states, status, last seen or load (heartbeat values; states set at registration). Sample record 1 is inactive, so the footer below the card offers Enable conductor.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: cw · framework
                            description: Conductor · the claim-and-dispatch loop
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Conductor sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--conductor-detail-overview
                                    active: true
                      main:
                        - entity: bb_conductor.bb_conductor
                          view_mode: full
                          select: $[id='1']
        - name: conductor-detail-overview-idle
          group: Screens
          section: projects
          docs: THE ACTIVE CONDUCTOR Overview. Same chrome as `conductor-detail-overview`, selected on sample id 2, which is active, so the footer below its Identity card offers Disable conductor.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: mvd · shop
                            description: Conductor · the claim-and-dispatch loop
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Conductor sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--conductor-detail-overview
                                    active: true
                      main:
                        - entity: bb_conductor.bb_conductor
                          view_mode: full
                          select: $[id='2']
        - name: machines
          group: Screens
          section: projects
          docs: |-
            THE MACHINES LIST. Opened from the user area Machines tab. One listing: this account's machines, with Title search above it. Each row is the linked name, host key, current load and max parallel.
            THE TABLE IS THIS ACCOUNT'S MACHINES. Two sample machines. Title search sits in the listing zone, above the View table: a visible Title label associated with the `title` input, empty by default, and NO submit button. Appearance only — Storybook does not filter.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Machines
                            description: The hosts this account owns
                      main:
                        - component: bb_theme:zone
                          slots:
                            content:
                              - component: bb_theme:zone
                                props:
                                  direction: row
                                  inset: none
                                  gap: sm
                                slots:
                                  content:
                                    - component: bb_theme:form_label
                                      props:
                                        for: edit-title
                                      slots:
                                        title: Title
                                    - component: bb_theme:form_input
                                      props:
                                        type: text
                                        name: title
                                        id: edit-title
                                        value: ''
                              - entity: view.machines
                                view_mode: default
        - name: machine-detail-overview
          group: Screens
          section: projects
          docs: |-
            ONE MACHINE's VIEW, the canonical face of the machine screen. Reached by clicking a machine's name in the Machines listing — `/user/{user}/machine/{id}` is View because a default local task IS the base route.
            THE SCREEN OWNS THE CHROME: `page_header` carries the machine name and one tab — View — active. There is no Edit tab: the Identity and Capacity cards edit name and max parallel, and the former `/edit` url redirects to View.
            THE BODY IS THE ENTITY'S OWN VIEW MODE: `canvas.main` places one `bb_machine.bb_machine` `full` entity node — the Activities feed of runs on this machine's conductors beside the Identity and Capacity cards.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: cw · laptop
                            description: Machine · host capacity
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Machine sections
                                items:
                                  - label: View
                                    url: /?path=/story/designbook-sections-projects-scenes--machine-detail-overview
                                    active: true
                      main:
                        - entity: bb_machine.bb_machine
                          view_mode: full
                          select: $[id='1']
        - name: addons
          group: Screens
          section: projects
          docs: |-
            THE ADDONS TAB (BB-654). Workspace Settings › Addons — view `addons`, display `settings`, path /{ws}/settings/addons, the third tab after Settings and Members. Workspace leads only, like Members; there is no rail entry. Every registered addon ONCE, at its newest version, and the conductors of this workspace that run any of its versions. Read-only: no search, no toolbar, no actions, and rows open nothing.


            Each row is the newest version's icon (its inline SVG, or the initials of its label), the label and the name, every version of the name newest first, the newest version's contract, and one status badge per conductor of this workspace and version it runs.


            TWO SAMPLE ROWS. Ports (versions 1.2.3, 1.1.0) carries an SVG icon and two conductors, srv01-bakers online on 1.2.3 and laptop-cw offline on 1.1.0. Bare (1.0.0) has no icon and no conductor in this workspace.


            Drupal renders the title as the view's display-size zone heading; this scene mirrors the sibling Settings tabs, where the page header carries it and the tab row.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Addons
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Workspace settings
                                items:
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-settings-scenes--settings
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-settings-scenes--workspace-members
                                    active: false
                                  - label: Addons
                                    url: /?path=/story/designbook-sections-projects-scenes--addons
                                    active: true
                      main:
                        - component: bb_theme:zone
                          props:
                            description: Every registered addon at its newest version, and the conductors of this workspace that run it.
                          slots:
                            content:
                              - entity: view.addons
                                view_mode: default
        - name: project-create
          group: Actions
          section: projects
          docs: |-
            THE CREATE DIALOG OF THE PROJECTS SCREEN, centered in the shell's `overlay` slot over the list it was opened from. It is the same hull BB-332 agreed and BB-335 built for `ticket-create`, obeying the same rule: `action-pattern.md` › *Create and edit surfaces* — a create surface is a centered `dialog` in the shell's `overlay` slot, not an off-canvas tray and not a standalone route.
            IT WAS A FULL-PAGE ROUTE UNTIL THE CODING GATE, and the reversal is what this scene is now for. The design gate argued that the rule's own reason for rejecting a route — a route loses the LIST CONTEXT and cannot serve the edit and cancel cases, which must overlay a detail screen — did not reach a project form, because a project has no detail screen and no edit case at all. The human read the first half of that reason back: a project form has no detail screen, true, but it does have a LIST, and this dialog overlays exactly the list context the reason is about. So the rule applies here as written, `action-pattern.md` records NO exception any more, and the design system carries one pattern instead of a pattern plus a footnote. A pattern with a footnote invites the next surface to claim one.
            THE SCREEN BEHIND THE DIALOG IS THE `projects` SCENE ITSELF, aliased (`*projects_screen`) rather than retyped. That is not a saving: it is what makes "the create surface preserves the list context" a property of the file. A retyped list would drift from the screen it claims to be the context of, and the drift would be invisible — two screens that look alike is exactly the failure this design keeps catching elsewhere.
            WHAT DID NOT CHANGE IS THE FORM. The widget grammar is the one every create surface uses, and moving the hull changed none of it: no visible labels, three borderless text lines, a `property_row` of `option_picker` pills, a pill showing the field name when nothing is set and the name beside the value when something is, and one primary submit beside one cancel. The panel's clear row is first and its create row last WHEREVER EITHER IS OFFERED — on this surface neither is, and the paragraph on selection-only pickers below says why. What the route needed and the dialog does not is its hand-built action bar: the `dialog` component owns an `actions` slot that already right-aligns, so the titleless `page_header` the route used as an action bar is gone.
            WHERE THE ACTION ROW RENDERS, WHICH IS NOW WHERE THIS SCENE PUTS IT. This paragraph used to record the delivery's one named divergence: the scene composed Cancel and `Create project` into the `dialog`'s own `actions` slot and the BUILT dialog rendered them INSIDE THE BODY instead, beneath the surface, because the generic hull filled `message` and `body` and nothing else and there was no footer for the row to reach. THE DIVERGENCE IS CLOSED and the scene is what the build matches. What closed it is the choice named two paragraphs down: the generic hull grew an `actions` slot, and a wrapped form lifts its row into it. The lift is the mechanism worth knowing, because it is not free — the hull is the form's ANCESTOR, so the row renders OUTSIDE the `<form>`, and the submit only submits because it is stamped with a `form` attribute naming its own form's id.
            THE HULL CARRIES NO ID OF THIS SURFACE'S, WHICH IS WHY THIS SCENE STATES NONE. The generic wrapper passes `open`, `title` and `dismissible` and no `id`, so the component falls back to its own default — and with ONE hull serving every create dialog in the product, a per-surface id is not something the build can give. The scene therefore renders the same default the page does. What names THIS surface, for a test or for an `aria-controls`, is the FORM's own id, which is stable and unique per subject: the browser suite binds `dialog[data-dialog]:has(form#…-form)` on both create dialogs for exactly that reason.
            TWO WAYS TO CLOSE IT WERE WEIGHED, AND (2) WAS TAKEN — on the operator ruling of 2026-09-08 that the two create dialogs must behave the same. (1) A HULL TEMPLATE OF THIS FORM'S OWN, composing `bb_theme:dialog` and setting `#island_own_hull => FALSE` so the generic wrapper stands aside — which is what the ticket dialog used to do, and which buys a footer at the cost of a second hull to keep in step with the first. (2) AN `actions` SLOT ON THE GENERIC `island` HULL, so any wrapped route can hand it a row and the body template's boolean becomes unnecessary — one hull for everything, at the cost of teaching a generic wrapper about a shape only forms have. This scene predicted the trigger correctly and it is worth recording that it did: "two hand-composed hulls is the point at which (1) stops being the cheap answer." That point arrived, the ticket dialog gave up its own hull rather than this one gaining a second, and the body template's boolean is gone. THE COMING TEAM-ADD AND GROUP-ADD DIALOGS INHERIT THE ANSWER instead of meeting the choice.
            THE GROUP PILL LEADS AND IS PROMINENT, above the title line, the same position `workflow` holds on the ticket create dialog and for the same reason: it decides the cost centre this project is re-invoiced through and cannot be changed cheaply afterwards.
            EVERY PICKER ON THIS SURFACE SELECTS ONLY, and that is BB-421's operator decision reversing an earlier one taken in the same session (spec D7). `group_id` and `teams` carried `creatable`, and neither does now: no picker here offers a create row. `teams` also carried a CLEAR row, and a field the operator cannot clear is how this design system says "this always holds a value" — `bb_project.teams` and `.group_id` are both entity-required, so the clear row was offering a state the server refuses. Both pickers therefore render selection and nothing else.
            WHICH LEAVES A NAMED PRODUCT GAP, and it is recorded here rather than quietly dropped. This scene used to argue that the group panel's create row "is where a group is created now that it has no page". With the row gone that is FALSE for this dialog. Groups is now its own listing screen with a New group affordance; this picker still offers selection only. `action-pattern.md` › *Creating the thing you are looking for* still specifies the create row as a pattern, and the pattern is still right — it is simply unwired here, and wiring it belongs to whichever ticket gives these pickers a write endpoint.
            THREE TEXT LINES, and the second and third are the REPOSITORY's URL and DEFAULT BRANCH — the fields being `repository` and `default_branch`, which is what this scene names them so that a reader can find the thing the form actually submits. A project has no description field, so the grammar's second and third lines carry the thing a new project actually needs typed: the repository URL and the branch runs base work on and merge requests target. `default_branch` is optional and falls back to `main` server-side (spec D5, amended `9d718d2a`) — a repository is rarely useful without naming it, so the field is shown rather than deferred to Settings. `branch_convention` and `env_vars` stay off this surface: they are configuration a project acquires after it exists. `key` and `next_number` are deliberately not on this surface — `key` is derived from the name by whoever wires this up, and `next_number` is machine-owned. Stated here rather than left as a gap for a reader to find.
            AND NO IMPORT PILL. `import_connector` sat in the pill row until BB-421 dropped it (spec D4). BB-554 retires the import surface entirely — the two fields it read are gone from `bb_project` — so the pill does not return.
            NO CONTEXT CONTROL IN THE DIALOG HEAD, AND NO UNRESOLVED-CONTEXT STATE. Rule 8's breadcrumb exists because a ticket needs a project and the operator may have opened the create dialog from somewhere that resolves none — BB-335 spends a whole scene on that case. This dialog opens from the projects screen of ONE workspace, and the workspace switches globally in the shell rather than per surface, so the context is resolved by construction: there is nothing for a breadcrumb to change, the submit has no reason to be disabled, and a `project-create (unresolved context)` scene would render a state that cannot occur. The `context` slot is therefore left empty rather than filled with a control that would decide nothing.
            NO CONFIRMATION. Creating a project is reversible and has no server-side side effect of the kind the conductor field has, so by the rule it is single-step and nothing is named. And nothing posts HERE: the submit is a control in this scene, not a write, and opening and closing the dialog is Drupal behaviour, which Storybook never runs. The close button DOES have a handler in the running app — it and Escape are wired by `island`'s own `island.dialog.js`, which this component reaches by declaring `island/dialog` as a library dependency. This paragraph used to say the button "carries no handler"; that was false from the commit that added one, and the true statement is the narrower one: Storybook runs no Drupal behaviour, so nothing closes in a story.
          items:
            - scene: design-system:shell
              with:
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Projects
                            description: keytec · 2 projects · the work unit that decides which tickets you can see
                          slots:
                            actions:
                              component: bb_theme:button
                              props:
                                variant: primary
                                label: New project
                                icon_only: true
                                href: /admin/bakers/project/add
                              slots:
                                icon:
                                  component: bb_theme:icon
                                  props:
                                    name: plus
                                    size: sm
                      main:
                        - component: bb_theme:zone
                          slots:
                            content:
                              - component: bb_theme:zone
                                props:
                                  direction: row
                                  inset: none
                                  gap: sm
                                slots:
                                  content:
                                    - component: bb_theme:form_label
                                      props:
                                        for: edit-title
                                      slots:
                                        title: Title
                                    - component: bb_theme:form_input
                                      props:
                                        type: text
                                        name: title
                                        id: edit-title
                                        value: ''
                              - entity: view.projects
                                view_mode: default
                overlay:
                  - component: bb_theme:dialog
                    props:
                      open: true
                      title: New project
                      label: New project
                      dismissible: true
                    slots:
                      body:
                        - component: bb_theme:form
                          props:
                            lead_label: Group
                          slots:
                            lead:
                              - component: bb_theme:property_pill
                                props:
                                  prominent: true
                                  name: group
                                  label: Group
                                  icon: project
                                  picker_id: create-project-group
                                  aria_label: Change group. Currently keytec.
                                  value_label: keytec
                                  values:
                                    - '1'
                                  open: false
                                  searchable: true
                                  search_placeholder: Search groups
                                  search_label: Search groups
                                  options:
                                    - value: '1'
                                      label: keytec
                                      description: KT-1000
                                      selected: true
                            lines:
                              - component: bb_theme:form_input
                                props:
                                  type: text
                                  name: name
                                  id: create-project-name
                                  required: true
                                  placeholder: What is this project called
                                  value: bakers.build Designbook
                              - component: bb_theme:form_textarea
                                props:
                                  name: repository
                                  id: create-project-repository
                                  rows: 2
                                  placeholder: The repository this project's tickets branch from
                                  value: https://gitlab.example.com/bakers/designbook
                              - component: bb_theme:form_input
                                props:
                                  type: text
                                  name: default_branch
                                  id: create-project-default-branch
                                  placeholder: Default branch (falls back to main)
                                  value: main
                            pills:
                              - component: bb_theme:property_pill
                                props:
                                  name: teams
                                  label: Teams
                                  icon: team
                                  picker_id: create-project-teams
                                  aria_label: Change teams. Currently Platform crew is set.
                                  value_labels:
                                    - Platform crew
                                  values:
                                    - '1'
                                  open: false
                                  multiple: true
                                  options:
                                    - value: '1'
                                      label: Platform crew
                                      selected: true
                                    - value: '3'
                                      label: Design crew
                                      selected: false
                              - component: bb_theme:property_pill
                                props:
                                  name: owner
                                  label: Owner
                                  icon: project
                                  picker_id: create-project-owner
                                  aria_label: Change owner. Currently Christian Wiedemann.
                                  value_label: Christian Wiedemann
                                  values:
                                    - '1'
                                  open: false
                                  searchable: true
                                  search_placeholder: Search people
                                  search_label: Search people
                                  options:
                                    - value: '1'
                                      label: Christian Wiedemann
                                      selected: true
                                    - value: '5'
                                      label: Lena Fischer
                                      selected: false
                      actions:
                        - component: bb_theme:button
                          props:
                            variant: ghost
                            label: Cancel
                        - component: bb_theme:button
                          props:
                            variant: primary
                            label: Create project
                            type: submit
        - name: project-detail-overview
          group: Screens
          section: projects
          docs: 'PROJECT DETAIL default: Overview. Answers whether the project is running. Scene owns page_header (mark, plain title, key · group, tabs — no search, no team switcher). The project''s `full` view mode is the tab body: a `canvas` with description then Activities in `main`, and Properties and Epics in `inspector`. Each activity row is `bb_activity` in `full` (`event`; `empty-state` “No activity yet.”). Sample id 1 has three activity rows and two epics.'
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: key bakers.build · group keytec
                          slots:
                            leading:
                              component: bb_theme:person
                              props:
                                variant: compact
                                size: md
                                initials: GP
                                color: attention
                                image_fit: contain
                                picture: /themes/custom/bb_theme/assets/brand/bakers-tui-braid-v2.png
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: true
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - entity: bb_project.bb_project
                          view_mode: full
                          select: $[id='1']
        - name: project-detail-overview-teams-open
          group: Actions
          section: projects
          docs: Same Overview `full` view mode as `project-detail-overview`. Team assignment is a Settings write, not a header picker.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: key bakers.build · group keytec
                          slots:
                            leading:
                              component: bb_theme:person
                              props:
                                variant: compact
                                size: md
                                initials: GP
                                color: attention
                                image_fit: contain
                                picture: /themes/custom/bb_theme/assets/brand/bakers-tui-braid-v2.png
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: true
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - entity: bb_project.bb_project
                          view_mode: full
                          select: $[id='1']
        - name: project-detail-overview-flowing
          group: Screens
          section: projects
          docs: 'Overview `full` view mode on sample id 3: empty description omitted, `empty-state` “No activity yet.”, no epics. Same chrome as `project-detail-overview`.'
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Designbook
                            description: key GDB · group keytec
                          slots:
                            leading:
                              component: bb_theme:person
                              props:
                                variant: compact
                                size: md
                                initials: GD
                                color: lease
                                image_fit: contain
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: true
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - entity: bb_project.bb_project
                          view_mode: full
                          select: $[id='3']
        - name: project-detail-board
          group: Screens
          section: projects
          docs: Operational Board for this project. Not assigned has no conductor; Intake is qualification with a conductor; Working is every other open state with a conductor; Done is closed. Work-state chips default to the three open columns; the Done chip reveals the Done column. Summary chips filter State, Assignee, Priority, Work state and Parent. Done size (10 / 25 / 50, default 10) sits in the Done column of the operational component story. Details splits only Working by exact workflow state.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: Board · this project only
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: false
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: true
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - entity: view.project_board
                          view_mode: default
        - name: project-detail-stats
          group: Screens
          section: projects
          docs: 'Statistics: Stats — closed tickets in the time window (BB-454 renamed this tab from `Delivery`; crew load joins the same tab as a follow-up).'
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: Stats · statistics · this week
                          slots:
                            actions:
                              component: bb_theme:option_picker
                              props:
                                variant: inline
                                label: Window
                                name: time_axis
                                id: project-stats-window
                                open: false
                                aria_label: Time window. Currently Week.
                                value_label: Week
                                values:
                                  - week
                              slots:
                                options:
                                  component: bb_theme:option_list
                                  props:
                                    multiple: false
                                    options:
                                      - value: week
                                        label: Week
                                        selected: true
                                      - value: month
                                        label: Month
                                        selected: false
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: false
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: true
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - component: bb_theme:zone
                          props:
                            columns: 3
                            gap: md
                          slots:
                            content:
                              - component: bb_theme:stat-tile
                                props:
                                  value: '12'
                                  label: tickets closed
                                  window: this week
                              - component: bb_theme:stat-tile
                                props:
                                  value: '4'
                                  label: people delivered
                                  window: this week
                              - component: bb_theme:stat-tile
                                props:
                                  value: '3'
                                  label: features closed
                                  window: this week
                        - component: bb_theme:zone
                          props:
                            description: Stats is closed tickets, not runs
                          slots:
                            heading: Closed this week
                            content:
                              component: bb_theme:table
                              props:
                                columns:
                                  - key: identifier
                                    label: Ticket
                                  - key: closed
                                    label: Closed
                                    sort: desc
                                    url: '?order=Closed&sort=asc'
                                  - key: assignee
                                    label: Assignee
                                rows:
                                  - cells:
                                      identifier:
                                        kind: mono
                                        value: BB-380
                                      closed:
                                        kind: mono
                                        value: '2026-06-30'
                                      assignee:
                                        kind: person
                                        initials: CW
                                        color: running
                                  - cells:
                                      identifier:
                                        kind: mono
                                        value: BB-371
                                      closed:
                                        kind: mono
                                        value: '2026-06-27'
                                      assignee:
                                        kind: person
                                        initials: MR
                                        color: lease
        - name: project-detail-runs
          group: Screens
          section: projects
          docs: 'Statistics: Runs — factory pulse for this project.'
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: Runs · statistics · factory
                          slots:
                            actions:
                              component: bb_theme:option_picker
                              props:
                                variant: inline
                                label: Window
                                name: time_axis
                                id: project-runs-window
                                open: false
                                aria_label: Time window. Currently Week.
                                value_label: Week
                                values:
                                  - week
                              slots:
                                options:
                                  component: bb_theme:option_list
                                  props:
                                    multiple: false
                                    options:
                                      - value: week
                                        label: Week
                                        selected: true
                                      - value: month
                                        label: Month
                                        selected: false
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: false
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: true
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - component: bb_theme:zone
                          props:
                            columns: 3
                            gap: md
                          slots:
                            content:
                              - component: bb_theme:stat-tile
                                props:
                                  value: '2'
                                  label: active runs
                                  window: now
                              - component: bb_theme:stat-tile
                                props:
                                  value: '1'
                                  label: problem runs
                                  window: this week
                              - component: bb_theme:stat-tile
                                props:
                                  value: '28'
                                  label: runs finished
                                  window: this week
                        - component: bb_theme:zone
                          props:
                            gap: none
                            description: Row opens the ticket — run history lives there
                          slots:
                            heading: Active and problem
                            content:
                              - component: bb_theme:list
                                props:
                                  layout: lines
                                  items:
                                    - accent: running
                                      cells:
                                        state:
                                          kind: badge
                                          label: running
                                          tone: running
                                          dot: true
                                        from_label:
                                          kind: text
                                          value: from
                                          emphasis: faint
                                        from:
                                          kind: mono
                                          value: coding
                                        conductor:
                                          kind: badge
                                          label: srv02-bakers
                                          tone: neutral
                                          icon: conductor
                                          mono: true
                                        started_label:
                                          kind: text
                                          value: started
                                          emphasis: faint
                                        started:
                                          kind: mono
                                          value: 2026-08-16 09:12
                                        took_label:
                                          kind: text
                                          value: took
                                          emphasis: faint
                                        took:
                                          kind: mono
                                          value: 14m
                                    - accent: attention
                                      cells:
                                        state:
                                          kind: badge
                                          label: failed
                                          tone: attention
                                          dot: true
                                        from_label:
                                          kind: text
                                          value: from
                                          emphasis: faint
                                        from:
                                          kind: mono
                                          value: review
                                        conductor:
                                          kind: badge
                                          label: srv01-bakers
                                          tone: neutral
                                          icon: conductor
                                          mono: true
                                        started_label:
                                          kind: text
                                          value: started
                                          emphasis: faint
                                        started:
                                          kind: mono
                                          value: 2026-08-15 18:40
                                        took_label:
                                          kind: text
                                          value: took
                                          emphasis: faint
                                        took:
                                          kind: mono
                                          value: 2m 05s
        - name: project-detail-members
          group: Screens
          section: projects
          docs: |-
            MEMBERS AS ITS OWN FACE (BB-435). It was the second of two blocks on the Settings tab, which filed the project's people under infrastructure while the team screen — which has had a Members face since BB-419 — filed the same object under people. One object cannot be two kinds of thing depending on which screen is open, so this face exists and Settings kept Environments.
            THIS FACE AND THE TEAM'S MEMBERS FACE ARE ONE SURFACE, parameterised by the group they render for. That is what BB-419 established and this ticket keeps: the roster, the add form and the remove control do not know which kind of group they belong to, and the ONE place the kind shows is what the visible labels require — the noun in the remove sentence, and whether the item carries a role at all.
            A MEMBER IS ADDED THROUGH A FORM, AND ONLY HERE. The projects section used to prescribe the opposite — an assignment picker where the pick IS the write — and that contradicted `action-pattern.md`, which it sat beside. Adding a person CREATES an `og_membership`; *Inline edit*'s reason does not reach a create, because there is no value to put back. So the surface is a `form` the operator submits: one person control in `pills`, one primary submit in `actions`, and nothing that commits on select.
            IT IS A FORM IN THE MAIN CONTENT AND NOT A DIALOG, which is a decision with a reason rather than an exception. The dialog rule is written for a create surface with a LIST CONTEXT to lose; this control lives inside the face it changes, and a successful submit re-renders that face alone — the tab strip, the rail and the shell stay put. A dialog would take the list away in order to add to it.
            THE ROSTER IS A `list`, NOT A TABLE, which is the settings section's rule reaching this screen: no columns and no header row, `layout: cards` with `spacing: comfortable` (BB-638), because a membership is a person read one at a time and not a row of comparable figures. Putting the values in cells aligned to a grid would promise a comparison the data does not support.
            EACH MEMBER IS ONE LINE OF FACTS, NOT A LEFT-TO-RIGHT RUN OF CELLS: each item is a patterned row (BB-638) — `headline: [person]`, `meta: [joined, team]`, `right: [state, role, transfer, remove]` — so the person and the joined date sit on the left and the role or state, transfer and remove are right-aligned, as GroupMembersForm::listZone() renders it.
            THE ROLE IS PICKED ON THE MEMBER'S OWN ITEM. A role IS reversible, so here the pick genuinely is the write — no save button, no dirty state, no confirmation. A project ships exactly two roles, and they are the two the site actually has: `lead` and `member`. `member` is `role_type: required`, so `OgMembership::preSave()` revokes it and `getRoles()` prepends it on read — it is never stored, and an empty `roles` array IS a member. The scene draws the control as a `picker` cell because that is the design's statement; on the server the same control arrives as a `rendered` cell, because a pick that IS the write has to be a named submit trigger of the enclosing form and a cell is DATA. One design, one delivery mechanism.
            REMOVE NAMES ITS EFFECT AND IS NOT CONFIRMED. The rule confirms an action exactly when it ends or discards the ticket; a membership removal does neither. But on a rights-granting surface it revokes somebody's access, which is a server-side effect, so the control names it. The sentence is the accessible name of an icon-only button and never visible text.
            ALL THREE WRITE NOW, on the server. In a scene nothing posts and nothing opens: Storybook never calls `Drupal.attachBehaviors`, so the open state below is a prop and the panel is markup. The scene proves the shape; the browser suite proves the behaviour.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: Members · the people of this project
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: false
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: true
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      main:
                        - component: bb_theme:zone
                          props:
                            gap: none
                            description: A project is a rights level — a member's role is picked on their own item
                          slots:
                            heading: Members
                            content:
                              - component: bb_theme:form
                                slots:
                                  pills:
                                    - component: bb_theme:property_pill
                                      props:
                                        name: account
                                        label: Person
                                        icon: user
                                        picker_id: project-detail-add-member
                                        prominent: false
                                        multiple: false
                                        open: false
                                        searchable: true
                                        search_placeholder: Search by name
                                        search_label: Search by name
                                        aria_label: Choose the person to add to bakers.build Platform.
                                        value_label: ''
                                        value_labels: []
                                        values: []
                                        clearable: false
                                        clear_label: ''
                                        creatable: false
                                        create_label: ''
                                        options:
                                          - value: '5'
                                            label: Lena Fischer
                                            description: lena.fischer@keytec.example
                                            selected: false
                                          - value: '6'
                                            label: Tom Beckett
                                            description: tom.beckett@partner.example
                                            selected: false
                                  actions:
                                    - component: bb_theme:button
                                      props:
                                        variant: primary
                                        type: submit
                                        label: Add member
                                        disabled: false
                                        icon_only: false
                              - component: bb_theme:list
                                props:
                                  layout: cards
                                  spacing: comfortable
                                  pattern:
                                    headline:
                                      - person
                                    meta:
                                      - joined
                                      - team
                                    right:
                                      - state
                                      - role
                                      - transfer
                                      - remove
                                  items:
                                    - cells:
                                        person:
                                          kind: person
                                          display_name: Christian Wiedemann
                                          initials: CW
                                          color: unassigned
                                          mail: christian.wiedemann@keytec.example
                                        role:
                                          kind: rendered
                                          markup: Lead
                                        joined:
                                          kind: mono
                                          value: joined 2026-01-15
                                        remove:
                                          kind: rendered
                                          markup: Remove
                                    - cells:
                                        person:
                                          kind: person
                                          display_name: Sven Gruber
                                          initials: SG
                                          color: running
                                          mail: sven.gruber@keytec.example
                                        role:
                                          kind: rendered
                                          markup: Member
                                        joined:
                                          kind: mono
                                          value: joined 2026-01-15
                                        remove:
                                          kind: rendered
                                          markup: Remove
        - name: project-detail-settings
          group: Screens
          section: projects
          docs: |-
            Settings tab: Environments, and only Environments. New environment lives here — not on the list, and not as a separate top-level tab.
            MEMBERS LEFT THIS FACE (BB-435). It used to be the second of "two blocks on one tab", which filed the project's people under infrastructure while the team screen filed the same object under people. Members is now its own face, `project-detail-members`, and what stayed behind is what Settings is actually for: the deployment targets. Neither surface half-owns the other any more.
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: bakers.build Platform
                            description: Settings · environments and members of this project
                          slots:
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: false
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: true
                      main:
                        - component: bb_theme:zone
                          props:
                            description: Deployment targets this project stamps and verifies against
                          slots:
                            heading: Environments
                            actions:
                              component: bb_theme:button
                              props:
                                variant: primary
                                label: New environment
                                icon_only: true
                              slots:
                                icon:
                                  component: bb_theme:icon
                                  props:
                                    name: plus
                                    size: sm
                            content:
                              entity: view.environments
                              view_mode: default
        - name: project-time
          group: Screens
          section: projects
          docs: 'The time calendar (BB-640): a week strip with each day''s total and the week total, then the day rows (Day) or a read-only week grid (Week). Totals come from the authorized dataset, not from one page. PROJECT > TIME in Week mode as a team lead: the viewer''s hours plus their team members'' on this project. Project membership grants nothing.'
          items:
            - scene: design-system:shell
              with:
                overlay: ''
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Time
                            description: Recorded hours on API home
                          slots:
                            actions:
                              component: bb_theme:button
                              props:
                                variant: primary
                                icon_only: true
                                label: Record time
                                type: button
                              slots:
                                icon:
                                  component: bb_theme:icon
                                  props:
                                    name: plus
                                    size: sm
                            tabs:
                              component: bb_theme:tabs
                              props:
                                label: Project sections
                                items:
                                  - label: Overview
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                                    active: false
                                  - label: Board
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                                    active: false
                                  - label: Tickets
                                    url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                                    active: false
                                  - label: Time
                                    url: /?path=/story/designbook-sections-projects-scenes--project-time
                                    active: true
                                  - label: Stats
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                                    active: false
                                  - label: Runs
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                                    active: false
                                  - label: Members
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                                    active: false
                                  - label: Settings
                                    url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                                    active: false
                      filters:
                        - component: bb_theme:filters
                          props:
                            title: Filters
                            label: Time filters
                          slots:
                            controls:
                              - component: bb_theme:segmented_control
                                props:
                                  label: Period
                                  items:
                                    - label: Day
                                      url: '?mode=day'
                                      active: false
                                    - label: Week
                                      url: '?mode=week'
                                      active: true
                              - component: bb_theme:option_picker
                                props:
                                  label: Person
                                  name: person
                                  id: time-person
                                  icon: user
                                  open: false
                                  value_label: ''
                                  values: []
                                slots:
                                  options:
                                    component: bb_theme:option_list
                                    props:
                                      multiple: false
                                      options:
                                        - value: api-crew-mate
                                          label: api-crew-mate
                                          selected: false
                                        - value: api-edit-team-lead
                                          label: api-edit-team-lead
                                          selected: false
                                        - value: api-lead
                                          label: api-lead
                                          selected: false
                                        - value: api-member
                                          label: api-member
                                          selected: false
                      main:
                        - component: bb_theme:week-strip
                          props:
                            label: Days of week 2026-12-07
                            days:
                              - weekday: Mon
                                date: '07'
                                total: '0:00'
                                url: '?mode=day&date=2026-12-07'
                                active: false
                                aria_label: Mon 2026-12-07, 0:00
                              - weekday: Tue
                                date: '08'
                                total: '2:45'
                                url: '?mode=day&date=2026-12-08'
                                active: false
                                aria_label: Tue 2026-12-08, 2:45
                              - weekday: Wed
                                date: '09'
                                total: '1:00'
                                url: '?mode=day&date=2026-12-09'
                                active: false
                                aria_label: Wed 2026-12-09, 1:00
                              - weekday: Thu
                                date: '10'
                                total: '0:00'
                                url: '?mode=day&date=2026-12-10'
                                active: false
                                aria_label: Thu 2026-12-10, 0:00
                              - weekday: Fri
                                date: '11'
                                total: '0:00'
                                url: '?mode=day&date=2026-12-11'
                                active: false
                                aria_label: Fri 2026-12-11, 0:00
                              - weekday: Sat
                                date: '12'
                                total: '0:00'
                                url: '?mode=day&date=2026-12-12'
                                active: false
                                aria_label: Sat 2026-12-12, 0:00
                              - weekday: Sun
                                date: '13'
                                total: '0:00'
                                url: '?mode=day&date=2026-12-13'
                                active: false
                                aria_label: Sun 2026-12-13, 0:00
                            total_label: Week total
                            total: '3:45'
                        - component: bb_theme:text
                          props:
                            text: 'Total recorded time: 3:45'
                        - component: bb_theme:table
                          props:
                            columns:
                              - key: label
                                label: Person
                                row_header: true
                              - key: '2026-12-07'
                                label: Mon 07
                                num: true
                              - key: '2026-12-08'
                                label: Tue 08
                                num: true
                              - key: '2026-12-09'
                                label: Wed 09
                                num: true
                              - key: '2026-12-10'
                                label: Thu 10
                                num: true
                              - key: '2026-12-11'
                                label: Fri 11
                                num: true
                              - key: '2026-12-12'
                                label: Sat 12
                                num: true
                              - key: '2026-12-13'
                                label: Sun 13
                                num: true
                              - key: total
                                label: Total
                                num: true
                            rows:
                              - cells:
                                  label:
                                    kind: text
                                    value: api-crew-mate
                                  '2026-12-07':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-08':
                                    kind: link
                                    value: '0:30'
                                    url: '?mode=day&date=2026-12-08'
                                  '2026-12-09':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-10':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-11':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-12':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-13':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  total:
                                    kind: text
                                    value: '0:30'
                              - cells:
                                  label:
                                    kind: text
                                    value: api-edit-team-lead
                                  '2026-12-07':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-08':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-09':
                                    kind: link
                                    value: '1:00'
                                    url: '?mode=day&date=2026-12-09'
                                  '2026-12-10':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-11':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-12':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-13':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  total:
                                    kind: text
                                    value: '1:00'
                              - cells:
                                  label:
                                    kind: text
                                    value: api-lead
                                  '2026-12-07':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-08':
                                    kind: link
                                    value: '0:45'
                                    url: '?mode=day&date=2026-12-08'
                                  '2026-12-09':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-10':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-11':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-12':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-13':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  total:
                                    kind: text
                                    value: '0:45'
                              - cells:
                                  label:
                                    kind: text
                                    value: api-member
                                  '2026-12-07':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-08':
                                    kind: link
                                    value: '1:30'
                                    url: '?mode=day&date=2026-12-08'
                                  '2026-12-09':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-10':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-11':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-12':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  '2026-12-13':
                                    kind: text
                                    value: –
                                    emphasis: faint
                                  total:
                                    kind: text
                                    value: '1:30'
                              - cells:
                                  label:
                                    kind: text
                                    value: Total
                                  '2026-12-07':
                                    kind: text
                                    value: '0:00'
                                  '2026-12-08':
                                    kind: text
                                    value: '2:45'
                                  '2026-12-09':
                                    kind: text
                                    value: '1:00'
                                  '2026-12-10':
                                    kind: text
                                    value: '0:00'
                                  '2026-12-11':
                                    kind: text
                                    value: '0:00'
                                  '2026-12-12':
                                    kind: text
                                    value: '0:00'
                                  '2026-12-13':
                                    kind: text
                                    value: '0:00'
                                  total:
                                    kind: text
                                    value: '3:45'
    hash: 269fb3eed3eb60f8621b6549564810473fee1aa161e8d53c79aedc95e97ce7f1
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
            title: Key
            description: Ticket identifier prefix, e.g. "bakers.build" in BB-328.
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
        purpose: 'One persisted ticket event per row: `created` when a ticket is created, `status_changed` per state change (with the step''s summary comment, and with the run it closed and that run''s conductor when an agent did the work), `claimed` only for the first run outside qualification, and `run_ended` when a run ends failed, expired or cancelled without moving the ticket. Writes come only from TicketActivityRecorder. Each row is this bundle''s `full` view mode (`bb_theme:event` with a structured lead); there is no second activity view mode.'
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
                - spec
                - diagnose
                - coding
                - review
                - pre_deployment
                - post_deployment
                - verifying
                - summary
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
                - bb_feature
                - bb_bug
                - bb_chore
                - bb_deployment
                - bb_verification
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
                - spec
                - diagnose
                - coding
                - review
                - pre_deployment
                - post_deployment
                - verifying
                - summary
                - done
                - cancelled
          labels:
            type: reference
            title: Labels
            required: false
            multiple: true
            reference: bb_term
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
        omitted:
          id: Entity key, not a modelled field; sample data carries it as the record key.
          uuid: Entity key; the designbook model addresses records by `id`.
    bb_term:
      bb_labels:
        title: bakers.build term
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
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
    bb_environment:
      bb_environment:
        title: bakers.build environment
        purpose: A managed deployment target of a project — the thing a deployment ticket stamps and a verification ticket verifies against.
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
          field_developer_title:
            type: string
            title: Position
            description: Free text (BB-507 D2), no vocabulary. Product label Position.
            required: false
            multiple: false
          field_bb_background:
            type: text
            title: What should bakers.build know about your background?
            description: Optional long text handed to AI assistants as context.
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
            description: Machine names, e.g. bb_session, bb_agent, bb_project_manager.
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
        omitted:
          id: Entity key, not a modelled field.
          uuid: Entity key.
  config:
    image_style:
      avatar:
        aspect_ratio: '1:1'
    omitted:
      bb_core.bb_vocabulary: The vocabulary IS the bb_term bundle; no screen renders it as an object of its own.
    og.og_role:
      title: OG role
      entity_type: og_role
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
namespace: bb_theme
data_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/designbook
```

## Context
### task:write-scene (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/scenes/tasks/write-scene.md)
```
---
title: 'Write Scene: {{ scene_name }}'
trigger:
  steps:
    - write-scene
domain:
  - components
  - scenes
params:
  type: object
  required:
    - scene_path
    - components_dir
    - scene_name
    - scene_scope
    - items
  properties:
    scene_name:
      type: string
      description: Exact SceneDef.name selected during intake; unique within scene_path.
    scene_scope:
      type: string
      enum: [screen, shell, standalone]
      description: Actual target role, including consumer writes originating in another domain intake.
    items:
      type: array
      description: Planned SceneNode tree for the selected scene, same schema as the written result.
      items:
        $ref: ../schemas.yml#/SceneNode
    scene_path:
      type: string
      description: >
        File path (relative to $DESIGNBOOK_DATA) of the target SceneFile. Supplied by the calling workflow via
        the scene_path resolver.
    components_dir:
      path: $DESIGNBOOK_DIRS_COMPONENTS
      type: string
      description: Components directory — location resolved by the active framework skill.
    components:
      type: array
      resolve: components_index
      description: >
        Component IDs fixed during intake, with artifact data from any declared build predecessor. Every `component:` field in the scene
        result MUST match one of these ids — the compiled schema enum enforces this automatically.
      items:
        type: object
        required:
          - id
        properties:
          id:
            type: string
            description: Fully qualified component ID fixed during intake.
          import_path:
            type: string
            description: Known component import path.
          story_id:
            type: string
            description: Known Storybook story ID.
    reference:
      type: object
      $ref: ../../design/schemas.yml#/DesignReference
    design_scenes:
      path: $DESIGNBOOK_DATA/design-system/design-system.scenes.yml
      type: object
      $ref: ../schemas.yml#/SceneFile
    data_model:
      path: $DESIGNBOOK_DATA/data-model.yml
      type: object
    section_scenes:
      path: $DESIGNBOOK_DATA/{{ scene_path }}
      type: object
      $ref: ../schemas.yml#/SceneFile
result:
  type: object
  required:
    - scene-file
  properties:
    scene-file:
      path: $DESIGNBOOK_DATA/{{ scene_path }}
      validators:
        - scene
      $ref: ../schemas.yml#/SceneFile
---

# Write Scene

## Result: scene-file

Produce the complete SceneFile for the selected `scene_path` and `scene_name` from `section_scenes` plus the requested delta. The selected scene's `items` match the declared SceneNode tree. A uniquely matching name replaces only the selected scene's requested content in its current array position. An absent name adds exactly one entry. Multiple matches or conflicting selectors block execution and require corrected intake.

Preserve sibling scenes and their order, unrelated selected-scene fields, and unrelated file metadata. Preserve the file and scene identities unless intake explicitly declared a rename and every reference edit. Repeating the same delta leaves one target entry and the same semantic result.

The target role is `scene_scope`, regardless of the originating workflow. Applicable rules use this parameter for screen, shell or standalone constraints. The existing file comes from intake or a declared `create-scene-file` predecessor for an absent file.

Completion: exactly one selected entry expresses the requested delta; all preserved content matches the baseline. Every necessary dependent edit and build/render check is already declared in the saved definition.

```

### ctx:cli-surface (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/workflow/rules/cli-surface.md)
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

### ctx:sample-template-mapping (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/skills/data-model/rules/sample-template-mapping.md)
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

### ctx:presenter-template-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/skills/data-model/rules/presenter-template.md)
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

### ctx:variant-transport (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/variant-transport.md)
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

### ctx:typed-component-boundary (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/typed-component-boundary.md)
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

### ctx:story-image-node-renderer (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/story-image-node-renderer.md)
```
---
trigger:
  steps: [write-component, create-sample-data]
  domain: [components, sample-data]
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

### ctx:shell-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/shell-scene-constraints.md)
````
---
trigger:
  steps: [write-scene]
---

# Shell Scene Constraints

Apply only when the task parameter `scene_scope = shell`, including consumer writes originating in another workflow. Other scene scopes skip this rule.

## Rules

- **`$content` injection point** -- exactly one slot in the root component MUST be set to `$content`. This is where section scenes inject their content.
- **Inline everything** -- all sub-component slots must be fully expanded with props and content. Never use `story: default` alone.
- **`group:`** must be `"Designbook/Design System"`
- **`id:`** must be `debo-design-system`
- **Scene name** -- the shell scene MUST be named `shell`
- **No main content** -- the shell scene marks the injection point with the `$content` placeholder and holds no route-bearing main content of its own. The screen-scene main-content rule (`screen-scene-constraints.md`) is a screen concern and is out of scope for the shell.

### Planned structure and observed evidence

The planner supplies the shell's target hierarchy, reading order, asset bindings,
responsive behavior and component choices in the step work order. Implement each
specified band, navigation entry, form and content injection point exactly. The
bound observation query supplies source evidence for targeted verification;
source node kinds and IDs do not prescribe target component names or markup.
Missing implementation decisions block the step for a new planning decision.

## Output Structure

```yaml
id: debo-design-system
title: Design System
description: [layout description]
status: planned
order: 0

group: "Designbook/Design System"
scenes:
  - name: shell
    items:
      - component: "$DESIGNBOOK_COMPONENT_NAMESPACE:page"
        slots:
          header:
            - component: "$DESIGNBOOK_COMPONENT_NAMESPACE:header"
              slots:
                # fully inline all header sub-components
          content: $content
          footer:
            - component: "$DESIGNBOOK_COMPONENT_NAMESPACE:footer"
              slots:
                # fully inline all footer sub-components
```

````

### ctx:screen-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/screen-scene-constraints.md)
````
---
trigger:
  steps: [write-scene]
---

# Screen Scene Constraints

Apply only when the task parameter `scene_scope = screen`, including consumer writes originating in another workflow. Other scene scopes skip this rule.

## Rules

- **Shell inheritance** -- scene items MUST start with `scene: design-system:<shell_name>` (normally `scene: design-system:shell`) and fill the `content` slot via `with:`. The ref source is the literal `design-system` — the location of the shell scenes file — **NOT** the shell SceneFile's `id:` (`debo-design-system`). Using the `id` as the source (`debo-design-system:shell`) fails to resolve and the screen renders empty.
- **`group:`** must be `"Designbook/Sections/{{ section_title }}"`
- **`id:`** must match `{{ section_id }}`
- ⛔ **Scene `name:` must NOT be `overview`** (case-insensitive). `overview` is reserved: every scenes file already exports an `overview` story (the section overview/management page). A scene named `overview` produces a second `export const overview` in the same module, collides with the reserved one, and silently renders the section page instead of the scene. Name scenes meaningfully — by the section or screen purpose (e.g. the `{{ section_id }}` or `default`) — **never** the screen *type* word `overview`. (Enforced by the `scene` validator.)

## Main content — the route-bearer

A screen scene answers one question: *what is this page?* Exactly one node in the page
`content` slot answers it. That node is the **main content**, and it carries the route.

- The page `content` slot carries **exactly one** route-bearing **main content**. Zero main
  content is an error — the page bears no route. Two is an error — the route is ambiguous.
- The main content is a single **Entity** (a route-bearing content entity, addressed as
  `entity: "<entity_type>.<bundle>"`) **or** a **View** (a listing that owns a route, addressed
  as `entity: "view.<id>"`). A component or decorative widget is never the main content — it
  bears no route.
- Every other node in `content` is a **block** — beiwerk that carries no route and stands beside
  the main content, never in place of it. This rule decides only *which* node is a block; **how a
  block is realized and typed on the backend is a backend concern** — the backend's block rules
  read the data model to type each block, and may report a block whose type the model does not
  determine.
- A listing of several contents is a **View**. The sole exception is a listing that runs under an
  entity through an entity-reference field: there the parent entity renders its own references
  (see [entity-reference-rendering.md](entity-reference-rendering.md)), and the items live inside
  the entity's own subtree, not as siblings in `content`.
- `records:` is a demo shorthand that repeats one entity across sample indices; a real listing is
  a **View**. (The schema states the same at `EntityNode.records` — this is the rule that governs
  the scene build.)
- A direct **entity** node — the single-entity main content, or any entity used as a block — MUST
  select its sample record with `record:` (an index) or `select:` (a predicate). Without either,
  the node evaluates its mapping against an **empty context** and renders blank: every field the
  mapping reads is undefined, so the component appears with empty slots. This empty-context path is
  reserved for a self-contained **View** node, which enumerates its own rows and therefore takes no
  `record`. A single entity is never self-contained — omitting its record is the entity-main
  equivalent of the view fallstrick, and is forbidden.
- The originating intake labels the main content in its structure preview, so the user
  approves which node bears the route before the scene is built.

## Output Structure

```yaml
id: {{ section_id }}
title: {{ section_title }}
description: {{ section_description }}
status: planned
order: [number]

group: "Designbook/Sections/{{ section_title }}"
scenes:
  - name: "[screen-name — meaningful, NOT 'overview'; e.g. the section id or 'default']"
    items:
      - scene: "design-system:shell"
        with:
          content:
            # exactly one route-bearing main content — an Entity …
            - entity: "[ENTITY_TYPE].[ENTITY_BUNDLE]"   # the route-bearer
              view_mode: "[VIEW_MODE]"
              record: 0                                 # a direct entity MUST pick its record (or use `select:`)
            # … or a View (entity: "view.[VIEW_ID]") — never both; a View is self-contained, no record
            # every further node is a block beside the main content — an entity block picks a record too
            - entity: "[BLOCK_ENTITY_TYPE].[BLOCK_BUNDLE]"
              view_mode: "[VIEW_MODE]"
              record: 0
            # … or a component block:
            - component: "$DESIGNBOOK_COMPONENT_NAMESPACE:some-block-component"
              slots: ...
```

````

### ctx:scenes-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/scenes-constraints.md)
````
---
trigger:
  steps: [create-scene-file, write-scene, map-entity]
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

### ctx:referenced-content-view-mode (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/referenced-content-view-mode.md)
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

### ctx:presenter-composition (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/presenter-composition.md)
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

### ctx:markup-derivation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/markup-derivation.md)
```
---
trigger:
  steps: [write-component, write-scene]
  domain: [components, scenes]
---

# Build the planned target structure

Build the concrete hierarchy, component IDs, slots, props, content, styling and
interaction behavior fixed in the task's work order. The planner owns these
implementation decisions. The selected reference package supplies observed
source evidence for targeted checks; observed node IDs and source locators are
not instructions to duplicate the source tree as target markup.

Every visible region, repeated item, form, image, text treatment and interactive
state in the declared acceptance scope needs an explicit implementation mapping
in the plan. Preserve the declared content order, semantic relationships,
responsive changes and accessibility behavior. Use the specified downloaded
assets and font binaries with the planned public paths. A missing asset mapping,
layout value, state behavior or component decision blocks the step with the exact
missing decision; execution does not inspect the live source or choose a new
component architecture.

Text-only requests use their complete planned appearance, behavior and responsive
criteria. Captured reference and actual Storybook structure remain separate from
the target structure so verification can compare explicit correspondences.

```

### ctx:local-image-assets (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/local-image-assets.md)
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

### ctx:icon-sprite (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/icon-sprite.md)
```
---
trigger:
  domain: components
---

# Icon Sprite Rendering

A design system that renders icons through a shared icon component backed by a
generated SVG sprite gets that rendering consistent, cacheable, and colorable via
`currentColor`. Every icon consumption goes through that shared component — never
a hand-written inline `<svg><use>`.

## Consumption — always the shared icon component

Render an icon by including the shared icon component, never by hand-writing a
`<svg><use href=…>` inline in a component's own markup:

- The icon identifier is the sprite symbol id (typically the source filename).
- Size is expressed through a token from the component's own sizing scale, never a
  hand-written width/height utility pair. An unconstrained size on an `<svg>` inside a
  flex or grid ancestor can blow past its intended box — pick the token instead of
  hand-sizing.
- Color follows `currentColor`; set it on an ancestor via a text-color utility or
  token rather than styling the `<svg>` fill directly.
- Extra styling passes through the component's own class-merge mechanism, not
  ad hoc markup on the `<svg>`.

The shared icon component's own template is the only place a raw
`<use href="…">` reference may appear.

## Generation — a build step, not a hand-maintained file

The sprite is assembled at build time from individual tracked SVG source files (one
file per symbol); the assembled sprite itself is a generated artifact:

- **Source of truth:** the tracked per-symbol SVG files. Add or edit an icon there.
- **Generated output:** the sprite file. Do not hand-edit it — any manual edit is
  overwritten by the next build. It MAY be gitignored as a build artifact; when it
  is, a fresh checkout has no sprite until the first build runs.
- **Serving:** the dev/build/preview server MUST serve the generated sprite at the
  exact URL the icon component references it by. A static-file configuration gap
  here is a common, silent failure: the icon `<svg>` renders at its sized
  dimensions but shows nothing, because the `<use href>` target 404s — no console
  error, no visibly broken markup, just an empty box.
  **Verify after any icon work:** fetch the sprite URL directly and confirm a 200
  response, not a 404.

### Adding or changing an icon

1. Add or edit the per-symbol source SVG file.
2. Run the build (or its watch mode) to regenerate the sprite.
3. Reference the new symbol id from the shared icon component.

Icon SVGs heavy with gradients or `<defs>` can have their ids collapsed or dropped
by SVG optimization during the build — verify the symbol actually survived in the
generated sprite after adding one.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| ICON-01 | error | Icons render via the shared icon component, not a hand-written `<svg><use>` outside that component's own template | component markup |
| ICON-02 | error | The referenced icon id exists as a per-symbol source file the sprite build consumes | icon source directory |
| ICON-03 | warning | Icon size is set via a sizing-scale token, not a hand-written width/height utility pair; color resolves through `currentColor` set on an ancestor | component markup |
| ICON-04 | warning | New icons are added as source files, never by hand-editing the generated sprite | icon source directory |
| ICON-05 | error | The dev/build/preview server serves the generated sprite at 200, not 404, at the URL the icon component references | server static-file config |

```

### ctx:entity-reference-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/entity-reference-rendering.md)
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

### ctx:component-contract-index (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/rules/component-contract-index.md)
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

### ctx:token-backed-utilities (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/583ab386b5ac/rules/token-backed-utilities.md)
```
---
trigger:
  domain: components
filter:
  frameworks.css: tailwind
---

# Token-Backed Utility Scale

When porting a design reference into a component, every styling effect in the
markup MUST be expressed using the established utility scale — snapping values to
the existing spacing/sizing/color/typography steps — never an arbitrary value and
never a component-specific dimension-token alias invented to pixel-match the
reference.

## The Twig/markup IS the stylesheet

A correct port carries the component's entire look in its markup `class`
attributes — a reviewer must see how the component looks by reading the markup
alone, not a parallel component-scoped stylesheet that re-declares the same
properties the utilities already express.

A component-scoped partial that re-declares the ported styling verbatim (raw
`display`/`padding`/`margin`/`background`/`border`/`color`/`font`/`gap`/`flex`/`grid`
declarations keyed on carried-over source class names) is the explicit failure
this rule exists to prevent — it relocates the styling, it does not convert it.
"Ported into a partial" is not done; the work is done only when the styling lives
in utilities.

None of the following are an escape hatch for reaching outside the utility scale:
a media query (use the project's named breakpoints), a descendant element (put the
utility on that element directly in markup), a pseudo-class/element (use named
variants). Every arbitrary utility value — including an arbitrary `var(...)` form
or an optical nudge — is prohibited. When no existing named utility and no central
token fit, record the missing token as a finding; do not substitute a literal or
arbitrary value to make progress.

## Scale wins on collision — do not clone the reference's raw pixels

A design reference's own spacing/sizing scale does not necessarily equal the
project's Tailwind scale, and class names can collide numerically between the two
systems even when they look similar. **The project's Tailwind scale is the source
of truth for the new design system — it always wins on collision.**

- Map a reference class to the **same-intent Tailwind utility** and accept the
  Tailwind scale's value. Do not reproduce the reference's raw pixel value with an
  arbitrary utility just to pixel-match the source.
- Where no clean same-name match exists, snap to the nearest standard Tailwind
  utility that fits the intent, rather than an arbitrary px value.
- Use established spacing/sizing steps directly. Do not introduce dimension tokens
  or component-specific utilities for ordinary padding, margins, gaps, sizes, or
  offsets — snap to the nearest existing step instead of inventing a new one.
  A newer Tailwind version accepting additional numeric/fractional classes does not
  make them part of this project's established scale.
- Do not reproduce a component's old measurements as a family of narrowly named
  tokens. First use standard spacing, sizing, radius, typography, and responsive
  layout utilities. Central tokens are for shared design decisions, not aliases for
  individual pixel offsets.
- There are no arbitrary-value exceptions — not brand hex values, not exact grid
  tracks, not optical alignment. A genuinely reusable value goes into the project's
  maintained central token source and is exposed as a named utility through the
  project's token workflow; it never lands directly in markup, an inline style, or a
  component partial.
- Consequence: a ported component's spacing may differ from the design reference
  by named token steps. That difference is expected and accepted by visual
  comparison tooling — do not chase it with arbitrary px values.

## Constraints

- **Forbid** emitting any utility class with no backing CSS declaration — an
  invented, approximated, or unresolved class name is a hard error.
- **Forbid** carrying the design reference's own custom class names directly into
  the markup without resolving them to actual CSS and expressing that CSS as
  utilities.
- **Forbid** carrying over a source CSS-framework's utility class names (from
  Bootstrap or similar) directly; resolve them to CSS and re-express as this
  project's utilities.
- Use existing semantic or primitive color tokens by name; never a literal color
  value or an arbitrary `var(...)` utility at a component call site.

## Existing central tokens — do not regenerate curated CSS

A named utility only resolves if its token already exists in the committed
token CSS. Never invent a token name or an arbitrary `var(...)` utility. When the
ported styling needs a value with no matching central token:

1. For ordinary dimensions, select the nearest established step instead of adding
   a token. Only a genuinely shared design decision — absent from the existing
   scale — justifies introducing a meaningful new central token, added through the
   project's maintained token-update path.
2. If the safe update path is unavailable, leave the finding open until a central
   token and named utility are added. Do not move a literal into markup, an inline
   style, or a partial as a stopgap.

After any token change, rebuild the compiled CSS so the named utility and token
actually land in the built stylesheet — editing a markup `class` or a partial has
zero visual effect until that rebuild runs. Verify both the preview surface and
the production runtime after rebuilding, rather than assuming either the source or
the compiled CSS alone is authoritative.

## Escape hatch — narrow

Utilities-in-markup is the default. A component-scoped partial exists only for a
narrow effect a class-on-element utility genuinely cannot reach:

- JS-toggled state-class combinations on the same element (a class a behavior
  script flips at runtime, styled in combination with a base state). Express the
  base state with utilities in the markup; the partial carries only the toggled
  delta.
- `@keyframes` definitions.
- Uncontrolled raw markup (an unescaped HTML blob the component does not own) is
  not an automatic exception — record it as a conflict; do not add a descendant
  selector to reach into it.

When a partial is unavoidable:

- One partial per component.
- Use the utility-application directive (e.g. `@apply <utility>`) for every
  declaration that has a utility equivalent; raw CSS only for the truly
  unexpressible remainder.
- The partial is imported into the project's compiled entrypoint per the project's
  own build wiring.
- A one-line comment per rule states which narrow reason above justifies it.
- A component that needs no escape-hatch rule has no partial — do not create an
  empty or redundant one.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| TBU-01 | error | Every utility class in the markup has a resolved CSS declaration; no invented or unevaluated class names | component markup |
| TBU-02 | error | No design-reference custom class names or source-framework utility class names appear unresolved in the markup | component markup |
| TBU-03 | error | A component-scoped partial, when present, is wired into the project's compiled entrypoint per its own build convention | build entrypoint |
| TBU-04 | error | Colors use existing semantic or primitive named tokens; no literal or arbitrary `var(...)` utility appears at a call site | component markup / partial |
| TBU-05 | error | The component's static look lives in utility classes in the markup, not in a partial; a partial re-declaring utility-expressible properties is a violation | component markup / partial |
| TBU-06 | error | A partial contains only narrow escape-hatch rules (JS-state combinations or `@keyframes`); media queries, pseudo-classes, controllable descendants, and uncontrolled-markup substitutions are not in the partial | partial |
| TBU-07 | error | Reference-scale spacing/sizing classes map to same-intent utilities on this project's scale, with no arbitrary-value cloning of the reference's raw pixels | component markup |

```

### ctx:scenes-constraints-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/583ab386b5ac/rules/scenes-constraints.md)
```
---
trigger:
  steps: [create-scene-file, write-scene]
filter:
  frameworks.css: tailwind
---

# Tailwind Scene Constraints

## `@source` Coverage

Tailwind's JIT compiler only scans files listed in `@source` directives. Scene YAML files are never included in `@source` — the core `scenes-constraints` rule enforces inline `style=""` for this reason.

When adding new component directories, ensure they are covered by an `@source` directive in the CSS entry point (see `component-source` rule). Scene files do not need coverage.

```

### ctx:font-availability (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/583ab386b5ac/rules/font-availability.md)
```
---
trigger:
  domain: components
filter:
  frameworks.css: tailwind
---

# Font Availability

A `font-*` utility may only be emitted when the font it resolves to is actually loadable. Using a typography utility whose underlying token is unresolved produces no error — the browser silently falls back to a serif/system font, and the compare stage cannot recover the lost typography. This rule makes that condition blocking instead of silent.

Before a component emits any `font-*` utility (e.g. a token-backed `font-heading`, `font-body`, or an arbitrary `font-[var(--font-…)]`):

- The `--font-*` token it maps to MUST resolve to a concrete family name. A token value that still contains an unresolved alias placeholder (a `{…}` segment) is not a family — it is a generation defect upstream.
- A matching `@font-face` declaration MUST exist for that family, or the family MUST be a generic/system family (`sans-serif`, `serif`, `monospace`, `system-ui`, …).

When neither holds, the font is unavailable. Treat that as a blocking defect of
the same weight as a missing component: leave the current task pending, append
the exact why to the execution [problems sidecar](../../designbook/resources/workflow-execution.md)
beside the plan, and continue other tasks — never mark the check passed via a
silent system-font fallback. The token and `@font-face` are owned by the
`css-generate` workflow; a missing self-hosted family is sourced from the design
reference's downloaded font binaries. When the sealed plan has no task that can
repair the face, record that ownership gap in the problems entry and keep going.

```

### ctx:component-styling (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/583ab386b5ac/rules/component-styling.md)
```
---
trigger:
  domain: components
filter:
  frameworks.css: tailwind
---

# Tailwind Component Styling

Use Tailwind utility classes as the default styling surface for component output.

Prefer utilities generated from Designbook tokens:

- Standard Tailwind namespaces use token-backed utilities directly, such as `bg-primary`, `text-on-surface`, `font-heading`, and `rounded-pill`.
- Non-standard namespaces use arbitrary values that reference token variables, such as `max-w-[var(--container-xl)]`, `gap-[var(--grid-md)]`, and `py-[var(--layout-spacing-md)]`.
- Exact arbitrary values are allowed when the design reference requires a value that has no token yet. Prefer creating or reusing a token when the value is part of the design system.

Do not create external component stylesheet rules for ordinary layout, spacing, color, typography, border, radius, or responsive behavior when Tailwind utilities can express the design.

External CSS is reserved for:

- Tailwind and token infrastructure such as imports, `@theme`, and `@source`.
- Reusable Tailwind-native `@utility` abstractions.
- Complex effects that Tailwind cannot express clearly.

Do not invent BEM or semantic component class names for styling in Tailwind projects. Stable hook classes are allowed only when needed for behavior, testing, or third-party integration, and they must not carry styling responsibility.

```

### ctx:component-source (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/583ab386b5ac/rules/component-source.md)
````
---
trigger:
  domain: components
filter:
  frameworks.css: tailwind
---

# Tailwind Component Source Registration

Tailwind's JIT compiler must see every file that uses utility classes. The current blueprint uses a single **wildcard** `@source` in `$DESIGNBOOK_CSS_APP` that covers all components at once:

```css
/* In $DESIGNBOOK_CSS_APP (e.g. app.src.css) */
@source "../components/**/*.{twig,js,yml}";
```

## When this rule is satisfied automatically

- The wildcard directive above is already present in `$DESIGNBOOK_CSS_APP`.
- The new component was created inside `components/<name>/` with `.twig`, `.js`, or `.yml` extensions.

In that case **no edit is required** — the new component is picked up on the next build.

## When an explicit `@source` is required

Only add a per-component directive if the wildcard does not apply, e.g.:

- The component lives outside `components/**` (custom path).
- The component uses a non-standard extension not matched by the wildcard.
- A narrower scan is intentionally configured (no wildcard in `$DESIGNBOOK_CSS_APP`).

```css
/* Only if wildcard does not cover the component */
@source "../custom-path/new-component";
```

## Verification

After creating the component, confirm one of the following holds before ending the stage:

1. `$DESIGNBOOK_CSS_APP` contains a wildcard `@source` that matches the new component's directory, **or**
2. `$DESIGNBOOK_CSS_APP` contains an explicit `@source` entry for the new component's directory.

Without a matching directive, Tailwind utility classes used in the component's template will not be compiled into the output CSS.

````

### ctx:navigation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/shell/rules/navigation.md)
```
---
trigger:
  domain: components.layout
filter:
  backend: drupal
---

# Navigation in Shell Components

Header and footer must always include a navigation component as a required slot — never hardcode nav items directly.

Breadcrumb is a separate standalone component and must not be implemented as a navigation variant.

```

### ctx:scenes-constraints-3 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/scenes/rules/scenes-constraints.md)
````
---
trigger:
  domain: scenes
filter:
  backend: drupal
---

# Drupal Scene Constraints

## Main Content vs. Block — Drupal Vocabulary

The abstract screen-scene rule names one route-bearing **main content** (an Entity or a View) in
the page `content` slot, with everything else a **block**. In Drupal terms:

- A route-bearing main **Entity** is a content entity — typically a **node**.
- A route-bearing main **View** is a view **page display** (it owns a route).
- **Blocks** (beiwerk, no route) are: a view **block** (`views_block:*`), menus, local tabs, special
  widgets, `block_content` entities, and `block_plugin` blocks. The same view is main content as a
  page display and a block as a view block — its **display type** decides the role.

A listing of several contents is a view; the one exception is a listing rendered inside an entity
through an entity-reference field (the parent node renders its own referenced children).

## Image Node Format

> ⛔ **Image nodes use the duck-typed `image:` key referencing a config entity.**
> The `image` value MUST match a bundle name under `config.image_style` in `data-model.yml`.
> Ratio-based style names use the `ratio_` prefix (e.g. `ratio_16_9`) to avoid YAML numeric parsing issues.

```yaml
# ✅ Correct — image node with named style
- image: hero
  alt: "Modern architecture building"

# ✅ Correct — ratio-based style with ratio_ prefix
- image: ratio_16_9
  alt: "Landscape photo"

# ✅ Correct — image node with custom source (CSS aspect-ratio mode)
- image: card
  alt: "Team photo"
  src: "/images/team.jpg"

# ❌ Wrong — old format with type: image
- type: image
  image_style: hero
  alt: "Some image"

# ❌ Wrong — using component instead of image node
- component: "$COMPONENT_NAMESPACE:image"
  props:
    src: "https://picsum.photos/800/600"
```

## Entity Reference Format

> ⛔ **Entity references use a two-part `entity` string plus a separate `view_mode` key.**

```yaml
# ✅ Correct — entity is "entity_type.bundle", view_mode is a separate field
- entity: "[entity_type].[bundle]"
  view_mode: "full"
  record: 0

# ❌ Wrong — view_mode embedded in entity string causes double-dot path
- entity: "[entity_type].[bundle].full"
  record: 0
```

The renderer loads: `$DESIGNBOOK_DATA/entity-mapping/{entity_type}.{bundle}.{view_mode}.jsonata`

The `entity` string provides `entity_type` (part 0) and `bundle` (part 1). `view_mode` is read from its own key — if omitted, the path becomes `[entity_type].[bundle]..jsonata` (double dot, file not found).

`record:` is an optional integer (default: 0) — selects which record from `data.yml` to use.


````

### ctx:presenter-template-surfaces (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/presenter-template-surfaces.md)
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
display config — is a presenter-template surface and uses `template: presenter`. The clearest case
is an **edit form** (a `form_mode` display reached over an edit route): Drupal renders forms through
the form builder and theme layer, not through UI-Patterns display config.

A mode that is a presenter surface carries `template: presenter`; `sync-to` then generates its
presenter-template (the Twig *how* is the presenter-template blueprint) alongside the display
config that binds it.

## The view build-form matrix

A view is not a blanket presenter-template surface — whether it has a view-presenter at all, and
whether its pager and exposed filter are presenter surfaces, depends on its `build_form`: the same
backend-neutral value every surface's `template` resolves against, sourced from
`entity_mapping.templates`.

| `build_form` | View wrapper | Pager / exposed filter |
|---|---|---|
| A Display Builder form | No view-presenter. The view binds directly through the Display Builder page config — a single config owner covers the wrapper, rows, pager, and exposed filter. | Expressed inside that same config owner, not as a separate presenter surface. |
| Any other form | The view wrapper **is** a presenter-template (theme-methods-only, same as an edit form). | Rendered separately and passed into the wrapper as slots — still presenter surfaces on their own binding. |

Resolving `build_form` first is what decides the branch; a view is never assigned
`template: presenter` independent of that resolution.

## Field content stays in slots, unchanged

Choosing `presenter` for a form/wrapper/pager/exposed-filter surface does not move field-rendered
content out of slots: the field→slot mapping for read displays is unchanged. A presenter-template
renders the theme-methods-only chrome around fields; the fields themselves still render through
their formatter into slots.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| PTS-01 | error | A view whose `build_form` is a Display Builder form has no separate view-presenter — its wrapper, rows, pager, and exposed filter all resolve through the single Display Builder config owner | body |
| PTS-02 | error | Exactly one container owns the space beneath the view entity — the Display Builder config owner in that branch, or the presenter-template wrapper in the other; never both, never a second wrapper around either | body |

```

### ctx:media-image-styles (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/media-image-styles.md)
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

### ctx:form-modes (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/form-modes.md)
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

### ctx:field-type-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/field-type-constraints.md)
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

## Fields used by mappings

Declare every field consumed by a view-mode mapping under the bundle's `fields`,
including Drupal base fields such as taxonomy `name` and `description`. Use the
entity-type blueprint's `base_fields` definitions for their types. The sealed
composition resolves fields from the model; blueprint defaults alone are not
part of that model.

```

### ctx:drupal-views (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/drupal-views.md)
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

### ctx:drupal-config (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/drupal-config.md)
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

### ctx:block-decision (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/rules/block-decision.md)
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

### ctx:slot-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/rules/slot-rendering.md)
````
---
trigger:
  domain: components
filter:
  backend: drupal
  frameworks.component: sdc
---

# Twig `embed … only` Drops Slot Variables — Forward Them Explicitly

A component that wraps its content in `{% embed 'namespace:container' … only %}`
uses the `only` keyword to cut the embedded template off from the parent's
variables. A bare `{{ my_slot }}` referenced **inside** the embed body then
resolves to empty even though the slot was actually passed into the wrapping
component — no Twig error, the markup just renders without that slot's content.

Symptom: the component renders its shell and wrapper elements, but one or more
slot blocks inside an `embed … only` are empty.

## The fix — forward the slot variables into the embed

```twig
{% embed 'namespace:container' with { max_width: 'xl', logo: logo, search: search,
                                       navigation: navigation, actions: actions } only %}
  {% block content %}
    <div class="header__logo">{{ logo }}</div>
    <div class="header__nav-end">{{ search }}{{ navigation }}{{ actions }}</div>
  {% endblock %}
{% endembed %}
```

Slots are exposed as top-level component variables — a bare `{{ my_slot }}` at
the component's **top level** (outside any embed) already works without
forwarding. Only the `only`-embed boundary drops them, because `only` intentionally
scopes the embedded template to just what `with { … }` explicitly supplies.

A `{% block name %}{{ name }}{% endblock %}` nested inside an embed, relying on
the variable still being in scope, is unreliable — the explicit
`with { name: name }` forward at the embed call site is the deterministic fix.

For genuinely fixed content that should always render regardless of what a
caller passes (a required brand mark, a footer credit line), render it
**internally** in the component's own Twig — overridable via its slot — rather
than depending on every caller to remember to forward it through an embed
boundary.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| SLOT-01 | error | Slot variables referenced inside `{% embed … only %}` are forwarded via `with { slot: slot }` at the embed call site | component twig |
| SLOT-02 | warning | Fixed/always-present content that should not depend on caller forwarding is rendered internally in the component's own Twig, not solely through an embed-forwarded slot | component twig |

````

### ctx:layout-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/rules/layout-constraints.md)
```
---
trigger:
  domain: components.layout
filter:
  backend: drupal
---

# Layout Constraints

## Grid exclusivity

Never create domain-specific layout components (e.g., `article-grid`, `product-grid`). Always use the generic `grid` component for any columnar arrangement.

## Container exclusivity

No other component may apply its own `max-width` or horizontal browser-edge padding. Always delegate width control to `container` (or `section`, which wraps `container` internally).

```

### ctx:js-behavior (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/rules/js-behavior.md)
````
---
trigger:
  domain: components
filter:
  backend: drupal
---

# Component JS — a Built Drupal Behavior

When a component needs scripting (a toggle, a slider, any interaction), the JS is
a Drupal behavior that the build step compiles and the Storybook SDC addon
auto-loads. Do not hand-write the final compiled `<name>.js` directly.

## Source file naming

Name the JS source with the project's dedicated source-file convention (e.g.
`<name>.src.js`), distinct from the compiled output filename. A build tool's
entry glob typically only picks up the source-suffixed file — a plain
`<name>.js` dropped straight into the component directory is neither built nor
loaded by the pipeline, and silently does nothing. This is a common "the JS is
missing" cause: verify the source file uses the project's actual source-file
convention, not the compiled filename.

## Interaction wiring for entity/record-driven stories

An interaction that must also work in **entity/record-driven stories** (stories
generated from a mapping + sample data, not from a component's own story file)
needs to survive the addon's asset-loading model for that story type:

- The addon typically loads a **component-driven** story's own assets, and the
  assets of any child explicitly referenced as a component node in its slots —
  but an entity/record-driven story renders children through the mapping as
  render nodes, not as explicit component-node slot references, and a nested
  child's JS may not be loaded there at all.
- Verify empirically whether `Drupal.attachBehaviors` actually runs for the
  story type in question in the addon version this project uses. If it does not,
  a `Drupal.behaviors` registration alone never fires there.

When either gap is confirmed in the current addon version, the defensive
pattern is a **load-time, document-delegated listener guarded by a global flag**,
installed alongside the `Drupal.behaviors` registration (not instead of it):

```js
(function (Drupal) {
  "use strict";
  function bind() {
    if (window.__myBehaviorBound) return;   // global guard → one listener
    window.__myBehaviorBound = true;
    document.addEventListener("click", function (event) {
      const trigger = event.target.closest("[data-my-behavior-trigger]");
      if (!trigger) return;
      /* … toggle state … */
    });
  }
  bind();                                       // runs immediately, covers gaps above
  if (Drupal && Drupal.behaviors) {
    Drupal.behaviors.myBehavior = { attach: bind };  // production + re-attach
  }
})(typeof Drupal !== "undefined" ? Drupal : undefined);
```

If a **child-only** interaction needs to work in an entity/record-driven story
that doesn't load the child's own JS, place the same behavior in the
**parent/top-level** component's source file too (the global guard de-dupes when
both copies load), so the interaction works in the entity story, the parent's own
component story, and the child's standalone story alike.

## Build and serve

- The build step compiles the source file into the component's served/co-located
  JS asset (the filename the addon auto-discovers). If the compiled output is
  gitignored, commit the source file only.
- The Storybook SDC addon imports a storied component's own assets and the
  assets of any nested component explicitly referenced as a component node in the
  story's slots/props.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| JS-01 | error | Component JS lives in the project's dedicated source-file convention (build-compiled), never a hand-written compiled-filename JS file | component dir |
| JS-02 | warning | An interaction needed in entity/record-driven stories has been verified against the addon's actual asset-loading and `attachBehaviors` behavior for that story type, with a load-time delegated fallback added if either gap is confirmed | src.js |
| JS-03 | warning | A child-only interaction needed in an entity/record-driven story also lives in the parent/top-level component's source file (guarded so it de-dupes) | src.js |
| JS-04 | warning | The compiled JS output is gitignored when the project's convention gitignores build output; only the source file is committed | .gitignore |

````

### ctx:image_style (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/skills/data-model/blueprints/image_style.md)
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

### ctx:static-assets (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/583ab386b5ac/design/blueprints/static-assets.md)
````
---
type: blueprint
name: static-assets
trigger:
  steps: [write-scene, write-component, design-shell:intake, design-screen:intake]
---

# Blueprint: Static Assets

Describes how static assets (logos, icons, SVGs, favicons) from the design reference are downloaded and referenced in components and scenes.

## Storage Location

Place assets in the Storybook `public/` directory. Vite's default `publicDir`
serves that folder at the root path in both `storybook dev` and
`build-storybook`. Use `staticDirs` only for extra directories outside `public/`;
listing `public/` there duplicates Vite's copy.

```
public/
  logo.svg
  logo-secondary.png
  favicon.ico
```

These are then available at `/logo.svg`, `/logo-secondary.png`, etc.

## When to Download

During **intake**, identify required visual assets from the supplied reference or text request and declare exact download outputs as prerequisites of scene/component writes. Execution downloads only those selected assets. Existing sufficient assets remain unchanged.

Assets to download:
- Brand logos (site logo, partner logos, institutional marks)
- SVG icons used in navigation or UI elements (see Icons section below)
- Static images that are part of the shell (not content images)

Assets to skip:
- Content images (use placeholder service or `src` field in data.yml)
- Icons from icon fonts (FontAwesome, Material Icons, etc.)
- CSS-only decorations (gradients, borders, box-shadows)

## Icons

SVG icons require special handling — projects often use build plugins (SVG sprites, icon loaders) that expect icons in a specific directory.

**Before placing icon SVGs**, scan the project's build config to determine the icon pipeline:

1. Read `vite.config.*` or `webpack.config.*` for SVG-related plugins (e.g. `vite-plugin-svg-sprite`, `svg-sprite-loader`, `vite-svg-loader`, `svgr`)
2. If a plugin is found, determine its source directory (e.g. `src/icons/`, `assets/icons/`) and place icons there
3. If no SVG plugin is configured, fall back to `public/` like other static assets

```bash
# Example: vite-plugin-svg-sprite configured with src/icons/
curl -sL "<url>" -o "src/icons/<icon-name>.svg"

# No SVG plugin found — use public/
curl -sL "<url>" -o "public/<icon-name>.svg"
```

## How to Download

Use Playwright to extract asset URLs from the reference site, then download via `curl`:

```bash
# Extract image src from a specific element
npx playwright-cli eval '<selector>' 'el => el.src || el.querySelector("img")?.src'

# For inline SVGs, extract the markup directly
npx playwright-cli eval '<selector>' 'el => el.outerHTML'

# Download to public/
curl -sL -A "Mozilla/5.0" -e "<reference-page-url>" "<url>" -o "public/<filename>"
```

Many sites reject asset requests without a browser `User-Agent` and same-origin `Referer` (a bare `curl` gets `403`/`404`). Always pass `-A "Mozilla/5.0"` and `-e "<reference-page-url>"`; add cookies from the open Playwright session if the asset is gated.

For inline SVGs that are embedded directly in the page HTML, extract the SVG markup and write it to a `.svg` file rather than downloading.

## Referencing in Scenes

Assets in `public/` are served at the root path:

```yaml
slots:
  logo: '<img src="/logo.svg" alt="Site Logo" style="height:47px;width:auto;">'
```

## Referencing in Templates

How component templates reference static assets depends on the framework integration. The integration skill (e.g. `designbook-drupal`) may provide its own conventions for asset path resolution in templates.

````

### ctx:view (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/blueprints/view.md)
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

### ctx:taxonomy_term (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/blueprints/taxonomy_term.md)
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

### ctx:node (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/blueprints/node.md)
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

### ctx:media (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/blueprints/media.md)
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

### ctx:field-types (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/blueprints/field-types.md)
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

### ctx:block_plugin (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/data-model/blueprints/block_plugin.md)
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

### ctx:section (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/section.md)
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

### ctx:pager (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/pager.md)
```
---
type: component
name: pager
priority: 10
embeds: []
trigger:
  domain: components
---

# Blueprint: Pager

A pager component renders the page-link controls for a paginated result set — previous/next
navigation, an enumerated page-link list, and the current-page indicator. It is composed by its
own presenter-template (see `data-mapping/blueprints/pager.md`); it never reconstructs its links
from raw view output itself.

**Use for:** Any paginated result set's navigation controls — a view's default pager, a mini pager,
or an infinite-scroll "load more" control.

## Components

### pager

Root pager component. Renders the previous/next controls and, for a standard pager, the enumerated
page-link list with the current page indicated.

#### Props
- variant: enum [standard, mini, infinite-scroll] — which pager configuration this instance renders
- current: number — the current page index
- heading_id: string — id for the pager's accessible heading/label

#### Slots
- previous — previous-page link (present unless on the first page)
- next — next-page link (present unless on the last page)
- pages — enumerated page-link items (standard variant only; omitted for mini/infinite-scroll)
- load_more — the load-more control (infinite-scroll variant only)

#### Composition
- `variant: standard` renders `pages` alongside `previous`/`next`
- `variant: mini` renders only `previous`/`next`; `pages` stays empty
- `variant: infinite-scroll` renders `load_more` instead of `pages`; `previous`/`next` are unused
- A slot with no incoming link (e.g. `previous` on the first page) renders nothing — the component
  never fabricates a disabled placeholder link
- No prop carries a total item/page count — the component renders only from the page-link items and
  current indicator it is given; it never displays a "page X of Y" string unless that data is
  explicitly passed in

---

### pager_item

A single page-link entry inside the `pages` slot.

#### Props
- href: string — the target URL for this page
- label: string — the visible page number or label (e.g. "1", "…")
- is_current: boolean — whether this item is the current page

#### Composition
- The current item (`is_current: true`) renders without a link, or with an active/current state
- An ellipsis entry carries no `href` — it renders as a static label between page-link groups

## Twig Slot Pattern

All slots MUST be wrapped in `{% block %}` tags — see the `SdcTemplate` schema in
`components/schemas.yml` for the full constraint and examples.

```

### ctx:page (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/page.md)
```
---
type: component
name: page
priority: 10
trigger:
  domain: components.shell
---

# Blueprint: Page

Top-level page wrapper that composes header, content, and footer regions.

**Use for:** The outermost page shell that arranges the three main regions vertically.

## Slots
- header — site header region (required)
- content — main content area (required)
- footer — site footer region (required)

```

### ctx:navigation-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/navigation.md)
````
---
type: component
name: navigation
priority: 10
trigger:
  domain: components
---

# Blueprint: Navigation

Renders a Drupal menu tree. Supports variants for different placement contexts.

**Use for:** Primary site navigation in the header, footer link groups, or any Drupal menu tree.

## Props
- variant: enum [main, footer] (default: "main")
- items: array of Drupal `MenuLinkTreeElement` items

### Drupal Menu Item Structure

Each item in the `items` array:

```yaml
- title: string        # link text
  url: string          # href value (Drupal Url::toString())
  in_active_trail: boolean  # true if this item or a child is the current page
  below: []            # nested child items (same structure, recursive)
```

> **Naming rules:**
> - Use `items` (not `links`, `menu_items`, or `nav_items`) — matches Drupal's `menu.html.twig`
> - Use `in_active_trail` (not `active`) — Drupal distinguishes between active page and ancestor trail
> - Use `below` for nested children (not `children` or `submenu`)

## Structure

- Uses a recursive Twig macro for nested `below` items
- Shell stories typically use a flat list (1 level)

## Collapsible / mobile variant

When the reference collapses the navigation behind a trigger at smaller viewports,
the markup must ship the toggleable panel — not just the trigger button. The trigger
carries `aria-controls` (the panel id), `aria-expanded`, and a `data-behavior` hook;
the panel carries the id and starts `hidden`. Which viewport shows the trigger vs. the
inline list is a CSS-utility concern; the open/closed toggle is component behavior, so
the variant ships a co-located `<name>.js`. Provide a story showing the opened panel so
the expanded state is visible and verifiable, not only the collapsed default.

````

### ctx:logo (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/logo.md)
```
---
type: component
name: logo
priority: 10
trigger:
  domain: components
---

# Blueprint: Logo

Brand mark or wordmark used in header, footer, or authentication contexts.

**Use for:** Any instance where the site's visual identity appears as a clickable or static mark. Never hardcode the image path or alt text in this blueprint — those are per-design content.

## Variants

- `full` — wordmark plus symbol (default for header)
- `mark-only` — symbol without text (compact contexts)
- `inverse` — light-on-dark variant for dark backgrounds

## Props

- `variant` — string, enum above
- `href` — string, optional (default `/` when the logo is clickable)
- `alt` — string, required when `media` slot is empty

## Slots

- `media` — `image` or `element` node providing the actual mark. No default image.

```

### ctx:link (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/link.md)
```
---
type: component
name: link
priority: 10
trigger:
  domain: components
---

# Blueprint: Link

Inline text anchor. Distinct from `button` — links navigate; buttons trigger actions.

**Use for:** Footer legal rows, inline body-text links, external references. Never for primary CTAs — use `button.md` with `href:` instead.

## Variants

- `default` — inherits colour, underlined on hover
- `subtle` — neutral colour (for secondary navigation)
- `external` — renders an external-link icon after the label

## Props

- `label` — string, required
- `url` — string, required
- `variant` — string, enum above

## Slots

- `icon` — optional trailing icon (ignored when `variant: external`)

```

### ctx:js-behavior-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/js-behavior.md)
````
---
type: pattern
name: js-behavior
trigger:
  domain: components
filter:
  backend: drupal
---

# Blueprint: Component JS Behavior

The **default** starting point for the JavaScript of a component that has interaction
(a `behavior` on its `interactive[]` entry): a toggle/disclosure/overlay/menu that
opens, closes, or activates a target. This is one approach — `<name>.js` holds any
component JS, and a project may script it differently (Alpine, vanilla, a web
component); as a blueprint this is overridable. The Drupal route is the default
because it runs unchanged in Drupal and Storybook — the SDC Storybook addon ships the
Drupal JS runtime and auto-discovers `<name>.js`, and `Drupal.attachBehaviors` runs
after each render — both in the component's own story and in the designbook-generated
scene and entity view-mode stories the component is placed into — so a `Drupal.behaviors`
toggle stays live wherever the component appears, without extra wiring.

## Pattern

Attach with `Drupal.behaviors` + `once()` so re-attaches (and Storybook re-renders)
don't double-bind. Drive an accessible attribute, not a CSS class, as the source of
truth for the open state, and reflect it on the controlled target:

```js
(function (Drupal, once) {
  Drupal.behaviors.<name> = {
    attach(context) {
      once('<name>', '[data-behavior="<name>"]', context).forEach((trigger) => {
        const target = document.getElementById(trigger.getAttribute('aria-controls'));
        trigger.addEventListener('click', () => {
          const open = trigger.getAttribute('aria-expanded') === 'true';
          trigger.setAttribute('aria-expanded', String(!open));
          if (target) target.hidden = open;
        });
      });
    },
  };
})(Drupal, once);
```

The markup side: the trigger carries `aria-controls="<target-id>"`, `aria-expanded`
(initial `"false"`), and a stable `data-behavior` hook; the target carries the id and
starts `hidden`. Responsive visibility (which breakpoint shows the trigger vs. the
inline element) stays in CSS utilities — only the open/closed toggle is JS.

## Native alternative

For a plain show/hide of static content with no overlay or focus semantics (e.g. a
footer column that collapses on small viewports), `<details>/<summary>` is a
no-JS option. Anything with an overlay, focus trap, or off-canvas surface uses the
JS pattern above.

````

### ctx:icon (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/icon.md)
```
---
type: component
name: icon
priority: 10
trigger:
  domain: components
---

# Blueprint: Icon

Non-text symbol — social glyphs, search affordances, toggle indicators.

**Use for:** Purely decorative or semantically labelled symbols that are not interactive on their own. Icons inside buttons go into the button's `icon` slot, not as a standalone component.

## Props

- `name` — string, required (e.g. `search`, `menu`, `chevron-right`, `instagram`)
- `size` — enum `[sm, md, lg]`, optional (default `md`)
- `label` — string, optional (used as `aria-label` when the icon is decorative-but-meaningful)

## Slots

None.

```

### ctx:header (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/header.md)
```
---
type: component
name: header
priority: 10
trigger:
  domain: components.shell
---

# Blueprint: Header

Site header that composes logo, navigation, and optional actions.

**Use for:** The primary site header region.

## Structure

- Wraps its content in a [`container`](container.md) component for consistent edge spacing and max-width
- Contains a [`navigation`](navigation.md) component (variant: main) as a required slot

## Props
- sticky: boolean (default: false)

## Slots
- logo — site logo / brand mark (recommended)
- navigation — navigation component (recommended — see `navigation.md` rule for enforcement)
- Additional slots as determined by the design reference

## Layout

Headers vary per design: a single bar, stacked rows (brand strip + navigation), or more.
Derive the row/region count, heights, padding, and stacking from the design reference
(extract.json landmarks) — do not assume a fixed shape. Preserve every visually distinct
landmark region as its own stacked element rather than collapsing them into one row.

```

### ctx:grid (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/grid.md)
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

### ctx:form (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/form.md)
```
---
type: component
name: form
priority: 10
embeds: []
trigger:
  domain: components
---

# Blueprint: Form

A complete form component system consisting of a universal wrapper (form_element), label, and input types. The form_element wrapper provides consistent structure for label, description, error display, and the actual input element. Inputs themselves are lean and render only their HTML element.

**Use for:** Any Drupal form rendering — contact forms, login, registration, settings, search, filters.

## Composition Pattern

Two markup patterns determine wrapper structure:

- **Text-like** (input, select, textarea): form_element with `label_display: before`
- **Check-like** (checkbox, radio): form_element with `label_display: after`
- **Groups** (checkboxes, radios): collect multiple check-like elements

## Components

### form_element

Universal wrapper around label and form input. Provides consistent structure for label, description, prefix/suffix, and error display.

**Use for:** Every single form field — wraps the respective input type.

#### Props
- type: string — Drupal form element type (textfield, email, checkbox, select, etc.)
- label_display: enum [before, after, invisible] (default: "before")
- description_display: enum [before, after, invisible] (default: "after")
- description: object { content: string, attributes: object }

#### Slots
- label — label component
- prefix — content before the input
- suffix — content after the input
- errors — error message
- children — the actual input

#### Composition
- Type determines CSS pattern: text-like → form-input wrapper, check-like → form-check wrapper
- label_display controls order: before/invisible → label before children, after → label after children
- Error display after the input with alert role
- Description position controlled via description_display

---

### label

Form label component used inside form_element's label slot.

**Use for:** Label rendering for all form elements.

#### Props
- title_display: enum [before, after, invisible, hidden] (default: "before")

#### Slots
- title — the label text

---

### input

Lean input for text-based entries. Type is controlled via the HTML type attribute.

**Use for:** textfield, email, password, number, tel, url, search, date, file, color, range

#### Props
- pattern: string — HTML pattern attribute for validation (regex)

#### Slots
- children — optional additional elements

#### Composition
- Always embedded in form_element as children slot
- Input type (email, tel, etc.) is controlled via HTML attributes, not component props

---

### select

Dropdown selection.

#### Props
- options: array — array of option objects { value, label, selected }

#### Slots
- option_elements — custom HTML options (overrides options prop)
- children — fallback for raw HTML

#### Composition
- Embedded in form_element as children slot
- form_element.type = "select"

---

### textarea

Multi-line text field.

#### Props
- value: string (default: "")

#### Slots
- children — raw HTML (overrides value prop)

#### Composition
- Embedded in form_element as children slot

---

### checkbox

Single checkbox. Renders only the input element.

#### Props
- (no own props — state via HTML attributes: checked, disabled, value)

#### Slots
- children — optional additional elements

#### Composition
- Embedded in form_element as children slot
- form_element.type = "checkbox", label_display = "after"

---

### radio

Single radio button. Renders only the input element.

#### Props
- (no own props — state via HTML attributes: checked, disabled, value, name)

#### Slots
- children — optional additional elements

#### Composition
- Embedded in form_element as children slot
- form_element.type = "radio", label_display = "after"

---

### checkboxes

Group container for multiple checkboxes.

#### Slots
- children — array of checkbox components (each wrapped in its own form_element)

#### Composition
- Embedded in form_element as children slot
- form_element.type = "checkboxes"
- Each child is a form_element with checkbox as children

---

### radios

Group container for multiple radio buttons.

#### Slots
- children — array of radio components (each wrapped in its own form_element)

#### Composition
- Embedded in form_element as children slot
- form_element.type = "radios"
- All radios share the same name attribute value

---

### submit

Submit button for forms.

#### Props
- (value and state via HTML attributes: value, disabled)

#### Composition
- Stands alone, not wrapped in form_element

## Twig Slot Pattern

All slots MUST be wrapped in `{% block %}` tags — see the `SdcTemplate` schema in `components/schemas.yml` for the full constraint and examples.

## Covered Drupal Form Element Types

| Drupal type | Blueprint component | Notes |
|---|---|---|
| textfield, email, password, number, tel, url, search | input | type via HTML attribute |
| date, file, color, range | input | type via HTML attribute |
| select | select | own component for options array |
| textarea | textarea | own component |
| checkbox | checkbox + form_element | label_display: after |
| radio | radio + form_element | label_display: after |
| checkboxes | checkboxes + form_element | groups checkbox instances |
| radios | radios + form_element | groups radio instances |
| submit | submit | without form_element wrapper |

> Specialized admin types (machine_name, password_confirm, path_element, vertical_tabs, item) are not covered — these require project-specific solutions.

```

### ctx:footer (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/footer.md)
```
---
type: component
name: footer
priority: 10
trigger:
  domain: components.shell
---

# Blueprint: Footer

Site footer that composes brand area, navigation, and copyright.

**Use for:** The page footer region.

## Structure

- Wraps its content in a `container` component for consistent edge spacing and max-width
- Contains a `navigation` component (variant: footer) as a required slot

## Props
- copyright: string (optional)

## Slots
- navigation — footer navigation component (required)
- Additional slots as determined by the design reference

## Multi-Section Structure

Footers often consist of multiple distinct visual sections, each with its own background color. Each section wraps its content in a `container` embed to maintain consistent edge spacing. The outer section `<div>` carries its own background color and optional border.

The number of sections, their background colors, slots, and content are determined by the design reference — not prescribed here.

```

### ctx:container (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/container.md)
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

### ctx:button (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/583ab386b5ac/components/blueprints/button.md)
```
---
type: component
name: button
priority: 10
trigger:
  domain: components
---

# Blueprint: Button

Atomic interactive control for primary and secondary actions.

**Use for:** Any clickable or tappable call-to-action that performs an action or navigates to a distinct destination. Never for inline text links — use `link.md` for those.

## Variants

Declare a `variant` enum that is shared across every button on the design; never encode per-design defaults in the blueprint:

- `primary` — dominant visual weight, brand colour background
- `outline` — border-only, transparent background
- `ghost` — no border, no background, inherits colour
- `default` — neutral weight, used when variant is omitted

## Props

- `label` — string, required
- `variant` — string, enum above
- `size` — enum `[sm, md, lg]`, optional (default unset; theme decides)
- `disabled` — boolean, optional
- `href` — string, optional (renders `<a>` when present; otherwise `<button>`)

## Slots

- `icon` — optional leading icon (render before the label)

```

## Steps

### Step: write-scene
Context: [ctx:cli-surface, ctx:sample-template-mapping, ctx:presenter-template-2, ctx:variant-transport, ctx:typed-component-boundary, ctx:story-image-node-renderer, ctx:shell-scene-constraints, ctx:screen-scene-constraints, ctx:scenes-constraints, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:markup-derivation, ctx:local-image-assets, ctx:icon-sprite, ctx:entity-reference-rendering, ctx:component-contract-index, ctx:token-backed-utilities, ctx:scenes-constraints-2, ctx:font-availability, ctx:component-styling, ctx:component-source, ctx:navigation, ctx:scenes-constraints-3, ctx:presenter-template-surfaces, ctx:media-image-styles, ctx:form-modes, ctx:field-type-constraints, ctx:drupal-views, ctx:drupal-config, ctx:block-decision, ctx:slot-rendering, ctx:layout-constraints, ctx:js-behavior, ctx:image_style, ctx:static-assets, ctx:view, ctx:taxonomy_term, ctx:node, ctx:media, ctx:field-types, ctx:block_plugin, ctx:section, ctx:pager, ctx:page, ctx:navigation-2, ctx:logo, ctx:link, ctx:js-behavior-2, ctx:icon, ctx:header, ctx:grid, ctx:form, ctx:footer, ctx:container, ctx:button]

- [x] write-scene — project-detail-billing

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/projects/projects.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components
  scene_scope: screen
  scene_name: project-detail-billing
  items:
    - scene: design-system:shell
      with:
        overlay: ''
        content:
          - component: bb_theme:canvas
            slots:
              header:
                - component: bb_theme:page_header
                  props:
                    title: bakers.build Platform
                    description: Billing · the accounts recorded time on this project is billed to
                  slots:
                    tabs:
                      component: bb_theme:tabs
                      props:
                        label: Project sections
                        items:
                          - label: Overview
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                            active: false
                          - label: Board
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                            active: false
                          - label: Tickets
                            url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                            active: false
                          - label: Time
                            url: /?path=/story/designbook-sections-projects-scenes--project-time
                            active: false
                          - label: Stats
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                            active: false
                          - label: Runs
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                            active: false
                          - label: Members
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                            active: false
                          - label: Billing
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-billing
                            active: true
                          - label: Settings
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                            active: false
              main:
                - component: bb_theme:zone
                  props:
                    gap: none
                    description: Who recorded time on this project is billed to
                  slots:
                    heading: Billing accounts
                    actions:
                      component: bb_theme:button
                      props:
                        variant: primary
                        label: New billing account
                        icon_only: true
                      slots:
                        icon:
                          component: bb_theme:icon
                          props:
                            name: plus
                            size: sm
                    content:
                      - component: bb_theme:list
                        props:
                          layout: cards
                          spacing: comfortable
                          pattern:
                            headline:
                              - name
                            meta:
                              - type
                              - tickets
                            right:
                              - default
                              - make_default
                              - edit
                              - archive
                          items:
                            - cells:
                                name:
                                  kind: text
                                  value: bakers.build Platform internal
                                  emphasis: strong
                                type:
                                  kind: text
                                  value: Internal
                                  emphasis: faint
                                tickets:
                                  kind: text
                                  value: Booked for every ticket without its own account
                                  emphasis: faint
                                default:
                                  kind: badge
                                  label: Default
                                  tone: running
                                  dot: true
                                edit:
                                  kind: action
                                  label: Edit
                                  variant: ghost
                            - cells:
                                name:
                                  kind: text
                                  value: Kunde X maintenance
                                  emphasis: strong
                                type:
                                  kind: text
                                  value: Time & Material
                                  emphasis: faint
                                tickets:
                                  kind: text
                                  value: Linked to BB-12, BB-40
                                  emphasis: faint
                                edit:
                                  kind: action
                                  label: Edit
                                  variant: ghost
                                archive:
                                  kind: action
                                  label: Archive
                                  variant: ghost
                            - cells:
                                name:
                                  kind: text
                                  value: Relaunch fixed price
                                  emphasis: strong
                                type:
                                  kind: text
                                  value: Fixed Price
                                  emphasis: faint
                                tickets:
                                  kind: text
                                  value: No linked tickets
                                  emphasis: faint
                                make_default:
                                  kind: action
                                  label: Make default
                                  variant: ghost
                                edit:
                                  kind: action
                                  label: Edit
                                  variant: ghost
                                archive:
                                  kind: action
                                  label: Archive
                                  variant: ghost
                      - component: bb_theme:collapsible
                        props:
                          open: false
                        slots:
                          label: Archived accounts (1)
                          content:
                            - component: bb_theme:list
                              props:
                                layout: cards
                                spacing: comfortable
                                pattern:
                                  headline:
                                    - name
                                  meta:
                                    - type
                                  right:
                                    - state
                                items:
                                  - cells:
                                      name:
                                        kind: text
                                        value: Pilot phase
                                      type:
                                        kind: text
                                        value: Fixed Price
                                        emphasis: faint
                                      state:
                                        kind: badge
                                        label: Archived
                                        tone: offline
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:tabs
    - id: bb_theme:zone
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:list
    - id: bb_theme:collapsible
    - id: bb_theme:badge
  ```

  #### Contract
  ```yaml
  outputs:
    scene-file:
      required: true
      schema:
        $ref: '#/definitions/SceneFile'
      submission: data
      validators:
        - scene
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — project-detail-billing (new account)

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/projects/projects.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/components
  scene_scope: screen
  scene_name: project-detail-billing (new account)
  items:
    - scene: design-system:shell
      with:
        content:
          - component: bb_theme:canvas
            slots:
              header:
                - component: bb_theme:page_header
                  props:
                    title: bakers.build Platform
                    description: Billing · the accounts recorded time on this project is billed to
                  slots:
                    tabs:
                      component: bb_theme:tabs
                      props:
                        label: Project sections
                        items:
                          - label: Overview
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-overview
                            active: false
                          - label: Board
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-board
                            active: false
                          - label: Tickets
                            url: /?path=/story/designbook-sections-tickets-scenes--ticket-list
                            active: false
                          - label: Time
                            url: /?path=/story/designbook-sections-projects-scenes--project-time
                            active: false
                          - label: Stats
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-stats
                            active: false
                          - label: Runs
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-runs
                            active: false
                          - label: Members
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-members
                            active: false
                          - label: Billing
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-billing
                            active: true
                          - label: Settings
                            url: /?path=/story/designbook-sections-projects-scenes--project-detail-settings
                            active: false
              main:
                - component: bb_theme:zone
                  props:
                    gap: none
                    description: Who recorded time on this project is billed to
                  slots:
                    heading: Billing accounts
                    actions:
                      component: bb_theme:button
                      props:
                        variant: primary
                        label: New billing account
                        icon_only: true
                      slots:
                        icon:
                          component: bb_theme:icon
                          props:
                            name: plus
                            size: sm
                    content:
                      - component: bb_theme:list
                        props:
                          layout: cards
                          spacing: comfortable
                          pattern:
                            headline:
                              - name
                            meta:
                              - type
                              - tickets
                            right:
                              - default
                              - make_default
                              - edit
                              - archive
                          items:
                            - cells:
                                name:
                                  kind: text
                                  value: bakers.build Platform internal
                                  emphasis: strong
                                type:
                                  kind: text
                                  value: Internal
                                  emphasis: faint
                                tickets:
                                  kind: text
                                  value: Booked for every ticket without its own account
                                  emphasis: faint
                                default:
                                  kind: badge
                                  label: Default
                                  tone: running
                                  dot: true
                                edit:
                                  kind: action
                                  label: Edit
                                  variant: ghost
                            - cells:
                                name:
                                  kind: text
                                  value: Kunde X maintenance
                                  emphasis: strong
                                type:
                                  kind: text
                                  value: Time & Material
                                  emphasis: faint
                                tickets:
                                  kind: text
                                  value: Linked to BB-12, BB-40
                                  emphasis: faint
                                edit:
                                  kind: action
                                  label: Edit
                                  variant: ghost
                                archive:
                                  kind: action
                                  label: Archive
                                  variant: ghost
                            - cells:
                                name:
                                  kind: text
                                  value: Relaunch fixed price
                                  emphasis: strong
                                type:
                                  kind: text
                                  value: Fixed Price
                                  emphasis: faint
                                tickets:
                                  kind: text
                                  value: No linked tickets
                                  emphasis: faint
                                make_default:
                                  kind: action
                                  label: Make default
                                  variant: ghost
                                edit:
                                  kind: action
                                  label: Edit
                                  variant: ghost
                                archive:
                                  kind: action
                                  label: Archive
                                  variant: ghost
                      - component: bb_theme:collapsible
                        props:
                          open: false
                        slots:
                          label: Archived accounts (1)
                          content:
                            - component: bb_theme:list
                              props:
                                layout: cards
                                spacing: comfortable
                                pattern:
                                  headline:
                                    - name
                                  meta:
                                    - type
                                  right:
                                    - state
                                items:
                                  - cells:
                                      name:
                                        kind: text
                                        value: Pilot phase
                                      type:
                                        kind: text
                                        value: Fixed Price
                                        emphasis: faint
                                      state:
                                        kind: badge
                                        label: Archived
                                        tone: offline
        overlay:
          - component: bb_theme:dialog
            props:
              open: true
              title: New billing account
              label: New billing account
              dismissible: true
            slots:
              body:
                - component: bb_theme:form
                  slots:
                    lines:
                      - component: bb_theme:form_input
                        props:
                          type: text
                          name: name
                          id: billing-account-name
                          required: true
                          placeholder: What is this billing account called
                          value: ''
                    pills:
                      - component: bb_theme:property_pill
                        props:
                          name: billing_type
                          label: Billing type
                          icon: project
                          picker_id: billing-account-type
                          aria_label: Change billing type. Currently Internal.
                          value_label: Internal
                          values:
                            - internal
                          open: false
                          multiple: false
                          options:
                            - value: time_material
                              label: Time & Material
                              selected: false
                            - value: fixed_price
                              label: Fixed Price
                              selected: false
                            - value: internal
                              label: Internal
                              selected: true
              actions:
                - component: bb_theme:button
                  props:
                    variant: ghost
                    label: Cancel
                - component: bb_theme:button
                  props:
                    variant: primary
                    label: Create billing account
                    type: submit
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:tabs
    - id: bb_theme:zone
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:list
    - id: bb_theme:collapsible
    - id: bb_theme:badge
    - id: bb_theme:dialog
    - id: bb_theme:form
    - id: bb_theme:form_input
    - id: bb_theme:property_pill
  ```

  #### Contract
  ```yaml
  outputs:
    scene-file:
      required: true
      schema:
        $ref: '#/definitions/SceneFile'
      submission: data
      validators:
        - scene
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-666-show-and-set-a-t/web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml
  ```

  #### Results
  <!-- done -->

