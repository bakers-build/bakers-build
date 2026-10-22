// Ticket template steps: adding a template from the project's Templates tab.
// The header action opens the add form as a dialog with JavaScript, as a page
// without; both land back on the tab. Tab and page-text steps are shared
// (support/steps/shell.steps.ts).
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { PAGE_HEADER_ISLAND } from '../../support/shell';
import { optionRow, pickerPanel, pickerTrigger, waitForPickerBehaviour } from '../../support/picker';

const { When, Then, After } = createBdd(test);

/** Names of templates a scenario adds start with this, so cleanup finds them. */
const ADDED_PREFIX = 'Added template';

After({ tags: '@feature:ticket-templates' }, async () => {
  // Tickets generated from the Web and workspace fixture templates (never the API one).
  for (const uuid of ['684a0000-0000-4000-8000-000000000005', '684a0000-0000-4000-8000-000000000006']) {
    php(
      `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket_template", "${uuid}");` +
        ' $s = \\Drupal::entityTypeManager()->getStorage("bb_ticket");' +
        ' $ids = $t ? $s->getQuery()->accessCheck(FALSE)->condition("template_id", $t->id())->execute() : [];' +
        ' $s->delete($s->loadMultiple($ids)); print count($ids);',
    );
  }
  php(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_ticket_template");' +
      ` $ids = $s->getQuery()->accessCheck(FALSE)->condition("name", "${ADDED_PREFIX}", "STARTS_WITH")->execute();` +
      ' $s->delete($s->loadMultiple($ids)); print count($ids);',
  );
});

/** The add form: inside the dialog with JavaScript, the page without. */
async function addForm(page: Page): Promise<Locator> {
  const dialog = page.locator('dialog[open]');
  await expect(dialog.or(page.locator('form.bb-ticket-template-add-form, form[id^="bb-ticket-template-add-form"]')).first()).toBeVisible();
  return (await dialog.count()) > 0 ? dialog : page.locator('main');
}

async function openAddAction(page: Page, scripted: boolean): Promise<Locator> {
  const trigger = page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'Add template', exact: true });
  await expect(trigger).toBeVisible();
  if (scripted) {
    // The trigger has a real href; clicked before htmx owns it, it navigates
    // to the page form instead of fetching the dialog.
    await expect
      .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
      .toBe(true);
  }
  await trigger.click();
  return addForm(page);
}

When('I open the Add template action twice', async ({ page }) => {
  // Page scripts are off in the no-JS project, so htmx never loads there.
  const scripted = await page.evaluate(() => 'htmx' in window);
  const form = await openAddAction(page, scripted);
  await form.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await openAddAction(page, scripted);
});

