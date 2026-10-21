# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-19T20:10:00Z | validate | validate | action_menu | The panel is right-aligned (`right-0`) for its real place at a row's end; in the isolated default story the trigger sits at the canvas's left edge, so the panel starts at x=-120 and is clipped. | None inside the sealed plan: a story cannot pass root attributes, and an alignment prop changes the frozen contract. Needs a new intake (typed `align` prop). |
| 2026-10-19T20:30:00Z | — | — | action_menu | Resolved by a follow-up change intake: typed `align` prop (start/end, default end); the default story uses `align: start` and its panel sits fully inside the canvas (x=16). | — |
