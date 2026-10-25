// Workspace term tabs (Types, Recipes, Labels): add through the page header's
// create action, rename through the row's Edit operation. Tab, header-action
// and visit steps are shared (support/steps/shell.steps.ts).
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { clickHeaderAction } from '../../support/shell';

const { When, Then, After } = createBdd(test);

/** Names this scenario's page wrote, so cleanup removes exactly those. */
const written = new WeakMap<Page, string[]>();

function remember(page: Page, name: string): void {
  written.set(page, [...(written.get(page) ?? []), name]);
}

After({ tags: '@feature:workspace-terms' }, async ({ page }) => {
  const names = written.get(page) ?? [];
  if (names.length === 0) return;
  php(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_term");' +
      ` $ids = $s->getQuery()->accessCheck(FALSE)->condition("name", ${JSON.stringify(names)}, "IN")->execute();` +
      ' $s->delete($s->loadMultiple($ids)); print count($ids);',
  );
});

function termRow(page: Page, name: string): Locator {
  return page.locator('li[data-list-item]').filter({ hasText: name });
}

/** Fills the term form, in the dialog with JavaScript or on the page without, and saves it. */
async function saveTermForm(page: Page, name: string): Promise<void> {
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  const dialog = page.locator('dialog[open]');
  const form = (await dialog.count()) > 0 ? dialog : page.locator('main');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Description', { exact: true }).fill(`${name} from the Settings tab.`);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** The row's Edit operation, its action menu opened. */
async function editOperation(page: Page, name: string): Promise<Locator> {
  const row = termRow(page, name);
  await expect(row).toHaveCount(1);
  await row.locator('details[data-action-menu] > summary').click();
  const edit = row.getByRole('menuitem', { name: /^Edit\b/ });
  await expect(edit).toBeVisible();
  return edit;
}

When('I add the term {string} with the action {string}', async ({ page }, name: string, action: string) => {
  remember(page, name);
  await clickHeaderAction(page, action);
  await saveTermForm(page, name);
});

When('I rename the term {string} to {string}', async ({ page }, from: string, to: string) => {
  remember(page, to);
  await (await editOperation(page, from)).click();
  await saveTermForm(page, to);
});

Then('the term {string} is listed', async ({ page }, name: string) => {
  await expect(termRow(page, name)).toHaveCount(1);
});

Then('the term {string} is not listed', async ({ page }, name: string) => {
  await expect(page.locator('li[data-list-item]').first()).toBeVisible();
  await expect(termRow(page, name)).toHaveCount(0);
});

// The address is the Edit operation's minus `/edit`, so the id is the real one:
// the edit form answering 200 proves the 404 is the missing route, not a bad id.
Then('the term {string} has no page of its own', async ({ page }, name: string) => {
  const href = await (await editOperation(page, name)).getAttribute('href');
  const edit = new URL(href ?? '', page.url());
  expect(edit.pathname, 'The Edit operation addresses the edit form').toMatch(/\/term\/\d+\/edit$/);
  expect((await page.request.get(edit.pathname)).status()).toBe(200);
  expect((await page.request.get(edit.pathname.replace(/\/edit$/, ''))).status()).toBe(404);
  await page.keyboard.press('Escape');
});
