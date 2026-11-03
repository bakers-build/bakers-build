// BB-420 Task 5 — the create-ticket dialog's pickers, from the browser.
//
// Task 4 delivered `BbTicketCreateForm`: it reads every field through the
// hidden inputs `option_picker.twig` already renders, and a cleared field is
// an absent key. Nothing server-side or Storybook-side can watch a PICK
// happen — `Drupal.attachBehaviors` never runs in a story — so this is the
// only surface that can assert `option_picker.js` actually writes.
//
// RULING R2 (Task 5 brief amendment): the dialog is opened by the
// `?create=ticket` query parameter directly, never by clicking the ticket
// list's own "New ticket" trigger — that trigger belongs to Task 6, a task
// numbered after this one, and depending on it here would be a circular
// build order.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { php } from '../../support/drush';
import { markDocument } from '../../support/shell';
import {
  optionRow,
  pickerPanel,
  pickerTrigger as pickerTriggerIn,
  safe,
  waitForPickerBehaviour,
} from '../../support/picker';

/**
 * The DOM id of the shell's overlay region — the ONE target every dialog-format
 * response is swapped into (BB-420 Task 24).
 *
 * It was `island-shell-ticket_create` until this task, an `island-<host>-<plugin>`
 * id owned by an island host that no longer exists. The overlay is a plain empty
 * container now, painted by `BbOverlaySource` into the shell's `overlay` slot,
 * and what lands in it arrives from a route.
 */
const OVERLAY = 'bakers-overlay';

/**
 * The dialog hull itself, wherever it is rendered.
 *
 * EVERY selector below scopes to THIS and not to the overlay, because the
 * dialog renders in two places now: swapped into `#bakers-overlay` when htmx
 * fetched it through the wrapper format, and inside ordinary main content on
 * the standalone page a scriptless click lands on. It is the same hull from the
 * same template either way — which is the point — so binding to it is what lets
 * one set of steps observe both.
 *
 * THE HULL HAS NO ID OF ITS OWN ANY MORE, which is what this selector had to
 * change for. It used to be `dialog#bakers-ticket-create`, an id
 * `bb-ticket-create.html.twig` wrote onto the hull it composed itself. Under
 * the operator ruling of 2026-09-08 both create dialogs take `island`'s generic
 * hull, that template is deleted, and the generic hull is passed no `id` prop
 * (`WrappedRouteRenderer::hullProps()`) — so every route the `island_dialog`
 * format wraps renders as `dialog#bakers-dialog`. Binding to that default would
 * bind to "whatever generic hull happens to be on the page"; binding to the
 * hull that CONTAINS this surface's own form names the surface. It is the
 * selector `project-create.steps.ts` has always used, for the reason that file
 * states, and the two files agree now because the two surfaces do.
 *
 * THE OLD ID WAS ALSO A DUPLICATE, and that history is worth keeping because it
 * is why the form id looks the way it does. Drupal independently derived
 * `bakers-ticket-create` for the `<form>` element from the form id, which was
 * `bb_ticket_create`; an id-only selector resolved to whichever came first —
 * the form, which carries no `open` attribute and is not the hull — and every
 * scenario in this file failed on `#bakers-ticket-create[open]` while the dialog
 * was squarely on screen. BB-421's re-entry renamed the form id to
 * `bb_ticket_create_form`, because core keys its htmx-form handling on the
 * `-form` suffix of the rendered id (`FormBuilder.php:781-791`).
 */
const TICKET_FORM = 'form#bb-ticket-create-form';
const DIALOG = `dialog[data-dialog]:has(${TICKET_FORM})`;

/**
 * The conductor label every "pick a conductor" scenario picks.
 *
 * The exact fixture `TicketCreateFormTest::setUp()` already builds for the
 * same field (`web/modules/custom/bb_core/tests/src/Kernel/TicketCreateFormTest.php`):
 * a project, and a conductor labelled `cw-framework` in it. Reusing the same
 * name is deliberate — the PHP suite and this browser suite are asserting the
 * same picker against the same fixture shape, not two different ones that
 * happen to look alike.
 */
const CONDUCTOR_ID = 'cw-framework';

/**
 * Ensures the `cw-framework` conductor fixture exists, idempotently.
 *
 * `ConductorByTicketProjectSelection` narrows by the TICKET's own project, so
 * this fixture's conductor must belong to the SAME project `anyProject()`
 * binds the dialog to; a conductor of a different project would render zero
 * rows in the "Conductor" panel this suite opens.
 *
 * Idempotent like `Given the ticket index is up to date`: a second run of
 * the suite must not create a second conductor of that label.
 */
