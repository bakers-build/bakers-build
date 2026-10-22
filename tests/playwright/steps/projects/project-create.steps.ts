// BB-421 Task 8 — the create-project dialog, from a real browser.
//
// ONLY THE STEPS NO OTHER FILE ALREADY PROVIDES. `I am logged in as {string}`
// comes from the `@key-tec/playwright-core` catalog; `the document was not
// reloaded` and its mark come from `support/steps/shell.steps.ts`, which OWNS that
// detector; `php()` comes from `support/drush.ts`. playwright-bdd matches a
// step by its TEXT and not by its keyword, so every registration below is
// checked against the whole `steps/` registry — which is why the submit step is
// `I submit the create-project dialog` and not the plan's `I submit the
// dialog`: that text is already registered by `ticket-create.steps.ts`, scoped
// to `dialog#bakers-ticket-create`, and a second registration is a duplicate
// definition rather than an override.
//
// WHY THE SELECTORS LOOK DIFFERENT FROM `ticket-create.steps.ts`. That dialog
// composes its own hull and gives it the id `bakers-ticket-create`. This one
// composes NO hull (spec D2): `island`'s `WrappedRouteRenderer` wraps the
// route's main content, passes no `id` prop, and `dialog.twig` falls back to
// `id="bakers-dialog"`. Binding to that default would bind to "whatever generic
// hull happens to be on the page"; binding to the hull that CONTAINS
// `form#bb-project-create-form` names the surface under test.
//
// THIS FILE'S FIRST RUN FOUND A DEFECT IN THAT ARRANGEMENT rather than in
// itself, and the fix is in the trigger. `ProjectCreateActionSource` selected
// `form#bakers-project-create` out of the dialog response — reasoning copied from
// the ticket trigger, where the hull IS inside the form — so the overlay
// received a bare `<form>` and the document held zero `<dialog>` elements. It
// selects `dialog` now. Nothing in this file works around that; every scenario
// below was RED against the delivered trigger and is GREEN against the fixed
// one, which is the whole reason a browser gate exists.
//
// THE FORM'S OWN ID GAINED A `-form` SUFFIX in BB-421's re-entry, and it is
// not cosmetic: the dialog's POST now targets the FORM rather than the shell
// overlay, which is core's own htmx form shape, and core decides whether to
// hang an out-of-band swap on the rebuilt `form_build_id` from the `-form`
// suffix of `HX-Target` and from nothing else (`FormBuilder.php:781-791`). One
// consequence reaches this file directly: only the `<form>` is replaced on a
// refusal, so the `<dialog>` hull is never re-swapped and keeps its own
// behaviours, while the hull's `message` slot — which sits outside the form —
// is updated out of band from the same response.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { php } from '../../support/drush';
import { documentWasKept, markDocument } from '../../support/shell';
import {
  optionRow,
  pickerPanel,
  pickerTrigger as pickerTriggerIn,
  safe,
  waitForPickerBehaviour,
} from '../../support/picker';

/**
 * The `<form>` Drupal derives from `BbProjectCreateForm::FORM_ID`.
 *
 * `Html::getId('bb_project_create_form')`. Used here to NAME the surface — the
 * generic hull carries no id of its own worth binding to — and deliberately not
 * as the trigger's `hx-select`, which must select the hull instead; see
 * `ProjectCreateActionSource::getPropValue()` for the measured reason.
 */
const PROJECT_FORM = 'form#bb-project-create-form';

/**
 * The dialog hull holding this surface, wherever it is rendered.
 *
 * `[data-dialog]` is `dialog.twig`'s own unconditional hook, and the `:has()`
 * is what makes it THIS dialog: the generic hull is given no `id` prop by
 * `WrappedRouteRenderer::hullProps()`, so every route wrapped by the
 * `island_dialog` format renders as `dialog#bakers-dialog`. Naming the form
 * inside it is the only way to say "the create-project dialog" rather than "a
 * generic hull".
 */
const DIALOG = `dialog[data-dialog]:has(${PROJECT_FORM})`;

