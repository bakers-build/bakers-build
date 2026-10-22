// BB-421 re-entry — the two create dialogs, compared rather than described.
//
// WHY THIS FILE EXISTS AT ALL, and it is an operator ruling rather than a
// refactor: "the two create dialogs must behave the same". Until this run they
// did not, and the reason was structural — the ticket surface composed its own
// hull inside its own `<form>` (`#island_own_hull: FALSE`) while the project
// surface let `island`'s wrapper format wrap it from outside. Same declaration,
// two different effects: on one the hull was re-swapped by every refusal, on
// the other it survived; one rendered a close control and the other none; one
// put its action row in the hull's footer and the other inside the body.
//
// SO THE ASSERTIONS BELONG TO NEITHER SURFACE, which is why they are not in
// `ticket-create.steps.ts` or `project-create.steps.ts`. A parity claim made
// twice, once per file, is two claims that can drift apart — exactly the
// failure mode the ruling is about. `Scenario Outline` states ONE expectation
// and runs it over both surfaces, so a surface that drifts fails the same row
// the other one passes.
//
// THE SURFACE REGISTRY IS THE ONLY PLACE THIS FILE KNOWS ANYTHING SPECIFIC.
// Everything else is written against `SURFACES[name]`, so adding the coming
// team-add and group-add dialogs to this parity gate is one entry rather than a
// new scenario.
import { When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { php } from '../../support/drush';
import { markDocument } from '../../support/shell';

/**
 * What this file needs to know about one create surface, and nothing more.
 *
 * `form` IS THE IDENTITY OF A SURFACE NOW, not an id on its hull. Since both
 * dialogs take `island`'s generic hull and that hull is passed no `id` prop
 * (`WrappedRouteRenderer::hullProps()`), every wrapped route renders as
 * `dialog#bakers-dialog` — so "the create-ticket dialog" can only be named as
 * "the generic hull that contains this form". `project-create.steps.ts` already
 * binds this way; this file is where the reasoning is shared rather than
 * copied a third time.
 */
interface Surface {
  /** The screen the dialog is opened from, resolved against the seeded world. */
  screen: () => string;
  /** The trigger's accessible name on that screen. */
  trigger: string;
  /** The `<form>` element's own rendered id, which names the surface. */
  form: string;
}

/**
 * The workspace slug the seeded world uses, resolved rather than hardcoded.
 *
 * The same reasoning `ticket-create.steps.ts`'s `bakersWorkspacePath()` and
 * `project-create.steps.ts`'s `projectsPath()` both give for resolving it: the
 * path carries a workspace slug, and reading it out of the world is what keeps
 * this file from asserting about a workspace that was renamed. Duplicated
 * because both of those helpers are private to their own files.
 */
function workspaceSlug(): string {
  const slug = php(
    '$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")' +
      '->loadByProperties(["slug" => "bakers"])); print $w ? $w->get("slug")->value : "";',
  );
  if (!slug) {
    throw new Error('No bb_workspace with slug "bakers" exists in the seeded world.');
  }
  return slug;
}

/**
 * The one project id the ticket surface's own head resolves to.
 *
 * THE TICKET DIALOG NEEDS IT AND THE PROJECT DIALOG DOES NOT, which is the
 * only asymmetry left in the opening step. `TicketCreateActionSource` forwards
 * the screen's own `?project=` into the dialog's query, and without it the
 * dialog opens with an unresolved context and a DISABLED submit
 * (`data-option-picker-requires="project_id"`). None of the parity assertions
 * below submits, so a disabled submit would not fail them — but the footer
 * position row asserts the submit is ENABLED as well, because a control that is
 * merely present in the right box is not the claim.
 */
function anyProjectId(): string {
  const id = php(
    '$projects = \\Drupal::entityTypeManager()->getStorage("bb_project")->loadMultiple();' +
      'print $projects ? reset($projects)->id() : "";',
  );
  if (!id) {
    throw new Error('No bb_project exists in the seeded world.');
  }
  return id;
}

const SURFACES: Record<string, Surface> = {
  ticket: {
    screen: () => `/${workspaceSlug()}/tickets/all?project=${anyProjectId()}`,
    trigger: 'New ticket',
    form: 'form#bb-ticket-create-form',
  },
  project: {
    screen: () => `/${workspaceSlug()}/projects`,
    trigger: 'New project',
    form: 'form#bb-project-create-form',
  },
  group: {
    screen: () => `/${workspaceSlug()}/groups`,
    trigger: 'New group',
    form: 'form#bb-group-create-form',
  },
  team: {
    screen: () => `/${workspaceSlug()}/projects`,
    trigger: 'New team',
    form: 'form#bb-team-create-form',
  },
};

/**
 * The surface named by an `Examples:` row, refused loudly when unknown.
 *
 * A typo in a feature file must not read as a passing scenario: an outline row
 * naming a surface this registry does not hold would otherwise select nothing
 * and every assertion below would be about an absent element.
 */
function surface(name: string): Surface {
  const found = SURFACES[name];
  if (!found) {
    throw new Error(
      `Unknown create surface "${name}" — this file knows ${Object.keys(SURFACES).join(', ')}.`,
    );
  }
  return found;
}

/**
 * Where the scenario currently is, so "back on the screen it was opened over"
 * can be asserted without the feature file naming a path.
 *
 * The PATHNAME only, deliberately: the screen is opened WITH a query in the
 * ticket case (`?project=`) and the dialog's own `destination` carries that
 * query back, but a close is only required to land the operator on the same
 * screen — pinning the query too would assert `returnUrl()`'s round-tripping,
 * which is a different claim and one `WrappedDialogFormTest` already makes.
 */
let openedOver = '';

/** The dialog hull holding a given surface, and the same hull asserted open. */
function hull(page: Page, target: Surface) {
  return page.locator(`dialog[data-dialog]:has(${target.form})`);
}

function openHull(page: Page, target: Surface) {
  return page.locator(`dialog[data-dialog][open]:has(${target.form})`);
}

/**
 * Opens one create dialog through its own trigger, whichever surface it is.
 *
 * THROUGH THE TRIGGER AND NOT BY URL, for the reason both surfaces' own files
 * give: the dialog is a route, and visiting that route directly answers a
 * standalone page rather than a hull in the shell's overlay — which is a
 * different surface from the one an operator reaches. The GET is waited for by
 * its wrapper format, so the step fails on "the trigger did not fetch a dialog"
 * rather than on a later assertion about an element that never arrived.
 */
When('I open the {string} create dialog', async ({ page }, name: string) => {
  const target = surface(name);
  const screen = target.screen();
  const response = await page.goto(screen);
  expect(response?.status() ?? 0, `The ${name} screen did not render`).toBeLessThan(400);
  openedOver = new URL(page.url()).pathname;
  await markDocument(page);
  await clickTrigger(page, name);
});

/** Opens the dialog again on the screen it was just closed on, without a visit. */
When('I open the {string} create dialog again', async ({ page }, name: string) => {
  await clickTrigger(page, name);
});

async function clickTrigger(page: Page, name: string): Promise<void> {
  const target = surface(name);
  const trigger = page.getByRole('link', { name: target.trigger, exact: true });
  await expect(
    trigger,
    `No "${target.trigger}" action is on the ${name} screen`,
  ).toBeAttached();
  // The trigger is a real anchor with a real `href`, so a click landing before
  // htmx has processed the document navigates to the standalone create page
  // instead of fetching the dialog. Waiting for htmx to own the trigger is a
  // precondition, not a softened assertion — `project-create.steps.ts`'s own
  // `openDialog()` carries the full reasoning and the CI measurement.
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
    (candidate) =>
      candidate.request().method() === 'GET' &&
      candidate.url().includes('_wrapper_format=island_dialog'),
    { timeout: 20000 },
  );
  await trigger.click();
  await answered;
  await expect(
    openHull(page, target),
    `The ${name} create dialog did not open in the shell overlay`,
  ).toBeVisible();
}