function ensureConductorFixture(): void {
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$existing = $etm->getStorage("bb_conductor")->loadByProperties(["label" => "${CONDUCTOR_ID}"]);`,
      'if (!$existing) {',
      '$storage = $etm->getStorage("bb_project");',
      '$projects = $storage->loadMultiple();',
      '$project = null;',
      'foreach ($projects as $candidate) {',
      'if (count($candidate->get("teams")) === 1) { $project = $candidate; break; }',
      '}',
      '$project = $project ?: ($projects ? reset($projects) : NULL);',
      'if (!$project) {',
      '$project = $storage->create(["name" => "BB-420 fixture project"]);',
      '$project->save(); }',
      '$conductor = $etm->getStorage("bb_conductor")->create([',
      `"label" => "${CONDUCTOR_ID}",`,
      // Uid 1, an instance admin: a conductor is offered only while its owner can work in the project.
      '"owner_user_id" => 1,',
      '"status" => "online",',
      '"project_id" => $project->id(),',
      '"states" => ["working"],',
      '"last_seen" => \\Drupal::time()->getRequestTime(),',
      ']);',
      '$conductor->save(); }',
      'print "ok";',
    ].join(' '),
  );
}

/**
 * The public path of a workspace's ticket list, resolved rather than
 * hardcoded — the same reasoning `ticket-list.steps.ts`'s own
 * `ticketListPath()` gives, duplicated here rather than imported because
 * that helper is private to its file and this scenario needs only the one
 * workspace every other ticket-list scenario already uses.
 *
 * IT IS THE FULL TABLE, `/{workspace}/tickets/all`. The ticket list is two
 * Views displays: `my_work` holds the nav home and narrows to the reader's own
 * non-terminal tickets, `page_1` is the find-a-ticket table. The add action is
 * composed into `page_1`'s canvas header, and a ticket filed here — assigned to
 * whichever conductor the scenario picked, or to nobody — belongs to that table
 * rather than to the reader's own work, which is also the screen the dialog's
 * `HX-Location` returns to after a successful write.
 */
function bakersWorkspacePath(): string {
  const resolved = php(
    '$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")' +
      '->loadByProperties(["slug" => "bakers"])); print $w ? $w->get("slug")->value : "";',
  );
  if (!resolved) {
    throw new Error('No bb_workspace with slug "bakers" exists in the seeded world.');
  }
  return `/${resolved}/tickets/all`;
}

/**
 * The trigger of one property pill inside THIS dialog.
 *
 * A one-line binding of the shared driver to this surface's own hull. The
 * selector reasoning it used to restate — a pill's `title` carries the
 * SELECTION once one is made (`field_name ~ ": " ~ all_values`), so it stops
 * matching the bare field name after the very pick a scenario is making —
 * lives in `support/picker.ts` now, beside the code rather than in a copy of it.
 */
function pickerTrigger(page: Page, field: string) {
  return pickerTriggerIn(page, DIALOG, field);
}

/**
 * BB-420 Task 7 addition: a resolved project id rides along in the query.
 *
 * THE DIALOG IS OPENED THROUGH THE TRIGGER SINCE TASK 24, and by URL no longer,
 * because there is no URL that opens it over the list any more: the dialog is a
 * route, and `?create=ticket` on the ticket list opens nothing at all. The
 * project the dialog resolves its head on still comes from THIS screen's query
 * — the trigger forwards it — so the step still visits the list with
 * `?project=…` first; what changed is the click in between.
 *
 * NO LONGER THE ONLY WAY TO AN ENABLED SUBMIT (see the feature file's own
 * header comment): Task 11, Ruling R21/Defect B wired
 * `data-option-picker-requires="project_id"` on the submit through
 * `option_picker.js`'s `syncDependents()`, so a live pick in the "Project"
 * picker now enables it too — "Picking a project in the dialog enables the
 * submit" is that scenario's own proof. This step still resolves the project
 * up front, as a fixture convenience rather than a necessity: every scenario
 * below is exercising a DIFFERENT pick (conductor) followed by a submit, and
 * none of them needs to also drive the project picker to get there.
 *
 * Marked through `markDocument()` (`support/steps/shell.steps.ts`) rather than a
 * locally re-derived stamp, BB-420 Task 7 fix round 1: "the document was
 * not reloaded" (that file's own step text) has to mean one thing across the
 * whole suite, and the refusal scenario below is this file's own vehicle for
 * BB-408's two-click regression class — the dialog's reappearance after a
 * refusal is a real fragment swap, now that the submit-path defect this file
 * used to report here is fixed (commit 2187c6bf8).
 */
Given('I open the create-ticket dialog from the ticket list', async ({ page }) => {
  ensureConductorFixture();
  const { id: projectId } = anyProject();
  const response = await page.goto(`${bakersWorkspacePath()}?project=${projectId}`);
  expect(response?.status() ?? 0, 'The ticket list did not render').toBeLessThan(400);
  await page.getByRole('link', { name: 'New ticket', exact: true }).click();
  // The ASSERTION IS ON THE `<dialog>`, not on the overlay container: `dialog`
  // renders `position: fixed`, which takes it out of normal flow, so
  // `#bakers-overlay` — never sized by CSS — stays a 0×0 box even while the
  // dialog it contains is squarely on screen. Asserting the container's own
  // visibility would be asserting a box that is never meant to have one.
  await expect(page.locator(`${DIALOG}[open]`)).toBeVisible();
  await markDocument(page);
});

/**
 * The dialog detector both halves of BB-420 Task 6's own scenario need.
 *
 * Asserted on the `<dialog>` element itself and not on its island wrapper,
 * for the reason the `Given` step above already states: `dialog` is
 * `position: fixed`, so the wrapping `#island-shell-ticket_create` div is
 * never sized by CSS and stays a 0×0 box whether or not the dialog inside it
 * is open.
 */
/**
 * The conductor fixture, as a step of its own (BB-420 Task 22).
 *
 * Every other scenario in this file gets it as a side effect of `Given I open
 * the create-ticket dialog from the ticket list`. The through-the-trigger
 * scenario deliberately does NOT open the dialog that way — opening it by URL
 * is precisely the path it exists to stop trusting — so the fixture it needs
 * has to be asked for by name instead of inherited from an opener.
 *
 * The string is a parameter of the step and is checked against the constant
 * this file already builds, rather than silently ignored: a feature file
 * naming a conductor this step does not create would otherwise read as a
 * fixture declaration and be a no-op.
 */
Given('the conductor {string} exists', async ({}, conductorId: string) => {
  if (conductorId !== CONDUCTOR_ID) {
    throw new Error(
      `This step only builds the "${CONDUCTOR_ID}" fixture; "${conductorId}" was asked for.`,
    );
  }
  ensureConductorFixture();
});

Then('the create-ticket dialog is present', async ({ page }) => {
  await expect(page.locator(`${DIALOG}[open]`)).toBeVisible();
});

/**
 * The negative of the step above, needed by BB-420 Task 6's own scenario
 * (the dialog must be ABSENT on a plain visit) and by Task 7's negative
 * control (a broken selector must be able to report this side too, or every
 * absence assertion in this suite would pass for a typo).
 *
 * The overlay is an EMPTY container on a plain visit — `BbOverlaySource`
 * renders the element and nothing inside it — so there is no `<dialog>` in the
 * document at all, not a closed one.
 */
Then('the create-ticket dialog is not present', async ({ page }) => {
  await expect(page.locator(`${DIALOG}`)).toHaveCount(0);
});

/**
 * A real `bb_project`'s id and label, from the seeded world.
 *
 * Not scoped to a particular workspace: the scenario this serves opens the
 * dialog as "Administrator", whose `BbWorkspaceReadScope::isBypassed()` is
 * TRUE, so every project is reachable from any entry point and the claim
 * under test is narrower than tenancy — it is that the picker this SCREEN's
 * own trigger opens is not somehow starved of the candidates any other
 * entry point into the same dialog already offers.
 */
function anyProject(): { id: string; label: string } {
  const line = php(
    [
      '$storage = \\Drupal::entityTypeManager()->getStorage("bb_project");',
      '$projects = $storage->loadMultiple();',
      '$p = current($projects);',
      'print $p ? $p->id() . "|" . $p->label() : "";',
    ].join(' '),
  );
  const [id, label] = line.split('|');
  if (!id || !label) {
    throw new Error('No bb_project exists in the seeded world.');
  }
  return { id, label };
}

/**
 * BB-420 Task 6 fix round 1, Finding 1. Restored after a first attempt was
 * dropped on a wrong diagnosis (`ReferenceOptions` blamed for data that was
 * never missing) — the real defect was `BbTicketCreateForm` handing
 * `option_picker` a bare PHP `options` array where a rendered `option_list`
 * SLOT belongs, which `option_picker.twig`'s `{{ options }}` printed as
 * concatenated scalars with no `role="option"` row at all. This assertion is
 * the regression guard for exactly that class of defect — it does not stop
 * at "the label is somewhere in the DOM" the way the first attempt did, but
 * requires a REAL row: `role="option"` carrying the candidate's OWN
 * `data-value` (`option_list.twig`'s `<li role="option" data-value="…">`),
 * because a stringified array renders neither the element nor the
 * attribute.
 *
 * NOT `<input>` PRESENCE — a first draft of this check asserted a real
 * `<input>` inside the row and false-failed: `option_list` only renders one
 * per row when its caller passes `input_name` (the JS-disabled-operable
 * form the ticket list's OWN facets need), and `form.twig`'s `pill()` macro
 * — the shape `BbTicketCreateForm` now matches — deliberately does not,
 * because a dialog's field-variant pill writes through `option_picker.js`'s
 * hidden inputs instead. Checking for `<input>` would have measured the
 * FACET aside's identically-labelled "Project" filter, elsewhere on this
 * same page, rather than the dialog's own picker — `data-value` is what
 * both shapes of `option_list` row carry in common.
 *
 * Not gated on the picker being open — `option_picker.twig` renders the
 * panel `hidden` rather than absent, so its rows are attached (if not
 * visible) even collapsed, exactly like every other panel-presence
 * assertion in this suite.
 */
