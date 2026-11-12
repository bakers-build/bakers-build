// The employee's editable week and AI proposals.
// Consumers: features/week-sheet.feature, features/time-proposal.feature,
// features/manual-worklog.feature.
import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { Given, Then, When } from '../../bdd.fixtures';
import { php } from '../drush';
import { openDialog, openInDialog } from '../dialog';
import { callTool, type ToolResult } from '../mcp';
import { safe } from '../picker';
import { markDocument } from '../shell';
import { gridCell } from './time-calendar.steps';

const projectUuid = '612a0000-0000-4000-8000-000000000001';
let proposalUuid = '';
let proposalEntries: Record<string, unknown>[] = [];
let resent: ToolResult;

When('I type {string} into the week grid row {string} on {string}', async ({ page }, value: string, row: string, column: string) => {
  await (await gridCell(page, row, column)).locator('input[type="text"]').fill(value);
});

When('I save the week', async ({ page }) => {
  await page.getByRole('button', { name: 'Save week', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await markDocument(page);
});

Then('the week grid row {string} on {string} shows the error {string}', async ({ page }, row: string, column: string, error: string) => {
  const input = (await gridCell(page, row, column)).locator('input[type="text"]');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(`[id="${await input.getAttribute('aria-describedby')}"]`)).toHaveText(error);
});

Then('the week grid row {string} on {string} is locked', async ({ page }, row: string, column: string) => {
  const cell = await gridCell(page, row, column);
  await expect(cell.locator('input[type="text"]')).toHaveCount(0);
  await expect(cell.getByRole('link')).toHaveText(/entries$/);
});

Then('the week grid row {string} on {string} is marked Proposed', async ({ page }, row: string, column: string) => {
  await expect((await gridCell(page, row, column)).getByText('Proposed', { exact: true })).toBeVisible();
});

Then('the week grid row {string} on {string} is not marked Proposed', async ({ page }, row: string, column: string) => {
  await expect((await gridCell(page, row, column)).getByText('Proposed', { exact: true })).toHaveCount(0);
});

Then('{string} of {string} on {string} totals {int} seconds', async ({}, account: string, project: string, date: string, seconds: number) => {
  const stored = php(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_track_worklog");' +
      `$u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${safe(account)}"]));` +
      `$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${safe(project)}"]));` +
      `$t = 0; foreach ($s->loadByProperties(["owner_user_id" => $u->id(), "project_id" => $p->id(), "work_date" => "${safe(date)}", "voided" => 0]) as $e) { if ($e->get("state")->value === "recorded") { $t += (int) $e->get("duration_seconds")->value; } } print $t;`,
  );
  expect(Number(stored)).toBe(seconds);
});

Given('the AI proposes {string} on {string} and {string} on {string} for project {string}', async ({ page }, first: string, firstDate: string, second: string, secondDate: string, project: string) => {
  expect(project).toBe('Time capture');
  proposalEntries = [[first, firstDate], [second, secondDate]].map(([duration, date]) => {
    const [hours, minutes] = duration.split(':').map(Number);
    return { source_system: 'browser', source_key: `proposal-${randomUUID()}`, source_version: '1', work_date: date,
      description: `Proposed ${date}`, duration_seconds: hours * 3600 + minutes * 60 };
  });
  const result = await callTool(page.request, 'bakers_time_propose', { project: projectUuid, entries: proposalEntries });
  expect(result.isError, result.message).toBe(false);
  proposalUuid = result.structuredContent?.submission as string;
});

When('the AI sends the proposal again', async ({ page }) => {
  resent = await callTool(page.request, 'bakers_time_propose', { project: projectUuid, entries: proposalEntries });
});

Then('the repeated proposal is refused as already recorded', async () => {
  expect(resent.isError, resent.message).toBe(true);
  expect(resent.message).toContain('Entry 1 (proposal-');
  expect(resent.message).toContain('This source was already recorded.');
});

When('I open the proposal review link', async ({ page }) => {
  await page.goto(`/bakers/time?mode=week&submission=${proposalUuid}`);
  await markDocument(page);
});

Then('the proposal is {string}', async ({}, state: string) => {
  const stored = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_submission")' +
      `->loadByProperties(["uuid" => "${proposalUuid}"]))) ? $e->get("state")->value : "missing");`,
  );
  expect(stored).toBe(state);
});

Then('no proposed entry of the proposal is left', async () => {
  const count = php(
    '$s = current(\\Drupal::entityTypeManager()->getStorage("bb_track_submission")' +
      `->loadByProperties(["uuid" => "${proposalUuid}"]));` +
      ' print count(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")->loadByProperties(["submission_id" => $s->id(), "state" => "proposed", "voided" => 0]));',
  );
  expect(Number(count)).toBe(0);
});

