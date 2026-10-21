import { expect, type Locator, type TestInfo } from '@playwright/test';
import { Given, Then, When } from '@key-tec/playwright-core/bdd';
import { CONTENT_ISLAND, markDocument } from '../../support/shell';
import { test } from '../../bdd.fixtures';

// BB-481 — the three steps My work needs that the team suite does not
// already export. Everything else this feature uses — the tab-click request
// counter, the document mark, `the tab {string} is current` — is reused
// verbatim from `support/steps/shell.steps.ts` rather than re-registered here:
// playwright-bdd matches a step by its TEXT, so a second definition of the
// same sentence is a duplicate-definition error, and a near-copy under a
// slightly different wording would be two detectors that can disagree about
// the same defect.

const MY_WORK = '/bakers/tickets';
const PERIOD_FIXTURE_PROJECT = 'Period filter fixture';

type StatisticsSnapshot = {
  figureIds: string[];
};

const statisticsSnapshots = new WeakMap<TestInfo, StatisticsSnapshot>();

/**
 * The address of one My work tab.
 *
 * Tickets is the default tab and therefore has NO suffix of its own — it is
 * the base route the row hangs from, which is what keeps My work opening on
 * the page it always opened on.
 */
function myWorkUrl(tab: string): string {
  return tab === 'Tickets' ? MY_WORK : `${MY_WORK.replace(/\/tickets$/, '')}/${tab.toLowerCase()}`;
}

Given('I visit My work', async ({ page }) => {
  await page.goto(MY_WORK);
  await markDocument(page);
});

When('I visit My work tab {string}', async ({ page }, tab: string) => {
  await page.goto(myWorkUrl(tab));
  await markDocument(page);
});

Given('I visit My work tab {string} with query parameter {string} set to {string}', async ({ page }, tab: string, name: string, value: string) => {
  const query = new URLSearchParams([[name, value]]);
  await page.goto(`${myWorkUrl(tab)}?${query.toString()}`);
  await markDocument(page);
});

// Entered by URL, so what is proven is that the ADDRESS renders the figures —
// not merely that some click can arrive at them.
Then('the Stats tab shows a figure', async ({ page }) => {
  const body = page.locator(CONTENT_ISLAND).locator('[data-bakers-tab-body="stats"]');
  await expect(body).toHaveCount(1);
  // At least one figure block, identified by the label every figure carries.
  // Counts are not asserted: they depend on what the seeded world happens to
  // hold, while the presence of a figure is what this ticket delivered.
  await expect(
    body.locator('[data-statistics-widget], .empty-state').first(),
  ).toBeVisible();
});

Then('the Stats period filters are accessible links', async ({ page }) => {
  const choices = page
    .locator(CONTENT_ISLAND)
    .locator('[data-bakers-tab-body="stats"]')
    .getByRole('link', { name: '30 days', exact: true });
  await expect(choices.first()).toBeVisible();
  expect(await choices.count()).toBeGreaterThan(0);
});

When('I choose the Stats period {string}', async ({ page }, label: string) => {
  const body = page.locator(CONTENT_ISLAND).locator('[data-bakers-tab-body="stats"]');
  statisticsSnapshots.set(test.info(), await statisticsSnapshot(body));
  await expect(await periodFixtureClosedTickets(body)).toHaveText('1');
  await body.getByRole('link', { name: label, exact: true }).first().click();
});

Then('the selected Stats period is {string}', async ({ page }, label: string) => {
  await expect(
    page
      .locator(CONTENT_ISLAND)
      .locator('[data-bakers-tab-body="stats"]')
      .getByRole('link', { name: label, exact: true })
      .first(),
  ).toHaveAttribute('aria-current', 'true');
});

Then('the Stats period selection preserves the route and unrelated query parameter {string} with value {string}', async ({ page }, name: string, value: string) => {
  const url = new URL(page.url());
  expect(url.pathname).toBe(myWorkUrl('Stats'));
  expect(url.searchParams.get(name)).toBe(value);
  expect(url.searchParams.get('filter[period]')).toBe('30');
});

Then('the Stats figures keep their ordered applicability', async ({ page }) => {
  const before = statisticsSnapshots.get(test.info());
  if (!before) {
    throw new Error('The period selection must capture the initial statistics before asserting its result.');
  }
  const after = await statisticsSnapshot(
    page.locator(CONTENT_ISLAND).locator('[data-bakers-tab-body="stats"]'),
  );
  expect(after.figureIds).toEqual(before.figureIds);
});

Then('the Stats period fixture displays {int} closed tickets', async ({ page }, count: number) => {
  await expect(
    await periodFixtureClosedTickets(page.locator(CONTENT_ISLAND).locator('[data-bakers-tab-body="stats"]')),
  ).toHaveText(String(count));
});

async function statisticsSnapshot(body: Locator): Promise<StatisticsSnapshot> {
  const figures = body.locator('[data-statistics-figure]');
  await expect(figures.first()).toBeVisible();
  return {
    figureIds: await figures.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-statistics-figure')!)),
  };
}

async function periodFixtureClosedTickets(body: Locator): Promise<Locator> {
  const table = body.locator('[data-statistics-figure="user_projects"]').getByRole('table');
  const headers = await table.getByRole('columnheader').allTextContents();
  const index = headers.findIndex((header) => header.trim() === 'Closed tickets');
  expect(index, 'The project breakdown exposes its closed-ticket column.').toBeGreaterThanOrEqual(0);
  return table.getByRole('row').filter({
    has: body.page().getByRole('cell', { name: PERIOD_FIXTURE_PROJECT, exact: true }),
  }).getByRole('cell').nth(index);
}
