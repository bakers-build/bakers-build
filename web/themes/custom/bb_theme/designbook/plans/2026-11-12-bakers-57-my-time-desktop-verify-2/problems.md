# Execution problems — design-verify

Score from verify-score.json; diff 4.66% at 1440x900 (threshold 2%). Two major issues stay OPEN for repair (AC-7 toolbar row, AC-8 36px editable rows); the rest are accepted deviations or sample state.

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-12T03:00:00Z | triage | triage | my-time | toolbar-row (major): The toolbar wraps: the project facet spans the bar, Date and Project carry labels above their controls, and the bar keeps the panel surface; Figma draws one 32px row (segmented control, arrows around the period text, a Project pill). File: web/modules/custom/bb_track/src/Plugin/views/filter/WorklogPeriod.php | OPEN, not accepted: AC-7 needs the period controls in one row; needs a compact picker and arrow paging in the exposed form. |
| 2026-11-12T03:00:00Z | triage | triage | my-time | editable-cells (major): Day cells are 38px inputs (rows 39px) with a Save week button; Figma draws plain right-aligned numbers in 36px rows. File: web/themes/custom/bb_theme/components/table/table.twig | OPEN: AC-8 asks 36px rows; the own week is the editable timesheet, so the input cell must shrink to fit. |
| 2026-11-12T03:00:00Z | triage | triage | my-time | proposal-state (minor): The scene shows an AI proposal (message, Discard, Proposed row) that Figma does not draw. File: web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml | Kept: scene sample state, not a design difference. |
| 2026-11-12T03:00:00Z | triage | triage | my-time | week-total-line (minor): Week total is a right-aligned line above the table, not the end of the toolbar row. File: web/themes/custom/bb_theme/templates/views-view-bb-worklog-calendar.html.twig | Accepted deviation D6 (approved spec). |
| 2026-11-12T03:00:00Z | triage | triage | my-time | day-labels (minor): Day headers read Mon 03; Figma reads Mon 2. File: web/modules/custom/bb_track/src/Form/WorklogWeekForm.php | Accepted deviation D9 (approved spec). |
| 2026-11-12T03:00:00Z | triage | triage | my-time | shell (minor): Sidebar, page header button and status bar differ from the reference frame. File: web/themes/custom/bb_theme/designbook/design-system/design-system.scenes.yml | Out of scope: shell and colours of earlier tickets. |
