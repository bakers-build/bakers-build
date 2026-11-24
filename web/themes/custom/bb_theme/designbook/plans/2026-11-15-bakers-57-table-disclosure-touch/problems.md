# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-15T11:55:09Z | validate | validate | bb-theme-data-display-table--tree | `npx storybook-addon-designbook storybook check` stops at `browserType.launch: Executable doesn't exist at …/ms-playwright/chromium_headless_shell-1255/…`: no Playwright browser is installed on this host, and downloading one is outside this run. | None inside the sealed plan; task left pending. The rendered table is covered at 390 × 844 by the Playwright touch probe on Insights in the web container. |
