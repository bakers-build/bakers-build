# Plan: design-component
<!-- digest: 7f137f08dd4006d8808394a6646465ad5fe81e50eabb87204e565d9cdf8acc38 -->

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
  - id: bb_theme:sidebar
    contract:
      component: sidebar
      group: Shell
      description: 'Linear-style left navigation rail: workspace switcher on top, the primary navigation below it, a collapse toggle on the rail''s right edge and an actions area at the foot. Collapsed it keeps the icons and drops the labels; the state is a prop and the toggle drives the same accessible attributes at runtime.'
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
        - id: collapsed
        - id: default
        - id: expanded
    source: components/sidebar/sidebar.component.yml
    hash: 415e8607830c54fd4300197981d61dfa48e17733bea7b12cb9dbb073068efe51
  - id: bb_theme:account_switcher
    contract:
      component: account_switcher
      group: Shell
      description: 'Head-of-rail workspace switcher, the retired workspace_switcher kept under this name because the sidebar addresses it from its `workspace` slot. A disclosure button that opens the workspace list — but only when there is more than one workspace to switch to (`multiple`); with a single workspace it renders as a plain, non-interactive label with no chevron and no panel, the same way the signed-in account never was a switcher. The account is NOT rendered by this component: it sits at the rail foot, in the sidebar''s `actions` slot, as a plain `bb_theme:person` avatar. Collapsed this reduces to the mark alone, so the 56px rail keeps it reachable.'
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
        - id: default
        - id: picture
        - id: single
    source: components/account_switcher/account_switcher.component.yml
    hash: 1a5b79f0928ccdbaed5bd2fc1c82e80922305af5b22f416f88c7dbbb86e841c5
  - id: bb_theme:menu_item
    contract:
      component: menu_item
      group: Shell
      description: One link row of a disclosed menu panel (`role="menu"`), such as the workspace list in `account_switcher`'s `workspace_panel` slot. The current row is set bold and carries `aria-current`, so an open panel names where the reader already is.
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
      variants:
        - id: default
        - id: identity
        - id: picture
    source: components/menu_item/menu_item.component.yml
    hash: b59452b551ceaa27543c81fb06c2303ea9b4cb8e661dc597faac843821fbd83e
  - id: bb_theme:nav
    contract:
      component: nav
      group: Navigation
      description: 'The menu tree (renamed from `navigation` — BB-378 D9; short because its container, `sidebar`, is named). Renders the tree from an items array through a recursive Twig macro. Entries are never hardcoded. An entry is a link by default; setting heading makes it a GROUP HEADING — a single disclosure button spanning the row, with no href, because a heading has no destination. A row may carry a mark instead of an icon (a team, rendered through `person`), one create action and one dot menu, each an object and never an array: the dot menu IS the overflow, so an unbounded control strip inside a 28px row has nothing to be. Every open/closed state is an accessible attribute — a disclosure trigger carries aria-expanded and aria-controls, the panel carries the matching id and starts hidden — and no CSS class ever carries state.'
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
        - id: default
        - id: main
        - id: settings_open
    source: components/nav/nav.component.yml
    hash: 69c8841c18d57c5f5b949e78c9ff852fc9b60b55613784d607f7c449bbd84161
  - id: bb_theme:status_bar
    contract:
      component: status_bar
      group: Shell
      description: 'Bottom bar of the shell, filling the page footer slot. Deliberately not called footer and without a navigation slot: it is a status surface, not a site footer.'
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
      variants:
        - id: default
    source: components/status_bar/status_bar.component.yml
    hash: 579f0629fbcf677b09b814767b5dc9dc23c8402fb64095c9bb1438278d4901ad
mappings: []
samples: []
data_model: {}
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

            WHY A SCREEN OUTSIDE EVERY WORKSPACE CANNOT USE THE SHELL. The rail is workspace-ambient: its workspace links (`WorkspaceMenuLink`) are denied on a route that carries no workspace, so the shell here would render a navigation whose entries lead nowhere. That reads as a defect rather than as a state, and no amount of prop-setting on the shell fixes it — the absence is in the ROUTE, not in the props.

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
    hash: 0b7cc25e7405f640b1ffe7e9d442e3257f32102c2b13bd6765b825e371589e09
namespace: bb_theme
data_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/designbook
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

### task:create-variant-story (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/components/tasks/create-variant-story.md)
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

### task:write-scene (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/scenes/tasks/write-scene.md)
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

### ctx:shell-scene-constraints (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/shell-scene-constraints.md)
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

### ctx:screen-scene-constraints (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/screen-scene-constraints.md)
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

### ctx:scenes-constraints (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/scenes-constraints.md)
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

### ctx:entity-reference-rendering (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/entity-reference-rendering.md)
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

### ctx:scenes-constraints-2 (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/rules/scenes-constraints.md)
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

### ctx:scenes-constraints-3 (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/scenes/rules/scenes-constraints.md)
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

