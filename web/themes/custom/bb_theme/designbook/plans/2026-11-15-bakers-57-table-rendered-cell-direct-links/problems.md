# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-15T12:05:20Z | validate | validate | bb-theme-data-display-table--default | `npx storybook-addon-designbook storybook check` stops at `browserType.launch: Executable doesn't exist at …/ms-playwright/chromium_headless_shell-1255/…`: no Playwright browser is installed on this host, and downloading one is outside this run. | None inside the sealed plan; task left pending. The Board conductor link in a rendered cell is covered at 390 by a Playwright probe in the web container. |
