# Plan: design-screen
<!-- digest: bc30e8dea0de61e4211de9e1b5f292cfa495618fbd20bb99dc0e2739124957fb -->

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
### task:write-scene (task, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/scenes/tasks/write-scene.md)
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

### ctx:sample-template-mapping (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/skills/data-model/rules/sample-template-mapping.md)
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

### ctx:presenter-template-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/skills/data-model/rules/presenter-template.md)
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

### ctx:shell-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/shell-scene-constraints.md)
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

### ctx:screen-scene-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/screen-scene-constraints.md)
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

### ctx:markup-derivation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/markup-derivation.md)
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

### ctx:icon-sprite (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/icon-sprite.md)
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

### ctx:component-contract-index (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/rules/component-contract-index.md)
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

### ctx:token-backed-utilities (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/08d29a9c93ee/rules/token-backed-utilities.md)
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

### ctx:scenes-constraints-2 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/08d29a9c93ee/rules/scenes-constraints.md)
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

### ctx:font-availability (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/08d29a9c93ee/rules/font-availability.md)
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

### ctx:component-styling (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/08d29a9c93ee/rules/component-styling.md)
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

### ctx:component-source (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-css-tailwind/08d29a9c93ee/rules/component-source.md)
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

### ctx:navigation (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/shell/rules/navigation.md)
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

### ctx:scenes-constraints-3 (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/scenes/rules/scenes-constraints.md)
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

### ctx:presenter-template-surfaces (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/presenter-template-surfaces.md)
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

### ctx:media-image-styles (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/media-image-styles.md)
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

### ctx:form-modes (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/form-modes.md)
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

### ctx:field-type-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/field-type-constraints.md)
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

### ctx:drupal-views (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/drupal-views.md)
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

### ctx:drupal-config (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/drupal-config.md)
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

### ctx:block-decision (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/rules/block-decision.md)
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

### ctx:slot-rendering (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/rules/slot-rendering.md)
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

### ctx:layout-constraints (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/rules/layout-constraints.md)
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

### ctx:js-behavior (rule, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/rules/js-behavior.md)
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

### ctx:image_style (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/skills/data-model/blueprints/image_style.md)
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

### ctx:static-assets (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook/08d29a9c93ee/design/blueprints/static-assets.md)
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

### ctx:view (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/blueprints/view.md)
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

### ctx:taxonomy_term (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/blueprints/taxonomy_term.md)
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

### ctx:node (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/blueprints/node.md)
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

### ctx:media (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/blueprints/media.md)
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

### ctx:field-types (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/blueprints/field-types.md)
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

### ctx:block_plugin (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/data-model/blueprints/block_plugin.md)
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

### ctx:section (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/section.md)
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

### ctx:pager (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/pager.md)
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

### ctx:page (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/page.md)
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

### ctx:navigation-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/navigation.md)
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

### ctx:logo (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/logo.md)
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

### ctx:link (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/link.md)
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

### ctx:js-behavior-2 (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/js-behavior.md)
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

### ctx:icon (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/icon.md)
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

### ctx:header (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/header.md)
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

### ctx:grid (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/grid.md)
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

### ctx:form (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/form.md)
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

### ctx:footer (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/footer.md)
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

### ctx:container (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/container.md)
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

### ctx:button (blueprint, source: /home/cw/.claude/plugins/cache/designbook/designbook-drupal/08d29a9c93ee/components/blueprints/button.md)
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

- [x] write-scene — personal-time-week

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: personal-time-week
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — personal-time-week-errors

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: personal-time-week-errors
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — personal-time-week-empty

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: personal-time-week-empty
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — personal-time-week-submission

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: personal-time-week-submission
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — record-time-create

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: record-time-create
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — record-time-edit

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: record-time-edit
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

- [x] write-scene — record-time-error

  Instruction: task:write-scene

  #### Params
  ```yaml
  scene_path: sections/user/user.section.scenes.yml
  components_dir: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/components
  scene_name: record-time-error
  scene_scope: screen
  components:
    - id: bb_theme:canvas
    - id: bb_theme:page_header
    - id: bb_theme:button
    - id: bb_theme:icon
    - id: bb_theme:week-strip
    - id: bb_theme:text
    - id: bb_theme:message
    - id: bb_theme:table
    - id: bb_theme:property_pill
    - id: bb_theme:empty-state
    - id: bb_theme:dialog
    - id: bb_theme:form_label
    - id: bb_theme:form_input
    - id: bb_theme:form_textarea
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
      path: /home/cw/projects/bakers/.bakers-worktrees/feat/bb-642-show-time-as-a-l/web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml
  ```

  #### Results
  <!-- done -->

