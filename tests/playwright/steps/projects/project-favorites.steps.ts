// Favorite projects: the overview's page-header toggle and the rail heading.
// `I visit the project {string}` and the address step come from
// project-overview.steps.ts, `I visit the {string} listing` from
// projects-list.steps.ts.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { php } from '../../support/drush';
import { PAGE_HEADER_ISLAND, RAIL_ISLAND, uidOf } from '../../support/shell';

Given('the account {string} has no favorite projects', async ({}, name: string) => {
  php(
    'foreach (\\Drupal::entityTypeManager()->getStorage("bb_profile")' +
      `->loadByProperties(["uid" => ${uidOf(name)}]) as $p) { $p->set("favorite_projects", [])->save(); }`,
  );
});

When('I click the favorite toggle {string}', async ({ page }, label: string) => {
  const toggle = page.locator(PAGE_HEADER_ISLAND).getByRole('button', { name: label, exact: true });
  const response = page.waitForResponse((r) => r.url().includes('/favorite') && r.request().method() === 'POST' && r.status() < 400);
  await toggle.click();
  await response;
});

Then('the page header offers {string}', async ({ page }, label: string) => {
  await expect(page.locator(PAGE_HEADER_ISLAND).getByRole('button', { name: label, exact: true })).toBeVisible();
});

Then('the rail lists the favorite {string}', async ({ page }, name: string) => {
  const rail = page.locator(RAIL_ISLAND);
  await expect(rail.getByText('Favorites', { exact: true })).toBeVisible();
  await expect(rail.getByRole('link', { name, exact: true })).toBeVisible();
});

Then('the rail lists the Tickets of the favorite {string}', async ({ page }, name: string) => {
  const favorite = page.locator(RAIL_ISLAND).locator('li').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(favorite.getByRole('link', { name: 'Tickets', exact: true })).toHaveAttribute('href', /\/project\/\d+\/tickets$/);
});

Then('the rail lists no favorites', async ({ page }) => {
  await expect(page.locator(RAIL_ISLAND)).toBeVisible();
  await expect(page.locator(RAIL_ISLAND).getByText('Favorites', { exact: true })).toHaveCount(0);
});

When('I open the favorite {string} from the rail', async ({ page }, name: string) => {
  const before = page.url();
  await page.locator(RAIL_ISLAND).getByRole('link', { name, exact: true }).click();
  await expect.poll(() => page.url(), { timeout: 20000 }).not.toBe(before);
});
