// Ticket trigger steps: the template's Triggers tab. The Add trigger action
// opens the form in the dialog; Pause and Resume confirm on a page. Tab, page
// text and template address steps are shared (support/steps/shell.steps.ts,
// steps/tickets/ticket-templates.steps.ts).
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { PAGE_HEADER_ISLAND } from '../../support/shell';

const { When, Then, After } = createBdd(test);

/** The seeded template; scenarios add triggers only here. */
const TEMPLATE_UUID = '685a0000-0000-4000-8000-000000000003';
/** The seeded AC-4 trigger, which cleanup keeps. */
const SEEDED_TRIGGER_UUID = '685a0000-0000-4000-8000-000000000004';

After({ tags: '@feature:ticket-template-triggers' }, async () => {
  php(
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket_template", "${TEMPLATE_UUID}");` +
      ' $s = \\Drupal::entityTypeManager()->getStorage("bb_ticket_trigger");' +
      ` $ids = $t ? $s->getQuery()->accessCheck(FALSE)->condition("template_id", $t->id())->condition("uuid", "${SEEDED_TRIGGER_UUID}", "<>")->execute() : [];` +
      ' $s->delete($s->loadMultiple($ids)); print count($ids);',
  );
});

/** The add form: inside the dialog with JavaScript, the page without. */
async function addForm(page: Page): Promise<Locator> {
  const dialog = page.locator('dialog[open]');
  await expect(dialog.or(page.locator('form[id^="bb-ticket-trigger-add-form"]')).first()).toBeVisible();
  return (await dialog.count()) > 0 ? dialog : page.locator('main');
}

/** The list row of a trigger, by its summary line. */
function triggerRow(page: Page, summary: string): Locator {
  return page.locator('li[data-list-item]').filter({ hasText: summary });
}

function triggersUrl(): string {
  return php(
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket_template", "${TEMPLATE_UUID}");` +
      ' print \\Drupal\\Core\\Url::fromRoute("view.bb_ticket_triggers.template_list", $t->toUrl()->getRouteParameters())->toString();',
  ).trim();
}

When('I visit the triggers of the template {string} by their address', async ({ page }, name: string) => {
  expect(name, 'Only the seeded template has a known address').toBe('Monthly Drupal update');
  await page.goto(triggersUrl());
});

/** Opens the Add trigger dialog once htmx owns the header action. */
async function openAddDialog(page: Page): Promise<Locator> {
  const trigger = page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'Add trigger', exact: true });
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
    .toBe(true);
  await trigger.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Frequency', { exact: true })).toBeVisible();
  return dialog;
}

/**
 * Chooses a frequency. With JavaScript, htmx swaps the schedule section, so
 * this waits for that response before the next field is used.
 */
async function chooseFrequency(page: Page, form: Locator, label: string): Promise<void> {
  const select = form.getByLabel('Frequency', { exact: true });
  const swapped = (await page.evaluate(() => 'htmx' in window))
    ? page.waitForResponse((response) => response.request().method() === 'POST')
    : null;
  await select.selectOption({ label });
  await swapped;
  await expect(form.getByLabel('Frequency', { exact: true })).toHaveValue(label.toLowerCase());
}

When('I open the Add trigger action and choose the frequency {string}', async ({ page }, label: string) => {
  const dialog = await openAddDialog(page);
  await chooseFrequency(page, dialog, label);
});

When('I choose the frequency {string}', async ({ page }, label: string) => {
  await chooseFrequency(page, await addForm(page), label);
});

Then('the trigger form offers the field {string}', async ({ page }, label: string) => {
  await expect((await addForm(page)).getByLabel(label, { exact: true })).toBeVisible();
});

Then('the trigger form does not offer the field {string}', async ({ page }, label: string) => {
  await expect((await addForm(page)).getByLabel(label, { exact: true })).toHaveCount(0);
});

