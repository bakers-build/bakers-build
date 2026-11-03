// Machine listing in the user-area rail.
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cardField, cardRow } from '../../support/detail-cards';
import { php } from '../../support/drush';
import { SEARCH_TOOLBAR, safe } from '../../support/listing';
import { CONTENT_ISLAND, markDocument } from '../../support/shell';

const USER_LIST_FORM = '#views-exposed-form-machines-user-list';

function uidOf(name: string): string {
  const uid = php(
    'print (($u = current(\\Drupal::entityTypeManager()->getStorage("user")' +
      `->loadByProperties(["name" => "${safe(name)}"]))) ? $u->id() : "");`,
  );
  if (!uid) {
    throw new Error(`No account named "${name}" exists.`);
  }
  return uid;
}

function userList(page: Page): Locator {
  return page
    .locator(`${CONTENT_ISLAND} .views-element-container`)
    .filter({ has: page.locator(USER_LIST_FORM) });
}

function userListRows(page: Page): Locator {
  return userList(page).locator('[data-component-id="bb_theme:list"] li[data-list-item]');
}

async function searchUserMachines(page: Page, query: string): Promise<void> {
  const field = userList(page).locator(SEARCH_TOOLBAR).locator('input[name="title"]');
  await expect(field, 'No search field on the user Machines listing').toBeVisible();
  await field.fill(query);
  await field.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('.htmx-request'),
    null,
    { timeout: 20000 },
  );
  await expect(page.locator(USER_LIST_FORM)).toBeAttached({ timeout: 20000 });
}

When('I visit my machines listing', async ({ page }) => {
  const response = await page.goto(`/user/${uidOf('north-lead')}/machines`);
  expect(response?.status() ?? 0, 'The user Machines listing did not render').toBeLessThan(400);
  await expect(page.locator(USER_LIST_FORM)).toBeAttached({ timeout: 10000 });
  await expect(userList(page).locator(SEARCH_TOOLBAR)).toBeVisible({ timeout: 10000 });
  await markDocument(page);
});

When('I search the user machines listing for {string}', async ({ page }, query: string) => {
  await searchUserMachines(page, query);
});

Then('the user Machines listing is visible', async ({ page }) => {
  await expect(page.locator(USER_LIST_FORM)).toBeAttached({ timeout: 10000 });
  await expect(userList(page).locator(SEARCH_TOOLBAR)).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => await userListRows(page).count(), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
});

Then('the user Machines listing shows {string}', async ({ page }, label: string) => {
  await expect(
    userList(page).locator('[data-component-id="bb_theme:list"]').getByText(label, { exact: true }),
  ).toBeVisible();
});

Then('the user Machines listing does not show {string}', async ({ page }, label: string) => {
  await expect(
    userList(page).locator('[data-component-id="bb_theme:list"]').getByText(label, { exact: true }),
  ).toHaveCount(0);
});

Then('the user Machines listing is empty', async ({ page }) => {
  await expect(page.getByText('This account has no machines.')).toBeVisible();
});

type Machine = { url: string };

let current: Machine | null = null;

function machine(name: string): Machine {
  const raw = php(
    '$m = current(\\Drupal::entityTypeManager()->getStorage("bb_machine")' +
      `->loadByProperties(["name" => "${safe(name)}"]));` +
      ' print $m ? json_encode(["url" => $m->toUrl()->toString()]) : "";',
  );
  if (!raw) {
    throw new Error(`No bb_machine named "${name}" exists in the seeded world.`);
  }
  return JSON.parse(raw) as Machine;
}

When('I click the machine {string} in the listing', async ({ page }, name: string) => {
  current = machine(name);
  await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).getByRole('link', { name, exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe(current.url);
  await markDocument(page);
});

When('I visit the machine {string}', async ({ page }, name: string) => {
  current = machine(name);
  const response = await page.goto(current.url);
  expect(response?.status() ?? 0, `The machine "${name}" did not render`).toBeLessThan(400);
  await markDocument(page);
});

Then('the address is the detail of the machine {string}', async ({ page }, name: string) => {
  expect(new URL(page.url()).pathname).toBe(machine(name).url);
});

When('I visit the former edit address of the machine {string}', async ({ page }, name: string) => {
  const response = await page.goto(`${machine(name).url}/edit`);
  expect(response?.status()).toBe(200);
});

Then('the machine Overview shows its host key, max parallel and current load', async ({ page }) => {
  await expect(cardRow(page, 'Identity', 'Host key')).toContainText('e2e-host', { timeout: 10000 });
  await expect(cardField(page, 'Identity', 'Max parallel')).toBeVisible();
  await expect(cardRow(page, 'Identity', 'Current load')).toBeVisible();
});