/**
 * AC6's close control, as MARKUP — which is a separate claim from whether it
 * works, and the two are deliberately asserted by different steps.
 *
 * The control is server-rendered: `WrappedRouteRenderer::hullProps()` asks for
 * it with `dismissible`, and the hull renders it under that prop. Until this
 * run the renderer deliberately did NOT ask — on a rationale that was false the
 * day it was written, since the theme's own `dialog.js` already attached a
 * handler to exactly this hook — so the project dialog rendered no close
 * control at all while the ticket dialog, composing its own hull, rendered one.
 *
 * FOUND BY ITS HOOK AND NOT BY ITS LABEL, because the two hulls label it
 * differently (`island:dialog` says "Close", `bb_theme:dialog` says "Close
 * dialog") and the hook is the contract both honour.
 */
Then('the {string} create dialog offers a close control', async ({ page }, name: string) => {
  const target = surface(name);
  await expect(
    openHull(page, target).locator('[data-dialog-close]'),
    'The dialog renders no close control — is the hull asked for `dismissible`?',
  ).toHaveCount(1);
});

/**
 * AC6's close control, as BEHAVIOUR. Separate from its presence above because
 * the previous delivery had one surface with a working control, one with none,
 * and a rationale claiming no handler existed anywhere.
 */
When('I close the {string} create dialog by its close control', async ({ page }, name: string) => {
  const target = surface(name);
  await openHull(page, target).locator('[data-dialog-close]').click();
});

