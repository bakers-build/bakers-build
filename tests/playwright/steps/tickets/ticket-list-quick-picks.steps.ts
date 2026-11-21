// A facet pick or sort change made while the previous boosted GET is in flight.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Given, When, Then } from '../../bdd.fixtures';
import { active, facetRow, SEARCH_TOOLBAR } from '../../support/listing';
import { CONTENT_ISLAND } from '../../support/shell';

// Holds every htmx request long enough that the second pick always lands
// while the first is in flight, so the race is deterministic.
Given('list requests answer slowly', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().headers()['hx-request']) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });
});

When(
  'I click {string} and then {string} in the {string} facet without waiting',
  async ({ page }, first: string, second: string, facet: string) => {
    const target = active(page);
    await (await facetRow(page, facet, first)).click();
    await target.waitForSelector('.htmx-request', { state: 'attached', timeout: 5000 });
    await (await facetRow(page, facet, second)).click();
    await settle(target);
  },
);

When(
  'I click {string} in the {string} facet and then sort by {string} without waiting',
  async ({ page }, label: string, facet: string, sort: string) => {
    const target = active(page);
    await (await facetRow(page, facet, label)).click();
    await target.waitForSelector('.htmx-request', { state: 'attached', timeout: 5000 });
    await target.locator(`${CONTENT_ISLAND} ${SEARCH_TOOLBAR} select[name="sort_bef_combine"]`).selectOption(sort);
    await settle(target);
  },
);

Then('no facet says {string}', async ({ page }, text: string) => {
  await expect(active(page).locator('[data-picker-part=status]', { hasText: text })).toHaveCount(0);
});

// Every answer (1.5 s each) has arrived and nothing is in flight.
async function settle(target: Page): Promise<void> {
  await target.waitForTimeout(4000);
  await target.waitForFunction(() => !document.querySelector('.htmx-request'), null, { timeout: 20000 });
}
