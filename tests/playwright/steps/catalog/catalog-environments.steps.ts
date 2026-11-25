// Catalog Environments tab: add through the page header's action for a
// picked project, filter by project, and edit or delete from the
// environment's page. Tab, header-action and visit steps are shared.
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { DEADLOCK, phpWithRetry } from '../../support/drush';
import { clickHeaderAction } from '../../support/shell';
import { pickOption } from '../../support/picker';

const { When, Then, After } = createBdd(test);

/** Names of environments a scenario adds start with this, so cleanup finds them. */
const PREFIX = 'Catalog env';

After({ tags: '@feature:catalog-environments' }, async () => {
  await phpWithRetry(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_environment");' +
      ` $ids = $s->getQuery()->accessCheck(FALSE)->condition("name", "${PREFIX}", "STARTS_WITH")->execute();` +
      ' $s->delete($s->loadMultiple($ids)); print count($ids);',
    [DEADLOCK],
  );
});

function environmentRow(page: Page, name: string): Locator {
  return page.locator('li[data-list-item]').filter({ has: page.getByText(name, { exact: true }) });
}

/** The open form: inside the dialog with JavaScript, the page without. */
async function openForm(page: Page): Promise<{ form: Locator; scope: string }> {
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  const inDialog = (await page.locator('dialog[open]').count()) > 0;
  return { form: page.locator(inDialog ? 'dialog[open]' : 'main'), scope: inDialog ? 'dialog[open]' : 'main' };
}

When('I add the environment {string} for the project {string}', async ({ page }, name: string, project: string) => {
  expect(name.startsWith(PREFIX), `Added environment names start with "${PREFIX}" for cleanup`).toBe(true);
  await clickHeaderAction(page, 'Add environment');
  const { form, scope } = await openForm(page);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await pickOption(page, scope, 'Project', project);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/catalog\/environments(\?|$)/);
});

When('I filter the environments by the project {string}', async ({ page }, project: string) => {
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: project });
  await expect(page).toHaveURL(/[?&]project=\d+/);
});

Then('the environment {string} is listed with the project {string}', async ({ page }, name: string, project: string) => {
  const row = environmentRow(page, name);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(project);
});

Then('the environment {string} is not listed', async ({ page }, name: string) => {
  await expect(page.locator('li[data-list-item]').first().or(page.getByText('This workspace has no environments yet.'))).toBeVisible();
  await expect(environmentRow(page, name)).toHaveCount(0);
});

When('I open the environment {string}', async ({ page }, name: string) => {
  await environmentRow(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(/\/environment\/\d+(\?|$)/);
});

When('I rename the environment on its page to {string}', async ({ page }, to: string) => {
  expect(to.startsWith(PREFIX), `Renamed environment names start with "${PREFIX}" for cleanup`).toBe(true);
  const detail = page.url();
  await page.getByRole('link', { name: 'Edit', exact: true }).first().click();
  const { form } = await openForm(page);
  await form.getByLabel('Name', { exact: true }).fill(to);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).not.toHaveURL(`${detail}/edit`);
});

When('I delete the environment on its page', async ({ page }) => {
  await page.getByRole('link', { name: 'Delete', exact: true }).first().click();
  const dialog = page.locator('dialog[open]');
  const confirm = dialog.or(page.locator('main')).first().getByRole('button', { name: 'Delete', exact: true });
  await confirm.click();
  await expect(page).toHaveURL(/\/catalog\/environments(\?|$)/);
});
