# Plan: design-component
<!-- digest: 5bab9747908be137b9c668ed2d69238a5d027d6c7297cd295a09aca6d6e37bde -->

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
  - id: bb_theme:summary-band
    contract:
      component: summary-band
      group: Data Display
      description: |-
        A full-width band above a two-column layout, answering three questions in one glance: where does this stand, what was done, and what evidence is there. THREE SLOTS and nothing else — a `flow` in the header strip, a `summary` beneath it, and the `links` below that.

        THE THREE QUESTIONS ARE THE CONTRACT, which is why there are three slots and not four. It carried a fourth, `actions`, declared for a transition control that had been removed at a review gate and never refilled; measured across every scene that composes this band, all three fill `flow`, `summary` and `links` and NONE fills `actions`. A slot no caller fills is not a shape held open for later — it is a region every future reader has to account for, and re-adding one is a line of YAML at the moment somebody actually has a band action to place.

        THE LINKS SIT BELOW THE SUMMARY, NOT BESIDE IT (C21). The first iteration put them in a second column of the body row, and the human read that as two things competing for the one glance the band exists to serve. Stacked, the band reads top to bottom in the order the questions are asked, and with the full width the link groups lay out as one wrapping row of groups instead of a narrow gutter that wraps every label.

        IT IS COMPACT: about 150 px for a one-line summary at compact density. Its padding and the gaps between regions are small because the summary's own entry brings its vertical padding, and on a wide screen the summary region lays its parts out side by side, so an entry's link and action sit beside it rather than under it.

        IT KNOWS NOTHING ABOUT WHAT IT SUMMARISES. It used to be named for one screen and its slots described that screen's fields; the questions it answers are asked of a release, a run and a deployment in the same words, and every one of them has a state to show, a summary to read and evidence to open. Each region renders only when its slot is filled, so a caller with two of the three gets a band of two.
      props:
        type: object
        properties: {}
        required: []
        additionalProperties: false
      slots:
        flow:
          description: Where the subject stands — an ordered chain with a current link, after any status badge, in one wrapping row. Renders left in the header strip.
          required: false
        summary:
          description: What was done, as one timeline entry rather than a component of this band's own, with the entry's link and action. Renders beneath the header strip; on a wide screen its parts sit side by side.
          required: false
        links:
          description: The evidence — what was tested and how a reader can test it. Rendered BELOW the summary as one wrapping row of groups, never beside it.
          required: false
    source: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/summary-band/summary-band.component.yml
    hash: 53997efc4da15e2939491e01ceb359fe4637483b7f5acb4d28fe9524b42af8a5
  - id: bb_theme:state-flow
    contract:
      component: state-flow
      group: Data Display
      description: 'Workflow state-flow bar: ordered state pills with the current state highlighted. Shared by ticket_detail and run_row — states come from the entity''s state_machine workflow (bb_core.workflows.yml), never a hard-coded list.'
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
            title: aria-label for the list
        required:
          - states
        additionalProperties: false
      slots: {}
    source: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/state-flow/state-flow.component.yml
    hash: 9c04d4c539f1b390d359eb8c539cbb1573b3171a52a0e1da16b6ed4185c7a635
  - id: bb_theme:badge
    contract:
      component: badge
      group: Data Display
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
    source: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/badge/badge.component.yml
    hash: f803dcc8a5811e563d65810e8a357a0e290ffe054b0230b908854b778df86aab
  - id: bb_theme:event
    contract:
      component: event
      group: Data Display
      description: |-
        One entry of an activity timeline: who, an optional tag, when, and a rich body. Read-only.

        IT KNOWS NOTHING ABOUT WHAT PRODUCED IT, and that is the whole of this contract. It used to be a comment renderer, and the shape it drew was never a comment's: a person, a tag, a timestamp and a prose body describe a run's handoff, a deployment note and a review remark just as exactly. The entity knowledge went back to the mapping, which is the layer that knows which field is the author and which is the body, and the component then serves every one of those without a second copy of itself.

        THE TAG IS A FREE STRING AND NOT AN ENUM. It was an enum over one entity's type field, which is two defects in one: a display component had a list of another layer's permitted values, and the list could only ever be BEHIND them. The failure that produces is the worst kind — measured on a running site, the display_builder render path does not reject an out-of-enum value, it silently drops the prop, and a handoff of a new kind is then displayed as an ordinary untagged entry with nothing signalling it. So the tag is whatever the caller passes: a KNOWN value takes its own accent, anything else renders with the neutral one, and an ABSENT tag renders no tag at all.

        THAT AN UNTAGGED ENTRY IS UNTAGGED IS THE CALLER'S KNOWLEDGE. A source whose type field has a default meaning "no particular kind" passes no tag, rather than passing that default here for this component to recognise — which is what the deleted `comment` branch of the accent map was, an entity's default value hard-coded into a display.

        THE BODY IS A SLOT-LESS PROP CARRYING PROCESSED MARKUP, and the prose treatment is not here: `rich-text` owns it, so this body and a description elsewhere in the theme agree by construction. Two facts about that format matter to whoever fills it — the format is GitHub-flavoured Markdown and STRIPS RAW HTML, so a body authored as HTML renders empty, and a pipe table arrives as a real table, which `rich-text` styles and lets scroll inside itself.

        A STRUCTURED LEAD IS THE OTHER WAY TO FILL THE ENTRY. A caller that knows facts rather than prose passes a subject (label, optional URL), a statement, plain `facts`, `links` and one preformatted `detail` line; the template lays them out and the same `rich-text` treatment styles them. `body` wins when both arrive.
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
            description: The readable label from `BbDate`.
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
          datetime:
            type: string
            title: Posted-at ISO 8601 stamp
          timestamp_title:
            type: string
            title: Posted-at full date and time, shown on hover
        required:
          - author_name
          - author_initials
        additionalProperties: false
      slots: {}
    source: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/event/event.component.yml
    hash: aa174549a3669cb11b95adf1cdd30190881fa2f1bf4cc24b631dc9c8e7bcd4a1
  - id: bb_theme:link-group
    contract:
      component: link-group
      group: Data Display
      description: 'A labelled group of link rows, rendering each itself and dispatching on its `kind`: the report row for `report`, the plain row for everything else — the seam a later kind renderer plugs into with one new branch in the dispatch (D6). Both rows were components of their own until D7 folded them in: this was their only caller, so the boundary bought nothing and cost two contracts that could drift from the group that dispatches them. It renders only its own props and fetches nothing — a real report-artifact reader needs a fetch, credentials, a cache and a failure path, and the GitLab credentials it would need live on the conductor''s machine rather than on the control plane, so building one is a follow-up backend ticket (D6). The numbers a story shows come from Designbook sample data, never a live read. The `links` prop is the usual path; the `rows` slot is a composition escape hatch, and it WINS over `links` when filled. Renders nothing when it has neither `links` nor a filled `rows` slot — a group with a promising label and no rows is worse than an absent one.'
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: Small uppercase eyebrow header rendered above the rows.
          description:
            type: string
            title: Description
            description: One sentence under the label saying who the group is for. Optional.
          framed:
            type: boolean
            title: Framed
            description: Draws a hairline frame with padding around the group, for groups that stand side by side. Off by default.
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
                    - chat
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
    source: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/link-group/link-group.component.yml
    hash: f0b7b50e79c47dfaf995a41af3ad8e5f063a1a1951c7fa8ca827f992e75ff8d3
