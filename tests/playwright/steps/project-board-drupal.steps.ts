// The Project Board: its filter bar, columns, Done window, Details, cards and
// active conductors. The disposable project world and the shared Board
// observations come from support/steps/project-health-world.steps.ts.
import { When, Then } from '../bdd.fixtures';
import { Drush } from '../support/drush';
import { expect, type Locator, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { php } from '../support/drush';
import { card, expectCards } from '../support/board';
import { active, listing, safe } from '../support/listing';
import { requireWorld } from '../support/project-world';

let boardStatus = 0;

function projectId(name: string): string {
  const id = php(
    '$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"])); print $p ? $p->id() : "";`,
  );
  expect(id, 'The recipe supplies the Board project').not.toBe('');
  return id;
}

function filterBar(page: Page): Locator {
  return active(page).getByRole('search', { name: 'Board filters' });
}

function column(page: Page, name: string): Locator {
  return active(page).locator(`[data-col="${safe(name)}"]`).first();
}

/** What the filter bar offers, by the name a scenario gives it. */
const BAR_CONTROLS: Record<string, (bar: Locator) => Locator> = {
  Search: (bar) => bar.getByRole('textbox', { name: 'Search', exact: true }),
  State: (bar) => bar.getByRole('combobox', { name: /^Change State\./ }),
  Priority: (bar) => bar.getByRole('combobox', { name: /^Change Priority\./ }),
  Assignee: (bar) => bar.getByText('Assignee', { exact: true }),
  Details: (bar) => bar.getByRole('group', { name: 'Details', exact: true }),
};

/** Clicks a link and waits until the address has moved on. */
async function follow(page: Page, link: Locator): Promise<void> {
  const before = page.url();
  await link.click();
  await page.waitForFunction((url) => window.location.href !== url, before, { timeout: 20000 });
}

When('I visit the project board for {string}', async ({ page }, name: string) => {
  const response = await page.goto(`/bakers/project/${projectId(name)}/board`);
  boardStatus = response?.status() ?? 0;
});

// The top-level columns in order; Details' state columns sit inside Working.
Then('the Board shows the columns {string}', async ({ page }, names: string) => {
  await expect.poll(() => active(page).locator('[data-col]').evaluateAll(
    (columns) => columns.filter((col) => !col.parentElement?.closest('[data-col]')).map((col) => col.getAttribute('data-col')),
  ), { timeout: 10000 }).toEqual(names.split(', '));
});

Then('the Board filter bar offers {string}', async ({ page }, controls: string) => {
  await expect(active(page).getByRole('search')).toHaveCount(1);
  for (const control of controls.split(', ')) {
    await expect(BAR_CONTROLS[control](filterBar(page)).first(), control).toBeVisible();
  }
});

// People are filtered by the Assignee avatars; a Conductor filter said the
// same thing twice.
Then('the Board shows no Conductor filter', async ({ page }) => {
  await expect(active(page).getByLabel('Conductor', { exact: true })).toHaveCount(0);
});

When('I search the Board for {string}', async ({ page }, text: string) => {
  await BAR_CONTROLS.Search(filterBar(page)).fill(text);
  await BAR_CONTROLS.Search(filterBar(page)).press('Enter');
  await active(page).waitForFunction(() => new URLSearchParams(window.location.search).has('search'), undefined, { timeout: 20000 });
});

Then('the Board shows no active filter', async ({ page }) => {
  await expect(active(page).locator('[data-active-filters="empty"]')).toBeVisible({ timeout: 10000 });
  await expect(active(page).locator('[data-facet]')).toHaveCount(0);
});

When('I choose {string} in the Board details', async ({ page }, label: string) => {
  await follow(active(page), BAR_CONTROLS.Details(filterBar(page)).getByRole('link', { name: label, exact: true }));
});

Then('the {string} column shows the tickets {string}', async ({ page }, name: string, titles: string) => {
  await expectCards(column(page, name), titles);
});

Then('the {string} column holds no state columns', async ({ page }, name: string) => {
  await expect(column(page, name)).toBeVisible();
  await expect(column(page, name).locator('[data-col]')).toHaveCount(0);
});

Then('the {string} column holds the state columns {string}', async ({ page }, name: string, states: string) => {
  await expect.poll(() => column(page, name).locator('[data-col]').evaluateAll(
    (columns) => columns.map((col) => `${col.getAttribute('data-col')} ${col.getAttribute('data-count')}`),
  ), { timeout: 10000 }).toEqual(states.split(', '));
});

Then('the {string} column header reads {string}', async ({ page }, name: string, text: string) => {
  await expect(column(page, name).locator('h2')).toContainText(text);
});

When('I click {string} in the Done column', async ({ page }, label: string) => {
  await follow(active(page), column(page, 'Done').getByRole('link', { name: label, exact: true }));
});

Then('the Done column is open', async ({ page }) => {
  await expect(column(page, 'Done').getByRole('link', { name: 'Hide done', exact: true })).toBeVisible({ timeout: 10000 });
});

Then('the Done column is closed', async ({ page }) => {
  await expect(column(page, 'Done').getByRole('link', { name: 'Show done', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(column(page, 'Done').locator('article')).toHaveCount(0);
});

Then('the Done column reads {string}', async ({ page }, text: string) => {
  await expect(column(page, 'Done').getByText(text, { exact: true })).toBeVisible();
});

Then('the card {string} reads {string}', async ({ page }, title: string, text: string) => {
  await expect(card(active(page), title)).toContainText(text);
});

Then('the card {string} reads no runs', async ({ page }, title: string) => {
  await expect(card(active(page), title)).toBeVisible();
  await expect(card(active(page), title)).not.toContainText(/\d+ runs?\b/);
});

Then('the card {string} is blocked by {string}', async ({ page }, title: string, blocker: string) => {
  const identifier = requireWorld().identifiers[blocker];
  expect(identifier, `the world has no ticket "${blocker}"`).toBeTruthy();
  await expect(card(active(page), title)).toContainText(`Blocked by ${identifier}`);
});

// A new browser context signs in afresh: what it shows comes from the
// account, not from the first session.
When('I open the world project Board in another browser session', async ({ page }) => {
  const world = requireWorld();
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
  const other = await context.newPage();
  await other.goto(Drush.exec(`uli --uid=${world.ids.lead} --no-browser --uri=${origin}`).trim());
  const response = await other.goto(`${origin}${world.board}`);
  expect(response?.status()).toBe(200);
  listing.page = other;
});

Then('the Active conductors are {string}', async ({ page }, note: string) => {
  await expect(active(page).getByRole('heading', { name: 'Active conductors', exact: true })).toBeVisible();
  await expect(active(page).getByText(note, { exact: true })).toBeVisible();
});

// Exactly these rows; each listed column is read under its header.
Then('the Active conductors list:', async ({ page }, table: DataTable) => {
  const conductors = active(page).getByRole('table').filter({ has: active(page).getByRole('columnheader', { name: 'Load' }) });
  const headers = (await conductors.getByRole('columnheader').allInnerTexts()).map((header) => header.trim().toLowerCase());
  const expected = table.hashes();
  await expect(conductors.locator('tbody tr')).toHaveCount(expected.length);
  for (const { conductor, ...cells } of expected) {
    const row = conductors.locator('tbody tr').filter({ has: active(page).getByRole('link', { name: conductor, exact: true }) });
    for (const [header, value] of Object.entries(cells)) {
      await expect(row.getByRole('cell').nth(headers.indexOf(header)), `${conductor} ${header}`).toHaveText(value);
    }
  }
});

Then('the project board denies access', async ({ page }) => {
  expect([403, 404]).toContain(boardStatus);
  await expect(page.locator('[data-col]')).toHaveCount(0);
});
