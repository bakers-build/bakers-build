# Plan: css-generate
<!-- digest: 676d69fcb87fcd5814eca130e171638289beeaa41225c83bd9986476e13318f8 -->

## Schemas
```yaml
definitions:
  CssGenerationPlan:
    type: object
    title: CSS Generation Plan
    description: Complete plan emitted by intake for JSONata generation, token CSS outputs, and font assets.
    required:
      - framework
      - mode
      - reasons
      - paths
      - jsonata
      - fonts
    properties:
      framework:
        type: string
        description: Active CSS framework resolved from the workspace configuration.
        examples:
          - tailwind
      mode:
        type: string
        description: Overall intake decision for the workflow run.
        enum:
          - create
          - reuse
          - refresh
      reasons:
        type: array
        description: Machine-readable reasons explaining why intake selected the current mode.
        items:
          type: string
      paths:
        type: object
        required:
          - jsonata_dir
          - tokens_dir
          - fonts_dir
          - font_css_path
          - index_css_path
        properties:
          jsonata_dir:
            type: string
            description: Workspace-relative directory that stores generated JSONata files for the active CSS framework.
            examples:
              - designbook/designbook-css-tailwind
          tokens_dir:
            type: string
            description: Workspace-relative directory for generated token CSS files.
            examples:
              - css/tokens
          fonts_dir:
            type: string
            description: Workspace-relative directory that stores downloaded font binaries referenced by generated CSS.
            examples:
              - css/fonts
          font_css_path:
            type: string
            description: Workspace-relative stylesheet path for generated @font-face declarations.
            examples:
              - css/tokens/google-fonts.src.css
          index_css_path:
            type: string
            description: Workspace-relative stylesheet path for the token CSS barrel file.
            examples:
              - css/tokens/index.src.css
      jsonata:
        type: object
        required:
          - strategy
          - artifacts
        properties:
          strategy:
            type: string
            description: Whether intake wants to create new JSONata files, reuse existing ones, or refresh them in place.
            enum:
              - create
              - reuse
              - refresh
          existing_files:
            type: array
            description: Existing JSONata files discovered in the framework directory before intake made its decision.
            items:
              type: string
          artifacts:
            type: array
            description: Ordered list of JSONata/CSS outputs that downstream stages should manage.
            items:
              type: object
              required:
                - group
                - prefix
                - wrap
                - token_path
                - jsonata_path
                - css_path
                - config_output_path
              properties:
                group:
                  type: string
                  description: Group identifier used in filenames and workflow task titles.
                  examples:
                    - primitive-color
                    - typography
                prefix:
                  type: string
                  description: CSS custom property prefix used when rendering declarations.
                  examples:
                    - color
                    - text
                    - container
                wrap:
                  type: string
                  description: CSS wrapper construct emitted by the JSONata template.
                  examples:
                    - '@theme'
                    - '@layer theme'
                token_path:
                  type: string
                  description: Dotted token path read from design-tokens.yml.
                  examples:
                    - primitive.color
                    - semantic.typography
                resolve:
                  type: string
                  description: Optional reference-resolution mode for the generated expression.
                  examples:
                    - var
                expand:
                  type: string
                  description: Optional composite-expansion mode for the generated expression.
                  examples:
                    - typography
                jsonata_path:
                  type: string
                  description: Workspace-relative path where the generated JSONata file is written.
                  examples:
                    - designbook/designbook-css-tailwind/generate-color.jsonata
                css_path:
                  type: string
                  description: Workspace-relative CSS file produced when this JSONata expression runs.
                  examples:
                    - css/tokens/color.src.css
                config_output_path:
                  type: string
                  description: Output path written into the JSONata @config block, relative to the JSONata file itself.
                  examples:
                    - ../../css/tokens/color.src.css
      fonts:
        type: object
        required:
          - strategy
          - fonts_dir
          - font_css_path
        properties:
          strategy:
            type: string
            description: Whether intake wants to create, reuse, refresh, or skip generated font assets.
            enum:
              - create
              - reuse
              - refresh
              - skip
          existing:
            type: boolean
            description: True when intake detected existing font assets that may be reused.
          fonts_dir:
            type: string
            description: Workspace-relative directory that stores downloaded font binaries.
            examples:
              - css/fonts
          font_css_path:
            type: string
            description: Workspace-relative stylesheet path for generated @font-face declarations.
            examples:
              - css/tokens/google-fonts.src.css
          detected_files:
            type: array
            description: Existing font files or stylesheets intake found while scanning the workspace.
            items:
              type: string
          families:
            type: array
            description: Font-family names intake expects the prepare-fonts stage to manage.
            items:
              type: string
  GoogleFontsCss:
    type: string
    title: Google Fonts Stylesheet
    description: '@font-face declarations generated for downloaded font assets.'
  CssArtifactPlan:
    type: object
    title: CSS Artifact Plan
    description: One generated JSONata expression plus its target CSS output.
    required:
      - group
      - prefix
      - wrap
      - token_path
      - jsonata_path
      - css_path
      - config_output_path
    properties:
      group:
        type: string
        description: Group identifier used in filenames and workflow task titles.
        examples:
          - primitive-color
          - typography
      prefix:
        type: string
        description: CSS custom property prefix used when rendering declarations.
        examples:
          - color
          - text
          - container
      wrap:
        type: string
        description: CSS wrapper construct emitted by the JSONata template.
        examples:
          - '@theme'
          - '@layer theme'
      token_path:
        type: string
        description: Dotted token path read from design-tokens.yml.
        examples:
          - primitive.color
          - semantic.typography
      resolve:
        type: string
        description: Optional reference-resolution mode for the generated expression.
        examples:
          - var
      expand:
        type: string
        description: Optional composite-expansion mode for the generated expression.
        examples:
          - typography
      jsonata_path:
        type: string
        description: Workspace-relative path where the generated JSONata file is written.
        examples:
          - designbook/designbook-css-tailwind/generate-color.jsonata
      css_path:
        type: string
        description: Workspace-relative CSS file produced when this JSONata expression runs.
        examples:
          - css/tokens/color.src.css
      config_output_path:
        type: string
        description: Output path written into the JSONata @config block, relative to the JSONata file itself.
        examples:
          - ../../css/tokens/color.src.css
      theme:
        type: string
        description: Set when this artifact is a theme/mode override (see the css-mapping blueprint's Theme / Mode Overrides section) rather than a base group. The theme's key under design-tokens.yml's top-level `themes:` map.
        examples:
          - cozy
          - dark
          - hyperstructure
      selector_attr:
        type: string
        description: Attribute name wrapping a theme override's declarations, derived per the css-mapping blueprint's Selector attribute derivation rules. Only present when `theme` is set.
        examples:
          - data-theme
          - data-mode
          - data-layout
      selector_value:
        type: string
        description: Attribute value wrapping a theme override's declarations. Only present when `theme` is set.
        examples:
          - dark
          - cozy
          - hyperstructure
  Jsonata:
    type: string
    title: JSONata Expression
    description: JSONata program source that will be executed to generate CSS.
  CompiledCss:
    type: string
    title: Compiled Application Stylesheet
    description: Framework-compiled stylesheet on disk in which token @theme variables are resolved to :root custom properties, consumed by the guard-css probe.
  IndexCss:
    type: string
    title: CSS Token Index
    description: Barrel file source that imports the generated token CSS files in cascade order.
```

## Context
### task:prepare-fonts (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/css-generate/fonts/google/tasks/prepare-fonts.md)
````
---
title: "Prepare Fonts"
trigger:
  steps: [prepare-fonts]
domain: [css]
params:
  type: object
  required: [css_generation_plan, design_tokens]
  properties:
    css_generation_plan:
      $ref: ../../../schemas.yml#/CssGenerationPlan
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      workflow: tokens
      type: object
result:
  type: object
  required: [google-fonts-css]
  properties:
    google-fonts-css:
      path: "{{ css_generation_plan.fonts.font_css_path }}"
      $ref: ../../../schemas.yml#/GoogleFontsCss
---

# Prepare Fonts: Download Google Fonts CSS

Prepare generated font assets according to `css_generation_plan.fonts`.

## Step 1: Read Font Families

Read `semantic.typography` tokens from `design-tokens.yml`. Extract all unique font families unless the plan already provides an explicit family list.

If the plan strategy is `reuse`, keep the existing font stylesheet and binaries in their current locations and return the current stylesheet source as-is.
If the plan strategy is `skip`, return an empty stylesheet string and do not download or modify binaries.

## Step 2: Derive Font Weights

If `semantic.typography-scale` tokens exist, extract all unique `fontWeight` values referenced in the scale. Otherwise default to `400;500;600;700`.

## Step 3: Obtain woff2 Files

When the plan strategy is `create` or `refresh`, ensure each required family has woff2 binaries in the planned font directory.

Prefer an existing local match first: if `{{ css_generation_plan.fonts.fonts_dir }}` already contains woff2 files whose names start with the family (e.g. `Reef-Bold.woff2` for family `Reef`), keep those files and skip the download for that family.

Otherwise download from Google Fonts:

```bash
npx google-font-cli download "<Font Name>" -v <w1>,<w2>,<w3> --woff2 -d {{ css_generation_plan.fonts.fonts_dir }}
```

- `<Font Name>`: exact family name (e.g. `"Inter"`, `"Space Grotesk"`)
- `-v`: comma-separated weight values sorted numerically (e.g. `400,500,600,700`)
- `--woff2`: download in woff2 format (modern, small file size)

When the family is not in the Google catalog and no local woff2 match exists, leave the family uncovered and surface that gap to `guard-css` — do not invent a system-font fallback as a pass.

## Step 4: Write CSS

Generate the planned font stylesheet with `@font-face` declarations for each downloaded woff2 file:

```css
@font-face {
  font-family: '<Font Name>';
  font-style: normal;
  font-weight: <weight>;
  font-display: swap;
  src: url("../fonts/<filename>.woff2") format("woff2");
}
```

- One `@font-face` block per weight per family
- Use relative paths from the planned font stylesheet to the planned font directory
- The file SHALL contain only `@font-face` declarations with local woff2 references — never remote URLs or `@import url(...)` statements

When the strategy is `reuse`, read the existing stylesheet from `css_generation_plan.fonts.font_css_path` and return its current source instead of rewriting it unnecessarily.

````

### task:generate-jsonata (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/css-generate/tasks/generate-jsonata.md)
```
---
title: 'Generate JSONata: {{ artifact.group }}'
trigger:
  steps:
    - generate-jsonata
domain:
  - css
params:
  type: object
  required:
    - artifact
    - css_generation_plan
    - design_tokens
  properties:
    artifact:
      $ref: ../schemas.yml#/CssArtifactPlan
    css_generation_plan:
      $ref: ../schemas.yml#/CssGenerationPlan
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      workflow: tokens
      type: object
result:
  type: object
  required:
    - generate-jsonata
  properties:
    generate-jsonata:
      path: '{{ artifact.jsonata_path }}'
      $ref: ../schemas.yml#/Jsonata
---

# Generate JSONata Expression

Generate one `.jsonata` expression file per planned CSS artifact. The expression transforms `design-tokens.yml` into the artifact's target CSS file.

Read the `jsonata-template` blueprint for the expression format. Use the current `artifact` values for the token path, CSS prefix, wrapper, JSONata destination, and relative `@config.output` path.

The generated JSONata source must:

- keep `input` relative to the JSONata file's location
- use `artifact.config_output_path` as the `@config.output`
- preserve the active framework's mapping semantics from the blueprint

When `css_generation_plan.jsonata.strategy` is:

- `create` — write a fresh JSONata file for every artifact
- `refresh` — overwrite the existing JSONata file in place using the current artifact plan
- `reuse` — keep the existing JSONata file content if it already exists at `artifact.jsonata_path`; only regenerate missing files

If a reused JSONata file already exists and still matches the current artifact plan, submit that file unchanged as the task result instead of inventing a new variant.

```

### task:generate-css (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/css-generate/tasks/generate-css.md)
```
---
title: "Generate CSS"
trigger:
  steps: [generate-css]
domain: [css]
params:
  type: object
  required: [css_generation_plan, design_tokens]
  properties:
    css_generation_plan:
      $ref: ../schemas.yml#/CssGenerationPlan
    design_tokens:
      path: $DESIGNBOOK_DATA/design-system/design-tokens.yml
      workflow: tokens
      type: object
---

# Generate CSS — Execute JSONata

Run the `.jsonata` expression files listed in `css_generation_plan.jsonata.artifacts`. Each file remains self-contained, and its embedded `@config` block specifies the relative input and output paths to use.

If the plan reuses existing JSONata files, execute those in place. If no JSONata artifacts are planned, stop and report that there was nothing to generate.

Report per artifact CSS output: file path and count of `--` custom property declarations. Flag any planned output that is empty or missing as error.

Execute the artifacts in plan order. For every artifact:

1. Resolve `artifact.jsonata_path`
2. Read the embedded `@config`
3. Run the JSONata transform against `design-tokens.yml`
4. Verify that the produced file lands at `artifact.css_path`

Treat any mismatch between the planned output path and the JSONata `@config.output` as an error in the run.

```

### task:compile-css (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/tasks/compile-css.md)
````
---
name: designbook-css:compile-css
title: "Compile CSS"
trigger:
  steps: [compile-css]
filter:
  frameworks.css: tailwind
result:
  type: object
  required: [compiled-css]
  properties:
    compiled-css:
      path: "$DESIGNBOOK_CSS_DIR/app.css"
      $ref: ../../designbook/skills/css-generate/schemas.yml#/CompiledCss
---

# Compile CSS

Compile the app stylesheet to a real file so token `@theme` variables are
emitted to `:root` (the source uses Tailwind at-rules a browser cannot resolve).

Run:

```bash
npx @tailwindcss/cli -i "$DESIGNBOOK_CSS_APP" -o "$DESIGNBOOK_CSS_DIR/app.css" --minify
```

The output is the input both for the `guard-css` probe and for any
consumer that needs a compiled stylesheet on disk.

## Font paths

Compiled CSS must resolve each local font URL from the compiled output directory.
Tailwind CLI preserves URLs from imported stylesheets; after compilation, rebase
font URLs using the original font stylesheet location in `css_generation_plan.fonts`.
Do not move or duplicate the font files. Confirm the rebased paths exist before
submitting the compiled stylesheet.

````

