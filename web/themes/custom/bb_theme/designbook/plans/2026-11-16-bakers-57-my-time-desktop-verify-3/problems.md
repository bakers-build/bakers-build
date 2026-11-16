# Execution problems — design-verify

Diff 4.51% at 1440x900 (threshold 2%), severity major. Actual capture of the scene at ticket commit 786c79b9 through the provision `designbook` key (web container Chromium). Accepted deviations stay accepted; new findings are recorded, not repaired here.

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-16 | triage | triage | my-time | toolbar-stale (major): The scene's toolbar keeps the panel surface, has no ‹ period › paging and puts Project at the far right; Figma and the product since 9909b3b9 draw one row: Day/Week, ‹ period ›, Project pill, week total at the end. File: web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml | New; not repaired in this run. |
| 2026-11-16 | triage | triage | my-time | week-total-line (minor): Week total is its own line below the toolbar, not the end of the toolbar row. File: web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml | New (D6 no longer holds: the product moved it into the row); not repaired in this run. |
| 2026-11-16 | triage | triage | my-time | full-width-actions (minor): Discard proposal and Add row render as full-width rows; the reference draws a small left-aligned Add project row. File: web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml | New; not repaired in this run. |
| 2026-11-16 | triage | triage | my-time | proposal-state (minor): The scene shows an AI proposal (message, Proposed row, Save week) Figma does not draw. File: web/themes/custom/bb_theme/designbook/sections/user/user.section.scenes.yml | Accepted (sample state); not repaired in this run. |
| 2026-11-16 | triage | triage | my-time | day-labels (minor): Day headers read Mon 03; Figma reads Mon 2. File: web/modules/custom/bb_track/src/Form/WorklogWeekForm.php | Accepted D9; not repaired in this run. |
| 2026-11-16 | triage | triage | my-time | shell (minor): Sidebar, page header action and status bar differ from the frame. File: web/themes/custom/bb_theme/designbook/design-system/design-system.scenes.yml | Accepted (earlier tickets); not repaired in this run. |