- [x] write-component — write-component — mode_toggle

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: mode_toggle
    group: Action
    description: 'CHANGE: Light / Dark / System instead of the palette picker. Keep the native popover (button with popovertarget, popover="auto" panel, x-id appearance). Panel content becomes one fieldset with legend "Appearance" and three radio inputs light, dark, system bound to window.bakersModeChoice() and window.bakersSetMode(value), updated from the bakers-appearance event detail.choice. No theme select, no data-skin, no bakersSetTheme. Trigger icon sun-moon (new source assets/icons/src/sun-moon.svg, Lucide sun-moon, stroke currentColor) via bb_theme:icon size md instead of palette; aria-label default "Choose appearance". Prop mode gains enum value system and is the statically checked choice (default system). Default story label "Choose appearance".'
    props:
      type: object
      properties:
        mode:
          type: string
          enum:
            - light
            - dark
            - system
          title: Mode
          description: Choice checked before the runtime reads the stored one, for static rendering only -- the runtime source of truth is js/skin.src.js, which sets html[data-mode].
        label:
          type: string
          title: Accessible label
          description: aria-label for the button.
      required: []
      additionalProperties: false
    slots: {}
    variants:
      - id: default
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/mode_toggle/mode_toggle.component.yml 48cecd322898362a1c8db5c1b638dd52bb5a79a96bcbf3cf29fe08ed5598c128; components/mode_toggle/mode_toggle.default.story.yml 8078f19fa4559f13d13e0a3bff52e9d63b10084c807a09eda06fcf8fce84a2e3; components/mode_toggle/mode_toggle.twig 3db7d1a5f398bda11950da6fbfe57f51380f8d7b5149f52f2364f129527873f3. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/mode_toggle/mode_toggle.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/mode_toggle/mode_toggle.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/mode_toggle/mode_toggle.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/mode_toggle/mode_toggle.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — person

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: person
    group: Data Display
    description: 'CHANGE: color_map: running bg-avatar-a, attention bg-avatar-b, unassigned bg-avatar-a, lease bg-avatar-c, offline bg-avatar-d; default fill bg-avatar-a instead of bg-state-running. One comment line: avatars have their own fills, so a person never reads as a state. Keys, text-state-ink initials, sizes and all variants unchanged.'
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
    variants:
      - id: app
      - id: compact
      - id: default
      - id: picture
      - id: picture_contain
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/person/person.app.story.yml 9a1c2f808e6c786c608f6f945511ddc9620e4428e01c839d63e6100274d2f365; components/person/person.compact.story.yml bbb8fcf0bd0318fea1154d0ad137959f32434095524d5f057272ae1ba6c08781; components/person/person.component.yml be393c8846eddd0e467300236315aeab1aac2d4c30ad952cc6311fd93c8d0d1c; components/person/person.default.story.yml 0ae7b0d92e80d78a13d21293a981cad0c36828384bf7b90f1dc24a98b7def898; components/person/person.picture.story.yml 2796188b1994ffefe0eca81d9f42bd0a510e8ae4f9ee9ffad365b43a268884a5; components/person/person.picture_contain.story.yml c8ee152ff5af4bd6dc1e3156ecc460d56a69bcdb00f1f622eec3699efbd7c4fd; components/person/person.twig 7e93ff1039729f6b25dcf0fcfe8d6c8d7bf9fee801671be9f0c4f6121cdbc639. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/person/person.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/person/person.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/person/person.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/person/person.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — badge

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: badge
    group: Data Display
    description: 'CHANGE: Waits-for-you marks: dot map attention bg-state-attention-mark (was bg-state-attention); stale border-state-attention-mark; attention outline outline-state-attention-mark/45. Every other tone unchanged.'
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
    variants:
      - id: attention
      - id: claim
      - id: claim_mine
      - id: default
      - id: idle
      - id: list_item
      - id: offline
      - id: priority
      - id: refresh
      - id: running
      - id: stale
      - id: wait
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/badge/badge.attention.story.yml ee700cf4e16964452c7bb06c605d0c148754e1871d02a5b1f33b7a858dac53a0; components/badge/badge.claim.story.yml e245f2cc63776751f8f94a99c3e04784f03b0491c37a7da22bddd9ddc7ab8624; components/badge/badge.claim_mine.story.yml 57d4d636554c399ecdbd91aef81f7c654604784c80162e3c1023e3bc75e25732; components/badge/badge.component.yml fc0e9cc81907dcec6b12095b2ec15f7941647ef98c187a45ee5ab15f2dc00c70; components/badge/badge.default.story.yml 6844115c03287205362e9db837ed4a445b7dda4c3f2f2d90432981794935ff76; components/badge/badge.idle.story.yml 69551e3dc52d635c3b349932f5724b09a24a1a135808be32dea62b1358a265a6; components/badge/badge.list_item.story.yml 9a7bb776d909e096434f4ca247b8e096f387b8e7fac960f31146a0e6ecdb2b91; components/badge/badge.offline.story.yml bd1054278392580d3e7bbf4208e08de427d50632fce59f7275c6637da1b40270; components/badge/badge.priority.story.yml 2c6d377f2b5156283a1787f3d442bafd2e08d3e5d73a0c6d7aa8d5f6cfd49bcb; components/badge/badge.refresh.story.yml fc26b07b48e5f55555f858f51813c39fd7271ff935b6bcbf5a7fd2c806ee3e9e; components/badge/badge.running.story.yml 5c05b3cf9f221418c03b00372b359c653a4394b153d6db6ab91b68fe5cc1b299; components/badge/badge.stale.story.yml f99105359b70c9edb532687674a9f007440948e85640eb33e38816e6acc2711a; components/badge/badge.twig abeed757c85b3c0b1a81df54791af4fb51cfd55544903784771b8660cbb62a88; components/badge/badge.wait.story.yml f976b5cb91d670c5b600e2d983bf96cad1d8872397fc82f009b205b2146d1c32. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/badge/badge.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/badge/badge.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/badge/badge.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/badge/badge.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — board-card

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: board-card
    group: Data Display
    description: 'CHANGE: Edge map attention and needs_input before:bg-state-attention-mark (was before:bg-state-attention). Card fill bg-surface instead of bg-surface-2, so cards sit on the surface-2 columns as in the Figma board. Everything else unchanged.'
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
          title: Workflow state key (e.g. qualification, plan, working)
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
        description: 'Footer line, in this order: the lease badge where a lease is held, a spacer, a dotted badge whose label is the card''s EXACT workflow state as text (plan, working, review — the column carries only the phase), then the assignee. When this slot is empty the card composes that line from its lease, state and assignee props. The state must never be conveyed by colour alone: the badge''s label is what names it, while its dot and the card''s accent edge encode the derived status.'
        required: false
    variants:
      - id: blocked
      - id: cancelled
      - id: default
      - id: state_pill
      - id: unassigned
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/board-card/board-card.blocked.story.yml 8950d4c24b3aa97dd119b92a39451b5327e5c9d327ea0b54d3d1112df66a3d8f; components/board-card/board-card.cancelled.story.yml 67cc0019ef16e86372e3b5dbcb59b6d4ecf580c505486dcdcfe56fdd5dd8bf27; components/board-card/board-card.component.yml 5bf427d34fd53804118b2930383b48a7c7092adf85d847574e50c1b1bd29e5ae; components/board-card/board-card.default.story.yml dbe769b9d3a081766498279d852fdeb6217b2978642646016bdc5bd71c884e50; components/board-card/board-card.state_pill.story.yml 24383147ae95a7245ae3015b5f20c2b85e1adf888d893bbd898fc376e2e2b414; components/board-card/board-card.twig 8eb1fe1a632f796184cf222ff14725a524a8b0c5293c124a330016f0a6016f7f; components/board-card/board-card.unassigned.story.yml 1faf9828d6d793ed984bd0ca205fd09c22226f53ec5b2480568f9decef91b7ca. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board-card/board-card.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board-card/board-card.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board-card/board-card.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board-card/board-card.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — board

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: board
    group: Data Display
    description: 'CHANGE: Column section fill bg-surface-2 instead of bg-app, as in the Figma board columns. Everything else unchanged.'
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
    variants:
      - id: default
      - id: operational
      - id: operational_details
      - id: phases
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/board/board.component.yml b53a1d0e9336b2e651060a7730996e7fc4c9e8a711053c2286a036290dede33d; components/board/board.default.story.yml 78da3a340c87ae0f54c356591e684d7c72c15a85fc567407c8083701169ff61c; components/board/board.operational.story.yml d377034e266c1b5d8ad16e5fec7fd0cd38216944ce1150f25ea1473f1889cdb3; components/board/board.operational_details.story.yml 145520aaca26ffc4ceb657196d1f8ec948157df26bb3d1b0e5b797a499134ce8; components/board/board.phases.story.yml 87fbf894cb8d6877059e5244f4f1ddb767b36da84281fea49eaf8f647a831e33; components/board/board.twig 8eca5f2e063f69994832bfb0b688a71444e75eba77325e2a9aaf9bab25bd6389. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board/board.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board/board.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board/board.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/board/board.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — button

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: button
    group: Action
    description: 'CHANGE: Variant attention border border-state-attention-mark (was border-state-attention); its tint fill and attention-ink text stay. Other variants unchanged.'
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
      - id: danger
      - id: default
      - id: ghost
      - id: primary
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/button/button.component.yml c0552ef259deebd2cab160ed0257033ff4437f6bcacc5d91a36a854851310cbd; components/button/button.danger.story.yml a09ac2aa03d18fcdb56548a93d4a6bfcd2295443e23bfca3ff2799481ec43b20; components/button/button.default.story.yml 6e1cc6a9e3e0cacd6057f928972fe9b682b84c55689ba59c9105ab176458fa5c; components/button/button.ghost.story.yml 59c8c8a824cc95875795cbcbbd6090ef8646850ea1d5ed64ba26d65aafaacc5d; components/button/button.primary.story.yml 5f51b211080cc4352c55156cf58645994bf801062a3108982868476713c38dc4; components/button/button.twig 2e074f21f0c6efa3ca0bb526dcc980cb9cff2dfcb32f09c457ec1c0b99780a5a. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/button/button.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/button/button.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/button/button.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/button/button.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — event

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: event
    group: Data Display
    description: 'CHANGE: Kind text colours move to ink tokens: spec, plan, scenario text-state-lease-ink; debug_diagnose, failed text-state-attention-ink; summary text-state-running-ink; acceptance text-state-unassigned-ink; test text-state-offline-ink. Edge map debug_diagnose and failed before:bg-state-attention-mark. Everything else unchanged.'
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
    variants:
      - id: cancelled
      - id: created
      - id: default
      - id: expired
      - id: started
      - id: status_agent
      - id: status_human
      - id: structured
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/event/event.cancelled.story.yml 6df5d630ea8d2e73475d6e1c6b4c5af46a69e2ea673a85df34c547fc7ae268e8; components/event/event.component.yml 7fc98b860a16b590fce60d839c853e8a829b7ba604a3d1c26eb9cc8f744858f8; components/event/event.created.story.yml d3eaac2ef819a7dc569b57856264deb31bcb3cc9ce3c2ea99107bfde7e39e731; components/event/event.default.story.yml 777e8b2c157afb9bf7e421592bdcaa182d8d9f0874d2233aa532360590bfd005; components/event/event.expired.story.yml 42e1acecfbbd4f1362d6766c1d341399a09a49e06f7ef5223cca63edb212fa59; components/event/event.started.story.yml 88ae32f6630d5bf19dbf42d54bc69a647874c6268e7d7a3a9a4e2c196ff94784; components/event/event.status_agent.story.yml f3b04d2cf907f984f684bf818bdf3bb03dfaec5e18fe3a50d6803eb8f3c7d798; components/event/event.status_human.story.yml fa72fcc363ae9eb65318b1f9dd7b8a05434d8a3b98c383db6cde8267e38bcbad; components/event/event.structured.story.yml 01cee7efb2ed931f05355d2526f6528c04772e8f54e1b258ed260075641a9f1d; components/event/event.twig a51e73e47fb5820ce970e0cd87f175fa2b981643ed10dccdbcc59636ab161006. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/event/event.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/event/event.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/event/event.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/event/event.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — form_label

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: form_label
    group: Form
    description: 'CHANGE: Eyebrow label text text-state-offline-ink instead of text-state-offline. Everything else unchanged.'
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
    variants:
      - id: default
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/form_label/form_label.component.yml e1d9f658ea6a5119b3c5fd59ca94a7f041187d673e319845840d8b7325228661; components/form_label/form_label.default.story.yml 8e150cf3219dc93194d5ee6c81086c3afa482fdcc6221eed0d7872ed80d59303; components/form_label/form_label.twig c6399efb6c4bdd60f5a5fc2c8ed3454a0d192d26de8ab072b715134b5637a2d5. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/form_label/form_label.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/form_label/form_label.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/form_label/form_label.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/form_label/form_label.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — link-group

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: link-group
    group: Data Display
    description: 'CHANGE: Run counts: passed text-state-running-ink, failed text-state-attention-ink (were the saturated state colours). Everything else unchanged.'
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
    variants:
      - id: default
      - id: self_target
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/link-group/link-group.component.yml d1162b6ab9e34e001b6dc0a669cd731ac22c38ca52091af698980dd61fd7183e; components/link-group/link-group.default.story.yml 209b676136df5ea586ed3e7bdd6b286f94a441b5223b7f5d228cf4c412d5ddcc; components/link-group/link-group.self_target.story.yml 5c8a8c26aaca3a6eca0482159c0f5929cf08b2bf4623f69db4d0a81de9373952; components/link-group/link-group.twig 05657dce14c4675a5ec697990eff6d10963cae5454e60e1cb8dbc7863ed69dd7. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/link-group/link-group.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/link-group/link-group.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/link-group/link-group.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/link-group/link-group.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — list

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: list
    group: Data Display
    description: 'CHANGE: Rail map attention bg-state-attention-mark (was bg-state-attention). Other rails unchanged.'
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
    variants:
      - id: cards
      - id: cards_comfortable
      - id: default
      - id: joinable
      - id: pattern_identity
      - id: pattern_long
      - id: pattern_rows
      - id: pattern_sparse
      - id: plain
      - id: rendered
      - id: variables
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/list/list.cards.story.yml d06096982b60655287dfa04683e57a59efd46c1b761c86aaeacb0451ee49609f; components/list/list.cards_comfortable.story.yml 2da35a403d2cfaf883ee1b05e4d2ca902674268fe2c7aea0cf700f69eb55cff0; components/list/list.component.yml 4b506f5a4adfd12677cb6ce20b4a866ee516f572e9a4511473211a40df46b29f; components/list/list.default.story.yml ad81be005c29443b1075de7fb4115f4020cfd93e98250a9db4d64f5ca6b1a57b; components/list/list.joinable.story.yml 84377382653f247a30cc66e9cba5d09945d0812e873ae6989ce9910296b8f6ee; components/list/list.pattern_identity.story.yml e822a08345b25e53365192a90e6ac918bb93096ea231e1792d8faa5980af8de9; components/list/list.pattern_long.story.yml fdbdb06a156e4e7c110f2a6b3b9c8d8dd37f8354b96b6bb36738f4b7f985b116; components/list/list.pattern_rows.story.yml a01d8601dcfd63825c18fa5a4ef1d2f1366a5d4d3ee81fa0294b595db1300dc4; components/list/list.pattern_sparse.story.yml e281c676cb2138fcc110f4d3599cbad30b7d2692812c8aa60574000d63142d25; components/list/list.plain.story.yml 7a1c15dd4989c32e2a3ea73d3aa04c7f730e36b3a3ad49c3480cd2f4c44a04af; components/list/list.rendered.story.yml 5c5bfa0d8b39643f10276e4a66c391999e5c20edf464f236745c60c2ff17153d; components/list/list.twig da50948d014b5a2057bce5b2e42c9dd4f0590ca7106809d46c9e66396b9c703c; components/list/list.variables.story.yml 3d01bfe0b5d4bc938bc9afd69753e5053e0c8254acac7a8b78e4c3567a642419. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/list/list.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/list/list.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/list/list.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/list/list.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — message

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: message
    group: Data Display
    description: 'CHANGE: Variant warning border color-mix with var(--color-state-attention-mark) at 36% instead of var(--color-state-attention). Other variants unchanged.'
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
    variants:
      - id: default
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/message/message.component.yml b27a72b8fa26b147b56654082e561e07df2d4f052fc1a06795eae698240be1a7; components/message/message.default.story.yml 1a8e0e3e9321c71438b5202c55e9487a87ffbc8abe9a408bb2a7bada16c899d4; components/message/message.twig 341918c0350ab18e4b11d74c6a2df54b1bfedd9ca7ebe9c53eb983dbc44f23c8. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/message/message.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/message/message.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/message/message.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/message/message.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — note

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: note
    group: Data Display
    description: 'CHANGE: Variant attention border-state-attention-mark instead of border-state-attention. Everything else unchanged.'
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
    variants:
      - id: attention
      - id: default
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/note/note.attention.story.yml 88fbb1d3428afc14d64f6fc0df5bdbf55f570fb46f879f44827ed219e3f81ddb; components/note/note.component.yml f3d0ea461fee622dbb5174564c22a0c32b85cf7faeddff295fe142e511191d45; components/note/note.default.story.yml ef59784a125a8fa87bca0f9453ce76eb995e078f10de751f31b73bec6506f57e; components/note/note.twig 623ead4788c8260be8d94a84b1ec98ec1b37276d4cb533cf10462fd5ef7d9bb5. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/note/note.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/note/note.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/note/note.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/note/note.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — state-flow

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: state-flow
    group: Data Display
    description: 'CHANGE: Step text map: plan, claimed text-state-lease-ink; working, running, done text-state-running-ink; review text-state-ink. Dot map review bg-state-ink. New state_fill_map { review: bg-state-review } with a one-line comment: the current review step is a filled pill, others sit on bg-surface-3. Current step pill class = state_fill_map[step] default bg-surface-3, then the text colour. Everything else unchanged.'
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
    variants:
      - id: default
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/state-flow/state-flow.component.yml a461187c5c58ffbc54964ec17baee2e1c6f6ba33e9fbd761e034fb55dec4314f; components/state-flow/state-flow.default.story.yml 75177da436d626c15a30e05d210aa31841c93f362319c2c928a5bfddec7c9c71; components/state-flow/state-flow.twig 752ff66fbd30c48ed13c3473f573975cd0810ef41314ae26a89326b442286e09. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/state-flow/state-flow.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/state-flow/state-flow.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/state-flow/state-flow.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/state-flow/state-flow.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — table

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: table
    group: Data Display
    description: 'CHANGE: Waits-for-you marks: the attention row border border-state-attention-mark (was border-state-attention) and the rail map attention bg-state-attention-mark. Everything else unchanged.'
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
              depth:
                type: integer
                minimum: 0
                maximum: 3
                title: Tree depth
                description: 'Makes the row a TREE ROW: its row-header cell is indented one step per level (0 is the top) and reserves a disclosure slot, so the names of rows with and without children line up. Absent on an ordinary table, which then renders exactly as before.'
              disclosure:
                type: object
                title: Disclosure
                description: 'A tree row with children: a chevron link before the row name that shows or hides them. It is a plain link to `href` — the page keeps which rows are open in the address — so it works without script; `expanded` sets `aria-expanded` and the "Expand"/"Collapse" accessible name.'
                properties:
                  href:
                    type: string
                    title: Toggle URL
                  expanded:
                    type: boolean
                    title: Expanded
              badges:
                type: array
                title: Name badges
                description: Badges after a tree row's name, such as "default account". Only a tree row (`depth` set) renders them.
                items:
                  type: object
                  properties:
                    label:
                      type: string
                      title: Label
                    tone:
                      type: string
                      title: Badge tone
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
                    exact:
                      type: string
                      title: Exact value
                      description: 'A `text` cell whose value is abbreviated: the unabbreviated value and its calculation. Shown when the value is hovered or focused, dismissed with Escape; the value becomes focusable when set.'
                    working:
                      type: boolean
                      title: Working
                      description: 'A `status` cell: TRUE draws a filled disc (the row is in working), FALSE or absent draws an empty dashed ring. The cell''s `label` (the exact state) is its tooltip and accessible name. The rail, not this glyph, carries occupancy and review.'
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
      - id: bare
      - id: collapsed
      - id: default
      - id: delivery
      - id: exact_value
      - id: external_link
      - id: timesheet
      - id: tree
      - id: unassigned
      - id: wired
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/table/table.bare.story.yml a711348adc8466d346268b885ab0cfe8384a68fdcfeb411a5b3e4f0945a8eb2c; components/table/table.collapsed.story.yml cebbaf3e9661b07eba73a927477c20b082cb3a9a665024d2893fd4610ec59c5c; components/table/table.component.yml ab8babfd3d22c027a8b56316a9b406e480dde2252954e16b0bf2b0fbb089df4d; components/table/table.default.story.yml 825ae0dd6643c73a717bfd944ce286218bcf89661cf394ea42ea666932ddbb69; components/table/table.delivery.story.yml b3f79e3a730ae7a8106914e2d15f4bd0f00b1b4df1c94e35b34775e702cfd7f4; components/table/table.exact_value.story.yml 7aaa822913dd8cf21751c0116089cc0d21aa304dbb4a7cd4583ac4025487ae34; components/table/table.external_link.story.yml bc01c0cead6536a1e69068fe16b755eb9ba8ef8a9ba5e340ebf61a77fcbb20a8; components/table/table.timesheet.story.yml 6f06240491f81a324f93f2d6b13d2900695842012f57afc97f9aa49da411afab; components/table/table.tree.story.yml 8c1640749196a987344af43334258aa96c767f42ed066c779f5e7583ac29fc67; components/table/table.twig 9ea5fa765c8bb69665346d151cf0cb49a3f2d4200a9763cd9f0243c449ecb318; components/table/table.unassigned.story.yml 44fb5bd759fc83c03e60ab9b8ee0a274511fb12f8c79e4147d4e92e3e20bf7f1; components/table/table.wired.story.yml 3540ecfa2299f5348e708c75b5bd3553b4789b461a15c1e7c62d9de8a3a8388f. Only the CHANGE above may differ; non-default story files are untouched.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/table/table.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/table/table.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/table/table.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/table/table.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — write-component — shell

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: shell
    group: Shell
    description: 'CHANGE: Stories only: every mode_toggle node in the shell stories passes label "Choose appearance" instead of "Choose theme". component.yml and shell.twig stay byte-identical; story comments are kept.'
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
    variants:
      - id: compact_dark
      - id: compact_light
      - id: cozy_dark
      - id: cozy_light
      - id: default
  decisions: BAKERS-53 spec (ticket comment "Spec - App appearance"), decisions Q2-Q5; approved Figma reference designbook/references/5ec63e9416185263/5912f5b2e076896e (board-light@ci-light, board-dark@ci-dark, desktop).
  preserve: 'Baseline is the current file set (sha256 at plan time): components/shell/shell.compact_dark.story.yml 63b9d435b3fd3028984fef2c544cc562f1bbdff4f886e2d8416f77a686235d64; components/shell/shell.compact_light.story.yml 780c602bf326cc182254ded5907f946b278f1a64955f15df9a57fd775b497eaf; components/shell/shell.component.yml b11d65ae6c8f89b6dd4b88d59953183e6323c1718f8970a0795cbd6cb0a7c79d; components/shell/shell.cozy_dark.story.yml 93dd25d320b87d85f7f4a3f7b4e27ccf58996271e3f1f67829bc6dd6897155ee; components/shell/shell.cozy_light.story.yml d3f2999b2ce0b2ee80892b82e2a423c0b902a4c4e46b989520e963281bcb6020; components/shell/shell.default.story.yml 10a1341ec02f1ba28be777085e5e63b123baf765cf3995638f22651fe79a50aa; components/shell/shell.twig dc7cc8a543341bc0dc0614c4937d1c866277b774b3ad3297f7bdbe63a11186f9. Only the CHANGE above may differ; non-default story files are untouched except the label, written by create-variant-story.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.js
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — create-variant-story — shell compact_dark

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: shell
    group: Shell
    description: 'CHANGE: Stories only: every mode_toggle node in the shell stories passes label "Choose appearance" instead of "Choose theme". component.yml and shell.twig stay byte-identical; story comments are kept.'
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
    variants:
      - id: compact_dark
      - id: compact_light
      - id: cozy_dark
      - id: cozy_light
      - id: default
  variant:
    id: compact_dark
    title: compact dark
    description: 'Existing shell story compact_dark: only the mode_toggle label changes to "Choose appearance"; every other line and every comment stays.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.compact_dark.story.yml
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — create-variant-story — shell compact_light

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: shell
    group: Shell
    description: 'CHANGE: Stories only: every mode_toggle node in the shell stories passes label "Choose appearance" instead of "Choose theme". component.yml and shell.twig stay byte-identical; story comments are kept.'
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
    variants:
      - id: compact_dark
      - id: compact_light
      - id: cozy_dark
      - id: cozy_light
      - id: default
  variant:
    id: compact_light
    title: compact light
    description: 'Existing shell story compact_light: only the mode_toggle label changes to "Choose appearance"; every other line and every comment stays.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.compact_light.story.yml
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — create-variant-story — shell cozy_dark

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: shell
    group: Shell
    description: 'CHANGE: Stories only: every mode_toggle node in the shell stories passes label "Choose appearance" instead of "Choose theme". component.yml and shell.twig stay byte-identical; story comments are kept.'
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
    variants:
      - id: compact_dark
      - id: compact_light
      - id: cozy_dark
      - id: cozy_light
      - id: default
  variant:
    id: cozy_dark
    title: cozy dark
    description: 'Existing shell story cozy_dark: only the mode_toggle label changes to "Choose appearance"; every other line and every comment stays.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.cozy_dark.story.yml
  ```

  #### Results
  <!-- done -->

- [x] create-variant-story — create-variant-story — shell cozy_light

  Instruction: task:create-variant-story

  #### Params
  ```yaml
  component:
    component: shell
    group: Shell
    description: 'CHANGE: Stories only: every mode_toggle node in the shell stories passes label "Choose appearance" instead of "Choose theme". component.yml and shell.twig stay byte-identical; story comments are kept.'
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
    variants:
      - id: compact_dark
      - id: compact_light
      - id: cozy_dark
      - id: cozy_light
      - id: default
  variant:
    id: cozy_light
    title: cozy light
    description: 'Existing shell story cozy_light: only the mode_toggle label changes to "Choose appearance"; every other line and every comment stays.'
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components/shell/shell.cozy_light.story.yml
  ```

  #### Results
  <!-- done -->

### Step: refresh-components
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:component-contract-index, ctx:sdc-components]

- [x] refresh-components — refresh-components — CI sweep

  Instruction: task:refresh-components

  #### Params
  ```yaml
  command: pnpm exec storybook build
  cwd: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme
  index_url: http://localhost:58031/index.json
  story_ids:
    - bb-theme-action-mode-toggle--default
    - bb-theme-data-display-person--app
    - bb-theme-data-display-person--compact
    - bb-theme-data-display-person--default
    - bb-theme-data-display-person--picture
    - bb-theme-data-display-person--picture-contain
    - bb-theme-data-display-badge--attention
    - bb-theme-data-display-badge--claim
    - bb-theme-data-display-badge--claim-mine
    - bb-theme-data-display-badge--default
    - bb-theme-data-display-badge--idle
    - bb-theme-data-display-badge--list-item
    - bb-theme-data-display-badge--offline
    - bb-theme-data-display-badge--priority
    - bb-theme-data-display-badge--refresh
    - bb-theme-data-display-badge--running
    - bb-theme-data-display-badge--stale
    - bb-theme-data-display-badge--wait
    - bb-theme-data-display-board-card--blocked
    - bb-theme-data-display-board-card--cancelled
    - bb-theme-data-display-board-card--default
    - bb-theme-data-display-board-card--state-pill
    - bb-theme-data-display-board-card--unassigned
    - bb-theme-data-display-board--default
    - bb-theme-data-display-board--operational
    - bb-theme-data-display-board--operational-details
    - bb-theme-data-display-board--phases
    - bb-theme-action-button--danger
    - bb-theme-action-button--default
    - bb-theme-action-button--ghost
    - bb-theme-action-button--primary
    - bb-theme-data-display-event--cancelled
    - bb-theme-data-display-event--created
    - bb-theme-data-display-event--default
    - bb-theme-data-display-event--expired
    - bb-theme-data-display-event--started
    - bb-theme-data-display-event--status-agent
    - bb-theme-data-display-event--status-human
    - bb-theme-data-display-event--structured
    - bb-theme-form-label--default
    - bb-theme-data-display-link-group--default
    - bb-theme-data-display-link-group--self-target
    - bb-theme-data-display-list--cards
    - bb-theme-data-display-list--cards-comfortable
    - bb-theme-data-display-list--default
    - bb-theme-data-display-list--joinable
    - bb-theme-data-display-list--pattern-identity
    - bb-theme-data-display-list--pattern-long
    - bb-theme-data-display-list--pattern-rows
    - bb-theme-data-display-list--pattern-sparse
    - bb-theme-data-display-list--plain
    - bb-theme-data-display-list--rendered
    - bb-theme-data-display-list--variables
    - bb-theme-data-display-message--default
    - bb-theme-data-display-note--attention
    - bb-theme-data-display-note--default
    - bb-theme-data-display-state-flow--default
    - bb-theme-data-display-table--bare
    - bb-theme-data-display-table--collapsed
    - bb-theme-data-display-table--default
    - bb-theme-data-display-table--delivery
    - bb-theme-data-display-table--exact-value
    - bb-theme-data-display-table--external-link
    - bb-theme-data-display-table--timesheet
    - bb-theme-data-display-table--tree
    - bb-theme-data-display-table--unassigned
    - bb-theme-data-display-table--wired
    - bb-theme-shell-shell--compact-dark
    - bb-theme-shell-shell--compact-light
    - bb-theme-shell-shell--cozy-dark
    - bb-theme-shell-shell--cozy-light
    - bb-theme-shell-shell--default
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