/**
 * The same hull, asserted OPEN.
 *
 * `open` is the `<dialog>` element's own attribute and it is load-bearing:
 * `WrappedRouteRenderer::hullProps()` states it because a `<dialog>` without it
 * is not rendered at all, so "open" and "in the document" are the same claim
 * made two ways and both are worth binding to.
 */
const OPEN_DIALOG = `dialog[data-dialog][open]:has(${PROJECT_FORM})`;

/**
 * The Projects page display's Views wrapper.
 *
 * The exposed form id is unique to `view.projects.workspace_list`. Display
 * Builder fills the Views render-element container, so this is present whether
 * or not the table has rows.
 */
const PROJECTS_WRAPPER = '.views-element-container:has(#views-exposed-form-projects-workspace-list)';

/**
 * The accessible name of the trigger, which is an `aria-label` and not text.
 *
 * `ProjectCreateActionSource` renders `bb_theme:button` with
 * `icon_only => TRUE`, and `button.twig` moves the label into `aria-label` for
 * exactly that case — so the control keeps an accessible name while showing
 * only a plus icon. `getByRole('link', …)` reads that name; a text selector
 * would find nothing.
 */
const TRIGGER_NAME = 'New project';

/**
 * The projects screen of the seeded workspace, resolved rather than hardcoded.
 *
 * The same reasoning `ticket-create.steps.ts`'s `bakersWorkspacePath()` gives:
 * the path carries a workspace slug, and reading it out of the world is what
 * keeps this file from asserting about a workspace that was renamed. Duplicated
 * rather than imported because that helper is private to its file and resolves
 * a ticket list, not this screen.
 */
function projectsPath(): string {
  const slug = php(
    '$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")' +
      '->loadByProperties(["slug" => "bakers"])); print $w ? $w->get("slug")->value : "";',
  );
  if (!slug) {
    throw new Error('No bb_workspace with slug "bakers" exists in the seeded world.');
  }
  return `/${slug}/projects`;
}

/**
 * The trigger of one picker inside THIS dialog.
 *
 * A one-line binding of the shared driver to this surface's own hull, which is
 * the only thing that was ever surface-specific about it: `pickerTrigger()` is
 * scoped by a dialog selector, and every reason for its selector choice lives
 * in `support/picker.ts` beside the code rather than in a copy here.
 */
function pickerTrigger(page: Page, field: string): Locator {
  return pickerTriggerIn(page, DIALOG, field);
}

/**
 * Opens the dialog through the screen's own trigger and nothing else.
 *
 * BY THE TRIGGER RATHER THAN BY URL, for the reason BB-420 Task 22 measured
 * on the ticket dialog: opening by URL exercises a path no operator takes, and
 * it was exactly the path on which a non-functional dialog shipped green. The
 * `hx-get` address is waited for rather than the DOM alone, so a click that
 * fell back to a whole-page navigation is reported as a missing response
 * instead of as a missing dialog.
 */
async function openDialog(page: Page): Promise<void> {
  const trigger = page.getByRole('link', { name: TRIGGER_NAME, exact: true });
  await expect(
    trigger,
    `No "${TRIGGER_NAME}" action is on the projects screen — is the view's page_header composing bb_project_create_action?`,
  ).toBeAttached();
  // WAIT FOR htmx TO OWN THE TRIGGER BEFORE CLICKING IT, and this is a
  // precondition rather than a softened assertion. The trigger is an ordinary
  // anchor with a real `href` — the deliberate scriptless path — so a click
  // landing before htmx has processed the document follows that href and
  // navigates to the standalone create page instead of fetching the dialog.
  // The second open in this scenario reaches exactly that window, because
  // closing the dialog is a full document navigation and the trigger in the
  // NEW document has to be processed again. Measured in CI as a 20s
  // `waitForResponse` timeout on `And I close it and open it again`, on a
  // runner slow enough for the gap to matter.
  //
  // NOT A DEFECT THIS HIDES. The operator can lose the same race, and what
  // they get is the standalone page — a working form without the dialog hull,
  // which is this delivery's recorded and accepted divergence. Removing the
  // `href` would close the race and break the no-JavaScript path, so the
  // scenario waits for the mechanism it is about instead of racing it.
  await expect
    .poll(
      () =>
        trigger.evaluate(
          (el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data'],
        ),
      {
        message: 'htmx never processed the create trigger, so a click could only navigate',
        timeout: 20000,
      },
    )
    .toBe(true);
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && response.url().includes('_wrapper_format=island_dialog'),
    { timeout: 20000 },
  );
  await trigger.click();
  await answered;
  // Asserted on the `<dialog>` and not on `#bakers-overlay`: `dialog` renders
  // `position: fixed`, so the overlay container — never sized by CSS — stays a
  // 0×0 box even while the dialog inside it is squarely on screen.
  await expect(
    page.locator(OPEN_DIALOG),
    'The create-project dialog did not open in the shell overlay',
  ).toBeVisible();
}

