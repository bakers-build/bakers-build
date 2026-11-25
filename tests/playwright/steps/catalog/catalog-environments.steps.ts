// Catalog Environments tab: add through the page header's action for a
// picked project, filter by project, and edit or delete from the
// environment's page. Tab, header-action and visit steps are shared.
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { DEADLOCK, php, phpWithRetry } from '../../support/drush';
import { clickHeaderAction } from '../../support/shell';
import { pickOption } from '../../support/picker';

const { Given, When, Then, After } = createBdd(test);

/** Names this scenario's page wrote, so cleanup removes exactly those. */
const written = new WeakMap<Page, string[]>();

/** Deletes the named environments; idempotent, so a deadlocked worker is retried. */
async function deleteEnvironments(names: string[]): Promise<void> {
  await phpWithRetry(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_environment");' +
      ` $ids = $s->getQuery()->accessCheck(FALSE)->condition("name", ${JSON.stringify(names)}, "IN")->execute();` +
      ' $s->delete($s->loadMultiple($ids)); print count($ids);',
    [DEADLOCK],
  );
}

/** Records a name and deletes any leftover of it, so a lost cleanup cannot break this run. */
async function remember(page: Page, name: string): Promise<void> {
  written.set(page, [...(written.get(page) ?? []), name]);
  await deleteEnvironments([name]);
}

After({ tags: '@feature:catalog-environments' }, async ({ page }) => {
  const names = written.get(page) ?? [];
  if (names.length > 0) await deleteEnvironments(names);
});

/** The path of one environment's page or form, by name. */
function environmentPath(name: string, rel: string): string {
  return php(
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_environment");' +
      ` $e = current($s->loadByProperties(["name" => ${JSON.stringify(name)}]));` +
      ` print $e->toUrl(${JSON.stringify(rel)})->toString();`,
  ).trim();
}

Given('the project {string} has the environment {string}', async ({ page }, project: string, name: string) => {
  await remember(page, name);
  php(
    '$etm = \\Drupal::entityTypeManager();' +
      ` $p = current($etm->getStorage("bb_project")->loadByProperties(["name" => ${JSON.stringify(project)}]));` +
      ` $etm->getStorage("bb_environment")->create(["name" => ${JSON.stringify(name)}, "project_id" => $p->id()])->save();`,
  );
});

Then('the {word} page of the environment {string} answers {int}', async ({ page }, form: string, name: string, status: number) => {
  const response = await page.goto(environmentPath(name, `${form}-form`));
  expect(response?.status()).toBe(status);
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
  await remember(page, name);
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
  await remember(page, to);
  const detail = page.url();
  await page.getByRole('link', { name: 'Edit', exact: true }).first().click();
  const { form } = await openForm(page);
  await form.getByLabel('Name', { exact: true }).fill(to);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).not.toHaveURL(`${detail}/edit`);
});

When('I delete the environment from its Edit tab', async ({ page }) => {
  await page.getByRole('link', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('link', { name: 'Delete', exact: true }).first().click();
  // The confirm opens in the dialog with JavaScript, on its own page without.
  const dialog = page.locator('dialog[open]:has(form[id$="-delete-form"])');
  await expect(dialog.or(page.locator('form[id$="-delete-form"]')).first()).toBeVisible();
  const scope = (await dialog.count()) > 0 ? dialog : page.locator('main');
  await scope.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/catalog\/environments(\?|$)/);
});