/**
 * BB-664 AC-1: a dialog opened from a project route carries the project as
 * resolved server-side context, never as an editable picker — this replaces
 * the pre-BB-664 step that asserted the opposite (the picker existed and
 * read the list's own project). `alterFormDisplay()` only adds the widget
 * back when nothing bound a project yet, so its absence here is the
 * positive assertion, not merely "something else wasn't found".
 */
Then("the dialog carries the list's project with no editable picker", async ({ page }) => {
  const trigger = pickerTrigger(page, 'Project');
  await expect(trigger, 'A route-bound dialog must not offer an editable project picker').toHaveCount(0);
});

/**
 * The AC-8 counterpart of the assertion above: a screen with no route/query
 * project ({@see BbTicketCreateForm::alterFormDisplay()}) must offer the
 * picker back, reusing the same widget rather than a second screen.
 */
Then('the dialog offers an editable project picker', async ({ page }) => {
  const trigger = pickerTrigger(page, 'Project');
  await expect(trigger, 'An unbound dialog must offer an editable project picker').toBeAttached();
});

When('I open the {string} picker', async ({ page }, field: string) => {
  const trigger = pickerTrigger(page, field);
  await expect(trigger, `No picker is called "${field}"`).toBeAttached();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

/**
 * Picks one option the way a pointer user does — a click on its
 * `role="option"` row, found by the visible label rather than by its
 * submitted value, exactly as the ticket-list facets are picked.
 */
When('I pick the option {string}', async ({ page }, label: string) => {
  const trigger = page
    .locator(`${DIALOG} [data-option-picker-trigger][aria-expanded="true"]`)
    .first();
  await expect(trigger, 'No picker is currently open').toBeAttached();
  const row = pickerPanel(trigger)
    .locator('[role="option"]')
    .filter({ has: page.locator('.option-list__label', { hasText: label }) })
    .first();
  await expect(row, `The open picker offers no "${label}" option`).toBeAttached();
  await row.click();
});

Then('the {string} pill reads {string}', async ({ page }, field: string, value: string) => {
  // The trigger renders the field name AND the value once one is set
  // (`option_picker.twig`'s C17 rendering: "Conductor · cw-framework"), so
  // this is read off the SAME trigger `pickerTrigger()` found before the
  // pick — the field name span never stops rendering — and its full text is
  // asserted to contain the picked value.
  const trigger = pickerTrigger(page, field);
  await expect(trigger, `No picker is called "${field}"`).toBeAttached();
  await expect(trigger).toContainText(value);
});

/**
 * Resolves what a reference field actually submits for a picked label.
 *
 * `ReferenceOptions::for()` keys every candidate by its TARGET ENTITY ID —
 * `conductor.id()`, a numeric primary key — never by the conductor label,
 * the human-legible string this scenario picks by. That is the same split every
 * other picker in this suite reads by: `ticket-list.steps.ts`'s facets are
 * picked by label and asserted by the machine value underneath it. A
 * `conductor_id` field is the one submitted name this scenario knows to resolve
 * this way; any other field name is asserted on the literal string given,
 * which is correct for a field whose submitted value already IS its label
 * (e.g. a free-text one).
 */
function resolvedSubmittedValue(name: string, label: string): string {
  if (name !== 'conductor_id') {
    return label;
  }
  const id = php(
    '$c = current(\\Drupal::entityTypeManager()->getStorage("bb_conductor")' +
      `->loadByProperties(["label" => "${safe(label)}"])); print $c ? $c->id() : "";`,
  );
  if (!id) {
    throw new Error(`No bb_conductor labelled "${label}" exists in the seeded world.`);
  }
  return id;
}

Then(
  'the form will submit {string} as {string}',
  async ({ page }, name: string, value: string) => {
    const input = page.locator(`${DIALOG} input[type="hidden"][name="${name}"]`);
    await expect(input, `No hidden input named "${name}" is in the form`).toHaveCount(1);
    await expect(input).toHaveValue(resolvedSubmittedValue(name, value));
  },
);

/**
 * Clicks the clear row of an already-open picker.
 *
 * The clear row is a `role="option"` row like any other (`option_list.twig`
 * says so at length: clearing is a value the operator picks, not a button
 * bolted above the list), found here by its own `data-option-list-clear`
 * marker rather than by a label — "— none —" / "No conductor" is a caller's
 * wording, not a stable string this step should depend on.
 */
When('I clear the {string} picker', async ({ page }, field: string) => {
  const trigger = pickerTrigger(page, field);
  await expect(trigger, `No picker is called "${field}"`).toBeAttached();
  await expect(trigger, `The "${field}" picker is not open`).toHaveAttribute('aria-expanded', 'true');
  const clearRow = pickerPanel(trigger).locator('[data-option-list-clear]');
  await expect(clearRow, `The "${field}" picker offers no clear row`).toBeAttached();
  await clearRow.click();
});

/**
 * AC3's client half, asserted directly: a cleared field is an ABSENT key.
 *
 * Not "an input with an empty value" — `toHaveCount(0)` is the only
 * assertion that tells the two apart, and the two are not interchangeable:
 * `BbTicketCreateForm` reads every field with `?? NULL`, so a submitted
 * empty string and a missing key both currently resolve the same way on the
 * server, but the CLIENT contract this file owns is specifically that no
 * input rides along at all once a field is cleared.
 */
Then('the form will submit nothing for {string}', async ({ page }, name: string) => {
  const input = page.locator(`${DIALOG} input[type="hidden"][name="${name}"]`);
  await expect(input, `A hidden input named "${name}" is still in the form`).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// BB-420 Task 7 — the rest of the surface. See the feature file's own
// header comment (immediately above the `@negative-control` scenario) for
// the full, measured account of the submit-path defect several of the
// scenarios below are RED against.
// ---------------------------------------------------------------------------

/** The dialog's own `<dialog open>` element, scoped once for every step below. */
function dialogRoot(page: Page) {
  return page.locator(`${DIALOG}[open]`);
}

/**
 * The dialog's head slot, empty since BB-420 Task 34.
 *
 * It used to carry `project_id` (`action-pattern.md` rule 8: the context
 * control, never one of the body's peer pills). The addendum moved
 * `project_id` into the pill row beside `team`, so the head this dialog
 * composes now has no control placed in it at all — this is the negative
 * of what "the dialog head carries the project picker" used to assert.
 *
 * FORCED SELECTOR EXCEPTION (`.dialog__head`, WORKFLOW.md's
 * `data-component-id` rule): `dialog.twig` renders this element as a plain
 * `<div class="dialog__head …">` — no `role`, no `aria-*`, no `data-`
 * attribute of its own (unlike `.dialog__body`, its sibling, which is the
 * same story below).
 */
Then('the dialog head is empty', async ({ page }) => {
  const head = dialogRoot(page).locator('.dialog__head [data-option-picker-name]');
  await expect(head, 'A picker is unexpectedly rendered in the dialog head').toHaveCount(0);
});

/**
 * AC 6's cardinality claim, checked by the one HTML attribute that actually
 * tells a submit apart from the dialog's OTHER two buttons — the ghost
 * "Close dialog" control (`dismissible: TRUE`) and the ghost "Cancel" action
 * both render as plain `<button type="button">`/`<a>`, so `[type="submit"]`
 * is what is left to bind to without touching a class.
 */
Then('the dialog has exactly one submit and one cancel', async ({ page }) => {
  const dialog = dialogRoot(page);
  await expect(dialog.locator('button[type="submit"]')).toHaveCount(1);
  await expect(dialog.getByRole('link', { name: 'Cancel', exact: true })).toHaveCount(1);
});

/**
 * The same cardinality claim on the SCRIPTLESS page, where there is no hull to
 * scope it to (operator ruling of 2026-09-08).
 *
 * SCOPED TO THE FORM AND NOT TO A DIALOG, which is the whole difference. The
 * hull is built by the wrapper format — a main-content renderer core selects
 * from `?_wrapper_format=island_dialog` — so it does not exist on a plain page
 * load, and the two controls render inside the form's own body there because
 * `bb-create-dialog.html.twig` prints the action row into
 * `bb_theme:form`'s `actions` slot whenever the row has not been lifted away.
 * On the htmx path the same two controls are in the hull's footer, which is
 * what the parity feature asserts.
 */
Then(
  'the create-ticket form is present with exactly one submit and one cancel',
  async ({ page }) => {
    const form = page.locator(TICKET_FORM);
    await expect(form, 'The create-ticket form did not render').toBeVisible();
    await expect(form.locator('button[type="submit"]')).toHaveCount(1);
    await expect(form.getByRole('link', { name: 'Cancel', exact: true })).toHaveCount(1);
  },
);

/**
 * The named cost of one shared hull, asserted so it cannot regress by accident
 * in either direction.
 *
 * A `<dialog>` appearing here again would mean some surface had grown a second
 * hull composition — the exact thing the ruling removed — and its absence is
 * what makes the amended scenario above a measurement rather than a shrug.
 * Asserted document-wide and not scoped to the form, because a hull would by
 * definition be OUTSIDE it.
 */
Then('no dialog hull is rendered around it', async ({ page }) => {
  await expect(
    page.locator('dialog'),
    'A dialog hull is rendered on the scriptless page — has a surface composed its own hull again?',
  ).toHaveCount(0);
});

/**
 * Rule 9: assignee follows from conductor, so there is no element for it —
 * the create form display names no assignee component at all, and its
 * `hidden` map says so by name. Checked two ways: no picker names the field,
 * and the word itself is not on the dialog (a differently-named control that
 * still spoke of an assignee would slip past the first check alone).
 */
Then('the dialog has no assignee control', async ({ page }) => {
  const dialog = dialogRoot(page);
  await expect(dialog.locator('[data-option-picker-name="assignee"]')).toHaveCount(0);
  // The entity's own name for the field, which is what a widget would submit
  // it under since BB-420 Task 17 — the shape a mistakenly-configured
  // assignee component on the create form display would actually take.
  await expect(dialog.locator('[data-option-picker-name="assignee_user_id"]')).toHaveCount(0);
  await expect(dialog).not.toContainText('Assignee');
});

/** The workflow picker retains its labelled group alongside the title. */
Then('{string} has a labelled group alongside the text lines', async ({ page }, field: string) => {
  const dialog = dialogRoot(page);
  const lead = dialog
    .getByRole('group')
    .filter({ has: page.locator(`[data-option-picker-name="${field}"]`) });
  await expect(lead, `No "${field}" picker sits in a labelled lead group`).toBeAttached();
  const titleLine = dialog.getByRole('textbox', { name: 'Title' });
  await expect(titleLine, 'No title line is rendered').toBeAttached();
  await expect(lead).toBeVisible();
  await expect(titleLine).toBeVisible();
});

/**
 * Grammar rule 3: the peer pills are exactly this set, in this order — a
 * surface that grew an eighth field or reordered the three would no longer
 * be the agreed one. Read by `data-option-picker-name`, never by a visible
 * label, so a relabel cannot silently pass this as a field rename.
 *
 * Scoped by `role="group" aria-label="Properties"` (`form.twig:199`, set
 * unconditionally on this row) rather than `.form__properties`.
 */
Then('the peer pills are exactly {string}', async ({ page }, expected: string) => {
  const names = expected.split(',').map((s) => s.trim().toLowerCase());
  const pills = dialogRoot(page)
    .getByRole('group', { name: 'Properties' })
    .locator('[data-option-picker-name]');
  await expect(pills).toHaveCount(names.length);
  for (let i = 0; i < names.length; i += 1) {
    await expect(pills.nth(i)).toHaveAttribute('data-option-picker-name', names[i]);
  }
});

/**
 * `option_picker.twig`'s bare "—" only ever renders for a field with no
 * name at all (`is_inline or field_name is empty`) — never the case for any
 * of this dialog's named pills. A regression that dropped a `label:` would
 * show up here as a dash rather than as a missing string, which is why this
 * is its own assertion and not folded into the shape scenario's other ones.
 *
 * The value's data hook scopes this check independently of styling.
 */
Then('no pill renders a bare dash', async ({ page }) => {
  const values = dialogRoot(page).locator('[data-picker-part="value"]');
  const count = await values.count();
  for (let i = 0; i < count; i += 1) {
    const text = (await values.nth(i).innerText()).trim();
    expect(text, 'A pill rendered a bare "—" instead of its field name').not.toBe('—');
  }
});

/**
 * AC 4: the note `BbTicketCreateForm::conductorNote()` renders beneath the
 * pill row, naming the conductor's effect rather than asking for a
 * confirmation. Bound to the component id `option_picker`/`option_list`
 * siblings are bound to elsewhere in this file — never to `.note`, the
 * component's own presentational class.
 *
 * `toBeVisible()` is the LOAD-BEARING assertion here (fix round 1, Finding
 * 1) — not merely a nice-to-have alongside the text checks. BB-420 Task 11
 * made this note ALWAYS present in the DOM, `hidden` when no conductor is
 * set, so `option_picker.js` has something to reveal on a pick; `textContent`
 * (what `toContainText()` reads) is populated regardless of the `hidden`
 * attribute. Without a visibility check, this step would pass identically
 * even if the pick never toggled `hidden` off at all — which is exactly the
 * defect this scenario exists to catch. A hidden note names nothing to the
 * operator, whatever its text says.
 */
Then(
  'a note beneath the pill row names the agent run on {string}',
  async ({ page }, conductorLabel: string) => {
    const note = dialogRoot(page).locator('[data-component-id="bb_theme:note"]');
    await expect(note, 'No note is rendered beneath the pill row').toBeAttached();
    await expect(note, 'The note is in the DOM but not visible (still `hidden`)').toBeVisible();
    await expect(note).toContainText('agent run');
    await expect(note).toContainText(conductorLabel);
  },
);

/**
 * The negative of the step above (fix round 1, Finding 2): the note must
 * become invisible again once the conductor that made it visible is
 * cleared — Ruling R21's second explicit requirement, and the half the
 * original AC4 scenario never exercised (it picks, asserts, then submits;
 * it never clears). Checked on the SAME element the positive assertion
 * binds to, not a fresh locator, so a caller cannot silently drift onto a
 * different note were this dialog ever to grow a second one.
 */
Then('the note beneath the pill row is hidden again', async ({ page }) => {
  const note = dialogRoot(page).locator('[data-component-id="bb_theme:note"]');
  await expect(note, 'No note is rendered beneath the pill row').toBeAttached();
  await expect(note, 'The note is still visible after the conductor was cleared').toBeHidden();
});

/** Whatever native `window.confirm()`/`alert()` fired during the last submit. */
let nativeDialogSeen = false;

/** The last submit's own request body, for the wire-level AC 2 assertion. */
let lastSubmittedFormData: URLSearchParams | null = null;

/**
 * Clicks the dialog's own submit and waits for its round trip.
 *
 * The submit is asserted ENABLED first rather than merely clicked — a
 * disabled button fails Playwright's actionability check with an opaque
 * 30s timeout, and the real reason (no project resolved at the navigation
 * that opened this dialog) is exactly the fact this file's `Given` step now
 * exists to avoid; a clear failure here means that safeguard itself broke.
 *
 * A native `dialog` event (`window.confirm()`/`alert()`) is listened for
 * and auto-dismissed BEFORE the click, so AC 4's "no confirmation dialog
 * opened" has something to fail against — a listener attached after the
 * fact could miss a dialog that opens and self-resolves inside the same
 * task, and an unhandled one would otherwise hang the page.
 *
 * The submitted request's OWN body is captured independently of whatever
 * the response turns out to be (see the feature file's header comment): AC
 * 2 is provable on the wire even on the day the response is not.
 */
When('I submit the dialog', async ({ page }) => {
  nativeDialogSeen = false;
  lastSubmittedFormData = null;
  page.once('dialog', (dialog) => {
    nativeDialogSeen = true;
    void dialog.dismiss();
  });
  const submit = dialogRoot(page).locator('button[type="submit"]');
  await expect(submit, 'No enabled submit is present to click').toBeEnabled();
  const requestCaptured = page.waitForRequest(
    (request) => request.method() === 'POST',
    { timeout: 20000 },
  );
  const responded = page
    .waitForResponse((response) => response.request().method() === 'POST', { timeout: 20000 })
    .catch(() => null);
  await submit.click();
  const request = await requestCaptured;
  lastSubmittedFormData = new URLSearchParams(request.postData() ?? '');
  await responded;
});

// Exercise server validation independently of the browser's required check.
When('I submit the ticket dialog without browser validation', async ({ page }) => {
  await dialogRoot(page).locator('form').evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  const response = page.waitForResponse((response) => response.request().method() === 'POST');
  await dialogRoot(page).locator('button[type="submit"]').click();
  await response;
});

Then('no confirmation dialog opened', async () => {
  expect(nativeDialogSeen, 'A native confirm()/alert() dialog opened on submit').toBe(false);
});

/** The title typed by the most recent "into the title line" step. */
let lastTypedTitle: string | null = null;

When('I type {string} into the title line', async ({ page }, text: string) => {
  lastTypedTitle = text;
  const title = dialogRoot(page).getByRole('textbox', { name: 'Title' });
  await title.fill(text);
});

When('I type {string} into the description line', async ({ page }, text: string) => {
  const description = dialogRoot(page).getByRole('textbox', { name: 'Description' });
  await description.fill(text);
});

/**
 * Clicks the clear row of an already-open picker, addressed by the CLEAR
 * ROW'S OWN label rather than by the field's name — the counterpart of "I
 * clear the {string} picker" above, needed because AC 4/AC 3's scenarios
 * open the picker by field name first and then must pick a SPECIFIC row
 * (there is more than one clear row in this dialog, one per clearable
 * pill).
 */
When('I pick the clear row {string}', async ({ page }, label: string) => {
  const trigger = page
    .locator(`${DIALOG} [data-option-picker-trigger][aria-expanded="true"]`)
    .first();
  await expect(trigger, 'No picker is currently open').toBeAttached();
  const clearRow = pickerPanel(trigger)
    .locator('[data-option-list-clear]')
    .filter({ hasText: label });
  await expect(clearRow, `The open picker's clear row is not labelled "${label}"`).toBeAttached();
  await clearRow.click();
});

/**
 * THE OPERABILITY CLAIM, the ticket dialog's half of BB-421's re-entry.
 *
 * "The dialog is still present" was already true while this surface was
 * UNUSABLE — that is exactly the defect the project dialog's own scenario was
 * written for, and the two dialogs are on the same mechanism now, so the claim
 * has to be made on both. Three facts, none of which presence implies:
 *
 *   1. `form_build_id` is in the document, exactly once. Core hangs
 *      `data-hx-swap-oob` on the rebuilt input whenever `HX-Target` does not end
 *      in `-form` or differs from `HX-Trigger`; htmx's out-of-band pass runs
 *      BEFORE the main swap, so the new value was written over the old input
 *      inside the very subtree the main swap then replaced, and the document
 *      ended up with none. With no build id there is no next submit at all.
 *   2. Every picker got its behaviour back. SIX of them, which is this
 *      display's own field set minus its two text lines (`workflow`,
 *      `project_id`, `team`, `parent_id`, `conductor_id`, `labels`) — asserted
 *      as a COUNT first, because "the ones that exist are attached" is a
 *      weaker claim that a surface which quietly lost a field would satisfy.
 *   3. The hull itself is wired, AND ITS CLOSE CONTROL IS STILL THERE. What
 *      this claim means changed with the operator ruling of 2026-09-08: this
 *      dialog used to compose its own hull INSIDE the form, so the `<dialog>`
 *      element really was replaced by every refusal swap and the `once()` marker
 *      was a claim about RE-attachment. Both dialogs take `island`'s generic
 *      hull now, the refusal swap replaces the `<form>` alone, and the marker is
 *      a claim about SURVIVAL — the weaker of the two readings, which is why
 *      the close CONTROL is asserted beside it: a hull that kept its marker
 *      while losing the control an operator reaches for would satisfy the
 *      marker alone.
 */
Then('the create-ticket dialog is still operable', async ({ page }) => {
  const dialog = dialogRoot(page);

  await expect(
    dialog.locator('input[name="form_build_id"]'),
    'The refused dialog holds no form_build_id — the next submit cannot be made',
  ).toHaveCount(1);

  // Seven, not eight (BB-664): every scenario that reaches this step opens a
  // route/query-BOUND dialog ("I open the create-ticket dialog from the
  // ticket list" always carries `?project=`), and a bound dialog never
  // renders the "Project" picker — see "the dialog carries the list's
  // project with no editable picker" elsewhere in this file.
  const pickers = dialog.locator('[data-option-picker]');
  await expect(
    pickers,
    'The refused dialog does not render all seven pickers of the bound create display',
  ).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) {
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

Then('the dialog closed', async ({ page }) => {
  await expect(page.locator(`${DIALOG}[open]`)).toHaveCount(0);
});

/**
 * The same assertion "the dialog is present" makes, under the wording AC
 * 5's scenario states it with — kept as its own registration rather than a
 * second string for the same step, so a reviewer reading the feature file
 * finds the sentence that is actually there.
 */
Then('the dialog is still present', async ({ page }) => {
  await expect(dialogRoot(page)).toBeVisible();
});

/**
 * `dialog.twig` renders `message` ABOVE `body` unconditionally (its own
 * docblock: "a form-level refusal has to appear where the writer is
 * looking, not below the fields it complains about") — checked here on the
 * real layout, not merely on DOM order, for the same reason the lead-row
 * placement check above is.
 *
 * FORCED SELECTOR EXCEPTION (`.dialog__body`, WORKFLOW.md's
 * `data-component-id` rule): `dialog.twig` renders this element the same
 * way it renders `.dialog__head` (see that step's own comment above) — a
 * plain `<div>` with no `role`, no `aria-*` and no `data-` attribute at all.
 * There is no compliant alternative to bind to here.
 */
Then('a form-level error is shown above the body', async ({ page }) => {
  const dialog = dialogRoot(page);
  const message = dialog.locator('[data-component-id="bb_theme:message"]');
  await expect(message, 'No form-level error message is shown').toBeAttached();
  const body = dialog.locator('.dialog__body');
  const messageBox = await message.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(messageBox, 'The error message has no box').not.toBeNull();
  expect(bodyBox, 'The dialog body has no box').not.toBeNull();
  expect(messageBox!.y, 'The error message does not sit above the body').toBeLessThan(bodyBox!.y);
});

Then('the title line still reads {string}', async ({ page }, text: string) => {
  await expect(dialogRoot(page).getByRole('textbox', { name: 'Title' })).toHaveValue(text);
});

Then('the description line still reads {string}', async ({ page }, text: string) => {
  await expect(dialogRoot(page).getByRole('textbox', { name: 'Description' })).toHaveValue(text);
});

/**
 * A refused pill keeps ITS OWN picked value on screen — checked by the
 * presence of the trigger's value span, not by re-reading the specific
 * label, because the assertion is about survival through a refusal rather
 * than about which value survived (the AC 5 scenario that calls this names
 * the field, "Conductor", but not the picked label again).
 *
 * A value span is present only while the named pill carries a selection.
 */
Then('the {string} pill still carries its value', async ({ page }, field: string) => {
  const trigger = pickerTrigger(page, field);
  await expect(trigger, `No picker is called "${field}"`).toBeAttached();
  await expect(
    trigger.locator('[data-picker-part="value"]'),
    `The "${field}" pill no longer shows a value`,
  ).toBeAttached();
});

/**
 * AC 2 on the wire. Reads the REQUEST `I submit the dialog` captured, not
 * the response — independent of the measured submit-path defect, and the
 * only one of the eight Task 7 scenarios that is.
 */
Then(
  'the submitted request carried no {string}, {string}, {string}, {string}, {string} or {string}',
  async ({}, a: string, b: string, c: string, d: string, e: string, f: string) => {
    if (lastSubmittedFormData === null) {
      throw new Error('No submit has been captured yet — did "I submit the dialog" run first?');
    }
    for (const name of [a, b, c, d, e, f]) {
      expect(
        lastSubmittedFormData.has(name),
        `The submitted request carried a server-owned field "${name}"`,
      ).toBe(false);
    }
  },
);

/**
 * The ticket list's own text, searched page-wide rather than scoped to the
 * list island's own DOM id (private to `ticket-list.steps.ts`, and
 * duplicating a literal id string here would be a second place that has to
 * agree with it) — sufficient because the title this looks for is unique to
 * the ticket this scenario itself created.
 */
Then('the ticket list shows {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text).first()).toBeVisible();
});

/**
 * One created ticket's stored facts, read by the TITLE the scenario itself
 * typed — never off the form, which is the whole point of AC 1/AC 3: the
 * claim is about what got WRITTEN, not about what the screen still shows.
 */
function loadCreatedTicketFacts(
  title: string,
): { workflow: string; state: string; conductorLabel: string; projectLabel: string } {
  const line = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$found = $etm->getStorage("bb_ticket")->loadByProperties(["title" => "${safe(title)}"]);`,
      '$t = $found ? end($found) : NULL;',
      'if (!$t) { print ""; } else {',
      '$c = $t->get("conductor_id")->entity;',
      '$p = $t->get("project_id")->entity;',
      'print $t->get("workflow")->value . "|" . $t->get("state")->value . "|" . ($c ? $c->label() : "") . "|" . ($p ? $p->label() : "");',
      '}',
    ].join(' '),
  );
  const [workflow, state, conductorLabel, projectLabel] = line.split('|');
  if (!workflow) {
    throw new Error(`No bb_ticket titled "${title}" exists in the seeded world — was it ever saved?`);
  }
  return { workflow, state, conductorLabel: conductorLabel ?? '', projectLabel: projectLabel ?? '' };
}

function requireLastTypedTitle(): string {
  if (lastTypedTitle === null) {
    throw new Error('No title has been typed yet — did an "into the title line" step run first?');
  }
  return lastTypedTitle;
}

Then('the stored ticket has conductor {string}', async ({}, conductorLabel: string) => {
  const facts = loadCreatedTicketFacts(requireLastTypedTitle());
  expect(facts.conductorLabel, 'The stored ticket does not carry the expected conductor').toBe(conductorLabel);
});

Then('the stored ticket has no conductor', async () => {
  const facts = loadCreatedTicketFacts(requireLastTypedTitle());
  expect(facts.conductorLabel, 'The stored ticket unexpectedly carries a conductor').toBe('');
});

/**
 * BB-664 AC-8: the project-less-entry-point's own write assertion — what a
 * picked project actually lands on the stored entity, not merely that a
 * picker existed to pick it from.
 */
Then('the stored ticket belongs to project {string}', async ({}, projectLabel: string) => {
  const facts = loadCreatedTicketFacts(requireLastTypedTitle());
  expect(facts.projectLabel, 'The stored ticket does not carry the expected project').toBe(projectLabel);
});

/**
 * The same assertion against `anyProject()`'s OWN resolved label, for the
 * scenario that picks whichever project the fixture world happens to offer
 * (via `I pick a project option`) rather than naming one literally.
 */
Then('the stored ticket belongs to the picked project', async () => {
  const { label } = anyProject();
  const facts = loadCreatedTicketFacts(requireLastTypedTitle());
  expect(facts.projectLabel, 'The stored ticket does not carry the picked project').toBe(label);
});

Then("the stored ticket is in its workflow's first state", async () => {
  const facts = loadCreatedTicketFacts(requireLastTypedTitle());
  const firstState = php(
    `$def = \\Drupal::service("plugin.manager.workflow")->getDefinition("${safe(facts.workflow)}", FALSE); ` +
      'print $def ? array_key_first($def["states"]) : "";',
  );
  if (!firstState) {
    throw new Error(`No workflow plugin "${facts.workflow}" is defined.`);
  }
  expect(facts.state, `Expected the stored ticket's state to be its workflow's first ("${firstState}")`).toBe(
    firstState,
  );
});

/**
 * Visits `/{workspace}/tickets` — the MY WORK display, not the full table.
 *
 * BB-315 split the ticket list into two Views displays and the create
 * action landed only on `page_1` (`/tickets/all`), so the screen the
 * navigation actually lands an operator on offered no way to file a ticket
 * at all. The action is on `my_work`'s own `page_header` now, and this step
 * is what lets the scenario below observe it there rather than on the table
 * every other scenario in this file uses.
 *
 * Marked through `markDocument()` for the same reason `I visit the ticket
 * list` is: `the document was not reloaded` is that detector's step text.
 */
When('I visit the My work list', async ({ page }) => {
  const response = await page.goto(bakersWorkspacePath().replace(/\/all$/, ''));
  expect(response?.status() ?? 0, 'The My work list did not render').toBeLessThan(400);
  await markDocument(page);
});

/**
 * Visits a project's OWN tickets tab (`project_tickets`), a true
 * `bb_project` ROUTE parameter rather than the `?project=` facet query
 * the shared `Given` step above forwards.
 *
 * BB-664 review finding 2: the two scenarios below used to visit the
 * route-less `/tickets/all` table and then assert the route-bound dialog
 * behaviour (no picker, a scoped conductor) — a claim that table can never
 * make, since nothing on it binds a project at all. `TicketCreateActionSource
 * ::routeBoundQuery()` reads the `bb_project` route parameter specifically,
 * so this is the one navigation that exercises the actual AC-1 path: a
 * screen whose OWN route names a project.
 */
When("I visit the project's own ticket list", async ({ page }) => {
  ensureConductorFixture();
  const { id: projectId } = anyProject();
  const url = php(
    `$p = \\Drupal::entityTypeManager()->getStorage("bb_project")->load("${projectId}"); ` +
      'print $p ? $p->toUrl()->toString() . "/tickets" : "";',
  );
  if (!url) {
    throw new Error(`No bb_project "${projectId}" resolves a canonical URL.`);
  }
  const response = await page.goto(url);
  expect(response?.status() ?? 0, "The project's own ticket list did not render").toBeLessThan(400);
  await markDocument(page);
});

/**
 * A plain GET of the ticket list carrying whatever query the scenario names.
 *
 * The same request shape a bookmarked or shared URL would make. It no longer
 * OPENS anything — `?create=ticket` was the island host's gate and the island
 * is gone — so the scenarios that use it now click the trigger afterwards.
 */
When('I visit the ticket list with {string}', async ({ page }, query: string) => {
  const response = await page.goto(`${bakersWorkspacePath()}?${query}`);
  expect(response?.status() ?? 0, 'The ticket list did not render').toBeLessThan(400);
});

/**
 * Follows the trigger as a browser with no JavaScript does: a plain navigation.
 *
 * BB-420 Task 24 changed the no-JS surface KNOWINGLY. It used to be the
 * dialog rendered over the list, server-side, off `?create=ticket`; it is a
 * standalone page now, because the trigger is an ordinary link to the dialog's
 * own route and nothing but htmx ever turned that click into a fragment fetch.
 * The dialog itself is unchanged — the same hull, composed by the same
 * template, because the surface owns its hull rather than the wrapper format —
 * so what the operator loses is the list behind it, not the surface.
 */
When('I follow the {string} action', async ({ page }, name: string) => {
  const trigger = page.getByRole('link', { name, exact: true });
  await expect(trigger, `No "${name}" action is on the page`).toBeAttached();
  const href = await trigger.getAttribute('href');
  expect(href, 'The action carries no plain href for a scriptless click').toBeTruthy();
  const response = await page.goto(href as string);
  expect(response?.status() ?? 0, 'The dialog route did not render').toBeLessThan(400);
});

/**
 * The standalone page is a WORKING page, not merely a rendered one.
 *
 * Asserted on the address as well as on the surface: a click that silently fell
 * back to the list would still show a dialog if the list happened to have one,
 * and would not be what this scenario claims.
 */
Then('the page is the create-ticket route', async ({ page }) => {
  expect(new URL(page.url()).pathname).toContain('/ticket/create');
});

/**
 * THE SINGLE-TARGET CLAIM, asserted on the delivered DOM.
 *
 * The whole re-hosting rests on the response settling exactly one element:
 * core's htmx bridge reads `detail.elt` a microtask after `htmx:afterSettle`,
 * and with two settled elements the late read answers the last one for both
 * dispatches — which is how the dialog once arrived with five unwired option
 * pickers. There is no way to observe "one element settled" after the fact, but
 * there is a way to observe that the dialog came from the ONE place that can
 * settle: it is inside `#bakers-overlay`, the shell's own empty container, and
 * not beside it.
 */
Then('the dialog is inside the shell overlay', async ({ page }) => {
  // A DESCENDANT and not a child: the swapped fragment's outermost element is
  // the `<form>` core's `#theme_wrappers` puts round it, and the hull is inside
  // that.
  await expect(page.locator(`#${OVERLAY} ${DIALOG}`)).toBeAttached();
});

// ---------------------------------------------------------------------------
// BB-420 Task 11, Defect B: a client-side project pick never touched the
// submit's own `disabled` attribute. See the feature file's own scenario
// comment for the measured defect this guards.
// ---------------------------------------------------------------------------

/**
 * Picks a project by whichever label `anyProject()` resolves, rather than a
 * literal named in the feature file — the same reasoning `anyProject()`'s own
 * docblock gives: the claim under test is that PICKING A PROJECT enables the
 * submit, not that any particular fixture project does.
 *
 * Reused by BB-664's unbound-dialog scenario for the same reason: the
 * project this picks is whichever one the fixture world actually resolves,
 * and `the stored ticket belongs to project {string}` step reads the same
 * `anyProject()` label back to assert it landed.
 */
When('I pick a project option', async ({ page }) => {
  const { label } = anyProject();
  const trigger = page
    .locator(`${DIALOG} [data-option-picker-trigger][aria-expanded="true"]`)
    .first();
  await expect(trigger, 'No picker is currently open').toBeAttached();
  const row = pickerPanel(trigger)
    .locator('[role="option"]')
    .filter({ has: page.locator('.option-list__label', { hasText: label }) })
    .first();
  await expect(row, `The open picker offers no "${label}" option`).toBeAttached();
  await settledProjectRefresh(page, () => row.click());
});

Then('the submit is enabled', async ({ page }) => {
  await expect(dialogRoot(page).locator('button[type="submit"]')).toBeEnabled();
});

/**
 * The description field is Markdown and offers no format chooser, so none of
 * the text-format help core attaches to a format widget may show.
 */
Then('the dialog shows no text-format help', async ({ page }) => {
  await expect(dialogRoot(page)).toBeVisible();
  await expect(dialogRoot(page)).not.toContainText(/About text formats|Allowed HTML tags|Parses markdown/);
});

/**
 * Every picker's menu opens within the dialog's own box and closes on Escape,
 * so no menu is clipped by the hull or spills over the page behind it.
 */
Then('every picker menu in the dialog opens inside the dialog', async ({ page }) => {
  const dialog = dialogRoot(page);
  const triggers = dialog.locator('[data-option-picker-trigger]');
  const count = await triggers.count();
  expect(count, 'the dialog renders no picker at all').toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    const trigger = triggers.nth(index);
    await waitForPickerBehaviour(trigger);
    await trigger.click();
    const panel = pickerPanel(trigger);
    await expect(panel).toBeVisible();
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        const hull = await dialog.boundingBox();
        return (
          !!box &&
          !!hull &&
          box.height > 30 &&
          box.x >= hull.x &&
          box.x + box.width <= hull.x + hull.width &&
          box.y >= hull.y &&
          box.y + box.height <= hull.y + hull.height
        );
      }, `picker menu ${index + 1} does not open inside the dialog`)
      .toBe(true);
    await trigger.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
});

// Parent and Blocked by are scoped to the new ticket's project. Tickets are
// named by identifier and resolved to their id, which is each picker row's
// `data-value` and each hidden input's value.

function ticketIdByIdentifier(identifier: string): string {
  const id = php(
    '$t = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")' +
      `->loadByProperties(["identifier" => "${safe(identifier)}"])); print $t ? $t->id() : "";`,
  );
  if (!id) {
    throw new Error(`No bb_ticket with identifier "${identifier}" exists in the seeded world.`);
  }
  return id;
}

function relationRow(page: Page, field: string, identifier: string) {
  return pickerPanel(pickerTrigger(page, field)).locator(
    `[role="option"][data-value="${ticketIdByIdentifier(identifier)}"]`,
  );
}

When('I visit the ticket list of project {string}', async ({ page }, label: string) => {
  const url = php(
    '$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(label)}"])); print $p ? $p->toUrl()->toString() . "/tickets" : "";`,
  );
  if (!url) {
    throw new Error(`No bb_project named "${label}" resolves a canonical URL.`);
  }
  const response = await page.goto(url);
  expect(response?.status() ?? 0, "The project's ticket list did not render").toBeLessThan(400);
  await markDocument(page);
});

/**
 * Picks a project and waits until the relation pickers it refreshes settle.
 *
 * The form's `hx-sync="this:drop"` drops a submit posted while the refresh
 * is still in flight.
 */
async function settledProjectRefresh(page: Page, pick: () => Promise<void>): Promise<void> {
  const refreshed = page.waitForResponse((response) => response.request().method() === 'POST', { timeout: 20000 });
  await pick();
  await refreshed;
  await expect(page.locator(`${DIALOG} [data-ticket-project-scoped]:is(.htmx-swapping, .htmx-settling)`)).toHaveCount(0);
  await waitForPickerBehaviour(pickerTrigger(page, 'Parent'));
  await waitForPickerBehaviour(pickerTrigger(page, 'Blocked by'));
}

When('I choose the dialog project {string}', async ({ page }, label: string) => {
  const trigger = pickerTrigger(page, 'Project');
  await expect(trigger, 'No "Project" picker is in the dialog').toBeAttached();
  await trigger.click();
  const row = optionRow(page, pickerPanel(trigger), label);
  await expect(row, `The project picker offers no "${label}" option`).toBeAttached();
  await settledProjectRefresh(page, () => row.click());
});

Then('the {string} picker offers {string}', async ({ page }, field: string, identifier: string) => {
  await expect(relationRow(page, field, identifier), `"${field}" does not offer ${identifier}`).toBeAttached();
});

Then('the {string} picker does not offer {string}', async ({ page }, field: string, identifier: string) => {
  await expect(relationRow(page, field, identifier), `"${field}" offers ${identifier}`).toBeHidden();
});

Then('the {string} picker offers no tickets', async ({ page }, field: string) => {
  const rows = pickerPanel(pickerTrigger(page, field)).locator('[role="option"]:not([data-option-list-clear])');
  await expect(rows, `"${field}" offers tickets`).toHaveCount(0);
});

When('I search the open picker for {string}', async ({ page }, text: string) => {
  const trigger = page.locator(`${DIALOG} [data-option-picker-trigger][aria-expanded="true"]`).first();
  await expect(trigger, 'No picker is currently open').toBeAttached();
  await pickerPanel(trigger).locator('input[type="search"]').fill(text);
});

When('I pick the related ticket {string}', async ({ page }, identifier: string) => {
  const trigger = page.locator(`${DIALOG} [data-option-picker-trigger][aria-expanded="true"]`).first();
  await expect(trigger, 'No picker is currently open').toBeAttached();
  await pickerPanel(trigger).locator(`[role="option"][data-value="${ticketIdByIdentifier(identifier)}"]`).click();
});

// Tampering: a crafted post carries a value the picker never offered.
When('I post {string} as {string} instead', async ({ page }, identifier: string, name: string) => {
  const id = ticketIdByIdentifier(identifier);
  await dialogRoot(page)
    .locator('form')
    .evaluate(
      (form: HTMLFormElement, [field, value]: string[]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = field;
        input.value = value;
        form.appendChild(input);
      },
      [name, id],
    );
});

Then('the dialog shows the error {string}', async ({ page }, text: string) => {
  await expect(dialogRoot(page).locator('[data-component-id="bb_theme:message"]')).toContainText(text);
});

function storedRelations(): { parent: string; blockers: string[] } {
  const line = php(
    [
      `$found = \\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadByProperties(["title" => "${safe(requireLastTypedTitle())}"]);`,
      '$t = $found ? end($found) : NULL;',
      'print $t ? "ok|" . ($t->get("parent_id")->entity?->get("identifier")->value ?? "") . "|" . implode(",", array_map(fn ($b) => $b->get("identifier")->value, $t->get("blocked_by")->referencedEntities())) : "";',
    ].join(' '),
  );
  const [ok, parent, blockers] = line.split('|');
  if (ok !== 'ok') {
    throw new Error(`No bb_ticket titled "${requireLastTypedTitle()}" was stored.`);
  }
  return { parent: parent ?? '', blockers: blockers ? blockers.split(',').sort() : [] };
}

Then('the stored ticket has parent {string}', async ({}, identifier: string) => {
  expect(storedRelations().parent).toBe(identifier);
});

Then('the stored ticket is blocked by {string}', async ({}, identifiers: string) => {
  expect(storedRelations().blockers).toEqual(identifiers.split(',').map((i) => i.trim()).sort());
});

Then('the stored ticket has no parent and no blockers', async () => {
  expect(storedRelations()).toEqual({ parent: '', blockers: [] });
});

Then('no ticket titled {string} was stored', async ({}, title: string) => {
  const count = php(
    `print count(\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadByProperties(["title" => "${safe(title)}"]));`,
  );
  expect(count).toBe('0');
});