Given('I am on the projects screen', async ({ page }) => {
  const response = await page.goto(projectsPath());
  expect(response?.status() ?? 0, 'The projects screen did not render').toBeLessThan(400);
  await expect(page.locator(PROJECTS_WRAPPER), 'The projects screen body is absent').toBeAttached();
  // The shared mark, so `the document was not reloaded` means one thing across
  // the whole suite (`support/steps/shell.steps.ts` owns it).
  await markDocument(page);
});

/**
 * Makes the creating scenario re-runnable, and it is a precondition rather
 * than a convenience.
 *
 * `BbProject::defaultKey()` derives `key` from `name` and `key` carries a
 * `UniqueField` constraint, so a second `Designbook` is REFUSED — blaming a
 * field this surface does not render. Without this step the scenario is
 * single-use and its second run looks like a product regression, which is the
 * failure mode this suite's README names explicitly.
 *
 * `delete()` and not a rename: the row has to be gone for the key to be free.
 */
Given('no project is named {string}', async ({}, name: string) => {
  const outcome = php(
    [
      '$storage = \\Drupal::entityTypeManager()->getStorage("bb_project");',
      `$found = $storage->loadByProperties(["name" => "${safe(name)}"]);`,
      'if ($found) { $storage->delete($found); }',
      `print count($storage->loadByProperties(["name" => "${safe(name)}"]));`,
    ].join(' '),
  );
  expect(outcome, `A bb_project named "${name}" survived the cleanup`).toBe('0');
});

When('I open the create-project dialog', async ({ page }) => {
  await openDialog(page);
});

/**
 * THE SECOND CLICK, and the reason the scenario has one at all.
 *
 * A declaration lost in an htmx swap still survives the FIRST click, so a
 * one-click scenario cannot see the class of defect that broke this
 * mechanism's first delivery. Three things are asserted in order and each of
 * them can fail on its own terms:
 *
 *   1. `Cancel` really closes. Its `href` (`WrappedDialogFormTrait::returnUrl()`)
 *      is the screen under the dialog, so `island.dialog.js` removes the hull in place rather than navigating
 *      — and it is also the target the hull's OTHER two dismissals read: both the close
 *      control and Escape resolve `[data-dialog-cancel]` and go where it
 *      points, which is why those two are asserted once for both surfaces in
 *      `features/dialogs/create-dialog-parity.feature` rather than again here.
 *      (This docblock used to say Cancel was "the only dismissal this hull
 *      delivers", citing `bb_theme:dialog` on Escape-to-close belonging "to
 *      the ticket that makes these dialogs interactive". That stopped being
 *      true when the handler landed in `c96ff93e5` and is deleted rather than
 *      reworded.)
 *      That is the point of asserting the projects body afterwards: the
 *      operator is back on the screen they opened the dialog over, which is
 *      what `destination` is for.
 *   2. The document is re-marked after the close, so the next assertion is
 *      about the SECOND open rather than about the cancel. Whether the close
 *      itself kept the document is asserted in
 *      `features/dialogs/create-dialog-parity.feature`.
 *   3. The second open kept the document. `openDialog()` already proves the
 *      fragment arrived; this proves it arrived as a fragment.
 *
 * Everything the scenario does after this step is done in the dialog that
 * arrived through that swap, which is what turns the picks and the submit that
 * follow into an operability claim instead of a presence one.
 */