- [x] write-scene — write-scene — design-system shell

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: design-system/design-system.scenes.yml
  components_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components
  scene_name: shell
  scene_scope: shell
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
                  label: Choose appearance
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
  components:
    - id: bb_theme:shell
    - id: bb_theme:sidebar
    - id: bb_theme:account_switcher
    - id: bb_theme:menu_item
    - id: bb_theme:nav
    - id: bb_theme:person
    - id: bb_theme:mode_toggle
    - id: bb_theme:status_bar
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/designbook/design-system/design-system.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — write-scene — design-system shell collapsed

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: design-system/design-system.scenes.yml
  components_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components
  scene_name: shell collapsed
  scene_scope: shell
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
                  label: Choose appearance
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
  components:
    - id: bb_theme:shell
    - id: bb_theme:sidebar
    - id: bb_theme:account_switcher
    - id: bb_theme:nav
    - id: bb_theme:person
    - id: bb_theme:mode_toggle
    - id: bb_theme:status_bar
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/designbook/design-system/design-system.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — write-scene — design-system account-shell

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: design-system/design-system.scenes.yml
  components_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/components
  scene_name: account-shell
  scene_scope: shell
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
                  label: Choose appearance
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
  components:
    - id: bb_theme:shell
    - id: bb_theme:sidebar
    - id: bb_theme:account_switcher
    - id: bb_theme:menu_item
    - id: bb_theme:nav
    - id: bb_theme:person
    - id: bb_theme:mode_toggle
    - id: bb_theme:status_bar
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-53-app-erscheinung/web/themes/custom/bb_theme/designbook/design-system/design-system.scenes.yml
  ```

  #### Results
  <!-- done -->

### Step: validate
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:playwright-validate, ctx:component-contract-index, ctx:sdc-components]

- [x] validate — bb-theme-shell-account-switcher--collapsed

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-account-switcher--collapsed&viewMode=story
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

- [x] validate — bb-theme-shell-account-switcher--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-account-switcher--default&viewMode=story
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

- [x] validate — bb-theme-shell-account-switcher--picture

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-account-switcher--picture&viewMode=story
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

- [x] validate — bb-theme-shell-account-switcher--single

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-account-switcher--single&viewMode=story
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

- [x] validate — bb-theme-action-action-menu--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-action-menu--default&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--attention

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--attention&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--claim

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--claim&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--claim-mine

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--claim-mine&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--default&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--idle

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--idle&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--list-item

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--list-item&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--offline

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--offline&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--priority

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--priority&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--refresh

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--refresh&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--running

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--running&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--stale

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--stale&viewMode=story
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

- [x] validate — bb-theme-data-display-badge--wait

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-badge--wait&viewMode=story
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

- [x] validate — bb-theme-data-display-board-card--blocked

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board-card--blocked&viewMode=story
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

- [x] validate — bb-theme-data-display-board-card--cancelled

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board-card--cancelled&viewMode=story
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

- [x] validate — bb-theme-data-display-board-card--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board-card--default&viewMode=story
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

- [x] validate — bb-theme-data-display-board-card--state-pill

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board-card--state-pill&viewMode=story
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

- [x] validate — bb-theme-data-display-board-card--unassigned

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board-card--unassigned&viewMode=story
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

- [x] validate — bb-theme-data-display-board--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board--default&viewMode=story
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

- [x] validate — bb-theme-data-display-board--operational

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board--operational&viewMode=story
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

- [x] validate — bb-theme-data-display-board--operational-details

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board--operational-details&viewMode=story
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

- [x] validate — bb-theme-data-display-board--phases

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-board--phases&viewMode=story
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

- [x] validate — bb-theme-action-button--danger

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-button--danger&viewMode=story
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

- [x] validate — bb-theme-action-button--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-button--default&viewMode=story
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

- [x] validate — bb-theme-action-button--ghost

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-button--ghost&viewMode=story
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

- [x] validate — bb-theme-action-button--primary

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-button--primary&viewMode=story
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

- [x] validate — bb-theme-data-display-copied--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-copied--default&viewMode=story
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

- [x] validate — bb-theme-data-display-copied--hidden

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-copied--hidden&viewMode=story
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

- [x] validate — bb-theme-shell-dialog--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-dialog--default&viewMode=story
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

- [x] validate — bb-theme-data-display-event--cancelled

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--cancelled&viewMode=story
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

- [x] validate — bb-theme-data-display-event--created

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--created&viewMode=story
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

- [x] validate — bb-theme-data-display-event--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--default&viewMode=story
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

- [x] validate — bb-theme-data-display-event--expired

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--expired&viewMode=story
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

- [x] validate — bb-theme-data-display-event--started

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--started&viewMode=story
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

- [x] validate — bb-theme-data-display-event--status-agent

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--status-agent&viewMode=story
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

- [x] validate — bb-theme-data-display-event--status-human

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--status-human&viewMode=story
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

- [x] validate — bb-theme-data-display-event--structured

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-event--structured&viewMode=story
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

- [x] validate — bb-theme-data-display-flow-chart--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-flow-chart--default&viewMode=story
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

- [x] validate — bb-theme-data-display-flow-chart--empty

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-flow-chart--empty&viewMode=story
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

- [x] validate — bb-theme-data-display-flow-chart--full-month

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-flow-chart--full-month&viewMode=story
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

- [x] validate — bb-theme-data-display-flow-chart--month

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-flow-chart--month&viewMode=story
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

- [x] validate — bb-theme-data-display-flow-chart--no-ratio

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-flow-chart--no-ratio&viewMode=story
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

- [x] validate — bb-theme-data-display-flow-chart--single

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-flow-chart--single&viewMode=story
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

- [x] validate — bb-theme-form-label--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-form-label--default&viewMode=story
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

- [x] validate — bb-theme-form-image-crop--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-form-image-crop--default&viewMode=story
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

- [x] validate — bb-theme-data-display-link-group--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-link-group--default&viewMode=story
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

- [x] validate — bb-theme-data-display-link-group--self-target

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-link-group--self-target&viewMode=story
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

- [x] validate — bb-theme-data-display-list--cards

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--cards&viewMode=story
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

- [x] validate — bb-theme-data-display-list--cards-comfortable

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--cards-comfortable&viewMode=story
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

- [x] validate — bb-theme-data-display-list--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--default&viewMode=story
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

- [x] validate — bb-theme-data-display-list--joinable

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--joinable&viewMode=story
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

- [x] validate — bb-theme-data-display-list--pattern-identity

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--pattern-identity&viewMode=story
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

- [x] validate — bb-theme-data-display-list--pattern-long

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--pattern-long&viewMode=story
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

- [x] validate — bb-theme-data-display-list--pattern-rows

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--pattern-rows&viewMode=story
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

- [x] validate — bb-theme-data-display-list--pattern-sparse

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--pattern-sparse&viewMode=story
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

- [x] validate — bb-theme-data-display-list--plain

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--plain&viewMode=story
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

- [x] validate — bb-theme-data-display-list--rendered

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--rendered&viewMode=story
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

- [x] validate — bb-theme-data-display-list--variables

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-list--variables&viewMode=story
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

- [x] validate — bb-theme-shell-menu-item--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-menu-item--default&viewMode=story
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

- [x] validate — bb-theme-shell-menu-item--identity

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-menu-item--identity&viewMode=story
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

- [x] validate — bb-theme-shell-menu-item--picture

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-menu-item--picture&viewMode=story
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

- [x] validate — bb-theme-data-display-message--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-message--default&viewMode=story
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

- [x] validate — bb-theme-action-mode-toggle--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-mode-toggle--default&viewMode=story
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

- [x] validate — bb-theme-navigation-nav--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-navigation-nav--default&viewMode=story
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

- [x] validate — bb-theme-navigation-nav--main

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-navigation-nav--main&viewMode=story
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

- [x] validate — bb-theme-navigation-nav--settings-open

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-navigation-nav--settings-open&viewMode=story
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

- [x] validate — bb-theme-data-display-note--attention

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-note--attention&viewMode=story
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

- [x] validate — bb-theme-data-display-note--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-note--default&viewMode=story
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

- [x] validate — bb-theme-action-option-list--auto-apply

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--auto-apply&viewMode=story
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

- [x] validate — bb-theme-action-option-list--clear-control

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--clear-control&viewMode=story
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

- [x] validate — bb-theme-action-option-list--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--default&viewMode=story
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

- [x] validate — bb-theme-action-option-list--filter-panel

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--filter-panel&viewMode=story
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

- [x] validate — bb-theme-action-option-list--form

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--form&viewMode=story
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

- [x] validate — bb-theme-action-option-list--multiple

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--multiple&viewMode=story
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

- [x] validate — bb-theme-action-option-list--single

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--single&viewMode=story
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

- [x] validate — bb-theme-action-option-list--submit

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-option-list--submit&viewMode=story
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

- [x] validate — bb-theme-data-display-period-range--all-time

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-period-range--all-time&viewMode=story
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

- [x] validate — bb-theme-data-display-period-range--custom-open

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-period-range--custom-open&viewMode=story
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

- [x] validate — bb-theme-data-display-period-range--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-period-range--default&viewMode=story
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

- [x] validate — bb-theme-data-display-period-range--month-past

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-period-range--month-past&viewMode=story
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

- [x] validate — bb-theme-data-display-period-range--quarter-open

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-period-range--quarter-open&viewMode=story
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

- [x] validate — bb-theme-data-display-period-range--year

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-period-range--year&viewMode=story
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

- [x] validate — bb-theme-data-display-person--app

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-person--app&viewMode=story
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

- [x] validate — bb-theme-data-display-person--compact

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-person--compact&viewMode=story
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

- [x] validate — bb-theme-data-display-person--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-person--default&viewMode=story
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

- [x] validate — bb-theme-data-display-person--picture

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-person--picture&viewMode=story
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

- [x] validate — bb-theme-data-display-person--picture-contain

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-person--picture-contain&viewMode=story
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

- [x] validate — bb-theme-form-property-pill--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-form-property-pill--default&viewMode=story
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

- [x] validate — bb-theme-action-setup-command--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-action-setup-command--default&viewMode=story
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

- [x] validate — bb-theme-shell-shell--compact-dark

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-shell--compact-dark&viewMode=story
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

- [x] validate — bb-theme-shell-shell--compact-light

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-shell--compact-light&viewMode=story
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

- [x] validate — bb-theme-shell-shell--cozy-dark

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-shell--cozy-dark&viewMode=story
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

- [x] validate — bb-theme-shell-shell--cozy-light

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-shell--cozy-light&viewMode=story
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

- [x] validate — bb-theme-shell-shell--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-shell-shell--default&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-breakdown--bars

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-breakdown--bars&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-breakdown--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-breakdown--default&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--default&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--empty

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--empty&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--gaps

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--gaps&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--signed

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--signed&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--single

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--single&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--six

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--six&viewMode=story
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

- [x] validate — bb-theme-data-display-stat-comparison--zero

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-stat-comparison--zero&viewMode=story
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

- [x] validate — bb-theme-data-display-state-flow--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-state-flow--default&viewMode=story
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

- [x] validate — bb-theme-data-display-table--bare

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--bare&viewMode=story
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

- [x] validate — bb-theme-data-display-table--collapsed

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--collapsed&viewMode=story
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

- [x] validate — bb-theme-data-display-table--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--default&viewMode=story
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

- [x] validate — bb-theme-data-display-table--delivery

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--delivery&viewMode=story
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

- [x] validate — bb-theme-data-display-table--exact-value

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--exact-value&viewMode=story
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

- [x] validate — bb-theme-data-display-table--external-link

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--external-link&viewMode=story
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

- [x] validate — bb-theme-data-display-table--timesheet

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--timesheet&viewMode=story
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

- [x] validate — bb-theme-data-display-table--tree

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--tree&viewMode=story
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

- [x] validate — bb-theme-data-display-table--unassigned

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--unassigned&viewMode=story
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

- [x] validate — bb-theme-data-display-table--wired

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=bb-theme-data-display-table--wired&viewMode=story
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

- [x] validate — entities-bb-activity-bb-activity--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-activity-bb-activity--full&viewMode=story
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

- [x] validate — entities-bb-comment-bb-comment--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-comment-bb-comment--full&viewMode=story
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

- [x] validate — entities-bb-comment-bb-comment--teaser

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-comment-bb-comment--teaser&viewMode=story
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

- [x] validate — entities-bb-comment-review--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-comment-review--full&viewMode=story
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

- [x] validate — entities-bb-comment-review--teaser

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-comment-review--teaser&viewMode=story
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

- [x] validate — entities-bb-conductor-bb-conductor--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-conductor-bb-conductor--full&viewMode=story
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

- [x] validate — entities-bb-group-bb-group--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-group-bb-group--full&viewMode=story
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

- [x] validate — entities-bb-machine-bb-machine--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-machine-bb-machine--full&viewMode=story
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

- [x] validate — entities-bb-project-bb-project--epics

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-project-bb-project--epics&viewMode=story
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

- [x] validate — entities-bb-project-bb-project--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-project-bb-project--full&viewMode=story
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

- [x] validate — entities-bb-run-bb-run--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-run-bb-run--full&viewMode=story
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

- [x] validate — entities-bb-run-bb-run--overlay

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-run-bb-run--overlay&viewMode=story
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

- [x] validate — entities-bb-run-bb-run--teaser

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-run-bb-run--teaser&viewMode=story
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

- [x] validate — entities-bb-team-bb-team--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-team-bb-team--full&viewMode=story
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

- [x] validate — entities-bb-term-label--teaser

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-term-label--teaser&viewMode=story
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

- [x] validate — entities-bb-ticket-bb-ticket--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-ticket-bb-ticket--full&viewMode=story
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

- [ ] validate — entities-bb-workspace-bb-workspace--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-bb-workspace-bb-workspace--full&viewMode=story
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

- [x] validate — entities-og-membership-default--teaser

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-og-membership-default--teaser&viewMode=story
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

- [x] validate — entities-user-user--compact

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-user-user--compact&viewMode=story
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

- [x] validate — entities-user-user--full

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-user-user--full&viewMode=story
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

- [x] validate — entities-view-addons--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-addons--default&viewMode=story
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

- [x] validate — entities-view-conductor-tickets--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-conductor-tickets--default&viewMode=story
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

- [x] validate — entities-view-conductors--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-conductors--default&viewMode=story
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

- [x] validate — entities-view-environments--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-environments--default&viewMode=story
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

- [x] validate — entities-view-groups--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-groups--default&viewMode=story
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

- [x] validate — entities-view-machines--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-machines--default&viewMode=story
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

- [x] validate — entities-view-project-board--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-project-board--default&viewMode=story
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

- [x] validate — entities-view-projects--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-projects--default&viewMode=story
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

- [x] validate — entities-view-runs--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-runs--default&viewMode=story
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

- [x] validate — entities-view-tickets--default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-view-tickets--default&viewMode=story
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

- [x] validate — entities-user-user--form-default

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-user-user--form-default&viewMode=story
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

- [x] validate — entities-user-user--form-profile

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=entities-user-user--form-profile&viewMode=story
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

- [x] validate — designbook-design-system-scenes--shell

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-design-system-scenes--shell&viewMode=story
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

- [x] validate — designbook-design-system-scenes--shell-collapsed

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-design-system-scenes--shell-collapsed&viewMode=story
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

- [x] validate — designbook-design-system-scenes--gate

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-design-system-scenes--gate&viewMode=story
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

- [x] validate — designbook-design-system-scenes--onboarding

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-design-system-scenes--onboarding&viewMode=story
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

- [x] validate — designbook-design-system-scenes--team-create-action

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-design-system-scenes--team-create-action&viewMode=story
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

- [x] validate — designbook-design-system-scenes--account-shell

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-design-system-scenes--account-shell&viewMode=story
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

- [x] validate — designbook-sections-component-demos--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos--overview&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--segmented-control

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--segmented-control&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--model-comparison

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--model-comparison&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--six-series

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--six-series&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--new-vs-done

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--new-vs-done&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--autosave-toast

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--autosave-toast&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--copied-overlay

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--copied-overlay&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--setup-paths

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--setup-paths&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--inline-add-row

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--inline-add-row&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--ticket-inspector-billing

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--ticket-inspector-billing&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--markdown-textarea

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--markdown-textarea&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--period-range

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--period-range&viewMode=story
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

- [x] validate — designbook-sections-component-demos-scenes--insights-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-component-demos-scenes--insights-overview&viewMode=story
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

- [x] validate — designbook-sections-gate--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate--overview&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--workspace-chooser

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--workspace-chooser&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--workspace-chooser-no-workspaces

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--workspace-chooser-no-workspaces&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--workspace-create

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--workspace-create&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--workspace-join

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--workspace-join&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--check-mail

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--check-mail&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--device-sign-in-done

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--device-sign-in-done&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--device-sign-in-denied

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--device-sign-in-denied&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--device-sign-in-done-long-name

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--device-sign-in-done-long-name&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--device-code-entry

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--device-code-entry&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--device-consent

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--device-consent&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--page-not-found

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--page-not-found&viewMode=story
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

- [x] validate — designbook-sections-gate-scenes--access-denied

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-gate-scenes--access-denied&viewMode=story
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

- [x] validate — designbook-sections-onboarding--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding--overview&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--identity

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--identity&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--about-you

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--about-you&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--setup-install

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--setup-install&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--setup-install-invited

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--setup-install-invited&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--setup-reopen

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--setup-reopen&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--setup-project

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--setup-project&viewMode=story
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

- [x] validate — designbook-sections-onboarding-scenes--setup-project-invited

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-onboarding-scenes--setup-project-invited&viewMode=story
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

- [x] validate — designbook-sections-projects--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects--overview&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--projects

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--projects&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--groups

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--groups&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--group-detail-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--group-detail-overview&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--conductors

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--conductors&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--conductor-detail-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--conductor-detail-overview&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--conductor-detail-overview-idle

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--conductor-detail-overview-idle&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--machines

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--machines&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--machine-detail-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--machine-detail-overview&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--addons

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--addons&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-create

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-create&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-overview&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-overview-teams-open

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-overview-teams-open&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-overview-flowing

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-overview-flowing&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-board

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-board&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-stats

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-stats&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-runs

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-runs&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-members

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-members&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-settings

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-settings&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-time

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-time&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-billing

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-billing&viewMode=story
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

- [x] validate — designbook-sections-projects-scenes--project-detail-billing-new-account

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-projects-scenes--project-detail-billing-new-account&viewMode=story
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

- [x] validate — designbook-sections-settings--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings--overview&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--settings

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--settings&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--workspace-members

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--workspace-members&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--workspace-invite

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--workspace-invite&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--team

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--team&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--team-detail-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--team-detail-overview&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--team-time

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--team-time&viewMode=story
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

- [x] validate — designbook-sections-settings-scenes--team-time-week

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-settings-scenes--team-time-week&viewMode=story
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

- [x] validate — designbook-sections-my-work--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work--overview&viewMode=story
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
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-list&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-list-add-action

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-list-add-action&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--my-time

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--my-time&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--my-time-week

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--my-time-week&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--my-time-empty

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--my-time-empty&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-long-handoff

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-long-handoff&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-reviews-reviewer

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-reviews-reviewer&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-reviews-draft

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-reviews-draft&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-pending-reviews

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-pending-reviews&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-reviews-rejected

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-reviews-rejected&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-reviews-accepted

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-reviews-accepted&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-intervention-layout

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-intervention-layout&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-detail-intervention-layout-cancel-dialog

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-detail-intervention-layout-cancel-dialog&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-create

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-create&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-create-empty

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-create-empty&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-create-rejected

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-create-rejected&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-create-unresolved-context

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-create-unresolved-context&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-inline-edit

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-inline-edit&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--ticket-cancel

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--ticket-cancel&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--project-runs-list

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--project-runs-list&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--run-detail

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--run-detail&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--run-canonical

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--run-canonical&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--run-canonical-finished

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--run-canonical-finished&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--run-canonical-missing-content

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--run-canonical-missing-content&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--comment-canonical

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--comment-canonical&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--comment-canonical-first

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--comment-canonical-first&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--comment-canonical-last

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--comment-canonical-last&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--comment-canonical-long

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--comment-canonical-long&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--comment-canonical-single

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--comment-canonical-single&viewMode=story
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

- [x] validate — designbook-sections-my-work-scenes--stats

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-my-work-scenes--stats&viewMode=story
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

- [x] validate — designbook-sections-user--overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user--overview&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--account-overview

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--account-overview&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--account-edit

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--account-edit&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--account-profile

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--account-profile&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--personal-time

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--personal-time&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--personal-time-week

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--personal-time-week&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--personal-time-week-errors

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--personal-time-week-errors&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--personal-time-week-empty

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--personal-time-week-empty&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--personal-time-week-submission

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--personal-time-week-submission&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--record-time-create

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--record-time-create&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--record-time-edit

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--record-time-edit&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--record-time-error

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--record-time-error&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--api-keys-list

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--api-keys-list&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--api-keys-list-empty

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--api-keys-list-empty&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--api-keys-create

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--api-keys-create&viewMode=story
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

- [x] validate — designbook-sections-user-scenes--api-keys-created

  Instruction: task:validate

  #### Params
  ```yaml
  story_url: http://localhost:58031/iframe.html?id=designbook-sections-user-scenes--api-keys-created&viewMode=story
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

