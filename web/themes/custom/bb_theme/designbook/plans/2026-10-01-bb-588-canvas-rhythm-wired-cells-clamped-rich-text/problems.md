# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-01T21:10:00Z | validate | validate | canvas default, table wired, rich-text clamped, project-detail-overview consumer | `storybook check <url>` exits 1: `Error: Cannot find package 'playwright' imported from .../storybook-addon-designbook@0.11.0.../dist/cli.js`. All four tasks stay pending. | playwright-cli probes (session dbC): table--wired renders anchors with href + data-hx-get/target/select/swap and radio inputs `members[n][role]`; rich-text--clamped clamps to 107px, toggle visible, click → aria-expanded=true, "Show less", aria-controls=id of body; rich-text--default byte-identical class list, no wrapper; intervention scene main children gap 20px (486→506, 751→771). |