When('I close it and open it again', async ({ page }) => {
  const cancel = page.locator(DIALOG).getByRole('link', { name: 'Cancel', exact: true });
  await expect(cancel, 'The dialog offers no Cancel to close it with').toBeAttached();
  await cancel.click();
  await expect(
    page.locator(DIALOG),
    'Cancel did not close the dialog',
  ).toHaveCount(0);
  await expect(
    page.locator(PROJECTS_WRAPPER),
    'Cancel did not land back on the projects screen — is `destination` reaching returnUrl()?',
  ).toBeAttached();
  await markDocument(page);

  await openDialog(page);
  expect(
    await documentWasKept(page),
    'The second open replaced the document instead of swapping the shell overlay',
  ).toBe(true);
});

/** Closes the dialog with Cancel, which removes it in place over the list. */
When('I cancel the create-project dialog', async ({ page }) => {
  await page.locator(DIALOG).getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page.locator(DIALOG), 'Cancel did not close the dialog').toHaveCount(0);
  await expect(page.locator(PROJECTS_WRAPPER), 'Cancel did not land back on the projects screen').toBeAttached();
});

/** Types into the standard name widget using its accessible label. */
When('I fill in {string} as the project name', async ({ page }, value: string) => {
  const line = page.locator(OPEN_DIALOG).getByRole('textbox', { name: 'Name' });
  await expect(line, 'No project-name line is rendered in the dialog').toBeAttached();
  await line.fill(value);
});

/**
 * Picks one option the way a pointer user does — a click on its
 * `role="option"` row, found by the visible label rather than by the id it
 * submits, exactly as every other picker in this suite is driven.
 *
 * The pill is read back afterwards. That is not a duplicate of the panel
 * assertion: `option_picker.js` writing the hidden input and the trigger
 * showing the value are two halves of the same click, and a pick that lands in
 * the DOM without reaching the trigger is the shape of "the behaviour attached
 * but the dependant sync did not run".
 */
async function pickInPicker(page: Page, field: string, label: string): Promise<void> {
  const trigger = pickerTrigger(page, field);
  await expect(trigger, `No picker is called "${field}"`).toBeAttached();
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await expect(trigger, `The "${field}" picker did not open`).toHaveAttribute('aria-expanded', 'true');
  const row = optionRow(page, pickerPanel(trigger), label);
  await expect(row, `The "${field}" picker offers no "${label}" option`).toBeAttached();
  await row.click();
  await expect(
    trigger,
    `The "${field}" pill does not read "${label}" after the pick`,
  ).toContainText(label);
}

When('I pick the group {string}', async ({ page }, label: string) => {
  await pickInPicker(page, 'Group', label);
});

When('I pick the team {string}', async ({ page }, label: string) => {
  await pickInPicker(page, 'Teams', label);
});

/**
 * Clicks this dialog's own submit and waits for its round trip.
 *
 * A REAL `#type: submit`, which is the difference from the ticket dialog and
 * not an accident: `EntityForm::actions()` builds it with `#submit =>
 * ['::submitForm', '::save']`, so `FormBuilder` finds a triggering element and
 * core's own chain writes. The ticket dialog's `Create ticket` is an SDC
 * component with no Form API button behind it, which is why that surface has to
 * declare its own submission.
 *
 * Asserted ENABLED before the click rather than merely clicked: a disabled
 * button fails Playwright's actionability check with an opaque 30s timeout, and
 * this surface has no submit gate at all (spec D4 — there is no context field
 * to be unresolved about), so a disabled submit here would itself be the
 * finding.
 */
When('I submit the create-project dialog', async ({ page }) => {
  const submit = page.locator(OPEN_DIALOG).locator('button[type="submit"]');
  await expect(submit, 'No submit is present in the create-project dialog').toBeAttached();
  await expect(submit, 'The create-project dialog\'s submit is disabled').toBeEnabled();
  const responded = page
    .waitForResponse((response) => response.request().method() === 'POST', { timeout: 20000 })
    .catch(() => null);
  await submit.click();
  await responded;
});

