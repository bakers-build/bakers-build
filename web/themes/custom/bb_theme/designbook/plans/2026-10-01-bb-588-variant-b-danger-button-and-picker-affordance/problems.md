# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-01T20:10:00Z | validate | validate | button danger | `npx storybook-addon-designbook storybook check <story-url>` exits 1: `Error: Cannot find package 'playwright' imported from .../storybook-addon-designbook@0.11.0.../dist/cli.js` (same infrastructure defect as plan 2026-09-30-bb-580-zone-shrinks-in-a-grid-cell). No CHECK_RESULT can be produced; task stays pending. | Equivalent evidence with `playwright-cli` (session dbB) recorded under assets-ai/BB-588/playwright/designbook-b/. |
| 2026-10-01T20:10:00Z | validate | validate | option_picker inline | Same `storybook check` failure. | As above. |
| 2026-10-01T20:10:00Z | validate | validate | ticket-detail consumer | Same `storybook check` failure. | As above. |
