// The ticket Details on a phone: below `lg` the inspector folds behind one
// disclosure button, closed by default; desktop always shows it.
// Consumer: features/tickets/ticket-detail.feature.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { When, Then } from '../../bdd.fixtures';

const DETAILS = 'Details · Assignee, Priority, Labels, Branch';
const disclosure = (page: Page) => page.getByRole('button', { name: DETAILS });
const assignee = (page: Page) => page.locator('[data-canvas-region="inspector"]').getByText('Assignee', { exact: true }).first();

Then('the ticket details are folded', async ({ page }) => {
  await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(assignee(page)).toBeHidden();
});

Then('the ticket details are unfolded', async ({ page }) => {
  await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(assignee(page)).toBeVisible();
});

When('I toggle the ticket details', async ({ page }) => {
  await disclosure(page).click();
});

Then('the ticket details show without a disclosure', async ({ page }) => {
  await expect(disclosure(page)).toBeHidden();
  await expect(assignee(page)).toBeVisible();
});

// Only a folded (labelled) inspector moves above the body on a phone.
Then('the main region comes before the inspector', async ({ page }) => {
  const main = (await page.locator('[data-canvas-region="main"]').boundingBox())!;
  const inspector = (await page.locator('[data-canvas-region="inspector"]').boundingBox())!;
  expect(main.y).toBeLessThan(inspector.y);
});
