// Shared time-entry steps. Consumer: features/manual-worklog.feature.
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { Given, Then, When } from '@key-tec/playwright-core/bdd';
import { php } from '../drush';
import { markDocument } from '../shell';

let secondPage: Page | undefined;

function safe(value: string): string {
  return value.replace(/["'\\$]/g, '');
}

/** A label that ends with the given name, e.g. "keytec · Time capture" for "Time capture". */
function endsWith(name: string): RegExp {
  return new RegExp(`(^|· )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/** The open time dialog, or the whole page when no dialog is open (My time has its own Date filter). */
function timeScope(page: Page): Locator {
  return page.locator(`${OPEN_TIME_DIALOG}, body:not(:has(${OPEN_TIME_DIALOG}))`);
}

/** The time form's picker of a field, by its visible field name. */
function timePicker(page: Page, field: string) {
  return timeScope(page).locator(`[data-option-picker][data-option-picker-label="${safe(field)}"]`).first();
}

/** A picker's form refresh: htmx on the time form, Drupal AJAX on the submission review. */
function isFormRefresh(response: Response): boolean {
  const request = response.request();
  return request.method() === 'POST' && (/ajax_form=1/.test(response.url()) || request.headers()['hx-trigger-name'] === 'search_tickets');
}

/** Opens a picker and picks the row whose label ends with the name. */
async function pick(page: Page, field: string, name: string): Promise<void> {
  const picker = timePicker(page, field);
  await expect(picker).toHaveAttribute('data-option-picker-ready');
  const trigger = picker.locator('[data-option-picker-trigger]');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  const search = picker.locator('[data-option-picker-search]');
  if (field === 'Ticket' && (await search.count()) && (await search.inputValue()) !== name) {
    // The ticket pill searches on the server; wait for the rows of the typed text.
    const answered = page.waitForResponse((response) => response.url().includes('/time/options/ticket'));
    await search.fill(name);
    await answered;
  }
  // A ticket pick re-resolves the billing account through the form's refresh.
  // A second click while one is in flight is dropped, so a project pick right
  // behind it would be swallowed: wait for the rebuild.
  const rebuilt = field === 'Ticket' && (await page.locator('[data-bakers-ticket-search], [data-submission-refresh]').count())
    ? page.waitForResponse(isFormRefresh, { timeout: 3000 }).catch(() => undefined)
    : Promise.resolve(undefined);
  await picker.locator('[role="option"]').filter({ has: page.locator('.option-list__label', { hasText: endsWith(name) }) }).first().click();
  await rebuilt;
}

/** Picks a project and waits for the ticket field to follow it. */
async function pickProject(page: Page, name: string): Promise<void> {
  await openChange(page);
  // A calendar may already have filled the project in; picking it again changes nothing.
  const current = await timePicker(page, 'Project').locator('[data-picker-part="value"]').allInnerTexts();
  if (current.some((value) => endsWith(name).test(value.trim()))) {
    return;
  }
  const rebuilt = page.waitForResponse(isFormRefresh);
  await pick(page, 'Project', name);
  await rebuilt;
  await expect(timePicker(page, 'Ticket')).toHaveAttribute('data-option-picker-ready');
}

/** Opens the edit form's "Change date, project or ticket" group, if it is closed. */
async function openChange(page: Page): Promise<void> {
  const change = page.locator('details.collapsible:has(input[name="work_date"])');
  if ((await change.count()) && !(await change.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await change.locator('summary').click();
  }
}

function worklogPath(description: string): string {
  const uuid = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}"]))) ? $e->uuid() : "");`,
  );
  if (!uuid) {
    throw new Error(`No time entry described as "${description}" exists.`);
  }
  return `/time/${uuid}/edit`;
}

function storedSeconds(description: string): string {
  return php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}"]))) ? $e->get("duration_seconds")->value : "");`,
  );
}

function worklogExists(description: string): boolean {
  return php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}"]))) ? "1" : "0");`,
  ) === '1';
}

const TIME_FORM = 'form#bb-track-worklog-form';
const OPEN_TIME_DIALOG = `dialog[data-dialog][open]:has(${TIME_FORM})`;

Then('I see the Record time action', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Record time', exact: true })).toBeVisible();
});