When('I discard the proposal', async ({ page }) => {
  await page.getByRole('button', { name: 'Discard proposal', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await markDocument(page);
});

When('I open the proposed entry dated {string}', async ({ page }, date: string) => {
  const uuid = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "Proposed ${safe(date)}", "voided" => 0]))) ? $e->uuid() : "");`,
  );
  expect(uuid).not.toBe('');
  await page.goto(`/time/${uuid}/edit`);
});

Then('I see the Submit action', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();
});

Given(
  '{string} recorded {string} on {string} for project {string} described as {string}',
  async ({}, account: string, duration: string, date: string, project: string, description: string) => {
    const [hours, minutes] = duration.split(':').map(Number);
    const result = php(
      `$u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${safe(account)}"]));` +
        `$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${safe(project)}"]));` +
        // An earlier attempt's entry would merge into the cell; replace it so a retry starts clean.
        '$s = \\Drupal::entityTypeManager()->getStorage("bb_track_worklog");' +
        `$s->delete($s->loadByProperties(["owner_user_id" => $u->id(), "work_date" => "${safe(date)}", ` +
        `"project_id" => $p->id(), "description" => "${safe(description)}"]));` +
        '$s->create(["owner_user_id" => $u->id(), ' +
        `"work_date" => "${safe(date)}", "timezone" => "Europe/Berlin", "duration_seconds" => ${hours * 3600 + minutes * 60}, ` +
        `"description" => "${safe(description)}", "derivation" => "manual", "state" => "recorded", "project_id" => $p->id()])->save(); print "ok";`,
    );
    expect(result).toBe('ok');
  },
);

When('I open the details of the week grid row {string} on {string}', async ({ page }, row: string, column: string) => {
  await openInDialog(page, (await gridCell(page, row, column)).getByRole('link', { name: 'Details' }));
});

Then('the time dialog leads with {string}', async ({ page }, text: string) => {
  await expect(openDialog(page).getByText(text, { exact: false }).first()).toBeVisible();
});

Then('the time dialog marks the entry {string}', async ({ page }, state: string) => {
  await expect(openDialog(page).getByText(state, { exact: true })).toBeVisible();
});

Then('the address still shows the week of {string}', async ({ page }, date: string) => {
  await expect(page).toHaveURL(new RegExp(`mode=week.*date=${date}|date=${date}.*mode=week`));
});

/** Picks the row whose label ends with the text in a dialog picker. */
async function pickInDialog(page: Page, field: string, text: string): Promise<void> {
  const picker = openDialog(page).locator(`[data-option-picker][data-option-picker-label="${field}"]`);
  await expect(picker).toHaveAttribute('data-option-picker-ready');
  await picker.locator('[data-option-picker-trigger]').click();
  if (await picker.getAttribute('data-option-picker-remote') !== null) {
    // A remote picker searches on the server; wait for the typed text's rows.
    const answered = page.waitForResponse((response) => response.url().includes('/time/options/ticket'));
    await picker.locator('[data-option-picker-search]').fill(text);
    await answered;
  }
  await picker.locator('[role="option"]').filter({ has: page.locator('.option-list__label', { hasText: new RegExp(`${text}$`) }) }).first().click();
}

/** Adds a week row through the Add row dialog. */
async function addWeekRow(page: Page, project: string, ticket?: string): Promise<void> {
  await openInDialog(page, page.getByRole('link', { name: 'Add row', exact: true }));
  await pickInDialog(page, 'Project', `· ${project}`);
  // The pick rebuilds the dialog with that project's tickets.
  await expect(openDialog(page).locator('[data-option-picker-label="Ticket"][data-option-picker-remote][data-option-picker-ready]')).toBeVisible();
  await expect(openDialog(page).getByRole('button', { name: 'Show tickets' })).toBeHidden();
  if (ticket) {
    await pickInDialog(page, 'Ticket', ticket);
  }
  await openDialog(page).getByRole('button', { name: 'Add row', exact: true }).click();
  await expect(page).toHaveURL(/rows=/);
  await markDocument(page);
}

When('I add the week row for project {string} in the dialog', async ({ page }, project: string) => {
  await addWeekRow(page, project);
});

When('I add the week row for project {string} and ticket {string} in the dialog', async ({ page }, project: string, ticket: string) => {
  await addWeekRow(page, project, ticket);
});

