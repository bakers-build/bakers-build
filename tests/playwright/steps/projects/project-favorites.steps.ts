// Favorite projects: the overview's page-header toggle and their rows under
// the rail's Projects entry.
// `I visit the project {string}` and the address step come from
// project-overview.steps.ts, `I visit the {string} listing` from
// projects-list.steps.ts, `I visit the ticket list of project {string}` from
// ticket-create.steps.ts.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { PAGE_HEADER_ISLAND, RAIL_ISLAND, uidOf } from '../../support/shell';

Given('the account {string} has no favorite projects', async ({}, name: string) => {
  php(
    'foreach (\\Drupal::entityTypeManager()->getStorage("bb_profile")' +
      `->loadByProperties(["uid" => ${uidOf(name)}]) as $p) { $p->set("favorite_projects", [])->save(); }`,
  );
});

Given('the account {string} has the favorite project {string}', async ({}, name: string, project: string) => {
  php(
    '$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => ${JSON.stringify(project)}]));` +
      '\\Drupal::service(\\Drupal\\bb_core\\Profile\\Profiles::class)' +
      `->forEditing(${uidOf(name)}, (int) $p->getGroup()->getWorkspace()->id())->toggleFavorite((int) $p->id())->save();`,
  );
});

When('I click the favorite toggle {string}', async ({ page }, label: string) => {
  const toggle = page.locator(PAGE_HEADER_ISLAND).getByRole('button', { name: label, exact: true });
  // The island action posts to the page itself, naming its action.
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && (r.request().postData() ?? '').includes('_island_action=toggle') && r.status() < 400,
  );
  await toggle.click();
  await response;
});

Then('the page header offers {string}', async ({ page }, label: string) => {
  await expect(page.locator(PAGE_HEADER_ISLAND).getByRole('button', { name: label, exact: true })).toBeVisible();
});

// The rail row of a project: the `li` whose own link carries the name.
function railRow(page: Page, name: string): Locator {
  return page.locator(RAIL_ISLAND).locator(`li:has(> div > a[aria-label="${name.replace(/"/g, '\\"')}"])`);
}

Then('the rail lists the favorite {string} under Projects', async ({ page }, name: string) => {
  await expect(railRow(page, 'Projects').getByRole('link', { name, exact: true })).toBeVisible();
});

Then('the rail lists the Tickets of the favorite {string}', async ({ page }, name: string) => {
  await expect(railRow(page, name).getByRole('link', { name: 'Tickets', exact: true })).toHaveAttribute('href', /\/project\/\d+\/tickets$/);
});

Then('the rail has no Favorites section', async ({ page }) => {
  await expect(page.locator(RAIL_ISLAND).getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.locator(RAIL_ISLAND).getByText('Favorites', { exact: true })).toHaveCount(0);
});

Then('the rail does not list the favorite {string}', async ({ page }, name: string) => {
  await expect(page.locator(RAIL_ISLAND).getByRole('link', { name: 'Projects', exact: true })).toBeAttached();
  await expect(railRow(page, name)).toHaveCount(0);
  await expect(page.locator(RAIL_ISLAND).getByText('Favorites', { exact: true })).toHaveCount(0);
});

When('I open the Tickets of the favorite {string} from the rail', async ({ page }, name: string) => {
  const before = page.url();
  await railRow(page, name).getByRole('link', { name: 'Tickets', exact: true }).click();
  await expect.poll(() => page.url(), { timeout: 20000 }).not.toBe(before);
  expect(page.url()).toMatch(/\/project\/\d+\/tickets$/);
});

// `aria-current` is what `nav` emits for the current entry.
function currentTickets(page: Page): Locator {
  return page.locator(RAIL_ISLAND).locator('a[aria-current="page"][aria-label="Tickets"]');
}

Then('exactly one rail Tickets entry is current, the one of the favorite {string}', async ({ page }, name: string) => {
  await expect(currentTickets(page)).toHaveCount(1);
  await expect(railRow(page, name).locator('a[aria-current="page"][aria-label="Tickets"]')).toHaveCount(1);
});

Then('exactly one rail Tickets entry is current, the one under Projects', async ({ page }) => {
  await expect(currentTickets(page)).toHaveCount(1);
  await expect(railRow(page, 'Projects').locator(':scope > ul > li > div > a[aria-current="page"][aria-label="Tickets"]')).toHaveCount(1);
});

When('I open the favorite {string} from the rail', async ({ page }, name: string) => {
  const before = page.url();
  await page.locator(RAIL_ISLAND).getByRole('link', { name, exact: true }).click();
  await expect.poll(() => page.url(), { timeout: 20000 }).not.toBe(before);
});