/** Cancel in the action row, the same `[data-dialog-cancel]` close and Escape read. */
When('I cancel the {string} create dialog', async ({ page }, name: string) => {
  const target = surface(name);
  await openHull(page, target).locator('[data-dialog-cancel]').click();
});

/**
 * ESCAPE, PRESSED WITHOUT CLICKING INTO THE DIALOG FIRST — and that is the
 * whole point of the step rather than an incidental detail.
 *
 * The defect this asserts against: the keydown listener used to sit on the
 * dialog ELEMENT, `keydown` bubbles from whatever holds focus, and nothing
 * gives the hull focus when it opens — no `showModal()`, no `autofocus`, no
 * `focus()` call. A `<dialog>` rendered with only the `open` attribute gets
 * none of the element's native Escape handling either. So Escape did nothing
 * until the operator happened to click inside the dialog, and a scenario that
 * clicked first would have passed against the broken code.
 *
 * `page.keyboard.press` with no preceding click is therefore load-bearing: the
 * key goes to whatever the fresh document focused, which is the body.
 */
When('I press Escape without clicking into the dialog', async ({ page }) => {
  await page.keyboard.press('Escape');
});

/**
 * The hull is gone, and the operator is where they started.
 *
 * BOTH HALVES, because either alone is satisfiable by the wrong thing: a hull
 * removed with no navigation would leave the browser on the dialog's own route
 * with an empty overlay (the shape this project deliberately rejected), and a
 * navigation that left the hull rendered would not be a close.
 */
Then('the {string} create dialog is closed', async ({ page }, name: string) => {
  const target = surface(name);
  await expect(
    hull(page, target),
    'The create dialog is still in the document — did the close control navigate?',
  ).toHaveCount(0);
  expect(
    new URL(page.url()).pathname,
    'The close did not land the operator back on the screen the dialog was opened over',
  ).toBe(openedOver);
});

/**
 * AC6's action-row position, and the mechanism that makes it possible.
 *
 * THE POSITION ALONE WOULD BE A WORTHLESS ASSERTION, which is why the second
 * half is here. The hull's footer sits OUTSIDE the `<form>` — the hull is the
 * form's ancestor now, on both surfaces — so a submit rendered there is not one
 * of the form's own descendants and submits nothing at all unless it names its
 * form owner explicitly. `WrappedDialogFormTrait::liftActionsIntoHull()` stamps
 * `form="<the form's rendered id>"` onto it for exactly that reason, and htmx
 * honours it: `getRelatedForm()` resolves `elt.form`, which IS the `form`
 * attribute, so the clicked control still reaches Drupal's own
 * `buttonWasClicked()`.
 *
 * THAT THE FOOTER SUBMIT REALLY WRITES is not asserted here and does not need
 * to be: every scenario in both surfaces' own feature files that submits is now
 * clicking THIS control, and they end in a real write and a real landing. A
 * fourth write here would re-measure that with worse fixtures.
 */
Then('the {string} create dialog puts its action row outside the form', async ({ page }, name: string) => {
  const target = surface(name);
  const dialog = openHull(page, target);

  const submit = dialog.locator('button[type="submit"]');
  await expect(submit, 'The dialog renders no submit').toHaveCount(1);
  await expect(submit, 'The dialog submit is disabled').toBeEnabled();
  await expect(
    dialog.getByRole('link', { name: 'Cancel', exact: true }),
    'The dialog renders no Cancel',
  ).toHaveCount(1);

  // OUTSIDE the form, which is the position claim. Scoped through the form
  // rather than by a class, so it survives any restyling of the footer.
  await expect(
    dialog.locator(`${target.form} button[type="submit"]`),
    'The submit is still inside the form — the action row was not lifted into the hull',
  ).toHaveCount(0);
  await expect(
    dialog.locator(`${target.form}`).getByRole('link', { name: 'Cancel', exact: true }),
    'Cancel is still inside the form — the action row was not lifted into the hull',
  ).toHaveCount(0);

  // And the one attribute that makes an outside-the-form submit submit at all.
  const formId = target.form.replace(/^form#/, '');
  await expect(
    submit,
    'The lifted submit does not name its form owner — it would submit nothing',
  ).toHaveAttribute('form', formId);
});

// NO `Given` IS REGISTERED IN THIS FILE, deliberately. `I am logged in as
// {string}` is the `@key-tec/playwright-core` catalog's own step, and a second
// registration of that text would be a duplicate definition rather than an
// override. And "both dialogs are on one hull" is a fact about where code IS
// rather than about a running browser, so it is asserted by reflection in
// `CreateDialogSharedOriginTest` — a browser step reading PHP source would be
// a structural claim wearing a scenario's clothes.
//
// which is why only `When` and `Then` are imported at the top of this file.

When('I use a short browser window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
});
