# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-24T15:41:44Z | validate | validate | default (period-range) | Two validate tasks share the title "default" (period-range default and stat-tile default). `plan done --task validate --title default` exits 1 with 'task "validate" is ambiguous — pass --title to select one instance'; `plan done --help` offers no other selector. The sealed plan cannot address either instance. | Ran the declared checks anyway: all pass (story bb-theme-data-display-period-range--default: labels "Week", "This week · 19 – 25 Oct", "vs. 12 – 18 Oct", no Return link, "Previous week"/"Next week" with Next disabled, filter[period]=week, filter[date]=2026-10-19, no console errors, fonts/overlay/render ok). Checkbox left pending; a re-sealed plan with unique validate titles is needed. |
| 2026-10-24T15:41:44Z | validate | validate | default (stat-tile) | Same title collision as above. | Declared checks run and pass (bb-theme-data-display-stat-tile--default: 7 / tickets closed / last 24 h / source, no comparison row, accessible name "7 tickets closed"). Checkbox left pending. |