### task:guard-css (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/css-generate/tasks/guard-css.md)
```
---
name: designbook:css-generate:guard-css
title: "Guard CSS — token + font presence"
trigger:
  steps: [guard-css]
result:
  type: object
  required: [guard-passed]
  properties:
    guard-passed: { type: boolean }
    missing-vars: { type: array, items: { type: string } }
    missing-fonts: { type: array, items: { type: string } }
    unresolved-placeholders:
      type: array
      description: >
        Generated token declarations whose value still contains an alias
        placeholder (a `{…}` segment) that the JSONata transform failed to
        resolve. Each entry is the offending `--var: value;` line.
      items: { type: string }
---

# Guard CSS

Prove every generated token variable and font actually reaches the rendered
frontend. Framework-independent: checks `:root` custom properties and
`document.fonts`, not utility classes.

## Steps

1. **Expected vars** — collect every `--<name>` declared across the generated
   token files under `$DESIGNBOOK_DIRS_CSS_TOKENS/*.css` (grep `^\s*--[\w-]+:`).
   These are what the design system defines and MUST resolve.
2. **Unresolved placeholders** — scan the same generated token files for any
   declaration whose value still contains an alias placeholder (a `{…}`
   segment, e.g. `--font-heading: "{primitive.typography.reef}";`). A
   placeholder means the JSONata transform emitted the alias raw instead of
   resolving it — the declaration is syntactically valid but semantically dead
   (an invalid `font-family` silently falls back to serif). Collect each
   offending line into `unresolved-placeholders`.
3. **Expected fonts** — collect each `font-family` name from the generated
   `@font-face` blocks (the prepared font stylesheet) and any `font_family`
   typography token.
4. **Probe** — write `$DESIGNBOOK_CSS_DIR/_token-probe.html` (no markup) linking
   the compiled css relatively:
   `<!doctype html><html><head><link rel="stylesheet" href="./app.css"></head><body></body></html>`
5. **Inspect** — run the addon to capture the style env of the probe and diff
   against expected (uses `captureStyleEnv` + `collectMissing`):
   `npx storybook-addon-designbook guard-css --probe "$DESIGNBOOK_CSS_DIR/_token-probe.html" --vars <comma-list> --fonts <comma-list>`
   (CLI prints JSON `{ ok, vars, fonts }`.)
6. **Verdict** — submit `{"guard-passed": true}` only when `ok` AND
   `unresolved-placeholders` is empty. Otherwise FAIL the task; do not mark
   done. Report all three: missing `--vars` (token never reached `:root`, e.g.
   tree-shaken / not generated), missing fonts (no `@font-face` coverage), and
   unresolved placeholders (alias never resolved by the transform).

If Chromium or Playwright is unavailable, attempt to restore the declared browser environment. If the probe still cannot run, block the task with the command failure; an unperformed check cannot pass.

```

### task:generate-index (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/skills/css-generate/tasks/generate-index.md)
```
---
title: "Generate Index"
trigger:
  steps: [generate-index]
domain: [css]
params:
  type: object
  required: [css_generation_plan]
  properties:
    css_generation_plan:
      $ref: ../schemas.yml#/CssGenerationPlan
result:
  type: object
  required: [index-css]
  properties:
    index-css:
      path: "{{ css_generation_plan.paths.index_css_path }}"
      $ref: ../schemas.yml#/IndexCss
---

# Generate CSS Token Index

Generate a barrel file source that imports the token CSS files referenced by the current CSS generation plan.

List the planned token CSS outputs, excluding the index file itself, sorted alphabetically. Write one `@import` per file.

Also include `css_generation_plan.fonts.font_css_path` when the font strategy is not `skip`. The generated font stylesheet should participate in the same barrel file when the workspace manages fonts through generated CSS.

All imports must be written relative to the index file location.

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

### ctx:css-mapping (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/blueprints/css-mapping.md)
````
---
type: css-mapping
name: tailwind
priority: 10
trigger:
  domain: css
filter:
  frameworks.css: tailwind
---

# CSS Mapping — Tailwind v4

Declares all `CssGroup` entries that the css-generate workflow may emit for a
Tailwind v4 project. Each entry maps a dotted token path inside
`design-tokens.yml` to a CSS custom-property `prefix` and a block `wrap`. The
intake task scans the tokens and **only emits groups whose `path` exists and
contains at least one leaf token** (a node carrying `$value`). Missing or
empty paths are skipped silently — no empty `@theme {}` blocks are produced.

```yaml
groups:
  # primitive layer ─ raw values, never used directly in markup
  primitive-color:    { path: primitive.color,             prefix: color,           wrap: "@theme static" }
  primitive-radius:   { path: primitive.radius,            prefix: radius,          wrap: "@theme static" }
  primitive-shadow:   { path: primitive.shadow,            prefix: shadow,          wrap: "@theme static" }
  primitive-spacing:  { path: primitive.spacing,           prefix: spacing,         wrap: "@theme static" }
  primitive-font:     { path: primitive.fontFamily,        prefix: font,            wrap: "@theme static" }
  primitive-text:     { path: primitive.fontSize,          prefix: text,            wrap: "@theme static" }
  primitive-weight:   { path: primitive.fontWeight,        prefix: font-weight,     wrap: "@theme static" }
  primitive-leading:  { path: primitive.lineHeight,        prefix: leading,         wrap: "@theme static" }

  # semantic layer ─ purpose/role tokens, reference primitives via var()
  color:              { path: semantic.color,              prefix: color,           wrap: "@theme static", resolve: var }
  radius:             { path: semantic.radius,             prefix: radius,          wrap: "@theme static", resolve: var }
  shadow:             { path: semantic.shadow,             prefix: shadow,          wrap: "@theme static", resolve: var }
  typography:         { path: semantic.typography,         prefix: text,            wrap: "@theme static", expand: typography }

  # component layer ─ component-specific tokens, often nested deeper
  layout-width:       { path: component.container.max-width, prefix: container,      wrap: "@theme static", resolve: var }
  layout-spacing:     { path: component.section.padding-y,   prefix: layout-spacing, wrap: "@theme static", resolve: var }
  grid:               { path: component.grid.gap,            prefix: grid,           wrap: "@theme static", resolve: var }
```

## Group Naming

The map key (`primitive-color`, `color`, `layout-spacing`, …) becomes the
`CssGroup.group` identifier. It must be a unique, kebab-case name; the
`generate-jsonata` and `generate-css` stages use it for filenames
(`generate-{group}.jsonata`, `{group}.src.css`).

## Path Walking

`CssGroup.path` is a **dotted, possibly hyphen-containing path** inside
`design-tokens.yml` (e.g. `primitive.color`, `component.section.padding-y`).
The `generate-jsonata` template walks this subtree **recursively** and emits
one CSS custom property per leaf node, joining nested keys with `-`:

- `primitive.color.blue.500` → `--color-blue-500`
- `primitive.fontFamily.heading` → `--font-heading`
- `component.section.padding-y.md` → `--layout-spacing-md`
- `component.container.max-width.lg` → `--container-lg`

Keys starting with `$` (DTCG metadata: `$value`, `$type`, `$extensions`) are
always skipped.

## Path Discovery (arbitrary primitive/semantic nesting)

`CssGroup.path` is a **declared, not necessarily literal**, location. A
consuming project is free to group its primitives (or its semantic/component
tokens) under an extra organizational level for its own reasons — e.g.
`primitive.layout.spacing` and `primitive.layout.radius` instead of the flat
`primitive.spacing` / `primitive.radius` shown above, or
`primitive.style.color` and `primitive.style.fontSize` instead of
`primitive.color` / `primitive.fontSize`. Intake resolves each declared path
as follows, **before** deciding whether a group is emitted:

1. **Try the literal path first.** If `path` exists in `design-tokens.yml`
   and contains at least one leaf (`$value`) anywhere in its subtree, use it
   as-is. This keeps every flat, one-level project (the common case, and
   every existing fixture) resolving exactly as before — same path, same
   output, byte-for-byte.
2. **Otherwise, search for it.** Split the declared path into its root axis
   (the first segment: `primitive`, `semantic`, or `component`) and its
   final segment (the group's own name: `color`, `spacing`, `radius`,
   `fontSize`, …, or for a multi-segment component path such as
   `component.section.padding-y`, the tail formed by everything after the
   root). Breadth-first search every descendant of the root axis for a
   subtree whose own key path ends in that final segment/tail **and** that
   contains at least one leaf token. Depth is unconstrained — one extra
   grouping level (`primitive.layout.spacing`) resolves exactly like two
   (`primitive.foo.bar.spacing`) would.
3. **Resolve ties deterministically.** If more than one subtree in the same
   root axis matches (rare — it means the project reused a group name at two
   different nesting levels), prefer the shallowest match; break remaining
   ties alphabetically by full path. This must never require a follow-up
   question — intake decides deterministically and records which path it
   picked.
4. **Record the discovered path**, not the declared one, as the artifact's
   `token_path` (`CssArtifactPlan.token_path`). `generate-jsonata` always
   walks `token_path`, so the discovery step is the only place nesting depth
   is ever reasoned about; the template itself is unchanged and already
   depth-agnostic *below* whatever root it is told to start from.
5. **Still skip silently if nothing matches.** If no subtree anywhere under
   the root axis ends in the group's final segment and carries a leaf, the
   group is skipped exactly as documented above — this is unchanged, and
   still produces no empty `@theme {}` block.

This makes `path` a **discovery key** for the group's identity (which
namespace and which final name), not a hard requirement on exactly how many
levels separate it from the root.

## Modifiers

| Field           | Effect |
|-----------------|--------|
| `resolve: var`  | DTCG references (`{primitive.color.blue.900}`) are emitted as `var(--<prefix>-<flattened-ref>)` instead of being expanded to the final value. Use for the semantic layer when it should re-reference primitives at runtime. |
| `expand: typography` | Each composite `$type: typography` token expands into three CSS custom properties: `--<prefix>-<role>`, `--<prefix>-<role>--font-weight`, `--<prefix>-<role>--line-height`. The `fontFamily` sub-value is omitted (it is already covered by the `primitive-font` group). |

## Tailwind v4 Namespace Compatibility

Tailwind v4 auto-generates utility classes for the standard namespaces
`--color-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`,
`--spacing-*`, `--radius-*`, `--shadow-*`, and `--container-*`. Non-standard
prefixes (`--layout-spacing-*`, `--grid-*`) do not auto-generate utilities and
must be referenced via `var()` in markup or `@utility` rules.

## Theme / Mode Overrides

`design-tokens.yml` may carry a top-level `themes:` map. Each key under it
(`themes.cozy`, `themes.dark`, `themes.hyperstructure`, …) is an **override
tree** shaped exactly like the base tree — its leaves live under the same
kind of path a `groups:` row already describes (`primitive.*`,
`semantic.*`, `component.*`) — but it carries only the tokens that differ
for that theme/mode, not a full copy of the design system.

Intake enumerates theme overrides in a **second pass**, after resolving the
base `groups:` artifacts:

1. For every key `<name>` under `themes.*`, and for every declared
   `groups:` row, run the same [Path Discovery](#path-discovery-arbitrary-primitivesemantic-nesting)
   algorithm scoped to `themes.<name>` as the search root instead of the
   top-level document. E.g. for the `spacing` group (declared path
   `primitive.spacing`), look for a subtree under `themes.cozy` ending in
   `spacing` — whether that is `themes.cozy.primitive.spacing` (flat) or
   `themes.cozy.primitive.layout.spacing` (nested, matching whatever depth
   the base tree itself uses for that project).
2. Emit one override artifact per `(group, theme)` pair that actually has a
   matching, non-empty subtree. Skip pairs with no match — a theme need not
   override every group. The artifact's group id is `<group>-theme-<name>`
   (matches the existing `generate-color-theme-hyperstructure.jsonata`
   naming already produced by this workflow).
3. The override artifact's CSS uses the **same prefix** as its base group,
   but wraps the declarations in a selector block instead of `@theme` — see
   the `jsonata-template` blueprint's *Theme Override Expression Template*.

### Selector attribute derivation

The attribute name and value wrapping a theme's overrides are derived from
the theme node, in this documented order — never guessed ad hoc at
generation time:

1. **Explicit metadata wins.** If `themes.<name>.$extensions.designbook.axis`
   is set, the attribute is `data-<axis>` and the value is
   `themes.<name>.$extensions.designbook.value` if present, otherwise
   `<name>` itself. This is the escape hatch for a project that wants a
   specific attribute/value pair without relying on the heuristics below.
2. **Dark mode.** If `themes.<name>.$extensions.darkMode: true`, the
   attribute is `data-mode` and the value is `dark`. Also emit the
   `prefers-color-scheme: dark` media-query companion block described in
   the template (unchanged from the existing behavior).
3. **Layout/density axis.** If every override this theme contributes
   resolves under a `primitive.*` root (i.e. the theme only re-tunes raw
   scale values such as spacing/radius, not semantic color roles — this is
   the `themes.cozy` shape), the attribute is `data-layout` and the value is
   `<name>`.
4. **Default — alternate palette/theme.** Otherwise (the theme overrides
   `semantic.*` and/or `component.*` values, e.g. an alternate brand
   palette), the attribute is `data-theme` and the value is `<name>`. This
   is the pre-existing, only previously-supported shape
   (`themes.hyperstructure`, `themes.technical-blueprint` in the
   `drupal-stitch` fixture) and stays byte-identical: neither fixture theme
   sets `$extensions.axis` or `darkMode`, and both override
   `semantic.color`, so both still resolve to rule 4 exactly as they do
   today.

## Adding a New Group

To support a new token area, add a row to `groups:` with a unique kebab-case
key, the dotted token path, the desired CSS prefix, and the block wrap. The
path is a discovery key (see above), so it does not need to match the exact
nesting depth of every consuming project. If no subtree anywhere under the
root axis ends in that path's final segment and carries a leaf token, intake
skips the row — adding rows is safe and non-breaking.

````

### ctx:jsonata-template (blueprint, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook-css-tailwind/a4fea9d7cf8d/blueprints/jsonata-template.md)
````
---
type: jsonata-template
name: tailwind
priority: 10
trigger:
  steps: [generate-jsonata]
filter:
  frameworks.css: tailwind
---

# JSONata Expression Template — Tailwind v4

Template for generating `.jsonata` expressions that transform
`design-tokens.yml` into CSS token files. The expression walks the configured
token subtree **recursively**, flattens nested keys into dash-separated CSS
variable names, skips DTCG metadata (`$value`, `$type`, `$extensions`, …), and
emits `$value` verbatim. `fontFamily` source values must already be CSS-valid
(quoted multi-word names, comma-separated fallbacks); the template does not
post-process them.

The leaf-emit branch has three variants depending on the `CssGroup` flags:

| Variant         | Condition           | Behavior |
|-----------------|---------------------|----------|
| Default         | no `resolve`/`expand` | Emit `--<prefix>-<flat>: <value>;` |
| Var-resolve     | `resolve: var`      | DTCG references → `var(--<prefix>-<flat-ref>)` |
| Typography-expand | `expand: typography` | Composite `$type: typography` → 3 properties (size/weight/line-height) |

## CSS Value Normalization

Emit hexadecimal color literals in lowercase so Stylelint/Prettier accepts the generated CSS. Preserve font-family case. Decimal values must include
a leading zero so formatter/stylelint validation passes:

- `.1` → `0.1`
- `-.25` → `-0.25`

## @config Block

The `@config` block uses paths relative to the `.jsonata` file. Intake chooses the final target directories; the `generate-jsonata` task passes the artifact's relative output path into this template.

```jsonata
/** @config
 {
   "input": "../design-system/design-tokens.yml",
   "output": "<config_output_path>"
 }
 */
