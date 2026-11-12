# Plan: design-screen
<!-- digest: 5f5ce68cfce15b1857d1b41d8951b17a88cfee2b02829e40711bd61cd396d44b -->

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
    hash: 5bf6bcc75361f69c807783c980cb2b8575d800245d8715d868785f21318a1d9a
  - id: bb_theme:action_menu
    contract:
      component: action_menu
      group: Action
      description: 'A row action menu: a more-horizontal trigger that discloses a role="menu" panel of menu_item links. Built on native <details>/<summary>, so it opens and every action stays reachable without JavaScript; Alpine only closes it on an outside click or Escape. Use it when a list row carries several actions. An item''s optional attributes are merged onto its link, so an action can open in the dialog.'
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: Accessible name of the trigger, naming the row, e.g. "Actions for service-ci-1a2b3c4d".
          items:
            type: array
            title: Items
            description: The actions, in order; each is one menu_item link.
            items:
              type: object
              required:
                - label
                - url
              properties:
                label:
                  type: string
                  title: Label
                url:
                  type: string
                  title: URL
                attributes:
                  type: object
                  title: Attributes
                  description: 'Optional extra link attributes for this item, passed to menu_item, for behavior wiring such as the htmx attributes that open the action''s dialog or confirmation in the overlay. Not a styling channel: no class or style. The menu keeps href and role.'
          align:
            type: string
            title: Align
            enum:
              - start
              - end
            default: end
            description: 'Which edge of the trigger the panel lines up with: end for a menu at the end of a row (it opens toward the row), start for one at the start.'
          open:
            type: boolean
            title: Open
            description: Render the panel disclosed (stories; a no-JS reader toggles it natively).
            default: false
        required:
          - label
          - items
        additionalProperties: false
      slots: {}
      variants:
        - id: default
    source: components/action_menu/action_menu.component.yml
    hash: cced78eb5d6deefb664dbe4704346bc3a0b207a788f9977ab2cb27556b02fec5
  - id: bb_theme:active-filters
    contract:
      component: active-filters
      group: Data Display
      description: 'The summary of what the `filters` aside has narrowed the list to (Polaris''s `appliedFilters`; renamed from `selected_facets` — BB-378 D9/D15, and "active" is the state after applying, which is what this states). It renders in `canvas.main`, above the results, which is where `facet_sidebar` already put it before the layout moved into `canvas`. One chip per chosen filter, SITTING ABOVE THE ROWS it describes: one chip per chosen facet reading field, operator and values — `State is either of working, review` — and, when nothing is chosen, a single plain statement that the list is unfiltered. It is the second half of C22: the aside is where the narrowing is DONE, and a column of eight controls does not answer "what am I looking at" at a glance, so the answer is stated once, where the results are. It spent the third iteration at the top of the aside and the human moved it back out at the fourth gate. ITS LAYOUT FOLLOWS FROM WHERE IT LIVES: the chips wrap in a ROW and the position indicator sits beneath them, left-aligned, because the results column is as wide as the table and a column of chips would push the rows down for nothing. What is not restored along with the row is the spacer that used to shove the indicator to the far right — the human asked for this left-aligned, and a value flung to the opposite edge of a wide region is read last rather than read with the chips. There is one layout, because it renders in one place. THE OPERATOR ADAPTS TO THE NUMBER OF VALUES, derived rather than typed: one value reads `is`, several read `is either of`. That is Linear''s own behaviour and it is a rendering decision, so it lives in the component — a scene that had to type the right operator per facet would eventually type the wrong one. A facet may override it (`includes any of` for labels, `is not` for a negation) and the override is then that facet''s own word. WHAT THIS IS NOT: it reads props and nothing else. It performs no query, writes no URL, and persists no filter set — Linear keeps ad-hoc filters in the URL and a saved set as a custom view in the sidebar, and both of those are wiring that belongs to the ticket which gives this screen a real query. A CHIP IS REMOVABLE, and the affordance is a LINK rather than a button or a script. An earlier revision of this component said the opposite — that a chip is only a statement and that a dismiss affordance here would do nothing — and it deferred the wiring to "the ticket which gives this screen a real query". That ticket arrived: the caller now owns the address the list was narrowed by, so it can hand each facet the address MINUS that facet, and following it is a real removal. The `x` is an anchor because the region this renders inside is boosted: the removal swaps that region''s fragment and pushes the shorter URL exactly as picking a facet does, and it still works with JavaScript off. Nothing here posts, which is the part that never changed. THE LINK REMOVES THE WHOLE FACET, NOT ONE VALUE: a chip is one facet and its sentence is about the facet — `State is either of Working, Review` is one statement, so one control that undoes one statement is the honest granularity, and the accessible name says which (`Remove the State filter`). THAT NAME CARRIES NO COLON ON PURPOSE: it read `Remove filter: State` until 2026-09-04, and on the one surface that matters the strip is a plain-string `#markup` put through `Xss::filterAdmin()`, which protocol-filters attribute values — `filterBadProtocol()` reads everything up to the first colon as a scheme, so the name arrived as ` State`. Measured on the live page. Removing a single value is the filter panel''s job, where every option row is already a real control. A facet with no `remove_url` renders no `x` at all, which is what keeps this component usable by a caller that has no address to offer. THERE ARE TWO WAYS TO GIVE IT ITS CHIPS, AND THE `chips` SLOT IS THE SECOND: `facets` is the props route for a caller that holds the applied set as data, and `chips` is the slot route for a caller that can only hand over already-rendered chips — a Views area whose markup another component produced. The slot wins when both are given, because a caller that filled it has markup this component cannot second-guess. IT EXISTS BECAUSE `empty_label` WAS OTHERWISE UNREACHABLE: `views_filters_summary`''s area is declared `empty: true`, so it renders `[''#markup'' => '''']` when no filter has a value and Views'' `header` is truthy either way — no Views option, no config and no condition tells "the module stated nothing" from "the module was never asked". A component can, because a slot that renders nothing renders nothing: `chips|render|striptags|trim` is the whole test. `striptags` rather than `trim` alone is a claim about the SLOT''S CONTRACT and not about the tickets surface, where `Xss::filterAdmin()` has already removed every comment (measured): a caller that fills the slot from an ordinary render with `twig.config.debug` on hands over `<!-- THEME DEBUG -->` comments, which `trim` keeps. The cost is that a slot whose only content is an image states nothing by this test. THE `chips_only` VARIANT IS THE INNER HALF OF THAT ARRANGEMENT: it writes the sentences from `facets` and renders NO WRAPPER — no root element, no border, no padding, no meta — so the caller nests it inside an outer one that owns the wrapper, the accessible name and the unfiltered statement. A wrapper would double the border the outer already draws, and an always-present wrapper would make the emptiness test always false, which is the defect the variant exists to fix. With no facets it emits nothing at all. THE `x` IS A TEXT GLYPH AND NOT A SPRITE ICON, which is a correction rather than a preference. It used to include `bb_theme:icon` with `x-circle`, and `Xss::getAdminTagList()` holds neither `svg` nor `use`: on the filtered surface the icon was deleted and the anchor arrived with no content, which has a zero box and cannot be clicked. A stylesheet rule used to put a `x` back through `::after`; the glyph belongs here instead, and a text `x` is something no XSS filter has a reason to remove. EVERY STORY OF THIS COMPONENT NOW STATES `variant` EXPLICITLY, INCLUDING THE ONES THAT WANT THE DEFAULT. `storybook-addon-sdc` builds a component''s base args as `...content.variants && { variant: Object.keys(content.variants)[0] }` and spreads them into every generated story, so a story that omits `variant` renders the FIRST DECLARED VARIANT rather than the default one — measured: before `variant: ""` was added below, `active-filters--default` rendered the bare `chips_only` strip with no wrapper and no meta line. The same behaviour already breaks `table--default`, `table--delivery` and `table--unassigned`, which is where it was first seen; `table--bare` is the one table story that escapes it, and it escapes by carrying `variant: ""` exactly as these do. It is a prop in the STORY and not in the component: the SDC schema forbids a `variant` prop under `props:` while `variants:` is populated, and this is the story''s arg rather than the component''s contract. THE DEFAULT STORY EXERCISES THE THREE OPERATOR CASES the component can produce — a single value (`is`), several values with the operator derived (`is either of`), and a field whose own vocabulary overrides it (`includes any of`) — and gives only some of them a `remove_url`, so both renderings of a chip are visible at once. That sentence used to be a comment inside the story file; it is restated here because the story is serialised by the workflow that owns it and cannot carry comments.'
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
                  description: 'The values themselves, rendered in full. The number of them is what decides the operator when none is given. Left out or empty, the chip reads the field alone, with no operator: a filter that is a state rather than a field with values, such as "Unhealthy".'
                  items:
                    type: string
                remove_url:
                  type: string
                  title: Removal address
                  description: The address this list would be at without this facet — the current URL minus this facet's whole entry, computed by the caller because only the caller knows the address. Left out, the chip renders no dismiss affordance, which is the honest rendering for a caller that cannot answer it.
                count:
                  type: integer
                  title: Match count
                  description: 'How many results this filter matches, shown after the sentence as "· N" (BAKERS-55: "Priority is High · 5", "Unhealthy · 3").'
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
        - id: counts
        - id: default
        - id: empty
    source: components/active-filters/active-filters.component.yml
    hash: ef148b1b380eb5486cae0b65d2734095a99f6f2dce97d1d2170db66369c96c90
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
    source: components/badge/badge.component.yml
    hash: f803dcc8a5811e563d65810e8a357a0e290ffe054b0230b908854b778df86aab
  - id: bb_theme:board
    contract:
      component: board
      group: Data Display
      description: |-
        A board: its controls, the active filters, ONE bounded scroll region of columns, and the conductors below it. The board owns its columns: a column is DATA (`columns`, Designbook) or a rendered Views column display (`column_views`, the project Board), and both draw their chrome through the `column()` macro this template declares - there is no column component, because a column is an item of the board exactly as a row is an item of a table (D2/D3; tests/contract/data-display-components.sh B1).

        THE COLUMN MACRO. `{% import 'bb_theme:board' as board %}{{ board.column(c) }}` draws one column from a hash `c`: `label` (column name, or the exact state key when nested), `count`, `tone` (running | attention | wait | idle | neutral: the header dot), `caption` ("last 7 days"), `hints` (list of strings such as "empty: review"), `toggles` (a list of {label, url}: "Show done"; "Show older" and "Hide done"), `collapsed` (header, caption and toggles only), `group` (a panel whose content is a row of nested columns; its count is the sum), `nested` (a state sub-column inside a group: mono label, count, no dot), `terminal` (the Done column: dashed outline, no fill), `content` (rendered cards, or nested columns for a group), `empty` (what an empty column says, such as "No ticket matches these filters."), `pager` and `attributes`. The header sticks to the top of the scroll region; an empty column keeps its header and count. This is the same address `list` uses for `table`'s `cell()`: a component id resolves in Drupal and in Storybook alike.

        THE COLUMN AREA IS THE ONLY SIDEWAYS SCROLL REGION. It is bounded to the viewport height (`max-h-shell-height`) and scrolls both ways, so column headers stick to its top while the page header, the toolbar, the active filters and the conductors stay put. Columns keep at least 240 px at the default density. Native scrolling only: Shift + mouse wheel scrolls the region sideways without any script, and no scrollbar is drawn. A hairline with the shadow-2 token sticks to the right edge while columns are cut off; a cover of the page surface at the end of the row hides it once the last column is in view.

        `details` and `done_open` are the real Details and Done preferences: on the data columns they split Working by state and open Done. The story-only operational mode (Owner select, Done 10/25/50, client-side filtering) is gone (BAKERS-55 Decision 23).
      props:
        type: object
        properties:
          columns:
            type: array
            title: Columns
            description: The columns, in render order, as DATA - never rendered column components. Each renders through the `column()` macro of this template. A column named Working splits by state with `details`; a column named Done collapses unless `done_open`.
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
                  description: Displayed count; defaults to the number of cards.
                dot:
                  type: string
                  enum:
                    - running
                    - attention
                    - wait
                    - idle
                  title: Header tone
                  description: 'Tone of the column header dot: wait for Not assigned, attention for Intake, running for Working, idle for Done. The name always says what the column is, so the dot never carries meaning alone.'
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
                      blocked_by:
                        type: array
                        items:
                          type: string
                        title: Blocked by
                        description: Identifiers of the open blockers the reader may view, rendered in mono after "Blocked by". Replaces the former `blocked` flag, which counted closed blockers too.
                      blocked_hidden:
                        type: boolean
                        default: false
                        title: Hidden blocker
                        description: The ticket has an open blocker the reader may not view. With an empty `blocked_by` the marker reads "Blocked by" alone and names nothing, so no identifier leaks across access.
                      run_count:
                        type: integer
                        title: Run count
                        description: How many runs the ticket has. Zero or absent renders no run line.
                      last_run_state:
                        type: string
                        enum:
                          - claimed
                          - running
                          - done
                          - expired
                          - failed
                          - cancelled
                        title: Newest run state
                        description: The state of the newest run. `failed` and `expired` turn the run line red.
                caption:
                  type: string
                  title: Caption
                  description: Meta line under the header, such as "last 7 days".
                toggles:
                  type: array
                  title: Toggle links
                  description: 'Links that change what the column shows: "Show done" when Done is closed, "Show older" and "Hide done" when it is open, "Hide done" once older tickets show. Links, so they work without JavaScript.'
                  items:
                    type: object
                    properties:
                      label:
                        type: string
                      url:
                        type: string
                    required:
                      - label
                      - url
          details:
            type: boolean
            default: false
            title: Details
            description: 'States instead of Phases: the data column named Working becomes a group with one nested column per state plan, working and review that has cards, and the hint "empty: <state>" for each that has none. Its count stays the sum.'
          done_open:
            type: boolean
            default: false
            title: Done open
            description: Shows the cards of the data column named Done; closed, that column keeps only its header, caption and toggles.
        required: []
        additionalProperties: false
      slots:
        empty:
          description: 'What an empty data column says: the caller''s sentence. Without it the column keeps only its header and count.'
          required: false
        toolbar:
          description: 'The filter bar above the columns: `bb_theme:filters` with layout toolbar.'
          required: false
        column_views:
          description: The paged Views column displays, each drawn through `board.column()`. When filled, the data `columns` are not rendered.
          required: false
        filters_active:
          description: 'The active filter chips with their counts and "N of M open tickets": `bb_theme:active-filters`.'
          required: false
        conductors:
          description: The Active conductors section below the columns, not affected by ticket filters.
          required: false
      variants:
        - id: controls
        - id: default
        - id: details
        - id: phases
    source: components/board/board.component.yml
    hash: 0e45cddfa2370eb53bbe9a47ff35949aea255c1f578d3e4d5f165413257cf3c8
  - id: bb_theme:board-card
    contract:
      component: board-card
      group: Data Display
      description: |-
        Compact card for one item of a board: an identifier, an optional priority tag, a clamped title, and a footer slot for the claim, the status and the assignee.

        ITS NAME WAS ALREADY GENERIC AND ITS CONTRACT WAS NOT. Every prop title named the one entity the board happened to hold, which made a card that draws an identifier, a title, a tag and an accent edge read as though it could draw nothing else. What a board holds is the BOARD'S knowledge, and the mapping's: the card takes an identifier and a title, and it does not ask what they identify.


        A BLOCKED CARD NAMES ITS BLOCKERS AND A CARD STATES ITS RUNS (BAKERS-55). The blocked marker reads "Blocked by" plus the identifiers in `blocked_by`, or "Blocked by" alone with `blocked_hidden`. The run line reads "N runs - last <state>" ("1 run" for one), red for a failed or expired newest run, and is absent without runs. The "Cancelled" marker is unchanged.
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
          url:
            type: string
            title: Canonical URL
          lease:
            type: string
            title: Holder of the lease
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
          done_label:
            type: string
            title: Done time label
            description: When a closed ticket was done, formatted by BbDate ("3 days ago"). With it or `mr_url` the footer says "Done …" and links the merge request instead of the lease and state line.
          done_datetime:
            type: string
            title: Done time, ISO 8601
          done_title:
            type: string
            title: Done time, full date shown on hover
          mr_url:
            type: string
            title: Merge request URL
          mr_label:
            type: string
            title: Merge request label
          blocked_by:
            type: array
            items:
              type: string
            title: Blocked by
            description: Identifiers of the open blockers the reader may view, rendered in mono after "Blocked by". Replaces the former `blocked` flag, which counted closed blockers too.
          blocked_hidden:
            type: boolean
            default: false
            title: Hidden blocker
            description: The ticket has an open blocker the reader may not view. With an empty `blocked_by` the marker reads "Blocked by" alone and names nothing, so no identifier leaks across access.
          run_count:
            type: integer
            title: Run count
            description: How many runs the ticket has. Zero or absent renders no run line.
          last_run_state:
            type: string
            enum:
              - claimed
              - running
              - done
              - expired
              - failed
              - cancelled
            title: Newest run state
            description: The state of the newest run. `failed` and `expired` turn the run line red.
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
        - id: blocked_hidden
        - id: cancelled
        - id: default
        - id: done
        - id: runs
        - id: runs_failed
        - id: state_pill
        - id: unassigned
    source: components/board-card/board-card.component.yml
    hash: 1d564e9b7ef5405442b3c6d231f3e73957401a43b8a848eaeddb37eebba7a8c2
  - id: bb_theme:brand
    contract:
      component: brand
      group: Shell
      description: bakers.build login heading with the logo and wordmark.
      props:
        type: object
        properties:
          size:
            type: string
            enum:
              - default
              - compact
            title: Size
            description: '`default` is the full mark onboarding uses. `compact` is the 200px mark at the top left of the gate''s band, so a gate page''s message rather than its mark is the dominant element. The compact mark is a plain image, leaving the screen its h1; its width comes from `component.brand.compact.width` and does not follow the layout density.'
            default: default
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: compact
        - id: default
    source: components/brand/brand.component.yml
    hash: c65121c6e58393967796214f0bdf0817af1e327586b42a0d0e09659fa6f5482f
  - id: bb_theme:breadcrumb
    contract:
      component: breadcrumb
      group: Layout
      description: 'A generic trail of ordered places. Each item is a label plus an optional url: linked crumbs are anchors; the current crumb has no url and carries aria-current=page. Empty items render nothing. Separators are decorative. The component does not know any product entity.'
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
      variants:
        - id: default
    source: components/breadcrumb/breadcrumb.component.yml
    hash: 45f639e61693f22da973f78aa2ade5015e1d4c73240efe9d00ad33cbda5da84e
  - id: bb_theme:button
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
          pressed:
            type: boolean
            title: Pressed
            description: Makes the control a TOGGLE and says whether it is on. A `<button>` carries `aria-pressed` true or false; a link (a filter that navigates, such as an assignee avatar on the Board filter bar) carries `aria-current="true"` while it is on, because a link cannot be pressed. On, it takes the primary look, the house look of an active filter chip. Absent, the control is not a toggle and renders as before.
          aria_label:
            type: string
            title: Accessible name
            description: 'Overrides the accessible name when the visible content does not say enough, such as an avatar and a count: "Christian Wiedemann, 18 tickets" for a toggle that shows "CW 18". Wins over the `icon_only` name.'
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
        - id: toggle
    source: components/button/button.component.yml
    hash: 243e210b6d71b01b212131660dbd18e937c9b022d3e4a9eaffbb9cef9b02746b
  - id: bb_theme:canvas
    contract:
      component: canvas
      group: Layout
      description: 'The work surface of the app — the ONE layout component a screen puts into the shell''s `content` slot, and the only place the relation between a screen''s header, its filters, its main region and its inspector is written down. Renamed and generalised from `detail_layout` (BB-378 D9/D12): it is no longer the detail view''s layout but every screen''s. `header` spans the full width; below it a grid places `filters` on the leading edge (236px, sticky), `main` (`minmax(0,1fr)`) and `inspector` (320px), collapsing to a single column below `lg`. Each aside drops out of the grid template entirely when its slot is empty, so a screen that fills only `main` renders one column with no empty gutter — exactly as `detail_layout` already did. It is NOT a scroll container (`items-start`, and no clipping declaration anywhere): a scrolling ancestor here would take the sticky `inspector` and the sticky `filters` their stick and would clip every absolutely positioned picker panel a `meta_row` or a facet control opens (D6, D12, BB-332 R9). THE DEFAULT STORY IS DELIBERATELY THE TWO-REGION CASE — a header, a main region and an inspector, with no `filters` aside — so the reference render is the one that shows the 236px track dropping out of the grid template rather than rendering an empty gutter; `with_filters` is the three-region render.'
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
      variants:
        - id: default
        - id: with_filters
    source: components/canvas/canvas.component.yml
    hash: db2feede4b5d7888d23fdcbb054793943139ba74a23625bb7d65f6145e4baee1
  - id: bb_theme:collapsible
    contract:
      component: collapsible
      group: Layout
      description: 'A native <details>/<summary> collapsible, not a scripted accordion. Renamed from `disclosure` (BB-378 D9): the markup and behaviour are untouched. Storybook never calls Drupal.attachBehaviors, so a JS-driven collapse would be a dead control on this review surface — clicking it would do nothing. <details> needs no JavaScript at all and keeps working with JavaScript disabled entirely, which is why this component ships with no behaviour script of its own attached (D2, R1). The chevron affordance rotates via a pure CSS ancestor selector, not a script.'
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
      variants:
        - id: default
        - id: empty
        - id: open
    source: components/collapsible/collapsible.component.yml
    hash: eec4df84b06ea8bd28074d75b0097bc6d9ab01e356903de2697345d679b80b8f
  - id: bb_theme:collection-position
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
      variants:
        - id: default
        - id: unknown_total
    source: components/collection-position/collection-position.component.yml
    hash: f42a0a860541adaef9d4226d77183e7efd244513e18e980b888ae147bfd65e47
  - id: bb_theme:copied
    contract:
      component: copied
      group: Data Display
      description: An absolutely positioned copy confirmation such as `Copied`, rendered as the same `button` chrome as Copy, just below that control and opaque. The parent is `relative`. A script can rewrite the label and `hidden` in place, and typically clears the message so the overlay hides again. An empty message renders hidden. Distinguishes from `toast`, which is viewport-fixed for a page-level confirmation.
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
      variants:
        - id: default
        - id: hidden
    source: components/copied/copied.component.yml
    hash: c131fb6e4d28c5fbb898d0ad765abba43bbe25db3678d7869546e8f80a27b293
  - id: bb_theme:dialog
    contract:
      component: dialog
      group: Shell
      description: |-
        Generic centered dialog hull for every add, edit, cancel and confirm surface. It fills the page overlay slot and owns nothing but the hull: a title row with an optional ghost close button, then the message, body and actions slots in that order. The message slot sits ABOVE the body so a refusal appears where the writer is looking. The state is the dialog element's own open attribute, rendered from the open prop, so the surface is readable with JavaScript disabled. Which actions need a confirmation is not this component's decision — the rule is written down in designbook/design-system/action-pattern.md, and a confirmation is this same component with prose in body and two actions rather than a second component. Distinct from command_palette, which is a dialog hard-wired to the ⌘K palette. Replaces the `island` module's own default hull (BB-420 Task 36): `replaces: island:dialog` below is core SDC's own override mechanism (`ComponentPluginManager::alterDefinitions()`, negotiated by `ComponentNegotiator::maybeNegotiateByTheme()`), so any wrapper format registered against `island:dialog` — `island_dialog` itself, the only one left after this task — renders THIS component instead whenever bb_theme is the active theme. No second wrapper-format registration is needed for that; `bb_core` used to carry one (`bb_dialog`) and it is gone. SDC validates `replaces` compatibility on PROPS only, never slots — the slot contract above (`context`, `message`, `body`, `actions` being a superset of island:dialog's `message`/`body`) is documented, not enforced, which is a deliberate operator decision recorded on this task rather than an oversight.

        Why `libraryOverrides`: THE BEHAVIOUR IS island'S, AND `replaces:` DOES NOT CARRY IT — which is why this block exists and why it is not optional. SDC resolves the override before any library is attached: `ComponentNodeVisitor::enterNode()` compiles `attach_library($component->getLibraryName())` for whichever component's own template is being compiled, so on a site where this theme is active the library attached is THIS component's and island's is never reached. Until BB-421's re-entry this component shipped its own `dialog.js` beside this file, picked up by `ComponentPluginManager::libraryFromDefinition()`'s filename convention; that file is deleted and the behaviour lives in `island/js/island.dialog.js`, so the dependency has to be stated here.

        IT ALSO FIXES A LATENT BUG THE MOVE EXPOSED (measured, BB-421 re-entry). Without a `libraryOverrides` block a component's library declares NO dependencies at all — core appends `core/drupal` only when one is present (`ComponentPluginManager::libraryFromDefinition()`). The deleted `dialog.js` therefore closed over `Drupal` and `once` while depending on neither, and its attachment was order-dependent: reliable in isolation, intermittently absent in a full browser run, observed as a hull carrying no `data-once` marker at all. `island/dialog` declares `core/drupal`, and core adds it here on top of that — the overrides block alone is what triggers that.

        HAND-AUTHORED UNDER A NAMED EXCEPTION, on the operator's decision of 2026-09-09. `web/themes/custom/bb_theme/components/` is bound to `designbook:debo` by WORKFLOW.md, and debo owns components, stories, scenes, entity mappings and design tokens — it has no workflow for a component's behaviour file or for its library dependencies, so there is no debo path this edit could have taken.
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
      variants:
        - id: default
    source: components/dialog/dialog.component.yml
    hash: 507a09a25676a33ae7d0227246cafaff0d2a39750d30b27a28eb6677e174e041
  - id: bb_theme:empty-state
    contract:
      component: empty-state
      group: Data Display
      description: 'A NAMED absence. The message is required and must say what is not there and over what period — "no tickets closed in this window", never a bare dash — because on a dashboard an empty figure and a broken figure look identical, and only the sentence tells them apart. Usable in two places by design (BB-333 D10/D14): free-standing, where a whole statistics block has nothing to show, and inside `board`''s `empty` slot, where a phase is genuinely unstaffed. It renders no action: an absence this component describes is a fact about the data, not an invitation, and the add affordance is owned by the screen that can receive the addition.'
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
          title:
            type: string
            title: Title
            description: A heading for a PAGE-LEVEL empty state that stands in for a whole screen body, such as "No tickets yet" on the project Overview. With a title the state uses the page layout (centred, dashed outline, large icon) and the message reads as prose under the heading.
        required:
          - message
        additionalProperties: false
      slots: {}
      variants:
        - id: default
        - id: in_column
        - id: page
    source: components/empty-state/empty-state.component.yml
    hash: 9c596fef0f74c52c60c0dfa72ee0688d75084caa4afb78ea440990d51e3b2e48
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
          compact:
            type: boolean
            default: false
            title: Compact row
            description: 'One 36 px line for the project Overview: a 24 px avatar and who, what, ticket, detail and when in fixed columns; no tag, no role badge, no rich body. Only the project Overview passes it; every other activity feed keeps the full entry.'
        required:
          - author_name
          - author_initials
        additionalProperties: false
      slots: {}
      variants:
        - id: cancelled
        - id: compact
        - id: created
        - id: default
        - id: expired
        - id: started
        - id: status_agent
        - id: status_human
        - id: structured
    source: components/event/event.component.yml
    hash: 3f9ac347f5a5b38a709338f8efb81fa9e82c192a032d5796fdf7ca94632d2439
  - id: bb_theme:filters
    contract:
      component: filters
      group: Layout
      description: 'The controls that narrow a list, and nothing else — Polaris''s word for exactly this (BB-378 D9/D15, renamed and narrowed from `facet_sidebar`). It fills `canvas.filters`. What it LOST in the rename is the point of the rename: the two-column relation between the controls and the results is the canvas''s region model now (D8), so this component owns no layout, no `results` slot and no `summary` slot — the statement of what has been chosen is an `active-filters` in `canvas.main`, directly above the rows it describes, which is where `facet_sidebar` already rendered it. Nothing here says "facet" either: the aside is where a list is narrowed, and whether that narrowing is a facet, an exposed filter or a saved view stays open (F11). THE PANEL COLLAPSES by composing `bb_theme:collapsible` rather than by carrying a second collapse of its own, and the reason that component is native carries over word for word: Storybook never calls `Drupal.attachBehaviors`, so a scripted collapse would be a dead control on the surface this screen is reviewed on, and a click that answers with nothing is worse than no affordance at all. Composing it keeps ONE collapse mechanism in the theme, and the `Filters` heading becomes the real `<summary>`; the heading keeps its eyebrow treatment because the label is a span of its own whose font size and colour win over the summary''s. WHAT THIS IS NOT: nothing here fetches, posts or persists anything. Search API, the facets module, and Linear''s saved views — a filter set kept as a custom view in the aside, favouritable and settable as the default page, scoped to a workspace or a team — are all wiring, and wiring is out of scope for the whole 327 tree. Ad-hoc filter state lives in the URL in that model, which is likewise a wiring decision; the shape is agreed here so the ticket that adds the query has nothing to restructure.'
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
              - toolbar
            default: panel
            title: Layout
            description: '`panel` (default) is the collapsible aside of facet controls, filled with `bg-app` so it reads as a surface. `bar` is the search toolbar directly above the rows: a `role="search"` region with the same surface, no heading and no collapse, whose controls form one wrapping row — the first control grows, later ones keep their own width — and which submits its fields'' form itself (a select on change, a text field 500ms after typing), because those fields sit outside the exposed `<form>`. `title` and `collapsed` apply to `panel` only. `toolbar` is the board filter bar: the same `role="search"` region and self-submitting fields as `bar`, but no surface and no border, one centred row of at least 36 px (wrapping only when narrow) whose first control (the search) is 240 px wide, and a trailing `actions` group pushed to the right.'
        required: []
        additionalProperties: false
      slots:
        controls:
          description: The narrowing controls, one per field, stacked in the aside. Normally `option_picker` components — the same pill grammar the dialogs use, so a filter reads and announces itself exactly like a property. Renamed from `facets` with the vocabulary (D8).
          required: false
        actions:
          description: 'Trailing controls of the `toolbar` layout, right-aligned: the Details segmented control and "Clear filters".'
          required: false
      variants:
        - id: bar
        - id: collapsed
        - id: default
        - id: toolbar
    source: components/filters/filters.component.yml
    hash: 9a03b4c26671e16935080ce87b19c0cdb7d096005367ae4be4cccf132b46a766
  - id: bb_theme:flow-chart
    contract:
      component: flow-chart
      group: Data Display
      description: 'Two series — tickets created ("new") and tickets closed ("done") per section — on one category/value plot, drawn client-side by Chart.js, with the area between them filled: the `chart-flow-grows` tint where new exceeds done and the `chart-flow-shrinks` tint where done exceeds new, split where the lines cross. A running section ends the lines dashed; running and cut sections get hollow points. Hover or keyboard focus on the canvas highlights one section and shows its exact values in a tooltip and a polite live region. The component computes nothing: totals, the done-to-new ratio and every value are prepared by the caller. Heading, ratio, legend and the exact-value disclosure are plain markup and stay readable without the canvas. Sample demonstrations use illustrative values, never live tenant observations.'
      props:
        type: object
        properties:
          chart:
            type: object
            title: Chart
            description: Values and labels for the client-side flow plot.
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
                description: Heading and the canvas's accessible name.
              caption:
                type: string
                title: Caption
                description: Short context beside the heading, such as the grouping and time zone.
              ratio:
                type:
                  - string
                  - 'null'
                title: Ratio
                description: Prepared done-to-new ratio; null renders an em dash.
              ratio_label:
                type: string
                title: Ratio label
              totals:
                type: object
                title: Totals
                description: Prepared totals shown in the legend.
                properties:
                  new:
                    type: string
                  done:
                    type: string
              open_at:
                type:
                  - string
                  - 'null'
                title: Open at
                description: Time the running section's open count was taken.
              sections:
                type: array
                title: Sections
                description: One entry per point on the shared X axis, in order.
                items:
                  type: object
                  properties:
                    label:
                      type: string
                    new:
                      type: number
                    done:
                      type: number
                    open:
                      type:
                        - number
                        - 'null'
                    running:
                      type: boolean
                      description: The section has not ended yet.
                    cut:
                      type: boolean
                      description: The section is only partly inside the period.
            required:
              - state
              - label
              - sections
        required:
          - chart
        additionalProperties: false
      slots: {}
      variants:
        - id: default
        - id: empty
        - id: full_month
        - id: month
        - id: no_ratio
        - id: single
    source: components/flow-chart/flow-chart.component.yml
    hash: 9186d49892a394a37f4d22c75362479d39194892700d59307a2a31ddbe1799a4
  - id: bb_theme:form
    contract:
      component: form
      group: Form
      description: 'An add or edit surface, and it owns its fields. Its contract is deliberately NOT a list of fields: the widget grammar in designbook/design-system/action-pattern.md is a rule and not a style — "every add, edit and organisation surface uses it without variation" — and its first line rejects the shape a flat field list would produce, "the dialog is not a form of labelled rows". A flat fields[] array would let a caller build three text lines, or two prominent properties, or a column of labelled rows, all of which the grammar forbids; lead + lines + pills + actions cannot express any of them, so the grammar is carried by the type rather than described beside it. The four regions are SLOTS since BB-420 Task 20, where they were props before, and the reason is the create-ticket dialog: its fields are real Drupal field widgets, a widget renders itself, and rendered content cannot go into a prop. The caller renders each field — a real form element (`bb_theme:form_input` / `bb_theme:form_textarea`, since BB-420 Task 31 retired the bespoke `text_line`) for a line, property_pill for a peer or a lead — and this component places what it is handed. Four NAMED slots keep "no flat field list" exactly as four named props did: there is no slot that would take a second pill in the lead row, a column of pills, or a labelled row. What the change did cost is lead''s cardinality. lead was an object, and grammar 3a — at most one emphasised property per surface, because "a surface where everything is emphasised emphasises nothing" — was carried by that type. A slot cannot carry a cardinality: core''s slot definition admits only title, description and examples, and ComponentValidator does not validate slot content at all. The rule did not become a comment — it moved to the one place that can still check it, the FORM DISPLAY, where BbTicketCreateForm refuses to build a surface whose display configures two fields with surface_region lead, and a kernel test pins that refusal. lead_label is a prop for the same reason: the lead row names itself from the property it holds, and with lead rendered by the caller that label is no longer readable from it. Where the form is the body of a dialog the hull owns the action row and actions is left empty — a confirmation or a create dialog is the dialog component with two actions, never a second component. A surface of one line has no wrapper, and that is the line''s own job now rather than a branch of this component: page_header''s editable heading renders `bb_theme:form_input` directly (BB-420 Task 31; formerly `text_line`), because a heading takes phrasing content and a surface is what you reach for when there is more than one thing to place.'
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
      variants:
        - id: default
        - id: pills
    source: components/form/form.component.yml
    hash: 587bccdc1edd4aa574ad205dcb6a4149a5496f42c07d11979e2f4fe95ef555fd
  - id: bb_theme:form_check
    contract:
      component: form_check
      group: Form
      description: Native checkbox or radio input with the shared focus ring; the label belongs to the wrapping form_element.
      props:
        type: object
        properties:
          type:
            type: string
            title: HTML input type
            enum:
              - checkbox
              - radio
          name:
            type: string
            title: Name attribute
          id:
            type: string
            title: ID attribute
          value:
            type: string
            title: Value
          checked:
            type: boolean
            title: Checked
          required:
            type: boolean
            title: Required
          disabled:
            type: boolean
            title: Disabled
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: default
        - id: radio
    source: components/form_check/form_check.component.yml
    hash: 9a4031629597538404928ebf3b7aecf56f83025c4d409dbce6d5632b694ed827
  - id: bb_theme:form_field
    contract:
      component: form_field
      group: Form
      description: 'One form field around its control: label, help text and errors in core''s order and with core''s classes. In a block parent it owns the space below the field (`stack`), so every form stacks its fields evenly; the last field adds none. A flex or grid parent spaces the field with its own gap.'
      props:
        type: object
        properties:
          type:
            type: string
            title: Element type
            description: The form element type, e.g. textfield, checkbox, select.
          name:
            type: string
            title: Element name
          title_display:
            type: string
            title: Title display
            enum:
              - before
              - after
              - invisible
              - attribute
              - none
          label_display:
            type: string
            title: Label position
            enum:
              - before
              - after
              - invisible
              - attribute
              - none
          description_display:
            type: string
            title: Description position
            enum:
              - before
              - after
              - invisible
          description_id:
            type: string
            title: Description ID
            description: Keeps the control's aria-describedby pointing at the help text.
          disabled:
            type: boolean
            title: Disabled
        required: []
        additionalProperties: false
      slots:
        label:
          description: Label
          required: false
        prefix:
          description: Prefix
          required: false
        children:
          description: Control
          required: false
        suffix:
          description: Suffix
          required: false
        errors:
          description: Errors
          required: false
        description:
          description: Description
          required: false
      variants:
        - id: default
    source: components/form_field/form_field.component.yml
    hash: 627dc4cfb5f9f9c26afd4aae7d1dfe49ec22edcebd7264a13392bf0831f3b1be
  - id: bb_theme:form_input
    contract:
      component: form_input
      group: Form
      description: Lean text-based input element; the input type is set via the type prop.
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
      variants:
        - id: default
    source: components/form_input/form_input.component.yml
    hash: 7b853a2693b41f84ec6acda8d60d8f2c4d2e335de413bc9ffbe33c269eabf301
  - id: bb_theme:form_label
    contract:
      component: form_label
      group: Form
      description: Form label rendered inside a form element's label slot.
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
    source: components/form_label/form_label.component.yml
    hash: a2e10b3c0868c00fb7f7322ce479669ff44e471af0649f6737489263a9c7b118
  - id: bb_theme:form_rich_text
    contract:
      component: form_rich_text
      group: Form
      description: 'Markdown authoring control: a formatting toolbar (Heading, Bold, Italic, Code, Link, Bullet list, Numbered list) over a plain textarea. The toolbar is `<markdown-toolbar for="{id}">` from @github/markdown-toolbar-element (registered by form_rich_text.src.js); it only inserts Markdown syntax into the textarea, so the submitted value is exactly the textarea text. Without JavaScript the custom element never upgrades and the toolbar is hidden (`markdown-toolbar:not(:defined)`), leaving the plain textarea. Distinct from rich-text, which displays already-processed HTML, and from form_textarea, the plain box.'
      props:
        type: object
        properties:
          name:
            type: string
            title: Name attribute
          id:
            type: string
            title: ID attribute
            description: 'Required: the toolbar targets the textarea by id (`for`).'
          value:
            type: string
            title: Value
            description: Markdown source, printed as the textarea text node with no surrounding whitespace.
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
          disabled:
            type: boolean
            title: Disabled
            description: 'Read-only body: renders the textarea disabled and no toolbar.'
            default: false
        required:
          - id
        additionalProperties: false
      slots: {}
      variants:
        - id: default
    source: components/form_rich_text/form_rich_text.component.yml
    hash: c44fe8a3546ea00b78c0ce1dc15dbc9045be3bbda57a3bb03fd1f277e00a5ba4
  - id: bb_theme:form_select
    contract:
      component: form_select
      group: Form
      description: 'Native select element styled like `form_input`, and never wider than its container. It carries no label (the wrapping form_label/form_element owns it) and passes the real Drupal `attributes` straight through. `options` is the shape Drupal''s `form_select_options()` gives `select.html.twig`: `{ value, label, selected }` entries and `{ type: optgroup, label, options }` groups.'
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
      variants:
        - id: default
    source: components/form_select/form_select.component.yml
    hash: f0401c08f0b219da97bc1f1695051f71be11422e539c727a156fbb349d4f20ab
  - id: bb_theme:form_textarea
    contract:
      component: form_textarea
      group: Form
      description: Lean multi-line text input; the textarea counterpart of form_input.
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
      variants:
        - id: default
    source: components/form_textarea/form_textarea.component.yml
    hash: a4b27deca7182dc3cbfce6ca6de7d054eb672a3eaedf1922c16fb25962aa6760
  - id: bb_theme:gate
    contract:
      component: gate
      group: Shell
      description: 'The product''s second chrome, and the peer of `shell` rather than a variant of it: a flat butter band with the product mark and the slogan beside the page''s own title and content, framing everything standing BEFORE the product (sign-in, workspace choice and create, device sign-in, OAuth, errors), on a surface that is by definition outside every workspace. It carries no navigation and no link out — the rail is workspace-ambient and would render a menu whose entries lead nowhere — and it shares no slot with `shell`. From `lg` the band and the content sit side by side in one rounded frame of about 1100×640px centred on the page; below that the band stacks on top.'
      props:
        type: object
        properties:
          title:
            type: string
            title: Title
            description: The page's heading, its single `h1`. A prop rather than a slot because it is a scalar the page layout supplies once for every screen this chrome frames.
          description:
            type: string
            title: Description
            description: 'One sentence under the heading, naming what this gate is for. Optional: a chooser whose list speaks for itself needs none.'
          claim:
            type: string
            title: Claim
            description: 'The slogan under the mark in the band, plain text and never a heading: the page''s title is its single `h1`. Defaults to the owner''s call to action, "Knead it. Ship it."'
          explanation:
            type: string
            title: Explanation
            description: Optional plain text in the band, continuing the sentence above it, saying why this page asks. A multi-step flow such as onboarding sets one per step; sign-in and the other gates leave it out and render unchanged.
          progress:
            type: string
            title: Progress
            description: The reader's position in a multi-step flow, such as "Step 3 of 4", above the title. It carries `aria-current="step"`. Optional.
          steps:
            type: array
            title: Steps
            description: 'The steps of a multi-step flow, drawn as one segment each above the title. Each has a label and a state: `done`, `current` or `upcoming`. Optional; sign-in and the other gates leave it out.'
            items:
              type: object
              properties:
                label:
                  type: string
                state:
                  type: string
                  enum:
                    - done
                    - current
                    - upcoming
              required:
                - label
                - state
          title_in_band:
            type: boolean
            title: Title in band
            description: Puts the heading and its sentence in the band instead of the slogan, leaving the right side for the form alone. For a multi-step form such as onboarding; off by default.
          focus_title:
            type: boolean
            title: Focus title
            description: Moves keyboard focus to the heading when the gate renders. For a flow that swaps its steps in place, so a screen reader announces the new step; off by default.
        required: []
        additionalProperties: false
      slots:
        mark:
          description: The product mark above the slogan in the band. A slot and not a prop because a mark is rendered content — an icon component or an image — and props carry scalar data only.
          required: false
        content:
          description: 'The one region a screen fills. A scene opens with `scene: "design-system:gate"` and fills exactly this, the same way a product screen fills `shell`''s `content`.'
          required: false
      variants:
        - id: default
        - id: explained
    source: components/gate/gate.component.yml
    hash: a47366c2f088046abed2da7a7567815d15c9af70f02e7859616a8496c678c62d
  - id: bb_theme:gate_form
    contract:
      component: gate_form
      group: Shell
      description: 'The frame of a form that stands in the gate beside its butter band: login, the e-mail code, device sign-in, and creating or joining a workspace. Core''s form elements carry no spacing of their own, so this frame owns the gap between the copy, the form items and the action row, lays the action row out, and gives inputs, buttons and links their keyboard focus ring. A form template passes its attributes and rendered children here and adds nothing of its own.'
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
          tag:
            type: string
            enum:
              - form
              - div
            title: Tag
            description: '`form` (default) for a form of its own; `div` when the parts already stand inside a `<form>` that wraps a larger frame, as in the onboarding wizard.'
            default: form
          pills:
            type: boolean
            title: Pill buttons
            description: Gives the buttons the pill shape of sign-in without making them full width, so a main action and its alternatives stand side by side. Default off.
            default: false
          divider:
            type: string
            title: Divider
            description: The word on the dashed divider between the form's own action and the `alternative`. Default "or".
        required: []
        additionalProperties: false
      slots:
        content:
          description: The form's rendered children — copy, form items and the action row — in their own order.
          required: false
        alternative:
          description: A second way in, such as "Continue with Google". When filled, the form's buttons become full-width pills and the divider stands between the two.
          required: false
      variants:
        - id: default
    source: components/gate_form/gate_form.component.yml
    hash: acb70fa501eebfb7c265feeca9a882063047c8dd8c869f8d4315b193b853971e
  - id: bb_theme:icon
    contract:
      component: icon
      group: Media
      description: Renders the bakers UI Icons pack through the Drupal Icon API. Storybook provides a preview implementation of icon().
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
      variants:
        - id: default
    source: components/icon/icon.component.yml
    hash: 7dcb6785f511b07e4803281d7efa75e36ba12c0dcdad8d768109448fbcf1eb61
  - id: bb_theme:image_crop
    contract:
      component: image_crop
      group: Form
      description: 'Square crop control of one image upload: an 80px avatar showing the staged square (or a user-icon placeholder), Choose picture / Choose another, Edit crop and the field''s Remove, plus a native modal dialog that pans and zooms the image behind a fixed square. Rendered by the bb_square_image widget''s presenter; the registered Alpine component imageCrop (image_crop.src.js) writes the widget''s hidden crop input. Geometry is {x, y, size} in the original image''s pixels.'
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
      variants:
        - id: default
    source: components/image_crop/image_crop.component.yml
    hash: 0d6945fa84b79d6eeaf5bb31b5f8d3153b57a1589f1c2eee6e4dd918fc0f8e95
  - id: bb_theme:inspector
    contract:
      component: inspector
      group: Layout
      description: 'The trailing column of editable properties — what Xcode, Figma, Unity and SwiftUI all call the inspector (BB-378 D9, renamed from `meta_rail`). It fills `canvas.inspector`: a sticky `<aside>` of `meta_row` rows that stays in view (`position: sticky; top: 0; align-self: start`) while the main region beside it scrolls past. It is deliberately NOT a scroll container — no `overflow-y: auto` — because that would make it a scrolling ancestor of the four inline-edit pickers a `meta_row` can hold, and an absolutely positioned picker panel cannot escape a scrolling ancestor (D3, BB-332 R9).'
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
      variants:
        - id: default
        - id: surface
    source: components/inspector/inspector.component.yml
    hash: 9fcc59b51b06358d6bdaf76cfe43ad8d4e6bcd9093ff4565d42c93b548c4f365
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
      variants:
        - id: default
        - id: self_target
    source: components/link-group/link-group.component.yml
    hash: f0b7b50e79c47dfaf995a41af3ad8e5f063a1a1951c7fa8ca827f992e75ff8d3
  - id: bb_theme:list
    contract:
      component: list
      group: Data Display
      description: |-
        A listing WITHOUT COLUMNS, and it owns its items. It is `table`'s twin below the header and nothing else: the same cell, keyed by the same map, rendered by the same macro. What it does not have is the one thing that makes a table a table — a header cell that sorts — and that absence is why these are two components and not one with a flag. A list has no header, so there is nothing to sort and nothing to align down, which is precisely the statement `layout` makes: putting values in cells promises a comparison, and a membership or a run is a person or an event with a few properties, not a row of comparable figures.

        IT ABSORBED THREE LIST-ENTRY COMPONENTS whose only job was to be one item of something — a run line, a membership row and a label/value pair — and their arguments came with them rather than being lost. The membership entry defended itself in a forty-line block comment: a member list is not tabular data, nobody scans a role down a column, and aligning the properties to a grid would draw a table in flexbox. That argument is true and it is now `layout: cards`; the markup it used to own lives in one place for every listing in the theme.

        `items` IS A PROP AND NOT A SLOT, for the same reason `table`'s `rows` is: a slot is how the previous architecture injected an already-rendered entry, and a cell is DATA — props carry scalar data only and never rendered content. The one slot is `empty`, and it is a sentence a screen writes rather than a value a listing carries. A value shape the nine cell kinds cannot express is the signal to add a tenth kind, once, in the macro — never to reopen a slot here.

        A CELL IS THE SAME NINE KINDS `table` DECLARES — `text` (`value`, `emphasis: default|faint|strong`), `mono` (`value`), `link` (`value`, `url`, `mono?`), `badge` (`label`, `tone`, `dot?`, `icon?`, `suffix?`, `suffix_datetime?`, `suffix_title?`, `mono?`, `mine?`, `url?`), `person` (`display_name`, `initials`, `color`, `mail?`), `picker` (`label`, `value_labels`, `options`, `picker_id`, `multiple?`, `open?`, `icon?`, `clearable?`, `clear_label?`, `creatable?`, `create_label?`, `name?`, `searchable?`, `selected_chips?`, `selected?`), `masked` (`value?`, `revealed?`), `action` (`label`, `icon?`, `icon_only?`, `variant?`, `href?`, `hx?` {`get?`, `target?`, `select?`, `swap?`}) and `rendered` (`markup`) — and their field list is declared once, in `table.component.yml`, beside the `cell()` macro that reads it. It is deliberately not copied here: one macro renders both containers, and a second copy of its schema is a second copy that drifts. An unknown or absent `kind` renders the value as plain text, so a mapping mistake shows as unstyled content rather than as an empty item.

        `rendered` WAS MISSING FROM THIS SCHEMA ONLY, and that is what BB-435 corrected rather than invented. The kind is `table`'s ninth, the shared `cell()` macro this component imports has always rendered it, and `list.twig` hands every cell to that macro without inspecting its kind — so the markup path existed and only the enum here refused it, which made a `rendered` cell handed to `list` an invalid prop for no reason a reader could find. Its `markup` carries the same contract it carries on `table`: the value must be a `MarkupInterface` object, never a plain string and never a render array, because Twig prints the object unescaped and exactly once and escapes the string.

        `action` IS THE ONE KIND THAT IS NOT A VALUE, and it is item-scoped rather than a members-only special case: seven kinds render something the record HOLDS, and a listing whose items can be acted on had nowhere to put the control. It arrived by the rule the macro states — add a kind, never reopen a slot — because the shape that asked for it was a membership's remove control, whose accessible name is a whole sentence that a `text` cell would have printed as prose on every item.

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
                          - time
                        title: Cell kind
        required: []
        additionalProperties: false
      slots:
        empty:
          description: What to show when there is nothing to list — a sentence that names WHAT is absent, which is a thing a screen knows and a listing does not. It is the only slot, and it is content because a sentence is content.
          required: false
      variants:
        - id: attention
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
    source: components/list/list.component.yml
    hash: 96b6ff3996ee18b54bd8627e53e16e0411815fb4f01d4a6e99b547c3a1f77833
  - id: bb_theme:log-viewer
    contract:
      component: log-viewer
      group: Data Display
      description: 'A block of machine output rendered as a log rather than as prose: monospace, whitespace preserved, one gutter line number per line, and its own horizontal scroll container so a long line scrolls the log instead of the page. The caption carries the line count, which is what tells a reader whether they are looking at all of it. Generic over its text prop: it knows a caption and a block of text, and nothing about what produced them.'
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
      variants:
        - id: default
    source: components/log-viewer/log-viewer.component.yml
    hash: 52f30da44c1127d6ec52eb77c61a567efad93f2bfb96992a118ba658793eae08
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
  - id: bb_theme:message
    contract:
      component: message
      group: Data Display
      description: 'Inline status note-bar for a single Drupal message region: a tinted, bordered box with a status icon and the message body. status = teal, warning = amber, error = red. Presents Drupal status_messages inside the bakers.build auth card and elsewhere.'
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
    source: components/message/message.component.yml
    hash: 23ccb2cc6cc38345b47d89594506cf85bc72f230ca27e5fa234381524e28cc7d
  - id: bb_theme:mode_toggle
    contract:
      component: mode_toggle
      group: Action
      description: 'Appearance picker: Light, Dark or System, where System follows the operating system''s colour scheme. Persists the choice locally through the synchronous mode bootstrap (js/skin.src.js).'
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
          align:
            type: string
            enum:
              - start
              - end
            title: Align
            description: 'Where the panel opens: `start` (default) up from the bottom left, as in the rail''s footer; `end` down from the top right, for a toggle standing in a page corner.'
          label:
            type: string
            title: Accessible label
            description: aria-label for the button.
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: default
    source: components/mode_toggle/mode_toggle.component.yml
    hash: 54ec4947d928369f2f9ff7b2d161637e0a53c7551e52d307e743eda77c994330
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
    hash: 942de4954a3d8cca01ffd4efe8f0f8df9e42b147cc6f8bef0e3dd00007cf57f9
  - id: bb_theme:note
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
              - success
            title: Tone
            description: 'Which colour the leading hairline takes, and the ONLY thing a tone may change. `neutral` is the default and means nothing at all, which is what an aside beneath a control should mean. `attention` is for a note a reader must not skim past; it tints the rule and stops there, because an icon or a background here would be a status announcement for something that has not happened. `success` is the one exception and states an outcome, not a consequence: "Everything is flowing". It sits on the running tint with a leading running dot and no hairline, as the approved reference draws it, and the lead is followed by the body without a separator.'
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
        - id: success
    source: components/note/note.component.yml
    hash: fc440f370e5a6aa8a58433061f7eb4cf534ddc106e3819dbd9eab395e99d3140
  - id: bb_theme:option_list
    contract:
      component: option_list
      group: Action
      description: 'The shared checkable option list — one panel markup with two consumers: the property pills inside a create or edit dialog, and the inline edit control on a detail screen. Without input_name it is presentational and accessible only: a listbox whose rows carry aria-selected, with the check icon as the selected marker, holding no form state and emitting no input — the hidden inputs of the form-bound case belong to option_picker, because only the picker knows whether the pick writes now or when the form does. WITH input_name every row carries a real form control of that name at the marker''s own position, checked from the same selected data, so the list SELECTS rather than only displaying a selection; that control is what makes a facet operable with JavaScript disabled, the same standard the panel''s native <details> is held to. Clearing is the FIRST ROW of this list, marked when nothing else is, rather than a button above it or a native option — so "no conductor" reads as a value the operator chose. It is the one row that carries NO form control: an empty submitted value is a constraint a search backend matches nothing against rather than the absence of one, so clearing is an ADDRESS (clear_url, rendered as a link) and not a value. Without clear_url the row is the presentational marker only, which is the right reading when nothing is chosen. Creating is its mirror image and therefore the LAST row: clearing picks a value, creating performs an action, which is also why the create row is a button in a presentational row rather than a listbox option. WITH submit_name every row IS a named submit trigger of the enclosing form instead, which is the third mode and the one an inline edit control needs: the inline picker emits no hidden inputs because the pick is the write, so there is no later submit for a carried value to reach, and the row therefore submits now. The three modes are exclusive and submit_name wins. The selected marker sits on the RIGHT of each row, so every label starts at the same left edge and a scanned list stays calm. Part of the pattern written in designbook/design-system/action-pattern.md. A filter panel adds per-row counts, team groups and person marks, a Select all / Clear row, a live `<k> of <m> selected` summary and an Apply submit (Figma 95:1096, 95:1947); every addition is a presentational row inside the listbox, like the create row. The summary row (`<k> of <m> selected`, with Apply) is pinned to the bottom of a scrolling panel, so it stays visible however long the list is.'
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
                count:
                  type: string
                  title: Count
                  description: A preformatted figure shown at the row's trailing edge, e.g. the tickets an entry stands for (`214`).
                group:
                  type: string
                  title: Group
                  description: The heading the row is listed under. A heading row is drawn whenever the group differs from the previous row's, so rows of one group must be adjacent.
                initials:
                  type: string
                  title: Initials
                  description: Up to two letters for a person mark in front of the label; the row of a person.
                color:
                  type: string
                  enum:
                    - running
                    - attention
                    - unassigned
                    - lease
                    - offline
                  title: Mark colour
                  description: The person mark's colour key, as `person` declares them.
          bulk_actions:
            type: boolean
            title: Bulk actions
            description: A control list with several values gets a `Select all` and a `Clear` action above its rows. Both act on the rows still visible after a search, change only the checkboxes and submit nothing; the enclosing form applies them.
          summary:
            type: boolean
            title: Summary
            description: A control list with several values ends with `<k> of <m> selected`, kept current as rows are checked.
          apply_label:
            type: string
            title: Apply label
            description: When set, the list ends with a primary submit button of this label for the enclosing form, so nothing changes before it is pressed.
          auto_apply:
            type: boolean
            title: Auto apply
            description: The enclosing form applies every change by itself when scripting runs (e.g. an htmx GET on change), so the Apply button is only rendered for a visitor without JavaScript; with scripting it is removed. The summary row stays pinned to the bottom of a scrolling panel in every mode.
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: auto_apply
        - id: clear_control
        - id: default
        - id: filter_panel
        - id: form
        - id: multiple
        - id: single
        - id: submit
    source: components/option_list/option_list.component.yml
    hash: d148e5702a8d88dd74393652121b56408de263e47d860e852ad0c9e90f9117d3
  - id: bb_theme:option_picker
    contract:
      component: option_picker
      group: Action
      description: 'A trigger plus an option_list popover, in three variants over ONE component. facet is a labeled, full-width list filter. field is the PROPERTY PILL of an add or edit surface — a small rounded chip of icon plus text in the property_row beneath the text lines — which carries hidden inputs and writes when the form does; inline makes the displayed value itself the trigger and writes on pick, because for a reversible field the pick IS the write. They are one component deliberately: the dialog pattern and the inline pattern have to be one agreed pattern rather than two that happen to look alike. The pill renders BOTH the field name and the value once one is set — "Conductor · cw-framework" — and the field name alone when nothing is: it used to swap one string for the other, and a bare value cannot be told apart from the field''s own name, so a pill reading "backend, ui" could as easily have been a field called that. The inline variant does not repeat the field name, because it sits in a labelled meta_row and the same word twice on one line reads as two fields. SEVERAL selected values render as the first value plus a +N count, which is what fits a 28px pill without wrapping the row it sits in; the panel is left to option_list, which already owns multi-select properly, so nothing of it is duplicated here. An OVER-LONG value is bounded and truncated so one long term cannot stretch a pill row off the surface, and its full text stays reachable in the title attribute and in the state-carrying aria-label, while the panel may grow with its content up to a ceiling so a long term is legible where it is actually chosen. Each of those three is a second-iteration change (C17, C18, C19), made after the human read the rendered screens; this is the one pre-existing component the no-modification boundary was lifted for. The control carries a state-carrying aria-label in both variants, because the surface has no visible labels and the accessible name is therefore the only name the control has. role=combobox plus aria-haspopup=listbox say what the pill is; the focus management and aria-activedescendant that a combobox owes its user belong to the ticket that makes these dialogs interactive (spec D14). Clearing is NOT here — it is the first row of the option_list in the panel. searchable renders a search input at the top of the panel and the handler really filters the rows that are rendered; where the candidates come from is still a boundary, and belongs to whichever ticket gives that field real candidates. The open state is aria-expanded on the trigger plus hidden on the panel, both rendered from the open prop, so the states are readable with JavaScript disabled. Which fields may be inline-edited at all is decided in designbook/design-system/action-pattern.md.'
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
        - id: default
        - id: facet
        - id: field
        - id: inline
        - id: multiple
        - id: remote
        - id: selected_chips
    source: components/option_picker/option_picker.component.yml
    hash: 0d8c9c6b9fda5b947c37421b3b0b5d1eeebf0907894f5f3ac6a4acc102f0e9d1
  - id: bb_theme:page_header
    contract:
      component: page_header
      group: Layout
      description: 'The header of a SCREEN (renamed from `content_header` — BB-378 D9/D13, after Ant Design, Primer and Atlassian, which all ship a `PageHeader` for exactly this): what the screen is, what can be done to it, and — on an entity place — which of its faces you are looking at. It fills `canvas.header` and owns the screen''s single `<h1>` (D5); every further heading on the screen is a `zone` heading and renders `<h2>`. It exists because the add action is owned by the screen that can receive the addition rather than by the shell chrome — a global "Add entity" button in a top bar cannot know whether the screen under it accepts additions, so it either shows an action that sometimes lies or hides one that sometimes puzzles. The actions slot is right-aligned by this component, so every screen puts its actions in the same place. Filling nothing is the supported case: a screen that cannot add renders no action at all, rather than a hidden or disabled one. The tabs of an entity place live here too rather than in a chrome component of their own (D7). The rule is written in designbook/design-system/action-pattern.md. The description line carries the fixed id `page-header-description` (one page header per page), so an htmx swap can refresh it out of band.'
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
      variants:
        - id: default
        - id: with_breadcrumb
        - id: with_tabs
    source: components/page_header/page_header.component.yml
    hash: 1e7918f2680f066f70630dde36fcfd9010f27829ef8b8dfb411f7047c5da17d3
  - id: bb_theme:period-range
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
          params:
            type: array
            title: Kept parameters
            description: Further query parameters the form submits unchanged, e.g. other filters of the page, as hidden inputs.
            items:
              type: object
              properties:
                name:
                  type: string
                value:
                  type: string
              required:
                - name
                - value
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
      variants:
        - id: all_time
        - id: custom_open
        - id: default
        - id: month_past
        - id: quarter_open
        - id: year
    source: components/period-range/period-range.component.yml
    hash: e09ec9781198a38bc65d5c25f5a679f34f4a7bf259614fbfd8330db576a196eb
  - id: bb_theme:person
    contract:
      component: person
      group: Data Display
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
      variants:
        - id: app
        - id: compact
        - id: default
        - id: picture
        - id: picture_contain
    source: components/person/person.component.yml
    hash: 3eee4ed35c8a3c02ed445d6de33605da00f5a60c642696bebec4dba90306bf50
  - id: bb_theme:progress
    contract:
      component: progress
      group: Data Display
      description: |-
        One unit of work split into parts done, in progress and open: identifier, title, the percent done, a three-part bar and the counts in words ("7 of 12 done - 3 in progress - 2 open"). The project Overview lists its epics with it (BAKERS-55 AC-5).

        THE CALLER COUNTS, THE COMPONENT DRAWS. `percent`, `done`, `in_progress`, `open` and `total` arrive computed; the bar is an SVG whose viewBox is `total` wide, so each part is as wide as its count and no inline style or arbitrary utility carries a number. Done is the running colour, in progress the same colour lighter, open the empty track; a complete unit fills with text-light. The caption says every count in text, so the bar never carries meaning alone.
      props:
        type: object
        properties:
          identifier:
            type: string
            title: Identifier
            description: Mono key before the title, such as GAIA-90.
          title:
            type: string
            title: Title
          url:
            type: string
            title: Link
            description: Makes the title a link.
          percent:
            type: integer
            title: Percent done
            description: done / total, rounded by the caller; 0 when total is 0. Shown as "58 %".
          done:
            type: integer
            title: Done
          in_progress:
            type: integer
            title: In progress
          open:
            type: integer
            title: Open
          total:
            type: integer
            title: Total
        required:
          - title
          - percent
          - done
          - in_progress
          - open
          - total
        additionalProperties: false
      slots: {}
      variants:
        - id: complete
        - id: default
    source: components/progress/progress.component.yml
    hash: f1e863df884327110e48ec1cd20d14bb81f2558f83c7ad44d4122674ea39c850
  - id: bb_theme:property_pill
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
      variants:
        - id: default
    source: components/property_pill/property_pill.component.yml
    hash: 94546903f97d0d971f4157c69d12c80d560d8ced911ffcad71e674e0be3b6b43
  - id: bb_theme:rich-text
    contract:
      component: rich-text
      group: Data Display
      description: 'The typographic treatment of an already-rendered bb_rich body, and nothing else: the single owner of how Markdown OUTPUT looks in this theme. Ticket descriptions and every comment body (through `event`) render through it, and it is the only component carrying a prose declaration list (asserted by the data-display contract, B9). The bb_rich format is GitHub-flavoured Markdown that strips raw HTML and keeps p, br, strong, em, h1-h4, ul, ol, li, a, blockquote, hr, code, pre and table/thead/tbody/tr/th/td (th/td with only the alignment classes); each of those is styled here with semantic tokens: a heading hierarchy, list markers, underlined links with a focus ring, quiet quotes and dividers, inline and block code without a doubled inset, and tables with a distinct header surface, cell padding and row separators. A column aligned in Markdown (`:---`, `:---:`, `---:`) arrives with a `markdown-align-left|center|right` class on its th/td and is aligned left, center or right; an unaligned column keeps the left default. A body containing a TABLE is never line-clamped and becomes a keyboard-focusable, named horizontal scroll region, so a wide table scrolls inside the component instead of widening the page while its native table semantics stay intact. The region''s accessible name is the optional `label` prop (default "Formatted content") so callers can tie it to the content context. `body` is a PROP and not a slot, because a processed field value is one field''s value rather than composed structure, and it is printed WITHOUT `|raw`: Drupal''s autoescape passes the filter''s Markup object through and escapes a plain string. Markdown is never parsed here; detecting a table only reads the processed string.'
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
      variants:
        - id: aligned_table
        - id: clamped
        - id: compact
        - id: default
        - id: formatting
        - id: header_only_table
        - id: table
        - id: table_clamped
        - id: wide_table
    source: components/rich-text/rich-text.component.yml
    hash: a2a3f304f8c3b8d475457852fd6b9b1c0a47d00c3bee383b454d9ba058713c54
  - id: bb_theme:segmented_control
    contract:
      component: segmented_control
      group: Action
      description: A horizontal group of mutually exclusive positions. List filters are links, exactly one active and marked aria-current="page". In-page filters pass items[].value plus `state` (an ancestor Alpine key) and render buttons with aria-pressed. It is not page navigation and not an entity tab — that is `tabs`, bound to `page_header`'s `tabs` slot, which switches the subject of an entity page.
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
          initial:
            type: string
            title: Initial value
            description: 'In-page filter only: the value selected first. When set, the control holds `state` in its own Alpine scope instead of reading it from an ancestor.'
        required: []
        additionalProperties: false
      slots: {}
      variants:
        - id: default
        - id: filter
    source: components/segmented_control/segmented_control.component.yml
    hash: 69f5f231f44ad6c039685aba38fc92d39ee501d5e7356a68ba537312068a27e0
  - id: bb_theme:setup_command
    contract:
      component: setup_command
      group: Action
      description: 'A copyable command: escaped pre/code text and a native Copy button. Copy reads the command from this component''s own DOM, never from a JavaScript expression, so the text stays selectable when the clipboard is denied. Confirmation is the reusable `copied` overlay, absolutely positioned just below the Copy control and cleared so it hides again.'
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
      variants:
        - id: default
    source: components/setup_command/setup_command.component.yml
    hash: d38689b4fca35b2ef46a09bff208e4acbf5ef87be3dc99d0251355c9c948070c
  - id: bb_theme:setup_paths
    contract:
      component: setup_paths
      group: Action
      description: 'A generic two-position in-page panel switcher: a segmented control plus two panels. Owns the Alpine `selected` state and shows one panel at a time, so PHP passes the filter items and the `panel_a`/`panel_b` slots with no CSS classes or Alpine attributes. `panel_a` and `panel_b` match `items[0]` and `items[1]` by position, not by value. The filter is `segmented_control` inside this wrapper; do not nest another `x-data` on that control. Both panels stay in the DOM so their content remains readable with JavaScript off.'
      props:
        type: object
        properties:
          selected:
            type: string
            title: Initial selection
            description: Starting Alpine `selected` value. Defaults to the first item's value.
          filter_label:
            type: string
            title: Filter label
            description: Accessible name for the segmented control.
          items:
            type: array
            title: Positions
            description: Segmented control items with label and value, exactly two.
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
          description: Line above the panels.
          required: false
        panel_a:
          description: Shown when `selected` matches the first item's value.
          required: false
        panel_b:
          description: Shown when `selected` matches the second item's value.
          required: false
        after:
          description: Shared content below both panels.
          required: false
      variants:
        - id: default
    source: components/setup_paths/setup_paths.component.yml
    hash: 6a3ec8f317c3a5cd3ed205d44e0fc7c5684bb008e3aa2f60e0b0ba40fca5888f
  - id: bb_theme:shell
    contract:
      component: shell
      group: Shell
      description: 'The application shell — declared once and inherited by every screen scene, never re-composed per screen. BB-503 removes the header entirely: the shell is now a collapsible navigation rail beside a main column that stacks the screen content and the status bar, with an overlay layer last for dialogs. `content` is the one region a screen fills, and it is deliberately NOT a scroll container: a scrolling ancestor here would take a sticky `inspector` and a sticky `filters` their stick and clip every absolutely positioned picker panel. Every region renders only when its slot is filled, so a screen that supplies content alone renders exactly as before.'
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
    source: components/shell/shell.component.yml
    hash: b11d65ae6c8f89b6dd4b88d59953183e6323c1718f8970a0795cbd6cb0a7c79d
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
    hash: 175d77ba28ef5021d9a68742e0c27256c7687d2df03f16c84a7184ad6f7b9706
  - id: bb_theme:stat-breakdown
    contract:
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
                exact:
                  type: string
                  title: Exact value
                  description: The unabbreviated value and its calculation in the bars display. Shown when the value is hovered or focused, dismissed with Escape; the value becomes focusable when set.
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
      variants:
        - id: bars
        - id: default
    source: components/stat-breakdown/stat-breakdown.component.yml
    hash: be8e19c2aa1d32d4884154b7aeb397b6844a098b7b3daab121fe99df06a59c12
  - id: bb_theme:stat-comparison
    contract:
      component: stat-comparison
      group: Data Display
      description: 'Up to six series on one shared category/value plot, drawn client-side by Chart.js. The component receives values and labels only: it computes no geometry, because the canvas knows the width it actually gets and the server does not. Series colours are read at runtime from the theme''s `chart-series-a`…`chart-series-f` custom properties, so the plot follows the light and dark theme without a second palette. The legend and the exact-value disclosure are plain markup and stay readable without the canvas. Sample demonstrations use illustrative values, never live tenant observations.'
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
      variants:
        - id: default
        - id: empty
        - id: gaps
        - id: signed
        - id: single
        - id: six
        - id: zero
    source: components/stat-comparison/stat-comparison.component.yml
    hash: 4a82ae9688e7ec0e44c1d5cb4af0a6025934ec29b2cf0e3c851caec1c19bcf47
  - id: bb_theme:stat-ratio
    contract:
      component: stat-ratio
      group: Data Display
      description: One figure derived by dividing two others, shown per trailing period. The quotient is already computed by the caller and arrives as a string; this component performs no arithmetic whatsoever, which is what keeps one rule in one place rather than one copy per surface. The value is a string and not a number precisely so an em-dash is a legal value for a period with nothing to divide by.
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
      variants:
        - id: default
    source: components/stat-ratio/stat-ratio.component.yml
    hash: 5d649e323318ff881dfa9bd1de50a7c5f2dff8607f2a1af464a75da0c67641ed
  - id: bb_theme:stat-series
    contract:
      component: stat-series
      group: Data Display
      description: A figure's recent daily counts drawn as BARS, so a trend is read at a glance instead of by comparing a row of digits. Bars rather than a line because a line stretched across a full-width content zone flattens into near-nothing, while a bar is read against its own baseline and stays legible at any width the layout gives it. Typically seven days, but the component fixes no length and derives its geometry from however many points it is given. Drawn with proportional SVG bars and no charting library; the counts stay readable as text above each bar, so nothing here is carried by the graphic alone.
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
      variants:
        - id: default
    source: components/stat-series/stat-series.component.yml
    hash: ccac18eee2dc204421f4b716fde4015fff257cf2c91b398ecc0e10de80c08f76
  - id: bb_theme:stat-tile
    contract:
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
              exact:
                type: string
                title: Exact previous value
                description: The unabbreviated previous value and its calculation. Shown when the value is hovered or focused, dismissed with Escape; the value becomes focusable when set.
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
          detail_exact:
            type: string
            title: Exact detail value
            description: The unabbreviated figure in the detail line and its calculation, e.g. `132,768,940 tokens per closed ticket — Run tokens ÷ closed tickets`. Shown when the value is hovered or focused, dismissed with Escape; the value becomes focusable when set.
          url:
            type: string
            title: Link
            description: Where the figure leads, such as the Board filtered to the unhealthy tickets. The whole tile becomes the link target through a stretched anchor named after the figure; the info and exact-value triggers stay reachable above it.
        required:
          - value
          - label
          - source
        additionalProperties: false
      slots: {}
      variants:
        - id: capacity
        - id: compact
        - id: comparison
        - id: default
        - id: flat
        - id: kpi
        - id: kpi_exact
        - id: kpi_small_sample
        - id: link
    source: components/stat-tile/stat-tile.component.yml
    hash: b253c86364a54c89773abfe69671e8c1575a3f096aa724872c73c10e04903b7a
  - id: bb_theme:stat-windows
    contract:
      component: stat-windows
      group: Data Display
      description: 'A figure''s three trailing totals, side by side: what happened in the last 24 hours, the last 7 days and the last 30 days. It knows nothing about what is being counted — the same component carries closed tickets, runs started, or any other trailing count, because the caller resolves both the numbers and the words for them. The three periods are required as a fixed triple rather than an open array, because a figure arriving with two would render a lopsided row instead of failing, and an invalid prop is dropped silently rather than reported.'
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
      variants:
        - id: default
    source: components/stat-windows/stat-windows.component.yml
    hash: 36fff869b8f36d340e3e49179b78a243457f867f1f39df11f7c2d5abed41df83
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
      variants:
        - id: default
    source: components/state-flow/state-flow.component.yml
    hash: 9c04d4c539f1b390d359eb8c539cbb1573b3171a52a0e1da16b6ed4185c7a635
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
    hash: 5c8f2b5ff0150318cf81f1965aa19a4c4557390931bb53e13a4a1e70abcc7575
  - id: bb_theme:summary-band
    contract:
      component: summary-band
      group: Data Display
      description: |-
        A full-width band above a two-column layout, answering three questions in one glance: where does this stand, what was done, and what evidence is there. THREE SLOTS and nothing else — a `flow` in the header strip, a `summary` beneath it, and the `links` below that.

        THE THREE QUESTIONS ARE THE CONTRACT, which is why there are three slots and not four. It carried a fourth, `actions`, declared for a transition control that had been removed at a review gate and never refilled; measured across every scene that composes this band, all three fill `flow`, `summary` and `links` and NONE fills `actions`. A slot no caller fills is not a shape held open for later — it is a region every future reader has to account for, and re-adding one is a line of YAML at the moment somebody actually has a band action to place.

        THE LINKS SIT BELOW THE SUMMARY, NOT BESIDE IT (C21). The first iteration put them in a second column of the body row, and the human read that as two things competing for the one glance the band exists to serve. Stacked, the band reads top to bottom in the order the questions are asked, and with the full width the link groups lay out as one wrapping row of groups instead of a narrow gutter that wraps every label.

        IT KNOWS NOTHING ABOUT WHAT IT SUMMARISES. It used to be named for one screen and its slots described that screen's fields; the questions it answers are asked of a release, a run and a deployment in the same words, and every one of them has a state to show, a summary to read and evidence to open. Each region renders only when its slot is filled, so a caller with two of the three gets a band of two.
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
      variants:
        - id: default
    source: components/summary-band/summary-band.component.yml
    hash: fe87d233b6d76fb0d11140e5153268b76a5222aae7b4e48bbec6dc45316c99b9
  - id: bb_theme:surface_card
    contract:
      component: surface_card
      group: Layout
      description: 'A generic bordered, padded surface — the same lifted-panel look `inspector`''s `surface` variant already draws (`bg-surface`, `border-border-2`, `rounded-sm`, `p-4`), factored out for a SECOND panel of `canvas.inspector` that is not itself a properties rail (BB-661): the ticket''s Addons card, a tab strip over one message panel. `inspector` keeps owning `meta_row` properties; this owns nothing about addons or any other bakers.build concept, so any future second inspector-column panel reuses it rather than growing another product-named wrapper. Not sticky and not an `<aside>` itself — a caller composing `canvas.inspector` as a `list` of items places this as a sibling item next to `inspector`, which already provides the column''s own stickiness.'
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
      variants:
        - id: default
    source: components/surface_card/surface_card.component.yml
    hash: f3ba3bf1f6bdc2abc972269ad2105ef29ceb40fafc21c14698f764971260200d
  - id: bb_theme:tab
    contract:
      component: tab
      group: Navigation
      description: 'One destination of `tabs`: a lightweight text link with a thin underline on the current place. The single owner of the tab link look; Drupal''s local-task presenter passes its link render element through the `link` slot.'
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
      variants:
        - id: default
    source: components/tab/tab.component.yml
    hash: c1fad8f457dcb911beb12b8b304d96237789e4e3727c8ac7d3874b8549c7f270
  - id: bb_theme:table
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
                  description: 'The row''s values, keyed by column key. A cell is plain data with a `kind` — `text` | `mono` | `link` | `badge` | `person` | `picker` | `masked` | `action` | `rendered` | `status` — and one macro renders all ten. An unknown or absent `kind` renders the value as plain text, so a mapping mistake shows up as unstyled content rather than as an empty cell; plain text keeps its value''s line breaks. A value shape the kinds cannot express is the signal to add a new kind DELIBERATELY, never to reintroduce a slot — and that rule has now been exercised twice. `action` was the eighth: the first seven all render a value the record HOLDS, none of them was a control, and a row action had nowhere to go. `rendered` is the ninth, and it arrived when the ticket list was bound through core''s own `table` views style over nine real Views FIELDS, each rendering itself through its own formatter — so what reaches the cell is markup another layer already produced and whose face this component did not decide. A slot would be the wrong answer for it for the same reason it was the wrong answer for a row: a slot lets a caller inject a whole `<td>` and escape the keying this container exists to enforce, while a `rendered` cell is still ADDRESSED BY ITS COLUMN and still emits exactly the one `<td>` that column asked for. SIX OF A CELL''S FIELDS ARE OPTIONAL STRINGS the macro hands straight to a composed component — `icon`, `suffix`, `mail`, `clear_label`, `create_label` and `picker_id`. Omitting any of them is legal and renders nothing: `cell()` passes an empty string rather than the NULL a composed component types as a string and core''s validator rejects. The `bare` story is what covers that, because a guard nothing renders is closed but not covered. `meter` is a load against a capacity (BAKERS-55 Active conductors): a 120 px bar filled to `share` and the caller''s `label` ("2 / 3 parallel runs"); without `share` only the label ("Unknown capacity").'
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
                          - time
                          - status
                          - input
                          - meter
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
                      suffix_datetime:
                        type: string
                        title: Badge suffix instant
                        description: ISO 8601 of a suffix that is a point in time; the suffix then renders as `bb_theme:time`.
                      suffix_title:
                        type: string
                        title: Badge suffix full date on hover
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
                      datetime:
                        type: string
                        title: Machine-readable stamp
                        description: A `time` cell's ISO 8601 stamp; its `label` is the displayed text.
                      title:
                        type: string
                        title: Full date and time
                        description: A `time` cell's absolute stamp, shown on hover.
                      share:
                        type: integer
                        title: Share
                        description: 'A `meter` cell: the filled share of the bar, 0 to 100, computed by the caller. Absent, the cell shows its label alone (faint): an unknown capacity is not zero.'
        required: []
        additionalProperties: false
      slots:
        empty:
          description: Collapsed/empty confirmation content (collapsed variant) — the ONE surviving slot. The strip is a sentence a screen writes, not a value a listing carries.
          required: false
      variants:
        - id: bare
        - id: collapsed
        - id: conductors
        - id: default
        - id: delivery
        - id: exact_value
        - id: external_link
        - id: timesheet
        - id: tree
        - id: unassigned
        - id: wired
    source: components/table/table.component.yml
    hash: 8b31310e732c881666b7f571e477cf009626dfd69971f1ade753a01315ced06d
  - id: bb_theme:tabs
    contract:
      component: tabs
      group: Navigation
      description: Horizontal entity tabs, rendered inside `page_header`'s `tabs` slot (IA D12, BB-378 D7). Switches the subject of the page inside one entity place — not app-level navigation (that is the rail). Each item is a `tab`, a lightweight destination link; exactly one is active and carries a thin underline. The row wraps on narrow viewports. Used on project, team, group, user (View/Edit), My work and settings rows.
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
      variants:
        - id: default
    source: components/tabs/tabs.component.yml
    hash: 2dec883a083b826bc1401afa0d96577dc3a3a21f156b66cec6359297cd147258
  - id: bb_theme:text
    contract:
      component: text
      group: Data Display
      description: 'One run of plain text in one of the theme''s typographic roles: a paragraph, a heading, an inline span, or a link. The element (`as`) serves the document outline and the role (`size`, `tone`) the look, independently, so a page''s h1 can read at the section-title role. It is for copy a form or controller supplies as a single string; rich or multi-part content belongs in a component with slots.'
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
              - meta
              - section-title
              - page-title
              - prose
            title: Size
            description: 'Typographic role from the design tokens: body, meta, section-title, page-title (the Bricolage page title) or prose (running text). Default `body`.'
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
      variants:
        - id: default
    source: components/text/text.component.yml
    hash: 5fca3a5352671302414e9f8331ad0fbf5111f0a453991e069ed246da5a5b4694
  - id: bb_theme:time
    contract:
      component: time
      group: Data Display
      description: 'ONE displayed point in time: `<time datetime title>label</time>`. The label is the readable form ("2 hours ago", "15 Jun, 13:30", "15 Jun 2025"), the `datetime` the ISO 8601 stamp and the `title` the full absolute date and time, so the exact moment is one hover away. All three come from `Drupal\bb_core\Time\BbDate`, the single product formatting path; a template never formats a date itself. Tabular figures, never mono: a date is read, not matched character by character.'
      props:
        type: object
        properties:
          label:
            type: string
            title: Label
            description: The displayed text.
          datetime:
            type: string
            title: Machine-readable stamp
            description: ISO 8601, as the `datetime` attribute.
          title:
            type: string
            title: Full date and time
            description: The absolute stamp in the reader's timezone, shown on hover.
        required:
          - label
        additionalProperties: false
      slots: {}
      variants:
        - id: absolute
        - id: default
    source: components/time/time.component.yml
    hash: 785b7ba196c62cc96bb0469e8f98c700aba8ddd67f91d0647d47911f4cca94ef
  - id: bb_theme:toast
    contract:
      component: toast
      group: Data Display
      description: A fixed bottom-right status toast for a short confirmation such as `Saved`. It is one element without children, so a script can rewrite its text, `role` and `hidden` in place. An empty message renders hidden. It announces through `role="status"`; a caller that reports a failure switches it to `alert`.
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
      variants:
        - id: default
    source: components/toast/toast.component.yml
    hash: 908201702b55d7ae647f580fe6c69b7a35f7af4e8128c3e9df48979314818026
  - id: bb_theme:week-strip
    contract:
      component: week-strip
      group: Data Display
      description: 'A day selector for one calendar week: seven links, Monday to Sunday, each with that day''s recorded total, and the week total at the end. The selected day is marked aria-current="date". It is navigation inside one listing, so it is a nav landmark named by `label`. On narrow screens each cell shows the weekday initial and the total only; the full day sentence stays in the link''s accessible name.'
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
      variants:
        - id: default
    source: components/week-strip/week-strip.component.yml
    hash: 6a7620c3991aba32682f893ffd76399422ffd12b4d92ccb2cbe913958d6bc762
  - id: bb_theme:zone
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
            description: 'Padding on the VERTICAL axis only, from the spacing roles: `none` = 0, `sm` = `py-stack`, `md` = `py-group` (the default), `lg` = `py-gutter`. A zone never pads its left or right edge: the horizontal edge belongs to the `canvas` / `page_header` (`px-group`, `xl:px-gutter`), or to the `surface_card` a carded zone sits in (it has its own `p-group`), so a zone never adds a second left edge inside them.'
          gap:
            type: string
            enum:
              - none
              - sm
              - md
              - lg
              - section
            title: Gap
            description: 'Distance between the cells of the content grid, from `component.zone.gap.*`, which point at the space scale: `none` = 0, `sm` = `space-3` (12px, 16px cozy), `md` = `space-5` (20px, 24px cozy, the default), `lg` = `space-6` (24px, 32px cozy). `section` is the spacing role between headed zones (32px), for a grid whose cells are zones with their own headings.'
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
      variants:
        - id: columns
        - id: default
        - id: description_only
        - id: row
    source: components/zone/zone.component.yml
    hash: adde53ceb698264fd51e6e407b3883484e6a0e8a964a9812fc889bdd7dbeff79
mappings: []
samples:
  - entity_type: bb_project
    bundle: bb_project
    records:
      - id: '1'
        summary: bakers.build Platform
      - id: '2'
        summary: Northwind Shop
      - id: '3'
        summary: bakers.build Designbook
      - id: '4'
        summary: Øresund Ærø Straße Überführungsgesellschaft für Großprojekte
  - entity_type: view
    bundle: project_board
    records:
      - id: project_board
        summary: Phases, Done closed, no filter
      - id: project_board_details
        summary: 'States: Working split by plan, working, review'
      - id: project_board_done_open
        summary: 'Phases, Done open: last 7 days, Show older and Hide done'
      - id: project_board_unhealthy
        summary: 'Phases, Unhealthy filter: only the six unhealthy tickets, chip "Unhealthy · 6"'
scenes:
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
                                href: /bakers/project/add
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
                                picture: /themes/custom/bb_theme/logo.svg
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
                                href: /bakers/project/add
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
                                picture: /themes/custom/bb_theme/logo.svg
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
                                picture: /themes/custom/bb_theme/logo.svg
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
                                          value: working
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
        - name: project-detail-billing
          group: Screens
          section: projects
          docs: |-
            THE BILLING FACE (BB-666). The page header says what it holds — "Who recorded time on this project is billed to" — and carries New billing account top right; the content is the list alone, with no heading of its own. A project owns several billing accounts and exactly one of them is the project default: every ticket that links no account, and has no ancestor that links one, is booked to it.

            THE ACCOUNTS ARE A `list` OF PATTERNED ROWS, NOT A TABLE: `headline: [name]`, `meta: [type, tickets]`, `right: [default, make_default, edit, archive]`. An account is read one at a time, not compared down a column.

            THE DEFAULT AND TICKET LINKS EXCLUDE EACH OTHER. The default row carries the Default badge and no Archive — make another account the default first, so a project always has one. An account with linked tickets offers no Make default. Only an unlinked, non-default account offers both.

            TICKETS ARE LINKED ON THE TICKET, NEVER HERE (the inspector's Billing row). This face only names them in the meta line.

            ARCHIVED ACCOUNTS STAY READABLE, collapsed below, because existing bookings keep their reference. Make default, Edit and Archive are drawn as `action` cells; on the server they arrive as named submit triggers of the face's form.
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
                            title: Billing
                            description: Who recorded time on this project is billed to
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
                      main:
                        - component: bb_theme:zone
                          props:
                            gap: lg
                          slots:
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
        - name: project-detail-billing (new account)
          group: Actions
          section: projects
          docs: |-
            THE CREATE DIALOG OF THE BILLING FACE (BB-666), in the shell's `overlay` over the billing face it was opened from (`action-pattern.md` › *Create and edit surfaces*).

            NAME AND BILLING TYPE, NOTHING ELSE: no ticket field — tickets link on the ticket — and no default switch — Make default is a row action. Edit opens the same dialog filled in, titled Edit billing account, submitting Save.
          items:
            - scene: design-system:shell
              with:
                content:
                  - component: bb_theme:canvas
                    slots:
                      header:
                        - component: bb_theme:page_header
                          props:
                            title: Billing
                            description: Who recorded time on this project is billed to
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
                      main:
                        - component: bb_theme:zone
                          props:
                            gap: lg
                          slots:
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
    hash: 9d366a8ee7d2aa3879b1f8b6077df902734c9038d7d0edab56667b0a0b454d52
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
                        workspace_picture: /themes/custom/bb_theme/logo.svg
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
                                picture: /themes/custom/bb_theme/logo.svg
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
                            url: /bakers/work
                            icon: ticket
                            in_active_trail: true
                            below: []
                          - title: Groups
                            url: /bakers/group
                            icon: dashboard
                            in_active_trail: false
                            below: []
                          - title: Projects
                            url: /bakers/project
                            icon: project
                            in_active_trail: false
                            below: []
                          - title: Settings
                            url: /bakers/settings
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
                                url: /bakers/team/team-a
                                in_active_trail: false
                                mark:
                                  initials: TA
                                  color: attention
                              - title: Team B
                                url: /bakers/team/team-b
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
                          color: running
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
                            url: /bakers/work
                            icon: ticket
                            in_active_trail: true
                            below: []
                          - title: Groups
                            url: /bakers/group
                            icon: dashboard
                            in_active_trail: false
                            below: []
                          - title: Projects
                            url: /bakers/project
                            icon: project
                            in_active_trail: false
                            below: []
                          - title: Settings
                            url: /bakers/settings
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
                                url: /bakers/team/team-a
                                in_active_trail: false
                                mark:
                                  initials: TA
                                  color: attention
                              - title: Team B
                                url: /bakers/team/team-b
                                in_active_trail: false
                                mark:
                                  initials: TB
                                  color: lease
                    actions:
                      - component: bb_theme:person
                        props:
                          variant: compact
                          initials: CW
                          color: running
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
            THE ONBOARDING WIZARD CHROME is the gate: the same split frame as sign-in,
            with the step's explanation under the slogan in the left band. Screens
            open with `scene: "design-system:onboarding"` and fill `content`, `title`,
            `description` and `explanation`.
          items:
            - component: bb_theme:gate
              props:
                title: $title
                description: $description
                explanation: $explanation
                title_in_band: true
              slots:
                mark:
                  component: bb_theme:brand
                  props:
                    size: compact
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
                                picture: /themes/custom/bb_theme/logo.svg
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
                          color: running
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
    hash: a7bab7258f9ab3e5654c113b6ef8b0b3d6ae30308f3a0c0e8edaa1fd083a1067
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
data_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook
```

## Context
### task:create-sample-data (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/sample-data/tasks/create-sample-data.md)
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

### ctx:match-reference-entity (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/sample-data/rules/match-reference-entity.md)
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

### ctx:component-tree (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/sample-data/rules/component-tree.md)
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

### ctx:link-2 (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/sample-data/rules/link.md)
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

### ctx:image (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/sample-data/rules/image.md)
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

### ctx:formatted-text (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-drupal/a4fea9d7cf8d/sample-data/rules/formatted-text.md)
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

### ctx:sample-records (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/sample-data/blueprints/sample-records.md)
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

```

## Steps

### Step: create-sample-data
Context: [ctx:cli-surface, ctx:match-reference-entity, ctx:component-tree, ctx:story-image-node-renderer, ctx:local-image-assets, ctx:entity-reference-rendering, ctx:link-2, ctx:image, ctx:formatted-text, ctx:sample-records]

- [x] create-sample-data — view.project_board states

  Instruction: task:create-sample-data

  #### Params
  ```yaml
  section_id: projects
  bundle:
    entity_type: view
    bundle: project_board
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
  components_dir: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/components
  request: 'BAKERS-55 Task 12 (brief .superpowers/sdd/plan/task-12-brief.md; spec sections B, C, D). Scenes project-detail-overview (+ -flowing, new -empty) and project-detail-board (+ new -details, -done-open, -unhealthy) over the hand-written mappings bb_project.bb_project.full, view.project_board.default and view.conductors.board (waiver: Pascal Glass 2026-11-11, map-entity a4fea9d7 refuses list-view and cannot compile a Display Builder canvas). Approved reference 3a2b0e29e246a9d7/bd5e4ac5593b577f is the visual baseline for the later design-verify.'
  records:
    - id: project_board
      summary: Phases, Done closed, no filter
      values:
        rows:
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 0
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 1
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 2
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 3
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 4
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 5
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 6
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 7
        items_per_page: 10
    - id: project_board_details
      summary: 'States: Working split by plan, working, review'
      values:
        rows:
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 0
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 1
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 2
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 3
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 4
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 5
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 6
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 7
        items_per_page: 10
    - id: project_board_done_open
      summary: 'Phases, Done open: last 7 days, Show older and Hide done'
      values:
        rows:
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 0
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 1
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 2
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 3
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 4
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 5
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 6
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 7
        items_per_page: 10
    - id: project_board_unhealthy
      summary: 'Phases, Unhealthy filter: only the six unhealthy tickets, chip "Unhealthy · 6"'
      values:
        rows:
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 0
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 1
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 2
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 3
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 4
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 5
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 6
          - type: entity
            entity_type: bb_ticket
            bundle: bb_ticket
            view_mode: default
            record: 7
        items_per_page: 10
  preserve: Record project_board keeps its id, rows and items_per_page; the three new records repeat them and differ by id only.
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
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-55-vorschl-ge-proj/web/themes/custom/bb_theme/designbook/data/view.project_board.yml
  ```

  #### Results
  <!-- done -->

