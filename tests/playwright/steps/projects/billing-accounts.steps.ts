// The project's Billing tab: account rows, the New dialog, Make default, Archive.
// Project/tab navigation and the absent-tab assertion come from shell.steps.ts,
// project-overview.steps.ts and group-detail.steps.ts; this file adds only the
// fixture project, the face's rows and actions and the route's status.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import { php, phpUnderLock } from '../../support/drush';
import { safe } from '../../support/listing';
import { CONTENT_ISLAND, PAGE_HEADER_ISLAND, markDocument } from '../../support/shell';

const routeStatus = new WeakMap<object, { status: number; location: string }>();

function projectAccountRoute(name: string): string {
  const url = php(
    '$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"]));` +
      'print $p ? \\Drupal::service("url_generator")->generateFromRoute("bb_track.account", ["bb_project" => $p->uuid(), "bb_workspace" => "bakers"]) : "";',
  );
  if (!url) {
    throw new Error(`No bb_project named "${name}" exists.`);
  }
  return url;
}

/**
 * Recreates a project in the same group, teams and owner as a seeded one, so
 * the seeded editors edit it and every run starts from its automatic default.
 * Saved through entity storage, not as an import, so the default is created.
 */
Given('a fresh project {string} set up like {string}', async ({}, name: string, model: string) => {
  const created = await phpUnderLock(
    [
      '$storage = \\Drupal::entityTypeManager()->getStorage("bb_project");',
      `$old = $storage->loadByProperties(["name" => "${safe(name)}"]);`,
      // Its tickets go first: the recreated project reuses the key, so a
      // ticket left behind would share the new tickets' identifiers.
      '$tickets = \\Drupal::entityTypeManager()->getStorage("bb_ticket");',
      'foreach ($old as $o) { $tickets->delete($tickets->loadByProperties(["project_id" => $o->id()])); }',
      // Its billing accounts stay behind: they are archive-only by design.
      '$storage->delete($old);',
      `$model = current($storage->loadByProperties(["name" => "${safe(model)}"]));`,
      'if ($model) {',
      `$p = $storage->create(["name" => "${safe(name)}", "group_id" => $model->get("group_id")->getValue(),`,
      '"teams" => $model->get("teams")->getValue(), "owner_user_id" => $model->get("owner_user_id")->getValue()]);',
      '$p->save(); print $p->id(); }',
    ].join(' '),
  );
  expect(created, `The project "${name}" could not be created like "${model}"`).toMatch(/^\d+$/);
});

Then(
  'the project {string} has exactly one active default billing account with external ID {string}',
  async ({}, name: string, externalId: string) => {
    const ids = php(
      [
        '$etm = \\Drupal::entityTypeManager();',
        `$p = current($etm->getStorage("bb_project")->loadByProperties(["name" => "${safe(name)}"]));`,
        '$ids = $p ? $etm->getStorage("bb_track_account")->getQuery()->accessCheck(FALSE)',
        '->condition("project_id", $p->id())->condition("is_default", 1)->condition("active", 1)->execute() : [];',
        'print implode(",", array_map(fn ($a) => $a->get("external_id")->value,',
        '$etm->getStorage("bb_track_account")->loadMultiple($ids)));',
      ].join(' '),
    );
    expect(ids).toBe(externalId);
  },
);

When('I visit the billing route for the project {string}', async ({ page }, name: string) => {
  await page.goto(projectAccountRoute(name));
  await markDocument(page);
});

When('I request the billing route for the project {string}', async ({ page }, name: string) => {
  const response = await page.request.get(projectAccountRoute(name), { maxRedirects: 0 });
  routeStatus.set(page, { status: response.status(), location: response.headers().location ?? '' });
});

Then('the billing route answers {int}', async ({ page }, status: number) => {
  expect(routeStatus.get(page)?.status).toBe(status);
});

Then('the billing route redirects to sign-in', async ({ page }) => {
  const answer = routeStatus.get(page);
  expect(answer?.status).toBe(302);
  expect(answer?.location).toContain('/user/login');
});

Then('the tab {string} is offered', async ({ page }, tab: string) => {
  await expect(page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: tab, exact: true })).toBeVisible();
});

