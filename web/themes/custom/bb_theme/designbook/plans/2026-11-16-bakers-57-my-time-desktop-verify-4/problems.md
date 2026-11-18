# Execution problems — design-verify

Recheck after repair `plans/2026-11-16-bakers-57-my-time-repair`. Actual capture `references/a37d5b1ab62e9d49/633bde7db603e386` at 786c79b9 plus the scene repair, through the provision `designbook` key. Diff 4.41% at 1440x900 (threshold 2%, was 4.51%), measured severity major. toolbar-stale and week-total-line are resolved: the toolbar row matches Figma (Day/Week, ‹ period ›, Project pill, week total at the end). The remaining diff is the shell offset and the scene's sample state.

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-16 | triage | triage | my-time | shell-offset (minor): Figma frames the workspace My time with Tickets / My time / Stats tabs; the scene uses the account shell, so toolbar and table sit about 34px higher; sidebar, header action and status bar differ. | Accepted: shell belongs to earlier tickets. |
| 2026-11-16 | triage | triage | my-time | proposal-state (minor): AI proposal message, Discard proposal, Proposed row and Save week, which Figma does not draw. | Accepted: scene sample state. |
| 2026-11-16 | triage | triage | my-time | full-width-actions (minor): Discard proposal, Add row and Save week span the column; the product keeps them at natural width. | Blocked: needs a non-stretching wrapper component; scenes cannot use `type: element`. |
| 2026-11-16 | triage | triage | my-time | day-labels (minor): Mon 03 vs Figma Mon 2. | Accepted D9. |
| 2026-11-16 | triage | triage | my-time | editable-cells (minor): 28px h:mm inputs instead of plain numbers, as the product renders the own week. | Accepted: product behaviour (rows stay 36px). |
