# Plan: design-component
<!-- digest: e1f8772291b300fdb0e856251b9fe8d2ad791ccb06a93c38d169df1d7df8a372 -->

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
  - id: bb_theme:zone
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/zone/zone.component.yml
    hash: 5c5d02f1e3de6908a4b223a23583704948e2449e50bfa32684e334a1fee30f96
    contract:
      component: zone
      group: Layout
      description: 'A body region inside a screen — the IA document''s own word for it (D9.3 "Zones", D10.1/D10.2 "Board / Delivery / Runs zone"). It is what a screen puts inside `canvas.main`: an optional heading, optional right-aligned actions, and a content grid whose direct children are the cells. It supersedes `section` in every scene (BB-378 D14) and deliberately arrives with three of that component''s concerns dropped. `padding_x`/`padding_y` are replaced by ONE `inset`, because on `section` the same word meant two sizes — `sm` was 10px horizontally and 8px vertically (F7) — which is a trap rather than a feature. `justify_items` is replaced by `direction: row`, which wraps and keeps its children''s intrinsic widths: the only thing `justify_items: start` was ever used for was stopping a grid cell blockifying an `inline-flex` pill, and a wrapping row does that by construction. `header_style` does not come along at all: a zone heading has ONE style, so a scene cannot make two adjacent zones disagree about what a zone heading looks like. `inset` and `gap` resolve to `space-*` tokens only — spacing here is configuration on a measured scale, never a hard pixel value (D16). The heading renders `<h2>`, because `page_header` owns the screen''s only `<h1>` (D5); a zone with no heading renders none, not an empty one. A ZONE WITH NOTHING TO SHOW RENDERS NOTHING AT ALL (BB-414) — no `<section>`, no heading, no empty grid. `content` and `actions` are what count as something to show; a heading alone does not, because a heading is a label for something and a label over nothing is a promise the screen does not keep. Two surfaces on the ticket detail forced it and both used to render as a heading over an empty box: the About zone on a ticket whose `description` is empty, and the Run history zone on a ticket whose runs are all invisible to the reader. THE TEST STRIPS TAGS AND COMMENTS FIRST, which is measured rather than defensive: with `twig.config.debug` on — every DDEV site — SDC wraps every component in `<!-- Component start/end -->` markers, so a child that rendered nothing still arrives as 91 bytes, and a naive emptiness test would keep the zone in development and drop it in production. `|striptags` removes both, and its allow-list keeps the void elements (`img`, `svg`, `input`, …) that are content without carrying text. Actions count as content on purpose: a zone with an empty list but an add affordance is the only place a reader can put the first item into it. THE HONEST LIMIT: hiding the Run history zone removes a misleading sight, it does not make the runs visible. Run rows are filtered by `view` access and `bb_run`''s admin permission is `administer bakers`, so a reader without it now sees no trace of run history at all rather than an empty box. That is an accepted trade, not a fix — the permission model is a separate decision and a separate ticket. BB-414''s second review gate corrected the gate twice more. `description` NOW COUNTS as something to show: it is a prop rather than a slot, so it is not part of the content capture, and a zone carrying a heading and a description but no content used to drop the description with everything else — prose the reader was meant to read, gone with the box it explained. A description is a sentence, not a label for something absent, so unlike a heading it keeps the zone. And `drupal-render-placeholder` is NOW IN THE ALLOW-LIST: anything Drupal defers — a lazy builder, a form, a cached block, the messages area — arrives here as that one element and nothing else, carries no text and no void element, and was therefore measured as empty and dropped moments before Drupal would have replaced it with the real markup. Content that has not been built yet is still content.'
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
  - id: bb_theme:period-range
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/period-range/period-range.component.yml
    hash: 054ce04561c08ed2fb45a7c26792926500249bd745d4def31b0c94ec343640eb
    contract:
      component: period-range
      group: Data Display
      description: 'Harvest-style period switch for a statistics page: a kind dropdown (Week, Month, Quarter, Year, All time, Custom), previous/next buttons around the period label that opens a picker popover, an optional "Return to this <kind>" link, and the comparison text "vs. <previous period>". A GET form carrying hidden <name>[period|date|start|end] inputs; with `action` set every navigation submits it, without `action` (Storybook) it only updates in place. Date math and labels come from the pure functions exported by period-range.src.js (periodOf, shift, comparisonOf, labelOf); the Alpine component `periodRange` from the same file drives the markup. The component formats nothing on the server and fetches nothing.'
      props:
        type: object
        properties:
          kind:
            type: string
            enum:
              - week
              - month
              - quarter
              - year
              - all
              - custom
            title: Period kind
          date:
            type: string
            pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}$
            title: Anchor date
            description: Any day inside the selected week/month/quarter/year (YYYY-MM-DD). Defaults to today.
          start:
            type: string
            pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}$
            title: Custom start
            description: First day of a custom range (YYYY-MM-DD), inclusive.
          end:
            type: string
            pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}$
            title: Custom end
            description: Last day of a custom range (YYYY-MM-DD), inclusive.
          today:
            type: string
            pattern: ^[0-9]{4}-[0-9]{2}-[0-9]{2}$
            title: Today
            description: The day treated as today (YYYY-MM-DD). Fixed in stories for deterministic output; defaults to the real UTC today.
          action:
            type: string
            title: Form action
            description: 'URL the GET form submits to. Empty: no submit, the control only updates itself (Storybook).'
          name:
            type: string
            title: Parameter prefix
            default: filter
            description: 'Prefix of the hidden inputs: <name>[period], <name>[date], <name>[start], <name>[end].'
          open:
            type: string
            enum:
              - none
              - kind
              - picker
              - from
              - to
            default: none
            title: Initially open popover
            description: Which popover renders open on first paint; stories use it to show a picker. Runtime state after that.
        required:
          - kind
        additionalProperties: false
      slots: {}
  - id: bb_theme:property_pill
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/property_pill/property_pill.component.yml
    hash: 94546903f97d0d971f4157c69d12c80d560d8ced911ffcad71e674e0be3b6b43
    contract:
      component: property_pill
      group: Form
      description: 'One property pill of an add or edit surface — grammar 3''s peer property, and with prominent set, grammar 3a''s lead. It is the union of option_picker''s contract and option_list''s, and it exists so that union is spelled once: clearable, clear_label, creatable and create_label belong to option_list, because a clear row and a create row ARE rows of the listbox, while icon and the value labels sit on the trigger and belong to option_picker. Each field goes to whichever of the two owns it. It was a macro inside form until form began composing its regions from RENDERED content; a macro is not addressable from outside its own file, and both a field widget and a scene have to be able to render exactly this. The panel is composed here from PLAIN OPTION DATA and never handed in as rendered content, which is what lets a caller state a pill as a handful of strings and a list of value/label/selected rows. The accessible name is left to option_picker to derive from the field name and the value when the caller passes none, so it is never empty and never spelled twice; pass aria_label where the derived sentence would not agree in number.'
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
  - id: bb_theme:table
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/table/table.component.yml
    hash: 66d74a6e25c362b117dabfa5b166f44280671066ecedeffd5cd9b7cd0e50d3af
    contract:
      component: table
      group: Data Display
      description: 'A listing WITH COLUMNS, and it owns its rows. `columns` is the ordered column set and `rows` is the data; a `<td>` is emitted per COLUMN and addressed by that column''s `key`, so a row cannot carry a cell for a column that does not exist and a column with no cell renders an empty `<td>` instead of shifting every value one place left. That keying is the whole point: it is what a container of rendered row components could never do, and it is why three headers over nine cells is no longer expressible. A header cell may be SORTABLE, which is what makes this a table rather than a list with lines: the cell then carries `aria-sort` and its label becomes the link that re-sorts, the shape Drupal''s own views-view-table renders. A Drupal view drives this through `click_sort_column` on the field, so the affordance belongs to the header — it never belonged to a row. `rows` is a PROP and not a slot because a cell is plain data: a slot is how the previous architecture injected an already-rendered row, and the one slot left here is the collapsed variant''s confirmation strip. A cell is rendered by the `cell()` macro this template declares, which `list` imports, so a badge in a table cell and a badge in a list item are one code path and not two that agree. THE MACRO IS ALSO REACHABLE FROM PHP by component id, which is what lets a Drupal field formatter produce a cell face without a second copy of it. EVERY TABLE VIEW IN THIS THEME BINDS THIS COMPONENT, and it binds it from ONE GLOBAL style template — `views-view-table.html.twig`, with no per-view suffix — which maps Views'' own `header` onto `columns` and each row''s rendered field output onto a `rendered` cell keyed by the field id. So a table view gets this component by existing: the ticket list''s nine real Views fields and the delivered team members screen arrive here through the same file, and there is NO PER-VIEW PHP AT ALL — no preprocess hook, and nothing to alter per view. What that template cannot derive from Views'' variables it asks of the ROW ENTITY, AND IT ASKS WITHOUT AN INTERFACE: this sentence named `BbTableRowInterface` until 2026-09-04 and that class is DELETED — the human''s instruction was that it "must be gone" and `TableRowFaceTest` fails if it returns. The binding asks the entity for its phase and lets `|default('''')` absorb a missing method, so an entity that cannot answer declines and declining needs no contract. That is why the team screen''s `og_membership` rows render with no accent while a ticket''s rows carry one, from one template. The ROW TARGET went with the interface: no view fills `url` any more, measured before deleting the ask — nothing in this theme read `data-row-url` except the tests asserting it. That absence of a per-view seam is the property worth stating in the component rather than only in the binding, because it is exactly what a later “just add a preprocess” would quietly destroy while every gate stayed green.'
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
  - id: bb_theme:collection-position
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/collection-position/collection-position.component.yml
    hash: f8bb58d88b036f17f3c54f7fba454e0a6d0cbbe804d6215e4b3b5789cd655609
    contract:
      component: collection-position
      group: Data Display
      description: 'The BB-312 position-in-collection indicator, which until now existed only in the TUI (`ListScreen.countLabel()`). It states WHERE the rows on screen sit inside the collection — the range `from`–`to` — and, when established, the collection''s `total` size. It mirrors `countLabel()`''s two cases exactly: with a total it reads `21–40 of 60 tickets`; with the total absent or null it degrades to `21–40 of ?`, because `?` is the honest rendering of an unestablished total rather than a zero or a guess. The dash between the two bounds is an EN DASH, not a hyphen. `noun` is rendered after the total in the known-total case only — the plain plural (`tickets`) rather than the TUI''s `ticket(s)` shorthand, because the web label has room to be written properly.'
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
  - id: bb_theme:button
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/button/button.component.yml
    hash: c0552ef259deebd2cab160ed0257033ff4437f6bcacc5d91a36a854851310cbd
    contract:
      component: button
      group: Action
      description: Atomic action control with an optional leading icon slot. Renders an anchor when href is set and a button otherwise. Distinct from the submit component, which is form-bound.
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
  - id: bb_theme:note
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/note/note.component.yml
    hash: f3d0ea461fee622dbb5174564c22a0c32b85cf7faeddff295fe142e511191d45
    contract:
      component: note
      group: Data Display
      description: |-
        A quiet aside placed at the control it belongs to — a lead, a sentence, and one hairline rule down the leading edge. Nothing else.

        IT RENDERS A NOTE; WHAT THE NOTE IS ABOUT IS THE CALLER'S KNOWLEDGE. It was built for one thing and named after it: the sentence that names a server-side consequence at the field that causes it — "Set: this is claimed at the next poll and an agent run starts on cw-framework." That is the second half of the action-pattern rule (designbook/design-system/action-pattern.md): where a single-step action has a side effect, the side effect is NAMED instead of confirmed. But nothing in the markup knows that. *That* the sentence describes a consequence, and that the consequence is server-side, is what the surface placing it knows; a component that carried the word in its name made every other quiet aside in the theme look like it needed a component of its own.

        THIS IS DELIBERATELY NOT `message`, and the distinction is the reason both exist. `message` offers status|warning|error and serves a Drupal message region: `status` is teal with a status icon, so it announces something as though it had already succeeded, and `warning` announces a deliberate, reversible choice as a problem. A note is neither — it is information about what WILL happen, in the future tense, and naming a consequence is only honest if it reads as information rather than as a result.

        SO THE TONE COLOURS THE HAIRLINE AND NOTHING ELSE — no tint, no icon, no background, ever. That is what keeps a tone from turning this back into `message` by increments: there is one styled edge to colour, so a tone can distinguish a caution from an ordinary aside without any of it announcing a state. `neutral` is the default and is the whole of today's rendering; it uses the theme's own tone words rather than a fourth private vocabulary, and a third value is one entry in one map when a caller has a use for it.
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
  - id: bb_theme:icon
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/icon/icon.component.yml
    hash: 7dcb6785f511b07e4803281d7efa75e36ba12c0dcdad8d768109448fbcf1eb61
    contract:
      component: icon
      group: Media
      description: Renders the bakers UI Icons pack through the Drupal Icon API. Storybook provides a preview implementation of icon().
      props:
        type: object
        required:
          - name
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
        additionalProperties: false
      slots: {}
  - id: bb_theme:stat-tile
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.component.yml
    hash: 41f01834bc53fd82e58cc8afb55e20ba6b4d8996803d2786ab937bd1c616a4b9
    contract:
      component: stat-tile
      group: Data Display
      description: 'One figure, named and attributed: a value, what it counts, and the source it is read from. The source is a required prop rather than an optional footnote because BB-333 D11 makes every figure on a dashboard name the entity and field behind it — a number whose provenance is invisible is a number nobody can check, and one of the five figures these dashboards want has no source at all yet, which only shows if every tile is asked the question. The tile knows no scope and no screen: it never resolves a query, never formats a count and never decides which window it is showing, so the same component carries a per-state count, a 24-hour total and a per-person capacity figure without a branch.'
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
          comparison:
            type: object
            title: Comparison
            description: The same figure for the comparison period, all strings preformatted by the caller (FigureRenderer::tiles()); the tile does no arithmetic. direction picks the arrow; the delta text always names the change, so direction is never colour-only.
            properties:
              value:
                type: string
                title: Previous value
              label:
                type: string
                title: Comparison label
                description: Already prefixed, e.g. "vs. Q3 2026".
              delta:
                type: string
                title: Change
                description: e.g. "+14 %", "-9 %", "0 %", "—".
              direction:
                type: string
                enum:
                  - up
                  - down
                  - flat
                title: Direction
            required:
              - value
              - label
              - delta
              - direction
        required:
          - value
          - label
          - source
        additionalProperties: false
      slots: {}
  - id: bb_theme:stat-breakdown
    source: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.component.yml
    hash: 5556bb28775bd02859977b0d8080c8c29fe2fe06b39770042c9c976ae190466b
    contract:
      component: stat-breakdown
      group: Data Display
      description: 'A figure split into entries - per project, per person, per whatever axis the figure was configured with - each row carrying its own trailing totals. It answers where a single total came from, for a figure whose one number hides a distribution. It emits no table markup of its own: it composes the existing table component, which is the only template in this theme permitted to render a table row.'
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
mappings: []
samples: []
scenes:
  - path: sections/component-demos/component-demos.section.scenes.yml
    file:
      id: component-demos
      title: Component Demos
      description: 'Standalone demonstrations of generic components that are not full screens and not chrome — a component is delivered only if a Designbook scene reaches it (WORKFLOW.md), and a story alone is not a scene. This file is deliberately outside design-system.scenes.yml (every scene of which fills content with the $content placeholder, `layout-components.sh` check A4) and outside the four section files (every scene of which opens with its section''s chrome scene, check A3). A component demonstrated here carries neither constraint: it is rendered directly, with no chrome and no canvas, because it is neither a screen nor part of the shell.'
      status: planned
      group: Designbook/Sections/Component Demos
      scenes:
        - name: segmented control
          group: Action
          docs: |-
            A standalone demonstration of bb_theme:segmented_control (BB-490), not a screen and not the shell — this scene exists only to reach the component itself. It renders the component in isolation with three positions and the middle one active, in the same order and with the same URL tokens BbClosedRows::buildExposedForm() renders onto the six operator listings' closed-rows filter (open → only → all).

            Generic by construction. The component knows label and items — nothing about tickets, runs, conductors or the word "closed" — so this scene's sample labels (Open / Closed / All) are one caller's choice of words, not a fact the component encodes.

            Not a reuse of tabs. tabs is bound to page_header's tabs slot and switches the subject of an entity page; this component filters the list it sits beside and is never placed in that slot. Two components, two meanings, one aria-current contract each.
          items:
            - component: bb_theme:segmented_control
              props:
                label: Closed rows
                items:
                  - label: Open
                    url: '?closed=open'
                    active: false
                  - label: Closed
                    url: '?closed=only'
                    active: true
                  - label: All
                    url: '?closed=all'
                    active: false
        - name: model comparison
          group: Data Display
          docs: A standalone sample-data demonstration of bb_theme:stat-comparison. Time is the shared X axis and numeric value the shared Y axis; Model A and Model B are distinct encodings on that one plot. The values are illustrative, not live tenant measurements.
          items:
            - component: bb_theme:stat-comparison
              props:
                chart:
                  state: ready
                  label: Model comparison
                  value_label: Value
                  labels:
                    - '2026-01-01'
                    - '2026-01-02'
                    - '2026-01-04'
                  series:
                    - key: a
                      style: a
                      label: Model A
                      latest_value: '15'
                      values:
                        - x: '2026-01-01'
                          'y': 10
                        - x: '2026-01-02'
                          'y': 20
                        - x: '2026-01-04'
                          'y': 15
                    - key: b
                      style: b
                      label: Model B
                      latest_value: '20'
                      values:
                        - x: '2026-01-01'
                          'y': 30
                        - x: '2026-01-02'
                          'y': 10
                        - x: '2026-01-04'
                          'y': 20
                  rows:
                    - date: '2026-01-01'
                      values:
                        - '10'
                        - '30'
                    - date: '2026-01-02'
                      values:
                        - '20'
                        - '10'
                    - date: '2026-01-04'
                      values:
                        - '15'
                        - '20'
        - name: six series
          group: Data Display
          docs: A standalone sample-data demonstration of bb_theme:stat-comparison with six series on shared axes. Each series uses a distinct style (a through f) so colour, dash and marker can be told apart. The values are illustrative, not live tenant measurements.
          items:
            - component: bb_theme:stat-comparison
              props:
                chart:
                  state: ready
                  label: Six series
                  value_label: Value
                  labels:
                    - '2026-01-01'
                    - '2026-01-02'
                    - '2026-01-04'
                  series:
                    - key: a
                      style: a
                      label: Opus
                      latest_value: '25'
                      values:
                        - x: '2026-01-01'
                          'y': 30
                        - x: '2026-01-02'
                          'y': 20
                        - x: '2026-01-04'
                          'y': 25
                    - key: b
                      style: b
                      label: Grok
                      latest_value: '15'
                      values:
                        - x: '2026-01-01'
                          'y': 24
                        - x: '2026-01-02'
                          'y': 28
                        - x: '2026-01-04'
                          'y': 15
                    - key: c
                      style: c
                      label: Sol
                      latest_value: '22'
                      values:
                        - x: '2026-01-01'
                          'y': 18
                        - x: '2026-01-02'
                          'y': 10
                        - x: '2026-01-04'
                          'y': 22
                    - key: d
                      style: d
                      label: Astra
                      latest_value: '8'
                      values:
                        - x: '2026-01-01'
                          'y': 12
                        - x: '2026-01-02'
                          'y': 16
                        - x: '2026-01-04'
                          'y': 8
                    - key: e
                      style: e
                      label: Luna
                      latest_value: '12'
                      values:
                        - x: '2026-01-01'
                          'y': 6
                        - x: '2026-01-02'
                          'y': 8
                        - x: '2026-01-04'
                          'y': 12
                    - key: f
                      style: f
                      label: Other
                      latest_value: '5'
                      values:
                        - x: '2026-01-01'
                          'y': 3
                        - x: '2026-01-02'
                          'y': 4
                        - x: '2026-01-04'
                          'y': 5
                  rows:
                    - date: '2026-01-01'
                      values:
                        - '30'
                        - '24'
                        - '18'
                        - '12'
                        - '6'
                        - '3'
                    - date: '2026-01-02'
                      values:
                        - '20'
                        - '28'
                        - '10'
                        - '16'
                        - '8'
                        - '4'
                    - date: '2026-01-04'
                      values:
                        - '25'
                        - '15'
                        - '22'
                        - '8'
                        - '12'
                        - '5'
        - name: new vs done
          group: Data Display
          docs: 'A standalone sample-data demonstration of bb_theme:flow-chart: tickets created (new) and closed (done) per day of a month, the area between them tinted by which one is larger. Day 20 is still running, so the last interval is dashed and its points are hollow; day 1 is cut by the period start and its points are hollow too. The values are illustrative, not live tenant measurements.'
          items:
            - component: bb_theme:flow-chart
              props:
                chart:
                  state: ready
                  label: New vs. done
                  caption: Per day, UTC · 20 Oct is still running
                  ratio: '0.96'
                  ratio_label: 'done : new'
                  totals:
                    new: '219'
                    done: '211'
                  open_at: 13:42 UTC
                  sections:
                    - label: '1'
                      new: 9
                      done: 10
                      open: 48
                      running: false
                      cut: true
                    - label: '2'
                      new: 12
                      done: 11
                      open: 49
                      running: false
                      cut: false
                    - label: '3'
                      new: 14
                      done: 12
                      open: 51
                      running: false
                      cut: false
                    - label: '4'
                      new: 11
                      done: 12
                      open: 50
                      running: false
                      cut: false
                    - label: '5'
                      new: 13
                      done: 13
                      open: 50
                      running: false
                      cut: false
                    - label: '6'
                      new: 6
                      done: 5
                      open: 51
                      running: false
                      cut: false
                    - label: '7'
                      new: 4
                      done: 3
                      open: 52
                      running: false
                      cut: false
                    - label: '8'
                      new: 22
                      done: 10
                      open: 64
                      running: false
                      cut: false
                    - label: '9'
                      new: 24
                      done: 11
                      open: 77
                      running: false
                      cut: false
                    - label: '10'
                      new: 19
                      done: 12
                      open: 84
                      running: false
                      cut: false
                    - label: '11'
                      new: 11
                      done: 12
                      open: 83
                      running: false
                      cut: false
                    - label: '12'
                      new: 14
                      done: 13
                      open: 84
                      running: false
                      cut: false
                    - label: '13'
                      new: 5
                      done: 4
                      open: 85
                      running: false
                      cut: false
                    - label: '14'
                      new: 3
                      done: 2
                      open: 86
                      running: false
                      cut: false
                    - label: '15'
                      new: 8
                      done: 19
                      open: 75
                      running: false
                      cut: false
                    - label: '16'
                      new: 9
                      done: 21
                      open: 63
                      running: false
                      cut: false
                    - label: '17'
                      new: 10
                      done: 18
                      open: 55
                      running: false
                      cut: false
                    - label: '18'
                      new: 12
                      done: 11
                      open: 56
                      running: false
                      cut: false
                    - label: '19'
                      new: 13
                      done: 12
                      open: 57
                      running: false
                      cut: false
                    - label: '20'
                      new: 8
                      done: 4
                      open: 61
                      running: true
                      cut: false
        - name: autosave toast
          group: Data Display
          docs: 'A standalone demonstration of bb_theme:toast, the fixed bottom-right confirmation for a short status such as `Saved`. It is one element with no children, so a script can rewrite its text, role and hidden attribute in place. No product screen renders it today: the Settings forms save on an explicit Save and confirm with Drupal''s status message. With an empty message it renders hidden.'
          items:
            - component: bb_theme:toast
              props:
                message: Saved
        - name: copied overlay
          group: Data Display
          docs: A standalone demonstration of bb_theme:copied, the absolutely positioned copy confirmation rendered as an opaque button, just below the Copy control. The parent supplies `relative`; this scene names the overlay itself so a story of setup_command is not the only reach. Empty message renders hidden. Distinguishes from toast, which is viewport-fixed.
          items:
            - component: bb_theme:copied
              props:
                message: Copied
        - name: setup paths
          group: Action
          docs: A standalone demonstration of bb_theme:setup_paths, the generic two-position panel switcher. The wrapper owns Alpine `selected` state and the Agent segmented filter; the two panels switch in place by position. A story of setup_command or segmented_control is not this composition.
          items:
            - component: bb_theme:setup_paths
              props:
                selected: claude
                filter_label: Agent
                items:
                  - label: Claude Code
                    value: claude
                  - label: Codex
                    value: codex
              slots:
                intro:
                  - component: bb_theme:text
                    props:
                      text: 'Install the bakers.build plugin first:'
                      size: caption
                      tone: light
                panel_a:
                  - component: bb_theme:setup_command
                    props:
                      command: /plugin install bakers@bakers
                      label: Copy the plugin install command
                panel_b:
                  - component: bb_theme:setup_command
                    props:
                      command: codex plugin add bakers@bakers
                      label: Copy the Codex plugin install command
                after:
                  - component: bb_theme:setup_command
                    props:
                      command: Use `bakers:init` to guide me through installing and setting up bakers.build.
                      label: Copy the skill wizard prompt
        - name: inline add row
          group: Layout
          docs: 'A standalone demonstration of bb_theme:zone with `direction: fill`: the member add/invite control of the workspace and team Members tabs (GroupMembersForm). The field takes the remaining width and the submit keeps its own width on one line, aligned to the bottom edge so it lines up with the input rather than with the label.'
          items:
            - component: bb_theme:zone
              props:
                inset: none
                direction: fill
                description: Only people who already belong to this workspace can join the team.
              slots:
                heading: Add a member
                content:
                  - component: bb_theme:zone
                    props:
                      inset: none
                      gap: none
                    slots:
                      content:
                        - component: bb_theme:form_label
                          props:
                            for: edit-account
                          slots:
                            title: Member
                        - component: bb_theme:form_input
                          props:
                            name: account
                            id: edit-account
                            value: ''
                            placeholder: Search by name
                  - component: bb_theme:button
                    props:
                      variant: primary
                      type: submit
                      label: Add member
        - name: ticket-inspector (billing)
          group: Data Display
          docs: |-
            THE BILLING ROWS OF THE TICKET INSPECTOR (BB-666), in four states, as a demonstration: the rows live in the inspector of the ticket screen, rendered by the `bb_track_ticket_billing` source. Billing names the account recorded time on this ticket is booked to; Source says where it comes from: `linked` (this ticket links it), `from <identifier>` (the nearest ancestor that links one) or `project default`. Source is its own row because beside the picker the narrow rail would wrap it.

            AN EDITOR PICKS, A VIEWER READS. A project editor gets a picker of the project's linkable accounts — active and not the default — plus Inherit, which removes only this ticket's link, and saves with Save billing account. Everyone else who can view the ticket reads the same rows as text. The default is never offered: it is what Inherit falls back to.
          items:
            - component: bb_theme:zone
              props:
                gap: lg
                columns: 2
                description: Editors pick an account or Inherit; viewers read the same rows without a picker
              slots:
                heading: Billing rows of the ticket inspector
                content:
                  - component: bb_theme:inspector
                    slots:
                      rows:
                        - component: bb_theme:list
                          props:
                            layout: plain
                            items:
                              - cells:
                                  label:
                                    kind: text
                                    value: Labels
                                    emphasis: faint
                                  value:
                                    kind: text
                                    value: backend, ui
                              - cells:
                                  label:
                                    kind: text
                                    value: Billing
                                    emphasis: faint
                                  value:
                                    kind: picker
                                    label: Billing account
                                    picker_id: meta-billing-7
                                    multiple: false
                                    clearable: true
                                    clear_label: Inherit
                                    open: false
                                    value_labels:
                                      - Kunde X maintenance
                                    options:
                                      - value: '7'
                                        label: Kunde X maintenance
                                        description: Time & Material
                                        selected: true
                                      - value: '9'
                                        label: Relaunch fixed price
                                        description: Fixed Price
                                        selected: false
                              - cells:
                                  label:
                                    kind: text
                                    value: Source
                                    emphasis: faint
                                  value:
                                    kind: badge
                                    label: linked
                                    tone: neutral
                  - component: bb_theme:inspector
                    slots:
                      rows:
                        - component: bb_theme:list
                          props:
                            layout: plain
                            items:
                              - cells:
                                  label:
                                    kind: text
                                    value: Labels
                                    emphasis: faint
                                  value:
                                    kind: text
                                    value: backend, ui
                              - cells:
                                  label:
                                    kind: text
                                    value: Billing
                                    emphasis: faint
                                  value:
                                    kind: picker
                                    label: Billing account
                                    picker_id: meta-billing-inherit
                                    multiple: false
                                    clearable: true
                                    clear_label: Inherit
                                    open: false
                                    value_labels:
                                      - Relaunch fixed price
                                    options:
                                      - value: '7'
                                        label: Kunde X maintenance
                                        description: Time & Material
                                        selected: false
                                      - value: '9'
                                        label: Relaunch fixed price
                                        description: Fixed Price
                                        selected: false
                              - cells:
                                  label:
                                    kind: text
                                    value: Source
                                    emphasis: faint
                                  value:
                                    kind: badge
                                    label: from BB-100
                                    tone: neutral
                  - component: bb_theme:inspector
                    slots:
                      rows:
                        - component: bb_theme:list
                          props:
                            layout: plain
                            items:
                              - cells:
                                  label:
                                    kind: text
                                    value: Labels
                                    emphasis: faint
                                  value:
                                    kind: text
                                    value: backend, ui
                              - cells:
                                  label:
                                    kind: text
                                    value: Billing
                                    emphasis: faint
                                  value:
                                    kind: picker
                                    label: Billing account
                                    picker_id: meta-billing-inherit
                                    multiple: false
                                    clearable: true
                                    clear_label: Inherit
                                    open: false
                                    value_labels:
                                      - bakers.build Platform internal
                                    options:
                                      - value: '7'
                                        label: Kunde X maintenance
                                        description: Time & Material
                                        selected: false
                                      - value: '9'
                                        label: Relaunch fixed price
                                        description: Fixed Price
                                        selected: false
                              - cells:
                                  label:
                                    kind: text
                                    value: Source
                                    emphasis: faint
                                  value:
                                    kind: badge
                                    label: project default
                                    tone: neutral
                  - component: bb_theme:inspector
                    slots:
                      rows:
                        - component: bb_theme:list
                          props:
                            layout: plain
                            items:
                              - cells:
                                  label:
                                    kind: text
                                    value: Labels
                                    emphasis: faint
                                  value:
                                    kind: text
                                    value: backend, ui
                              - cells:
                                  label:
                                    kind: text
                                    value: Billing
                                    emphasis: faint
                                  value:
                                    kind: text
                                    value: bakers.build Platform internal
                              - cells:
                                  label:
                                    kind: text
                                    value: Source
                                    emphasis: faint
                                  value:
                                    kind: badge
                                    label: project default
                                    tone: neutral
        - name: markdown textarea
          group: Form
          docs: 'A standalone demonstration of bb_theme:form_rich_text, the Markdown authoring control: a formatting toolbar over a plain textarea. Every bb_rich body field renders through it, through the bb_markdown form element or the bb_markdown text editor; the stored value stays the Markdown source the textarea holds. form_textarea stays the plain box.'
          items:
            - component: bb_theme:zone
              props:
                inset: none
                direction: fill
                description: 'The authoring control every bb_rich body field renders through: toolbar over a plain textarea; the value stays Markdown source.'
              slots:
                heading: Markdown textarea
                content:
                  - component: bb_theme:form_label
                    props:
                      for: edit-body-value
                    slots:
                      title: Body
                  - component: bb_theme:form_rich_text
                    props:
                      id: edit-body-value
                      name: body[0][value]
                      rows: 6
                      value: |-
                        ## Steps to reproduce

                        - Create a ticket without an assignee
                        - Open `bakers ui` and export

                        The export **stops** at the first such ticket.
        - name: period range
          group: Data Display
          items:
            - component: bb_theme:zone
              props:
                inset: none
                direction: fill
                description: The statistics period switch above two figures that carry their comparison with the previous quarter.
              slots:
                heading: Period range
                content:
                  - component: bb_theme:period-range
                    props:
                      kind: quarter
                      date: '2026-10-24'
                      today: '2026-10-24'
                  - component: bb_theme:zone
                    props:
                      columns: 2
                      gap: md
                    slots:
                      content:
                        - component: bb_theme:stat-tile
                          props:
                            value: '42'
                            label: Closed tickets
                            source: bb_measurement.closed_tickets
                            window: Q4 2026
                            comparison:
                              value: '37'
                              label: vs. Q3 2026
                              delta: +14 %
                              direction: up
                        - component: bb_theme:stat-tile
                          props:
                            value: '3.1'
                            label: Runs per ticket
                            source: bb_measurement.runs_per_ticket
                            window: Q4 2026
                            comparison:
                              value: '3.6'
                              label: vs. Q3 2026
                              delta: '-14 %'
                              direction: down
    hash: efa7939315624469c15cbf9b4c343dbc66a229f5d68e3662e4a58875c663efdc
data_model: {}
namespace: bb_theme
data_dir: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/designbook
```

## Context
### task:write-component (task, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/tasks/write-component.md)
```
---
title: Write Component {{ component.component }}
domain: [components]
trigger:
  steps:
    - write-component
filter:
  frameworks.component: sdc
params:
  type: object
  required:
    - component
  properties:
    component:
      $ref: designbook/design/schemas.yml#/Component
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      workflow: debo-design-tokens
      type: object
    region_properties:
      $ref: designbook/design/schemas.yml#/RegionProperties
result:
  type: object
  required:
    - component-yml
    - component-twig
    - component-story
  properties:
    component-yml:
      path: ${DESIGNBOOK_HOME}/components/{{ component.component }}/{{ component.component }}.component.yml
      $ref: designbook-drupal/components/schemas.yml#/SdcComponent
    component-twig:
      path: ${DESIGNBOOK_HOME}/components/{{ component.component }}/{{ component.component }}.twig
      $ref: designbook-drupal/components/schemas.yml#/SdcTemplate
    component-story:
      path: ${DESIGNBOOK_HOME}/components/{{ component.component }}/{{ component.component }}.default.story.yml
      $ref: designbook-drupal/components/schemas.yml#/SdcStory
    component-js:
      path: ${DESIGNBOOK_HOME}/components/{{ component.component }}/{{ component.component }}.js
---

# Write Component

Produce the complete artifacts for the selected component and requested delta. `component.props` and `component.slots` are the typed interface written into those artifacts. Existing content is the baseline for a change; blueprint defaults apply to new structure only.

## Result: component-yml

Retain the component identity, unrelated variants, props, slots, dependencies and library declarations. A requested prop or slot rename is complete only when every affected consumer declared by intake uses the new contract.

## Result: component-twig

Preserve unrelated rendering and interaction behavior while implementing the selected delta.

## Result: component-story

Preserve the default story identity and unrelated examples. Every affected non-default story has its exact path and the shared story schema declared as an output in the saved definition, using the variant-story building block where appropriate. Preserve unaffected story files.

## Result: component-js

Include scripting when the selected outcome requires a change or new behavior. Retain existing unrelated handlers and library wiring. Existing scripts that need no edit remain preserved inputs.

Completion: all declared artifacts express the requested delta and preserve the intake inventory; all required consumer edits have declared producing tasks. Build and browser verification are separate planned tasks for every declared variant and affected consumer.

```

### task:create-variant-story (task, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/tasks/create-variant-story.md)
```
---
name: designbook-drupal:components:create-variant-story
title: Create Variant Story {{ component.component }}.{{ variant.id }}
trigger:
  steps:
    - write-component
filter:
  frameworks.component: sdc
priority: 10
params:
  type: object
  required:
    - component
    - variant
  properties:
    component:
      $ref: designbook/design/schemas.yml#/Component
    variant:
      $ref: designbook/design/schemas.yml#/Variant
result:
  type: object
  required:
    - variant-story
  properties:
    variant-story:
      path: >-
        ${DESIGNBOOK_HOME}/components/{{ component.component }}/{{ component.component }}.{{ variant.id
        }}.story.yml
      $ref: designbook-drupal/components/schemas.yml#/SdcStory
---


```

### task:refresh-components (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/refresh-components.md)
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

### task:write-scene (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/scenes/tasks/write-scene.md)
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

### task:validate (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/validate.md)
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

### ctx:variant-transport (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/variant-transport.md)
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

### ctx:typed-component-boundary (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/typed-component-boundary.md)
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

### ctx:story-image-node-renderer (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/story-image-node-renderer.md)
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

### ctx:region-properties (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/region-properties.md)
```
---
name: designbook:design:region-properties
trigger:
  steps: [write-component]
---

# Region Properties

Implement the planner's explicit target structure and token mappings. Each
responsive change, asset choice and interaction behavior belongs in the saved
work order. Source measurements from the bound observation package support
verification of those decisions; they are not an invitation for the worker to
redesign the target.

Visual properties use classes and declared design tokens according to the
selected integration. Required token changes are explicit predecessors. A missing
target structure, token mapping or responsive decision blocks the step.

```

### ctx:referenced-content-view-mode (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/referenced-content-view-mode.md)
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

### ctx:presenter-composition (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/presenter-composition.md)
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

### ctx:markup-derivation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/markup-derivation.md)
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

### ctx:local-image-assets (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/local-image-assets.md)
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

### ctx:icon-sprite (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/icon-sprite.md)
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

### ctx:component-contract-index (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/component-contract-index.md)
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

### ctx:token-backed-utilities (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/token-backed-utilities.md)
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

### ctx:region-properties-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/region-properties.md)
```
---
trigger:
  steps: [write-component]
filter:
  frameworks.css: tailwind
---

# Region Properties — Tailwind output

Apply captured-style derivations only when intake supplied `region_properties`; text-only changes use the saved criteria and preserved structure.

Materialize `region_properties.style` as inline Tailwind utility classes on the
element, following `component-styling.md`. Utilities are the styling surface —
do not emit component CSS rules or `@apply` blocks in `${DESIGNBOOK_CSS_APP}`
for region styling.

- Map captured values to token-backed utilities: `bg-<token>`, `text-<token>`,
  `py-[var(--layout-spacing-…)]`, `max-w-[var(--container-…)]`. Reuse design
  tokens; add a token before falling back to an arbitrary value.
- Arbitrary values (`bg-[#…]`, `min-h-[60px]`) are a last resort, only when the
  design reference needs a value with no matching token.
- Dimensional anchors derived from `bbox` (e.g. `min-h-[…]`) are allowed only
  when no spacing/sizing token fits.
- The sole case for an external rule is a complex effect Tailwind cannot express
  (e.g. a multi-stop gradient) — and then per `component-styling.md`, not a
  per-region `@apply` block in the shared app CSS.

## Responsive utilities (mobile-first)

Map the mobile-first `region_properties` to Tailwind's mobile-first utilities:

- `style` → unprefixed base utilities.
- `overrides[<bp>].style` → `<bp>:`-prefixed utilities for only the changed
  properties (e.g. base `flex-col` + `overrides.xl.layout=flex-row` → `flex-col xl:flex-row`).
- `overrides[<bp>].hidden === true` → `<bp>:hidden`; `hidden === false` on a
  node hidden at base → `hidden <bp>:flex` (or the appropriate display).

```

### ctx:font-availability (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/font-availability.md)
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

### ctx:component-styling (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/component-styling.md)
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

### ctx:component-source (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/component-source.md)
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

### ctx:navigation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/shell/rules/navigation.md)
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

### ctx:slot-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/slot-rendering.md)
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

### ctx:sdc-components (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/sdc-components.md)
````
---
trigger:
  steps: [write-component, refresh-components, validate]
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

### ctx:region-properties-3 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/region-properties.md)
```
---
trigger:
  steps: [write-component]
filter:
  frameworks.component: sdc
---

# Region Properties — SDC / Twig output

Apply captured-style derivations only when intake supplied `region_properties`; text-only changes use the saved criteria and preserved structure.

How to materialize `region_properties` into SDC Twig templates. See the
core `designbook:design:region-properties` rule for the integration-
independent constraints (no inline styles, tokens first, drop noise).

- Apply classes via `{{ attributes.addClass([...]) }}` on the root element.
  `attributes` is the only attribute interface in SDC.
- Slot content goes through `{% block <slot> %}{{ <slot> }}{% endblock %}`.
- If the matched root carries a vendor / framework custom-element tag
  (e.g. `app-site-header` from an Angular source), translate to the
  semantically correct HTML tag (`<header>`, `<footer>`, `<nav>`) on the
  generated component.

```

### ctx:reference-field-semantics (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/reference-field-semantics.md)
```
---
trigger:
  steps: [write-component]
filter:
  frameworks.component: sdc
---

# Reference Field Semantics

SDC templates MUST render Drupal field props according to the visual treatment observed in
the design reference, not according to the raw field name or storage value.

## Raw Values Are Not UI

Do not render raw field storage values when the reference shows a richer treatment:

- icon-ish values render as icon treatments, not visible text labels.
- link fields render as the observed link or CTA treatment, not debug text.
- auth/user action fields render only when the reference shows them in the captured state.
- HTML-like field strings are parsed or normalized into structured props before rendering;
  templates must not depend on stringifying raw markup.

## Interactive Treatment Wins

When multiple fields could become an action, choose the field whose label and placement match
the reference-visible interactive element. Do not render every link/button-ish field just
because it exists in the entity record.

Examples:

- A card with one visible filled CTA gets one rendered action, even if the entity also has
  anonymous/authenticated variants.
- A reference that shows a text link gets a text-link treatment, not a filled button.
- A reference that shows a filled CTA gets button-like markup, not an underlined body link.

## Story Data Contract

Default stories must use the same prop shapes that entity mappings produce:

- links are arrays of objects with `title`/`url` (or equivalent label/url keys).
- buttons/actions are objects with `title`/`url`.
- icon props carry the icon identifier only; the Twig template is responsible for rendering
  the visual icon treatment.

If the generated story shows raw icon names, placeholder `Link` labels, duplicate action
buttons, or auth-only actions that are absent from the reference state, the component is not
complete.

## Field-Rendered Content Maps to a Slot, Not a Scalar Prop

A Drupal field whose formatter output is markup/content — rich text, body, and single-value
`title` and `link`/CTA — maps to a **slot** (a `field_block` in its slot region), never to a
scalar prop. Rationale: a scalar prop can carry only an escaped string, so a field piped through
a prop loses its formatter markup (link wrappers, rich-text structure, cache metadata); a slot /
`field_block` renders the field through its formatter and preserves that output.

Reserve **props** for values that are not field-rendered content:

- non-field control values — a variant key, a sprite/icon id, a boolean toggle;
- attribute-only values — an image `src`/`alt`, or a link `url` fed into a nested component's
  attribute prop (the `url` is an attribute, not the rendered link markup).

This holds regardless of cardinality: a single-value `title` or `link` still renders through a
formatter, so it is a slot, not a prop.

## Field Cardinality Boundary

Drupal multi-value fields keep a field-level rendering boundary. If a component
receives a multi-value field, render it through a repeated field treatment,
field-level component, slot, or Twig loop that preserves the full item list.
Do not silently render only the first value as if it were a single scalar.

Single-value fields may expose inner values directly as component **props** only when the value
is a genuinely atomic, non-markup control or attribute value — one icon identifier, one boolean
toggle, or one image `src`/`alt`. A single-value field whose formatter renders markup/content —
including one `title` or one `link`/CTA — still maps to a **slot** (`field_block`), not a scalar
prop: see *Field-Rendered Content Maps to a Slot, Not a Scalar Prop* above.

Entity reference fields follow the same rule. A multi-value reference slot must
render every resolved child entity in the field list. The parent component must
not reach through the reference and render child fields such as title, icon, or
link itself; the referenced bundle's component and mapping own that markup.
Every resolved reference is rendered with the referenced bundle's own view mode;
the parent component only provides the slot where that rendered output appears.

```

### ctx:layout-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/layout-constraints.md)
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

### ctx:js-behavior (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/js-behavior.md)
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

### ctx:static-assets (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/blueprints/static-assets.md)
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

### ctx:pager (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/pager.md)
```
---
type: component
name: pager
priority: 10
embeds: []
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:page (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/page.md)
```
---
type: component
name: page
priority: 10
trigger:
  domain: components.shell
filter:
  frameworks.component: sdc
---

# Blueprint: Page

Top-level page wrapper that composes header, content, and footer regions.

**Use for:** The outermost page shell that arranges the three main regions vertically.

## Slots
- header — site header region (required)
- content — main content area (required)
- footer — site footer region (required)

```

### ctx:navigation-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/navigation.md)
````
---
type: component
name: navigation
priority: 10
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:logo (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/logo.md)
```
---
type: component
name: logo
priority: 10
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:link (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/link.md)
```
---
type: component
name: link
priority: 10
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:js-behavior-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/js-behavior.md)
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

### ctx:icon (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/icon.md)
```
---
type: component
name: icon
priority: 10
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:header (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/header.md)
```
---
type: component
name: header
priority: 10
trigger:
  domain: components.shell
filter:
  frameworks.component: sdc
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

### ctx:form (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/form.md)
```
---
type: component
name: form
priority: 10
embeds: []
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:footer (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/footer.md)
```
---
type: component
name: footer
priority: 10
trigger:
  domain: components.shell
filter:
  frameworks.component: sdc
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

### ctx:component-template (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/component-template.md)
```
---
type: blueprint
name: component-template
trigger:
  steps: [write-component]
filter:
  frameworks.component: sdc
---

# Component Template

For new structure, use `component.design_hint.markup` as the starting Twig sketch when supplied, and the component-family blueprint otherwise. Translate its props and slots into the SDC schema; map `atoms_used` to component includes and library dependencies. Generate a default story exercising the declared slots and prop defaults. Use the configured component namespace for references.

Render child entities through the parent's slots, leaving their field rendering to their own mappings.

```

### ctx:button (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/button.md)
```
---
type: component
name: button
priority: 10
trigger:
  domain: components
filter:
  frameworks.component: sdc
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

### ctx:shell-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/shell-scene-constraints.md)
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

### ctx:screen-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/screen-scene-constraints.md)
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

### ctx:scenes-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/scenes-constraints.md)
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

### ctx:entity-reference-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/entity-reference-rendering.md)
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

### ctx:scenes-constraints-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/scenes-constraints.md)
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

### ctx:scenes-constraints-3 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/scenes/rules/scenes-constraints.md)
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

### ctx:playwright-validate (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/playwright-validate.md)
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

### Step: write-component
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:story-image-node-renderer, ctx:region-properties, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:markup-derivation, ctx:local-image-assets, ctx:icon-sprite, ctx:component-contract-index, ctx:token-backed-utilities, ctx:region-properties-2, ctx:font-availability, ctx:component-styling, ctx:component-source, ctx:navigation, ctx:slot-rendering, ctx:sdc-components, ctx:region-properties-3, ctx:reference-field-semantics, ctx:layout-constraints, ctx:js-behavior, ctx:static-assets, ctx:section, ctx:pager, ctx:page, ctx:navigation-2, ctx:logo, ctx:link, ctx:js-behavior-2, ctx:icon, ctx:header, ctx:grid, ctx:form, ctx:footer, ctx:container, ctx:component-template, ctx:button]

- [x] write-component — stat-tile

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: stat-tile
    group: Data Display
    description: 'One figure, named and attributed: a value, what it counts, and the source it is read from. The source is a required prop rather than an optional footnote because BB-333 D11 makes every figure on a dashboard name the entity and field behind it — a number whose provenance is invisible is a number nobody can check, and one of the five figures these dashboards want has no source at all yet, which only shows if every tile is asked the question. The tile knows no scope and no screen: it never resolves a query, never formats a count and never decides which window it is showing, so the same component carries a per-state count, a 24-hour total and a per-person capacity figure without a branch. The kpi size lays the same figure out as the Insights answer strip (Figma 84:226): label and info on top, value and unit, comparison chip and previous value, detail line; abbreviated values carry their exact value on hover and focus (Figma 90:1104).'
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
            - muted
          title: Tone
          description: 'Optional accent on the value. Never the only carrier of meaning: the label and the value say the same thing in text, so the tile stays readable in greyscale (BB-333 C2). `muted` greys the value for a figure withheld as a small sample (shown as —).'
        size:
          type: string
          enum:
            - default
            - compact
            - kpi
          title: Size
          description: '`default` is the dashboard tile. `compact` is the same figure at the density of an inspector row — smaller type and padding — for a count that sits beside a description rather than filling a dashboard band. `kpi` is the Insights answer-strip tile: the label with its info trigger on top, the value with its unit, the comparison chip with the previous value, and the detail line; the source moves into the info disclosure.'
          default: default
        comparison:
          type: object
          title: Comparison
          description: The same figure for the comparison period, all strings preformatted by the caller (FigureRenderer::tiles()); the tile does no arithmetic. direction picks the arrow; the delta text always names the change, so direction is never colour-only.
          properties:
            value:
              type: string
              title: Previous value
            label:
              type: string
              title: Comparison label
              description: Already prefixed, e.g. "vs. Q3 2026".
            delta:
              type: string
              title: Change
              description: e.g. "+14 %", "-9 %", "0 %", "—".
            direction:
              type: string
              enum:
                - up
                - down
                - flat
              title: Direction
          required:
            - value
            - label
            - delta
            - direction
        unit:
          type: string
          title: Unit
          description: What the value is counted in, set beside it in the kpi layout (`closed`, `tokens`, `of 5, job rating`).
        detail:
          type: string
          title: Detail
          description: One preformatted line under the comparison in the kpi layout, e.g. `236 created · backlog +22` or `n = 3 closed tickets · needs 5`.
        info:
          type: string
          title: Info
          description: What the figure counts, behind a focusable info trigger beside the label; shown on hover and on keyboard focus, and the trigger's accessible description.
        exact:
          type: string
          title: Exact value
          description: The unabbreviated value and its calculation, e.g. `28,412,553,104 tokens — Sum of run tokens by run start, UTC`. Shown when the value is hovered or focused; the value becomes focusable when set.
      required:
        - value
        - label
        - source
      additionalProperties: false
    slots: {}
    variants: []
  ```

  #### Contract
  ```yaml
  outputs:
    component-yml:
      required: true
      schema:
        $ref: '#/definitions/SdcComponent'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.js
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — stat-tile kpi

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: stat-tile
    group: Data Display
    props:
      type: object
      properties: {}
      required: []
      additionalProperties: false
    slots: {}
  variant:
    id: kpi
    title: KPI
    description: 'component bb_theme:stat-tile, name "KPI", props value "214", unit "closed", label "Throughput", size "kpi", source "bb_measurement.closed_tickets", info "Tickets closed in the period, by closed date (UTC).", detail "236 created · backlog +22", comparison {value "198", label "vs", delta "+8 %", direction "up"}. Accessible name "214 Throughput, vs: 198, +8 %".'
  ```

  #### Contract
  ```yaml
  outputs:
    variant-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.kpi.story.yml
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — stat-tile kpi_small_sample

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: stat-tile
    group: Data Display
    props:
      type: object
      properties: {}
      required: []
      additionalProperties: false
    slots: {}
  variant:
    id: kpi_small_sample
    title: KPI small sample
    description: component bb_theme:stat-tile, name "KPI small sample", props value "—", tone "muted", unit "closed tickets", label "Runs per ticket", size "kpi", source "bb_measurement.runs_per_ticket", info "Runs started in the period per ticket closed in it.", detail "n = 3 closed tickets · needs 5". No comparison.
  ```

  #### Contract
  ```yaml
  outputs:
    variant-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.kpi_small_sample.story.yml
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — stat-tile kpi_exact

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: stat-tile
    group: Data Display
    props:
      type: object
      properties: {}
      required: []
      additionalProperties: false
    slots: {}
  variant:
    id: kpi_exact
    title: KPI exact value
    description: component bb_theme:stat-tile, name "KPI exact value", props value "28.4 B", unit "tokens", label "AI usage", size "kpi", source "bb_measurement.run_tokens", info "Run tokens by run start (UTC). Not a billable quantity.", exact "28,412,553,104 tokens — Sum of run tokens by run start, UTC", detail "≈ 133 M per closed ticket", comparison {value "31.2 B", label "vs", delta "-9 %", direction "down"}.
  ```

  #### Contract
  ```yaml
  outputs:
    variant-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-tile/stat-tile.kpi_exact.story.yml
  ```

  #### Results
  <!-- done -->

- [x] write-component — stat-breakdown

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: stat-breakdown
    group: Data Display
    description: 'A figure split into entries - per project, per person, per whatever axis the figure was configured with - each row carrying its own trailing totals. It answers where a single total came from, for a figure whose one number hides a distribution. It emits no table markup of its own: it composes the existing table component, which is the only template in this theme permitted to render a table row. The bars display shows the same entries as parts of one total, each with value, share label and a share bar, as the Insights AI-usage lists do.'
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
              value:
                type: string
                title: Value
                description: The row's preformatted figure in the bars display (`17.9 B`).
              share:
                type: number
                minimum: 0
                maximum: 100
                title: Share
                description: The row's share of the whole in percent, drawn as the bar length in the bars display.
              share_label:
                type: string
                title: Share label
                description: The preformatted share (`63 %`), so the bar is never the only carrier of the number.
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
        display:
          type: string
          enum:
            - table
            - bars
          default: table
          title: Display
          description: '`table` keeps the per-period columns. `bars` lists each entry with its value, its share label and a share bar (Figma 84:452), for a figure split into parts of one total; `columns` is then ignored.'
        caption:
          type: string
          title: Caption
          description: One line under the heading naming what is counted and over which period (`Tokens, 1 – 19 Oct. Not a billable quantity.`).
      required:
        - label
        - columns
        - entries
      additionalProperties: false
    slots: {}
    variants: []
  ```

  #### Contract
  ```yaml
  outputs:
    component-yml:
      required: true
      schema:
        $ref: '#/definitions/SdcComponent'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.js
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — stat-breakdown bars

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: stat-breakdown
    group: Data Display
    props:
      type: object
      properties: {}
      required: []
      additionalProperties: false
    slots: {}
  variant:
    id: bars
    title: Bars
    description: component bb_theme:stat-breakdown, name "Bars", props label "AI usage by model", caption "Tokens, 1 – 19 Oct. Not a billable quantity.", display "bars", columns [{key "tokens", label "Tokens"}], entries [{label "Opus 5.5", value "17.9 B", share 63, share_label "63 %", counts {tokens "17.9 B"}}, {label "Sonnet 5.5", value "8.7 B", share 31, share_label "31 %", counts {tokens "8.7 B"}}, {label "Haiku 5.5", value "1.4 B", share 5, share_label "5 %", counts {tokens "1.4 B"}}, {label "Unattributed", value "0.4 B", share 1, share_label "1 %", counts {tokens "0.4 B"}}], source "bb_measurement.run_tokens".
  ```

  #### Contract
  ```yaml
  outputs:
    variant-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/components/stat-breakdown/stat-breakdown.bars.story.yml
  ```

  #### Results
  <!-- done -->

### Step: refresh-components
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:component-contract-index, ctx:sdc-components]

- [x] refresh-components — stat-tile + stat-breakdown

  Instruction: task:refresh-components

  #### Params
  ```yaml
  command: pnpm exec storybook build
  cwd: web/themes/custom/bb_theme
  index_url: http://localhost:6006/index.json
  story_ids:
    - bb-theme-data-display-stat-tile--default
    - bb-theme-data-display-stat-tile--capacity
    - bb-theme-data-display-stat-tile--compact
    - bb-theme-data-display-stat-tile--comparison
    - bb-theme-data-display-stat-tile--flat
    - bb-theme-data-display-stat-tile--kpi
    - bb-theme-data-display-stat-tile--kpi-small-sample
    - bb-theme-data-display-stat-tile--kpi-exact
    - bb-theme-data-display-stat-breakdown--default
    - bb-theme-data-display-stat-breakdown--bars
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

### Step: write-scene
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:story-image-node-renderer, ctx:shell-scene-constraints, ctx:screen-scene-constraints, ctx:scenes-constraints, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:markup-derivation, ctx:local-image-assets, ctx:icon-sprite, ctx:entity-reference-rendering, ctx:component-contract-index, ctx:token-backed-utilities, ctx:scenes-constraints-2, ctx:font-availability, ctx:component-styling, ctx:component-source, ctx:navigation, ctx:scenes-constraints-3, ctx:slot-rendering, ctx:layout-constraints, ctx:js-behavior, ctx:static-assets, ctx:section, ctx:pager, ctx:page, ctx:navigation-2, ctx:logo, ctx:link, ctx:js-behavior-2, ctx:icon, ctx:header, ctx:grid, ctx:form, ctx:footer, ctx:container, ctx:button]

- [x] write-scene — insights overview

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/component-demos/component-demos.section.scenes.yml
  components_dir: web/themes/custom/bb_theme/components
  scene_name: insights overview
  scene_scope: standalone
  components:
    - id: bb_theme:zone
    - id: bb_theme:period-range
    - id: bb_theme:property_pill
    - id: bb_theme:table
    - id: bb_theme:collection-position
    - id: bb_theme:button
    - id: bb_theme:note
    - id: bb_theme:icon
    - id: bb_theme:stat-tile
      story_id: bb-theme-data-display-stat-tile--kpi
    - id: bb_theme:stat-breakdown
      story_id: bb-theme-data-display-stat-breakdown--bars
  items:
    - component: bb_theme:zone
      props:
        inset: lg
        direction: fill
        description: keytec · all projects, all teams
      slots:
        heading: Insights
        content:
          - component: bb_theme:zone
            props:
              inset: none
              direction: row
              gap: sm
            slots:
              content:
                - component: bb_theme:period-range
                  props:
                    kind: month
                    date: '2026-10-19'
                    today: '2026-10-19'
                - component: bb_theme:property_pill
                  props:
                    name: project
                    label: Project
                    value_label: All
                    picker_id: insights-project
                    multiple: true
                    searchable: true
                    values: []
                    options: []
                - component: bb_theme:property_pill
                  props:
                    name: team
                    label: Team
                    value_label: All
                    picker_id: insights-team
                    multiple: true
                    searchable: true
                    values: []
                    options: []
                - component: bb_theme:property_pill
                  props:
                    name: user
                    label: Person
                    value_label: All
                    picker_id: insights-user
                    multiple: true
                    searchable: true
                    values: []
                    options: []
          - component: bb_theme:zone
            props:
              inset: none
              columns: 4
              gap: md
            slots:
              content:
                - component: bb_theme:stat-tile
                  props:
                    value: '214'
                    unit: closed
                    label: Throughput
                    size: kpi
                    source: bb_measurement.closed_tickets
                    info: Tickets closed in the period, by closed date (UTC).
                    detail: 236 created · backlog +22
                    comparison:
                      value: '198'
                      label: vs
                      delta: +8 %
                      direction: up
                - component: bb_theme:stat-tile
                  props:
                    value: '4.9'
                    unit: closed tickets
                    label: Runs per ticket
                    size: kpi
                    source: bb_measurement.runs_per_ticket
                    info: Runs started in the period per ticket closed in it.
                    detail: 41 % needed > 3 runs
                    comparison:
                      value: '5.6'
                      label: vs
                      delta: '-0.7'
                      direction: down
                - component: bb_theme:stat-tile
                  props:
                    value: '4.1'
                    unit: of 5, job rating
                    label: Rating
                    size: kpi
                    source: bb_measurement.job_rating
                    info: Mean job rating of tickets closed in the period; unrated tickets are left out.
                    detail: 87 of 214 rated
                    comparison:
                      value: '3.9'
                      label: vs
                      delta: '+0.2'
                      direction: up
                - component: bb_theme:stat-tile
                  props:
                    value: 28.4 B
                    unit: tokens
                    label: AI usage
                    size: kpi
                    source: bb_measurement.run_tokens
                    info: Run tokens by run start (UTC). Not a billable quantity.
                    detail: ≈ 133 M per closed ticket
                    comparison:
                      value: 31.2 B
                      label: vs
                      delta: '-9 %'
                      direction: down
                    exact: 28,412,553,104 tokens — Sum of run tokens by run start, UTC
          - component: bb_theme:zone
            props:
              inset: none
              columns: 2
              gap: lg
            slots:
              content:
                - component: bb_theme:stat-breakdown
                  props:
                    label: AI usage by model
                    caption: Tokens, 1 – 19 Oct. Not a billable quantity.
                    display: bars
                    columns:
                      - key: tokens
                        label: Tokens
                    entries:
                      - label: Opus 5.5
                        value: 17.9 B
                        share: 63
                        share_label: 63 %
                        counts:
                          tokens: 17.9 B
                      - label: Sonnet 5.5
                        value: 8.7 B
                        share: 31
                        share_label: 31 %
                        counts:
                          tokens: 8.7 B
                      - label: Haiku 5.5
                        value: 1.4 B
                        share: 5
                        share_label: 5 %
                        counts:
                          tokens: 1.4 B
                      - label: Unattributed
                        value: 0.4 B
                        share: 1
                        share_label: 1 %
                        counts:
                          tokens: 0.4 B
                    source: bb_measurement.run_tokens
                - component: bb_theme:stat-breakdown
                  props:
                    label: By project
                    caption: Tokens, 1 – 19 Oct.
                    display: bars
                    columns:
                      - key: tokens
                        label: Tokens
                    entries:
                      - label: atlas
                        value: 19.6 B
                        share: 69
                        share_label: 69 %
                        counts:
                          tokens: 19.6 B
                      - label: pfiff
                        value: 4.1 B
                        share: 14
                        share_label: 14 %
                        counts:
                          tokens: 4.1 B
                      - label: dk-elvis-home
                        value: 2.6 B
                        share: 9
                        share_label: 9 %
                        counts:
                          tokens: 2.6 B
                      - label: cw-framework
                        value: 1.7 B
                        share: 6
                        share_label: 6 %
                        counts:
                          tokens: 1.7 B
                      - label: keytec-content
                        value: 0.4 B
                        share: 2
                        share_label: 2 %
                        counts:
                          tokens: 0.4 B
                    source: bb_measurement.run_tokens
          - component: bb_theme:zone
            props:
              inset: none
              direction: fill
              description: All projects of keytec, 1 – 19 Oct. Sort by any column.
            slots:
              heading: Projects
              content:
                - component: bb_theme:table
                  props:
                    columns:
                      - key: label
                        label: Project
                        sort: asc
                        url: '?sort[workspace_projects]=label&order[workspace_projects]=desc'
                        row_header: true
                      - key: closed
                        label: Closed
                        num: true
                        sort: none
                        url: '?sort[workspace_projects]=closed&order[workspace_projects]=desc'
                      - key: created
                        label: Created
                        num: true
                        sort: none
                        url: '?sort[workspace_projects]=created&order[workspace_projects]=desc'
                      - key: open
                        label: Open
                        num: true
                        sort: none
                        url: '?sort[workspace_projects]=open&order[workspace_projects]=desc'
                      - key: runs
                        label: Runs / ticket
                        num: true
                        sort: none
                        url: '?sort[workspace_projects]=runs&order[workspace_projects]=desc'
                      - key: rating
                        label: Rating
                        num: true
                        sort: none
                        url: '?sort[workspace_projects]=rating&order[workspace_projects]=desc'
                      - key: tokens
                        label: AI tokens
                        num: true
                        sort: none
                        url: '?sort[workspace_projects]=tokens&order[workspace_projects]=desc'
                    rows:
                      - cells:
                          label:
                            kind: text
                            value: cw-framework
                          closed:
                            kind: text
                            value: '19'
                          created:
                            kind: text
                            value: '21'
                          open:
                            kind: text
                            value: '4'
                          runs:
                            kind: text
                            value: '6.2'
                          rating:
                            kind: text
                            value: —
                            emphasis: faint
                          tokens:
                            kind: text
                            value: 1.7 B
                      - cells:
                          label:
                            kind: text
                            value: dk-elvis-home
                          closed:
                            kind: text
                            value: '22'
                          created:
                            kind: text
                            value: '27'
                          open:
                            kind: text
                            value: '7'
                          runs:
                            kind: text
                            value: '4.6'
                          rating:
                            kind: text
                            value: 4.0 · n 8
                          tokens:
                            kind: text
                            value: 2.6 B
                      - cells:
                          label:
                            kind: text
                            value: atlas
                          closed:
                            kind: text
                            value: '132'
                          created:
                            kind: text
                            value: '141'
                          open:
                            kind: text
                            value: '38'
                          runs:
                            kind: text
                            value: '5.3'
                          rating:
                            kind: text
                            value: 4.2 · n 61
                          tokens:
                            kind: text
                            value: 19.6 B
                      - cells:
                          label:
                            kind: text
                            value: keytec-content
                          closed:
                            kind: text
                            value: '7'
                          created:
                            kind: text
                            value: '8'
                          open:
                            kind: text
                            value: '1'
                          runs:
                            kind: text
                            value: '2.1'
                          rating:
                            kind: text
                            value: —
                            emphasis: faint
                          tokens:
                            kind: text
                            value: 0.4 B
                      - cells:
                          label:
                            kind: text
                            value: pfiff
                          closed:
                            kind: text
                            value: '34'
                          created:
                            kind: text
                            value: '39'
                          open:
                            kind: text
                            value: '11'
                          runs:
                            kind: text
                            value: '4.1'
                          rating:
                            kind: text
                            value: 3.9 · n 12
                          tokens:
                            kind: text
                            value: 4.1 B
                      - cells:
                          label:
                            kind: text
                            value: All projects
                            emphasis: strong
                          closed:
                            kind: text
                            value: '214'
                            emphasis: strong
                          created:
                            kind: text
                            value: '236'
                            emphasis: strong
                          open:
                            kind: text
                            value: '61'
                            emphasis: strong
                          runs:
                            kind: text
                            value: '4.9'
                            emphasis: strong
                          rating:
                            kind: text
                            value: 4.1 · n 87
                            emphasis: strong
                          tokens:
                            kind: text
                            value: 28.4 B
                            emphasis: strong
                - component: bb_theme:zone
                  props:
                    inset: none
                    direction: row
                    gap: sm
                    align: center
                  slots:
                    content:
                      - component: bb_theme:collection-position
                        props:
                          from: 1
                          to: 5
                          total: 24
                          noun: projects
                      - component: bb_theme:button
                        props:
                          label: Previous
                          href: '?page[workspace_projects]=0'
                          disabled: true
                      - component: bb_theme:button
                        props:
                          label: Next
                          href: '?page[workspace_projects]=1'
          - component: bb_theme:zone
            props:
              inset: none
              direction: fill
              description: Sorted by name; click a column to sort. n = closed tickets behind the value.
            slots:
              heading: People
              content:
                - component: bb_theme:table
                  props:
                    columns:
                      - key: person
                        label: Person
                        sort: asc
                        url: '?sort[workspace_people]=person&order[workspace_people]=desc'
                        row_header: true
                      - key: team
                        label: Team
                        sort: none
                        url: '?sort[workspace_people]=team&order[workspace_people]=asc'
                      - key: closed
                        label: Closed
                        num: true
                        sort: none
                        url: '?sort[workspace_people]=closed&order[workspace_people]=desc'
                      - key: runs
                        label: Runs / ticket
                        num: true
                        sort: none
                        url: '?sort[workspace_people]=runs&order[workspace_people]=desc'
                      - key: rating
                        label: Rating
                        num: true
                        sort: none
                        url: '?sort[workspace_people]=rating&order[workspace_people]=desc'
                      - key: tokens
                        label: AI tokens
                        num: true
                        sort: none
                        url: '?sort[workspace_people]=tokens&order[workspace_people]=desc'
                    rows:
                      - cells:
                          person:
                            kind: person
                            display_name: Christian W.
                            initials: CW
                            color: running
                          team:
                            kind: text
                            value: Platform crew
                          closed:
                            kind: text
                            value: '58'
                          runs:
                            kind: text
                            value: '5.6'
                          rating:
                            kind: text
                            value: 4.3 · n 24
                          tokens:
                            kind: text
                            value: 8.9 B
                      - cells:
                          person:
                            kind: person
                            display_name: Daniel S.
                            initials: DS
                            color: attention
                          team:
                            kind: text
                            value: Design crew
                          closed:
                            kind: text
                            value: '21'
                          runs:
                            kind: text
                            value: '3.8'
                          rating:
                            kind: text
                            value: 4.0 · n 9
                          tokens:
                            kind: text
                            value: 2.1 B
                      - cells:
                          person:
                            kind: person
                            display_name: Robert K.
                            initials: RK
                            color: wait
                          team:
                            kind: text
                            value: Platform crew
                          closed:
                            kind: text
                            value: '3'
                          runs:
                            kind: text
                            value: —
                            emphasis: faint
                          rating:
                            kind: text
                            value: —
                            emphasis: faint
                          tokens:
                            kind: text
                            value: 0.2 B
                      - cells:
                          person:
                            kind: person
                            display_name: Unassigned tickets
                            initials: '?'
                            color: idle
                          team:
                            kind: text
                            value: —
                            emphasis: faint
                          closed:
                            kind: text
                            value: '45'
                          runs:
                            kind: text
                            value: '5.1'
                          rating:
                            kind: text
                            value: 4.0 · n 22
                          tokens:
                            kind: text
                            value: 5.3 B
                - component: bb_theme:note
                  props:
                    lead: 'Robert K.: 3 closed tickets — too few for runs per ticket (n < 5), shown as —. Values belong to the current assignee.'
          - component: bb_theme:zone
            props:
              inset: md
              direction: fill
              description: Insights counts tickets that reach done in the selected period, the runs on them and the AI tokens they used. The first figures appear once a ticket is closed.
            slots:
              heading: No closed tickets in October yet
              content:
                - component: bb_theme:button
                  props:
                    label: Open projects
                    href: /bakers/projects
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
      path: /projects/bakers-build/.worktrees/feat/bakers-13-statistiken-ins/web/themes/custom/bb_theme/designbook/sections/component-demos/component-demos.section.scenes.yml
  ```

  #### Results
  <!-- done -->

### Step: validate
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:playwright-validate, ctx:component-contract-index, ctx:sdc-components]

- [x] validate — stat-tile default (preserved)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--default
  criteria: 'unchanged: value, label, window and source as before; no unit, info, detail or comparison row.'
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

- [x] validate — stat-tile capacity (preserved)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--capacity
  criteria: unchanged rendering of the capacity story.
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

- [x] validate — stat-tile compact (preserved)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--compact
  criteria: unchanged compact density.
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

- [x] validate — stat-tile comparison (preserved)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--comparison
  criteria: 'unchanged: "42", "Closed tickets", chip "+14 %" with up arrow, "vs. Q3 2026: 37", window "Q4 2026", accessible name "42 Closed tickets, vs. Q3 2026: 37, +14 %".'
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

- [x] validate — stat-tile flat (preserved)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--flat
  criteria: unchanged rendering of the flat story.
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

- [x] validate — stat-tile kpi

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--kpi
  criteria: label "Throughput" on top with an info trigger; value "214" with unit "closed"; chip "+8 %" with up arrow then "vs 198"; detail "236 created · backlog +22"; Tab focuses the info trigger and its text "Tickets closed in the period, by closed date (UTC)." becomes visible; the source "bb_measurement.closed_tickets" is reachable in the info text, not as a footnote; layout matches Figma 84:226 (reference 3a2b0e29e246a9d7/66d6d40dd8d4913e, insights-overview).
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

- [x] validate — stat-tile kpi small sample

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--kpi-small-sample
  criteria: value "—" rendered in grey (muted tone), unit "closed tickets", detail "n = 3 closed tickets · needs 5", no comparison chip; never "0" (Figma 90:1093).
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

- [x] validate — stat-tile kpi exact value

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-tile--kpi-exact
  criteria: value "28.4 B" is focusable; hovering it and focusing it with Tab both reveal "28,412,553,104 tokens — Sum of run tokens by run start, UTC"; Escape or blur hides it; chip "-9 %" with down arrow, "vs 31.2 B"; detail "≈ 133 M per closed ticket" (Figma 84:320 and 90:1117).
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

- [x] validate — stat-breakdown default (preserved)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-breakdown--default
  criteria: unchanged table display with its period columns.
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

- [x] validate — stat-breakdown bars

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/bb-theme-data-display-stat-breakdown--bars
  criteria: heading "AI usage by model", caption "Tokens, 1 – 19 Oct. Not a billable quantity."; four rows Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Unattributed, each with value right-aligned and share label ("63 %", "31 %", "5 %", "1 %"); a bar under each label whose filled length is proportional to the share; no table markup (Figma 84:452).
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

- [ ] validate — insights overview (scene)

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:6006/?path=/story/designbook-sections-component-demos-scenes--insights-overview
  criteria: heading "Insights" and subline "keytec · all projects, all teams"; period range on Month with three pills "Project · All", "Team · All", "Person · All"; four kpi tiles in one row; two bar lists side by side; Projects table with sortable headers (aria-sort), "—" rendered faint, a strong "All projects" total row and the pager "1–5 of 24 projects" with Previous disabled and Next enabled; People table with avatars and the footnote; empty-state block with "No closed tickets in October yet" and a link; sibling scenes of component-demos unchanged. Compared with reference 3a2b0e29e246a9d7/66d6d40dd8d4913e (insights-overview, filter-active, insights-states).
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
  <!-- pending -->