/**
 * AC 1's second half: the write landed AND the operator is back on the list.
 *
 * The landing is `HX-Location` and not a redirect —
 * `FormBuilder::processForm()` calls `disableRedirect()` for every htmx
 * request, so `WrappedDialogFormTrait::respondAtReturnUrl()` answers with an
 * empty 200 plus that header (spec D7). The empty body swapped into the overlay
 * is what closes the dialog; the header is what fetches the screen. So the
 * projects body is waited for FIRST — its presence is the proof the landing
 * happened at all, and the text assertion after it is about the row.
 */
Then('the projects list contains {string}', async ({ page }, text: string) => {
  await expect(
    page.locator(PROJECTS_WRAPPER),
    'The dialog never landed back on the projects screen — did the write answer with HX-Location?',
  ).toBeAttached({ timeout: 20000 });
  await expect(
    page.locator(OPEN_DIALOG),
    'The create-project dialog is still open after a successful write',
  ).toHaveCount(0);
  await expect(
    page.locator(PROJECTS_WRAPPER).getByText(text).first(),
    `The projects list does not show "${text}"`,
  ).toBeVisible({ timeout: 20000 });
});

Then('the dialog is still open', async ({ page }) => {
  await expect(
    page.locator(OPEN_DIALOG),
    'The create-project dialog is not open after the refusal',
  ).toBeVisible();
});

/**
 * AC 2's operator-facing half: the refusal names the field.
 *
 * The message is the GENERIC HULL's `message` slot — `#type: status_messages`,
 * rendered through `bb_theme:message` by the theme's own
 * `status-messages.html.twig` — which is the whole of spec D2's claim that this
 * form needs no message channel of its own. `toBeVisible()` is load-bearing
 * beside the text check: `textContent` is populated whether or not the element
 * is `hidden`, and a hidden refusal names nothing to the operator.
 *
 * The string asserted is the widget's HUMAN label (`Teams`), which is the whole
 * of what `flagViolations()` adds. The raw constraint sentence — "This value
 * should not be null." — is core's, and asserting only that would pass against
 * the very output BB-420 Task 13 was written to replace.
 *
 * `:not([data-create-dialog-error-for])` NARROWS THIS TO THE HULL'S BLOCK, and
 * it is a correction rather than a workaround. The shared body template now
 * places a `bb_theme:message` beside each blamed field as well, so the bare
 * component selector matches several elements and Playwright's strict mode
 * refuses it. The two surfaces answer different questions — this step is the
 * FORM-level block, which is where a violation blaming no field of this form
 * has to go, and `the {string} field is blamed for the refusal` is the
 * field-level one — so each binds to its own.
 */
Then('the message names the {string} field', async ({ page }, field: string) => {
  const message = page
    .locator(OPEN_DIALOG)
    .locator('[data-component-id="bb_theme:message"]:not([data-create-dialog-error-for])');
  await expect(message, 'No message is rendered in the dialog hull').toBeAttached();
  await expect(message, 'The refusal is in the DOM but not visible').toBeVisible();
  await expect(
    message,
    `The refusal does not name the "${field}" field — is flagViolations() prefixing the widget label?`,
  ).toContainText(field);
});

/** Drupal's standard error message names the rejected field. */
Then('the {string} field is blamed for the refusal', async ({ page }, field: string) => {
  await expect(pickerTrigger(page, field)).toBeAttached();
  await expect(page.locator(OPEN_DIALOG).locator('[role="alert"]')).toContainText(`${field} field is required.`);
});

