# Execution problems — css-generate

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-07T23:35:19Z | guard-css | guard-css | guard | `guard-css --probe` returned `skipped: Cannot find package 'playwright'` from the addon's `dist/cli.js`; the probe did not run, so no pass can be recorded. Static checks done: no unresolved `{…}` placeholder in `css/tokens/*.src.css`, and the compiled `css/app.css` declares `--color-station-*` and `--text-gate-headline`. | None inside the sealed plan: restoring the browser environment would mean installing `playwright` into the theme, which this run may not do. The token variables are checked in the rendered login page instead. |
