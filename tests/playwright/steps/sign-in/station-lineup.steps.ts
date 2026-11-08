// The station line-up beside the login card: slogan, stations, and the reader's own station.
import { Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';

const LINEUP = '[data-component-id="bb_theme:station_lineup"]';

Then('the station line-up shows the headline {string}', async ({ page }, headline: string) => {
  await expect(page.locator(LINEUP).getByRole('heading', { level: 1 })).toHaveText(headline);
});

// Role and action are read as text, in order: the circles carry nothing a reader needs.
Then('the station line-up shows the stations:', async ({ page }, table: DataTable) => {
  const stations = page.locator(LINEUP).getByRole('listitem');
  const expected = table.hashes();
  await expect(stations).toHaveCount(expected.length);
  for (const [index, { role, action }] of expected.entries()) {
    await expect(stations.nth(index)).toContainText(role);
    await expect(stations.nth(index)).toContainText(action);
  }
});

Then('the current station is {string}', async ({ page }, role: string) => {
  const current = page.locator(`${LINEUP} [aria-current="step"]`);
  await expect(current).toHaveCount(1);
  await expect(current).toContainText(role);
});

// Roles only: no tool icons, illustrations or logos inside the line-up.
Then('the station line-up shows no images', async ({ page }) => {
  await expect(page.locator(LINEUP)).toBeVisible();
  await expect(page.locator(LINEUP).locator('img, svg, picture, [role="img"]')).toHaveCount(0);
});

Then('the station line-up is absent', async ({ page }) => {
  await expect(page.locator(LINEUP)).toHaveCount(0);
});
