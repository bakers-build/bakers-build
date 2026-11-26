// Catalog term tabs (Types, Recipes, Labels): add through the page header's
// create action; a row opens the term's edit form, which renames it in place. Tab,
// header-action and visit steps are shared (support/steps/shell.steps.ts).
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { DEADLOCK, php, phpWithRetry } from '../../support/drush';
import { clickHeaderAction } from '../../support/shell';

const { When, Then, After } = createBdd(test);

/** Names this scenario's page wrote, so cleanup removes exactly those. */
const written = new WeakMap<Page, string[]>();

/** Deletes the named terms; idempotent, so a deadlocked parallel worker is retried. */
async function deleteTerms(names: string[]): Promise<void> {
  await phpWithRetry(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_term");' +
      ` $ids = $s->getQuery()->accessCheck(FALSE)->condition("name", ${JSON.stringify(names)}, "IN")->execute();` +
      ' $s->delete($s->loadMultiple($ids)); print count($ids);',
    [DEADLOCK],
  );
}

/** Records a name and deletes any leftover of it, so a lost cleanup cannot break this run. */
async function remember(page: Page, name: string): Promise<void> {
  written.set(page, [...(written.get(page) ?? []), name]);
  await deleteTerms([name]);
}

After({ tags: '@feature:catalog-terms' }, async ({ page }) => {
  const names = written.get(page) ?? [];
  if (names.length > 0) await deleteTerms(names);
});

function termRow(page: Page, name: string): Locator {
  // Exact name: "Added term label" must not also match "Added term label no-JS".
  return page.locator('li[data-list-item]').filter({ has: page.getByText(name, { exact: true }) });
}

/** Fills the term form, in the dialog with JavaScript or on the page without, and saves it. */
async function saveTermForm(page: Page, name: string): Promise<void> {
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  const dialog = page.locator('dialog[open]');
  const form = (await dialog.count()) > 0 ? dialog : page.locator('main');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Description', { exact: true }).fill(`${name} from the Catalog tab.`);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** A seeded Northside label's path under its workspace, by its name. */
function seededLabelPath(name: string): string {
  return php(
    '$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"]));' +
      ` $t = current(\\Drupal::entityTypeManager()->getStorage("bb_term")->loadByProperties(["vid" => "label", "name" => ${JSON.stringify(name)}, "workspace_id" => $w->id()]));` +
      ' print "/" . $w->getSlug() . "/term/" . $t->id();',
  ).trim();
}

When('I add the term {string} with the action {string}', async ({ page }, name: string, action: string) => {
  await remember(page, name);
  await clickHeaderAction(page, action);
  await saveTermForm(page, name);
});

When('I open the term {string}', async ({ page }, name: string) => {
  await termRow(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(/\/term\/\d+\/edit(\?|$)/);
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
});

When('I rename the term on its edit form to {string}', async ({ page }, to: string) => {
  await remember(page, to);
  const edit = page.url();
  await saveTermForm(page, to);
  await expect(page).toHaveURL(edit);
});

When('I delete the term from its edit form', async ({ page }) => {
  await page.locator('main').getByRole('link', { name: 'Delete', exact: true }).click();
  // The confirm opens in the dialog with JavaScript, on its own page without.
  const dialog = page.locator('dialog[open]:has(form[id$="-delete-form"])');
  await expect(dialog.or(page.locator('form[id$="-delete-form"]')).first()).toBeVisible();
  const scope = (await dialog.count()) > 0 ? dialog : page.locator('main');
  await scope.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/catalog\/(types|recipes|labels)(\?|$)/);
});

async function expectStatus(page: Page, path: string, status: number): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(status);
}

Then('the page of the seeded label {string} answers {int}', async ({ page }, name: string, status: number) => {
  await expectStatus(page, seededLabelPath(name), status);
});

Then('the edit page of the seeded label {string} answers {int}', async ({ page }, name: string, status: number) => {
  await expectStatus(page, `${seededLabelPath(name)}/edit`, status);
});

Then('the term {string} is listed', async ({ page }, name: string) => {
  await expect(termRow(page, name)).toHaveCount(1);
});

Then('the term {string} is not listed', async ({ page }, name: string) => {
  await expect(page.locator('li[data-list-item]').first()).toBeVisible();
  await expect(termRow(page, name)).toHaveCount(0);
});

Then('the term edit form offers no Delete', async ({ page }) => {
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Delete', exact: true })).toHaveCount(0);
});

Then('the delete page of this term answers {int}', async ({ page }, status: number) => {
  const term = new URL(page.url()).pathname.replace(/\/edit$/, '');
  expect(term).toMatch(/\/term\/\d+$/);
  const response = await page.goto(`${term}/delete`);
  expect(response?.status()).toBe(status);
});
