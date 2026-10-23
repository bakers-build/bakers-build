// Conductor listing → Overview. Tab/heading/document steps live in shell.steps.ts.
import { When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { php } from '../../support/drush';
import { SEARCH_TOOLBAR, safe } from '../../support/listing';
import { CONTENT_ISLAND, markDocument } from '../../support/shell';
import { cardRow } from '../../support/detail-cards';

const USER_LIST_FORM = '#views-exposed-form-conductors-user-list';

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

async function searchUserConductors(page: Page, query: string): Promise<void> {
  const field = userList(page).locator(SEARCH_TOOLBAR).locator('input[name="title"]');
  await expect(field, 'No search field on the user Conductors listing').toBeVisible();
  await field.fill(query);
  await field.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('.htmx-request'),
    null,
    { timeout: 20000 },
  );
  await expect(page.locator(USER_LIST_FORM)).toBeAttached({ timeout: 20000 });
}

When('I visit my conductors listing', async ({ page }) => {
  const response = await page.goto(`/user/${uidOf('north-lead')}/conductors`);
  expect(response?.status() ?? 0, 'The user Conductors listing did not render').toBeLessThan(400);
  await expect(page.locator(USER_LIST_FORM)).toBeAttached({ timeout: 10000 });
  await expect(userList(page).locator(SEARCH_TOOLBAR)).toBeVisible({ timeout: 10000 });
  await markDocument(page);
});

When('I search the user conductors listing for {string}', async ({ page }, query: string) => {
  await searchUserConductors(page, query);
});

let retiredStatus: number | null = null;

When('I visit the retired workspace conductors listing', async ({ page }) => {
  const response = await page.goto('/bakers/conductors');
  retiredStatus = response?.status() ?? 0;
});

Then('the retired workspace conductors listing is gone', async () => {
  expect(retiredStatus, 'The retired /bakers/conductors path must 404').toBe(404);
});

Then('the user Conductors listing is visible', async ({ page }) => {
  await expect(page.locator(USER_LIST_FORM)).toBeAttached({ timeout: 10000 });
  await expect(userList(page).locator(SEARCH_TOOLBAR)).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => await userListRows(page).count(), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
});

Then('the user Conductors listing shows {string}', async ({ page }, label: string) => {
  await expect(
    userList(page).locator('[data-component-id="bb_theme:list"]').getByText(label, { exact: true }),
  ).toBeVisible();
});

Then('the user Conductors listing does not show {string}', async ({ page }, label: string) => {
  await expect(
    userList(page).locator('[data-component-id="bb_theme:list"]').getByText(label, { exact: true }),
  ).toHaveCount(0);
});

Then('the user Conductors listing is empty', async ({ page }) => {
  await expect(page.getByText('This account has no conductors.')).toBeVisible();
});

type Conductor = { url: string };

let current: Conductor | null = null;

function conductor(label: string): Conductor {
  const raw = php(
    '$c = current(\\Drupal::entityTypeManager()->getStorage("bb_conductor")' +
      `->loadByProperties(["label" => "${safe(label)}"]));` +
      ' print $c ? json_encode(["url" => $c->toUrl()->toString()]) : "";',
  );
  if (!raw) {
    throw new Error(`No bb_conductor labelled "${label}" exists in the seeded world.`);
  }
  return JSON.parse(raw) as Conductor;
}

When('I click the conductor {string} in the listing', async ({ page }, label: string) => {
  current = conductor(label);
  await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).getByRole('link', { name: label, exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe(current.url);
  await markDocument(page);
});

When('I visit the conductors tab of project {string}', async ({ page }, name: string) => {
  const url = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"]))) ? $e->toUrl()->toString() : "");`,
  );
  if (!url) {
    throw new Error(`No bb_project named "${name}" exists in the seeded world.`);
  }
  const response = await page.goto(`${url}/conductors`);
  expect(response?.status() ?? 0, `The conductors tab of project "${name}" did not render`).toBeLessThan(400);
  await markDocument(page);
});

Then('the project Conductors listing is visible', async ({ page }) => {
  await expect(page.locator('#views-exposed-form-conductors-project-list')).toBeAttached({ timeout: 10000 });
  await expect(
    page.locator(`${CONTENT_ISLAND} ${SEARCH_TOOLBAR}`),
  ).toBeVisible({ timeout: 10000 });
  const rows = page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`);
  await expect.poll(async () => await rows.count(), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
});

Then('the project Conductors listing shows {string}', async ({ page }, label: string) => {
  await expect(
    page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).getByText(label, { exact: true }),
  ).toBeVisible();
});

When('I visit the conductor {string}', async ({ page }, label: string) => {
  current = conductor(label);
  const response = await page.goto(current.url);
  expect(response?.status() ?? 0, `The conductor "${label}" did not render`).toBeLessThan(400);
  await markDocument(page);
});

Then('the address is the detail of the conductor {string}', async ({ page }, label: string) => {
  expect(new URL(page.url()).pathname).toBe(conductor(label).url);
});

Then('the conductor Overview shows its project and no heartbeat values', async ({ page }) => {
  const body = page.locator(CONTENT_ISLAND);
  // The project is a read-only row of the Identity card.
  await expect(cardRow(page, 'Identity', 'Project')).toContainText('bakers.build Platform', { timeout: 10000 });
  for (const heading of ['Status', 'Last seen', 'Reported load', 'Live occupancy']) {
    await expect(body.getByRole('heading', { name: heading, exact: true })).toHaveCount(0);
  }
});