Then('the week grid has a row ending in {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('table').getByRole('rowheader', { name: new RegExp(`${text}$`) })).toBeVisible();
});

Then('the week grid has a row {string}', async ({ page }, row: string) => {
  await expect(page.getByRole('table').getByRole('rowheader', { name: row, exact: true })).toBeVisible();
});

Then('the week grid row {string} reads {string} on {string}', async ({ page }, row: string, value: string, column: string) => {
  await expect(await gridCell(page, row, column)).toHaveText(value);
});

When('I follow the locked cell of the week grid row {string} on {string}', async ({ page }, row: string, column: string) => {
  await (await gridCell(page, row, column)).getByRole('link').click();
  await page.waitForLoadState('domcontentloaded');
});

Then('the address filters by project', async ({ page }) => {
  await expect(page).toHaveURL(/[?&]project=\d+/);
});

When('I clear the filters', async ({ page }) => {
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

Then('the address keeps the day {string} without filters', async ({ page }, date: string) => {
  await expect(page).toHaveURL(new RegExp(`date=${date}`));
  await expect(page).not.toHaveURL(/[?&](project|ticket|person)=/);
  await expect(page.getByRole('link', { name: 'Clear filters', exact: true })).toHaveCount(0);
});

Given('I use a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

Then('the time entry described as {string} is dated {string}', async ({}, description: string, date: string) => {
  const stored = php(
    // The newest entry of that description is the one just recorded.
    '$all = \\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}"]); print ($all ? end($all)->get("work_date")->value : "");`,
  );
  expect(stored).toBe(date);
});

Then('the page does not scroll sideways', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

/** Presses Enter on a submit control and waits for the answering document. */
async function submitWithEnter(page: Page): Promise<void> {
  const loaded = page.waitForEvent('load');
  await page.keyboard.press('Enter');
  await loaded;
}

/** Tabs until the focused element matches, within a bounded number of steps. */
async function tabTo(page: Page, matches: (el: Element) => boolean, what: string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(`(${matches.toString()})(document.activeElement)`)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${what}.`);
}

When(
  'I record with the keyboard only {string} on project {string} dated {string} described as {string}',
  async ({ page }, duration: string, project: string, date: string, description: string) => {
    await expect(page.locator('[data-option-picker-label="Project"][data-option-picker-ready]')).toBeVisible();
    await tabTo(page, (el) => el.matches('[data-option-picker-label="Project"] [data-option-picker-trigger]'), 'the Project picker');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-option-picker-label="Project"] [data-option-picker-search]')).toBeFocused();
    await page.keyboard.type(project);
    const rebuilt = page.waitForResponse((response) => response.request().method() === 'POST');
    await page.keyboard.press('Enter');
    await rebuilt;
    await expect(page.locator('[data-option-picker-label="Ticket"][data-option-picker-ready]')).toBeVisible();
    await tabTo(page, (el) => el.matches('input[name="work_date"]'), 'Date');
    // A date input takes its segments in the order it displays, which follows
    // the operating system rather than navigator.language: type, read back,
    // and type over in the next order when the value came out different.
    const [year, month, day] = date.split('-');
    const dateInput = page.locator('input[name="work_date"]');
    for (const order of [[day, month, year], [month, day, year], [year, month, day]]) {
      // Back to the first segment: focus keeps the last one, arrows walk left.
      await dateInput.focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type(order.join(''));
      if ((await dateInput.inputValue()) === date) {
        break;
      }
    }
    await expect(dateInput).toHaveValue(date);
    await tabTo(page, (el) => el.matches('input[name="duration"]'), 'Duration');
    await page.keyboard.type(duration);
    await tabTo(page, (el) => el.matches('textarea[name="description"]'), 'Description');
    await page.keyboard.type(description);
    await tabTo(page, (el) => el.matches('input[type="submit"][value="Save"], button[type="submit"]'), 'Save');
    await submitWithEnter(page);
  },
);

Then('the focus is on the {string} field and its error is announced', async ({ page }, label: string) => {
  const field = page.getByLabel(label, { exact: true });
  await expect(field).toBeFocused();
  await expect(page.getByRole('alert').or(page.locator('[data-drupal-messages] [role="alert"], .messages--error')).first()).toBeVisible();
});

When(
  'I type {string} with the keyboard into the week grid row {string} on {string} and save the week with Enter',
  async ({ page }, value: string, row: string, column: string) => {
    const input = (await gridCell(page, row, column)).locator('input[type="text"]');
    await tabTo(page, (el) => el.matches('table input[type="text"]'), 'the first grid cell');
    for (let i = 0; i < 60 && !(await input.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(input).toBeFocused();
    await page.keyboard.type(value);
    await tabTo(page, (el) => el.matches('input[type="submit"][value="Save week"], button[value="Save week"]'), 'Save week');
    await submitWithEnter(page);
  },
);

When('I open the submission canonical', async ({ page }) => {
  await page.goto(`/time/submission/${proposalUuid}`);
});

Then('the submission shows only the days {string}', async ({ page }, dates: string) => {
  await expect(page.getByRole('heading', { name: 'Submission', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Time', exact: true })).toBeVisible();
  const headers = await page.getByRole('columnheader').allTextContents();
  const days = headers.flatMap((header) => header.match(/\d{4}-\d{2}-\d{2}/g) ?? []);
  expect(days).toEqual(dates.split(','));
});

When('I change the first submission entry to {string} described as {string}', async ({ page }, duration: string, description: string) => {
  const row = page.locator('[data-submission-entry]').first();
  await page.getByLabel('Duration (hours:minutes)', { exact: true }).first().fill(duration);
  if (!(await row.evaluate((element) => (element as HTMLDetailsElement).open))) await row.locator('summary').click();
  await row.getByLabel('Description', { exact: true }).fill(description);
});

When('I open the first submission entry details', async ({ page }) => {
  const details = page.locator('[data-submission-entry]').first();
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
});

Then('the submission total is {string}', async ({ page }, total: string) => {
  await expect(page.getByRole('table').getByRole('row').last().getByRole('cell').last()).toHaveText(total);
});

When('I save the submission', async ({ page }) => {
  await page.getByRole('button', { name: 'Save time', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

/** The oldest live entry of the current proposal. */
function firstSubmissionEntry(): string {
  return php(
    '$s = current(\\Drupal::entityTypeManager()->getStorage("bb_track_submission")' +
    `->loadByProperties(["uuid" => "${proposalUuid}"]));` +
    '$store = \\Drupal::entityTypeManager()->getStorage("bb_track_worklog");' +
    '$ids = $store->getQuery()->accessCheck(FALSE)->condition("submission_id", $s->id())->condition("voided", 0)->sort("id")->range(0, 1)->execute();' +
    'print $store->load(reset($ids))->uuid();',
  );
}

When('another tab changes the first submission entry to {string}', async ({ page }, description: string) => {
  const other = await page.context().newPage();
  await other.goto(`/time/${firstSubmissionEntry()}/edit`);
  await other.getByLabel('Description', { exact: true }).fill(description);
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await other.waitForLoadState('domcontentloaded');
  await other.close();
});

When('another tab deletes the first submission entry', async ({ page }) => {
  const other = await page.context().newPage();
  await other.goto(`/time/${firstSubmissionEntry()}/delete`);
  await other.getByRole('button', { name: 'Confirm', exact: true }).click();
  await other.waitForLoadState('domcontentloaded');
  await other.close();
});

Then('the first submission entry retains description {string}', async ({ page }, description: string) => {
  const response = await page.request.get(`/jsonapi/bb_track_worklog/bb_track_worklog/${firstSubmissionEntry()}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).data.attributes.description).toBe(description);
});

