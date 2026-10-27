# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-27T21:45:00Z | validate | validate | rich-text aligned_table | `storybook check` exits 1: `Cannot find package 'playwright'` (addon 0.14.0). The sealed `story_url` port (39625) also went stale after a dev-server restart (now 46535). Task stays pending. | None inside the sealed plan. One-off Playwright probe on the live iframe: A/1 `markdown-align-left` → left, B/2 center, C/3 right, D/4 unclassed → left/start; 0 console errors. |
| 2026-10-27T21:45:00Z | validate | validate | rich-text table (preserved) | Same `Cannot find package 'playwright'`. Task stays pending. | Same probe: every th left, every td start, as before the change; 0 console errors. |
