# Plan: design-screen
<!-- digest: 62cbae9e3e499703c8481dc8da4f00c3a234fda2c61657456986da1027b75d31 -->

## Schemas
```yaml
definitions:
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
    required:
      - component
      - group
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
      slots:
        type: array
        items:
          type: string
        default: []
      group:
        type: string
      description:
        type: string
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
        enum:
          - Action
          - Data Display
          - Form
          - Navigation
          - Layout
          - Shell
        description: |
          Top-level Storybook category. Also the middle segment of the derived CSF story id after sanitize (see sdc-components story-address rule). Must be one of the listed values.
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
    format: twig
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
    required:
      - entity_type
      - bundle
    properties:
      entity_type:
        type: string
      bundle:
        type: string
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
        default: ''
        description: View mode machine name; the mode name when mode_kind = view. Empty for a form mapping.
      form_mode:
        type: string
        default: ''
        description: Form mode machine name; the mode name when mode_kind = form. Empty for a view mapping.
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
        description: Storybook story group (e.g. "Designbook/Design System"). Falls back to name.
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
```

## Context
### task:write-component (task, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/tasks/write-component.md)
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

Produce the complete artifacts for the selected component and requested delta. Existing content is the baseline for a change; blueprint defaults apply to new structure only.

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

### task:refresh-components (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/tasks/refresh-components.md)
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

### task:map-entity--design-screen (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/tasks/map-entity--design-screen.md)
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

Produce the complete mapping expression for the one entity type, bundle and mode selected by `mapping`. Apply the requested field-output delta to the existing expression when present, preserving unrelated assignments and references.

Retain other view/form modes, bundles, model/display settings and sample records. Any necessary model, sample or consumer changes are separate outputs/tasks declared by intake. Reuse components that already satisfy the mapping.

Completion: the selected mapping expresses the requested delta and all preserved assignments remain equivalent. The saved definition includes the standalone preview and concrete mapped-field browser observations.

```

### task:write-scene (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/scenes/tasks/write-scene.md)
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
  properties:
    scene_name:
      type: string
      description: Exact SceneDef.name selected during intake; unique within scene_path.
    scene_scope:
      type: string
      enum: [screen, shell, standalone]
      description: Actual target role, including consumer writes originating in another domain intake.
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

Produce the complete SceneFile for the selected `scene_path` and `scene_name` from `section_scenes` plus the requested delta. A uniquely matching name replaces only the selected scene's requested content in its current array position. An absent name adds exactly one entry. Multiple matches or conflicting selectors block execution and require corrected intake.

Preserve sibling scenes and their order, unrelated selected-scene fields, and unrelated file metadata. Preserve the file and scene identities unless intake explicitly declared a rename and every reference edit. Repeating the same delta leaves one target entry and the same semantic result.

The target role is `scene_scope`, regardless of the originating workflow. Applicable rules use this parameter for screen, shell or standalone constraints. The existing file comes from intake or a declared `create-scene-file` predecessor for an absent file.

Completion: exactly one selected entry expresses the requested delta; all preserved content matches the baseline. Every necessary dependent edit and build/render check is already declared in the saved definition.

```

### ctx:cli-surface (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/workflow/rules/cli-surface.md)
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

### ctx:variant-transport (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/variant-transport.md)
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

### ctx:typed-component-boundary (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/typed-component-boundary.md)
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

### ctx:story-image-node-renderer (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/story-image-node-renderer.md)
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

### ctx:region-properties (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/region-properties.md)
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

### ctx:referenced-content-view-mode (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/referenced-content-view-mode.md)
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

### ctx:presenter-composition (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/presenter-composition.md)
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

### ctx:markup-derivation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/markup-derivation.md)
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

### ctx:local-image-assets (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/local-image-assets.md)
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

### ctx:icon-sprite (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/icon-sprite.md)
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

### ctx:component-contract-index (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/component-contract-index.md)
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

### ctx:token-backed-utilities (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/5dd532122306/rules/token-backed-utilities.md)
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

### ctx:region-properties-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/5dd532122306/rules/region-properties.md)
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

### ctx:font-availability (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/5dd532122306/rules/font-availability.md)
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

### ctx:component-styling (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/5dd532122306/rules/component-styling.md)
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

### ctx:component-source (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/5dd532122306/rules/component-source.md)
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

### ctx:navigation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/shell/rules/navigation.md)
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

### ctx:slot-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/rules/slot-rendering.md)
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

### ctx:sdc-components (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/rules/sdc-components.md)
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

`group:` required, one of: `Action`, `Data Display`, `Form`, `Navigation`, `Layout`, `Shell`.

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

### ctx:region-properties-3 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/rules/region-properties.md)
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

### ctx:reference-field-semantics (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/rules/reference-field-semantics.md)
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

### ctx:layout-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/rules/layout-constraints.md)
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

### ctx:js-behavior (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/rules/js-behavior.md)
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

### ctx:static-assets (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/blueprints/static-assets.md)
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

Place assets in the Storybook `public/` directory. Storybook serves this directory automatically at the root path — no `staticDirs` configuration needed.

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

### ctx:section (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/section.md)
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

### ctx:pager (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/pager.md)
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

### ctx:page (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/page.md)
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

### ctx:navigation-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/navigation.md)
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

### ctx:logo (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/logo.md)
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

### ctx:link (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/link.md)
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

### ctx:js-behavior-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/js-behavior.md)
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

### ctx:icon (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/icon.md)
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

### ctx:header (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/header.md)
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

### ctx:grid (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/grid.md)
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

### ctx:form (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/form.md)
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

### ctx:footer (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/footer.md)
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

### ctx:container (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/container.md)
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

### ctx:component-template (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/component-template.md)
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

### ctx:button (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/components/blueprints/button.md)
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

### ctx:scenes-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/scenes-constraints.md)
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

### ctx:entity-reference-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/entity-reference-rendering.md)
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

### ctx:inline-image (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/rules/inline-image.md)
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

### ctx:image-fields (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/rules/image-fields.md)
````
---
trigger:
  domain: data-mapping
---

# Rule: Image Field Mapping

Hard constraints for mapping image and reference fields in entity-mapping JSONata expressions.

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
{ "image": "<style_name>", "alt": <field>.alt }
```

The `<style_name>` MUST reference a bundle defined under `config.image_style` in `data-model.yml`. No image without an image style.

### 3. `type: reference` fields emit EntityNode

When the data-model field type is `reference`, the JSONata mapping emits an EntityNode. The referenced entity renders itself — the mapping does not access the referenced entity's data.

```jsonata
{ "entity": "<entity_type>.<bundle>", "view_mode": "<view_mode>", "record": <index> }
```

This applies to ALL reference types — media, paragraph, node, taxonomy_term, etc. What the referenced entity produces (ImageNode, ComponentNode, etc.) is that entity's own mapping concern.

````

### ctx:field-cardinality (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/rules/field-cardinality.md)
````
---
trigger:
  domain: data-mapping
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

### ctx:views (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/views.md)
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

So a view declares `template: list-view` (or the project's row-style value) in its
`config.view.<id>` `view_modes` entry — that value is the UI-Patterns row-style binding, resolved
the same way regardless of which build-form branch owns the wrapper around it.

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

When a `list-view` / `view-summary` component exists, wrap the same enumerated array in the
wrapper's `rows` slot — still self-contained (rows are enumerated, never read from `$`):

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:list-view",
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
content — base table, row bundle/view-mode, filters, sort, and the row-style template.

Bind the view's **row output to its SDC component through the shared UI Patterns block** — the
`{component_id, variant_id, props, slots}` mechanism (see `ui-patterns.md`): the view's row/style
plugin carries that block, so a rendered list is a component render — the same UI-Patterns
manifestation a `field-map` display uses — not a raw view row. The view's row-style `template`
names the component the rows bind to.

This authors only the **UI-Patterns half** (the row style). Which unit emits the **wrapper** —
the Display Builder page config, or a generated presenter-template with pager and exposed filter
passed through as slots — follows the build-form branch above. A view is the combination of the
row-style config and its wrapper; neither half is a whole view on its own.

The concrete config keys come from `prepared`; treat the row-binding intent here as the starting
point, not a fixed key layout.

````

### ctx:ui-patterns (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/ui-patterns.md)
````
---
type: data-mapping
name: ui-patterns
priority: 5
trigger:
  domain: data-mapping
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

### ctx:presenter-template (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/presenter-template.md)
````
---
type: data-mapping
name: presenter-template
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
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

### ctx:pager-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/pager.md)
```
---
type: data-mapping
name: pager
priority: 10
trigger:
  domain: data-mapping
filter:
  backend: drupal
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

### ctx:layout-builder (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/layout-builder.md)
````
---
type: data-mapping
name: layout-builder
priority: 10
trigger:
  domain: data-mapping
---

# Blueprint: Layout Builder — Passthrough Mapping

Applies when `map-entity` runs for a view mode with `template: layout-builder` (i.e. a node bundle's full view mode that uses Layout Builder).

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

The Scene still drives *which* bundles and views become config units (resolve-filter). The
section *composition* for a `layout-builder` template is not authored into the display YAML;
tests that need a reachable rendered page seed the override layout after import (fixture seed).
This is an overridable starting point — a project whose Layout-Builder export differs replaces it.

````

### ctx:form-display (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/form-display.md)
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

For a bundle's `form_modes`, `sync-to`'s resolve-filter emits up to two config names per mode:

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

### ctx:field-map (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/field-map.md)
````
---
type: data-mapping
name: field-map
priority: 10
trigger:
  domain: data-mapping
---

# Blueprint: Field Map

Applies when a view mode declares `template: field-map`. Generates a JSONata expression that maps entity fields to a `ComponentNode[]` array.

## Pattern

```jsonata
(
  $fields := $;
  [
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:heading",
      "props": { "level": "h1" },
      "slots": { "text": $fields.title }
    },
    {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:text_block",
      "slots": { "content": $fields.field_body }
    },
    /* Reference field → entity node in slot */
    $fields.field_author ? {
      "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:author_card",
      "slots": {
        "avatar": [
          { "entity": "user.user", "view_mode": "avatar", "record": 0 }
        ]
      }
    }
  ]
)
```

## Image Field Mapping

> See rule: [image-fields](../rules/image-fields.md) for hard constraints.

### `type: image` — direct ImageNode

When the data-model declares `type: image`, image data lives on the entity. Emit an ImageNode in the component's image slot:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
  "props": {
    "title": title,
    "text": field_teaser_text
  },
  "slots": {
    "image": [
      { "image": "leando_teaser", "alt": field_topic_image.alt }
    ]
  }
}
```

### `type: reference` — EntityNode

When the data-model declares `type: reference`, emit an EntityNode. The referenced entity renders itself via its own mapping:

```jsonata
{
  "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:content-teaser",
  "props": { "title": field_title },
  "slots": {
    "image": [
      { "entity": "media.image", "view_mode": "leando_teaser", "record": $number(field_image) - 1 }
    ]
  }
}
```

The record index is derived from the reference field value (entity ID) mapped to the sample data array index.

## Rules

- Output is a JSONata array expression returning `ComponentNode[]`
- Input (`$`) is the sample data record for this entity from `data.yml`
- Use dot notation for field access: `$fields.field_image.alt`
- Static values (no `$`): `"h1"`, `true`, `42`
- Provider prefix must be resolved at generation time: `DESIGNBOOK_COMPONENT_NAMESPACE:component-name`
- Reference fields (`type: reference`) emit `{ "entity": "<entity_type>.<bundle>", "view_mode": "...", "record": N }` nodes **as slot values of the wrapping component — NEVER in `props`** (the renderer resolves refs only inside slots and at top level; a ref in `props` is never resolved and renders empty — see scenes-constraints). The **only** exception is a pure delegation parent that has no wrapping markup of its own (e.g. a landing page stacking its paragraph sections), which MAY emit the refs as top-level array items.
- Image fields: see [image-fields rule](../rules/image-fields.md) — `type: image` → ImageNode in slot, `type: reference` → EntityNode in slot
- Conditional components: use `$fields.field_x ? { ... }` to omit when field is empty

## Supported Settings

- `primary_image_field` — name of the entity's primary image field (e.g. `field_topic_image`). Determines which field is mapped to the component's main image slot. The field's data-model type (`image` vs `reference`) decides the mapping pattern — see Image Field Mapping above.

````

### ctx:canvas (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-mapping/blueprints/canvas.md)
````
---
type: data-mapping
name: canvas
priority: 10
trigger:
  domain: data-mapping
---

# Blueprint: Canvas — Passthrough Mapping

Applies when `map-entity` runs for a view mode with `template: canvas` (i.e. a `canvas_page` bundle's full view mode).

## Behavior

For Canvas full view mode, the sample data IS the component tree — no JSONata field mapping is needed. The `component_tree` field on the `canvas_page` record contains a nested component tree stored directly inline. No entity references, no block_content — all component data is self-contained.

## JSONata Pattern

```jsonata
(
  $record := $;
  $record.components
)
```

## Structure of `components`

The `components` field contains a nested `ComponentNode[]`. Each top-level entry is typically a **section** component. Sections use `slots` for nested content, with each slot containing either plain strings or arrays of nested `ComponentNode`.

Example structure in sample data:
```yaml
components:
  - component: "$COMPONENT_NAMESPACE:section"
    props:
      max_width: "lg"
      padding_top: "lg"
      columns: 1
    slots:
      column_1:
        - component: "$COMPONENT_NAMESPACE:hero"
          slots:
            content:
              - component: "$COMPONENT_NAMESPACE:rich-snippet"
                props:
                  headline: "Welcome to our site"
                  headline_level: "h1"
                  text: "Get started with our platform."
            actions:
              - component: "$COMPONENT_NAMESPACE:button"
                props:
                  variant: "primary"
                  content: "Get started"
```

## Rules

- Read the `components` field directly from the sample data record — this IS the component tree
- Do NOT generate a field-by-field JSONata mapping — just return `$record.components`
- There are NO entity references in Canvas — all component data is inline
- Canvas uses the entity type `canvas_page` (not `node`)
- Nested components carry their own `props` and `slots` inline — no further resolution needed
- Sections can have multiple levels of nesting (unlike Layout Builder which is flat)

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

### ctx:sample-template-mapping (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/skills/data-model/rules/sample-template-mapping.md)
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

### ctx:presenter-template-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/skills/data-model/rules/presenter-template.md)
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

### ctx:shell-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/shell-scene-constraints.md)
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

### ctx:screen-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/design/rules/screen-scene-constraints.md)
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

### ctx:scenes-constraints-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/5dd532122306/rules/scenes-constraints.md)
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

### ctx:scenes-constraints-3 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/scenes/rules/scenes-constraints.md)
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

### ctx:presenter-template-surfaces (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/presenter-template-surfaces.md)
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

### ctx:media-image-styles (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/media-image-styles.md)
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

### ctx:form-modes (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/form-modes.md)
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

### ctx:field-type-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/field-type-constraints.md)
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

```

### ctx:drupal-views (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/drupal-views.md)
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

### ctx:drupal-config (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/drupal-config.md)
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

### ctx:block-decision (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/rules/block-decision.md)
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

### ctx:image_style (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/5dd532122306/skills/data-model/blueprints/image_style.md)
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

### ctx:view (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/blueprints/view.md)
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

### ctx:taxonomy_term (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/blueprints/taxonomy_term.md)
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

### ctx:node (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/blueprints/node.md)
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

### ctx:media (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/blueprints/media.md)
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

### ctx:field-types (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/blueprints/field-types.md)
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

