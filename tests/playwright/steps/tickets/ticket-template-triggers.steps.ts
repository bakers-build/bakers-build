// Ticket trigger steps: the template's Triggers tab and a trigger's page. The
// Add trigger action opens the form in the dialog; Pause and Resume, on the
// trigger's page, confirm in the dialog or, without JavaScript, on a page. Tab, page
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
  await expect(page.getByLabel('Frequency', { exact: true })).toBeVisible();
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

When('I type {string} into the trigger time and leave it', async ({ page }, value: string) => {
  const field = (await addForm(page)).getByLabel('Time', { exact: true });
  await field.fill(value);
  await field.blur();
});

Then('the trigger time shows {string}', async ({ page }, value: string) => {
  await expect((await addForm(page)).getByLabel('Time', { exact: true })).toHaveValue(value);
});

/** The seeded trigger's page. */
function seededTriggerUrl(): string {
  return php(
    `print \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket_trigger", "${SEEDED_TRIGGER_UUID}")->toUrl()->toString();`,
  ).trim();
}

/** The trigger page's inspector: its properties and its actions. */
function triggerPage(page: Page): Locator {
  return page.locator('aside.inspector');
}

When('I open the trigger {string}', async ({ page }, summary: string) => {
  await triggerRow(page, summary).getByRole('link', { name: summary, exact: true }).click();
  await expect(page).toHaveURL(/\/trigger\/\d+(\?|$)/);
});

When('I visit the seeded trigger by its address', async ({ page }) => {
  await page.goto(seededTriggerUrl());
});

Then('the trigger page shows the state {string}', async ({ page }, state: string) => {
  await expect(triggerPage(page).getByText(state, { exact: true })).toBeVisible();
});

/** A footer action of the trigger page, once htmx owns it. */
async function pageAction(page: Page, action: string): Promise<Locator> {
  const link = triggerPage(page).getByRole('link', { name: action, exact: true });
  await expect(link).toBeVisible();
  if (await page.evaluate(() => 'htmx' in window)) {
    // Clicked before htmx owns it, the link navigates to the page form.
    await expect
      .poll(() => link.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']))
      .toBe(true);
  }
  return link;
}

When('I {string} on the trigger page', async ({ page }, action: string) => {
  const detail = page.url();
  await (await pageAction(page, action)).click();
  // With JavaScript the confirmation opens in the overlay, as Create ticket does.
  const scripted = await page.evaluate(() => 'htmx' in window);
  const scope = scripted ? page.locator('dialog[open]') : page.locator('main');
  await expect(scope.getByRole('button', { name: action, exact: true })).toBeVisible();
  await scope.getByRole('button', { name: action, exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // Back on the trigger's page.
  await expect(page).toHaveURL(detail);
});

When('I open {string} on the trigger page and close the dialog', async ({ page }, action: string) => {
  await (await pageAction(page, action)).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('button', { name: action, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

Then('the page offers no trigger action', async ({ page }) => {
  for (const action of ['Edit', 'Pause', 'Resume', 'Delete']) {
    await expect(page.getByRole('link', { name: action, exact: true })).toHaveCount(0);
  }
});

Then('the Pause page of the seeded trigger answers {int}', async ({ page }, status: number) => {
  const response = await page.goto(`${seededTriggerUrl()}/toggle`);
  expect(response?.status()).toBe(status);
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