/**
 * THE STEP THIS TICKET'S RE-ENTRY EXISTS FOR: the refused dialog still WORKS.
 *
 * Three facts, and each of them was measured FALSE on the delivery commit
 * against a dialog that was still open, still styled and still showing its
 * refusal — which is why "the dialog is still open" is not enough and why this
 * step is separate from it:
 *
 *   1. `form_build_id` is in the document, exactly once. htmx's out-of-band
 *      pass runs BEFORE the main swap, so core's `data-hx-swap-oob` lifted the
 *      new input out of the fragment and wrote it over the old one inside the
 *      subtree the main swap then replaced: measured as `rewrittenBuildIds=1`
 *      at `htmx:beforeSwap` and `domBuildIds=0` at `htmx:afterSwap`. With no
 *      build id there is no next submit at all.
 *   2. Every option picker got its behaviour back. The same attribute decided
 *      which element core's bridge fired `htmx:drupal:load` on — a DETACHED
 *      `<form>`, where nothing was listening — so all three pickers arrived
 *      unwired. Asserted as a COUNT and then per picker, because "three
 *      attached" and "the ones that exist are attached" are different claims
 *      and a surface that lost a picker would satisfy the second.
 *   3. THE CLOSE CONTROL IS STILL THERE. This used to assert a `data-once`
 *      marker beside it, on the reasoning that the dismissal behaviour marks
 *      `[data-dialog]` when it attaches. There is no marker any more, and its
 *      absence is the fix rather than a loss of coverage: pipeline 154470
 *      measured the close control dead on a cold page while Escape — bound to
 *      the document — worked on the same surfaces, so `island.dialog.js`
 *      delegates BOTH listeners from the document and attaches nothing. A
 *      marker would have pinned the mechanism; what matters is that the
 *      control is present here and that clicking it closes the dialog, which
 *      `create-dialog-parity.feature` asserts by clicking it.
 *
 * THE PICKER COUNT IS PINNED AT THREE because the display states three
 * pickers (`group_id`, `teams`, `owner_user_id`) — spec D4's field set — so a
 * surface that quietly renders fewer fails here rather than passing with a
 * smaller denominator.
 */
Then('the create-project dialog is still operable', async ({ page }) => {
  const dialog = page.locator(OPEN_DIALOG);

  await expect(
    dialog.locator('input[name="form_build_id"]'),
    'The refused dialog holds no form_build_id — the next submit cannot be made',
  ).toHaveCount(1);

  const pickers = dialog.locator('[data-option-picker]');
  await expect(
    pickers,
    'The refused dialog does not render all three pickers of the create display',
  ).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(
      pickers.nth(index),
      `Picker ${index} came back without its JavaScript — did the swapped dialog lose it?`,
      // The readiness marker the picker's Alpine `init()` sets. It replaced
      // `data-once`, which the `Drupal.behaviors` version left behind and
      // which an Alpine component never grows — see `support/picker.ts`.
    ).toHaveAttribute('data-option-picker-ready');
  }

  await expect(
    dialog.locator('[data-dialog-close]'),
    'The refused dialog lost its close control — the operator has no way out but a reload',
  ).toHaveCount(1);
});

Then('the project name still reads {string}', async ({ page }, text: string) => {
  await expect(
    page.locator(OPEN_DIALOG).getByRole('textbox', { name: 'Name' }),
    'The refused form did not keep the typed project name',
  ).toHaveValue(text);
});

/**
 * The field whose panel the last `I open the … picker` step opened.
 *
 * Module-level because a playwright-bdd step cannot hand state to the next one.
 * Safe because it is reset by the opener, so a scenario cannot inherit a
 * previous one's panel, independent of how many workers the run uses — the
 * same pattern `ticket-detail.steps.ts` uses for its own last-status value.
 */
let openPickerField: string | null = null;

When('I open the group picker', async ({ page }) => {
  openPickerField = null;
  const trigger = pickerTrigger(page, 'Group');
  await expect(trigger, 'No picker is called "Group"').toBeAttached();
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await expect(trigger, 'The "Group" picker did not open').toHaveAttribute('aria-expanded', 'true');
  openPickerField = 'Group';
});

/** The open panel, refused rather than guessed at when no opener has run. */
function openPanel(page: Page): Locator {
  if (openPickerField === null) {
    throw new Error('No picker has been opened yet — did an "I open the … picker" step run first?');
  }
  return pickerPanel(pickerTrigger(page, openPickerField));
}

/**
 * The panel's POSITIVE content, and the anchor both absence steps below reuse.
 *
 * Asserted as a REAL row and not as "the label is somewhere in the DOM":
 * `role="option"` carrying the candidate's own `data-value` is what
 * `option_list.twig` renders, and a stringified PHP `options` array — the
 * measured defect `ticket-create.steps.ts` records — renders neither the
 * element nor the attribute.
 */