When(
  'I save the template {string} with the title pattern {string}, the workflow {string} and the target state {string}',
  async ({ page }, name: string, pattern: string, workflow: string, targetState: string) => {
    expect(name.startsWith(ADDED_PREFIX), `Added template names start with "${ADDED_PREFIX}" for cleanup`).toBe(true);
    const form = await addForm(page);
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Title', { exact: true }).fill(pattern);
    await form.locator('textarea[name^="description"]').first().fill('Added from the Templates tab.');
    const scope = (await page.locator('dialog[open]').count()) > 0 ? 'dialog[open]' : 'main';
    if (await page.evaluate(() => 'htmx' in window)) {
      await pick(page, scope, 'Workflow', workflow);
      // The pick swaps in the chosen workflow's targets, right of the workflow.
      const target = pickerTrigger(page, scope, 'Target state');
      await expect(form.locator('.form__properties [data-template-target-state]')).toHaveCount(1);
      await expect(optionRow(page, pickerPanel(target), targetState)).toHaveCount(1);
      await pick(page, scope, 'Target state', targetState);
      await pick(page, scope, 'Labels', 'work:code');
    } else {
      // A pill needs JavaScript to open; a full page also renders its rows as
      // plain controls.
      for (const [role, label] of [['radio', workflow], ['radio', targetState], ['checkbox', 'work:code']] as const) {
        await form.locator('label.option-list__control').filter({ has: page.getByRole(role, { name: label, exact: true }) }).click();
        await expect(form.getByRole(role, { name: label, exact: true })).toBeChecked();
      }
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  },
);

/** Picks one option of a template form property pill, as a pointer user does. */
async function pick(page: Page, scope: string, field: string, label: string): Promise<void> {
  const trigger = pickerTrigger(page, scope, field);
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await optionRow(page, pickerPanel(trigger), label).click();
  await expect(trigger).toContainText(label);
}

Then('the add template form offers the conductor {string} but not {string}', async ({ page }, offered: string, foreign: string) => {
  const scope = (await page.locator('dialog[open]').count()) > 0 ? 'dialog[open]' : 'main';
  const trigger = pickerTrigger(page, scope, 'Conductor');
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  const panel = pickerPanel(trigger);
  await expect(optionRow(page, panel, offered)).toBeVisible();
  await expect(optionRow(page, panel, foreign)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

Then('the add template form explains the placeholders of both patterns', async ({ page }) => {
  const form = await addForm(page);
  await expect(form.getByText('Supports {{date}} (UTC YYYY-MM-DD) and {{month}} (UTC YYYY-MM).', { exact: false })).toHaveCount(2);
});

Then('the template {string} is listed with the workflow {string}', async ({ page }, name: string, workflow: string) => {
  const row = page.locator('li[data-list-item]').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(workflow);
});

/** The URL of a template, read from Drupal: the test never guesses ids. */
function templateUrl(name: string): string {
  return php(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_ticket_template");' +
      ` $ids = $s->getQuery()->accessCheck(FALSE)->condition("name", ${JSON.stringify(name)})->execute();` +
      ' print $s->load(reset($ids))->toUrl()->toString();',
  ).trim();
}

When('I open the template {string}', async ({ page }, name: string) => {
  await page.locator('li[data-list-item]').filter({ hasText: name }).getByRole('link', { name, exact: true }).click();
  await expect(page.locator('h1').filter({ hasText: name })).toBeVisible();
});

When('I visit the template {string} by its address', async ({ page }, name: string) => {
  await page.goto(templateUrl(name));
});

Then('the template shows {string} as {string}', async ({ page }, label: string, value: string) => {
  const row = page.locator('aside li').filter({ hasText: label }).filter({ hasText: value });
  await expect(row.first()).toBeVisible();
});

Then('the template offers the action {string}', async ({ page }, action: string) => {
  await expect(page.locator('aside').getByRole('link', { name: action, exact: true })).toBeVisible();
});

When('I open the settings of the template {string} from the list and save it', async ({ page }, name: string) => {
  await (await rowAction(page, name, `Settings ${name}`)).click();
  await expect(page.locator('form[id^="bb-ticket-template-edit-form"]')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // A page save is a full navigation; htmx state in the address would leave
  // the landing page without its assets.
  await expect(page.locator('form[id^="bb-ticket-template-edit-form"]')).toHaveCount(0);
  expect(page.url()).not.toContain('ajax_page_state');
});

When('I save the template settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // A page save is a full navigation; htmx state in the address would leave
  // the landing page without its assets.
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  expect(page.url()).not.toContain('ajax_page_state');
});

/**
 * Opens Create ticket in the overlay, once htmx owns the trigger, optionally
 * picks the project and edits the title, and creates the ticket.
 */
async function createInDialog(page: Page, create: Locator, edits: { project?: string; title?: string } = {}): Promise<void> {
  // Clicked before htmx owns it, the link navigates to the page form instead.
  await expect
    .poll(() => create.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
    .toBe(true);
  await create.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  if (edits.project) {
    await pick(page, 'dialog[open]', 'Project', edits.project);
  }
  if (edits.title) {
    await dialog.getByLabel('Title', { exact: true }).fill(edits.title);
  }
  await dialog.getByRole('button', { name: 'Create ticket', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/(ticket-template\/|templates(\?|$))/);
}

/** Opens a listed template's action menu and returns one of its actions. */
async function rowAction(page: Page, name: string, action: string): Promise<Locator> {
  const row = page.locator('li[data-list-item]').filter({ hasText: name });
  await row.locator('details[data-action-menu] > summary').click();
  const item = row.getByRole('menuitem', { name: action, exact: true });
  await expect(item).toBeVisible();
  return item;
}

/** The Create ticket action of a listed template, its menu opened. */
async function createLinkOf(page: Page, name: string): Promise<Locator> {
  return rowAction(page, name, 'Create ticket');
}

When('I create a ticket from the template in the dialog', async ({ page }) => {
  await createInDialog(page, page.locator('aside').getByRole('link', { name: 'Create ticket', exact: true }));
});

When('I create a ticket from the template {string} in the dialog with the title {string}', async ({ page }, name: string, title: string) => {
  await createInDialog(page, await createLinkOf(page, name), { title });
});

When(
  'I create a ticket from the template {string} in the project {string} with the title {string}',
  async ({ page }, name: string, project: string, title: string) => {
    await createInDialog(page, await createLinkOf(page, name), { project, title });
  },
);

When('I visit the workspace templates of {string}', async ({ page }, slug: string) => {
  // Contributors see no Settings entry; the tab is reached by its address.
  await page.goto(`/${slug}/settings/templates`);
});

Then('the add template form offers the project {string}', async ({ page }, project: string) => {
  const scope = (await page.locator('dialog[open]').count()) > 0 ? 'dialog[open]' : 'main';
  const trigger = pickerTrigger(page, scope, 'Project');
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await expect(optionRow(page, pickerPanel(trigger), project)).toHaveCount(1);
  await page.keyboard.press('Escape');
});

Then('the add template form offers no {string} picker', async ({ page }, field: string) => {
  const scope = (await page.locator('dialog[open]').count()) > 0 ? 'dialog[open]' : 'main';
  await expect(page.locator(`${scope} form`)).toBeVisible();
  await expect(pickerTrigger(page, scope, field)).toHaveCount(0);
});

Then('the page confirms the template {string} was saved', async ({ page }, name: string) => {
  await expect(page.getByText(`bakers.build ticket template ${name} saved.`)).toBeVisible();
});
