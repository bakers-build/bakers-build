// The vocabulary for driving a `bb_theme:option_picker` from a browser.
//
// WHY THIS FILE EXISTS, AND IT IS A REVIEW FINDING RATHER THAN TIDYING.
// `safe()`, `pickerTrigger()` and `pickerPanel()` were byte-identical in
// `project-create.steps.ts` and `ticket-create.steps.ts`, and the stated reason
// for the copy — "duplicated rather than imported because that helper is
// private to its file" — was refuted by the same diff that wrote it:
// `create-dialog-parity.steps.ts` imports across step files, and `php()` has
// been imported out of `ticket-list.steps.ts` (now `support/drush.ts`) for as long as these files have
// existed. A create dialog whose FORM was deliberately shared has no business
// having its picker driver copied beside it.
//
// IT IS NOT A STEP FILE. Nothing here registers a Gherkin step; playwright-bdd
// matches on step TEXT, so a second registration of the same sentence is a
// duplicate definition rather than an override, and the helpers below are
// deliberately the part with no sentence attached. `support/steps/core.ts` is the
// existing precedent for a non-registering module living in this directory.
//
// EVERY SELECTOR HERE WAS MEASURED AGAINST A REAL RENDER, and each docblock
// carries the measurement rather than the preference — a selector that matches
// nothing passes by asserting nothing, which is the failure mode this whole
// suite exists to avoid.
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Whatever a Gherkin string may not smuggle into a shell or into PHP. */
export function safe(value: string): string {
  return value.replace(/["'\\$]/g, '');
}

/**
 * The trigger of one picker inside a dialog, found by the field name an
 * operator reads.
 *
 * NOT BY `title`, and that is a measured trap `ticket-list.steps.ts` records at
 * length: `option_picker` derives `trigger_title` from the SELECTION
 * (`field_name ~ ": " ~ all_values`), so a `[title="Group"]` selector stops
 * matching the moment the pick this suite exists to make has been made. The
 * `[data-picker-part="field"]` carries the field's visible name independently
 * of the selection. It is a behavior hook, not a styling class.
 *
 * THE DIALOG IS A PARAMETER, which is the one thing that changed when the two
 * copies became one. Each surface names itself as "the generic hull containing
 * this form" — both create dialogs take `island`'s hull and it is passed no
 * `id` — so the scope cannot be a constant of this module's own.
 *
 * @param page - The page under test.
 * @param dialog - The CSS selector naming the surface's own dialog hull.
 * @param field - The field label as an operator reads it.
 */
export function pickerTrigger(page: Page, dialog: string, field: string): Locator {
  const exact = new RegExp(`^\\s*${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  return page
    .locator(`${dialog} [data-option-picker-trigger]`)
    .filter({ has: page.locator('[data-picker-part="field"]', { hasText: exact }) })
    .first();
}

/**
 * The panel belonging to a given trigger, scoped by DOM ancestry rather than by
 * `aria-controls`/id.
 *
 * MEASURED, not a style preference: `panel_id` defaults to
 * `id|default('bakers-option-picker') ~ '__panel'`, and no field on either create
 * display is given an explicit `id`, so every one of them defaults to the SAME
 * literal `bakers-option-picker__panel` — a duplicate-id page. `#panelId`
 * therefore resolves to every picker's panel at once; the pick step got away
 * with it because a picked LABEL happens to be unique across panels, but the
 * clear row's wording ("No conductor", "No parent", "No labels") is not unique
 * in the same way. Walking up to the trigger's own `[data-option-picker]`
 * ancestor is what actually scopes to the one picker under test.
 */
export function pickerPanel(trigger: Locator): Locator {
  return trigger
    .locator('xpath=ancestor::*[@data-option-picker][1]')
    .locator('[data-option-picker-panel]');
}

/**
 * One `role="option"` row of an open panel, found by its visible label.
 *
 * `option_list.twig` renders every row — the clear row included — as
 * `<li role="option" data-value="…">` carrying an `.option-list__label`, so
 * this is the one shape a pick, a listing assertion and a vacuity check all
 * share.
 */
export function optionRow(page: Page, panel: Locator, label: string): Locator {
  return panel
    .locator('[role="option"]')
    .filter({ has: page.locator('.option-list__label', { hasText: label }) })
    .first();
}

/**
 * Waits for the picker's component to have initialised before clicking it.
 *
 * It is not defensive padding. A click that lands before the handlers are
 * bound does nothing at all, and the run then fails several steps later on
 * `aria-expanded`, with the picker blamed for what was a timing gap. It is
 * also where the BB-420 Task 22 defect class surfaces: a dialog that arrived
 * through a swap and was never initialised never grows this attribute at all,
 * and this is the earliest and clearest place to say so.
 *
 * WHAT IS WAITED ON CHANGED WITH THE MECHANISM, and the old marker is worth
 * recording because its disappearance is exactly the kind of regression this
 * wait exists to make legible. The picker used to be a `Drupal.behaviors`
 * file, and `once('bakers-option-picker', …)` marked the element synchronously
 * in the same call that bound the trigger, so `data-once` was the handler's
 * own footprint. The picker is now an Alpine component, `once()` is no longer
 * called, and Alpine records an initialised subtree on the element object with
 * nothing a selector can see — so `data-once` would now wait forever on a
 * picker that works perfectly. The component therefore sets
 * `data-option-picker-ready` at the end of its `init()`, which is the same
 * contract in the new mechanism: the attribute appears in the call that
 * finishes wiring the element.
 *
 * The assertion is the PRESENCE overload rather than `toHaveAttribute(name,
 * '')`: the marker is a valueless attribute, and the two-argument form
 * compares an empty expected value in a way that reports the confusing
 * "serializes to the same string" against an attribute that is in fact there.
 */
export async function waitForPickerBehaviour(trigger: Locator): Promise<void> {
  await expect(
    trigger.locator('xpath=ancestor::*[@data-option-picker][1]'),
    'the option picker never initialised — did the swapped dialog lose its JavaScript?',
  ).toHaveAttribute('data-option-picker-ready');
}