When('I open Record time from My time', async ({ page }) => {
  const trigger = page.getByRole('link', { name: 'Record time', exact: true });
  await expect
    .poll(
      () =>
        trigger.evaluate(
          (el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data'],
        ),
      {
        message: 'htmx never processed the Record time trigger, so a click could only navigate',
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
  await expect(page.locator(OPEN_TIME_DIALOG)).toBeVisible();
  await markDocument(page);
});

Then('I see the time form in a dialog', async ({ page }) => {
  const dialog = page.locator(OPEN_TIME_DIALOG);
  await expect(dialog.getByLabel('Date', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
});

Then('the time dialog shows {string}', async ({ page }, text: string) => {
  await expect(page.locator(OPEN_TIME_DIALOG).getByText(text).first()).toBeVisible();
});

Then('the time form is ready', async ({ page }) => {
  await expect(timeScope(page).getByLabel('Date', { exact: true })).toBeVisible();
  await expect(timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
  await expect(timePicker(page, 'Project')).toBeVisible();
  await expect(timeScope(page).getByLabel('Description', { exact: true })).toBeVisible();
});

When(
  'I fill a time entry dated {string} lasting {string} on project {string} with ticket {string} described as {string}',
  async ({ page }, date: string, duration: string, project: string, ticket: string, description: string) => {
    await openChange(page);
    await timeScope(page).getByLabel('Date', { exact: true }).fill(date);
    await timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true }).fill(duration);
    await pickProject(page, project);
    await pick(page, 'Ticket', ticket);
    await timeScope(page).getByLabel('Description', { exact: true }).fill(description);
  },
);

When(
  'I fill a time entry dated {string} lasting {string} on project {string} described as {string}',
  async ({ page }, date: string, duration: string, project: string, description: string) => {
    await openChange(page);
    await timeScope(page).getByLabel('Date', { exact: true }).fill(date);
    await timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true }).fill(duration);
    await pickProject(page, project);
    await timeScope(page).getByLabel('Description', { exact: true }).fill(description);
  },
);

When('I fill duration {string} and description {string}', async ({ page }, duration: string, description: string) => {
  await timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true }).fill(duration);
  await timeScope(page).getByLabel('Description', { exact: true }).fill(description);
});

When('I save the time entry', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I open the same time form in a second tab', async ({ page }) => {
  secondPage = await page.context().newPage();
  await secondPage.goto(page.url());
  await expect(secondPage.getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
});

When('I open the delete confirmation in a second tab', async ({ page }) => {
  const href = await page.getByRole('link', { name: 'Delete', exact: true }).getAttribute('href');
  if (!href) {
    throw new Error('The time form has no Delete link.');
  }
  secondPage = await page.context().newPage();
  await secondPage.goto(href);
  await expect(secondPage.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await expect(secondPage.getByText('This action cannot be undone.')).toBeVisible();
});

When('I save the time entry in the second tab', async () => {
  if (!secondPage) {
    throw new Error('No second tab is open.');
  }
  await secondPage.getByRole('button', { name: 'Save', exact: true }).click();
  await secondPage.waitForLoadState('domcontentloaded');
});

When('I confirm the delete in the second tab', async () => {
  if (!secondPage) {
    throw new Error('No second tab is open.');
  }
  await secondPage.getByRole('button', { name: 'Confirm', exact: true }).click();
  await secondPage.waitForLoadState('domcontentloaded');
});

Then('the second tab shows {string}', async ({}, text: string) => {
  if (!secondPage) {
    throw new Error('No second tab is open.');
  }
  await expect(secondPage.getByText(text).first()).toBeVisible();
  await secondPage.close();
  secondPage = undefined;
});

Then(
  'the time form shows date {string} duration {string} project {string} ticket {string} and description {string}',
  async ({ page }, date: string, duration: string, project: string, ticket: string, description: string) => {
    await expect(timeScope(page).getByLabel('Date', { exact: true })).toHaveValue(date);
    await expect(timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true })).toHaveValue(duration);
    await expect(timePicker(page, 'Project').locator('[data-picker-part="value"]')).toHaveText(endsWith(project));
    await expect(timePicker(page, 'Ticket').locator('[data-picker-part="value"]')).toHaveText(new RegExp(ticket));
    await expect(timeScope(page).getByLabel('Description', { exact: true })).toHaveValue(description);
  },
);

Then(
  'the time form shows duration {string} and description {string}',
  async ({ page }, duration: string, description: string) => {
    await expect(timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true })).toHaveValue(duration);
    await expect(timeScope(page).getByLabel('Description', { exact: true })).toHaveValue(description);
  },
);

Then('the stored duration for description {string} is {int} seconds', async ({}, description: string, seconds: number) => {
  expect(Number(storedSeconds(description))).toBe(seconds);
});