### ctx:block_plugin (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/5dd532122306/data-model/blueprints/block_plugin.md)
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

## Steps

### Step: write-component
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:story-image-node-renderer, ctx:region-properties, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:markup-derivation, ctx:local-image-assets, ctx:icon-sprite, ctx:component-contract-index, ctx:token-backed-utilities, ctx:region-properties-2, ctx:font-availability, ctx:component-styling, ctx:component-source, ctx:navigation, ctx:slot-rendering, ctx:sdc-components, ctx:region-properties-3, ctx:reference-field-semantics, ctx:layout-constraints, ctx:js-behavior, ctx:static-assets, ctx:section, ctx:pager, ctx:page, ctx:navigation-2, ctx:logo, ctx:link, ctx:js-behavior-2, ctx:icon, ctx:header, ctx:grid, ctx:form, ctx:footer, ctx:container, ctx:component-template, ctx:button]

- [x] write-component — board-card

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: board-card
    group: Data Display
    description: Preserve existing props, default/state_pill/unassigned stories, footer slot and off-canvas link semantics. Add optional blocked:boolean=false and render neutral textual Blocked badge when true. Render textual Cancelled when state=cancelled, independently of derived status. Do not infer unhealthy from blocked. Keep title/identifier visible and exact workflow state in the board-owned footer. Add blocked and cancelled stories; translate any touched German story sample copy to English. No new component or token files. Both flags may coexist. Use token-backed utilities in touched markup instead of existing arbitrary values and bare styling class; keep data-component-id selector contract.
    variants:
      - id: default
        title: Default
        description: Retained story
      - id: state_pill
        title: State Pill
        description: Retained story
      - id: unassigned
        title: Unassigned
        description: Retained story
      - id: blocked
        title: Blocked
        description: New operational board state
      - id: cancelled
        title: Cancelled
        description: New operational board state
  work_order: Preserve existing props, default/state_pill/unassigned stories, footer slot and off-canvas link semantics. Add optional blocked:boolean=false and render neutral textual Blocked badge when true. Render textual Cancelled when state=cancelled, independently of derived status. Do not infer unhealthy from blocked. Keep title/identifier visible and exact workflow state in the board-owned footer. Add blocked and cancelled stories; translate any touched German story sample copy to English. No new component or token files. Both flags may coexist. Use token-backed utilities in touched markup instead of existing arbitrary values and bare styling class; keep data-component-id selector contract.
  planning_context:
    reference_capture: not_required — user confirms there is no template
    reference_need: null
    scope: |
      ## Proposed specification — Project Board

      Status: proposal; not approved. Scope: Designbook only. Qualification AC01–AC09 remain the acceptance baseline. This proposal does not authorize implementation or a state change.

      ### Target and reuse

      Update `web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml`, scene `project-detail-board`, retaining its identity, shell, project header, active Board tab and sibling scenes. Preserve the existing Overview-to-Board link. Reuse `board`, `board-card`, badges, person, filter controls and list components. The old Intake/Prepare/Work/Accept model is replaced on this screen; unrelated board consumers must retain their existing behavior.

      ### Board rules

      One project-scoped board serves PMs and developers. Use English UI labels: Backlog, Intake, In Progress, Done/Cancelled. Every ticket appears once. Apply classification in this order:

      1. `done` or `cancelled`: Done/Cancelled, regardless of stale conductor/run data.
      2. An active running run: In Progress.
      3. A conductor is assigned, but no running run: Intake.
      4. Otherwise: Backlog; assignee remains optional.

      Blocked tickets without a running run and with a conductor remain in Intake. Blocking alone does not produce an unhealthy/error style. A blocked ticket without a conductor stays in Backlog under the conductor rule. A contradictory blocked-plus-running fixture stays In Progress and retains its Blocked marker; do not hide an actual running run.

      ### Controls and cards

      User means ticket assignee. User and Conductor filters combine with AND and each offers All and Unassigned. Filtering changes cards and visible column counts. Keep empty columns visible with an explanatory empty state.

      Every card shows identifier, title, exact workflow-state badge, assignee when present, and distinct textual Blocked/Cancelled markers when applicable. Reuse existing priority/type/lease presentation where present. Do not encode these distinctions through color alone. Ticket links keep their current target behavior.

      Details only changes In Progress: off shows one column; on groups its cards into subcolumns by exact workflow state. No empty workflow-state subcolumns; retain an In Progress empty state when no runs match. Initial mode is on for developer and off for PM; an explicit current-view choice overrides the default. For a user with both roles, developer wins. No persisted preference or new role infrastructure is in scope; Designbook demonstrates both contexts.

      Done/Cancelled defaults to the last seven days using the closing timestamp, with Today, Last 7 days, Last 30 days and All time choices. Use a fixed fixture clock for deterministic examples. Entries without a closing timestamp appear only under All time, with the absence named; never substitute the last edit timestamp.

      Below the board, show this project's active/running conductors with label, readable status, active-ticket count and reported load/capacity where known. Unknown capacity is shown as unknown, not zero or a fabricated percentage. Ticket filters affect the board; this capacity section continues to describe the project's execution capacity. An empty section says no active conductors.

      ### Presentation and scope

      Use existing semantic/component tokens and layout patterns. Desktop keeps phase comparison visible; narrow screens allow board horizontal scrolling while keeping controls and card text usable. Controls need associated labels, keyboard access and a visible selected state.

      No Drupal routes/config export, backend schema changes, scheduler changes, drag/drop, manual Intake ordering, Overview metrics or new design system are included. Interactive behavior is validated in Storybook where supported; production behavior and production role resolution remain outside this design-only ticket.

      ### Alternatives and risks

      Retaining workflow-phase columns fails the requested operational grouping. Separate PM/developer boards duplicate information; use one board with Details instead. Replacing existing shared components risks older consumers, so extend only where the new display requires it and verify existing variants.

      ### Reference decision

      The user explicitly confirmed: there is no template. Reference capture: `not_required`; ReferenceNeed: none. Use the ticket requirements and retained bakers.build design-system artifacts. The generic Claude Design URL in the project vision is not a Board template and is not a dependency of this work. Do not capture it, request screenshots, or invent a visual comparison score.
    verification_plan: |
      ## Proposed verification plan

      Status: planned, not run for the Board. Functional validation: deterministic Storybook browser checks against AC01–AC09. The user confirmed there is no template: reference-comparison `designbook:design-verify` is not applicable, and no comparison score will be generated. No criterion is currently claimed GREEN.

      ### Functional acceptance and evidence

      | AC | Scenario | Required evidence |
      |---|---|---|
      | AC01 | Open the project's Overview, navigate to Board and return twice | Browser observations retain project context, Board tab and correct screen |
      | AC02 | Load a populated board and an empty board | Screenshots and DOM show Backlog, Intake, In Progress, Done/Cancelled in order |
      | AC03 | Exercise terminal, active-run, conductor-only and no-conductor samples, including contradictory stale data | Deterministic fixture-to-column assertions prove precedence and one placement per ticket |
      | AC04 | Apply each User/Conductor filter, their intersection, Unassigned and reset | Browser/DOM evidence shows matching cards and counts, retained empty columns, no cross-project cards |
      | AC05 | Toggle Details off/on/off with two exact running workflow states | Exact state remains readable on every card; only In Progress splits and merges without losing or duplicating cards |
      | AC06 | Load PM, developer and dual-role contexts, then change Details manually | PM off, developer on, dual-role on; explicit current-view setting honored |
      | AC07 | Show blocked Intake, blocked Backlog, blocked-running and cancelled fixtures | Textual markers distinguish each; blocked alone is not an unhealthy/error indicator |
      | AC08 | Test fixed-clock completion boundaries, old completion, missing date and each period option | Correct membership uses closing time; default Last 7 days; missing date only under All time |
      | AC09 | Show active conductors, known and unknown capacity, and no active conductors | Section below board shows readable status, active-ticket counts and honest load/capacity; ticket filters do not misrepresent project capacity |

      Cover desktop (1440×900) and narrow (390×844), labels, keyboard operation, selected control states, readable card links and horizontal scrolling. These are proposed test viewports, not inferred design-source breakpoints. Retained component variants and sibling project scenes must still render. Capture screenshots as actual output for manual design review; no reference comparison is required. No reference-free diff score may be invented.

      ### Project checks

      For later web UI implementation, run from the repository root:

      - `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build`
      - `bash tests/contract/layout-components.sh`
      - `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs`
      - `cd tests/playwright && npm ci && npx playwright install chromium && npm test` with the recipe-test setup required by WORKFLOW.md.
      - `bash tests/contract/data-display-components.sh` only if component directories are added/removed.

      Separate existing Drupal regression coverage from Storybook acceptance: production backend implementation remains out of scope. Store each executed result with command, observed result and immutable tested commit. No live UI, screenshot, production role behavior or browser result has been verified during this spec run.

      ### Spec preparation evidence

      At repository base `dbc46c2722dd7e278a5784652f6e74b35309186a` with the previously reported local workflow/test edits, `npx --no-install storybook-addon-designbook intake design-screen` and its `--palette` form succeeded. They resolve planning context, not implementation acceptance. The external Claude Design URL was inaccessible through the web tool; no screenshot was captured. The existing reference metadata names only `ticket-list`.

      ### Actors and durable functional coverage

      | Actor | Role | Account | Environment | Status |
      |---|---|---|---|---|
      | Browser visitor | PM presentation (Details off) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Browser visitor | Developer presentation (Details on, including dual-role policy) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Human reviewer | Design review | not_required: static prototype | Worktree Storybook after coding | pending |

      Permanent coverage is planned in `tests/playwright/features/project-board/project-board.feature` and `tests/playwright/steps/project-board.steps.ts`, using the existing BDD suite and explicit Storybook URLs. Start/reuse Storybook through its CLI in the steps if needed so CI can run the coverage. Targeted command from `tests/playwright`: `npm test -- --grep "Project Board"`; the full project suite is a separate regression gate. Fix the sample clock at 2026-10-06T12:00:00Z; Today is the UTC calendar day and rolling 7/30-day windows include both boundaries through that clock. Future closing dates are excluded except under All time.

      Expected default membership: Backlog BOARD-01/02/11; Intake BOARD-03/04; In Progress BOARD-05/06/12; Done/Cancelled BOARD-07/08/13/15. BOARD-14 belongs to another project and never appears. Additional dates cover old completion, missing time, one second before the seven-day threshold and future time. Tests compare membership and counts, not fixture order or style classes.

      Runtime role authorization is outside scope: PM/developer are presentation contexts supplied to the prototype, not new Drupal roles. Product checks use their existing configured actors; no administrator is selected for convenience.
    baseline_commit: dbc46c2722dd7e278a5784652f6e74b35309186a
    execution_mode: persist
    constraints:
      - Designbook artifacts only; no routes, PHP, Drupal config, scheduler, Overview metrics or new component directories.
      - 'Project rules override generic blueprint JS: use installed Alpine and native form controls; no new dependency.'
      - No reference comparison or design-verify score without a visual template. Browser acceptance is the functional gate.
      - Do not execute this saved plan in spec.
  baseline:
    web/themes/custom/bb_theme/components/board-card/board-card.component.yml:
      sha256: 4df9d6c2b292dee720d59f0f3fafc0118e9f432c36b91980e99c95bfaa170f87
      content: |
        $schema: https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json
        name: Board Card
        status: stable
        group: Data Display
        description: 'Compact card for one item of a board: an identifier, an optional priority tag, a clamped title, and a footer slot for the claim, the status and the assignee.


          ITS NAME WAS ALREADY GENERIC AND ITS CONTRACT WAS NOT. Every prop title named the one entity the board happened to hold, which made a card that draws an identifier, a title, a tag and an accent edge read as though it could draw nothing else. What a board holds is the BOARD''S knowledge, and the mapping''s: the card takes an identifier and a title, and it does not ask what they identify.'
        provider: bb_theme
        libraryOverrides:
          dependencies:
            - core/drupal.dialog.ajax
            # The card overlay anchor opens the ticket in Drupal's off-canvas tray
            # (data-dialog-type="dialog.off_canvas"); that dialog type needs the
            # off_canvas library present, or the click never opens the sidebar.
            - core/drupal.dialog.off_canvas
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
              description: 'Accepts the short type or the bb_<type> workflow id; the leading bb_ is stripped for the colour lookup.'
            state:
              type: string
              title: Workflow state key (e.g. backlog, todo, coding)
            url:
              type: string
              title: Canonical URL
          required:
            - identifier
            - title
        slots:
          footer:
            title: Footer
            description: 'Footer line, in this order: the lease badge where a lease is held, a spacer, a dotted badge whose label is the card''s EXACT workflow state as text (spec, diagnose, pre_deployment — the column carries only the phase), then the assignee and the conductor. The state must never be conveyed by colour alone: the badge''s label is what names it, while its dot and the card''s accent edge encode the derived status.'
        thirdPartySettings:
          sdcStorybook:
            disableBasicStory: true
    web/themes/custom/bb_theme/components/board-card/board-card.default.story.yml:
      sha256: a99e0e5144f2ec0e53de71ed5b434b74874e92a1815c2647ef9b45be63558f19
      content: |
        component: bb_theme:board-card
        name: Default
        props:
          identifier: GL-138
          title: Workflow-State-Machine refactoren
          status: running
          priority: p2
        slots:
          footer:
            - type: component
              component: bb_theme:badge
              props:
                label: srv01
                tone: lease
                mono: true
                icon: lock
            - type: element
              tag: span
              value: ''
              attributes:
                class: flex-1
            - type: component
              component: bb_theme:badge
              props:
                label: running
                tone: running
                dot: true
    web/themes/custom/bb_theme/components/board-card/board-card.state_pill.story.yml:
      sha256: 6a2231260b02a399a048d1573450282428994aef00aafd8aadfa76e80f5b2edf
      content: |
        # BB-334 D4 — the card precises the column instead of repeating it.
        #
        # A board column is a PHASE (Intake, Prepare, Work, Accept), so the column alone cannot say whether
        # a card in Prepare is in `spec`, `diagnose` or `pre_deployment`. The card names its exact state as
        # TEXT in a badge; the badge's dot and the card's accent edge keep encoding derived_status.
        #
        # This is the footer composition the two pre-existing card stories do not cover — both used to end in
        # a bare dot, which showed the run status in colour alone and never named it. The state shown here,
        # `pre_deployment`, is deliberately one no state-column board ever had a column for.
        component: bb_theme:board-card
        name: State pill
        props:
          identifier: BB-418
          title: Release 2.4 to production
          status: running
          priority: p1
          type: bb_deployment
          state: pre_deployment
        slots:
          footer:
            - type: component
              component: bb_theme:badge
              props:
                label: srv01
                tone: lease
                mono: true
                icon: lock
            - type: element
              tag: span
              value: ''
              attributes:
                class: flex-1
            - type: component
              component: bb_theme:badge
              props:
                label: pre_deployment
                tone: running
                dot: true
            - type: component
              component: bb_theme:person
              props:
                variant: compact
                initials: CW
                color: running
    web/themes/custom/bb_theme/components/board-card/board-card.twig:
      sha256: 9acece00caebefefa77e964333b2f54dd4ca25b1f9489d1e928145baa271c252
      content: |
        {% set edge_map = {
          'running': 'before:bg-state-running',
          'attention': 'before:bg-state-attention',
          'needs_input': 'before:bg-state-attention',
          'wait': 'before:bg-state-unassigned'
        } %}
        {% set card_classes = ['board-card', 'relative', 'bg-surface-2', 'border', 'border-border-2', 'rounded-[var(--radius-xs,5px)]', 'pt-[8px]', 'pr-[9px]', 'pb-[8px]', 'pl-[12px]', "before:content-['']", 'before:absolute', 'before:left-0', 'before:top-0', 'before:bottom-0', 'before:w-[3px]', 'before:rounded-l-[var(--radius-xs,5px)]', edge_map[status]|default('before:bg-transparent')] %}
        {% if status == 'wait' %}{% set card_classes = card_classes|merge(['bg-state-unassigned-tint', 'border-state-unassigned/30']) %}{% endif %}
        {# Colour by ticket type: normalise the bb_<type> workflow id to the short key. #}
        {% set type_key = (type|default(''))|replace({'bb_': ''}) %}
        {% set type_dot_map = {
          'feature': 'bg-type-feature',
          'bug': 'bg-type-bug',
          'chore': 'bg-type-chore'
        } %}
        <article{{ (attributes ?: create_attribute()).addClass(card_classes).setAttribute('data-state', state|default('')).setAttribute('data-type', type_key) }}>
          {% if url %}<a class="use-ajax absolute inset-0 z-10" href="{{ url }}" data-dialog-type="dialog.off_canvas" data-dialog-options='{"width":"40%"}' aria-label="Open {{ identifier }}"></a>{% endif %}
          <div class="flex items-center gap-[6px] mb-[4px]">
            {% if type_dot_map[type_key] is defined %}<span class="inline-block w-[8px] h-[8px] rounded-full shrink-0 {{ type_dot_map[type_key] }}" title="{{ type_key }}" aria-label="{{ type_key }}"></span>{% endif %}
            <span class="font-mono font-semibold text-section text-text">{{ identifier }}</span>
            <span class="flex-1"></span>
            {#- P1 is `critical`, not `wait`. Both draw the same red pair, so nothing moves on
                the screen; what changes is what the badge SAYS. `wait` means nobody is acting
                on this, which is false of a card somebody is working — the tone was borrowed
                for its colour while the token layer had no name for the red that ranks. #}
            {% if priority %}{{ include('bb_theme:badge', { label: priority|upper, tone: priority == 'p1' ? 'critical' : 'neutral' }, with_context = false) }}{% endif %}
          </div>
          <p class="text-caption text-text leading-[1.32] m-0 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">{{ title }}</p>
          {% if footer %}<div class="relative z-20 flex items-center gap-[6px] mt-[7px]">{{ footer }}</div>{% endif %}
        </article>
    web/themes/custom/bb_theme/components/board-card/board-card.unassigned.story.yml:
      sha256: 739a5f9c710a1c68d8252898dff652a38d47e44665ce1ecd7fafc7a828f24c1a
      content: |
        component: bb_theme:board-card
        name: Unassigned
        props:
          identifier: GL-142
          title: Lease abgelaufen, niemand zugewiesen
          status: wait
          priority: p1
          type: bb_bug
        slots:
          footer:
            - type: element
              tag: span
              value: ''
              attributes:
                class: flex-1
            - type: component
              component: bb_theme:badge
              props:
                label: wait
                tone: wait
                dot: true
  fixtures:
    as_of: '2026-10-06T12:00:00Z'
    tickets:
      - id: '01'
        identifier: BOARD-01
        title: Unassigned backlog
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: null
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '02'
        identifier: BOARD-02
        title: Assigned backlog
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '03'
        identifier: BOARD-03
        title: Ready for conductor
        state: spec
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '04'
        identifier: BOARD-04
        title: Blocked dependency
        state: spec
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '05'
        identifier: BOARD-05
        title: Build the project screen
        state: coding
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '06'
        identifier: BOARD-06
        title: Review the project screen
        state: review
        project_id: '1'
        conductor_id: '1'
        assignee_id: '2'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '07'
        identifier: BOARD-07
        title: Delivered screen
        state: done
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-05T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '08'
        identifier: BOARD-08
        title: Cancelled experiment
        state: cancelled
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-04T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '09'
        identifier: BOARD-09
        title: Older delivery
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-01T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '10'
        identifier: BOARD-10
        title: Missing closing time
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '11'
        identifier: BOARD-11
        title: Blocked without conductor
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '12'
        identifier: BOARD-12
        title: Running despite block
        state: coding
        project_id: '1'
        conductor_id: c-board
        assignee_id: '2'
        has_running_run: true
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '13'
        identifier: BOARD-13
        title: Terminal overrides stale run
        state: done
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: '2026-10-06T10:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '14'
        identifier: BOARD-14
        title: Another project
        state: coding
        project_id: '2'
        conductor_id: '2'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '15'
        identifier: BOARD-15
        title: Seven-day boundary
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-29T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '16'
        identifier: BOARD-16
        title: Outside seven days
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-29T11:59:59Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '17'
        identifier: BOARD-17
        title: Future closing date
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-07T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
    conductors:
      - id: '1'
        project_id: '1'
        label: cw · framework
        status: online
        current_load: 2
        max_parallel: 5
        active_ticket_ids:
          - '05'
          - '06'
      - id: c-board
        project_id: '1'
        label: cw · board
        status: online
        current_load: 1
        max_parallel: null
        active_ticket_ids:
          - '12'
      - id: offline-board
        project_id: '1'
        label: Offline worker
        status: offline
        current_load: 0
        max_parallel: 2
        active_ticket_ids: []
      - id: '2'
        project_id: '2'
        label: Other project
        status: online
        current_load: 1
        max_parallel: 2
        active_ticket_ids:
          - '14'
    expected_default_columns:
      Backlog:
        - '01'
        - '02'
        - '11'
      Intake:
        - '03'
        - '04'
      In Progress:
        - '05'
        - '06'
        - '12'
      Done/Cancelled:
        - '07'
        - '08'
        - '13'
        - '15'
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board-card/board-card.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board-card/board-card.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board-card/board-card.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board-card/board-card.js
  ```

  #### Results
  <!-- done -->

- [x] write-component — board

  Instruction: task:write-component

  #### Params
  ```yaml
  component:
    component: board
    group: Data Display
    description: 'Extend the existing Board without changing default/phases callers. Add optional controls_enabled (false), details_default (false), as_of (ISO timestamp), and a typed filter_options object. Keep columns as plain data. Operational input always supplies Backlog/Intake/In Progress/Done/Cancelled and each card carries assignee_id, conductor_id, closed_date, blocked, state. Classification stays in the project Board mapping; shared Board only filters supplied columns and splits the supplied In Progress column by exact state. When controls_enabled is false preserve the existing columns API and layout. Use Alpine state for User/Conductor AND filters, completion period and Details, no global store or persistence. Compose existing form_label/form_select for User and Conductor and button/segmented_control for Details and completion window; native controls have unique names/labels and do not submit. Each card is rendered once in the selected grouping. Derive visible counts, retain four main phases, order detail subcolumns by first occurrence in supplied input. Closed-date period applies only to terminal column; fixed as_of = 2026-10-06T12:00:00Z. Today uses UTC calendar day; 7/30 days are rolling inclusive lower bound through as_of; reject future closed dates except under All time. Blank/invalid closing dates appear under All time only with Closing date unavailable. A supplied boolean details_default expresses the upstream role decision: PM=false, developer/dual-role=true; no actual authorization/role lookup here. Preserve current footer order and overlay-link behavior. Show Blocked as neutral text badge independently of health; cancelled text derives from state. Reuse semantic/component spacing and colors only; fix arbitrary-value/BEM tokens only in the modified board/card markup using existing roles. No new tokens or directories. Include a focusable horizontal scroll region; controls wrap on narrow view. No empty exact-state subcolumns. Add operational and operational_details stories with meaningful default difference (PM versus developer), retain default/phases story identities and existing behavior. New stories describe states, not additional application roles or routes. If a small helper is required, only board.src.js and the corresponding runnable board.test.mjs are allowed; use one browser-compatible pure module or Alpine expressions, never hand-written compiled board.js or duplicated logic.'
    variants:
      - id: default
        title: Default
        description: Retained story
      - id: phases
        title: Phases
        description: Retained story
      - id: operational
        title: Operational
        description: New operational board state
      - id: operational_details
        title: Operational Details
        description: New operational board state
  work_order: 'Extend the existing Board without changing default/phases callers. Add optional controls_enabled (false), details_default (false), as_of (ISO timestamp), and a typed filter_options object. Keep columns as plain data. Operational input always supplies Backlog/Intake/In Progress/Done/Cancelled and each card carries assignee_id, conductor_id, closed_date, blocked, state. Classification stays in the project Board mapping; shared Board only filters supplied columns and splits the supplied In Progress column by exact state. When controls_enabled is false preserve the existing columns API and layout. Use Alpine state for User/Conductor AND filters, completion period and Details, no global store or persistence. Compose existing form_label/form_select for User and Conductor and button/segmented_control for Details and completion window; native controls have unique names/labels and do not submit. Each card is rendered once in the selected grouping. Derive visible counts, retain four main phases, order detail subcolumns by first occurrence in supplied input. Closed-date period applies only to terminal column; fixed as_of = 2026-10-06T12:00:00Z. Today uses UTC calendar day; 7/30 days are rolling inclusive lower bound through as_of; reject future closed dates except under All time. Blank/invalid closing dates appear under All time only with Closing date unavailable. A supplied boolean details_default expresses the upstream role decision: PM=false, developer/dual-role=true; no actual authorization/role lookup here. Preserve current footer order and overlay-link behavior. Show Blocked as neutral text badge independently of health; cancelled text derives from state. Reuse semantic/component spacing and colors only; fix arbitrary-value/BEM tokens only in the modified board/card markup using existing roles. No new tokens or directories. Include a focusable horizontal scroll region; controls wrap on narrow view. No empty exact-state subcolumns. Add operational and operational_details stories with meaningful default difference (PM versus developer), retain default/phases story identities and existing behavior. New stories describe states, not additional application roles or routes. If a small helper is required, only board.src.js and the corresponding runnable board.test.mjs are allowed; use one browser-compatible pure module or Alpine expressions, never hand-written compiled board.js or duplicated logic.'
  planning_context:
    reference_capture: not_required — user confirms there is no template
    reference_need: null
    scope: |
      ## Proposed specification — Project Board

      Status: proposal; not approved. Scope: Designbook only. Qualification AC01–AC09 remain the acceptance baseline. This proposal does not authorize implementation or a state change.

      ### Target and reuse

      Update `web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml`, scene `project-detail-board`, retaining its identity, shell, project header, active Board tab and sibling scenes. Preserve the existing Overview-to-Board link. Reuse `board`, `board-card`, badges, person, filter controls and list components. The old Intake/Prepare/Work/Accept model is replaced on this screen; unrelated board consumers must retain their existing behavior.

      ### Board rules

      One project-scoped board serves PMs and developers. Use English UI labels: Backlog, Intake, In Progress, Done/Cancelled. Every ticket appears once. Apply classification in this order:

      1. `done` or `cancelled`: Done/Cancelled, regardless of stale conductor/run data.
      2. An active running run: In Progress.
      3. A conductor is assigned, but no running run: Intake.
      4. Otherwise: Backlog; assignee remains optional.

      Blocked tickets without a running run and with a conductor remain in Intake. Blocking alone does not produce an unhealthy/error style. A blocked ticket without a conductor stays in Backlog under the conductor rule. A contradictory blocked-plus-running fixture stays In Progress and retains its Blocked marker; do not hide an actual running run.

      ### Controls and cards

      User means ticket assignee. User and Conductor filters combine with AND and each offers All and Unassigned. Filtering changes cards and visible column counts. Keep empty columns visible with an explanatory empty state.

      Every card shows identifier, title, exact workflow-state badge, assignee when present, and distinct textual Blocked/Cancelled markers when applicable. Reuse existing priority/type/lease presentation where present. Do not encode these distinctions through color alone. Ticket links keep their current target behavior.

      Details only changes In Progress: off shows one column; on groups its cards into subcolumns by exact workflow state. No empty workflow-state subcolumns; retain an In Progress empty state when no runs match. Initial mode is on for developer and off for PM; an explicit current-view choice overrides the default. For a user with both roles, developer wins. No persisted preference or new role infrastructure is in scope; Designbook demonstrates both contexts.

      Done/Cancelled defaults to the last seven days using the closing timestamp, with Today, Last 7 days, Last 30 days and All time choices. Use a fixed fixture clock for deterministic examples. Entries without a closing timestamp appear only under All time, with the absence named; never substitute the last edit timestamp.

      Below the board, show this project's active/running conductors with label, readable status, active-ticket count and reported load/capacity where known. Unknown capacity is shown as unknown, not zero or a fabricated percentage. Ticket filters affect the board; this capacity section continues to describe the project's execution capacity. An empty section says no active conductors.

      ### Presentation and scope

      Use existing semantic/component tokens and layout patterns. Desktop keeps phase comparison visible; narrow screens allow board horizontal scrolling while keeping controls and card text usable. Controls need associated labels, keyboard access and a visible selected state.

      No Drupal routes/config export, backend schema changes, scheduler changes, drag/drop, manual Intake ordering, Overview metrics or new design system are included. Interactive behavior is validated in Storybook where supported; production behavior and production role resolution remain outside this design-only ticket.

      ### Alternatives and risks

      Retaining workflow-phase columns fails the requested operational grouping. Separate PM/developer boards duplicate information; use one board with Details instead. Replacing existing shared components risks older consumers, so extend only where the new display requires it and verify existing variants.

      ### Reference decision

      The user explicitly confirmed: there is no template. Reference capture: `not_required`; ReferenceNeed: none. Use the ticket requirements and retained bakers.build design-system artifacts. The generic Claude Design URL in the project vision is not a Board template and is not a dependency of this work. Do not capture it, request screenshots, or invent a visual comparison score.
    verification_plan: |
      ## Proposed verification plan

      Status: planned, not run for the Board. Functional validation: deterministic Storybook browser checks against AC01–AC09. The user confirmed there is no template: reference-comparison `designbook:design-verify` is not applicable, and no comparison score will be generated. No criterion is currently claimed GREEN.

      ### Functional acceptance and evidence

      | AC | Scenario | Required evidence |
      |---|---|---|
      | AC01 | Open the project's Overview, navigate to Board and return twice | Browser observations retain project context, Board tab and correct screen |
      | AC02 | Load a populated board and an empty board | Screenshots and DOM show Backlog, Intake, In Progress, Done/Cancelled in order |
      | AC03 | Exercise terminal, active-run, conductor-only and no-conductor samples, including contradictory stale data | Deterministic fixture-to-column assertions prove precedence and one placement per ticket |
      | AC04 | Apply each User/Conductor filter, their intersection, Unassigned and reset | Browser/DOM evidence shows matching cards and counts, retained empty columns, no cross-project cards |
      | AC05 | Toggle Details off/on/off with two exact running workflow states | Exact state remains readable on every card; only In Progress splits and merges without losing or duplicating cards |
      | AC06 | Load PM, developer and dual-role contexts, then change Details manually | PM off, developer on, dual-role on; explicit current-view setting honored |
      | AC07 | Show blocked Intake, blocked Backlog, blocked-running and cancelled fixtures | Textual markers distinguish each; blocked alone is not an unhealthy/error indicator |
      | AC08 | Test fixed-clock completion boundaries, old completion, missing date and each period option | Correct membership uses closing time; default Last 7 days; missing date only under All time |
      | AC09 | Show active conductors, known and unknown capacity, and no active conductors | Section below board shows readable status, active-ticket counts and honest load/capacity; ticket filters do not misrepresent project capacity |

      Cover desktop (1440×900) and narrow (390×844), labels, keyboard operation, selected control states, readable card links and horizontal scrolling. These are proposed test viewports, not inferred design-source breakpoints. Retained component variants and sibling project scenes must still render. Capture screenshots as actual output for manual design review; no reference comparison is required. No reference-free diff score may be invented.

      ### Project checks

      For later web UI implementation, run from the repository root:

      - `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build`
      - `bash tests/contract/layout-components.sh`
      - `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs`
      - `cd tests/playwright && npm ci && npx playwright install chromium && npm test` with the recipe-test setup required by WORKFLOW.md.
      - `bash tests/contract/data-display-components.sh` only if component directories are added/removed.

      Separate existing Drupal regression coverage from Storybook acceptance: production backend implementation remains out of scope. Store each executed result with command, observed result and immutable tested commit. No live UI, screenshot, production role behavior or browser result has been verified during this spec run.

      ### Spec preparation evidence

      At repository base `dbc46c2722dd7e278a5784652f6e74b35309186a` with the previously reported local workflow/test edits, `npx --no-install storybook-addon-designbook intake design-screen` and its `--palette` form succeeded. They resolve planning context, not implementation acceptance. The external Claude Design URL was inaccessible through the web tool; no screenshot was captured. The existing reference metadata names only `ticket-list`.

      ### Actors and durable functional coverage

      | Actor | Role | Account | Environment | Status |
      |---|---|---|---|---|
      | Browser visitor | PM presentation (Details off) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Browser visitor | Developer presentation (Details on, including dual-role policy) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Human reviewer | Design review | not_required: static prototype | Worktree Storybook after coding | pending |

      Permanent coverage is planned in `tests/playwright/features/project-board/project-board.feature` and `tests/playwright/steps/project-board.steps.ts`, using the existing BDD suite and explicit Storybook URLs. Start/reuse Storybook through its CLI in the steps if needed so CI can run the coverage. Targeted command from `tests/playwright`: `npm test -- --grep "Project Board"`; the full project suite is a separate regression gate. Fix the sample clock at 2026-10-06T12:00:00Z; Today is the UTC calendar day and rolling 7/30-day windows include both boundaries through that clock. Future closing dates are excluded except under All time.

      Expected default membership: Backlog BOARD-01/02/11; Intake BOARD-03/04; In Progress BOARD-05/06/12; Done/Cancelled BOARD-07/08/13/15. BOARD-14 belongs to another project and never appears. Additional dates cover old completion, missing time, one second before the seven-day threshold and future time. Tests compare membership and counts, not fixture order or style classes.

      Runtime role authorization is outside scope: PM/developer are presentation contexts supplied to the prototype, not new Drupal roles. Product checks use their existing configured actors; no administrator is selected for convenience.
    baseline_commit: dbc46c2722dd7e278a5784652f6e74b35309186a
    execution_mode: persist
    constraints:
      - Designbook artifacts only; no routes, PHP, Drupal config, scheduler, Overview metrics or new component directories.
      - 'Project rules override generic blueprint JS: use installed Alpine and native form controls; no new dependency.'
      - No reference comparison or design-verify score without a visual template. Browser acceptance is the functional gate.
      - Do not execute this saved plan in spec.
  baseline:
    web/themes/custom/bb_theme/components/board/board.component.yml:
      sha256: b9af85589c43b40ae44beecc0ff3fa3cc73477ee5693c9a3e306c6e3a39f1cf9
      content: |
        $schema: https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json
        name: Board
        status: stable
        group: Data Display
        description: 'A board for one workflow tab, and it OWNS ITS COLUMNS. A column is a name, a count, an optional header tone and a list of cards — four values, which is why it is data and not a component: a container owns what is inside it, so there is nowhere for a column component to exist and no screen can assemble a board out of half-columns. The eleven lines of markup that were a component of their own are iterated here instead. It composes `board-card` itself, one per entry of a column''s `cards`, and hands it the props that component already declares — the card''s contract is untouched. It also composes the card''s FOOTER, because `board-card` declares that as a slot and a slot cannot be filled from a prop: the order is the card''s own contract''s — the lease badge where a lease is held, a spacer, a dotted badge whose label is the exact workflow state, then the assignee — and encoding it here is what makes every board obey that order rather than each caller spelling it out slightly differently. The state badge''s TONE is derived from the card''s `status` rather than carried beside it, because every caller was passing a tone that was already a function of the status it also passed. A column is a PHASE and never a state: every active state of every ticket workflow maps into exactly one of the four, so the column set never changes and a workflow filter reduces cards like any other filter. The card carries its exact state as the badge''s label, so three states of three workflows are all legible in one column. NOTE FOR THE DRUPAL SIDE: the dashboard''s board renderer still builds column components and passes them into a `columns` slot; it is repointed at these props by the wiring task that owns the module layer, and until then the live board fragment is the one surface this contract does not yet describe.'
        provider: bb_theme
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
                    description: The column heading, rendered uppercase as the label of the header badge. It names a PHASE — Intake, Prepare, Work, Accept — not a workflow state.
                  count:
                    type: integer
                    title: Card count
                    description: How many cards this phase holds. Carried on the column as `data-count` rather than printed, which is where the deleted column component put it.
                  dot:
                    type: string
                    enum:
                      - running
                      - attention
                    title: Header tone
                    description: 'Present where the phase itself has a status worth showing; the header badge then carries the tone and a dot. Absent, the header is the name alone — a dot with nothing to say is worse than no dot.'
                  cards:
                    type: array
                    title: Cards
                    description: 'The cards in this column, each a plain-data record of `board-card`''s own props plus the three values its footer line is composed from. Empty or absent, the column shows the `empty` slot.'
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
                          description: 'The card''s EXACT state, rendered as the LABEL of the footer''s dotted badge. The column carries only the phase, so this is the only place the state is legible — and it is text, never colour alone.'
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
        slots:
          empty:
            title: Empty
            description: 'What a column with no cards shows — a sentence that names WHAT is absent over what period, which is a thing a screen knows and a board does not. ONE slot rather than one per column, exactly as `table` and `list` have one: a slot per column would be a slot per item again, which is the escape hatch the container exists to close.'
        thirdPartySettings:
          sdcStorybook:
            disableBasicStory: true
    web/themes/custom/bb_theme/components/board/board.default.story.yml:
      sha256: 32762e85c5e33945bb7a0553ff8947b77727a5d9516aac730309bd8f79efb874
      content: |
        # The board at its smallest: three columns as DATA, and the third one empty.
        #
        # There is no column component to compose any more — a column is a name, a count, an optional header
        # tone and a list of cards, and the board iterates them. The `empty` slot is the board's, not the
        # column's, and it is what the cardless column shows.
        component: bb_theme:board
        name: Default
        props:
          columns:
            - name: todo
              count: 1
              cards:
                - identifier: GL-143
                  title: Implement the lease renewal backoff
            - name: coding
              count: 1
              dot: running
              cards:
                - identifier: GL-138
                  title: Refactor the workflow state machine
                  status: running
                  state: coding
            - name: cancelled
              count: 0
        slots:
          empty:
            - type: element
              tag: span
              value: nothing discarded
              attributes:
                class: opacity-60
    web/themes/custom/bb_theme/components/board/board.phases.story.yml:
      sha256: a23d1fa70b43f24168bf463ceca673b514593dda4bc18bfcda1fd68a7e533175
      content: |
        # A COLUMN IS A PHASE, NOT A STATE.
        #
        # The four columns are fixed: Intake, Prepare, Work, Accept. Every active state of every
        # ticket-group workflow maps into exactly one of them, so the column set never changes and the
        # workflow filter reduces cards like any other filter instead of swapping the board's structure.
        # That is why a deployment card and a feature card stand side by side here.
        #
        # The column carries the phase; the CARD carries its exact state as the LABEL of a dotted badge, so
        # `spec`, `diagnose` and `pre_deployment` are all legible in the same Prepare column. The accent edge
        # and the badge's dot keep encoding the derived status — "is this moving?" — so neither dimension is
        # conveyed by colour alone.
        #
        # THE COLUMNS ARE DATA. There is no column component to compose, and the cards are data too: each is
        # `board-card`'s own props plus the three values its footer line is composed from — the lease, the
        # state and the assignee. The footer's ORDER is the card's contract's and the board applies it, which
        # is what this story used to spell out by hand for every card, spacer included.
        #
        # THE STATE BADGE'S TONE IS NOT WRITTEN HERE, because it is a function of `status` and this story used
        # to state both. `idle` reads as `neutral`: the badge tints only where the token layer has a tint/ink
        # PAIR, so an unknown status is quiet rather than given a colour of its own.
        #
        # Terminal states (done, cancelled) render in no column: a board is the view of work in flight.
        component: bb_theme:board
        name: Phases
        props:
          columns:
            # Intake — qualification, for every workflow that has it. Rendered empty on purpose: the board
            # needs one column that shows its `empty` slot, and an untriaged backlog is the honest case.
            - name: Intake
              count: 0
            # Prepare — spec (feature/chore), diagnose (bug), pre_deployment (deployment). Three different
            # states, three different workflows, one phase.
            - name: Prepare
              count: 3
              dot: running
              cards:
                - identifier: BB-412
                  title: Design the ticket list screen
                  status: idle
                  priority: p2
                  type: bb_feature
                  state: spec
                  assignee_initials: CW
                  assignee_color: running
                - identifier: BB-407
                  title: Lease renewal drops the claim under load
                  status: running
                  priority: p1
                  type: bb_bug
                  state: diagnose
                  lease: srv01
                  assignee_initials: MR
                  assignee_color: attention
                # No lease is held, so no claim badge is rendered at all — an empty badge would claim a
                # machine owns the ticket. Nobody is assigned either, so no avatar.
                - identifier: BB-418
                  title: Release 2.4 to production
                  status: wait
                  priority: p1
                  type: bb_deployment
                  state: pre_deployment
            # Work — coding (feature/chore/bug), verifying (verification).
            - name: Work
              count: 2
              dot: running
              cards:
                - identifier: BB-401
                  title: Design the Board screen
                  status: running
                  priority: p2
                  type: bb_feature
                  state: coding
                  lease: srv02
                  assignee_initials: CW
                  assignee_color: running
                - identifier: BB-395
                  title: Verify the import connector against the staging data
                  status: attention
                  priority: p3
                  type: bb_verification
                  state: verifying
                  lease: srv03
            # Accept — review (feature/chore/bug), post_deployment (deployment), summary (verification).
            - name: Accept
              count: 2
              cards:
                # needs_input has no tone of its own; the theme renders it as the amber attention pill, so the
                # board follows that house mapping rather than inventing a tint.
                - identifier: BB-388
                  title: Agree the add and edit action pattern
                  status: needs_input
                  priority: p2
                  type: bb_feature
                  state: review
                  assignee_initials: MR
                  assignee_color: attention
                - identifier: BB-377
                  title: Release 2.3 to production
                  status: idle
                  priority: p3
                  type: bb_deployment
                  state: post_deployment
                  assignee_initials: CW
                  assignee_color: running
        slots:
          empty:
            - type: element
              tag: span
              value: nothing waiting
              attributes:
                class: opacity-60
    web/themes/custom/bb_theme/components/board/board.twig:
      sha256: 400f37980c5009a87d83aed17f7cde40946671eab9b76f25fc02a00b27f0c273
      content: |
        {# A BOARD OWNS ITS COLUMNS, and a column was never a component.

           `columns` is DATA now, not a slot. A column is a name, a count, an optional
           header tone and a list of cards — four values — and the eleven lines of markup
           that used to be a component of its own live here, iterated. The rule is the one
           `table` and `list` follow: a container owns what is inside it, so there is
           nowhere for a column component to exist and no scene can assemble a board out
           of half-columns.

           IT COMPOSES `board-card` ITSELF, one per entry of `cards`. The card keeps its
           own contract untouched — this template hands it the props it already declares.

           THE FOOTER LINE IS COMPOSED FROM THE CARD'S OWN DATA, because `board-card`
           declares `footer` as a slot and a slot cannot be filled from a prop. Its order
           is not this template's invention: the card's own contract states it — the lease
           badge where a lease is held, a spacer, a dotted badge whose label is the card's
           exact workflow state, then the assignee. Encoding that order here is what makes
           the two call sites obey it instead of each spelling it out slightly differently,
           which is what they were doing.

           THE STATE BADGE'S TONE IS DERIVED FROM `status`, not carried. Every call site
           was passing a tone that was already a function of the status it also passed —
           one value written twice, the same duplication the run line shed. The label is
           the state and the dot plus the card's accent edge carry the derived status, so
           the state is never conveyed by colour alone.

           THE HEADER IS ONE BADGE. It used to be a bare dot beside a word: the dot
           carried the state and was `aria-hidden`, so a screen reader was told nothing at
           all about it. A badge cannot do that — its label is required — so the state name
           IS the label and the dot is the tone on it. Without a tone there is no dot and
           no tint, only the name. #}
        {% set status_tone = {
          'running': 'running',
          'attention': 'attention',
          'needs_input': 'attention',
          'wait': 'wait',
          'idle': 'neutral'
        } %}
        <div{{ (attributes ?: create_attribute()).addClass(['flex', 'gap-2', 'overflow-x-auto', 'pb-1']) }}>
          {% for column in columns %}
            <div class="flex flex-col min-h-38 flex-1 shrink-0 basis-38 min-w-38 bg-app border border-border-2 rounded-sm"
              data-col="{{ column.name }}" data-count="{{ column.count|default(0) }}">
              <div class="flex items-center gap-2 px-2 py-2 border-b border-border-2">
                {{- include('bb_theme:badge', {
                  label: column.name|upper,
                  tone: column.dot|default('neutral'),
                  dot: column.dot ? true : false,
                }, with_context = false) -}}
              </div>
              {% if column.cards is not empty %}
                <div class="flex flex-col gap-2 flex-1 p-2">
                  {% for card in column.cards %}
                    {%- set footer %}
                      {%- if card.lease %}{{ include('bb_theme:badge', { label: card.lease, tone: 'lease', mono: true, icon: 'lock' }, with_context = false) }}{% endif -%}
                      <span class="flex-1"></span>
                      {%- if card.state %}{{ include('bb_theme:badge', { label: card.state, tone: status_tone[card.status]|default('neutral'), dot: true }, with_context = false) }}{% endif -%}
                      {%- if card.assignee_initials %}{{ include('bb_theme:person', {
                        variant: 'compact',
                        display_name: card.assignee_name,
                        initials: card.assignee_initials,
                        color: card.assignee_color|default('running'),
                      }, with_context = false) }}{% endif -%}
                    {% endset -%}
                    {{ include('bb_theme:board-card', {
                      identifier: card.identifier,
                      title: card.title,
                      status: card.status,
                      priority: card.priority,
                      type: card.type,
                      state: card.state,
                      url: card.url,
                      footer: footer,
                    }, with_context = false) }}
                  {% endfor %}
                </div>
              {% else %}
                {#- A COLUMN WITH NO CARDS. The `empty` slot is the screen's own sentence —
                    a named absence, which is a thing a screen knows and a board does not.
                    One slot rather than one per column, exactly as `table` and `list` have
                    one: a board has at most one genuinely unstaffed phase to explain, and
                    a slot per column would be a slot per item again. #}
                <div class="flex-1 grid place-items-center text-text-faint text-eyebrow p-3 text-center">{% if empty %}{{ empty }}{% else %}<span class="opacity-60">empty</span>{% endif %}</div>
              {% endif %}
            </div>
          {% endfor %}
        </div>
  fixtures:
    as_of: '2026-10-06T12:00:00Z'
    tickets:
      - id: '01'
        identifier: BOARD-01
        title: Unassigned backlog
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: null
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '02'
        identifier: BOARD-02
        title: Assigned backlog
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '03'
        identifier: BOARD-03
        title: Ready for conductor
        state: spec
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '04'
        identifier: BOARD-04
        title: Blocked dependency
        state: spec
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '05'
        identifier: BOARD-05
        title: Build the project screen
        state: coding
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '06'
        identifier: BOARD-06
        title: Review the project screen
        state: review
        project_id: '1'
        conductor_id: '1'
        assignee_id: '2'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '07'
        identifier: BOARD-07
        title: Delivered screen
        state: done
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-05T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '08'
        identifier: BOARD-08
        title: Cancelled experiment
        state: cancelled
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-04T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '09'
        identifier: BOARD-09
        title: Older delivery
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-01T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '10'
        identifier: BOARD-10
        title: Missing closing time
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '11'
        identifier: BOARD-11
        title: Blocked without conductor
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '12'
        identifier: BOARD-12
        title: Running despite block
        state: coding
        project_id: '1'
        conductor_id: c-board
        assignee_id: '2'
        has_running_run: true
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '13'
        identifier: BOARD-13
        title: Terminal overrides stale run
        state: done
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: '2026-10-06T10:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '14'
        identifier: BOARD-14
        title: Another project
        state: coding
        project_id: '2'
        conductor_id: '2'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '15'
        identifier: BOARD-15
        title: Seven-day boundary
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-29T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '16'
        identifier: BOARD-16
        title: Outside seven days
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-29T11:59:59Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '17'
        identifier: BOARD-17
        title: Future closing date
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-07T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
    conductors:
      - id: '1'
        project_id: '1'
        label: cw · framework
        status: online
        current_load: 2
        max_parallel: 5
        active_ticket_ids:
          - '05'
          - '06'
      - id: c-board
        project_id: '1'
        label: cw · board
        status: online
        current_load: 1
        max_parallel: null
        active_ticket_ids:
          - '12'
      - id: offline-board
        project_id: '1'
        label: Offline worker
        status: offline
        current_load: 0
        max_parallel: 2
        active_ticket_ids: []
      - id: '2'
        project_id: '2'
        label: Other project
        status: online
        current_load: 1
        max_parallel: 2
        active_ticket_ids:
          - '14'
    expected_default_columns:
      Backlog:
        - '01'
        - '02'
        - '11'
      Intake:
        - '03'
        - '04'
      In Progress:
        - '05'
        - '06'
        - '12'
      Done/Cancelled:
        - '07'
        - '08'
        - '13'
        - '15'
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board/board.component.yml
    component-twig:
      required: true
      schema:
        $ref: '#/definitions/SdcTemplate'
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board/board.twig
    component-story:
      required: true
      schema:
        $ref: '#/definitions/SdcStory'
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board/board.default.story.yml
    component-js:
      required: false
      schema: {}
      submission: data
      validators: []
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components/board/board.js
  ```

  #### Results
  <!-- done -->

### Step: refresh-components
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:component-contract-index, ctx:sdc-components]

- [x] refresh-components — board inventory

  Instruction: task:refresh-components

  #### Params
  ```yaml
  command: pnpm run build && pnpm exec storybook build
  cwd: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme
  index_url: http://localhost:34875/index.json
  story_ids:
    - bakers-theme-action-segmented-control--default
    - bakers-theme-action-segmented-control--filter
    - bakers-theme-data-display-badge--attention
    - bakers-theme-data-display-badge--claim
    - bakers-theme-data-display-badge--claim-mine
    - bakers-theme-data-display-badge--default
    - bakers-theme-data-display-badge--idle
    - bakers-theme-data-display-badge--list-item
    - bakers-theme-data-display-badge--offline
    - bakers-theme-data-display-badge--priority
    - bakers-theme-data-display-badge--refresh
    - bakers-theme-data-display-badge--running
    - bakers-theme-data-display-badge--stale
    - bakers-theme-data-display-badge--wait
    - bakers-theme-data-display-board--default
    - bakers-theme-data-display-board--operational
    - bakers-theme-data-display-board--operational-details
    - bakers-theme-data-display-board--phases
    - bakers-theme-data-display-board-card--blocked
    - bakers-theme-data-display-board-card--cancelled
    - bakers-theme-data-display-board-card--default
    - bakers-theme-data-display-board-card--state-pill
    - bakers-theme-data-display-board-card--unassigned
    - bakers-theme-data-display-list--cards
    - bakers-theme-data-display-list--default
    - bakers-theme-data-display-list--joinable
    - bakers-theme-data-display-list--pattern-identity
    - bakers-theme-data-display-list--pattern-long
    - bakers-theme-data-display-list--pattern-rows
    - bakers-theme-data-display-list--pattern-sparse
    - bakers-theme-data-display-list--plain
    - bakers-theme-data-display-list--rendered
    - bakers-theme-data-display-list--variables
    - bakers-theme-data-display-person--app
    - bakers-theme-data-display-person--compact
    - bakers-theme-data-display-person--default
    - bakers-theme-data-display-person--picture
    - bakers-theme-data-display-person--picture-contain
    - bakers-theme-form-label--default
    - bakers-theme-form-select--default
    - bakers-theme-layout-canvas--default
    - bakers-theme-layout-canvas--with-filters
    - bakers-theme-layout-page-header--default
    - bakers-theme-layout-page-header--with-tabs
    - bakers-theme-layout-zone--columns
    - bakers-theme-layout-zone--default
    - bakers-theme-layout-zone--description-only
    - bakers-theme-layout-zone--row
    - bakers-theme-navigation-tabs--default
  work_order: Run only after both component writes. Start/reuse Storybook via CLI, use status if this planning-time port has expired; do not change fixed story identities. Return successful build and index outputs. Both mapping and scene consume this index. Do not consider HTTP 200 alone proof that the story renders.
  ```

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

### Step: map-entity
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:scenes-constraints, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:local-image-assets, ctx:entity-reference-rendering, ctx:inline-image, ctx:image-fields, ctx:field-cardinality, ctx:views, ctx:ui-patterns, ctx:presenter-template, ctx:pager-2, ctx:layout-builder, ctx:form-display, ctx:field-map, ctx:canvas]

- [x] map-entity--design-screen — project Board page

  Instruction: task:map-entity--design-screen

  #### Params
  ```yaml
  mapping:
    entity_type: view
    bundle: project_board
    mode_kind: view
    view_mode: default
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
            endpoint_url:
              type: url
              title: Endpoint URL
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
  planning_context:
    reference_capture: not_required — user confirms there is no template
    reference_need: null
    scope: |
      ## Proposed specification — Project Board

      Status: proposal; not approved. Scope: Designbook only. Qualification AC01–AC09 remain the acceptance baseline. This proposal does not authorize implementation or a state change.

      ### Target and reuse

      Update `web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml`, scene `project-detail-board`, retaining its identity, shell, project header, active Board tab and sibling scenes. Preserve the existing Overview-to-Board link. Reuse `board`, `board-card`, badges, person, filter controls and list components. The old Intake/Prepare/Work/Accept model is replaced on this screen; unrelated board consumers must retain their existing behavior.

      ### Board rules

      One project-scoped board serves PMs and developers. Use English UI labels: Backlog, Intake, In Progress, Done/Cancelled. Every ticket appears once. Apply classification in this order:

      1. `done` or `cancelled`: Done/Cancelled, regardless of stale conductor/run data.
      2. An active running run: In Progress.
      3. A conductor is assigned, but no running run: Intake.
      4. Otherwise: Backlog; assignee remains optional.

      Blocked tickets without a running run and with a conductor remain in Intake. Blocking alone does not produce an unhealthy/error style. A blocked ticket without a conductor stays in Backlog under the conductor rule. A contradictory blocked-plus-running fixture stays In Progress and retains its Blocked marker; do not hide an actual running run.

      ### Controls and cards

      User means ticket assignee. User and Conductor filters combine with AND and each offers All and Unassigned. Filtering changes cards and visible column counts. Keep empty columns visible with an explanatory empty state.

      Every card shows identifier, title, exact workflow-state badge, assignee when present, and distinct textual Blocked/Cancelled markers when applicable. Reuse existing priority/type/lease presentation where present. Do not encode these distinctions through color alone. Ticket links keep their current target behavior.

      Details only changes In Progress: off shows one column; on groups its cards into subcolumns by exact workflow state. No empty workflow-state subcolumns; retain an In Progress empty state when no runs match. Initial mode is on for developer and off for PM; an explicit current-view choice overrides the default. For a user with both roles, developer wins. No persisted preference or new role infrastructure is in scope; Designbook demonstrates both contexts.

      Done/Cancelled defaults to the last seven days using the closing timestamp, with Today, Last 7 days, Last 30 days and All time choices. Use a fixed fixture clock for deterministic examples. Entries without a closing timestamp appear only under All time, with the absence named; never substitute the last edit timestamp.

      Below the board, show this project's active/running conductors with label, readable status, active-ticket count and reported load/capacity where known. Unknown capacity is shown as unknown, not zero or a fabricated percentage. Ticket filters affect the board; this capacity section continues to describe the project's execution capacity. An empty section says no active conductors.

      ### Presentation and scope

      Use existing semantic/component tokens and layout patterns. Desktop keeps phase comparison visible; narrow screens allow board horizontal scrolling while keeping controls and card text usable. Controls need associated labels, keyboard access and a visible selected state.

      No Drupal routes/config export, backend schema changes, scheduler changes, drag/drop, manual Intake ordering, Overview metrics or new design system are included. Interactive behavior is validated in Storybook where supported; production behavior and production role resolution remain outside this design-only ticket.

      ### Alternatives and risks

      Retaining workflow-phase columns fails the requested operational grouping. Separate PM/developer boards duplicate information; use one board with Details instead. Replacing existing shared components risks older consumers, so extend only where the new display requires it and verify existing variants.

      ### Reference decision

      The user explicitly confirmed: there is no template. Reference capture: `not_required`; ReferenceNeed: none. Use the ticket requirements and retained bakers.build design-system artifacts. The generic Claude Design URL in the project vision is not a Board template and is not a dependency of this work. Do not capture it, request screenshots, or invent a visual comparison score.
    verification_plan: |
      ## Proposed verification plan

      Status: planned, not run for the Board. Functional validation: deterministic Storybook browser checks against AC01–AC09. The user confirmed there is no template: reference-comparison `designbook:design-verify` is not applicable, and no comparison score will be generated. No criterion is currently claimed GREEN.

      ### Functional acceptance and evidence

      | AC | Scenario | Required evidence |
      |---|---|---|
      | AC01 | Open the project's Overview, navigate to Board and return twice | Browser observations retain project context, Board tab and correct screen |
      | AC02 | Load a populated board and an empty board | Screenshots and DOM show Backlog, Intake, In Progress, Done/Cancelled in order |
      | AC03 | Exercise terminal, active-run, conductor-only and no-conductor samples, including contradictory stale data | Deterministic fixture-to-column assertions prove precedence and one placement per ticket |
      | AC04 | Apply each User/Conductor filter, their intersection, Unassigned and reset | Browser/DOM evidence shows matching cards and counts, retained empty columns, no cross-project cards |
      | AC05 | Toggle Details off/on/off with two exact running workflow states | Exact state remains readable on every card; only In Progress splits and merges without losing or duplicating cards |
      | AC06 | Load PM, developer and dual-role contexts, then change Details manually | PM off, developer on, dual-role on; explicit current-view setting honored |
      | AC07 | Show blocked Intake, blocked Backlog, blocked-running and cancelled fixtures | Textual markers distinguish each; blocked alone is not an unhealthy/error indicator |
      | AC08 | Test fixed-clock completion boundaries, old completion, missing date and each period option | Correct membership uses closing time; default Last 7 days; missing date only under All time |
      | AC09 | Show active conductors, known and unknown capacity, and no active conductors | Section below board shows readable status, active-ticket counts and honest load/capacity; ticket filters do not misrepresent project capacity |

      Cover desktop (1440×900) and narrow (390×844), labels, keyboard operation, selected control states, readable card links and horizontal scrolling. These are proposed test viewports, not inferred design-source breakpoints. Retained component variants and sibling project scenes must still render. Capture screenshots as actual output for manual design review; no reference comparison is required. No reference-free diff score may be invented.

      ### Project checks

      For later web UI implementation, run from the repository root:

      - `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build`
      - `bash tests/contract/layout-components.sh`
      - `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs`
      - `cd tests/playwright && npm ci && npx playwright install chromium && npm test` with the recipe-test setup required by WORKFLOW.md.
      - `bash tests/contract/data-display-components.sh` only if component directories are added/removed.

      Separate existing Drupal regression coverage from Storybook acceptance: production backend implementation remains out of scope. Store each executed result with command, observed result and immutable tested commit. No live UI, screenshot, production role behavior or browser result has been verified during this spec run.

      ### Spec preparation evidence

      At repository base `dbc46c2722dd7e278a5784652f6e74b35309186a` with the previously reported local workflow/test edits, `npx --no-install storybook-addon-designbook intake design-screen` and its `--palette` form succeeded. They resolve planning context, not implementation acceptance. The external Claude Design URL was inaccessible through the web tool; no screenshot was captured. The existing reference metadata names only `ticket-list`.

      ### Actors and durable functional coverage

      | Actor | Role | Account | Environment | Status |
      |---|---|---|---|---|
      | Browser visitor | PM presentation (Details off) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Browser visitor | Developer presentation (Details on, including dual-role policy) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Human reviewer | Design review | not_required: static prototype | Worktree Storybook after coding | pending |

      Permanent coverage is planned in `tests/playwright/features/project-board/project-board.feature` and `tests/playwright/steps/project-board.steps.ts`, using the existing BDD suite and explicit Storybook URLs. Start/reuse Storybook through its CLI in the steps if needed so CI can run the coverage. Targeted command from `tests/playwright`: `npm test -- --grep "Project Board"`; the full project suite is a separate regression gate. Fix the sample clock at 2026-10-06T12:00:00Z; Today is the UTC calendar day and rolling 7/30-day windows include both boundaries through that clock. Future closing dates are excluded except under All time.

      Expected default membership: Backlog BOARD-01/02/11; Intake BOARD-03/04; In Progress BOARD-05/06/12; Done/Cancelled BOARD-07/08/13/15. BOARD-14 belongs to another project and never appears. Additional dates cover old completion, missing time, one second before the seven-day threshold and future time. Tests compare membership and counts, not fixture order or style classes.

      Runtime role authorization is outside scope: PM/developer are presentation contexts supplied to the prototype, not new Drupal roles. Product checks use their existing configured actors; no administrator is selected for convenience.
    baseline_commit: dbc46c2722dd7e278a5784652f6e74b35309186a
    execution_mode: persist
    constraints:
      - Designbook artifacts only; no routes, PHP, Drupal config, scheduler, Overview metrics or new component directories.
      - 'Project rules override generic blueprint JS: use installed Alpine and native form controls; no new dependency.'
      - No reference comparison or design-verify score without a visual template. Browser acceptance is the functional gate.
      - Do not execute this saved plan in spec.
  work_order: 'Create designbook/entity-mapping/view.project_board.default.jsonata, a self-contained project-1 preview View mapping, following existing view.tickets.default.jsonata self-contained fixture approach. Output exactly one canvas containing existing project header/tab chrome, operational Board in main, and a supplementary Active conductors zone below it using existing list. Main route bearer is view.project_board page display; active conductor content is a non-routing block inside that page. No second canvas in the scene. Preserve the seven project tab targets from baseline Board scene; title bakers.build Platform and Board tab active. No Drupal config or data-model change: existing preview view mappings are self-contained and not registered in config.view. Freeze preview inputs below as plain display fixtures in this new mapping and new component stories, not edits to global entity sample pools. Resolve each supplied ticket''s phase terminal > active run > assigned conductor > backlog, project-scope before grouping. Components only receive scalar/plain-data props and rendered content in slots. Conductor list scope project 1, online or carrying active tickets; display active-ticket count separately from reported load/max_parallel; unknown capacity is Unknown, never percentage. Ticket filters do not reduce capacity section. Board default is PM details off; developer state is covered by operational_details component story. Project fixture uses existing user 1 CW and user 2 SG; conductor 1 cw · framework and new design-only c-board with unknown capacity. No runtime data access or live API request. Mirror sample values in component stories; use exact record IDs below as verification oracles. Reuse composition components from refreshed index; do not introduce markup in JSONata.'
  fixtures:
    as_of: '2026-10-06T12:00:00Z'
    tickets:
      - id: '01'
        identifier: BOARD-01
        title: Unassigned backlog
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: null
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '02'
        identifier: BOARD-02
        title: Assigned backlog
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '03'
        identifier: BOARD-03
        title: Ready for conductor
        state: spec
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '04'
        identifier: BOARD-04
        title: Blocked dependency
        state: spec
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '05'
        identifier: BOARD-05
        title: Build the project screen
        state: coding
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '06'
        identifier: BOARD-06
        title: Review the project screen
        state: review
        project_id: '1'
        conductor_id: '1'
        assignee_id: '2'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '07'
        identifier: BOARD-07
        title: Delivered screen
        state: done
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-05T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '08'
        identifier: BOARD-08
        title: Cancelled experiment
        state: cancelled
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-04T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '09'
        identifier: BOARD-09
        title: Older delivery
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-01T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '10'
        identifier: BOARD-10
        title: Missing closing time
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '11'
        identifier: BOARD-11
        title: Blocked without conductor
        state: spec
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '12'
        identifier: BOARD-12
        title: Running despite block
        state: coding
        project_id: '1'
        conductor_id: c-board
        assignee_id: '2'
        has_running_run: true
        blocked: true
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '13'
        identifier: BOARD-13
        title: Terminal overrides stale run
        state: done
        project_id: '1'
        conductor_id: '1'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: '2026-10-06T10:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '14'
        identifier: BOARD-14
        title: Another project
        state: coding
        project_id: '2'
        conductor_id: '2'
        assignee_id: '1'
        has_running_run: true
        blocked: false
        closed_date: null
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '15'
        identifier: BOARD-15
        title: Seven-day boundary
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-29T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '16'
        identifier: BOARD-16
        title: Outside seven days
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-09-29T11:59:59Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
      - id: '17'
        identifier: BOARD-17
        title: Future closing date
        state: done
        project_id: '1'
        conductor_id: null
        assignee_id: '1'
        has_running_run: false
        blocked: false
        closed_date: '2026-10-07T12:00:00Z'
        url: /?path=/story/designbook-sections-tickets-scenes--ticket-detail
    conductors:
      - id: '1'
        project_id: '1'
        label: cw · framework
        status: online
        current_load: 2
        max_parallel: 5
        active_ticket_ids:
          - '05'
          - '06'
      - id: c-board
        project_id: '1'
        label: cw · board
        status: online
        current_load: 1
        max_parallel: null
        active_ticket_ids:
          - '12'
      - id: offline-board
        project_id: '1'
        label: Offline worker
        status: offline
        current_load: 0
        max_parallel: 2
        active_ticket_ids: []
      - id: '2'
        project_id: '2'
        label: Other project
        status: online
        current_load: 1
        max_parallel: 2
        active_ticket_ids:
          - '14'
    expected_default_columns:
      Backlog:
        - '01'
        - '02'
        - '11'
      Intake:
        - '03'
        - '04'
      In Progress:
        - '05'
        - '06'
        - '12'
      Done/Cancelled:
        - '07'
        - '08'
        - '13'
        - '15'
  predecessor_inputs:
    component_index:
      step: refresh-components
      task_title: board inventory
      output: index
      required_story_ids:
        - bakers-theme-action-segmented-control--default
        - bakers-theme-action-segmented-control--filter
        - bakers-theme-data-display-badge--attention
        - bakers-theme-data-display-badge--claim
        - bakers-theme-data-display-badge--claim-mine
        - bakers-theme-data-display-badge--default
        - bakers-theme-data-display-badge--idle
        - bakers-theme-data-display-badge--list-item
        - bakers-theme-data-display-badge--offline
        - bakers-theme-data-display-badge--priority
        - bakers-theme-data-display-badge--refresh
        - bakers-theme-data-display-badge--running
        - bakers-theme-data-display-badge--stale
        - bakers-theme-data-display-badge--wait
        - bakers-theme-data-display-board--default
        - bakers-theme-data-display-board--operational
        - bakers-theme-data-display-board--operational-details
        - bakers-theme-data-display-board--phases
        - bakers-theme-data-display-board-card--blocked
        - bakers-theme-data-display-board-card--cancelled
        - bakers-theme-data-display-board-card--default
        - bakers-theme-data-display-board-card--state-pill
        - bakers-theme-data-display-board-card--unassigned
        - bakers-theme-data-display-list--cards
        - bakers-theme-data-display-list--default
        - bakers-theme-data-display-list--joinable
        - bakers-theme-data-display-list--pattern-identity
        - bakers-theme-data-display-list--pattern-long
        - bakers-theme-data-display-list--pattern-rows
        - bakers-theme-data-display-list--pattern-sparse
        - bakers-theme-data-display-list--plain
        - bakers-theme-data-display-list--rendered
        - bakers-theme-data-display-list--variables
        - bakers-theme-data-display-person--app
        - bakers-theme-data-display-person--compact
        - bakers-theme-data-display-person--default
        - bakers-theme-data-display-person--picture
        - bakers-theme-data-display-person--picture-contain
        - bakers-theme-form-label--default
        - bakers-theme-form-select--default
        - bakers-theme-layout-canvas--default
        - bakers-theme-layout-canvas--with-filters
        - bakers-theme-layout-page-header--default
        - bakers-theme-layout-page-header--with-tabs
        - bakers-theme-layout-zone--columns
        - bakers-theme-layout-zone--default
        - bakers-theme-layout-zone--description-only
        - bakers-theme-layout-zone--row
        - bakers-theme-navigation-tabs--default
  baseline:
    web/themes/custom/bb_theme/designbook/entity-mapping/view.tickets.default.jsonata:
      sha256: 65907653d10d577891a96732af77e43eecc88abc7eb04e7b90c0e0486cfe33f9
      content: |
        (
          /* THE TICKETS LISTING, AS A VIEW THAT RENDERS ONE LIST ROW PER TICKET (BB-592). A ticket is read as
             one thing with a few facts, not compared down columns. The mapping emits ONE `list` node whose
             `pattern` is the `bb_list` Views style's own pattern for `views.view.tickets`: avatar: the state
             as a `status` glyph (filled disc while coding, empty ring otherwise; its exact label is the
             tooltip and accessible name); headline: title and priority (when set); meta: identifier,
             "Created … ago", "by" the owner (the creator), the conductor lease (when present), the run
             count when at least one; right: the assignee as a circle alone (`name_hidden`), whose name is the
             tooltip, and which NAMES "Unassigned" (a "?" mark) rather than dashing it. Project and team are
             dropped: the listing already sits in a project or workspace context. A view address takes no
             record, so the rows are written out here and mirror the ticket sample data by hand; the relative
             times are pinned sample values. Sorting is the exposed "Sort by" select above the list. */
          $accent := function ($t) {
            $t.state = "review" ? "attention"
              : $exists($t.conductor_id) ? "running"
              : "idle"
          };
          $people := {
            "1": { "name": "Christian Wiedemann", "initials": "CW", "color": "unassigned" },
            "2": { "name": "Sven Gruber", "initials": "SG", "color": "running" },
            "3": { "name": "Marieke van Dijk", "initials": "MD", "color": "lease" },
            "4": { "name": "bakers.build agent", "initials": "GA", "color": "running" }
          };
          $conductor_names := { "1": "cw-framework", "2": "mvd-thinkpad" };
          $rows := [
            { "id": "1", "identifier": "BB-142", "title": "Add designbook entity view-mode for bb_ticket", "state": "coding", "priority": 2, "owner_user_id": "1", "assignee_user_id": "1", "conductor_id": "1", "created": "3 days ago", "runs": 3 },
            { "id": "4", "identifier": "BB-118", "title": "Draft ticket_detail component spec", "state": "spec", "priority": 2, "owner_user_id": "1", "assignee_user_id": "2", "created": "3 weeks ago" },
            { "id": "5", "identifier": "BB-105", "title": "Review comment-event rendering for typed comments", "state": "review", "priority": 2, "owner_user_id": "2", "assignee_user_id": "1", "created": "1 week ago" },
            { "id": "7", "identifier": "BB-145", "title": "Comment feed region in ticket_detail", "state": "coding", "priority": 2, "owner_user_id": "1", "assignee_user_id": "1", "created": "2 days ago" },
            { "id": "8", "identifier": "BB-146", "title": "Runs, sub-tickets and footprint sections", "state": "review", "priority": 3, "owner_user_id": "4", "assignee_user_id": "2", "created": "4 days ago", "runs": 2 },
            { "id": "9", "identifier": "NWS-80", "title": "Checkout address step rewrite", "state": "coding", "priority": 1, "owner_user_id": "3", "assignee_user_id": "3", "conductor_id": "2", "created": "5 hours ago", "runs": 1 },
            { "id": "10", "identifier": "NWS-81", "title": "Cart total ignores per-item discounts", "state": "review", "priority": 1, "owner_user_id": "3", "created": "6 days ago" },
            { "id": "11", "identifier": "NWS-82", "title": "Move the staging deploy onto the shared runner", "state": "qualification", "priority": 3, "owner_user_id": "3", "assignee_user_id": "3", "created": "1 week ago" }
          ];
          [
            {
              "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:list",
              "props": {
                "layout": "lines",
                "pattern": {
                  "avatar": ["state"],
                  "headline": ["title", "priority"],
                  "meta": ["identifier", "created", "owner", "conductor", "run_count"],
                  "right": ["assignee"],
                  "captions": { "created": "Created", "owner": "by" }
                },
                "items": [$map($rows, function ($t) {
                  (
                    $who := $lookup($people, $t.assignee_user_id);
                    $owner := $lookup($people, $t.owner_user_id);
                    $prio := $t.priority ? ($t.priority > 5 ? "p5" : "p" & $string($t.priority)) : undefined;
                    $conductor := $lookup($conductor_names, $t.conductor_id);
                    {
                      "url": "/admin/bakers/ticket/" & $t.id,
                      "accent": $accent($t),
                      "cells": $merge([
                        {
                          "state": { "kind": "status", "label": $t.state, "working": $t.state = "coding" },
                          "title": { "kind": "text", "value": $t.title, "emphasis": "strong" },
                          "identifier": { "kind": "mono", "value": $t.identifier },
                          /* `rendered`, as the Drupal path delivers it (Views output), so the value runs on
                             inline after its caption; a `text` cell is a block and would break the line. */
                          "created": { "kind": "rendered", "markup": $t.created },
                          "assignee": $who ? { "kind": "person", "display_name": $who.name, "initials": $who.initials, "color": $who.color, "name_hidden": true }
                            : { "kind": "person", "display_name": "Unassigned", "initials": "?", "color": "offline", "name_hidden": true }
                        },
                        /* Optional facts are OMITTED when absent, so they leave no gap. */
                        $owner ? { "owner": { "kind": "person", "display_name": $owner.name, "initials": $owner.initials, "color": $owner.color } } : {},
                        $prio ? { "priority": { "kind": "badge", "label": $uppercase($prio), "tone": $prio = "p1" ? "critical" : "neutral" } } : {},
                        $conductor ? { "conductor": { "kind": "badge", "label": $conductor, "tone": "lease", "mono": true, "mine": $t.conductor_id = "1", "icon": "lock" } } : {},
                        $t.runs ? { "run_count": { "kind": "badge", "label": $string($t.runs), "icon": "run", "tone": "neutral" } } : {}
                      ])
                    }
                  )
                })]
              }
            }
          ]
        )
    web/themes/custom/bb_theme/designbook/entity-mapping/view.conductors.default.jsonata:
      sha256: 86c85878a3206a42ce864e20e6b063d55c1cb52e98980f9fc8915f19041b7bd1
      content: |
        (
          /* THE CONDUCTORS LISTING. One list row per conductor in the URL workspace.
             Pattern matches views.view.conductors: headline linked label (registration
             fallback), meta status and reported load. Rows below mirror
             designbook/data/bb_conductor.bb_conductor.yml, workspace 1. */
          $rows := [
            { "id": "1", "label": "cw · framework", "status": "online", "reported_load": 1, "conductor_id": "cw-framework" },
            { "id": "2", "label": "mvd · shop", "status": "offline", "reported_load": 0, "conductor_id": "mvd-shop" }
          ];
          [
            {
              "component": "$DESIGNBOOK_COMPONENT_NAMESPACE:list",
              "props": {
                "layout": "lines",
                "pattern": {
                  "headline": ["label"],
                  "meta": ["status", "reported_load"],
                  "captions": { "reported_load": "Reported load" }
                },
                "items": [$map($rows, function ($c) {
                  {
                    "url": "/bakers/conductor/" & $c.id,
                    "cells": {
                      "label": { "kind": "link", "value": $c.label, "url": "/bakers/conductor/" & $c.id },
                      "status": { "kind": "text", "value": $c.status },
                      "reported_load": { "kind": "text", "value": $string($c.reported_load) }
                    }
                  }
                })]
              }
            }
          ]
        )
  project_header_baseline:
    name: project-detail-board
    group: Screens
    section: projects
    docs: Board tab only — phase board for this project (BB-334). Not the default detail place; Overview is.
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
                      description: Board · four phases · this project only
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
                  - component: bb_theme:zone
                    slots:
                      content:
                        component: bb_theme:board
                        props:
                          columns:
                            - name: Intake
                              count: 0
                            - name: Prepare
                              count: 1
                              dot: running
                              cards:
                                - identifier: BB-412
                                  title: Design the ticket list screen
                                  status: idle
                                  priority: p2
                                  type: bb_feature
                                  state: spec
                                  assignee_initials: CW
                                  assignee_color: running
                            - name: Work
                              count: 1
                              dot: running
                              cards:
                                - identifier: BB-401
                                  title: Design the Board screen
                                  status: running
                                  priority: p2
                                  type: bb_feature
                                  state: coding
                                  lease: srv02
                                  assignee_initials: CW
                                  assignee_color: running
                            - name: Accept
                              count: 1
                              cards:
                                - identifier: BB-388
                                  title: Agree the add and edit action pattern
                                  status: needs_input
                                  priority: p2
                                  type: bb_feature
                                  state: review
                                  assignee_initials: MR
                                  assignee_color: lease
                        slots:
                          empty:
                            component: bb_theme:empty-state
                            props:
                              message: nothing waiting
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/designbook/entity-mapping/view.project_board.default.jsonata
  ```

  #### Results
  <!-- done -->

### Step: write-scene
Context: [ctx:cli-surface, ctx:sample-template-mapping, ctx:presenter-template-2, ctx:variant-transport, ctx:typed-component-boundary, ctx:story-image-node-renderer, ctx:shell-scene-constraints, ctx:screen-scene-constraints, ctx:scenes-constraints, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:markup-derivation, ctx:local-image-assets, ctx:icon-sprite, ctx:entity-reference-rendering, ctx:component-contract-index, ctx:token-backed-utilities, ctx:scenes-constraints-2, ctx:font-availability, ctx:component-styling, ctx:component-source, ctx:navigation, ctx:scenes-constraints-3, ctx:presenter-template-surfaces, ctx:media-image-styles, ctx:form-modes, ctx:field-type-constraints, ctx:drupal-views, ctx:drupal-config, ctx:block-decision, ctx:slot-rendering, ctx:layout-constraints, ctx:js-behavior, ctx:image_style, ctx:static-assets, ctx:view, ctx:taxonomy_term, ctx:node, ctx:media, ctx:field-types, ctx:block_plugin, ctx:section, ctx:pager, ctx:page, ctx:navigation-2, ctx:logo, ctx:link, ctx:js-behavior-2, ctx:icon, ctx:header, ctx:grid, ctx:form, ctx:footer, ctx:container, ctx:button]

- [x] write-scene — project-detail-board

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/projects/projects.section.scenes.yml
  scene_name: project-detail-board
  scene_scope: screen
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/components
  components:
    - id: bb_theme:badge
    - id: bb_theme:board
    - id: bb_theme:board-card
    - id: bb_theme:button
    - id: bb_theme:canvas
    - id: bb_theme:dialog
    - id: bb_theme:empty-state
    - id: bb_theme:form
    - id: bb_theme:form_input
    - id: bb_theme:form_label
    - id: bb_theme:form_select
    - id: bb_theme:form_textarea
    - id: bb_theme:icon
    - id: bb_theme:list
    - id: bb_theme:option_list
    - id: bb_theme:option_picker
    - id: bb_theme:page_header
    - id: bb_theme:property_pill
    - id: bb_theme:segmented_control
    - id: bb_theme:stat-tile
    - id: bb_theme:table
    - id: bb_theme:tabs
    - id: bb_theme:zone
  section_scenes:
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
      - `conductor-detail-overview` — one conductor's Overview: status, last seen, project, reported
        load, live occupancy. One tab. Sample id 1 is busy; id 2 is idle.
      - `project-detail` — entity chrome = header + **tabs** (IA D12). **No project-edit route.**
        Tab set (BB-454, seven tabs — `Delivery` retired in favour of the broader `Stats`, `Tickets`
        joins as its own tab which BB-428 had already delivered without this scene reflecting it):
        1. **Overview** (default) — project detail: name/meta **inline edit**, teams, short pulse
        2. **Board** — phase board only (BB-334); not the whole detail place
        3. **Stats** — closed-work delivery lookback (Week|Month) **and** crew load, one tab
        4. **Tickets** — this project's tickets (native Views listing; no Designbook body of its own)
        5. **Runs** — this project's runs (native Views listing since BB-454; a follow-up may still
           design its body)
        6. **Members** — the project's people: one `list`, and the add form that writes them
        7. **Settings** — Environments, with its add
        Scenes: `project-detail-overview`, `project-detail-board`, `project-detail-stats`,
        `project-detail-runs`, `project-detail-members`, `project-detail-settings`
        (+ `project-detail-overview-teams-open`). `Tickets` reuses the `tickets` section's own
        `ticket-list` scene rather than a new one — the tab is reachable and correctly named, and the
        listing itself is not a second Designbook artifact.

        **Members IS ITS OWN FACE, and Settings no longer carries it** (BB-435). It was item 5 of this
        set as one of "two blocks on one tab" beside Environments, which filed the same object under
        infrastructure here and under people on the team screen — the team detail has had a Members face
        since BB-419. One object cannot be two kinds of thing depending on which screen is open, so the
        block moved out and Settings kept Environments alone.

      **Board model (from former board section / BB-334)** — recorded here so the phase model is not
      lost when the standalone `board` section was removed: phases not workflow states; workflow is a
      filter; cancelled/done never a column; unmapped active state appends a column labelled with the
      state id; components `board` / `board-card` — a column is DATA on `board`, not a component of its
      own, because a container owns what is inside it; stories stay under components/.

      **Action surface:** `project-create` (dialog over the list). Team assignment is edited on
      **Overview**, not via a list inline-edit scene.

      **Groups is its own screen**, opened by the Groups rail entry. Create from that screen's `[+]`.
      A group still has no entity-detail page.

      **Layout.** Every scene here inherits the one shell (`scene: "design-system:shell"`) and fills its
      `content` with exactly one `canvas`; headings, regions and spacing follow
      `designbook/design-system/layout.md`, which is the rule document for the layout layer.
    status: in-progress
    order: 2
    user_flows: |
      - Open Projects; open a row → project **Overview** (default).
      - Rename / edit reversible fields inline on Overview — **no** project-edit page.
      - **Board** tab for the phase board only; **Stats** for statistics, **Tickets** / **Runs** for
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
      CSS class. `project-detail-overview-teams-open` shows teams picker open on Overview. What changed
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
          THE SCREEN OWNS THE CHROME, exactly as `team-detail-overview` does: `page_header` carries the group's name and two tabs — Overview · Settings — with `Overview` active here. The tabs are a screen-level fact no single-record mapping can know.
          THE BODY IS THE ENTITY'S OWN VIEW MODE: `canvas.main` places one `bb_group.bb_group` `full` entity node, selected on this group's id. It shows the Owner (a `user.user` `compact` person) and the Workspace, and nothing else — no project list, no billing profile.
          SETTINGS IS THE LEAD-ONLY NAME FORM. It is gated on `update` access, so a member who may only view the group sees Overview alone. The form face has no scene of its own; its tab here links back to the Groups listing. Storybook cannot render an island, so the tabs are plain links and `active` is a prop.
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
                          tabs:
                            component: bb_theme:tabs
                            props:
                              label: Group sections
                              items:
                                - label: Overview
                                  url: /?path=/story/designbook-sections-projects-scenes--group-detail-overview
                                  active: true
                                - label: Settings
                                  url: /?path=/story/designbook-sections-projects-scenes--groups
                                  active: false
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
          THE BODY IS THE ENTITY'S OWN VIEW MODE: `canvas.main` places one `bb_conductor.bb_conductor` `full` entity node, selected on this conductor's id. Sample id 1 is the busy record (live occupancy 1); occupancy rows are preview-pinned because a mapping cannot run the claim-seam query.
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
        docs: 'THE IDLE CONDUCTOR Overview. Same chrome as `conductor-detail-overview`, selected on sample id 2: reported load 0 and live occupancy 0, which the mapping pins as "No running tickets."'
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
          THE SCREEN OWNS THE CHROME: `page_header` carries the machine name and two tabs — View and Edit — with `View` active.
          THE BODY IS THE ENTITY'S OWN VIEW MODE: `canvas.main` places one `bb_machine.bb_machine` `full` entity node.
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
                                - label: Edit
                                  url: /?path=/story/designbook-sections-projects-scenes--machine-detail-overview
                                  active: false
                    main:
                      - entity: bb_machine.bb_machine
                        view_mode: full
                        select: $[id='1']
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
                                icon: more-horizontal
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
        docs: 'PROJECT DETAIL default: Overview. The detail place itself — not the board. Name and reversible fields edit inline (no project-edit route). Teams assignment lives here. Board / Stats / Tickets / Runs / Members / Settings are sibling tabs.'
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
                          description: key bakers.build · group keytec · inline edit — no edit route
                        slots:
                          heading:
                            component: bb_theme:form_input
                            props:
                              type: text
                              name: name
                              id: project-detail-name
                              value: bakers.build Platform
                          actions:
                            component: bb_theme:option_picker
                            props:
                              variant: inline
                              label: Teams
                              name: teams
                              id: project-detail-teams
                              multiple: true
                              open: false
                              aria_label: Change teams. Currently Platform crew and Design crew.
                              value_labels:
                                - Platform crew
                                - Design crew
                              values:
                                - '1'
                                - '3'
                            slots:
                              options:
                                component: bb_theme:option_list
                                props:
                                  multiple: true
                                  options:
                                    - value: '1'
                                      label: Platform crew
                                      selected: true
                                    - value: '3'
                                      label: Design crew
                                      selected: true
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
                      - component: bb_theme:zone
                        props:
                          direction: row
                          gap: sm
                        slots:
                          content:
                            - component: bb_theme:badge
                              props:
                                label: bakers.build
                                tone: neutral
                            - component: bb_theme:badge
                              props:
                                label: keytec
                                tone: neutral
                            - component: bb_theme:badge
                              props:
                                label: keytec_gitlab:bakers/bakers
                                tone: neutral
                      - component: bb_theme:zone
                        props:
                          columns: 3
                          gap: md
                          description: This week — full figures on Stats and Runs
                        slots:
                          heading: Pulse
                          content:
                            - component: bb_theme:stat-tile
                              props:
                                value: '7'
                                label: open tickets
                                window: now
                            - component: bb_theme:stat-tile
                              props:
                                value: '12'
                                label: closed this week
                                window: this week
                            - component: bb_theme:stat-tile
                              props:
                                value: '2'
                                label: active runs
                                window: now
                      - component: bb_theme:zone
                        props:
                          description: Branch base for tickets in this project
                        slots:
                          heading: Repository
                          content:
                            component: bb_theme:form_textarea
                            props:
                              name: repository
                              id: project-detail-repo
                              value: https://gitlab.example.com/bakers/bakers
      - name: project-detail-overview-teams-open
        group: Actions
        section: projects
        docs: Overview with Teams assignment open. Open pickers must live on the detail place, never on the projects list.
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
                          description: key bakers.build · group keytec · teams picker open
                        slots:
                          heading:
                            component: bb_theme:form_input
                            props:
                              type: text
                              name: name
                              id: project-detail-name-teams-open
                              value: bakers.build Platform
                          actions:
                            component: bb_theme:option_picker
                            props:
                              variant: inline
                              label: Teams
                              name: teams
                              id: project-detail-teams-open
                              multiple: true
                              open: true
                              aria_label: Change teams. Currently Platform crew and Design crew.
                              value_labels:
                                - Platform crew
                                - Design crew
                              values:
                                - '1'
                                - '3'
                            slots:
                              options:
                                component: bb_theme:option_list
                                props:
                                  multiple: true
                                  options:
                                    - value: '1'
                                      label: Platform crew
                                      selected: true
                                    - value: '3'
                                      label: Design crew
                                      selected: true
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
                      - component: bb_theme:zone
                        props:
                          direction: row
                          gap: sm
                        slots:
                          content:
                            - component: bb_theme:badge
                              props:
                                label: bakers.build
                                tone: neutral
                            - component: bb_theme:badge
                              props:
                                label: keytec
                                tone: neutral
      - name: project-detail-board
        group: Screens
        section: projects
        docs: Board tab only — phase board for this project (BB-334). Not the default detail place; Overview is.
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
                          description: Board · four phases · this project only
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
                      - component: bb_theme:zone
                        slots:
                          content:
                            component: bb_theme:board
                            props:
                              columns:
                                - name: Intake
                                  count: 0
                                - name: Prepare
                                  count: 1
                                  dot: running
                                  cards:
                                    - identifier: BB-412
                                      title: Design the ticket list screen
                                      status: idle
                                      priority: p2
                                      type: bb_feature
                                      state: spec
                                      assignee_initials: CW
                                      assignee_color: running
                                - name: Work
                                  count: 1
                                  dot: running
                                  cards:
                                    - identifier: BB-401
                                      title: Design the Board screen
                                      status: running
                                      priority: p2
                                      type: bb_feature
                                      state: coding
                                      lease: srv02
                                      assignee_initials: CW
                                      assignee_color: running
                                - name: Accept
                                  count: 1
                                  cards:
                                    - identifier: BB-388
                                      title: Agree the add and edit action pattern
                                      status: needs_input
                                      priority: p2
                                      type: bb_feature
                                      state: review
                                      assignee_initials: MR
                                      assignee_color: lease
                            slots:
                              empty:
                                component: bb_theme:empty-state
                                props:
                                  message: nothing waiting
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
          THE ROSTER IS A `list`, NOT A TABLE, which is the settings section's rule reaching this screen: no columns and no header row, `layout: cards`, because a membership is a person read one at a time and not a row of comparable figures. Putting the values in cells aligned to a grid would promise a comparison the data does not support.
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
            endpoint_url:
              type: url
              title: Endpoint URL
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
  planning_context:
    reference_capture: not_required — user confirms there is no template
    reference_need: null
    scope: |
      ## Proposed specification — Project Board

      Status: proposal; not approved. Scope: Designbook only. Qualification AC01–AC09 remain the acceptance baseline. This proposal does not authorize implementation or a state change.

      ### Target and reuse

      Update `web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml`, scene `project-detail-board`, retaining its identity, shell, project header, active Board tab and sibling scenes. Preserve the existing Overview-to-Board link. Reuse `board`, `board-card`, badges, person, filter controls and list components. The old Intake/Prepare/Work/Accept model is replaced on this screen; unrelated board consumers must retain their existing behavior.

      ### Board rules

      One project-scoped board serves PMs and developers. Use English UI labels: Backlog, Intake, In Progress, Done/Cancelled. Every ticket appears once. Apply classification in this order:

      1. `done` or `cancelled`: Done/Cancelled, regardless of stale conductor/run data.
      2. An active running run: In Progress.
      3. A conductor is assigned, but no running run: Intake.
      4. Otherwise: Backlog; assignee remains optional.

      Blocked tickets without a running run and with a conductor remain in Intake. Blocking alone does not produce an unhealthy/error style. A blocked ticket without a conductor stays in Backlog under the conductor rule. A contradictory blocked-plus-running fixture stays In Progress and retains its Blocked marker; do not hide an actual running run.

      ### Controls and cards

      User means ticket assignee. User and Conductor filters combine with AND and each offers All and Unassigned. Filtering changes cards and visible column counts. Keep empty columns visible with an explanatory empty state.

      Every card shows identifier, title, exact workflow-state badge, assignee when present, and distinct textual Blocked/Cancelled markers when applicable. Reuse existing priority/type/lease presentation where present. Do not encode these distinctions through color alone. Ticket links keep their current target behavior.

      Details only changes In Progress: off shows one column; on groups its cards into subcolumns by exact workflow state. No empty workflow-state subcolumns; retain an In Progress empty state when no runs match. Initial mode is on for developer and off for PM; an explicit current-view choice overrides the default. For a user with both roles, developer wins. No persisted preference or new role infrastructure is in scope; Designbook demonstrates both contexts.

      Done/Cancelled defaults to the last seven days using the closing timestamp, with Today, Last 7 days, Last 30 days and All time choices. Use a fixed fixture clock for deterministic examples. Entries without a closing timestamp appear only under All time, with the absence named; never substitute the last edit timestamp.

      Below the board, show this project's active/running conductors with label, readable status, active-ticket count and reported load/capacity where known. Unknown capacity is shown as unknown, not zero or a fabricated percentage. Ticket filters affect the board; this capacity section continues to describe the project's execution capacity. An empty section says no active conductors.

      ### Presentation and scope

      Use existing semantic/component tokens and layout patterns. Desktop keeps phase comparison visible; narrow screens allow board horizontal scrolling while keeping controls and card text usable. Controls need associated labels, keyboard access and a visible selected state.

      No Drupal routes/config export, backend schema changes, scheduler changes, drag/drop, manual Intake ordering, Overview metrics or new design system are included. Interactive behavior is validated in Storybook where supported; production behavior and production role resolution remain outside this design-only ticket.

      ### Alternatives and risks

      Retaining workflow-phase columns fails the requested operational grouping. Separate PM/developer boards duplicate information; use one board with Details instead. Replacing existing shared components risks older consumers, so extend only where the new display requires it and verify existing variants.

      ### Reference decision

      The user explicitly confirmed: there is no template. Reference capture: `not_required`; ReferenceNeed: none. Use the ticket requirements and retained bakers.build design-system artifacts. The generic Claude Design URL in the project vision is not a Board template and is not a dependency of this work. Do not capture it, request screenshots, or invent a visual comparison score.
    verification_plan: |
      ## Proposed verification plan

      Status: planned, not run for the Board. Functional validation: deterministic Storybook browser checks against AC01–AC09. The user confirmed there is no template: reference-comparison `designbook:design-verify` is not applicable, and no comparison score will be generated. No criterion is currently claimed GREEN.

      ### Functional acceptance and evidence

      | AC | Scenario | Required evidence |
      |---|---|---|
      | AC01 | Open the project's Overview, navigate to Board and return twice | Browser observations retain project context, Board tab and correct screen |
      | AC02 | Load a populated board and an empty board | Screenshots and DOM show Backlog, Intake, In Progress, Done/Cancelled in order |
      | AC03 | Exercise terminal, active-run, conductor-only and no-conductor samples, including contradictory stale data | Deterministic fixture-to-column assertions prove precedence and one placement per ticket |
      | AC04 | Apply each User/Conductor filter, their intersection, Unassigned and reset | Browser/DOM evidence shows matching cards and counts, retained empty columns, no cross-project cards |
      | AC05 | Toggle Details off/on/off with two exact running workflow states | Exact state remains readable on every card; only In Progress splits and merges without losing or duplicating cards |
      | AC06 | Load PM, developer and dual-role contexts, then change Details manually | PM off, developer on, dual-role on; explicit current-view setting honored |
      | AC07 | Show blocked Intake, blocked Backlog, blocked-running and cancelled fixtures | Textual markers distinguish each; blocked alone is not an unhealthy/error indicator |
      | AC08 | Test fixed-clock completion boundaries, old completion, missing date and each period option | Correct membership uses closing time; default Last 7 days; missing date only under All time |
      | AC09 | Show active conductors, known and unknown capacity, and no active conductors | Section below board shows readable status, active-ticket counts and honest load/capacity; ticket filters do not misrepresent project capacity |

      Cover desktop (1440×900) and narrow (390×844), labels, keyboard operation, selected control states, readable card links and horizontal scrolling. These are proposed test viewports, not inferred design-source breakpoints. Retained component variants and sibling project scenes must still render. Capture screenshots as actual output for manual design review; no reference comparison is required. No reference-free diff score may be invented.

      ### Project checks

      For later web UI implementation, run from the repository root:

      - `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build`
      - `bash tests/contract/layout-components.sh`
      - `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs`
      - `cd tests/playwright && npm ci && npx playwright install chromium && npm test` with the recipe-test setup required by WORKFLOW.md.
      - `bash tests/contract/data-display-components.sh` only if component directories are added/removed.

      Separate existing Drupal regression coverage from Storybook acceptance: production backend implementation remains out of scope. Store each executed result with command, observed result and immutable tested commit. No live UI, screenshot, production role behavior or browser result has been verified during this spec run.

      ### Spec preparation evidence

      At repository base `dbc46c2722dd7e278a5784652f6e74b35309186a` with the previously reported local workflow/test edits, `npx --no-install storybook-addon-designbook intake design-screen` and its `--palette` form succeeded. They resolve planning context, not implementation acceptance. The external Claude Design URL was inaccessible through the web tool; no screenshot was captured. The existing reference metadata names only `ticket-list`.

      ### Actors and durable functional coverage

      | Actor | Role | Account | Environment | Status |
      |---|---|---|---|---|
      | Browser visitor | PM presentation (Details off) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Browser visitor | Developer presentation (Details on, including dual-role policy) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Human reviewer | Design review | not_required: static prototype | Worktree Storybook after coding | pending |

      Permanent coverage is planned in `tests/playwright/features/project-board/project-board.feature` and `tests/playwright/steps/project-board.steps.ts`, using the existing BDD suite and explicit Storybook URLs. Start/reuse Storybook through its CLI in the steps if needed so CI can run the coverage. Targeted command from `tests/playwright`: `npm test -- --grep "Project Board"`; the full project suite is a separate regression gate. Fix the sample clock at 2026-10-06T12:00:00Z; Today is the UTC calendar day and rolling 7/30-day windows include both boundaries through that clock. Future closing dates are excluded except under All time.

      Expected default membership: Backlog BOARD-01/02/11; Intake BOARD-03/04; In Progress BOARD-05/06/12; Done/Cancelled BOARD-07/08/13/15. BOARD-14 belongs to another project and never appears. Additional dates cover old completion, missing time, one second before the seven-day threshold and future time. Tests compare membership and counts, not fixture order or style classes.

      Runtime role authorization is outside scope: PM/developer are presentation contexts supplied to the prototype, not new Drupal roles. Product checks use their existing configured actors; no administrator is selected for convenience.
    baseline_commit: dbc46c2722dd7e278a5784652f6e74b35309186a
    execution_mode: persist
    constraints:
      - Designbook artifacts only; no routes, PHP, Drupal config, scheduler, Overview metrics or new component directories.
      - 'Project rules override generic blueprint JS: use installed Alpine and native form controls; no new dependency.'
      - No reference comparison or design-verify score without a visual template. Browser acceptance is the functional gate.
      - Do not execute this saved plan in spec.
  work_order: Replace only project-detail-board at its existing position. Its items retain design-system:shell inheritance and empty overlay, with content = one entity view.project_board, view_mode default, no record/select and no component wrapper. The mapping owns the canvas and all page content; exactly one View page is the route bearer. Preserve every sibling scene semantically, order, id, group, title and unrelated metadata. Update only the Board-specific older phase-model paragraphs and UI requirements to the new spec; retain historical descriptions only where clearly describing the legacy phases component story. Overview already links to this exact Board scene; no Overview edit. Use inputs from refreshed component index and the preceding new mapping. Final completion requires build, fixed-story checks, semantic preservation check against section_scenes baseline and browser observations below; do not mark a task done just because YAML validates. Entire workflow remains pending in spec. Preserve the project-create sibling behavior; normalize its existing single-object shell overlay to a one-element array, required by the current SceneSlot schema. This is the sole structural sibling change, with identical rendered content.
  predecessor_inputs:
    component_index:
      step: refresh-components
      task_title: board inventory
      output: index
      required_story_ids:
        - bakers-theme-action-segmented-control--default
        - bakers-theme-action-segmented-control--filter
        - bakers-theme-data-display-badge--attention
        - bakers-theme-data-display-badge--claim
        - bakers-theme-data-display-badge--claim-mine
        - bakers-theme-data-display-badge--default
        - bakers-theme-data-display-badge--idle
        - bakers-theme-data-display-badge--list-item
        - bakers-theme-data-display-badge--offline
        - bakers-theme-data-display-badge--priority
        - bakers-theme-data-display-badge--refresh
        - bakers-theme-data-display-badge--running
        - bakers-theme-data-display-badge--stale
        - bakers-theme-data-display-badge--wait
        - bakers-theme-data-display-board--default
        - bakers-theme-data-display-board--operational
        - bakers-theme-data-display-board--operational-details
        - bakers-theme-data-display-board--phases
        - bakers-theme-data-display-board-card--blocked
        - bakers-theme-data-display-board-card--cancelled
        - bakers-theme-data-display-board-card--default
        - bakers-theme-data-display-board-card--state-pill
        - bakers-theme-data-display-board-card--unassigned
        - bakers-theme-data-display-list--cards
        - bakers-theme-data-display-list--default
        - bakers-theme-data-display-list--joinable
        - bakers-theme-data-display-list--pattern-identity
        - bakers-theme-data-display-list--pattern-long
        - bakers-theme-data-display-list--pattern-rows
        - bakers-theme-data-display-list--pattern-sparse
        - bakers-theme-data-display-list--plain
        - bakers-theme-data-display-list--rendered
        - bakers-theme-data-display-list--variables
        - bakers-theme-data-display-person--app
        - bakers-theme-data-display-person--compact
        - bakers-theme-data-display-person--default
        - bakers-theme-data-display-person--picture
        - bakers-theme-data-display-person--picture-contain
        - bakers-theme-form-label--default
        - bakers-theme-form-select--default
        - bakers-theme-layout-canvas--default
        - bakers-theme-layout-canvas--with-filters
        - bakers-theme-layout-page-header--default
        - bakers-theme-layout-page-header--with-tabs
        - bakers-theme-layout-zone--columns
        - bakers-theme-layout-zone--default
        - bakers-theme-layout-zone--description-only
        - bakers-theme-layout-zone--row
        - bakers-theme-navigation-tabs--default
    page_mapping:
      step: map-entity
      task_title: project Board page
      output: entity-mapping
  final_verification:
    commands:
      - pnpm run build && pnpm exec storybook build
      - npx storybook-addon-designbook storybook check "http://localhost:34875/iframe.html?id=designbook-sections-projects-scenes--project-detail-board&viewMode=story"
    story_urls:
      - http://localhost:34875/iframe.html?id=designbook-sections-projects-scenes--project-detail-board&viewMode=story
      - http://localhost:34875/iframe.html?id=designbook-sections-projects-scenes--project-detail-overview&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board--operational&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board--operational-details&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board-card--blocked&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board-card--cancelled&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board--default&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board--phases&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board-card--default&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board-card--state-pill&viewMode=story
      - http://localhost:34875/iframe.html?id=bakers-theme-data-display-board-card--unassigned&viewMode=story
    viewports:
      - width: 1440
        height: 900
      - width: 390
        height: 844
    selectors:
      - '[data-component-id="bb_theme:board"]'
      - '[data-component-id="bb_theme:board-card"]'
      - '[data-component-id="bb_theme:list"]'
    test_plan: |
      ## Proposed verification plan

      Status: planned, not run for the Board. Functional validation: deterministic Storybook browser checks against AC01–AC09. The user confirmed there is no template: reference-comparison `designbook:design-verify` is not applicable, and no comparison score will be generated. No criterion is currently claimed GREEN.

      ### Functional acceptance and evidence

      | AC | Scenario | Required evidence |
      |---|---|---|
      | AC01 | Open the project's Overview, navigate to Board and return twice | Browser observations retain project context, Board tab and correct screen |
      | AC02 | Load a populated board and an empty board | Screenshots and DOM show Backlog, Intake, In Progress, Done/Cancelled in order |
      | AC03 | Exercise terminal, active-run, conductor-only and no-conductor samples, including contradictory stale data | Deterministic fixture-to-column assertions prove precedence and one placement per ticket |
      | AC04 | Apply each User/Conductor filter, their intersection, Unassigned and reset | Browser/DOM evidence shows matching cards and counts, retained empty columns, no cross-project cards |
      | AC05 | Toggle Details off/on/off with two exact running workflow states | Exact state remains readable on every card; only In Progress splits and merges without losing or duplicating cards |
      | AC06 | Load PM, developer and dual-role contexts, then change Details manually | PM off, developer on, dual-role on; explicit current-view setting honored |
      | AC07 | Show blocked Intake, blocked Backlog, blocked-running and cancelled fixtures | Textual markers distinguish each; blocked alone is not an unhealthy/error indicator |
      | AC08 | Test fixed-clock completion boundaries, old completion, missing date and each period option | Correct membership uses closing time; default Last 7 days; missing date only under All time |
      | AC09 | Show active conductors, known and unknown capacity, and no active conductors | Section below board shows readable status, active-ticket counts and honest load/capacity; ticket filters do not misrepresent project capacity |

      Cover desktop (1440×900) and narrow (390×844), labels, keyboard operation, selected control states, readable card links and horizontal scrolling. These are proposed test viewports, not inferred design-source breakpoints. Retained component variants and sibling project scenes must still render. Capture screenshots as actual output for manual design review; no reference comparison is required. No reference-free diff score may be invented.

      ### Project checks

      For later web UI implementation, run from the repository root:

      - `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build`
      - `bash tests/contract/layout-components.sh`
      - `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs`
      - `cd tests/playwright && npm ci && npx playwright install chromium && npm test` with the recipe-test setup required by WORKFLOW.md.
      - `bash tests/contract/data-display-components.sh` only if component directories are added/removed.

      Separate existing Drupal regression coverage from Storybook acceptance: production backend implementation remains out of scope. Store each executed result with command, observed result and immutable tested commit. No live UI, screenshot, production role behavior or browser result has been verified during this spec run.

      ### Spec preparation evidence

      At repository base `dbc46c2722dd7e278a5784652f6e74b35309186a` with the previously reported local workflow/test edits, `npx --no-install storybook-addon-designbook intake design-screen` and its `--palette` form succeeded. They resolve planning context, not implementation acceptance. The external Claude Design URL was inaccessible through the web tool; no screenshot was captured. The existing reference metadata names only `ticket-list`.

      ### Actors and durable functional coverage

      | Actor | Role | Account | Environment | Status |
      |---|---|---|---|---|
      | Browser visitor | PM presentation (Details off) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Browser visitor | Developer presentation (Details on, including dual-role policy) | not_required: static prototype | Worktree Storybook | confirmed design context |
      | Human reviewer | Design review | not_required: static prototype | Worktree Storybook after coding | pending |

      Permanent coverage is planned in `tests/playwright/features/project-board/project-board.feature` and `tests/playwright/steps/project-board.steps.ts`, using the existing BDD suite and explicit Storybook URLs. Start/reuse Storybook through its CLI in the steps if needed so CI can run the coverage. Targeted command from `tests/playwright`: `npm test -- --grep "Project Board"`; the full project suite is a separate regression gate. Fix the sample clock at 2026-10-06T12:00:00Z; Today is the UTC calendar day and rolling 7/30-day windows include both boundaries through that clock. Future closing dates are excluded except under All time.

      Expected default membership: Backlog BOARD-01/02/11; Intake BOARD-03/04; In Progress BOARD-05/06/12; Done/Cancelled BOARD-07/08/13/15. BOARD-14 belongs to another project and never appears. Additional dates cover old completion, missing time, one second before the seven-day threshold and future time. Tests compare membership and counts, not fixture order or style classes.

      Runtime role authorization is outside scope: PM/developer are presentation contexts supplied to the prototype, not new Drupal roles. Product checks use their existing configured actors; no administrator is selected for convenience.
    regression_test_path: tests/playwright/features/project-board/project-board.feature
    note: Extend the existing playwright-bdd suite. Use explicit Storybook iframe URLs discovered through storybook status in board steps; no Drupal authentication. Existing feature/step globs include both paths. No new framework or config. Verify grouping, filters, Details and marks. During coding run npm test -- --grep "Project Board" with Storybook running; full suite remains a project check. Keep Storybook startup reproducible in CI via these steps using the Designbook CLI if not already running.
    step_definition_path: tests/playwright/steps/project-board.steps.ts
  legacy_slot_normalization:
    scenes:
      - project-create
    reason: Existing shell overlay object is not a SceneSlot under current schema; one-element array preserves meaning.
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-629-bakers-ui-project/web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml
  ```

  #### Results
  <!-- done -->

