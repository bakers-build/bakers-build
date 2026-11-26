// Catalog term tabs (Types, Recipes, Labels): add through the page header's
// create action; a row opens the term's page, whose Edit renames it. Tab,
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

/** The term page's inspector: its description and its actions. */
function termPage(page: Page): Locator {
  return page.locator('aside.inspector');
}

/** Opens the term page's Edit, the form on its own page. */
async function editOnPage(page: Page): Promise<void> {
  await termPage(page).getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
}

/** A seeded Northside label's page, by its name. */
function seededLabelUrl(name: string): string {
  return php(
    '$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"]));' +
      ` $t = current(\\Drupal::entityTypeManager()->getStorage("bb_term")->loadByProperties(["vid" => "label", "name" => ${JSON.stringify(name)}, "workspace_id" => $w->id()]));` +
      ' print $t->toUrl()->toString();',
  ).trim();
}

When('I add the term {string} with the action {string}', async ({ page }, name: string, action: string) => {
  await remember(page, name);
  await clickHeaderAction(page, action);
  await saveTermForm(page, name);
});

When('I open the term {string}', async ({ page }, name: string) => {
  await termRow(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(/\/term\/\d+(\?|$)/);
});

When('I rename the term on its page to {string}', async ({ page }, to: string) => {
  await remember(page, to);
  const detail = page.url();
  await editOnPage(page);
  await saveTermForm(page, to);
  await expect(page).toHaveURL(detail);
});

When('I rename the term on its page to {string} and cancel', async ({ page }, to: string) => {
  await remember(page, to);
  const detail = page.url();
  await editOnPage(page);
  await page.getByLabel('Name', { exact: true }).fill(to);
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(detail);
});

Then('the term page shows {string}', async ({ page }, text: string) => {
  await expect(termPage(page)).toContainText(text);
});

When('I visit the page of the seeded label {string}', async ({ page }, name: string) => {
  await page.goto(seededLabelUrl(name));
});

Then('the page offers no term action', async ({ page }) => {
  for (const action of ['Edit', 'Delete']) {
    await expect(page.getByRole('link', { name: action, exact: true })).toHaveCount(0);
  }
});

Then('the edit page of the seeded label {string} answers {int}', async ({ page }, name: string, status: number) => {
  const response = await page.goto(`${seededLabelUrl(name)}/edit`);
  expect(response?.status()).toBe(status);
});

Then('the term {string} is listed', async ({ page }, name: string) => {
  await expect(termRow(page, name)).toHaveCount(1);
});

Then('the term {string} is not listed', async ({ page }, name: string) => {
  await expect(page.locator('li[data-list-item]').first()).toBeVisible();
  await expect(termRow(page, name)).toHaveCount(0);
});

Then('the term page offers no Delete', async ({ page }) => {
  await expect(termPage(page).getByRole('link', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Delete', exact: true })).toHaveCount(0);
});

Then('the delete page of this term answers {int}', async ({ page }, status: number) => {
  const term = new URL(page.url()).pathname;
  expect(term).toMatch(/\/term\/\d+$/);
  const response = await page.goto(`${term}/delete`);
  expect(response?.status()).toBe(status);
});
