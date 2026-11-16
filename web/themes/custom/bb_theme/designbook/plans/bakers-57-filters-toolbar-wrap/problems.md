# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-15T00:18:03Z | validate | validate | bb-theme-layout-filters--toolbar | `npx storybook-addon-designbook storybook check "<story_url>"` prints `Error: Cannot find package 'playwright' imported from .../storybook-addon-designbook/dist/cli.js`: the theme has no `playwright` package, so the CHECK_RESULT the validate contract requires cannot be produced. | None (installing a dependency is out of scope); task left pending. |
| 2026-11-15T00:18:03Z | validate | validate | bb-theme-layout-filters--toolbar-sheet | `npx storybook-addon-designbook storybook check "<story_url>"` prints `Error: Cannot find package 'playwright' imported from .../storybook-addon-designbook/dist/cli.js`: the theme has no `playwright` package, so the CHECK_RESULT the validate contract requires cannot be produced. | None (installing a dependency is out of scope); task left pending. |