Then('the panel lists {string}', async ({ page }, label: string) => {
  const panel = openPanel(page);
  await expect(
    panel.locator('[role="option"]').first(),
    'The open panel renders no role="option" rows at all',
  ).toBeAttached();
  const row = optionRow(page, panel, label);
  await expect(row, `The panel does not list "${label}"`).toBeAttached();
  await expect(
    row,
    `The "${label}" row carries no data-value — is it a real option_list row?`,
  ).toHaveAttribute('data-value', /.+/);
});

/**
 * Asserts what the panel does NOT offer, having first asserted what it does.
 *
 * AN ABSENCE ASSERTION AIMED AT NOTHING PASSES BY ASSERTING NOTHING, which is
 * the one way this scenario could go green while proving less than it claims.
 * Two guards, and they answer different questions:
 *
 *   - the panel's own rows are asserted present FIRST, from the same measured
 *     selector the pick steps use, so an absence measured against a panel that
 *     never opened fails here instead of passing there;
 *   - the SELECTOR itself was driven to its positive side by hand and the
 *     failure recorded — `assets-ai/BB-421/node/project-create-absence-probe.txt`.
 *     Both `[data-option-list-create]` and `[data-option-list-clear]` were
 *     temporarily asserted absent on the TICKET dialog's `labels` picker, whose
 *     display gives it `create_label: label` and `clear_label: 'No labels'`, and
 *     both FAILED there. So the strings match real rendered markup and the zero
 *     measured here is a measurement.
 */
async function assertPanelOffersNo(page: Page, selector: string, what: string): Promise<void> {
  const panel = openPanel(page);
  await expect(panel, 'No picker panel is open').toBeAttached();
  await expect(
    panel.locator('[role="option"]').first(),
    `The open panel renders no rows at all, so "no ${what}" would pass vacuously`,
  ).toBeAttached();
  await expect(
    panel.locator(selector),
    `The group picker offers a ${what} — spec D7 says create_label and clear_label are both empty on group_id`,
  ).toHaveCount(0);
}

Then('the panel offers no create row', async ({ page }) => {
  await assertPanelOffersNo(page, '[data-option-list-create]', 'create row');
});

Then('the panel offers no clear row', async ({ page }) => {
  await assertPanelOffersNo(page, '[data-option-list-clear]', 'clear row');
});


/**
 * AC 11 — the guard against a 2xx that does not hold this form.
 *
 * THE RESPONSE IS MOCKED AND THE ASSERTION IS NOT, which is the distinction
 * that makes this a legitimate browser test rather than a test of a test. What
 * is under test is CLIENT-side behaviour — what htmx and this module's own
 * `htmx:beforeSwap` listener do when `hx-select` matches nothing — so the
 * response is the input to that behaviour, and supplying it directly is the
 * ordinary way to reach a branch the server will not produce on demand.
 *
 * WHY THE SERVER WILL NOT PRODUCE IT, measured rather than assumed. The
 * obvious live route is a session that ended, and it does not work: a POST to
 * this form's own url with the session cookie cleared answers **404**, not the
 * 302-to-login-followed-into-a-200 the guard defends against. `r4032login` is
 * enabled but does not rewrite this POST. And a 4xx never swaps at all —
 * htmx's `responseHandling` sets `swap: false` for it — so a scenario built on
 * the cookie-clearing path would pass while exercising nothing.
 *
 * WHAT THE BODY IS. Valid HTML, a plausible login page, and deliberately
 * WITHOUT `id="bb-project-create-form"` — because the one property that
 * triggers the branch is that the form's own `hx-select` finds no match, which
 * makes `swapOuterHTML()` remove the target with no replacement
 * (`htmx.js:1698-1724`). Everything else about the response is irrelevant to
 * the branch and is kept ordinary so nothing else can explain the outcome.
 */
/**
 * Where the formless answer came from, so the rescue can be checked against it.
 *
 * `island.dialog_form.js` navigates to `xhr.responseURL` and not to the request
 * url, because a FOLLOWED REDIRECT is the whole case the guard exists for and
 * where the response came from is then the only address worth going to. A
 * fulfilled route answers at the request's own url, so for this scenario the
 * two coincide — which is exactly why the expectation is recorded from the
 * intercepted request rather than written as a literal: a step that asserted a
 * hand-typed path would still pass if the guard navigated somewhere else that
 * happened to match.
 */
