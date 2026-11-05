// The workspace Insights page: the rail entry, the period range, the sortable
// tables and the filter popovers.
//
// Login, rail clicks, headings and the address are NOT re-implemented here —
// `support/steps/shell.steps.ts`, `support/steps/listing.steps.ts` and
// `support/steps/accounts.steps.ts` own them. This file adds only what is new.
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RAIL_ISLAND } from '../../support/shell';
import { lastLine } from '../../support/disposable-ticket';

/** The block a statistics table sits in, found by its heading. */
const tableBlock = (page: Page, table: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: table, exact: true }) }).last();

/** Resolves once the page has navigated away from its current address. */
const navigated = (page: Page) => {
  const before = page.url();
  return page.waitForURL((url) => url.href !== before);
};

/** The filter picker whose field label is the given one. */
const picker = (page: Page, label: string) => page.locator(`[data-option-picker][data-option-picker-label="${label}"]`);

let lastStatus = 0;

When('I open the Insights of workspace {string}', async ({ page }, slug: string) => {
  const response = await page.goto(`/${slug}/insights`);
  lastStatus = response?.status() ?? 0;
  expect(lastStatus, 'The Insights page did not render').toBeLessThan(400);
});

When(
  'I open the Insights of workspace {string} for the period {string}',
  async ({ page }, slug: string, period: string) => {
    const response = await page.goto(`/${slug}/insights?filter[period]=${encodeURIComponent(period)}`);
    lastStatus = response?.status() ?? 0;
    expect(lastStatus, 'The Insights page did not render').toBeLessThan(400);
  },
);

When(
  'I open the Insights page {string} of workspace {string} for the period {string}',
  async ({ page }, path: string, slug: string, period: string) => {
    const response = await page.goto(`/${slug}/insights/${path}?filter[period]=${encodeURIComponent(period)}`);
    lastStatus = response?.status() ?? 0;
    expect(lastStatus, `The Insights page "${path}" did not render`).toBeLessThan(400);
  },
);

When('I request the Insights of workspace {string}', async ({ page }, slug: string) => {
  const response = await page.goto(`/${slug}/insights`);
  lastStatus = response?.status() ?? 0;
});

When('I request the Insights page {string} of workspace {string}', async ({ page }, path: string, slug: string) => {
  const response = await page.goto(`/${slug}/insights/${path}`);
  lastStatus = response?.status() ?? 0;
});

// A tree row's disclosure is a plain link named "Expand <row>".
When('I expand the row {string} of the table {string}', async ({ page }, row: string, table: string) => {
  const toggle = tableBlock(page, table).getByRole('link', { name: `Expand ${row}`, exact: true }).first();
  await Promise.all([navigated(page), toggle.click()]);
});

Then('the row {string} of the table {string} is expanded', async ({ page }, row: string, table: string) => {
  const toggle = tableBlock(page, table).getByRole('link', { name: `Collapse ${row}`, exact: true }).first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

Then('the request is answered with {int}', async ({}, status: number) => {
  expect(lastStatus).toBe(status);
});

Then(
  'the rail lists {string} directly before {string}',
  async ({ page }, first: string, second: string) => {
    const labels = (await page.locator(RAIL_ISLAND).getByRole('link').allInnerTexts()).map((text) => text.trim());
    const index = labels.indexOf(first);
    expect(index, `The rail does not list "${first}"`).toBeGreaterThanOrEqual(0);
    expect(labels[index + 1]).toBe(second);
  },
);

Then('the rail does not list {string}', async ({ page }, label: string) => {
  await expect(page.locator(RAIL_ISLAND).getByRole('link', { name: label, exact: true })).toHaveCount(0);
});

When('I choose the period kind {string}', async ({ page }, kind: string) => {
  await page.locator('[aria-haspopup="listbox"][x-ref="kindTrigger"]').click();
  await Promise.all([
    navigated(page),
    // An option's name is its kind and its current period, e.g. "Year 2026".
    page.getByRole('option', { name: new RegExp(`^${kind}\\b`) }).click(),
  ]);
});

// Derived, never a literal year: the page compares with the year before today (UTC).
Then('the period compares with the previous year', async ({ page }) => {
  await expect(page.getByText(`vs. ${new Date().getUTCFullYear() - 1}`).first()).toBeVisible();
});

When('I sort the table {string} by {string}', async ({ page }, table: string, column: string) => {
  const header = tableBlock(page, table).getByRole('columnheader', { name: column });
  await Promise.all([navigated(page), header.getByRole('link').click()]);
});

Then(
  'the column {string} of the table {string} is sorted {string}',
  async ({ page }, column: string, table: string, order: string) => {
    await expect(tableBlock(page, table).getByRole('columnheader', { name: column })).toHaveAttribute('aria-sort', order);
  },
);

When('I open the filter {string}', async ({ page }, label: string) => {
  await picker(page, label).locator('[data-option-picker-trigger]').click();
});

When('I search the filter for {string}', async ({ page }, query: string) => {
  await page.locator('[data-option-picker-search]:visible').fill(query);
});

// A tick applies at once: htmx GETs the page and pushes the new address.
When('I tick {string} in the filter', async ({ page }, label: string) => {
  await Promise.all([
    navigated(page),
    page.locator('[data-option-picker-panel]:visible [role="option"]').filter({ hasText: label }).first().click(),
  ]);
});

Then(
  'the open filter still shows the search {string} and its summary',
  async ({ page }, query: string) => {
    const panel = page.locator('[data-option-picker-panel]:visible');
    await expect(panel).toBeInViewport();
    await expect(panel.locator('[data-option-picker-search]')).toHaveValue(query);
    await expect(panel.getByText(/\d+ of \d+ selected/)).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  },
);

/** The value of the stat tile with the given label. */
const tileValue = (page: Page, label: string) =>
  page.locator('.stat-tile__label', { hasText: label }).locator('xpath=ancestor::*[.//*[contains(@class, "stat-tile__value")]][1]').locator('.stat-tile__value').first();

let notedTile = '';

When('I note the value of the tile {string}', async ({ page }, label: string) => {
  notedTile = (await tileValue(page, label).innerText()).trim();
});

Then('the value of the tile {string} has changed', async ({ page }, label: string) => {
  await expect(tileValue(page, label)).not.toHaveText(notedTile);
});

Then('the filter {string} reads {string}', async ({ page }, label: string, value: string) => {
  await expect(picker(page, label).locator('[data-option-picker-trigger]')).toContainText(value);
});

When('I follow {string}', async ({ page }, label: string) => {
  await Promise.all([navigated(page), page.getByRole('link', { name: label, exact: true }).click()]);
});

Then('the table {string} lists the row {string}', async ({ page }, table: string, row: string) => {
  await expect(tableBlock(page, table).getByRole('rowheader').filter({ hasText: row }).first()).toBeVisible();
});

/** A project's Stats tab address, resolved by its name. */
const projectStatsUrl = (name: string): string => {
  const url = lastLine([
    `$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${name}"]));`,
    'print $p ? $p->toUrl()->toString() . "/stats" : "NO_PROJECT";',
  ].join(' '));
  if (!url.startsWith('/')) {
    throw new Error(`No project named "${name}": "${url}".`);
  }
  return url;
};

When('I open the Stats of project {string}', async ({ page }, name: string) => {
  const response = await page.goto(projectStatsUrl(name));
  lastStatus = response?.status() ?? 0;
  expect(lastStatus, 'The project Stats tab did not render').toBeLessThan(400);
});

When('I request the Stats of project {string}', async ({ page }, name: string) => {
  const response = await page.goto(projectStatsUrl(name));
  lastStatus = response?.status() ?? 0;
});
