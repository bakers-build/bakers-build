import { expect, type Locator } from '@playwright/test';
import { Given, Then, When } from '@key-tec/playwright-core/bdd';
import { CONTENT_ISLAND, markDocument } from '../../support/shell';

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

// The period range's kind menu names the selected kind.
Then('the selected Stats period is {string}', async ({ page }, label: string) => {
  await expect(
    page.locator(CONTENT_ISLAND).locator('[data-bakers-tab-body="stats"] [x-ref="kindTrigger"]'),
  ).toHaveText(label);
});

// UTC, the same calendar the server buckets by.
When('I open the Stats period from {int} days ago until today', async ({ page }, days: number) => {
  const day = (offset: number): string => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  const query = new URLSearchParams([
    ['filter[period]', 'custom'],
    ['filter[start]', day(days)],
    ['filter[end]', day(0)],
  ]);
  await page.goto(`${myWorkUrl('Stats')}?${query.toString()}`);
  await markDocument(page);
});

Then('the Stats period fixture displays {int} closed tickets', async ({ page }, count: number) => {
  await expect(
    await periodFixtureClosedTickets(page.locator(CONTENT_ISLAND).locator('[data-bakers-tab-body="stats"]')),
  ).toHaveText(String(count));
});

async function periodFixtureClosedTickets(body: Locator): Promise<Locator> {
  const table = body.locator('[data-statistics-figure="user_projects"]').getByRole('table');
  const headers = (await table.getByRole('columnheader').allTextContents()).map((header) => header.trim());
  const index = headers.findIndex((header) => header.startsWith('Closed'));
  expect(index, 'My projects exposes its closed-ticket column.').toBeGreaterThanOrEqual(0);
  // Row header and cells are siblings, so the column is the nth child.
  return table.locator('tbody tr').filter({ hasText: PERIOD_FIXTURE_PROJECT }).locator('> *').nth(index);
}