/** The active row of one account; archived rows live in the collapsible. */
function accountRow(page: Page, name: string): Locator {
  return page
    .locator(CONTENT_ISLAND)
    .locator('[data-list-item]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

Then('the billing account {string} is the default without Archive', async ({ page }, name: string) => {
  const row = accountRow(page, name);
  await expect(row).toContainText('Default');
  await expect(row.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Make default', exact: true })).toHaveCount(0);
});

Then('the billing account {string} offers Make default and Archive', async ({ page }, name: string) => {
  const row = accountRow(page, name);
  await expect(row.getByRole('button', { name: 'Make default', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
});

When('I create the billing account {string} in the dialog', async ({ page }, name: string) => {
  // The page header's action, top right.
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'New billing account', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create billing account', exact: true }).click();
  await expect(page.getByText('Billing account created.')).toBeVisible();
  await markDocument(page);
});

When('I create the billing account {string} with external ID {string} in the dialog', async ({ page }, name: string, externalId: string) => {
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'New billing account', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: 'External ID', exact: true }).fill(externalId);
  await page.getByRole('button', { name: 'Create billing account', exact: true }).click();
  await expect(page.getByText('Billing account created.')).toBeVisible();
  await markDocument(page);
});

When('I edit the billing account {string} to external ID {string}', async ({ page }, name: string, externalId: string) => {
  await accountRow(page, name).getByRole('link', { name: 'Edit', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('textbox', { name: 'External ID', exact: true }).fill(externalId);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Billing account saved.')).toBeVisible();
  await markDocument(page);
});

Then('the billing account {string} shows external ID {string} as text', async ({ page }, name: string, externalId: string) => {
  const row = accountRow(page, name);
  await expect(row).toContainText(externalId);
  await expect(row.locator('script, b, i, strong, em')).toHaveCount(0);
});

Then('the billing account {string} no longer shows external ID {string}', async ({ page }, name: string, externalId: string) => {
  await expect(accountRow(page, name)).not.toContainText(externalId);
});

const DIALOG = 'dialog[open]';

/** A comma-separated step parameter as a list of labels. */
function labels(list: string): string[] {
  return list.split(',').map((label) => label.trim()).filter(Boolean);
}

When('I open the new billing account dialog', async ({ page }) => {
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'New billing account', exact: true }).click();
  await expect(page.locator(DIALOG)).toBeVisible();
});

When('I open the edit dialog of the billing account {string}', async ({ page }, name: string) => {
  await accountRow(page, name).getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.locator(DIALOG)).toBeVisible();
});

Then(
  'the billing account dialog offers the types {string} with {string} chosen',
  async ({ page }, types: string, chosen: string) => {
    const select = page.locator(DIALOG).getByRole('combobox', { name: 'Type', exact: true });
    await expect(select.locator('option')).toHaveText(labels(types));
    await expect(select.locator('option:checked')).toHaveText(chosen);
  },
);

// Type and budget refresh the dialog's term fields; wait until htmx settled.
When('I pick {string} as {string} in the billing account dialog', async ({ page }, option: string, field: string) => {
  const refreshed = page.waitForResponse((response) => response.request().method() === 'POST');
  await page.locator(DIALOG).getByRole('combobox', { name: field, exact: true }).selectOption({ label: option });
  await refreshed;
  await expect(page.locator(`${DIALOG} .htmx-request, ${DIALOG} .htmx-settling`)).toHaveCount(0);
});

Then('the billing account dialog shows the fields {string}', async ({ page }, fields: string) => {
  for (const field of labels(fields)) {
    await expect(page.locator(DIALOG).getByLabel(field, { exact: true })).toBeVisible();
  }
});

Then('the billing account dialog does not show the fields {string}', async ({ page }, fields: string) => {
  for (const field of labels(fields)) {
    await expect(page.locator(DIALOG).getByLabel(field, { exact: true })).toHaveCount(0);
  }
});

When('I fill the billing account field {string} with {string}', async ({ page }, field: string, value: string) => {
  await page.locator(DIALOG).getByLabel(field, { exact: true }).fill(value);
});

When('I submit the billing account dialog', async ({ page }) => {
  await page.locator(DIALOG).getByRole('button', { name: /^(Create billing account|Save)$/ }).click();
});

// A required field the browser refuses to submit, or a server error on it.
Then('the billing account dialog marks the field {string} as invalid', async ({ page }, field: string) => {
  const input = page.locator(DIALOG).getByLabel(field, { exact: true });
  await expect.poll(() => input.evaluate((el) => el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true')).toBe(true);
  await expect(page.locator(DIALOG)).toBeVisible();
});

Then('the billing account dialog closes with {string}', async ({ page }, message: string) => {
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await markDocument(page);
});

Then('the billing account field {string} is empty', async ({ page }, field: string) => {
  await expect(page.locator(DIALOG).getByLabel(field, { exact: true })).toHaveValue('');
});

When('I create the billing account {string} on its own page', async ({ page }, name: string) => {
  // The page header's action, top right.
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'New billing account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create billing account', exact: true }).click();
  await expect(page.getByText('Billing account created.')).toBeVisible();
  await markDocument(page);
});

When('I make {string} the default billing account', async ({ page }, name: string) => {
  await accountRow(page, name).getByRole('button', { name: 'Make default', exact: true }).click();
  await expect(page.getByText('Default billing account changed.')).toBeVisible();
  await markDocument(page);
});

When('I archive the billing account {string}', async ({ page }, name: string) => {
  await accountRow(page, name).getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Billing account archived.')).toBeVisible();
  await markDocument(page);
});

Then('the archived billing account {string} is still listed', async ({ page }, name: string) => {
  const archived = page.locator(CONTENT_ISLAND).locator('details, [data-collapsible]').filter({ hasText: 'Archived accounts' });
  await expect(archived).toContainText(name);
});