When('I open the time entry described as {string}', async ({ page }, description: string) => {
  await page.goto(worklogPath(description));
  await expect(timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
  await markDocument(page);
});

When('I visit the time entry described as {string}', async ({ page }, description: string) => {
  await page.goto(worklogPath(description));
});

When('I visit {string}', async ({ page }, path: string) => {
  await page.goto(path);
  await markDocument(page);
});

When('I open the delete confirmation', async ({ page }) => {
  await page.getByRole('link', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await expect(page.getByText('This action cannot be undone.')).toBeVisible();
});

When('I cancel the delete', async ({ page }) => {
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(timeScope(page).getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
});

When('I confirm the delete', async ({ page }) => {
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Time entry deleted.').first()).toBeVisible();
  await expect(timeScope(page).getByLabel('Date', { exact: true })).toBeVisible();
});

Then('the time entry described as {string} is gone', async ({}, description: string) => {
  expect(worklogExists(description)).toBe(false);
});

Then('the time entry described as {string} remains', async ({}, description: string) => {
  expect(worklogExists(description)).toBe(true);
});

Then('the Duration field shows an error', async ({ page }) => {
  await expect(page.getByText('Duration must be between 0:01 and 24:00.').first()).toBeVisible();
});

Then('the Ticket field shows an error', async ({ page }) => {
  await expect(
    page.getByText('Select a ticket that belongs to the chosen project.').first(),
  ).toBeVisible();
});

Given('no time entry is described as {string}', async ({}, description: string) => {
  // A rerun against the same site would otherwise find the previous run's entry.
  php(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_track_worklog");' +
      `$s->delete($s->loadByProperties(["description" => "${safe(description)}"]));`,
  );
});

Then('no time entry is stored with description {string}', async ({}, description: string) => {
  expect(worklogExists(description)).toBe(false);
});

Then('the page is not found or forbidden', async ({ page }) => {
  await expect(
    page.getByText(/not authorized|could not be found|Access denied|Page not found/i).first(),
  ).toBeVisible();
});

Then('the page is not found', async ({ page }) => {
  await expect(page.getByText(/could not be found|Page not found/i).first()).toBeVisible();
});

Then('the time form has no Save action', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

Then('the time form has no Delete action', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Delete', exact: true })).toHaveCount(0);
});


When('I pick the project {string}', async ({ page }, project: string) => {
  await pickProject(page, project);
});

When('I pick the ticket {string}', async ({ page }, ticket: string) => {
  await pick(page, 'Ticket', ticket);
});

When('I search the ticket picker for {string}', async ({ page }, text: string) => {
  const picker = timePicker(page, 'Ticket');
  await picker.locator('[data-option-picker-trigger]').click();
  const answered = page.waitForResponse((response) => response.url().includes('/time/options/ticket'));
  await picker.locator('[data-option-picker-search]').fill(text);
  await answered;
});

Then('the ticket picker offers {string}', async ({ page }, ticket: string) => {
  await expect(timePicker(page, 'Ticket').locator('.option-list__label', { hasText: endsWith(ticket) })).toBeVisible();
});

Then('the ticket picker shows no ticket', async ({ page }) => {
  await expect(timePicker(page, 'Ticket').locator('[data-picker-part="value"]')).toHaveCount(0);
});

When('I double-click Save', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).dblclick();
  await page.waitForLoadState('domcontentloaded');
});

Then('exactly {int} time entr(y)(ies) described as {string} exist(s)', async ({}, count: number, description: string) => {
  const stored = php(
    'print count(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}", "voided" => 0]));`,
  );
  expect(Number(stored)).toBe(count);
});

Then('the stored ticket for description {string} is empty', async ({}, description: string) => {
  const ticket = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}"]))) ? (string) $e->get("ticket_id")->target_id : "missing");`,
  );
  expect(ticket).toBe('');
});

When('I choose the project {string} without JavaScript', async ({ page }, project: string) => {
  // The radios are visually hidden inside their labels; a reader clicks the label.
  await page.locator('label.option-list__control').filter({ has: page.locator('.option-list__label', { hasText: endsWith(project) }) }).first().click();
  await page.getByRole('button', { name: 'Search tickets', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I choose the ticket {string} without JavaScript', async ({ page }, ticket: string) => {
  await page.getByLabel('Find a ticket', { exact: true }).fill(ticket);
  await page.getByRole('button', { name: 'Search tickets', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('label.option-list__control').filter({ has: page.locator('.option-list__label', { hasText: endsWith(ticket) }) }).first().click();
});

When('I fill the date {string}', async ({ page }, date: string) => {
  await openChange(page);
  await timeScope(page).getByLabel('Date', { exact: true }).fill(date);
});

Then('the time form shows date {string}', async ({ page }, date: string) => {
  await expect(timeScope(page).getByLabel('Date', { exact: true })).toHaveValue(date);
});

When(
  'I visit Record time suggesting the project {string} and the date {string}',
  async ({ page }, project: string, date: string) => {
    const id = php(`print current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${safe(project)}"]))->id();`);
    expect(id).toMatch(/^\d+$/);
    await page.goto(`/time/add?project=${id}&date=${encodeURIComponent(date)}`);
    await markDocument(page);
  },
);
