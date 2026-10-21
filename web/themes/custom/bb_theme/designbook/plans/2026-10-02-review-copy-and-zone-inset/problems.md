# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-02T13:20:00Z | write-component | write-component | form_input, zone | The CLI re-serialises every submitted artifact, so `form_input.component.yml` and `zone.default.story.yml` came back reflowed although neither changed. | Both files were compared as parsed YAML against `HEAD` (equal) and restored byte for byte; only the story placeholder and the zone `inset` description differ. |
| 2026-10-02T13:25:00Z | (none) | (none) | user.user.default form mapping | The palette offers `map-entity--design-screen`, whose sealed result path for a form mode points under `entity-mapping/` instead of `form-mapping/` (same defect as `2026-10-02-english-product-copy`). | The one placeholder in `form-mapping/user.user.default.jsonata` was edited directly; no task was added to the sealed plan. |
| 2026-10-02T13:30:00Z | validate | validate | all 3 story URLs | `storybook check <url>` cannot run: `Cannot find package 'playwright'` in the addon. The validate tasks stay pending. | Equivalent probe with the repository's Playwright (`assets-ai/BB-594/node/probe-review-copy.mjs`): each story at 360px and 1440px renders with 0 console errors and 0 horizontal overflow; placeholders read `e.g. mk` and `e.g. Product Lead`. |