```

`<config_output_path>` is the artifact's CSS output path relative to the JSONata
file itself (e.g. `../../css/tokens/color.src.css`).

## Default Expression — Recursive Flatten

Use this template when the group has neither `resolve` nor `expand`. It uses
`$lookup`/`$keys` so hyphenated keys (`max-width`, `padding-y`) and arbitrary
nesting depth work without manual quoting.

```jsonata
(
  $normalizeCssValue := function($val) {
    $type($val) = "string"
      ? $replace($val, /(^|\s|:|,|\()(-?)\.(\d)/, function($m) { $m.groups[0] & $m.groups[1] & "0." & $m.groups[2] })
      : $val
  };
  $walk := function($node, $path) {
    $reduce(
      $keys($node),
      function($acc, $k) {
        $substring($k, 0, 1) != "$" ? (
          $v := $lookup($node, $k);
          $sub := $path = "" ? $k : $path & "-" & $k;
          $exists($v."$value")
            ? $append($acc, "  --<prefix>-" & $sub & ": " & $normalizeCssValue($v."$value") & ";")
            : $append($acc, $walk($v, $sub))
        ) : $acc
      },
      []
    )
  };
  $node := $reduce($split("<path>", "."), function($a, $s) { $lookup($a, $s) }, $$);
  $lines := $walk($node, "");
  $count($lines) > 0
    ? "<wrap> {\n" & $join($lines, "\n") & "\n}\n"
    : ""
)
```

Substitute:
- `<path>` — `CssGroup.path` (e.g. `primitive.color`, `component.section.padding-y`)
- `<prefix>` — `CssGroup.prefix` (e.g. `color`, `layout-spacing`)
- `<wrap>` — `CssGroup.wrap` (e.g. `@theme`)

## Var-Resolution Expression (`resolve: var`)

When the group should re-reference primitives via `var()` instead of expanding
them, replace the leaf-emit branch. The resolver translates the second segment
of the DTCG ref (the primitive type) to its CSS prefix, so refs work even when
the consuming group's prefix differs:

```jsonata
$normalizeCssValue := function($val) {
  $type($val) = "string"
    ? $replace($val, /(^|\s|:|,|\()(-?)\.(\d)/, function($m) { $m.groups[0] & $m.groups[1] & "0." & $m.groups[2] })
    : $val
};
$exists($v."$value") ? (
  $val := $v."$value";
  $resolved := $substring($val, 0, 1) = "{" ? (
    $ref := $replace($replace($val, "{", ""), "}", "");
    $parts := $split($ref, ".");
    $type := $parts[1];
    $primPrefix := $type = "fontFamily" ? "font"
      : $type = "fontSize" ? "text"
      : $type = "fontWeight" ? "font-weight"
      : $type = "lineHeight" ? "leading"
      : $type;
    "var(--" & $primPrefix & "-" & $join($filter($parts, function($p, $i) { $i >= 2 }), "-") & ")"
  ) : $normalizeCssValue($val);
  $append($acc, "  --<prefix>-" & $sub & ": " & $resolved & ";")
)
: $append($acc, $walk($v, $sub))
```

The reference `{primitive.color.blue.900}` becomes `var(--color-blue-900)`
and `{primitive.spacing.6}` becomes `var(--spacing-6)`. The first two segments
are dropped; the second segment selects the primitive layer's prefix
(`color`, `spacing`, `radius`, `text`, `font`, `font-weight`, `leading`).

## Composite Typography Expansion (`expand: typography`)

When the group expands composite `$type: typography` tokens, use a
single-level iteration (composites are flat under the configured path):

Composite sub-values are typically DTCG refs (e.g.
`{primitive.fontSize.xl}`) and must be resolved to `var()` before emission —
unresolved braces produce invalid CSS:

```jsonata
(
  $normalizeCssValue := function($val) {
    $type($val) = "string"
      ? $replace($val, /(^|\s|:|,|\()(-?)\.(\d)/, function($m) { $m.groups[0] & $m.groups[1] & "0." & $m.groups[2] })
      : $val
  };
  $resolve := function($val) {
    $substring($val, 0, 1) = "{" ? (
      $ref := $replace($replace($val, "{", ""), "}", "");
      $parts := $split($ref, ".");
      $type := $parts[1];
      $primPrefix := $type = "fontFamily" ? "font"
        : $type = "fontSize" ? "text"
        : $type = "fontWeight" ? "font-weight"
        : $type = "lineHeight" ? "leading"
        : $type;
      "var(--" & $primPrefix & "-" & $join($filter($parts, function($p, $i) { $i >= 2 }), "-") & ")"
    ) : $normalizeCssValue($val)
  };
  $node := $reduce($split("<path>", "."), function($a, $s) { $lookup($a, $s) }, $$);
  $entries := $each($node, function($v, $k) {
    $substring($k, 0, 1) != "$" and $v."$type" = "typography" ? (
      $val := $v."$value";
      "  --<prefix>-" & $k & ": " & $resolve($val.fontSize) & ";\n" &
      "  --<prefix>-" & $k & "--font-weight: " & $resolve($val.fontWeight) & ";\n" &
      "  --<prefix>-" & $k & "--line-height: " & $resolve($val.lineHeight) & ";"
    )
  });
  $lines := $filter($entries, function($e) { $e != null });
  $count($lines) > 0
    ? "<wrap> {\n" & $join($lines, "\n") & "\n}\n"
    : ""
)
```

The `fontFamily` sub-value is intentionally omitted — it is already covered
by the `primitive-font` group.

## Theme Override Expression Template

For themes declared in the `themes:` section of `design-tokens.yml`, use an
attribute selector instead of `@theme`, emitted **unlayered** (no `@layer`
wrapper). The base group it overrides is produced by Tailwind's own
`@theme static` directive, which compiles to an unlayered `:root,:host{...}`
block — CSS's cascade gives ANY unlayered declaration priority over ANY
layered declaration regardless of selector specificity or source order, so a
layered override can never win against an unlayered base. Emitting the
override unlayered keeps both sides in the same layer relationship, and the
attribute selector then wins on ordinary cascade rules: higher specificity
than `:root,:host`, and later in source order. The input is
the same `design-tokens.yml`; the expression navigates to
`$$.themes.<name>.<resolved_path>`, where `<resolved_path>` is whatever path
the `css-mapping` blueprint's Path Discovery step resolved for this
`(group, theme)` pair (e.g. `semantic.color`, or a nested
`primitive.layout.spacing` on a project that groups its primitives that
way — the override lives under the same depth as the base group it
overrides). The attribute name (`<attr>`) and value (`<attr_value>`) come
from the `css-mapping` blueprint's *Selector attribute derivation* rules
(`data-theme`/`<name>` by default — the pre-existing, only previously
supported shape — `data-mode`/`dark` for dark-mode themes, `data-layout`/
`<name>` for primitive-only density themes, or an explicit
`$extensions.designbook.axis` override). The walk below reuses the same
recursive, depth-agnostic `$walk` helper as the Default Expression so a
nested override subtree flattens exactly the way the base group would.

### Standard Theme

```jsonata
(
  $normalizeCssValue := function($val) {
    $type($val) = "string"
      ? $replace($val, /(^|\s|:|,|\()(-?)\.(\d)/, function($m) { $m.groups[0] & $m.groups[1] & "0." & $m.groups[2] })
      : $val
  };
  $walk := function($node, $path) {
    $reduce(
      $keys($node),
      function($acc, $k) {
        $substring($k, 0, 1) != "$" ? (
          $v := $lookup($node, $k);
          $sub := $path = "" ? $k : $path & "-" & $k;
          $exists($v."$value")
            ? $append($acc, "    --<prefix>-" & $sub & ": " & $normalizeCssValue($v."$value") & ";")
            : $append($acc, $walk($v, $sub))
        ) : $acc
      },
      []
    )
  };
  $node := $reduce($split("<resolved_path>", "."), function($a, $s) { $lookup($a, $s) }, $$.themes."<name>");
  $lines := $walk($node, "");
  $count($lines) > 0
    ? "[<attr>=\"<attr_value>\"] {\n" & $join($lines, "\n") & "\n}\n"
    : ""
)
```

For the pre-existing shape (a `semantic.color` override with no
`$extensions` metadata), `<resolved_path>` is `semantic.color`, `<attr>` is
`data-theme` and `<attr_value>` is `<name>` — this reproduces the previous,
non-generalized expression byte-for-byte.

### Dark Mode Theme

If the theme has `$extensions.darkMode: true`, the derivation rule selects
`<attr> = data-mode` / `<attr_value> = dark`, and the expression outputs
**both** a `prefers-color-scheme` media query and the `data-mode` selector:

```jsonata
(
  $normalizeCssValue := function($val) {
    $type($val) = "string"
      ? $replace($val, /(^|\s|:|,|\()(-?)\.(\d)/, function($m) { $m.groups[0] & $m.groups[1] & "0." & $m.groups[2] })
      : $val
  };
  $walk := function($node, $path) {
    $reduce(
      $keys($node),
      function($acc, $k) {
        $substring($k, 0, 1) != "$" ? (
          $v := $lookup($node, $k);
          $sub := $path = "" ? $k : $path & "-" & $k;
          $exists($v."$value")
            ? $append($acc, "    --<prefix>-" & $sub & ": " & $normalizeCssValue($v."$value") & ";")
            : $append($acc, $walk($v, $sub))
        ) : $acc
      },
      []
    )
  };
  $theme := $$.themes."<name>";
  $node := $reduce($split("<resolved_path>", "."), function($a, $s) { $lookup($a, $s) }, $theme);
  $lines := $walk($node, "");
  $block := $join($lines, "\n");
  $dark := $theme."$extensions".darkMode;
  $darkBlock := $dark ? "@media (prefers-color-scheme: dark) {\n  :root {\n" & $block & "\n  }\n}\n\n" : "";
  $darkBlock & "[<attr>=\"<attr_value>\"] {\n" & $block & "\n}\n"
)
```

Substitute:
- `<name>` — the theme's key under `themes:` (e.g. `cozy`, `dark`, `hyperstructure`).
- `<prefix>` — the base group's `CssGroup.prefix` (unchanged from the group it overrides).
- `<resolved_path>` — the path discovered under `themes.<name>` for this group (see the `css-mapping` blueprint's Path Discovery and Theme / Mode Overrides sections).
- `<attr>` / `<attr_value>` — from the Selector attribute derivation rules.

### @config Block for Theme Expressions

Theme expressions use the same `design-tokens.yml` as input:

```jsonata
/** @config
 {
   "input": "../design-system/design-tokens.yml",
   "output": "<theme_config_output_path>"
 }
 */
```

````

## Steps

### Step: prepare-fonts
Context: [ctx:cli-surface, ctx:css-mapping]

- [x] prepare-fonts — fonts

  Instruction: task:prepare-fonts

  #### Params
  ```yaml
  css_generation_plan:
    framework: tailwind
    mode: refresh
    reasons:
      - BAKERS-56 adds component.list.plain.label-width (96px) and component.list.plain.row-height (32px), fixed component values; generate-component-sizing.jsonata maps component sizing by hand, so it is refreshed to emit --spacing-list-plain-label-width and --spacing-list-plain-row-height (no cozy override), and the token CSS is regenerated.
    paths:
      jsonata_dir: designbook/designbook-css-tailwind
      tokens_dir: css/tokens
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
      index_css_path: css/tokens/index.src.css
    jsonata:
      strategy: refresh
      existing_files:
        - designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
        - designbook/designbook-css-tailwind/generate-color.jsonata
        - designbook/designbook-css-tailwind/generate-component-sizing.jsonata
        - designbook/designbook-css-tailwind/generate-grid.jsonata
        - designbook/designbook-css-tailwind/generate-layout-prose.jsonata
        - designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-layout-width.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-color.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-font.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-text.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
        - designbook/designbook-css-tailwind/generate-typography.jsonata
      artifacts:
        - group: color
          prefix: color
          wrap: '@theme static'
          token_path: semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color.jsonata
          css_path: css/tokens/color.src.css
          config_output_path: ../../css/tokens/color.src.css
        - group: color-theme-dark
          prefix: color
          wrap: '[data-mode="dark"]'
          token_path: themes.dark.semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
          css_path: css/tokens/color-theme-dark.src.css
          config_output_path: ../../css/tokens/color-theme-dark.src.css
          theme: dark
          selector_attr: data-mode
          selector_value: dark
        - group: component-sizing
          prefix: ''
          wrap: '@theme static'
          token_path: component
          jsonata_path: designbook/designbook-css-tailwind/generate-component-sizing.jsonata
          css_path: css/tokens/component-sizing.src.css
          config_output_path: ../../css/tokens/component-sizing.src.css
        - group: grid
          prefix: grid
          wrap: '@theme static'
          token_path: component.grid
          jsonata_path: designbook/designbook-css-tailwind/generate-grid.jsonata
          css_path: css/tokens/grid.src.css
          config_output_path: ../../css/tokens/grid.src.css
        - group: layout-prose
          prefix: container
          wrap: '@theme static'
          token_path: component.prose.max-width
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-prose.jsonata
          css_path: css/tokens/layout-prose.src.css
          config_output_path: ../../css/tokens/layout-prose.src.css
        - group: layout-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
          css_path: css/tokens/layout-spacing.src.css
          config_output_path: ../../css/tokens/layout-spacing.src.css
        - group: layout-width
          prefix: container
          wrap: '@theme static'
          token_path: component.container
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-width.jsonata
          css_path: css/tokens/layout-width.src.css
          config_output_path: ../../css/tokens/layout-width.src.css
        - group: primitive-color
          prefix: color
          wrap: '@theme static'
          token_path: primitive.style.color
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-color.jsonata
          css_path: css/tokens/primitive-color.src.css
          config_output_path: ../../css/tokens/primitive-color.src.css
        - group: primitive-focus-ring
          prefix: focus-ring
          wrap: '@theme static'
          token_path: primitive.style.focusRing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
          css_path: css/tokens/primitive-focus-ring.src.css
          config_output_path: ../../css/tokens/primitive-focus-ring.src.css
        - group: primitive-font
          prefix: font
          wrap: '@theme static'
          token_path: primitive.style.font
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-font.jsonata
          css_path: css/tokens/primitive-font.src.css
          config_output_path: ../../css/tokens/primitive-font.src.css
        - group: primitive-leading
          prefix: leading
          wrap: '@theme static'
          token_path: primitive.style.lineHeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
          css_path: css/tokens/primitive-leading.src.css
          config_output_path: ../../css/tokens/primitive-leading.src.css
        - group: primitive-radius
          prefix: radius
          wrap: '@theme static'
          token_path: primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
          css_path: css/tokens/primitive-radius.src.css
          config_output_path: ../../css/tokens/primitive-radius.src.css
        - group: primitive-radius-theme-cozy
          prefix: radius
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
          css_path: css/tokens/primitive-radius-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-radius-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
          css_path: css/tokens/primitive-spacing.src.css
          config_output_path: ../../css/tokens/primitive-spacing.src.css
        - group: primitive-spacing-theme-cozy
          prefix: spacing
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
          css_path: css/tokens/primitive-spacing-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-spacing-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-text
          prefix: text
          wrap: '@theme static'
          token_path: primitive.style.fontSize
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-text.jsonata
          css_path: css/tokens/primitive-text.src.css
          config_output_path: ../../css/tokens/primitive-text.src.css
        - group: primitive-tracking
          prefix: tracking
          wrap: '@theme static'
          token_path: primitive.style.letterSpacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
          css_path: css/tokens/primitive-tracking.src.css
          config_output_path: ../../css/tokens/primitive-tracking.src.css
        - group: primitive-weight
          prefix: font-weight
          wrap: '@theme static'
          token_path: primitive.style.fontWeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
          css_path: css/tokens/primitive-weight.src.css
          config_output_path: ../../css/tokens/primitive-weight.src.css
        - group: semantic-radius
          prefix: radius
          wrap: '@theme static'
          token_path: semantic.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
          css_path: css/tokens/semantic-radius.src.css
          config_output_path: ../../css/tokens/semantic-radius.src.css
        - group: semantic-shadow
          prefix: shadow
          wrap: '@theme static'
          token_path: semantic.shadow
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
          css_path: css/tokens/semantic-shadow.src.css
          config_output_path: ../../css/tokens/semantic-shadow.src.css
        - group: semantic-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          resolve: var
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
          css_path: css/tokens/semantic-spacing.src.css
          config_output_path: ../../css/tokens/semantic-spacing.src.css
        - group: semantic-transition
          prefix: transition
          wrap: '@theme static'
          token_path: semantic.transition
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
          css_path: css/tokens/semantic-transition.src.css
          config_output_path: ../../css/tokens/semantic-transition.src.css
        - group: typography
          prefix: text
          wrap: '@theme static'
          token_path: semantic.typography
          jsonata_path: designbook/designbook-css-tailwind/generate-typography.jsonata
          css_path: css/tokens/typography.src.css
          config_output_path: ../../css/tokens/typography.src.css
    fonts:
      strategy: reuse
      existing: true
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
  design_tokens:
    primitive:
      layout:
        spacing:
          base:
            $value: 4px
            $type: dimension
          space-1:
            $value: 4px
            $type: dimension
          space-2:
            $value: 8px
            $type: dimension
          space-3:
            $value: 12px
            $type: dimension
          space-4:
            $value: 16px
            $type: dimension
          space-5:
            $value: 20px
            $type: dimension
          space-6:
            $value: 24px
            $type: dimension
          space-8:
            $value: 32px
            $type: dimension
            $description: Space above a section heading.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:118'
                  - '68:135'
        row-h:
          $value: 34px
          $type: dimension
        control-h:
          $value: 28px
          $type: dimension
        line-row-h:
          $value: 56px
          $type: dimension
          $description: A list line row with a one-line title.
          $extensions:
            designbook:
              provenance: addition
              reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
              note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D15): a list line row is 56px for a one-line title at compact density; the reference states the same value for a two-line list row.'
        radius:
          '5':
            $value: 5px
            $type: dimension
          '7':
            $value: 7px
            $type: dimension
          '10':
            $value: 10px
            $type: dimension
      style:
        color:
          flour:
            $value: '#F5EBDA'
            $type: color
          rye:
            $value: '#2B2116'
            $type: color
          butter:
            $value: '#F3CE3A'
            $type: color
          lime:
            $value: '#BFE07A'
            $type: color
          rose:
            $value: '#F4AFC0'
            $type: color
          crust:
            $value: '#B8692E'
            $type: color
          muted:
            $value: '#8A7860'
            $type: color
        fontFamily:
          sans:
            $value: '''Spline Sans'', system-ui, -apple-system, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif'
            $type: fontFamily
            $description: Text face of the CI, observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:8978'
                  - '550:8992'
                  - '550:9016'
                  - '550:9024'
          mono:
            $value: '''Spline Sans Mono'', ui-monospace, ''SF Mono'', Menlo, Consolas, monospace'
            $type: fontFamily
            $description: Machine values only (keys, branches, IDs), observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:9021'
          display:
            $value: '''Bricolage Grotesque'', ''Spline Sans'', system-ui, sans-serif'
            $type: fontFamily
            $description: Page titles only, observed on the CI board at opsz 14.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:8977'
        fontSize:
          '11':
            $value: 11px
            $type: dimension
          '12':
            $value: 12px
            $type: dimension
          '13':
            $value: 13px
            $type: dimension
          '14':
            $value: 14px
            $type: dimension
            $description: Item title size.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:60'
                  - '550:9024'
          '16':
            $value: 16px
            $type: dimension
          '24':
            $value: 24px
            $type: dimension
          '40':
            $value: 40px
            $type: dimension
            $description: Addition (BAKERS-116, reference-free, agreed with the owner). Size of the gate slogan headline.
        fontWeight:
          regular:
            $value: 400
            $type: fontWeight
          medium:
            $value: 500
            $type: fontWeight
          semibold:
            $value: 600
            $type: fontWeight
          bold:
            $value: 700
            $type: fontWeight
        lineHeight:
          '14':
            $value: 14px
            $type: dimension
            $description: Whole-pixel line height 14px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:81'
                  - '68:84'
          '16':
            $value: 16px
            $type: dimension
            $description: Whole-pixel line height 16px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:72'
                  - '68:75'
                  - '68:78'
          '20':
            $value: 20px
            $type: dimension
            $description: Whole-pixel line height 20px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:60'
                  - '68:63'
                  - '68:66'
          '21':
            $value: 21px
            $type: dimension
            $description: Whole-pixel line height 21px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:69'
          '22':
            $value: 22px
            $type: dimension
            $description: Whole-pixel line height 22px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:57'
          '28':
            $value: 28px
            $type: dimension
            $description: Whole-pixel line height 28px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:87'
          '30':
            $value: 30px
            $type: dimension
            $description: Whole-pixel line height 30px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:54'
          '44':
            $value: 44px
            $type: dimension
            $description: Addition (BAKERS-116, reference-free, agreed with the owner). Line height of the gate slogan headline.
          tight:
            $value: 1.2
            $type: number
          snug:
            $value: 1.3
            $type: number
          relaxed:
            $value: 1.5
            $type: number
          normal:
            $value: 1.45
            $type: number
        elevation:
          '1':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 4px
              spread: 0px
              opacity: 0.06
            $type: shadow
          '2':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 12px
              spread: 0px
              opacity: 0.1
            $type: shadow
          '3':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 24px
              spread: 0px
              opacity: 0.14
            $type: shadow
        lineWeight:
          hairline:
            $value: 1px
            $type: dimension
          emphasis:
            $value: 2px
            $type: dimension
        duration:
          '120':
            $value: 120ms
            $type: duration
          '200':
            $value: 200ms
            $type: duration
        focusRing:
          width:
            $value: 2px
            $type: dimension
          color:
            $value: '{primitive.style.color.rye}'
            $type: color
          offset:
            $value: 2px
            $type: dimension
            $description: Gap between a control and its focus ring.
            $extensions:
              designbook:
                provenance: addition
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '61:3240'
                note: Observed as the focus-keyboard interaction (2px ring, 2px gap); the tokens package does not project interactions.
        letterSpacing:
          tight:
            $value: '-0.01em'
            $type: dimension
            $description: Page title tracking (-1 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:54'
                  - '550:8977'
                note: Figma -1 % at 24px = -0.24px.
          snug:
            $value: '-0.005em'
            $type: dimension
            $description: Section title tracking (-0.5 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:57'
                  - '550:9016'
                note: Figma -0.5 % at 16px = -0.08px.
          wide:
            $value: 0.04em
            $type: dimension
            $description: Eyebrow tracking (4 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:81'
                note: Figma 4 % at 11px.
    semantic:
      color:
        app:
          $value: '#F7F2E8'
          $type: color
        surface:
          $value: '#FFFDF8'
          $type: color
        surface-2:
          $value: '#F0E9DC'
          $type: color
        surface-3:
          $value: '#E6DDCD'
          $type: color
        input:
          $value: '#FFFDF8'
          $type: color
        canvas:
          $value: '#F0E9DC'
          $type: color
        text:
          $value: '{primitive.style.color.rye}'
          $type: color
        text-light:
          $value: '#63584A'
          $type: color
        text-faint:
          $value: '#63584A'
          $type: color
        title:
          $value: '{primitive.style.color.rye}'
          $type: color
        primary:
          $value: '{primitive.style.color.rye}'
          $type: color
        chart-series-a:
          $value: '{primitive.style.color.crust}'
          $type: color
          $description: First comparison series (solid / circle).
        chart-series-b:
          $value: '#718F39'
          $type: color
          $description: Second comparison series (dashed / square).
        chart-series-c:
          $value: '#A28317'
          $type: color
          $description: Third comparison series (dotted / circle).
        chart-series-d:
          $value: '#DE5779'
          $type: color
          $description: Fourth comparison series (dash-dot / square).
        chart-series-e:
          $value: '#C8432F'
          $type: color
          $description: Fifth comparison series (sparse-dot / circle).
        chart-series-f:
          $value: '#6E5D49'
          $type: color
          $description: Sixth comparison series (even-dash / square).
        chart-flow-new:
          $value: '{primitive.style.color.crust}'
          $type: color
          $description: Flow chart "new" line, points and end label. Observed as chart-series-a (#494fe5) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24.
        chart-flow-done:
          $value: '#718F39'
          $type: color
          $description: Flow chart "done" line, points and end label. Observed as the Figma proposal chart-outflow (#0d9488) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24; teal-600 is the closest existing primitive, so no new primitive is added.
        chart-flow-grows:
          $value: '#F8D9D0'
          $type: color
          $description: Flow chart fill where new exceeds done (backlog grows). Observed as the state-unassigned-tint colour.
        chart-flow-shrinks:
          $value: '#E8F1D6'
          $type: color
          $description: Flow chart fill where done exceeds new (backlog shrinks). Observed as the state-running-tint colour.
        control-border:
          $value: '#857A68'
          $type: color
        on-primary:
          $value: '#FFFFFF'
          $type: color
        border:
          $value: '#E0D6C4'
          $type: color
        border-2:
          $value: '#EDE6D8'
          $type: color
        link:
          $value: '{primitive.style.color.rye}'
          $type: color
        focus-ring:
          $value: '{primitive.style.focusRing.color}'
          $type: color
        state-unassigned:
          $value: '#C8432F'
          $type: color
        state-attention:
          $value: '{primitive.style.color.butter}'
          $type: color
        state-running:
          $value: '{primitive.style.color.muted}'
          $type: color
        state-lease:
          $value: '{primitive.style.color.crust}'
          $type: color
        state-offline:
          $value: '{primitive.style.color.muted}'
          $type: color
        type-feature:
          $value: '#718F39'
          $type: color
        type-bug:
          $value: '#C8432F'
          $type: color
        type-chore:
          $value: '{primitive.style.color.crust}'
          $type: color
        state-unassigned-tint:
          $value: '#F8D9D0'
          $type: color
        state-attention-tint:
          $value: '#FCEFC0'
          $type: color
        state-running-tint:
          $value: '#EFE9DE'
          $type: color
        state-lease-tint:
          $value: '#F3E4D7'
          $type: color
        state-offline-tint:
          $value: '#ECE6DA'
          $type: color
        state-unassigned-ink:
          $value: '#8A2A1B'
          $type: color
        state-attention-ink:
          $value: '#5A4500'
          $type: color
        state-running-ink:
          $value: '#3D3224'
          $type: color
        state-lease-ink:
          $value: '#6B3A14'
          $type: color
        state-ink:
          $value: '{primitive.style.color.rye}'
          $type: color
          $description: Ink for text placed on a state fill (state-attention, state-review, state-done, avatar-*). Every pair reaches 4.5:1 in both modes.
        state-attention-mark:
          $type: color
          $value: '#8F6B00'
          $description: Dot, line or border that says "waits for you" on a light surface, where butter itself is too light.
        state-offline-ink:
          $type: color
          $value: '#4A3E30'
          $description: Text on state-offline-tint.
        state-review:
          $type: color
          $value: '{primitive.style.color.rose}'
          $description: Fill of the review state.
        state-done:
          $type: color
          $value: '{primitive.style.color.lime}'
          $description: Fill of the done state.
        avatar-a:
          $type: color
          $value: '{primitive.style.color.rose}'
          $description: Avatar initials fill behind state-ink text.
        avatar-b:
          $type: color
          $value: '#CFE69A'
          $description: Avatar initials fill behind state-ink text.
        avatar-c:
          $type: color
          $value: '#EAC6A4'
          $description: Avatar initials fill behind state-ink text.
        avatar-d:
          $type: color
          $value: '#D9D3C9'
          $description: Avatar initials fill behind state-ink text.
        gate-band:
          $type: color
          $value: '{primitive.style.color.butter}'
          $description: Addition (BAKERS-116, sketch direction A, owner exception to the butter rule on gate pages only). The brand field beside every gate form; the same in light and dark mode.
        gate-band-ink:
          $type: color
          $value: '{primitive.style.color.rye}'
          $description: Addition (BAKERS-116). Text on the gate band, rye in both modes.
      typography:
        page-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.30}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Page title.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:54'
                - '550:8977'
        section-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.16}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.22}'
            letterSpacing: '{primitive.style.letterSpacing.snug}'
          $type: typography
          $description: Section heading.
          $extensions:
            designbook:
              provenance: addition
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:57'
                - '550:9016'
              note: 'Intake decision 2026-11-07: bold instead of the observed semibold, as the spec table sets it (AC-3).'
        item-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.14}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Title of a list row or card.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:60'
                - '550:9024'
        body-strong:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Emphasised body text, such as a person's name.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:63'
        body:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Default text, also for otherwise unstyled text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:66'
        prose:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.21}'
          $type: typography
          $description: Running text, at most the prose width.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:69'
        label:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Field and property label; regular, so a label is never heavier than its value.
          $extensions:
            designbook:
              provenance: addition
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:72'
                - '550:8992'
              note: 'Intake decision 2026-11-07: regular instead of the observed medium (spec ed3f030b, AC-2).'
        meta:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Secondary information such as times and counts.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:75'
                - '550:8978'
                - '550:9011'
        data:
          $value:
            fontFamily: '{primitive.style.fontFamily.mono}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: 'Machine values: keys, branches, IDs.'
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:78'
                - '550:9021'
        eyebrow:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
            letterSpacing: '{primitive.style.letterSpacing.wide}'
          $type: typography
          $description: Uppercase group label above content.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:81'
        badge:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
          $type: typography
          $description: Badge and pill text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:84'
        stat-value:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.28}'
          $type: typography
          $description: Large statistic value.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:87'
        gate-headline:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.40}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.44}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Addition (BAKERS-116, reference-free, agreed with the owner). The slogan on the gate's butter band, the largest text on the gate.
      fontWeight:
        regular:
          $value: '{primitive.style.fontWeight.regular}'
          $type: fontWeight
        medium:
          $value: '{primitive.style.fontWeight.medium}'
          $type: fontWeight
        semibold:
          $value: '{primitive.style.fontWeight.semibold}'
          $type: fontWeight
        bold:
          $value: '{primitive.style.fontWeight.bold}'
          $type: fontWeight
      lineHeight:
        tight:
          $value: '{primitive.style.lineHeight.tight}'
          $type: number
        snug:
          $value: '{primitive.style.lineHeight.snug}'
          $type: number
        relaxed:
          $value: '{primitive.style.lineHeight.relaxed}'
          $type: number
        normal:
          $value: '{primitive.style.lineHeight.normal}'
          $type: number
      radius:
        xs:
          $value: '{primitive.layout.radius.5}'
          $type: dimension
        sm:
          $value: '{primitive.layout.radius.7}'
          $type: dimension
        md:
          $value: '{primitive.layout.radius.10}'
          $type: dimension
      shadow:
        shadow-1:
          $value: '{primitive.style.elevation.1}'
          $type: shadow
        shadow-2:
          $value: '{primitive.style.elevation.2}'
          $type: shadow
        shadow-3:
          $value: '{primitive.style.elevation.3}'
          $type: shadow
      transition:
        fast:
          $value: '{primitive.style.duration.120}'
          $type: duration
        base:
          $value: '{primitive.style.duration.200}'
          $type: duration
      spacing:
        inline-xs:
          $value: '{primitive.layout.spacing.space-1}'
          $type: dimension
          $description: Icon to text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:98'
                - '68:99'
        inline:
          $value: '{primitive.layout.spacing.space-2}'
          $type: dimension
          $description: Pills and buttons side by side.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:102'
                - '68:103'
        stack:
          $value: '{primitive.layout.spacing.space-3}'
          $type: dimension
          $description: Label to control, row content, below a heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:106'
                - '68:107'
                - '68:137'
        group:
          $value: '{primitive.layout.spacing.space-4}'
          $type: dimension
          $description: Field groups and card padding.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:110'
                - '68:111'
        gutter:
          $value: '{primitive.layout.spacing.space-6}'
          $type: dimension
          $description: Page edge from 1280px.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:114'
                - '68:115'
        section:
          $value: '{primitive.layout.spacing.space-8}'
          $type: dimension
          $description: Above a section heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:118'
                - '68:119'
                - '68:135'
    component:
      empty-state:
        icon:
          $value: 64px
          $type: dimension
          $description: Regular state illustration size, independent of layout density.
        compact-icon:
          $value: 24px
          $type: dimension
          $description: Compact state illustration size, independent of layout density.
      shell:
        offset:
          $value: var(--drupal-displace-offset-top, 0px)
          $type: dimension
        height:
          $value: calc(100dvh - var(--drupal-displace-offset-top, 0px))
          $type: dimension
      section:
        padding-y:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      grid:
        gap:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      container:
        max-width:
          $value: 1280px
          $type: dimension
      row:
        height:
          $value: '{primitive.layout.row-h}'
          $type: dimension
      control:
        height:
          $value: '{primitive.layout.control-h}'
          $type: dimension
      list:
        row:
          height:
            $value: '{primitive.layout.line-row-h}'
            $type: dimension
            $description: Minimum height of a list line row.
        plain:
          label-width:
            $value: 96px
            $type: dimension
            $description: Label column of a block's property rows (`list` layout `plain`).
            $extensions:
              designbook:
                provenance: addition
                reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
                note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D18); the reference''s ticket-detail note states 96 px labels. Fixed: cozy density is outside BAKERS-56.'
          row-height:
            $value: 32px
            $type: dimension
            $description: Minimum height of a block's property row (`list` layout `plain`).
            $extensions:
              designbook:
                provenance: addition
                reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
                note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D18); the reference''s ticket-detail note states 32 px rows. Fixed: cozy density is outside BAKERS-56.'
      brand:
        compact:
          width:
            $value: 200px
            $type: dimension
            $description: 'Width of the logo with wordmark at the top of the gate''s butter band (BAKERS-116, sketch direction A); its height follows the SVG aspect ratio. Fixed: it does not follow the layout density.'
      zone:
        gap:
          sm:
            $value: '{primitive.layout.spacing.space-3}'
            $type: dimension
            $description: 'Zone cell gap `sm`: the space-3 step (12px, 16px cozy).'
          md:
            $value: '{primitive.layout.spacing.space-5}'
            $type: dimension
            $description: 'Zone cell gap `md`, the default: the space-5 step (20px, 24px cozy).'
          lg:
            $value: '{primitive.layout.spacing.space-6}'
            $type: dimension
            $description: 'Zone cell gap `lg`: the space-6 step (24px, 32px cozy).'
      prose:
        max-width:
          $value: 620px
          $type: dimension
          $description: Maximum width of running text (72ch).
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:152'
    themes:
      cozy:
        primitive:
          layout:
            spacing:
              base:
                $value: 6px
                $type: dimension
              space-1:
                $value: 8px
                $type: dimension
              space-2:
                $value: 12px
                $type: dimension
              space-3:
                $value: 16px
                $type: dimension
              space-4:
                $value: 20px
                $type: dimension
              space-5:
                $value: 24px
                $type: dimension
              space-6:
                $value: 32px
                $type: dimension
              space-8:
                $value: 40px
                $type: dimension
                $description: Cozy step after 32px.
                $extensions:
                  designbook:
                    provenance: addition
                    reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                    note: 'Intake decision 2026-11-04: continues the cozy scale 24, 32, 40.'
            row-h:
              $value: 40px
              $type: dimension
            control-h:
              $value: 36px
              $type: dimension
            line-row-h:
              $value: 64px
              $type: dimension
              $description: Cozy list line row.
              $extensions:
                designbook:
                  provenance: addition
                  note: 'Intake decision 2026-11-11: cozy density is outside BAKERS-56; +8px like control-h (28 to 36) keeps the cozy inset and a 24px avatar meta line inside the row.'
            radius:
              '5':
                $value: 5px
                $type: dimension
              '7':
                $value: 7px
                $type: dimension
              '10':
                $value: 10px
                $type: dimension
      dark:
        $extensions:
          darkMode: true
        semantic:
          color:
            app:
              $value: '#17120B'
              $type: color
            surface:
              $value: '#221A11'
              $type: color
            surface-2:
              $value: '{primitive.style.color.rye}'
              $type: color
            surface-3:
              $value: '#3A2E20'
              $type: color
            input:
              $value: '#1D160E'
              $type: color
            canvas:
              $value: '#17120B'
              $type: color
            text:
              $value: '{primitive.style.color.flour}'
              $type: color
            text-light:
              $value: '#BCA98D'
              $type: color
            text-faint:
              $value: '#BCA98D'
              $type: color
            title:
              $value: '#FBF5EA'
              $type: color
            primary:
              $value: '{primitive.style.color.butter}'
              $type: color
            chart-series-a:
              $value: '#D28A50'
              $type: color
              $description: First comparison series (solid / circle).
            chart-series-b:
              $value: '{primitive.style.color.lime}'
              $type: color
              $description: Second comparison series (dashed / square).
            chart-series-c:
              $value: '{primitive.style.color.butter}'
              $type: color
              $description: Third comparison series (dotted / circle).
            chart-series-d:
              $value: '{primitive.style.color.rose}'
              $type: color
              $description: Fourth comparison series (dash-dot / square).
            chart-series-e:
              $value: '#E8644E'
              $type: color
              $description: Fifth comparison series (sparse-dot / circle).
            chart-series-f:
              $value: '#A8977E'
              $type: color
              $description: Sixth comparison series (even-dash / square).
            chart-flow-new:
              $value: '#D28A50'
              $type: color
              $description: Flow chart "new" line in dark mode (chart-series-a step).
            chart-flow-done:
              $value: '{primitive.style.color.lime}'
              $type: color
              $description: 'Flow chart "done" line in dark mode. Addition: the reference shows light mode only; teal-400 mirrors chart-series-b''s dark step.'
            chart-flow-grows:
              $value: '#4E2018'
              $type: color
              $description: Flow chart "backlog grows" fill in dark mode (state-unassigned-tint step).
            chart-flow-shrinks:
              $value: '#2F3A1A'
              $type: color
              $description: Flow chart "backlog shrinks" fill in dark mode (state-running-tint step).
            control-border:
              $value: '#8E7B62'
              $type: color
            on-primary:
              $value: '{primitive.style.color.rye}'
              $type: color
            border:
              $value: '#45372A'
              $type: color
            border-2:
              $value: '#33281C'
              $type: color
            link:
              $value: '{primitive.style.color.butter}'
              $type: color
            focus-ring:
              $value: '{primitive.style.color.butter}'
              $type: color
            state-unassigned-tint:
              $value: '#4E2018'
              $type: color
            state-attention-tint:
              $value: '#4A3B10'
              $type: color
            state-running-tint:
              $value: '#3A2E20'
              $type: color
            state-lease-tint:
              $value: '#4A2E18'
              $type: color
            state-offline-tint:
              $value: '#33281C'
              $type: color
            state-unassigned-ink:
              $value: '#F6B8A8'
              $type: color
            state-attention-ink:
              $value: '#F8DE7A'
              $type: color
            state-running-ink:
              $value: '#E3D6C1'
              $type: color
            state-lease-ink:
              $value: '#F2C49C'
              $type: color
            state-attention:
              $type: color
              $value: '{primitive.style.color.butter}'
            state-attention-mark:
              $type: color
              $value: '{primitive.style.color.butter}'
              $description: Dot, line or border that says "waits for you" on a light surface, where butter itself is too light.
            state-running:
              $type: color
              $value: '#A8977E'
            state-unassigned:
              $type: color
              $value: '#E8644E'
            state-lease:
              $type: color
              $value: '#D28A50'
            state-offline:
              $type: color
              $value: '#8E7B62'
            state-offline-ink:
              $type: color
              $value: '#CDBFA9'
              $description: Text on state-offline-tint.
            state-ink:
              $type: color
              $value: '#17120B'
              $description: Ink for text placed on a state fill (state-attention, state-review, state-done, avatar-*). Every pair reaches 4.5:1 in both modes.
            state-review:
              $type: color
              $value: '{primitive.style.color.rose}'
              $description: Fill of the review state.
            state-done:
              $type: color
              $value: '{primitive.style.color.lime}'
              $description: Fill of the done state.
            type-feature:
              $type: color
              $value: '{primitive.style.color.lime}'
            type-bug:
              $type: color
              $value: '#E8644E'
            type-chore:
              $type: color
              $value: '#D28A50'
            avatar-a:
              $type: color
              $value: '{primitive.style.color.rose}'
              $description: Avatar initials fill behind state-ink text.
            avatar-b:
              $type: color
              $value: '{primitive.style.color.lime}'
              $description: Avatar initials fill behind state-ink text.
            avatar-c:
              $type: color
              $value: '#E3B48A'
              $description: Avatar initials fill behind state-ink text.
            avatar-d:
              $type: color
              $value: '#BCB3A6'
              $description: Avatar initials fill behind state-ink text.
        primitive:
          style:
            elevation:
              '1':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 4px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '2':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 12px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '3':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 24px
                  spread: 0px
                  opacity: 0
                $type: shadow
  ```

  #### Contract
  ```yaml
  outputs:
    google-fonts-css:
      required: true
      schema:
        $ref: '#/definitions/GoogleFontsCss'
      submission: data
      validators: []
      path: css/tokens/google-fonts.src.css
  ```

  #### Results
  <!-- done -->

### Step: generate-jsonata
Context: [ctx:cli-surface, ctx:jsonata-template, ctx:css-mapping]

- [x] generate-jsonata — component-sizing

  Instruction: task:generate-jsonata

  #### Params
  ```yaml
  artifact:
    group: component-sizing
    prefix: ''
    wrap: '@theme static'
    token_path: component
    jsonata_path: designbook/designbook-css-tailwind/generate-component-sizing.jsonata
    css_path: css/tokens/component-sizing.src.css
    config_output_path: ../../css/tokens/component-sizing.src.css
  css_generation_plan:
    framework: tailwind
    mode: refresh
    reasons:
      - BAKERS-56 adds component.list.plain.label-width (96px) and component.list.plain.row-height (32px), fixed component values; generate-component-sizing.jsonata maps component sizing by hand, so it is refreshed to emit --spacing-list-plain-label-width and --spacing-list-plain-row-height (no cozy override), and the token CSS is regenerated.
    paths:
      jsonata_dir: designbook/designbook-css-tailwind
      tokens_dir: css/tokens
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
      index_css_path: css/tokens/index.src.css
    jsonata:
      strategy: refresh
      existing_files:
        - designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
        - designbook/designbook-css-tailwind/generate-color.jsonata
        - designbook/designbook-css-tailwind/generate-component-sizing.jsonata
        - designbook/designbook-css-tailwind/generate-grid.jsonata
        - designbook/designbook-css-tailwind/generate-layout-prose.jsonata
        - designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-layout-width.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-color.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-font.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-text.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
        - designbook/designbook-css-tailwind/generate-typography.jsonata
      artifacts:
        - group: color
          prefix: color
          wrap: '@theme static'
          token_path: semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color.jsonata
          css_path: css/tokens/color.src.css
          config_output_path: ../../css/tokens/color.src.css
        - group: color-theme-dark
          prefix: color
          wrap: '[data-mode="dark"]'
          token_path: themes.dark.semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
          css_path: css/tokens/color-theme-dark.src.css
          config_output_path: ../../css/tokens/color-theme-dark.src.css
          theme: dark
          selector_attr: data-mode
          selector_value: dark
        - group: component-sizing
          prefix: ''
          wrap: '@theme static'
          token_path: component
          jsonata_path: designbook/designbook-css-tailwind/generate-component-sizing.jsonata
          css_path: css/tokens/component-sizing.src.css
          config_output_path: ../../css/tokens/component-sizing.src.css
        - group: grid
          prefix: grid
          wrap: '@theme static'
          token_path: component.grid
          jsonata_path: designbook/designbook-css-tailwind/generate-grid.jsonata
          css_path: css/tokens/grid.src.css
          config_output_path: ../../css/tokens/grid.src.css
        - group: layout-prose
          prefix: container
          wrap: '@theme static'
          token_path: component.prose.max-width
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-prose.jsonata
          css_path: css/tokens/layout-prose.src.css
          config_output_path: ../../css/tokens/layout-prose.src.css
        - group: layout-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
          css_path: css/tokens/layout-spacing.src.css
          config_output_path: ../../css/tokens/layout-spacing.src.css
        - group: layout-width
          prefix: container
          wrap: '@theme static'
          token_path: component.container
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-width.jsonata
          css_path: css/tokens/layout-width.src.css
          config_output_path: ../../css/tokens/layout-width.src.css
        - group: primitive-color
          prefix: color
          wrap: '@theme static'
          token_path: primitive.style.color
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-color.jsonata
          css_path: css/tokens/primitive-color.src.css
          config_output_path: ../../css/tokens/primitive-color.src.css
        - group: primitive-focus-ring
          prefix: focus-ring
          wrap: '@theme static'
          token_path: primitive.style.focusRing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
          css_path: css/tokens/primitive-focus-ring.src.css
          config_output_path: ../../css/tokens/primitive-focus-ring.src.css
        - group: primitive-font
          prefix: font
          wrap: '@theme static'
          token_path: primitive.style.font
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-font.jsonata
          css_path: css/tokens/primitive-font.src.css
          config_output_path: ../../css/tokens/primitive-font.src.css
        - group: primitive-leading
          prefix: leading
          wrap: '@theme static'
          token_path: primitive.style.lineHeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
          css_path: css/tokens/primitive-leading.src.css
          config_output_path: ../../css/tokens/primitive-leading.src.css
        - group: primitive-radius
          prefix: radius
          wrap: '@theme static'
          token_path: primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
          css_path: css/tokens/primitive-radius.src.css
          config_output_path: ../../css/tokens/primitive-radius.src.css
        - group: primitive-radius-theme-cozy
          prefix: radius
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
          css_path: css/tokens/primitive-radius-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-radius-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
          css_path: css/tokens/primitive-spacing.src.css
          config_output_path: ../../css/tokens/primitive-spacing.src.css
        - group: primitive-spacing-theme-cozy
          prefix: spacing
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
          css_path: css/tokens/primitive-spacing-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-spacing-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-text
          prefix: text
          wrap: '@theme static'
          token_path: primitive.style.fontSize
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-text.jsonata
          css_path: css/tokens/primitive-text.src.css
          config_output_path: ../../css/tokens/primitive-text.src.css
        - group: primitive-tracking
          prefix: tracking
          wrap: '@theme static'
          token_path: primitive.style.letterSpacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
          css_path: css/tokens/primitive-tracking.src.css
          config_output_path: ../../css/tokens/primitive-tracking.src.css
        - group: primitive-weight
          prefix: font-weight
          wrap: '@theme static'
          token_path: primitive.style.fontWeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
          css_path: css/tokens/primitive-weight.src.css
          config_output_path: ../../css/tokens/primitive-weight.src.css
        - group: semantic-radius
          prefix: radius
          wrap: '@theme static'
          token_path: semantic.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
          css_path: css/tokens/semantic-radius.src.css
          config_output_path: ../../css/tokens/semantic-radius.src.css
        - group: semantic-shadow
          prefix: shadow
          wrap: '@theme static'
          token_path: semantic.shadow
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
          css_path: css/tokens/semantic-shadow.src.css
          config_output_path: ../../css/tokens/semantic-shadow.src.css
        - group: semantic-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          resolve: var
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
          css_path: css/tokens/semantic-spacing.src.css
          config_output_path: ../../css/tokens/semantic-spacing.src.css
        - group: semantic-transition
          prefix: transition
          wrap: '@theme static'
          token_path: semantic.transition
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
          css_path: css/tokens/semantic-transition.src.css
          config_output_path: ../../css/tokens/semantic-transition.src.css
        - group: typography
          prefix: text
          wrap: '@theme static'
          token_path: semantic.typography
          jsonata_path: designbook/designbook-css-tailwind/generate-typography.jsonata
          css_path: css/tokens/typography.src.css
          config_output_path: ../../css/tokens/typography.src.css
    fonts:
      strategy: reuse
      existing: true
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
  design_tokens:
    primitive:
      layout:
        spacing:
          base:
            $value: 4px
            $type: dimension
          space-1:
            $value: 4px
            $type: dimension
          space-2:
            $value: 8px
            $type: dimension
          space-3:
            $value: 12px
            $type: dimension
          space-4:
            $value: 16px
            $type: dimension
          space-5:
            $value: 20px
            $type: dimension
          space-6:
            $value: 24px
            $type: dimension
          space-8:
            $value: 32px
            $type: dimension
            $description: Space above a section heading.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:118'
                  - '68:135'
        row-h:
          $value: 34px
          $type: dimension
        control-h:
          $value: 28px
          $type: dimension
        line-row-h:
          $value: 56px
          $type: dimension
          $description: A list line row with a one-line title.
          $extensions:
            designbook:
              provenance: addition
              reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
              note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D15): a list line row is 56px for a one-line title at compact density; the reference states the same value for a two-line list row.'
        radius:
          '5':
            $value: 5px
            $type: dimension
          '7':
            $value: 7px
            $type: dimension
          '10':
            $value: 10px
            $type: dimension
      style:
        color:
          flour:
            $value: '#F5EBDA'
            $type: color
          rye:
            $value: '#2B2116'
            $type: color
          butter:
            $value: '#F3CE3A'
            $type: color
          lime:
            $value: '#BFE07A'
            $type: color
          rose:
            $value: '#F4AFC0'
            $type: color
          crust:
            $value: '#B8692E'
            $type: color
          muted:
            $value: '#8A7860'
            $type: color
        fontFamily:
          sans:
            $value: '''Spline Sans'', system-ui, -apple-system, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif'
            $type: fontFamily
            $description: Text face of the CI, observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:8978'
                  - '550:8992'
                  - '550:9016'
                  - '550:9024'
          mono:
            $value: '''Spline Sans Mono'', ui-monospace, ''SF Mono'', Menlo, Consolas, monospace'
            $type: fontFamily
            $description: Machine values only (keys, branches, IDs), observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:9021'
          display:
            $value: '''Bricolage Grotesque'', ''Spline Sans'', system-ui, sans-serif'
            $type: fontFamily
            $description: Page titles only, observed on the CI board at opsz 14.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:8977'
        fontSize:
          '11':
            $value: 11px
            $type: dimension
          '12':
            $value: 12px
            $type: dimension
          '13':
            $value: 13px
            $type: dimension
          '14':
            $value: 14px
            $type: dimension
            $description: Item title size.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:60'
                  - '550:9024'
          '16':
            $value: 16px
            $type: dimension
          '24':
            $value: 24px
            $type: dimension
          '40':
            $value: 40px
            $type: dimension
            $description: Addition (BAKERS-116, reference-free, agreed with the owner). Size of the gate slogan headline.
        fontWeight:
          regular:
            $value: 400
            $type: fontWeight
          medium:
            $value: 500
            $type: fontWeight
          semibold:
            $value: 600
            $type: fontWeight
          bold:
            $value: 700
            $type: fontWeight
        lineHeight:
          '14':
            $value: 14px
            $type: dimension
            $description: Whole-pixel line height 14px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:81'
                  - '68:84'
          '16':
            $value: 16px
            $type: dimension
            $description: Whole-pixel line height 16px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:72'
                  - '68:75'
                  - '68:78'
          '20':
            $value: 20px
            $type: dimension
            $description: Whole-pixel line height 20px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:60'
                  - '68:63'
                  - '68:66'
          '21':
            $value: 21px
            $type: dimension
            $description: Whole-pixel line height 21px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:69'
          '22':
            $value: 22px
            $type: dimension
            $description: Whole-pixel line height 22px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:57'
          '28':
            $value: 28px
            $type: dimension
            $description: Whole-pixel line height 28px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:87'
          '30':
            $value: 30px
            $type: dimension
            $description: Whole-pixel line height 30px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:54'
          '44':
            $value: 44px
            $type: dimension
            $description: Addition (BAKERS-116, reference-free, agreed with the owner). Line height of the gate slogan headline.
          tight:
            $value: 1.2
            $type: number
          snug:
            $value: 1.3
            $type: number
          relaxed:
            $value: 1.5
            $type: number
          normal:
            $value: 1.45
            $type: number
        elevation:
          '1':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 4px
              spread: 0px
              opacity: 0.06
            $type: shadow
          '2':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 12px
              spread: 0px
              opacity: 0.1
            $type: shadow
          '3':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 24px
              spread: 0px
              opacity: 0.14
            $type: shadow
        lineWeight:
          hairline:
            $value: 1px
            $type: dimension
          emphasis:
            $value: 2px
            $type: dimension
        duration:
          '120':
            $value: 120ms
            $type: duration
          '200':
            $value: 200ms
            $type: duration
        focusRing:
          width:
            $value: 2px
            $type: dimension
          color:
            $value: '{primitive.style.color.rye}'
            $type: color
          offset:
            $value: 2px
            $type: dimension
            $description: Gap between a control and its focus ring.
            $extensions:
              designbook:
                provenance: addition
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '61:3240'
                note: Observed as the focus-keyboard interaction (2px ring, 2px gap); the tokens package does not project interactions.
        letterSpacing:
          tight:
            $value: '-0.01em'
            $type: dimension
            $description: Page title tracking (-1 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:54'
                  - '550:8977'
                note: Figma -1 % at 24px = -0.24px.
          snug:
            $value: '-0.005em'
            $type: dimension
            $description: Section title tracking (-0.5 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:57'
                  - '550:9016'
                note: Figma -0.5 % at 16px = -0.08px.
          wide:
            $value: 0.04em
            $type: dimension
            $description: Eyebrow tracking (4 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:81'
                note: Figma 4 % at 11px.
    semantic:
      color:
        app:
          $value: '#F7F2E8'
          $type: color
        surface:
          $value: '#FFFDF8'
          $type: color
        surface-2:
          $value: '#F0E9DC'
          $type: color
        surface-3:
          $value: '#E6DDCD'
          $type: color
        input:
          $value: '#FFFDF8'
          $type: color
        canvas:
          $value: '#F0E9DC'
          $type: color
        text:
          $value: '{primitive.style.color.rye}'
          $type: color
        text-light:
          $value: '#63584A'
          $type: color
        text-faint:
          $value: '#63584A'
          $type: color
        title:
          $value: '{primitive.style.color.rye}'
          $type: color
        primary:
          $value: '{primitive.style.color.rye}'
          $type: color
        chart-series-a:
          $value: '{primitive.style.color.crust}'
          $type: color
          $description: First comparison series (solid / circle).
        chart-series-b:
          $value: '#718F39'
          $type: color
          $description: Second comparison series (dashed / square).
        chart-series-c:
          $value: '#A28317'
          $type: color
          $description: Third comparison series (dotted / circle).
        chart-series-d:
          $value: '#DE5779'
          $type: color
          $description: Fourth comparison series (dash-dot / square).
        chart-series-e:
          $value: '#C8432F'
          $type: color
          $description: Fifth comparison series (sparse-dot / circle).
        chart-series-f:
          $value: '#6E5D49'
          $type: color
          $description: Sixth comparison series (even-dash / square).
        chart-flow-new:
          $value: '{primitive.style.color.crust}'
          $type: color
          $description: Flow chart "new" line, points and end label. Observed as chart-series-a (#494fe5) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24.
        chart-flow-done:
          $value: '#718F39'
          $type: color
          $description: Flow chart "done" line, points and end label. Observed as the Figma proposal chart-outflow (#0d9488) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24; teal-600 is the closest existing primitive, so no new primitive is added.
        chart-flow-grows:
          $value: '#F8D9D0'
          $type: color
          $description: Flow chart fill where new exceeds done (backlog grows). Observed as the state-unassigned-tint colour.
        chart-flow-shrinks:
          $value: '#E8F1D6'
          $type: color
          $description: Flow chart fill where done exceeds new (backlog shrinks). Observed as the state-running-tint colour.
        control-border:
          $value: '#857A68'
          $type: color
        on-primary:
          $value: '#FFFFFF'
          $type: color
        border:
          $value: '#E0D6C4'
          $type: color
        border-2:
          $value: '#EDE6D8'
          $type: color
        link:
          $value: '{primitive.style.color.rye}'
          $type: color
        focus-ring:
          $value: '{primitive.style.focusRing.color}'
          $type: color
        state-unassigned:
          $value: '#C8432F'
          $type: color
        state-attention:
          $value: '{primitive.style.color.butter}'
          $type: color
        state-running:
          $value: '{primitive.style.color.muted}'
          $type: color
        state-lease:
          $value: '{primitive.style.color.crust}'
          $type: color
        state-offline:
          $value: '{primitive.style.color.muted}'
          $type: color
        type-feature:
          $value: '#718F39'
          $type: color
        type-bug:
          $value: '#C8432F'
          $type: color
        type-chore:
          $value: '{primitive.style.color.crust}'
          $type: color
        state-unassigned-tint:
          $value: '#F8D9D0'
          $type: color
        state-attention-tint:
          $value: '#FCEFC0'
          $type: color
        state-running-tint:
          $value: '#EFE9DE'
          $type: color
        state-lease-tint:
          $value: '#F3E4D7'
          $type: color
        state-offline-tint:
          $value: '#ECE6DA'
          $type: color
        state-unassigned-ink:
          $value: '#8A2A1B'
          $type: color
        state-attention-ink:
          $value: '#5A4500'
          $type: color
        state-running-ink:
          $value: '#3D3224'
          $type: color
        state-lease-ink:
          $value: '#6B3A14'
          $type: color
        state-ink:
          $value: '{primitive.style.color.rye}'
          $type: color
          $description: Ink for text placed on a state fill (state-attention, state-review, state-done, avatar-*). Every pair reaches 4.5:1 in both modes.
        state-attention-mark:
          $type: color
          $value: '#8F6B00'
          $description: Dot, line or border that says "waits for you" on a light surface, where butter itself is too light.
        state-offline-ink:
          $type: color
          $value: '#4A3E30'
          $description: Text on state-offline-tint.
        state-review:
          $type: color
          $value: '{primitive.style.color.rose}'
          $description: Fill of the review state.
        state-done:
          $type: color
          $value: '{primitive.style.color.lime}'
          $description: Fill of the done state.
        avatar-a:
          $type: color
          $value: '{primitive.style.color.rose}'
          $description: Avatar initials fill behind state-ink text.
        avatar-b:
          $type: color
          $value: '#CFE69A'
          $description: Avatar initials fill behind state-ink text.
        avatar-c:
          $type: color
          $value: '#EAC6A4'
          $description: Avatar initials fill behind state-ink text.
        avatar-d:
          $type: color
          $value: '#D9D3C9'
          $description: Avatar initials fill behind state-ink text.
        gate-band:
          $type: color
          $value: '{primitive.style.color.butter}'
          $description: Addition (BAKERS-116, sketch direction A, owner exception to the butter rule on gate pages only). The brand field beside every gate form; the same in light and dark mode.
        gate-band-ink:
          $type: color
          $value: '{primitive.style.color.rye}'
          $description: Addition (BAKERS-116). Text on the gate band, rye in both modes.
      typography:
        page-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.30}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Page title.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:54'
                - '550:8977'
        section-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.16}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.22}'
            letterSpacing: '{primitive.style.letterSpacing.snug}'
          $type: typography
          $description: Section heading.
          $extensions:
            designbook:
              provenance: addition
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:57'
                - '550:9016'
              note: 'Intake decision 2026-11-07: bold instead of the observed semibold, as the spec table sets it (AC-3).'
        item-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.14}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Title of a list row or card.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:60'
                - '550:9024'
        body-strong:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Emphasised body text, such as a person's name.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:63'
        body:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Default text, also for otherwise unstyled text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:66'
        prose:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.21}'
          $type: typography
          $description: Running text, at most the prose width.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:69'
        label:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Field and property label; regular, so a label is never heavier than its value.
          $extensions:
            designbook:
              provenance: addition
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:72'
                - '550:8992'
              note: 'Intake decision 2026-11-07: regular instead of the observed medium (spec ed3f030b, AC-2).'
        meta:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Secondary information such as times and counts.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:75'
                - '550:8978'
                - '550:9011'
        data:
          $value:
            fontFamily: '{primitive.style.fontFamily.mono}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: 'Machine values: keys, branches, IDs.'
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:78'
                - '550:9021'
        eyebrow:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
            letterSpacing: '{primitive.style.letterSpacing.wide}'
          $type: typography
          $description: Uppercase group label above content.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:81'
        badge:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
          $type: typography
          $description: Badge and pill text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:84'
        stat-value:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.28}'
          $type: typography
          $description: Large statistic value.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:87'
        gate-headline:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.40}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.44}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Addition (BAKERS-116, reference-free, agreed with the owner). The slogan on the gate's butter band, the largest text on the gate.
      fontWeight:
        regular:
          $value: '{primitive.style.fontWeight.regular}'
          $type: fontWeight
        medium:
          $value: '{primitive.style.fontWeight.medium}'
          $type: fontWeight
        semibold:
          $value: '{primitive.style.fontWeight.semibold}'
          $type: fontWeight
        bold:
          $value: '{primitive.style.fontWeight.bold}'
          $type: fontWeight
      lineHeight:
        tight:
          $value: '{primitive.style.lineHeight.tight}'
          $type: number
        snug:
          $value: '{primitive.style.lineHeight.snug}'
          $type: number
        relaxed:
          $value: '{primitive.style.lineHeight.relaxed}'
          $type: number
        normal:
          $value: '{primitive.style.lineHeight.normal}'
          $type: number
      radius:
        xs:
          $value: '{primitive.layout.radius.5}'
          $type: dimension
        sm:
          $value: '{primitive.layout.radius.7}'
          $type: dimension
        md:
          $value: '{primitive.layout.radius.10}'
          $type: dimension
      shadow:
        shadow-1:
          $value: '{primitive.style.elevation.1}'
          $type: shadow
        shadow-2:
          $value: '{primitive.style.elevation.2}'
          $type: shadow
        shadow-3:
          $value: '{primitive.style.elevation.3}'
          $type: shadow
      transition:
        fast:
          $value: '{primitive.style.duration.120}'
          $type: duration
        base:
          $value: '{primitive.style.duration.200}'
          $type: duration
      spacing:
        inline-xs:
          $value: '{primitive.layout.spacing.space-1}'
          $type: dimension
          $description: Icon to text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:98'
                - '68:99'
        inline:
          $value: '{primitive.layout.spacing.space-2}'
          $type: dimension
          $description: Pills and buttons side by side.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:102'
                - '68:103'
        stack:
          $value: '{primitive.layout.spacing.space-3}'
          $type: dimension
          $description: Label to control, row content, below a heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:106'
                - '68:107'
                - '68:137'
        group:
          $value: '{primitive.layout.spacing.space-4}'
          $type: dimension
          $description: Field groups and card padding.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:110'
                - '68:111'
        gutter:
          $value: '{primitive.layout.spacing.space-6}'
          $type: dimension
          $description: Page edge from 1280px.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:114'
                - '68:115'
        section:
          $value: '{primitive.layout.spacing.space-8}'
          $type: dimension
          $description: Above a section heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:118'
                - '68:119'
                - '68:135'
    component:
      empty-state:
        icon:
          $value: 64px
          $type: dimension
          $description: Regular state illustration size, independent of layout density.
        compact-icon:
          $value: 24px
          $type: dimension
          $description: Compact state illustration size, independent of layout density.
      shell:
        offset:
          $value: var(--drupal-displace-offset-top, 0px)
          $type: dimension
        height:
          $value: calc(100dvh - var(--drupal-displace-offset-top, 0px))
          $type: dimension
      section:
        padding-y:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      grid:
        gap:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      container:
        max-width:
          $value: 1280px
          $type: dimension
      row:
        height:
          $value: '{primitive.layout.row-h}'
          $type: dimension
      control:
        height:
          $value: '{primitive.layout.control-h}'
          $type: dimension
      list:
        row:
          height:
            $value: '{primitive.layout.line-row-h}'
            $type: dimension
            $description: Minimum height of a list line row.
        plain:
          label-width:
            $value: 96px
            $type: dimension
            $description: Label column of a block's property rows (`list` layout `plain`).
            $extensions:
              designbook:
                provenance: addition
                reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
                note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D18); the reference''s ticket-detail note states 96 px labels. Fixed: cozy density is outside BAKERS-56.'
          row-height:
            $value: 32px
            $type: dimension
            $description: Minimum height of a block's property row (`list` layout `plain`).
            $extensions:
              designbook:
                provenance: addition
                reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
                note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D18); the reference''s ticket-detail note states 32 px rows. Fixed: cozy density is outside BAKERS-56.'
      brand:
        compact:
          width:
            $value: 200px
            $type: dimension
            $description: 'Width of the logo with wordmark at the top of the gate''s butter band (BAKERS-116, sketch direction A); its height follows the SVG aspect ratio. Fixed: it does not follow the layout density.'
      zone:
        gap:
          sm:
            $value: '{primitive.layout.spacing.space-3}'
            $type: dimension
            $description: 'Zone cell gap `sm`: the space-3 step (12px, 16px cozy).'
          md:
            $value: '{primitive.layout.spacing.space-5}'
            $type: dimension
            $description: 'Zone cell gap `md`, the default: the space-5 step (20px, 24px cozy).'
          lg:
            $value: '{primitive.layout.spacing.space-6}'
            $type: dimension
            $description: 'Zone cell gap `lg`: the space-6 step (24px, 32px cozy).'
      prose:
        max-width:
          $value: 620px
          $type: dimension
          $description: Maximum width of running text (72ch).
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:152'
    themes:
      cozy:
        primitive:
          layout:
            spacing:
              base:
                $value: 6px
                $type: dimension
              space-1:
                $value: 8px
                $type: dimension
              space-2:
                $value: 12px
                $type: dimension
              space-3:
                $value: 16px
                $type: dimension
              space-4:
                $value: 20px
                $type: dimension
              space-5:
                $value: 24px
                $type: dimension
              space-6:
                $value: 32px
                $type: dimension
              space-8:
                $value: 40px
                $type: dimension
                $description: Cozy step after 32px.
                $extensions:
                  designbook:
                    provenance: addition
                    reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                    note: 'Intake decision 2026-11-04: continues the cozy scale 24, 32, 40.'
            row-h:
              $value: 40px
              $type: dimension
            control-h:
              $value: 36px
              $type: dimension
            line-row-h:
              $value: 64px
              $type: dimension
              $description: Cozy list line row.
              $extensions:
                designbook:
                  provenance: addition
                  note: 'Intake decision 2026-11-11: cozy density is outside BAKERS-56; +8px like control-h (28 to 36) keeps the cozy inset and a 24px avatar meta line inside the row.'
            radius:
              '5':
                $value: 5px
                $type: dimension
              '7':
                $value: 7px
                $type: dimension
              '10':
                $value: 10px
                $type: dimension
      dark:
        $extensions:
          darkMode: true
        semantic:
          color:
            app:
              $value: '#17120B'
              $type: color
            surface:
              $value: '#221A11'
              $type: color
            surface-2:
              $value: '{primitive.style.color.rye}'
              $type: color
            surface-3:
              $value: '#3A2E20'
              $type: color
            input:
              $value: '#1D160E'
              $type: color
            canvas:
              $value: '#17120B'
              $type: color
            text:
              $value: '{primitive.style.color.flour}'
              $type: color
            text-light:
              $value: '#BCA98D'
              $type: color
            text-faint:
              $value: '#BCA98D'
              $type: color
            title:
              $value: '#FBF5EA'
              $type: color
            primary:
              $value: '{primitive.style.color.butter}'
              $type: color
            chart-series-a:
              $value: '#D28A50'
              $type: color
              $description: First comparison series (solid / circle).
            chart-series-b:
              $value: '{primitive.style.color.lime}'
              $type: color
              $description: Second comparison series (dashed / square).
            chart-series-c:
              $value: '{primitive.style.color.butter}'
              $type: color
              $description: Third comparison series (dotted / circle).
            chart-series-d:
              $value: '{primitive.style.color.rose}'
              $type: color
              $description: Fourth comparison series (dash-dot / square).
            chart-series-e:
              $value: '#E8644E'
              $type: color
              $description: Fifth comparison series (sparse-dot / circle).
            chart-series-f:
              $value: '#A8977E'
              $type: color
              $description: Sixth comparison series (even-dash / square).
            chart-flow-new:
              $value: '#D28A50'
              $type: color
              $description: Flow chart "new" line in dark mode (chart-series-a step).
            chart-flow-done:
              $value: '{primitive.style.color.lime}'
              $type: color
              $description: 'Flow chart "done" line in dark mode. Addition: the reference shows light mode only; teal-400 mirrors chart-series-b''s dark step.'
            chart-flow-grows:
              $value: '#4E2018'
              $type: color
              $description: Flow chart "backlog grows" fill in dark mode (state-unassigned-tint step).
            chart-flow-shrinks:
              $value: '#2F3A1A'
              $type: color
              $description: Flow chart "backlog shrinks" fill in dark mode (state-running-tint step).
            control-border:
              $value: '#8E7B62'
              $type: color
            on-primary:
              $value: '{primitive.style.color.rye}'
              $type: color
            border:
              $value: '#45372A'
              $type: color
            border-2:
              $value: '#33281C'
              $type: color
            link:
              $value: '{primitive.style.color.butter}'
              $type: color
            focus-ring:
              $value: '{primitive.style.color.butter}'
              $type: color
            state-unassigned-tint:
              $value: '#4E2018'
              $type: color
            state-attention-tint:
              $value: '#4A3B10'
              $type: color
            state-running-tint:
              $value: '#3A2E20'
              $type: color
            state-lease-tint:
              $value: '#4A2E18'
              $type: color
            state-offline-tint:
              $value: '#33281C'
              $type: color
            state-unassigned-ink:
              $value: '#F6B8A8'
              $type: color
            state-attention-ink:
              $value: '#F8DE7A'
              $type: color
            state-running-ink:
              $value: '#E3D6C1'
              $type: color
            state-lease-ink:
              $value: '#F2C49C'
              $type: color
            state-attention:
              $type: color
              $value: '{primitive.style.color.butter}'
            state-attention-mark:
              $type: color
              $value: '{primitive.style.color.butter}'
              $description: Dot, line or border that says "waits for you" on a light surface, where butter itself is too light.
            state-running:
              $type: color
              $value: '#A8977E'
            state-unassigned:
              $type: color
              $value: '#E8644E'
            state-lease:
              $type: color
              $value: '#D28A50'
            state-offline:
              $type: color
              $value: '#8E7B62'
            state-offline-ink:
              $type: color
              $value: '#CDBFA9'
              $description: Text on state-offline-tint.
            state-ink:
              $type: color
              $value: '#17120B'
              $description: Ink for text placed on a state fill (state-attention, state-review, state-done, avatar-*). Every pair reaches 4.5:1 in both modes.
            state-review:
              $type: color
              $value: '{primitive.style.color.rose}'
              $description: Fill of the review state.
            state-done:
              $type: color
              $value: '{primitive.style.color.lime}'
              $description: Fill of the done state.
            type-feature:
              $type: color
              $value: '{primitive.style.color.lime}'
            type-bug:
              $type: color
              $value: '#E8644E'
            type-chore:
              $type: color
              $value: '#D28A50'
            avatar-a:
              $type: color
              $value: '{primitive.style.color.rose}'
              $description: Avatar initials fill behind state-ink text.
            avatar-b:
              $type: color
              $value: '{primitive.style.color.lime}'
              $description: Avatar initials fill behind state-ink text.
            avatar-c:
              $type: color
              $value: '#E3B48A'
              $description: Avatar initials fill behind state-ink text.
            avatar-d:
              $type: color
              $value: '#BCB3A6'
              $description: Avatar initials fill behind state-ink text.
        primitive:
          style:
            elevation:
              '1':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 4px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '2':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 12px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '3':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 24px
                  spread: 0px
                  opacity: 0
                $type: shadow
  ```

  #### Contract
  ```yaml
  outputs:
    generate-jsonata:
      required: true
      schema:
        $ref: '#/definitions/Jsonata'
      submission: data
      validators: []
      path: designbook/designbook-css-tailwind/generate-component-sizing.jsonata
  ```

  #### Results
  <!-- done -->

### Step: generate-css
Context: [ctx:cli-surface, ctx:css-mapping]

- [x] generate-css — tokens css

  Instruction: task:generate-css

  #### Params
  ```yaml
  css_generation_plan:
    framework: tailwind
    mode: refresh
    reasons:
      - BAKERS-56 adds component.list.plain.label-width (96px) and component.list.plain.row-height (32px), fixed component values; generate-component-sizing.jsonata maps component sizing by hand, so it is refreshed to emit --spacing-list-plain-label-width and --spacing-list-plain-row-height (no cozy override), and the token CSS is regenerated.
    paths:
      jsonata_dir: designbook/designbook-css-tailwind
      tokens_dir: css/tokens
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
      index_css_path: css/tokens/index.src.css
    jsonata:
      strategy: refresh
      existing_files:
        - designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
        - designbook/designbook-css-tailwind/generate-color.jsonata
        - designbook/designbook-css-tailwind/generate-component-sizing.jsonata
        - designbook/designbook-css-tailwind/generate-grid.jsonata
        - designbook/designbook-css-tailwind/generate-layout-prose.jsonata
        - designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-layout-width.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-color.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-font.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-text.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
        - designbook/designbook-css-tailwind/generate-typography.jsonata
      artifacts:
        - group: color
          prefix: color
          wrap: '@theme static'
          token_path: semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color.jsonata
          css_path: css/tokens/color.src.css
          config_output_path: ../../css/tokens/color.src.css
        - group: color-theme-dark
          prefix: color
          wrap: '[data-mode="dark"]'
          token_path: themes.dark.semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
          css_path: css/tokens/color-theme-dark.src.css
          config_output_path: ../../css/tokens/color-theme-dark.src.css
          theme: dark
          selector_attr: data-mode
          selector_value: dark
        - group: component-sizing
          prefix: ''
          wrap: '@theme static'
          token_path: component
          jsonata_path: designbook/designbook-css-tailwind/generate-component-sizing.jsonata
          css_path: css/tokens/component-sizing.src.css
          config_output_path: ../../css/tokens/component-sizing.src.css
        - group: grid
          prefix: grid
          wrap: '@theme static'
          token_path: component.grid
          jsonata_path: designbook/designbook-css-tailwind/generate-grid.jsonata
          css_path: css/tokens/grid.src.css
          config_output_path: ../../css/tokens/grid.src.css
        - group: layout-prose
          prefix: container
          wrap: '@theme static'
          token_path: component.prose.max-width
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-prose.jsonata
          css_path: css/tokens/layout-prose.src.css
          config_output_path: ../../css/tokens/layout-prose.src.css
        - group: layout-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
          css_path: css/tokens/layout-spacing.src.css
          config_output_path: ../../css/tokens/layout-spacing.src.css
        - group: layout-width
          prefix: container
          wrap: '@theme static'
          token_path: component.container
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-width.jsonata
          css_path: css/tokens/layout-width.src.css
          config_output_path: ../../css/tokens/layout-width.src.css
        - group: primitive-color
          prefix: color
          wrap: '@theme static'
          token_path: primitive.style.color
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-color.jsonata
          css_path: css/tokens/primitive-color.src.css
          config_output_path: ../../css/tokens/primitive-color.src.css
        - group: primitive-focus-ring
          prefix: focus-ring
          wrap: '@theme static'
          token_path: primitive.style.focusRing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
          css_path: css/tokens/primitive-focus-ring.src.css
          config_output_path: ../../css/tokens/primitive-focus-ring.src.css
        - group: primitive-font
          prefix: font
          wrap: '@theme static'
          token_path: primitive.style.font
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-font.jsonata
          css_path: css/tokens/primitive-font.src.css
          config_output_path: ../../css/tokens/primitive-font.src.css
        - group: primitive-leading
          prefix: leading
          wrap: '@theme static'
          token_path: primitive.style.lineHeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
          css_path: css/tokens/primitive-leading.src.css
          config_output_path: ../../css/tokens/primitive-leading.src.css
        - group: primitive-radius
          prefix: radius
          wrap: '@theme static'
          token_path: primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
          css_path: css/tokens/primitive-radius.src.css
          config_output_path: ../../css/tokens/primitive-radius.src.css
        - group: primitive-radius-theme-cozy
          prefix: radius
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
          css_path: css/tokens/primitive-radius-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-radius-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
          css_path: css/tokens/primitive-spacing.src.css
          config_output_path: ../../css/tokens/primitive-spacing.src.css
        - group: primitive-spacing-theme-cozy
          prefix: spacing
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
          css_path: css/tokens/primitive-spacing-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-spacing-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-text
          prefix: text
          wrap: '@theme static'
          token_path: primitive.style.fontSize
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-text.jsonata
          css_path: css/tokens/primitive-text.src.css
          config_output_path: ../../css/tokens/primitive-text.src.css
        - group: primitive-tracking
          prefix: tracking
          wrap: '@theme static'
          token_path: primitive.style.letterSpacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
          css_path: css/tokens/primitive-tracking.src.css
          config_output_path: ../../css/tokens/primitive-tracking.src.css
        - group: primitive-weight
          prefix: font-weight
          wrap: '@theme static'
          token_path: primitive.style.fontWeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
          css_path: css/tokens/primitive-weight.src.css
          config_output_path: ../../css/tokens/primitive-weight.src.css
        - group: semantic-radius
          prefix: radius
          wrap: '@theme static'
          token_path: semantic.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
          css_path: css/tokens/semantic-radius.src.css
          config_output_path: ../../css/tokens/semantic-radius.src.css
        - group: semantic-shadow
          prefix: shadow
          wrap: '@theme static'
          token_path: semantic.shadow
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
          css_path: css/tokens/semantic-shadow.src.css
          config_output_path: ../../css/tokens/semantic-shadow.src.css
        - group: semantic-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          resolve: var
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
          css_path: css/tokens/semantic-spacing.src.css
          config_output_path: ../../css/tokens/semantic-spacing.src.css
        - group: semantic-transition
          prefix: transition
          wrap: '@theme static'
          token_path: semantic.transition
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
          css_path: css/tokens/semantic-transition.src.css
          config_output_path: ../../css/tokens/semantic-transition.src.css
        - group: typography
          prefix: text
          wrap: '@theme static'
          token_path: semantic.typography
          jsonata_path: designbook/designbook-css-tailwind/generate-typography.jsonata
          css_path: css/tokens/typography.src.css
          config_output_path: ../../css/tokens/typography.src.css
    fonts:
      strategy: reuse
      existing: true
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
  design_tokens:
    primitive:
      layout:
        spacing:
          base:
            $value: 4px
            $type: dimension
          space-1:
            $value: 4px
            $type: dimension
          space-2:
            $value: 8px
            $type: dimension
          space-3:
            $value: 12px
            $type: dimension
          space-4:
            $value: 16px
            $type: dimension
          space-5:
            $value: 20px
            $type: dimension
          space-6:
            $value: 24px
            $type: dimension
          space-8:
            $value: 32px
            $type: dimension
            $description: Space above a section heading.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:118'
                  - '68:135'
        row-h:
          $value: 34px
          $type: dimension
        control-h:
          $value: 28px
          $type: dimension
        line-row-h:
          $value: 56px
          $type: dimension
          $description: A list line row with a one-line title.
          $extensions:
            designbook:
              provenance: addition
              reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
              note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D15): a list line row is 56px for a one-line title at compact density; the reference states the same value for a two-line list row.'
        radius:
          '5':
            $value: 5px
            $type: dimension
          '7':
            $value: 7px
            $type: dimension
          '10':
            $value: 10px
            $type: dimension
      style:
        color:
          flour:
            $value: '#F5EBDA'
            $type: color
          rye:
            $value: '#2B2116'
            $type: color
          butter:
            $value: '#F3CE3A'
            $type: color
          lime:
            $value: '#BFE07A'
            $type: color
          rose:
            $value: '#F4AFC0'
            $type: color
          crust:
            $value: '#B8692E'
            $type: color
          muted:
            $value: '#8A7860'
            $type: color
        fontFamily:
          sans:
            $value: '''Spline Sans'', system-ui, -apple-system, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif'
            $type: fontFamily
            $description: Text face of the CI, observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:8978'
                  - '550:8992'
                  - '550:9016'
                  - '550:9024'
          mono:
            $value: '''Spline Sans Mono'', ui-monospace, ''SF Mono'', Menlo, Consolas, monospace'
            $type: fontFamily
            $description: Machine values only (keys, branches, IDs), observed on the CI board.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:9021'
          display:
            $value: '''Bricolage Grotesque'', ''Spline Sans'', system-ui, sans-serif'
            $type: fontFamily
            $description: Page titles only, observed on the CI board at opsz 14.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '550:8977'
        fontSize:
          '11':
            $value: 11px
            $type: dimension
          '12':
            $value: 12px
            $type: dimension
          '13':
            $value: 13px
            $type: dimension
          '14':
            $value: 14px
            $type: dimension
            $description: Item title size.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:60'
                  - '550:9024'
          '16':
            $value: 16px
            $type: dimension
          '24':
            $value: 24px
            $type: dimension
          '40':
            $value: 40px
            $type: dimension
            $description: Addition (BAKERS-116, reference-free, agreed with the owner). Size of the gate slogan headline.
        fontWeight:
          regular:
            $value: 400
            $type: fontWeight
          medium:
            $value: 500
            $type: fontWeight
          semibold:
            $value: 600
            $type: fontWeight
          bold:
            $value: 700
            $type: fontWeight
        lineHeight:
          '14':
            $value: 14px
            $type: dimension
            $description: Whole-pixel line height 14px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:81'
                  - '68:84'
          '16':
            $value: 16px
            $type: dimension
            $description: Whole-pixel line height 16px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:72'
                  - '68:75'
                  - '68:78'
          '20':
            $value: 20px
            $type: dimension
            $description: Whole-pixel line height 20px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:60'
                  - '68:63'
                  - '68:66'
          '21':
            $value: 21px
            $type: dimension
            $description: Whole-pixel line height 21px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:69'
          '22':
            $value: 22px
            $type: dimension
            $description: Whole-pixel line height 22px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:57'
          '28':
            $value: 28px
            $type: dimension
            $description: Whole-pixel line height 28px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:87'
          '30':
            $value: 30px
            $type: dimension
            $description: Whole-pixel line height 30px.
            $extensions:
              designbook:
                provenance: observation
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:54'
          '44':
            $value: 44px
            $type: dimension
            $description: Addition (BAKERS-116, reference-free, agreed with the owner). Line height of the gate slogan headline.
          tight:
            $value: 1.2
            $type: number
          snug:
            $value: 1.3
            $type: number
          relaxed:
            $value: 1.5
            $type: number
          normal:
            $value: 1.45
            $type: number
        elevation:
          '1':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 4px
              spread: 0px
              opacity: 0.06
            $type: shadow
          '2':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 12px
              spread: 0px
              opacity: 0.1
            $type: shadow
          '3':
            $value:
              color: '#14171A'
              offsetX: 0px
              offsetY: 0px
              blur: 24px
              spread: 0px
              opacity: 0.14
            $type: shadow
        lineWeight:
          hairline:
            $value: 1px
            $type: dimension
          emphasis:
            $value: 2px
            $type: dimension
        duration:
          '120':
            $value: 120ms
            $type: duration
          '200':
            $value: 200ms
            $type: duration
        focusRing:
          width:
            $value: 2px
            $type: dimension
          color:
            $value: '{primitive.style.color.rye}'
            $type: color
          offset:
            $value: 2px
            $type: dimension
            $description: Gap between a control and its focus ring.
            $extensions:
              designbook:
                provenance: addition
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '61:3240'
                note: Observed as the focus-keyboard interaction (2px ring, 2px gap); the tokens package does not project interactions.
        letterSpacing:
          tight:
            $value: '-0.01em'
            $type: dimension
            $description: Page title tracking (-1 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:54'
                  - '550:8977'
                note: Figma -1 % at 24px = -0.24px.
          snug:
            $value: '-0.005em'
            $type: dimension
            $description: Section title tracking (-0.5 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:57'
                  - '550:9016'
                note: Figma -0.5 % at 16px = -0.08px.
          wide:
            $value: 0.04em
            $type: dimension
            $description: Eyebrow tracking (4 %).
            $extensions:
              designbook:
                provenance: calculated
                reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                nodes:
                  - '68:81'
                note: Figma 4 % at 11px.
    semantic:
      color:
        app:
          $value: '#F7F2E8'
          $type: color
        surface:
          $value: '#FFFDF8'
          $type: color
        surface-2:
          $value: '#F0E9DC'
          $type: color
        surface-3:
          $value: '#E6DDCD'
          $type: color
        input:
          $value: '#FFFDF8'
          $type: color
        canvas:
          $value: '#F0E9DC'
          $type: color
        text:
          $value: '{primitive.style.color.rye}'
          $type: color
        text-light:
          $value: '#63584A'
          $type: color
        text-faint:
          $value: '#63584A'
          $type: color
        title:
          $value: '{primitive.style.color.rye}'
          $type: color
        primary:
          $value: '{primitive.style.color.rye}'
          $type: color
        chart-series-a:
          $value: '{primitive.style.color.crust}'
          $type: color
          $description: First comparison series (solid / circle).
        chart-series-b:
          $value: '#718F39'
          $type: color
          $description: Second comparison series (dashed / square).
        chart-series-c:
          $value: '#A28317'
          $type: color
          $description: Third comparison series (dotted / circle).
        chart-series-d:
          $value: '#DE5779'
          $type: color
          $description: Fourth comparison series (dash-dot / square).
        chart-series-e:
          $value: '#C8432F'
          $type: color
          $description: Fifth comparison series (sparse-dot / circle).
        chart-series-f:
          $value: '#6E5D49'
          $type: color
          $description: Sixth comparison series (even-dash / square).
        chart-flow-new:
          $value: '{primitive.style.color.crust}'
          $type: color
          $description: Flow chart "new" line, points and end label. Observed as chart-series-a (#494fe5) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24.
        chart-flow-done:
          $value: '#718F39'
          $type: color
          $description: Flow chart "done" line, points and end label. Observed as the Figma proposal chart-outflow (#0d9488) in reference 3a2b0e29e246a9d7/c8ecb5b726386e24; teal-600 is the closest existing primitive, so no new primitive is added.
        chart-flow-grows:
          $value: '#F8D9D0'
          $type: color
          $description: Flow chart fill where new exceeds done (backlog grows). Observed as the state-unassigned-tint colour.
        chart-flow-shrinks:
          $value: '#E8F1D6'
          $type: color
          $description: Flow chart fill where done exceeds new (backlog shrinks). Observed as the state-running-tint colour.
        control-border:
          $value: '#857A68'
          $type: color
        on-primary:
          $value: '#FFFFFF'
          $type: color
        border:
          $value: '#E0D6C4'
          $type: color
        border-2:
          $value: '#EDE6D8'
          $type: color
        link:
          $value: '{primitive.style.color.rye}'
          $type: color
        focus-ring:
          $value: '{primitive.style.focusRing.color}'
          $type: color
        state-unassigned:
          $value: '#C8432F'
          $type: color
        state-attention:
          $value: '{primitive.style.color.butter}'
          $type: color
        state-running:
          $value: '{primitive.style.color.muted}'
          $type: color
        state-lease:
          $value: '{primitive.style.color.crust}'
          $type: color
        state-offline:
          $value: '{primitive.style.color.muted}'
          $type: color
        type-feature:
          $value: '#718F39'
          $type: color
        type-bug:
          $value: '#C8432F'
          $type: color
        type-chore:
          $value: '{primitive.style.color.crust}'
          $type: color
        state-unassigned-tint:
          $value: '#F8D9D0'
          $type: color
        state-attention-tint:
          $value: '#FCEFC0'
          $type: color
        state-running-tint:
          $value: '#EFE9DE'
          $type: color
        state-lease-tint:
          $value: '#F3E4D7'
          $type: color
        state-offline-tint:
          $value: '#ECE6DA'
          $type: color
        state-unassigned-ink:
          $value: '#8A2A1B'
          $type: color
        state-attention-ink:
          $value: '#5A4500'
          $type: color
        state-running-ink:
          $value: '#3D3224'
          $type: color
        state-lease-ink:
          $value: '#6B3A14'
          $type: color
        state-ink:
          $value: '{primitive.style.color.rye}'
          $type: color
          $description: Ink for text placed on a state fill (state-attention, state-review, state-done, avatar-*). Every pair reaches 4.5:1 in both modes.
        state-attention-mark:
          $type: color
          $value: '#8F6B00'
          $description: Dot, line or border that says "waits for you" on a light surface, where butter itself is too light.
        state-offline-ink:
          $type: color
          $value: '#4A3E30'
          $description: Text on state-offline-tint.
        state-review:
          $type: color
          $value: '{primitive.style.color.rose}'
          $description: Fill of the review state.
        state-done:
          $type: color
          $value: '{primitive.style.color.lime}'
          $description: Fill of the done state.
        avatar-a:
          $type: color
          $value: '{primitive.style.color.rose}'
          $description: Avatar initials fill behind state-ink text.
        avatar-b:
          $type: color
          $value: '#CFE69A'
          $description: Avatar initials fill behind state-ink text.
        avatar-c:
          $type: color
          $value: '#EAC6A4'
          $description: Avatar initials fill behind state-ink text.
        avatar-d:
          $type: color
          $value: '#D9D3C9'
          $description: Avatar initials fill behind state-ink text.
        gate-band:
          $type: color
          $value: '{primitive.style.color.butter}'
          $description: Addition (BAKERS-116, sketch direction A, owner exception to the butter rule on gate pages only). The brand field beside every gate form; the same in light and dark mode.
        gate-band-ink:
          $type: color
          $value: '{primitive.style.color.rye}'
          $description: Addition (BAKERS-116). Text on the gate band, rye in both modes.
      typography:
        page-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.30}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Page title.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:54'
                - '550:8977'
        section-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.16}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.22}'
            letterSpacing: '{primitive.style.letterSpacing.snug}'
          $type: typography
          $description: Section heading.
          $extensions:
            designbook:
              provenance: addition
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:57'
                - '550:9016'
              note: 'Intake decision 2026-11-07: bold instead of the observed semibold, as the spec table sets it (AC-3).'
        item-title:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.14}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Title of a list row or card.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:60'
                - '550:9024'
        body-strong:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Emphasised body text, such as a person's name.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:63'
        body:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.20}'
          $type: typography
          $description: Default text, also for otherwise unstyled text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:66'
        prose:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.13}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.21}'
          $type: typography
          $description: Running text, at most the prose width.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:69'
        label:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Field and property label; regular, so a label is never heavier than its value.
          $extensions:
            designbook:
              provenance: addition
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:72'
                - '550:8992'
              note: 'Intake decision 2026-11-07: regular instead of the observed medium (spec ed3f030b, AC-2).'
        meta:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.regular}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: Secondary information such as times and counts.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:75'
                - '550:8978'
                - '550:9011'
        data:
          $value:
            fontFamily: '{primitive.style.fontFamily.mono}'
            fontSize: '{primitive.style.fontSize.12}'
            fontWeight: '{primitive.style.fontWeight.medium}'
            lineHeight: '{primitive.style.lineHeight.16}'
          $type: typography
          $description: 'Machine values: keys, branches, IDs.'
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:78'
                - '550:9021'
        eyebrow:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
            letterSpacing: '{primitive.style.letterSpacing.wide}'
          $type: typography
          $description: Uppercase group label above content.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:81'
        badge:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.11}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.14}'
          $type: typography
          $description: Badge and pill text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:84'
        stat-value:
          $value:
            fontFamily: '{primitive.style.fontFamily.sans}'
            fontSize: '{primitive.style.fontSize.24}'
            fontWeight: '{primitive.style.fontWeight.semibold}'
            lineHeight: '{primitive.style.lineHeight.28}'
          $type: typography
          $description: Large statistic value.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:87'
        gate-headline:
          $value:
            fontFamily: '{primitive.style.fontFamily.display}'
            fontSize: '{primitive.style.fontSize.40}'
            fontWeight: '{primitive.style.fontWeight.bold}'
            lineHeight: '{primitive.style.lineHeight.44}'
            letterSpacing: '{primitive.style.letterSpacing.tight}'
          $type: typography
          $description: Addition (BAKERS-116, reference-free, agreed with the owner). The slogan on the gate's butter band, the largest text on the gate.
      fontWeight:
        regular:
          $value: '{primitive.style.fontWeight.regular}'
          $type: fontWeight
        medium:
          $value: '{primitive.style.fontWeight.medium}'
          $type: fontWeight
        semibold:
          $value: '{primitive.style.fontWeight.semibold}'
          $type: fontWeight
        bold:
          $value: '{primitive.style.fontWeight.bold}'
          $type: fontWeight
      lineHeight:
        tight:
          $value: '{primitive.style.lineHeight.tight}'
          $type: number
        snug:
          $value: '{primitive.style.lineHeight.snug}'
          $type: number
        relaxed:
          $value: '{primitive.style.lineHeight.relaxed}'
          $type: number
        normal:
          $value: '{primitive.style.lineHeight.normal}'
          $type: number
      radius:
        xs:
          $value: '{primitive.layout.radius.5}'
          $type: dimension
        sm:
          $value: '{primitive.layout.radius.7}'
          $type: dimension
        md:
          $value: '{primitive.layout.radius.10}'
          $type: dimension
      shadow:
        shadow-1:
          $value: '{primitive.style.elevation.1}'
          $type: shadow
        shadow-2:
          $value: '{primitive.style.elevation.2}'
          $type: shadow
        shadow-3:
          $value: '{primitive.style.elevation.3}'
          $type: shadow
      transition:
        fast:
          $value: '{primitive.style.duration.120}'
          $type: duration
        base:
          $value: '{primitive.style.duration.200}'
          $type: duration
      spacing:
        inline-xs:
          $value: '{primitive.layout.spacing.space-1}'
          $type: dimension
          $description: Icon to text.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:98'
                - '68:99'
        inline:
          $value: '{primitive.layout.spacing.space-2}'
          $type: dimension
          $description: Pills and buttons side by side.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:102'
                - '68:103'
        stack:
          $value: '{primitive.layout.spacing.space-3}'
          $type: dimension
          $description: Label to control, row content, below a heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:106'
                - '68:107'
                - '68:137'
        group:
          $value: '{primitive.layout.spacing.space-4}'
          $type: dimension
          $description: Field groups and card padding.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:110'
                - '68:111'
        gutter:
          $value: '{primitive.layout.spacing.space-6}'
          $type: dimension
          $description: Page edge from 1280px.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:114'
                - '68:115'
        section:
          $value: '{primitive.layout.spacing.space-8}'
          $type: dimension
          $description: Above a section heading.
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:118'
                - '68:119'
                - '68:135'
    component:
      empty-state:
        icon:
          $value: 64px
          $type: dimension
          $description: Regular state illustration size, independent of layout density.
        compact-icon:
          $value: 24px
          $type: dimension
          $description: Compact state illustration size, independent of layout density.
      shell:
        offset:
          $value: var(--drupal-displace-offset-top, 0px)
          $type: dimension
        height:
          $value: calc(100dvh - var(--drupal-displace-offset-top, 0px))
          $type: dimension
      section:
        padding-y:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      grid:
        gap:
          $value: '{primitive.layout.spacing.space-5}'
          $type: dimension
      container:
        max-width:
          $value: 1280px
          $type: dimension
      row:
        height:
          $value: '{primitive.layout.row-h}'
          $type: dimension
      control:
        height:
          $value: '{primitive.layout.control-h}'
          $type: dimension
      list:
        row:
          height:
            $value: '{primitive.layout.line-row-h}'
            $type: dimension
            $description: Minimum height of a list line row.
        plain:
          label-width:
            $value: 96px
            $type: dimension
            $description: Label column of a block's property rows (`list` layout `plain`).
            $extensions:
              designbook:
                provenance: addition
                reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
                note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D18); the reference''s ticket-detail note states 96 px labels. Fixed: cozy density is outside BAKERS-56.'
          row-height:
            $value: 32px
            $type: dimension
            $description: Minimum height of a block's property row (`list` layout `plain`).
            $extensions:
              designbook:
                provenance: addition
                reference: 3a2b0e29e246a9d7/5b8824c4da4b3267
                note: 'Intake decision 2026-11-11 from the approved BAKERS-56 spec (D18); the reference''s ticket-detail note states 32 px rows. Fixed: cozy density is outside BAKERS-56.'
      brand:
        compact:
          width:
            $value: 200px
            $type: dimension
            $description: 'Width of the logo with wordmark at the top of the gate''s butter band (BAKERS-116, sketch direction A); its height follows the SVG aspect ratio. Fixed: it does not follow the layout density.'
      zone:
        gap:
          sm:
            $value: '{primitive.layout.spacing.space-3}'
            $type: dimension
            $description: 'Zone cell gap `sm`: the space-3 step (12px, 16px cozy).'
          md:
            $value: '{primitive.layout.spacing.space-5}'
            $type: dimension
            $description: 'Zone cell gap `md`, the default: the space-5 step (20px, 24px cozy).'
          lg:
            $value: '{primitive.layout.spacing.space-6}'
            $type: dimension
            $description: 'Zone cell gap `lg`: the space-6 step (24px, 32px cozy).'
      prose:
        max-width:
          $value: 620px
          $type: dimension
          $description: Maximum width of running text (72ch).
          $extensions:
            designbook:
              provenance: observation
              reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
              nodes:
                - '68:152'
    themes:
      cozy:
        primitive:
          layout:
            spacing:
              base:
                $value: 6px
                $type: dimension
              space-1:
                $value: 8px
                $type: dimension
              space-2:
                $value: 12px
                $type: dimension
              space-3:
                $value: 16px
                $type: dimension
              space-4:
                $value: 20px
                $type: dimension
              space-5:
                $value: 24px
                $type: dimension
              space-6:
                $value: 32px
                $type: dimension
              space-8:
                $value: 40px
                $type: dimension
                $description: Cozy step after 32px.
                $extensions:
                  designbook:
                    provenance: addition
                    reference: 8c75dc05ca021b53/7d9c10ecf400eb5b
                    note: 'Intake decision 2026-11-04: continues the cozy scale 24, 32, 40.'
            row-h:
              $value: 40px
              $type: dimension
            control-h:
              $value: 36px
              $type: dimension
            line-row-h:
              $value: 64px
              $type: dimension
              $description: Cozy list line row.
              $extensions:
                designbook:
                  provenance: addition
                  note: 'Intake decision 2026-11-11: cozy density is outside BAKERS-56; +8px like control-h (28 to 36) keeps the cozy inset and a 24px avatar meta line inside the row.'
            radius:
              '5':
                $value: 5px
                $type: dimension
              '7':
                $value: 7px
                $type: dimension
              '10':
                $value: 10px
                $type: dimension
      dark:
        $extensions:
          darkMode: true
        semantic:
          color:
            app:
              $value: '#17120B'
              $type: color
            surface:
              $value: '#221A11'
              $type: color
            surface-2:
              $value: '{primitive.style.color.rye}'
              $type: color
            surface-3:
              $value: '#3A2E20'
              $type: color
            input:
              $value: '#1D160E'
              $type: color
            canvas:
              $value: '#17120B'
              $type: color
            text:
              $value: '{primitive.style.color.flour}'
              $type: color
            text-light:
              $value: '#BCA98D'
              $type: color
            text-faint:
              $value: '#BCA98D'
              $type: color
            title:
              $value: '#FBF5EA'
              $type: color
            primary:
              $value: '{primitive.style.color.butter}'
              $type: color
            chart-series-a:
              $value: '#D28A50'
              $type: color
              $description: First comparison series (solid / circle).
            chart-series-b:
              $value: '{primitive.style.color.lime}'
              $type: color
              $description: Second comparison series (dashed / square).
            chart-series-c:
              $value: '{primitive.style.color.butter}'
              $type: color
              $description: Third comparison series (dotted / circle).
            chart-series-d:
              $value: '{primitive.style.color.rose}'
              $type: color
              $description: Fourth comparison series (dash-dot / square).
            chart-series-e:
              $value: '#E8644E'
              $type: color
              $description: Fifth comparison series (sparse-dot / circle).
            chart-series-f:
              $value: '#A8977E'
              $type: color
              $description: Sixth comparison series (even-dash / square).
            chart-flow-new:
              $value: '#D28A50'
              $type: color
              $description: Flow chart "new" line in dark mode (chart-series-a step).
            chart-flow-done:
              $value: '{primitive.style.color.lime}'
              $type: color
              $description: 'Flow chart "done" line in dark mode. Addition: the reference shows light mode only; teal-400 mirrors chart-series-b''s dark step.'
            chart-flow-grows:
              $value: '#4E2018'
              $type: color
              $description: Flow chart "backlog grows" fill in dark mode (state-unassigned-tint step).
            chart-flow-shrinks:
              $value: '#2F3A1A'
              $type: color
              $description: Flow chart "backlog shrinks" fill in dark mode (state-running-tint step).
            control-border:
              $value: '#8E7B62'
              $type: color
            on-primary:
              $value: '{primitive.style.color.rye}'
              $type: color
            border:
              $value: '#45372A'
              $type: color
            border-2:
              $value: '#33281C'
              $type: color
            link:
              $value: '{primitive.style.color.butter}'
              $type: color
            focus-ring:
              $value: '{primitive.style.color.butter}'
              $type: color
            state-unassigned-tint:
              $value: '#4E2018'
              $type: color
            state-attention-tint:
              $value: '#4A3B10'
              $type: color
            state-running-tint:
              $value: '#3A2E20'
              $type: color
            state-lease-tint:
              $value: '#4A2E18'
              $type: color
            state-offline-tint:
              $value: '#33281C'
              $type: color
            state-unassigned-ink:
              $value: '#F6B8A8'
              $type: color
            state-attention-ink:
              $value: '#F8DE7A'
              $type: color
            state-running-ink:
              $value: '#E3D6C1'
              $type: color
            state-lease-ink:
              $value: '#F2C49C'
              $type: color
            state-attention:
              $type: color
              $value: '{primitive.style.color.butter}'
            state-attention-mark:
              $type: color
              $value: '{primitive.style.color.butter}'
              $description: Dot, line or border that says "waits for you" on a light surface, where butter itself is too light.
            state-running:
              $type: color
              $value: '#A8977E'
            state-unassigned:
              $type: color
              $value: '#E8644E'
            state-lease:
              $type: color
              $value: '#D28A50'
            state-offline:
              $type: color
              $value: '#8E7B62'
            state-offline-ink:
              $type: color
              $value: '#CDBFA9'
              $description: Text on state-offline-tint.
            state-ink:
              $type: color
              $value: '#17120B'
              $description: Ink for text placed on a state fill (state-attention, state-review, state-done, avatar-*). Every pair reaches 4.5:1 in both modes.
            state-review:
              $type: color
              $value: '{primitive.style.color.rose}'
              $description: Fill of the review state.
            state-done:
              $type: color
              $value: '{primitive.style.color.lime}'
              $description: Fill of the done state.
            type-feature:
              $type: color
              $value: '{primitive.style.color.lime}'
            type-bug:
              $type: color
              $value: '#E8644E'
            type-chore:
              $type: color
              $value: '#D28A50'
            avatar-a:
              $type: color
              $value: '{primitive.style.color.rose}'
              $description: Avatar initials fill behind state-ink text.
            avatar-b:
              $type: color
              $value: '{primitive.style.color.lime}'
              $description: Avatar initials fill behind state-ink text.
            avatar-c:
              $type: color
              $value: '#E3B48A'
              $description: Avatar initials fill behind state-ink text.
            avatar-d:
              $type: color
              $value: '#BCB3A6'
              $description: Avatar initials fill behind state-ink text.
        primitive:
          style:
            elevation:
              '1':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 4px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '2':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 12px
                  spread: 0px
                  opacity: 0
                $type: shadow
              '3':
                $value:
                  color: '#000000'
                  offsetX: 0px
                  offsetY: 0px
                  blur: 24px
                  spread: 0px
                  opacity: 0
                $type: shadow
  ```

  #### Contract
  ```yaml
  outputs: {}
  ```

  #### Results
  <!-- done -->

### Step: compile-css
Context: [ctx:cli-surface]

- [x] compile-css — app css

  Instruction: task:compile-css

  #### Params
  ```yaml
  ```

  #### Contract
  ```yaml
  outputs:
    compiled-css:
      required: true
      schema:
        $ref: '#/definitions/CompiledCss'
      submission: data
      validators: []
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-56-vorschl-ge-tick/web/themes/custom/bb_theme/css/app.css
  ```

  #### Results
  <!-- done -->

### Step: guard-css
Context: [ctx:cli-surface]

- [x] guard-css — guard

  Instruction: task:guard-css

  #### Params
  ```yaml
  ```

  #### Contract
  ```yaml
  outputs:
    guard-passed:
      required: true
      schema:
        type: boolean
      submission: data
      validators: []
    missing-vars:
      required: false
      schema:
        type: array
        items:
          type: string
      submission: data
      validators: []
    missing-fonts:
      required: false
      schema:
        type: array
        items:
          type: string
      submission: data
      validators: []
    unresolved-placeholders:
      required: false
      schema:
        type: array
        description: |
          Generated token declarations whose value still contains an alias placeholder (a `{…}` segment) that the JSONata transform failed to resolve. Each entry is the offending `--var: value;` line.
        items:
          type: string
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

### Step: generate-index
Context: [ctx:cli-surface, ctx:css-mapping]

- [x] generate-index — index

  Instruction: task:generate-index

  #### Params
  ```yaml
  css_generation_plan:
    framework: tailwind
    mode: refresh
    reasons:
      - BAKERS-56 adds component.list.plain.label-width (96px) and component.list.plain.row-height (32px), fixed component values; generate-component-sizing.jsonata maps component sizing by hand, so it is refreshed to emit --spacing-list-plain-label-width and --spacing-list-plain-row-height (no cozy override), and the token CSS is regenerated.
    paths:
      jsonata_dir: designbook/designbook-css-tailwind
      tokens_dir: css/tokens
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
      index_css_path: css/tokens/index.src.css
    jsonata:
      strategy: refresh
      existing_files:
        - designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
        - designbook/designbook-css-tailwind/generate-color.jsonata
        - designbook/designbook-css-tailwind/generate-component-sizing.jsonata
        - designbook/designbook-css-tailwind/generate-grid.jsonata
        - designbook/designbook-css-tailwind/generate-layout-prose.jsonata
        - designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-layout-width.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-color.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-font.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-text.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
        - designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
        - designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
        - designbook/designbook-css-tailwind/generate-typography.jsonata
      artifacts:
        - group: color
          prefix: color
          wrap: '@theme static'
          token_path: semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color.jsonata
          css_path: css/tokens/color.src.css
          config_output_path: ../../css/tokens/color.src.css
        - group: color-theme-dark
          prefix: color
          wrap: '[data-mode="dark"]'
          token_path: themes.dark.semantic.color
          jsonata_path: designbook/designbook-css-tailwind/generate-color-theme-dark.jsonata
          css_path: css/tokens/color-theme-dark.src.css
          config_output_path: ../../css/tokens/color-theme-dark.src.css
          theme: dark
          selector_attr: data-mode
          selector_value: dark
        - group: component-sizing
          prefix: ''
          wrap: '@theme static'
          token_path: component
          jsonata_path: designbook/designbook-css-tailwind/generate-component-sizing.jsonata
          css_path: css/tokens/component-sizing.src.css
          config_output_path: ../../css/tokens/component-sizing.src.css
        - group: grid
          prefix: grid
          wrap: '@theme static'
          token_path: component.grid
          jsonata_path: designbook/designbook-css-tailwind/generate-grid.jsonata
          css_path: css/tokens/grid.src.css
          config_output_path: ../../css/tokens/grid.src.css
        - group: layout-prose
          prefix: container
          wrap: '@theme static'
          token_path: component.prose.max-width
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-prose.jsonata
          css_path: css/tokens/layout-prose.src.css
          config_output_path: ../../css/tokens/layout-prose.src.css
        - group: layout-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-spacing.jsonata
          css_path: css/tokens/layout-spacing.src.css
          config_output_path: ../../css/tokens/layout-spacing.src.css
        - group: layout-width
          prefix: container
          wrap: '@theme static'
          token_path: component.container
          jsonata_path: designbook/designbook-css-tailwind/generate-layout-width.jsonata
          css_path: css/tokens/layout-width.src.css
          config_output_path: ../../css/tokens/layout-width.src.css
        - group: primitive-color
          prefix: color
          wrap: '@theme static'
          token_path: primitive.style.color
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-color.jsonata
          css_path: css/tokens/primitive-color.src.css
          config_output_path: ../../css/tokens/primitive-color.src.css
        - group: primitive-focus-ring
          prefix: focus-ring
          wrap: '@theme static'
          token_path: primitive.style.focusRing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-focus-ring.jsonata
          css_path: css/tokens/primitive-focus-ring.src.css
          config_output_path: ../../css/tokens/primitive-focus-ring.src.css
        - group: primitive-font
          prefix: font
          wrap: '@theme static'
          token_path: primitive.style.font
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-font.jsonata
          css_path: css/tokens/primitive-font.src.css
          config_output_path: ../../css/tokens/primitive-font.src.css
        - group: primitive-leading
          prefix: leading
          wrap: '@theme static'
          token_path: primitive.style.lineHeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-leading.jsonata
          css_path: css/tokens/primitive-leading.src.css
          config_output_path: ../../css/tokens/primitive-leading.src.css
        - group: primitive-radius
          prefix: radius
          wrap: '@theme static'
          token_path: primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius.jsonata
          css_path: css/tokens/primitive-radius.src.css
          config_output_path: ../../css/tokens/primitive-radius.src.css
        - group: primitive-radius-theme-cozy
          prefix: radius
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-radius-theme-cozy.jsonata
          css_path: css/tokens/primitive-radius-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-radius-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing.jsonata
          css_path: css/tokens/primitive-spacing.src.css
          config_output_path: ../../css/tokens/primitive-spacing.src.css
        - group: primitive-spacing-theme-cozy
          prefix: spacing
          wrap: '[data-density="cozy"]'
          token_path: themes.cozy.primitive.layout.spacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-spacing-theme-cozy.jsonata
          css_path: css/tokens/primitive-spacing-theme-cozy.src.css
          config_output_path: ../../css/tokens/primitive-spacing-theme-cozy.src.css
          theme: cozy
          selector_attr: data-density
          selector_value: cozy
        - group: primitive-text
          prefix: text
          wrap: '@theme static'
          token_path: primitive.style.fontSize
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-text.jsonata
          css_path: css/tokens/primitive-text.src.css
          config_output_path: ../../css/tokens/primitive-text.src.css
        - group: primitive-tracking
          prefix: tracking
          wrap: '@theme static'
          token_path: primitive.style.letterSpacing
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-tracking.jsonata
          css_path: css/tokens/primitive-tracking.src.css
          config_output_path: ../../css/tokens/primitive-tracking.src.css
        - group: primitive-weight
          prefix: font-weight
          wrap: '@theme static'
          token_path: primitive.style.fontWeight
          jsonata_path: designbook/designbook-css-tailwind/generate-primitive-weight.jsonata
          css_path: css/tokens/primitive-weight.src.css
          config_output_path: ../../css/tokens/primitive-weight.src.css
        - group: semantic-radius
          prefix: radius
          wrap: '@theme static'
          token_path: semantic.radius
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-radius.jsonata
          css_path: css/tokens/semantic-radius.src.css
          config_output_path: ../../css/tokens/semantic-radius.src.css
        - group: semantic-shadow
          prefix: shadow
          wrap: '@theme static'
          token_path: semantic.shadow
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-shadow.jsonata
          css_path: css/tokens/semantic-shadow.src.css
          config_output_path: ../../css/tokens/semantic-shadow.src.css
        - group: semantic-spacing
          prefix: spacing
          wrap: '@theme static'
          token_path: semantic.spacing
          resolve: var
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-spacing.jsonata
          css_path: css/tokens/semantic-spacing.src.css
          config_output_path: ../../css/tokens/semantic-spacing.src.css
        - group: semantic-transition
          prefix: transition
          wrap: '@theme static'
          token_path: semantic.transition
          jsonata_path: designbook/designbook-css-tailwind/generate-semantic-transition.jsonata
          css_path: css/tokens/semantic-transition.src.css
          config_output_path: ../../css/tokens/semantic-transition.src.css
        - group: typography
          prefix: text
          wrap: '@theme static'
          token_path: semantic.typography
          jsonata_path: designbook/designbook-css-tailwind/generate-typography.jsonata
          css_path: css/tokens/typography.src.css
          config_output_path: ../../css/tokens/typography.src.css
    fonts:
      strategy: reuse
      existing: true
      fonts_dir: css/fonts
      font_css_path: css/tokens/google-fonts.src.css
  ```

  #### Contract
  ```yaml
  outputs:
    index-css:
      required: true
      schema:
        $ref: '#/definitions/IndexCss'
      submission: data
      validators: []
      path: css/tokens/index.src.css
  ```

  #### Results
  <!-- done -->

