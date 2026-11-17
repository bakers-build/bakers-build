// The phone filter sheet: below `lg` a list's facets sit behind one "Filters"
// button that opens a dialog, and its count follows the chips.
// Consumer: features/tickets/ticket-list.feature.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { When, Then } from '../../bdd.fixtures';
import { facetRow, facetTrigger } from '../../support/listing';

// The opener reads "Filters" or "Filters · N". The desktop aside's own
// collapsible "Filters" heading is a <summary>, not this button.
const filtersButton = (page: Page) => page.getByRole('button', { name: /^Filters( · \d+)?$/ });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });

Then('the filters button reads {string}', async ({ page }, text: string) => {
  await expect(filtersButton(page)).toBeVisible();
  await expect(filtersButton(page)).toHaveText(text);
});

Then('there is no filters button', async ({ page }) => {
  await expect(filtersButton(page)).toBeHidden();
});

Then('the facets are hidden behind the filters button', async ({ page }) => {
  await expect(facetTrigger(page, 'State')).toBeHidden();
  await expect(sheet(page)).toBeHidden();
});

When('I open the filter sheet', async ({ page }) => {
  await filtersButton(page).click();
  await expect(sheet(page)).toBeVisible();
});

Then('the filter sheet holds the {string} facet', async ({ page }, facet: string) => {
  await expect(facetTrigger(sheet(page) as unknown as Page, facet)).toBeVisible();
});

// No auto-submit below `lg`: the tick stays in the form until "Show results".
When('I tick {string} in the {string} facet', async ({ page }, label: string, facet: string) => {
  const input = (await facetRow(page, facet, label)).locator('input');
  await input.focus();
  await page.keyboard.press(' ');
  await expect(input).toBeChecked();
});

Then('the filter sheet is open', async ({ page }) => {
  await page.waitForTimeout(1000); // An auto-submit would have swapped the sheet away by now.
  await expect(sheet(page)).toBeVisible();
});

Then('the filter sheet is closed', async ({ page }) => {
  await expect(sheet(page)).toBeHidden();
});

// A picker's open panel overlays the sheet's footer; closing it is what a
// person does before pressing "Show results".
When('I close the open filter', async ({ page }) => {
  await page.locator('[data-option-picker-trigger][aria-expanded="true"]').first().click();
  await expect(page.locator('[data-option-picker-panel]:visible')).toHaveCount(0);
});

// Escape closes a native modal dialog; unapplied ticks must not survive it.
When('I dismiss the filter sheet', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
});

Then('{string} is not ticked in the {string} facet', async ({ page }, label: string, facet: string) => {
  await expect((await facetRow(page, facet, label)).locator('input')).not.toBeChecked();
});

Then('the Insights period control fits on one line', async ({ page }) => {
  const box = (await page.locator('#insights-period').boundingBox())!;
  expect(box.height, `period control is ${box.height}px tall`).toBeLessThanOrEqual(48);
});