Then('the first submission entry is assigned to project {string} and ticket {string}', async ({}, project: string, ticket: string) => {
  const uuid = firstSubmissionEntry();
  const stored = php(
    '$e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
    `->loadByProperties(["uuid" => "${uuid}"]));` +
    'print json_encode([$e->get("project_id")->entity->label(), $e->get("ticket_id")->entity?->label()]);',
  );
  expect(JSON.parse(stored)).toEqual([project, ticket]);
});

When('I choose the first submission project {string} without JavaScript', async ({ page }, project: string) => {
  const row = page.locator('[data-submission-entry]').first();
  await row.locator('label.option-list__control').filter({ has: page.locator('.option-list__label', { hasText: new RegExp(`· ${project}$`) }) }).first().click();
  await page.getByRole('button', { name: 'Update ticket choices', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I choose the first submission ticket {string} without JavaScript', async ({ page }, ticket: string) => {
  const row = page.locator('[data-submission-entry]').first();
  await row.getByLabel('Find a ticket', { exact: true }).fill(ticket);
  await page.getByRole('button', { name: 'Update ticket choices', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await row.locator('label.option-list__control').filter({ has: page.locator('.option-list__label', { hasText: ticket }) }).first().click();
});

Then('the first submission duration is {string}', async ({ page }, duration: string) => {
  await expect(page.getByLabel('Duration (hours:minutes)', { exact: true }).first()).toHaveValue(duration);
});
