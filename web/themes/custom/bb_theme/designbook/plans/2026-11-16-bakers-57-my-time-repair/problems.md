# Execution problems — repair

Input: completed check `plans/2026-11-16-bakers-57-my-time-desktop-verify-3` (6 issues). Corrected: toolbar-stale, week-total-line (polish tasks, all four week scenes of `user.section.scenes.yml`). Accepted, not corrected: proposal-state, day-labels (D9), shell.

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-16 | intake | — | full-width-actions | Blocked, not a product difference: the product renders Discard proposal and Add row inside their Drupal forms, so they keep their natural width; the scene places the buttons directly in `canvas` main, a stretching flex column. Scenes cannot use `type: element`, and no existing component is a neutral non-stretching wrapper. | None in the scene; needs a component change (a wrapper or a `self-start` option on `button`), out of this repair's scope. |