mappings: []
samples: []
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
          profile:
            template: field-map
            label: Profile
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
      view.environments: Drupal has no environments View, and no list of environments exists yet. The bb_project environments field is hidden on the project full display; only its referenced names show on the project properties detail card (BbEntityDetailCardForm). Deployment tickets show their environments as chips in the ticket inspector. The view.environments mapping is ahead of the backend and has no Drupal counterpart.
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
            description: bb_addon records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_addon
                bundle: bb_addon
                view_mode: default
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
            description: bb_conductor records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_conductor
                bundle: bb_conductor
                view_mode: default
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
            description: bb_ticket records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_ticket
                bundle: bb_ticket
                view_mode: default
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
            description: bb_group records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_group
                bundle: bb_group
                view_mode: default
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
            description: bb_machine records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_machine
                bundle: bb_machine
                view_mode: default
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
            description: bb_project records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_project
                bundle: bb_project
                view_mode: default
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
            description: bb_run records the View lists; Drupal renders each row with the `fields` row plugin.
            required: true
            multiple: true
            sample_template:
              template: views
              settings:
                entity_type: bb_run
                bundle: bb_run
                view_mode: default
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
data_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/designbook
```

## Context
### task:write-component (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/tasks/write-component.md)
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

### task:refresh-components (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/refresh-components.md)
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

### task:validate (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/validate.md)
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

### ctx:variant-transport (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/variant-transport.md)
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

### ctx:typed-component-boundary (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/typed-component-boundary.md)
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

### ctx:story-image-node-renderer (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/story-image-node-renderer.md)
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

### ctx:region-properties (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/region-properties.md)
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

### ctx:referenced-content-view-mode (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/referenced-content-view-mode.md)
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

### ctx:presenter-composition (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/presenter-composition.md)
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

### ctx:markup-derivation (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/markup-derivation.md)
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

### ctx:local-image-assets (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/local-image-assets.md)
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

### ctx:icon-sprite (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/icon-sprite.md)
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

### ctx:token-backed-utilities (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/token-backed-utilities.md)
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

### ctx:region-properties-2 (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/region-properties.md)
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

### ctx:font-availability (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/font-availability.md)
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

### ctx:component-styling (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/component-styling.md)
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

### ctx:component-source (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/component-source.md)
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

### ctx:navigation (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/shell/rules/navigation.md)
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

### ctx:slot-rendering (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/slot-rendering.md)
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

### ctx:sdc-components (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/sdc-components.md)
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

### ctx:region-properties-3 (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/region-properties.md)
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

### ctx:reference-field-semantics (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/reference-field-semantics.md)
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

### ctx:layout-constraints (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/layout-constraints.md)
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

### ctx:js-behavior (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/rules/js-behavior.md)
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

### ctx:static-assets (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/blueprints/static-assets.md)
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

### ctx:pager (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/pager.md)
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

### ctx:page (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/page.md)
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

### ctx:navigation-2 (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/navigation.md)
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

### ctx:logo (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/logo.md)
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

### ctx:link (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/link.md)
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

### ctx:js-behavior-2 (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/js-behavior.md)
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

### ctx:icon (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/icon.md)
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

### ctx:header (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/header.md)
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

### ctx:form (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/form.md)
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

### ctx:footer (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/footer.md)
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

### ctx:component-template (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/component-template.md)
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

### ctx:button (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/blueprints/button.md)
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

### ctx:playwright-validate (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/playwright-validate.md)
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

- [x] write-component — summary-band

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: summary-band
    group: Data Display
    description: |-
      A full-width band above a two-column layout, answering three questions in one glance: where does this stand, what was done, and what evidence is there. THREE SLOTS and nothing else — a `flow` in the header strip, a `summary` beneath it, and the `links` below that.

      THE THREE QUESTIONS ARE THE CONTRACT, which is why there are three slots and not four. It carried a fourth, `actions`, declared for a transition control that had been removed at a review gate and never refilled; measured across every scene that composes this band, all three fill `flow`, `summary` and `links` and NONE fills `actions`. A slot no caller fills is not a shape held open for later — it is a region every future reader has to account for, and re-adding one is a line of YAML at the moment somebody actually has a band action to place.

      THE LINKS SIT BELOW THE SUMMARY, NOT BESIDE IT (C21). The first iteration put them in a second column of the body row, and the human read that as two things competing for the one glance the band exists to serve. Stacked, the band reads top to bottom in the order the questions are asked, and with the full width the link groups lay out as one wrapping row of groups instead of a narrow gutter that wraps every label.

      IT IS COMPACT: about 150 px for a one-line summary at compact density. Its padding and the gaps between regions are small because the summary's own entry brings its vertical padding, and on a wide screen the summary region lays its parts out side by side, so an entry's link and action sit beside it rather than under it.

      IT KNOWS NOTHING ABOUT WHAT IT SUMMARISES. It used to be named for one screen and its slots described that screen's fields; the questions it answers are asked of a release, a run and a deployment in the same words, and every one of them has a state to show, a summary to read and evidence to open. Each region renders only when its slot is filled, so a caller with two of the three gets a band of two.
    props:
      type: object
      properties: {}
      required: []
      additionalProperties: false
    slots:
      flow:
        description: 'Where the subject stands: an ordered chain with a current link, after any status badge, in one wrapping row. Renders left in the header strip.'
        required: false
      summary:
        description: What was done, as one timeline entry rather than a component of this band's own, with the entry's link and action. Renders beneath the header strip; on a wide screen its parts sit side by side.
        required: false
      links:
        description: The evidence — what was tested and how a reader can test it. Rendered BELOW the summary as one wrapping row of groups, never beside it.
        required: false
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/summary-band/summary-band.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/summary-band/summary-band.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/summary-band/summary-band.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/components/summary-band/summary-band.js
  ```

  #### Results
  <!-- done -->

### Step: refresh-components
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:component-contract-index, ctx:sdc-components]

- [x] refresh-components — summary-band story

  Instruction: task:refresh-components

  #### Params
  ```yaml
  command: pnpm exec storybook build --quiet
  cwd: /var/www/html/web/themes/custom/bb_theme
  index_url: http://localhost:43079/index.json
  story_ids:
    - bb-theme-data-display-summary-band--default
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

### Step: validate
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:playwright-validate, ctx:component-contract-index, ctx:sdc-components]

- [x] validate — bb-theme-data-display-summary-band--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:43079/iframe.html?viewMode=story&id=bb-theme-data-display-summary-band--default
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

