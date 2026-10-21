# Plan: design-entity
<!-- digest: 2e4bdd725e7165050d73a890c59a798705a3285572b6ed5ad981a15319efdac4 -->

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
```

## Context
### task:create-sample-data (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/skills/sample-data/tasks/create-sample-data.md)
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

Produce the complete sample pool for the selected bundle. Apply only the record/field changes fixed by intake; retain unrelated records and fields, stable IDs, order and existing section tags. Add the requested section tag without discarding other tags.

Reuse a sufficient pool without scheduling a write. When more samples are necessary, preserve existing records and append only the declared shortfall with unused IDs. A selected record update preserves its identity. Preserve other bundles and all unrelated model/display configuration.

Completion: every sample selector and required field recorded by intake resolves, with the preserved data unchanged. Bundles outside the selected scope remain untouched; an excluded bundle never replaces its existing pool with an empty result.

```

### task:map-entity--design-screen (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/tasks/map-entity--design-screen.md)
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

### ctx:cli-surface (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/workflow/rules/cli-surface.md)
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

### ctx:match-reference-entity (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/skills/sample-data/rules/match-reference-entity.md)
```
---
trigger:
  domain: sample-data
---

# Generate Sample Data From the Live Reference Record

When a component/entity story is diffed pixel-for-pixel against a live reference
render of one specific record (a capture pinned to a `reference_url` and a
concrete record id), the sample-data record backing that story MUST carry that
same record's real field values — otherwise the diff measures content drift, not
appearance drift.

**Generate the record from the actual backend/reference source. Do not
hand-author it.** Hand-authoring is error-prone and drifts from the real record
as the reference source evolves.

## Step 1 — identify the reference record

Take the record id from the reference mapping that pinned this bundle to a
specific live record. If no id has been pinned yet, query the backend for a
candidate — without filtering on a "friendly" identifying field (e.g. a title):
many otherwise-valid records have that field empty, and filtering on it silently
excludes valid candidates.

## Step 2 — dump its real field values

Use the backend's own data-inspection tooling (not a hand-guess) to load the
record and emit its field values into the sample-data record shape the project's
sample-data format expects. Resolve any embedded/inline image reference into the
project's inline-image sample shape (see the project's inline-image rule, if one
exists) rather than leaving it as a raw reference id.

Write the output into the project's sample-data record for that
`{ entity_type, bundle }`, trimming any field the bundle's mapping does not
actually render.

## Step 3 — confirm against the live rendered DOM

Open the reference URL and confirm the dumped values against what actually
renders at the pinned locator: text/HTML content, image, any secondary metadata
(caption, copyright, byline), and link labels. The live rendered DOM is the
source of truth — if the backend dump and the live render disagree (a text-format
filter, a display-time transform, a derived image style), match the live render,
not the raw stored value.

## Checks

| ID | Severity | What to verify | Where |
|---|---|---|---|
| MATCH-REF-01 | error | The sample-data record is generated from the actual reference record (via the backend's own inspection tooling), not hand-invented, and its values match the live rendered DOM at the pinned locator | sample-data record |
| MATCH-REF-02 | warning | Reference-record selection does not filter on a "friendly" identifying field being populated | sample-data record |
| MATCH-REF-03 | warning | Embedded/inline image references are dumped in the project's inline-image sample shape, not left as a raw reference id | sample-data record |

```

### ctx:story-image-node-renderer (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/story-image-node-renderer.md)
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

### ctx:local-image-assets (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/local-image-assets.md)
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

### ctx:entity-reference-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/entity-reference-rendering.md)
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

### ctx:link-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/sample-data/rules/link.md)
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

### ctx:image (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/sample-data/rules/image.md)
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

### ctx:formatted-text (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/sample-data/rules/formatted-text.md)
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

### ctx:sample-records (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/skills/sample-data/blueprints/sample-records.md)
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

### ctx:variant-transport (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/variant-transport.md)
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

### ctx:typed-component-boundary (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/typed-component-boundary.md)
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

### ctx:scenes-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/scenes-constraints.md)
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

### ctx:referenced-content-view-mode (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/referenced-content-view-mode.md)
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

### ctx:presenter-composition (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/presenter-composition.md)
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

### ctx:inline-image (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/rules/inline-image.md)
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

### ctx:image-fields (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/rules/image-fields.md)
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

### ctx:field-cardinality (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/rules/field-cardinality.md)
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

### ctx:views (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/views.md)
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

### ctx:ui-patterns (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/ui-patterns.md)
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

### ctx:presenter-template (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/presenter-template.md)
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

### ctx:pager-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/pager.md)
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

### ctx:layout-builder (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/layout-builder.md)
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

### ctx:form-display (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/form-display.md)
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

