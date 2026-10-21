# Shell and ticket-list refinement verification

The existing approved reference and semantic tokens were preserved. The new facet variant is selected by the ticket-list scene and Drupal's existing Better Exposed Filters widget. Picker behavior hooks and their existing browser-test consumers now agree. The compact mobile rail keeps named navigation links, and its expanded/collapsed preference remains persistent.

Passed:
- `pnpm run build` and `pnpm exec storybook build`.
- `bash tests/contract/bb-378-layout-components.sh`.
- `bash tests/contract/bb-389-data-display-components.sh`.
- `node tests/playwright/checks/shell-picker.cjs http://localhost:6017` (using the installed Playwright CLI's module via NODE_PATH in this checkout, which has no local test dependencies).
- Browser inspection at 390, 768 and 1440px: no document overflow; table scrolling stays local. Light and dark screenshots inspected. Mobile rail labels, expansion/collapse, eight facets, selection, clearing and Escape/focus checked.
- Existing default, inline and multiple picker interactions checked separately; multiple selection preserves the complete accessible name and +N count.
- Impeccable detector: empty findings array. `git diff --check` and PHP syntax checks passed.

Follow-up: after restoring locked Composer dependencies, `BbOptionPickerWidgetTest.php` passed (5 tests, 31 assertions). Drupal boots and its login and home pages render through the public tunnel. The recipe-test installation stopped during demo seeding on the existing undefined `update_storage_clear()` call; a complete seeded environment and the full BDD suite remain unverified.

Designbook reports 12/13 tasks done. The selected scene renders correctly, but the full-file validator rejects pre-existing object-valued overlays in sibling scenes outside this plan's target. See `problems.md` (one issue); the pending task was not marked passed.

Screenshots from the final inspection are under `/tmp/bakers-shell-review/` (desktop, mobile, tablet and dark). Preview: `http://localhost:6017/?path=/story/designbook-sections-my-work-scenes--ticket-list`.

### Ticket and member spacing follow-up

- Canvas supplies a 20px top inset when its header is rendered by the shell; entity-form surfaces no longer add a second horizontal inset.
- Exposed filters have 12px sibling spacing. Ticket views configure a contextual empty message and render the existing empty-state SDC.
- Members compose the form SDC for invitation controls and actions, with 20px between sections.
- Ticket creation uses the textarea SDC; text-format help is hidden after core processing without changing filtering. Picker panels stay inside their dialog and Escape closes the picker first.
- Theme and Storybook builds and both layout/data-display contracts passed. Ticket dialog browser check passed at 1440px and 390px. Ticket/member pages were inspected at both widths; mobile was checked with the sidebar collapsed.
- Kernel checks: TicketCreateDialogRenderTest (4 tests, 139 assertions), GroupMemberSurfaceTest (3 tests, 24 assertions), contextual empty-state cases (4 tests, 400 assertions). PHP coding standards passed for changed PHP files.
