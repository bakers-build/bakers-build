// A second facet pick made while the first pick's boosted GET is in flight.
import { Given, When } from '../../bdd.fixtures';
import { active, facetRow } from '../../support/listing';

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
    // Both answers (1.5 s each) have arrived and nothing is in flight.
    await target.waitForTimeout(4000);
    await target.waitForFunction(() => !document.querySelector('.htmx-request'), null, { timeout: 20000 });
  },
);
