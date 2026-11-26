// A project's Environments tab: add through the page header's action, and a
// row opens the environment's edit form in the dialog, its only page. Tab,
// header-action, project and visit steps are shared.
import { createBdd } from 'playwright-bdd';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { DEADLOCK, php, phpWithRetry } from '../../support/drush';
import { clickHeaderAction } from '../../support/shell';

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

After({ tags: '@feature:project-environments' }, async ({ page }) => {
  const names = written.get(page) ?? [];
  if (names.length > 0) await deleteEnvironments(names);
});

/** The path of one environment's form, by name. */
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

// The address the environment's own page had, before it had none.
Then('the page of the environment {string} answers {int}', async ({ page }, name: string, status: number) => {
  const response = await page.goto(environmentPath(name, 'edit-form').replace(/\/edit$/, ''));
  expect(response?.status()).toBe(status);
});

function environmentRow(page: Page, name: string): Locator {
  return page.locator('li[data-list-item]').filter({ has: page.getByText(name, { exact: true }) });
}

/** The open environment dialog, for adding or editing. */
function environmentDialog(page: Page): Locator {
  return page.locator('dialog[open]:has(form[id^="bb-environment-"])');
}

/** The tab address of a project's environments, by the project's name. */
function environmentsTab(project: string): string {
  return (
    php(
      `$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => ${JSON.stringify(project)}]));` +
        ' print $p->toUrl()->toString();',
    ).trim() + '/environments'
  );
}

When('I visit the Environments tab of the project {string}', async ({ page }, project: string) => {
  await page.goto(environmentsTab(project));
});

When('I add the environment {string}', async ({ page }, name: string) => {
  await remember(page, name);
  const tab = page.url();
  await clickHeaderAction(page, 'Add environment');
  await environmentDialog(page).getByLabel('Name', { exact: true }).fill(name);
  await environmentDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(tab);
});

Then('the environment {string} is listed', async ({ page }, name: string) => {
  await expect(environmentRow(page, name)).toHaveCount(1);
});

Then('the environment {string} is not listed', async ({ page }, name: string) => {
  await expect(page.locator('li[data-list-item]').first().or(page.getByText('This project has no environments yet.'))).toBeVisible();
  await expect(environmentRow(page, name)).toHaveCount(0);
});

When('I open the environment {string}', async ({ page }, name: string) => {
  const tab = page.url();
  await environmentRow(page, name).getByRole('link', { name, exact: true }).click();
  await expect(environmentDialog(page).getByLabel('Name', { exact: true })).toHaveValue(name);
  await expect(page).toHaveURL(tab);
});

Then('the environment dialog offers no {string}, {string} or {string} field', async ({ page }, a: string, b: string, c: string) => {
  const dialog = environmentDialog(page);
  await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
  for (const label of [a, b, c]) {
    await expect(dialog.getByText(label, { exact: true })).toHaveCount(0);
  }
});

When('I rename the environment in its dialog to {string}', async ({ page }, to: string) => {
  await remember(page, to);
  const tab = page.url();
  await environmentDialog(page).getByLabel('Name', { exact: true }).fill(to);
  await environmentDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(tab);
});

When('I delete the environment from its dialog', async ({ page }) => {
  await environmentDialog(page).getByRole('link', { name: 'Delete', exact: true }).click();
  const confirm = page.locator('dialog[open]:has(form[id$="-delete-form"])');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/project\/[^/]+\/environments(\?|$)/);
});

When('I save the new environment {string}', async ({ page }, name: string) => {
  await clickHeaderAction(page, 'Add environment');
  await environmentDialog(page).getByLabel('Name', { exact: true }).fill(name);
  // The save must go back through the dialog format, not as a plain page post.
  const posted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('_wrapper_format=island_dialog'),
    { timeout: 15000 },
  );
  await environmentDialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  expect((await posted).headers()['hx-location'], 'A refused save must not navigate').toBeUndefined();
});

/** A refused dialog save keeps the dialog open over the tab, with the error inside. */
Then('the environment form stays open with the error {string}', async ({ page }, error: string) => {
  await expect(environmentDialog(page).getByText(error)).toBeVisible();
  await expect(page).toHaveURL(/\/project\/[^/]+\/environments(\?|$)/);
});