When('I open the Add trigger action and press Escape', async ({ page }) => {
  await openAddDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

When('I open the Add trigger action and click its close button', async ({ page }) => {
  const dialog = await openAddDialog(page);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

When(
  'I add an enabled monthly trigger on day {string} at {string} in {string} run by {string}',
  async ({ page }, day: string, time: string, zone: string, account: string) => {
    const trigger = page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'Add trigger', exact: true });
    await expect(trigger).toBeVisible();
    if (await page.evaluate(() => 'htmx' in window)) {
      // Clicked before htmx owns it, the link navigates to the page form.
      await expect
        .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
        .toBe(true);
    }
    await trigger.click();
    const form = await addForm(page);
    await chooseFrequency(page, form, 'Monthly');
    await form.getByLabel('Day of month', { exact: true }).selectOption(day);
    await form.getByLabel('Time', { exact: true }).fill(time);
    await form.getByLabel('Time zone', { exact: true }).selectOption(zone);
    await form.getByLabel('Service account', { exact: true }).selectOption({ label: account });
    await form.getByLabel('Enabled', { exact: true }).check();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
  },
);

/** Opens a row's action menu and returns its item for the action. */
async function rowAction(page: Page, summary: string, action: string): Promise<Locator> {
  const row = triggerRow(page, summary);
  const item = row.getByRole('menuitem', { name: action, exact: true });
  // A dismissed dialog leaves the menu as it was; clicking again would close it.
  if (!(await item.isVisible())) {
    await row.getByLabel(`Actions for ${summary}`, { exact: true }).click();
  }
  await expect(item).toBeVisible();
  return item;
}

When('I {string} the trigger {string}', async ({ page }, action: string, summary: string) => {
  const link = await rowAction(page, summary, action);
  const scripted = await page.evaluate(() => 'htmx' in window);
  if (scripted) {
    // Clicked before htmx owns it, the link navigates to the page form.
    await expect
      .poll(() => link.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
      .toBe(true);
  }
  await link.click();
  // With JavaScript the confirmation opens in the overlay, as Create ticket does.
  const scope = scripted ? page.locator('dialog[open]') : page.locator('main');
  await expect(scope.getByRole('button', { name: action, exact: true })).toBeVisible();
  await scope.getByRole('button', { name: action, exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // Back on the Triggers tab; the shell renders no status message there.
  await expect(page).toHaveURL(/\/triggers(\?|$)/);
});

When('I open {string} for the trigger {string} and close the dialog', async ({ page }, action: string, summary: string) => {
  const link = await rowAction(page, summary, action);
  await expect
    .poll(() => link.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
    .toBe(true);
  await link.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('button', { name: action, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

Then('the trigger {string} is listed as {string}', async ({ page }, summary: string, status: string) => {
  await expect(triggerRow(page, summary).getByText(status, { exact: true })).toBeVisible();
});

Then('the trigger {string} has no next run', async ({ page }, summary: string) => {
  await expect(triggerRow(page, summary).getByText('—', { exact: true })).toBeVisible();
});

Then('the trigger {string} runs next on the coming 1st at {string}', async ({ page }, summary: string, time: string) => {
  // The coming 1st in Europe/Berlin: this month's has passed once its day is over 1.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  let year = Number(parts.year);
  let month = Number(parts.month);
  const dueThisMonth = parts.day === '01' && `${parts.hour}:${parts.minute}` < time;
  if (!dueThisMonth) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const expected = `${year}-${String(month).padStart(2, '0')}-01 ${time}`;
  // The label follows the reader's time zone; the machine value is compared in the trigger's.
  const stamp = await triggerRow(page, summary).locator('time[datetime]').first().getAttribute('datetime');
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(stamp ?? ''))
    .replace(', ', ' ');
  expect(berlin, `The next run is ${stamp}`).toBe(expected);
});

Then('no trigger {string} exists', async ({ page }, summary: string) => {
  await page.goto(triggersUrl());
  await expect(triggerRow(page, summary)).toHaveCount(0);
});

Then('I am sent to sign in', async ({ page }) => {
  await expect(page).toHaveURL(/\/user\/login/);
});