### ctx:field-map (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/field-map.md)
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

### ctx:canvas (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-mapping/blueprints/canvas.md)
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

## Steps

### Step: create-sample-data
Context: [ctx:cli-surface, ctx:match-reference-entity, ctx:story-image-node-renderer, ctx:local-image-assets, ctx:entity-reference-rendering, ctx:link-2, ctx:image, ctx:formatted-text, ctx:sample-records]

- [x] create-sample-data — bb_comment samples

  Instruction: task:create-sample-data

  #### Params
  ```yaml
  section_id: bb_ticket
  bundle:
    entity_type: bb_comment
    bundle: bb_comment
  sample_data_bundles:
    - entity_type: bb_comment
      bundle: bb_comment
  data_model:
    content:
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-657-comment-canonica/web/themes/custom/bb_theme/components
  acceptance: 'CHANGE of bb_comment.bb_comment.yml. Preserve records 1-7 identities, ticket_id, author, type, created, changed, body and section tags. Add computed author_name, author_initials, author_color on every record from the author user sample (1=Christian Wiedemann/CW/attention, 2=Sven Gruber/SG/unassigned, 3=author 3 display_name/initials/lease, 4=author 4/offline). APPEND id 8: ticket_id 1, author 1, type handoff-v3 (unknown), short body, created after comment 3. APPEND id 9: ticket_id 9, author 4, type spec, body is HTML table Col A/Col B cells alpha/bravo plus filler to >=32768 bytes ending with <p>BB-657-END-MARKER</p>. APPEND id 10: ticket_id 4, author 1, type comment, short body (single-comment fixture). Do not rewrite other bundles.'
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-657-comment-canonica/web/themes/custom/bb_theme/designbook/data/bb_comment.bb_comment.yml
  ```

  #### Results
  <!-- done -->

### Step: map-entity
Context: [ctx:cli-surface, ctx:variant-transport, ctx:typed-component-boundary, ctx:scenes-constraints, ctx:referenced-content-view-mode, ctx:presenter-composition, ctx:local-image-assets, ctx:entity-reference-rendering, ctx:inline-image, ctx:image-fields, ctx:field-cardinality, ctx:views, ctx:ui-patterns, ctx:presenter-template, ctx:pager-2, ctx:layout-builder, ctx:form-display, ctx:field-map, ctx:canvas]

- [x] map-entity--design-screen — bb_comment teaser

  Instruction: task:map-entity--design-screen

  #### Params
  ```yaml
  mapping:
    entity_type: bb_comment
    bundle: bb_comment
    mode_kind: view
    view_mode: teaser
  data_model:
    content:
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
  acceptance: 'NEW bb_comment.bb_comment.teaser.jsonata. Compact embedded event: author_name/author_initials/author_color from the record (never type-derived hardcoded identities), role human, tag only when type != comment, timestamp created, body body. After the event, one bb_theme:link-group with one accessible canonical link whose title identifies the comment (Open {type} comment) and url /comment/{id}. Components used: event, link-group only. Update data-model view_modes.teaser. Do not change full in this task.'
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-657-comment-canonica/web/themes/custom/bb_theme/designbook/entity-mapping/bb_comment.bb_comment.teaser.jsonata
  ```

  #### Results
  <!-- done -->

- [x] map-entity--design-screen — bb_comment full

  Instruction: task:map-entity--design-screen

  #### Params
  ```yaml
  mapping:
    entity_type: bb_comment
    bundle: bb_comment
    mode_kind: view
    view_mode: full
  data_model:
    content:
      bb_comment:
        bb_comment:
          title: bakers.build comment
          view_modes:
            full:
              template: field-map
            teaser:
              template: field-map
  acceptance: 'CHANGE bb_comment.bb_comment.full.jsonata. Canonical body, not a nested shell. First: event with real author_* fields, role human, tag ALWAYS the stored type including comment, timestamp created, body body. Then a zone heading Ticket whose content is a badge of the owning ticket state and a link-group with one ticket identifier/title link. Then a zone heading Comments whose content is a link-group of Previous and/or Next sibling comments on the same ticket; omit unavailable ends; single comment omits the zone (zone with nothing renders nothing). Pin per-id sibling facts in the mapping (JSONata cannot join): ticket 1 comments 1,2,3,8 created ASC; ticket 9 comments 4,5,6,7,9; ticket 4 comment 10 only. Ticket labels: 1=BB-142 state coding, 9 from sample, 4=BB-118 state spec. Components: event, zone, badge, link-group only. No type-derived hardcoded author identities.'
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-657-comment-canonica/web/themes/custom/bb_theme/designbook/entity-mapping/bb_comment.bb_comment.full.jsonata
  ```

  #### Results
  <!-- done -->

