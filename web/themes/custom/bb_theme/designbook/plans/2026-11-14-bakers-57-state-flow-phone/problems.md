# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-14T22:31:09Z | validate | validate | bb-theme-data-display-state-flow--default | `npx storybook-addon-designbook storybook check "<story_url>"` prints `Error: Cannot find package 'playwright' imported from .../storybook-addon-designbook/dist/cli.js`: the theme has no `playwright` package, so the CHECK_RESULT the validate contract requires cannot be produced. | None inside the sealed plan (installing a dependency is out of scope). Out-of-contract evidence from a Playwright probe (tests/playwright's playwright, chromium headless shell) against the live Storybook, no page errors: 390: list 358x26 on one line inside its own scroll container, scrollWidth 390. |