let formlessAnswerUrl: string | null = null;

When('the next submit is answered without this form', async ({ page }) => {
  formlessAnswerUrl = null;
  await page.route(
    (url) => url.pathname.endsWith('/project/create'),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      formlessAnswerUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=UTF-8',
        body: '<!doctype html><html><head><title>Log in</title></head>'
          + '<body><main id="not-the-form"><h1>Log in</h1>'
          + '<form id="user-login-form"><input name="name"></form></main></body></html>',
      });
    },
  );
});

/**
 * Half one of the guard's purpose: no hull with nothing in it survives.
 *
 * THE SHAPE BEING REFUSED IS "A HULL WITH NO FORM IN IT", so that is what is
 * counted — `dialog[data-dialog]:not(:has(form))` — rather than hulls as such.
 * Scoping through `form#bb-project-create-form` would be the mistake in the
 * other direction: it would look for the very element whose absence IS the
 * defect, and pass exactly when the defect is present. Any `form` inside the
 * hull is enough to say the surface is not empty.
 *
 * IT USED TO COUNT HULLS OUTRIGHT, AND THAT WAS A TIMING WINDOW RATHER THAN A
 * CLAIM. The guard cancels the swap and then navigates, so the old hull — form
 * still in it — stays in the document until the navigation lands. A count of
 * ZERO hulls is therefore only ever true in the gap between two documents, and
 * the landing document under this mock is the create route answered in the
 * wrapper format, which is a hull WITH a form. The old assertion passed by
 * catching that gap on a slow enough runner.
 *
 * IT IS NON-VACUOUS, MEASURED: with the guard disabled the swap goes ahead,
 * `hx-select` matches nothing, `swapOuterHTML()` removes the form and puts
 * nothing back, and the hull left behind is exactly one match here.
 */
Then('the dialog is not left empty', async ({ page }) => {
  await expect(
    page.locator('dialog[data-dialog]:not(:has(form))'),
    'An empty dialog hull survived a response that held no form',
  ).toHaveCount(0, { timeout: 20000 });
});

/**
 * Half two, and it used to be claimed by a docblock and asserted by nothing.
 *
 * WHY IT IS A SEPARATE STEP RATHER THAN A SECOND LINE IN THE ONE ABOVE. The
 * review of 2026-09-09 found the previous step promising "BOTH HALVES, because
 * either alone is satisfiable by the wrong thing" and then asserting only the
 * removal. Folding this assertion back into that step would leave the feature
 * file reading exactly as it did while the claim was false; a criterion the
 * scenario states out loud is one a later reader can check without opening a
 * step file.
 *
 * THE HALVES REALLY ARE DISTINCT FAILURES. A hull correctly removed with no
 * navigation leaves the browser sitting on the screen the dialog was opened
 * over, with the operator's submit having produced nothing at all and no way to
 * tell why — removal alone is a quieter version of the same silence. This is
 * the half that says the operator was MOVED SOMEWHERE THEY CAN ACT, which is
 * what the decision recorded under AC11 actually promises: for the live session
 * case that is the login screen, and for this mocked one it is the create route
 * itself, reached as a whole page.
 *
 * COMPARED AS PATH PLUS QUERY, not as a whole url string: the base url differs
 * between a local DDEV world and CI, and `URL` is what normalises both sides
 * rather than a `startsWith` that would pass on a prefix.
 */
Then('the browser was taken to where that answer came from', async ({ page }) => {
  expect(
    formlessAnswerUrl,
    'No formless answer was served, so this step is asserting nothing.',
  ).not.toBeNull();
  const expected = new URL(formlessAnswerUrl as string);
  await expect
    .poll(
      () => {
        const at = new URL(page.url());
        return at.pathname + at.search;
      },
      {
        message: 'The guard removed the hull and left the operator where they were, with no answer at all',
        timeout: 20000,
      },
    )
    .toBe(expected.pathname + expected.search);
});
