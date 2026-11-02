import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import { placement } from './profile-administration.steps';
import { assertRefreshedPlacements } from './repeated-profile.steps';
import { markDocument } from '../../support/shell';

const body = 'Mapped body survives refresh.';

async function selectAjax(page: Page, field: Locator, value: string) {
  // A newly inserted select can be visible before Drupal attaches its Ajax
  // behavior. Await both that binding and the completed command queue.
  await expect(field).toHaveAttribute('data-once', /drupal-ajax/);
  const response = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('_wrapper_format=drupal_ajax'));
  await field.selectOption(value);
  expect((await response).status()).toBe(200);
  await page.waitForFunction(() => {
    const drupal = (window as unknown as { Drupal: { ajax: { instances: { ajaxing: boolean }[] } } }).Drupal;
    return drupal.ajax.instances.every((instance) => !instance?.ajaxing);
  });
}

async function expand(group: Locator, name: string) {
  const summary = group.getByRole('button', { name, exact: true });
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
}

When('I map component placement {string} to the app user name and body {string}', async ({ page }, alias: string, text: string) => {
  const group = placement(page, alias);
  await selectAjax(page, group.getByRole('combobox', { name: /^Component(?: \*)?$/ }), 'bb_theme:note');
  await expand(group, 'Lead');
  // The source controls all have the same accessible name. Their recorded
  // Form API name suffix identifies the exact prop/slot without generated IDs.
  await selectAjax(page, group.locator('select[name$="[props][lead][source_id]"]'), 'entity_field');
  await selectAjax(page, group.getByRole('combobox', { name: /^Field(?: \*)?$/ }), 'field:user:user:name');
  await selectAjax(page, group.locator('select[name$="[field:user:user:name][value][source_id]"]'), 'field_property:user:name:value');
  await expand(group, 'Body');
  await selectAjax(page, group.locator('select[name$="[slots][body][add_more_button]"]'), 'textfield');
  await group.getByRole('textbox', { name: 'Body', exact: true }).fill(text);
  await group.getByRole('checkbox', { name: 'counter.changed', exact: true }).check();
});

Then('component placement {string} retains the app user name mapping and body {string}', async ({ page }, alias: string, text: string) => {
  const group = placement(page, alias);
  await expect(group.getByRole('combobox', { name: /^Component(?: \*)?$/ })).toHaveValue('bb_theme:note');
  await expand(group, 'Lead');
  await expect(group.locator('select[name$="[props][lead][source_id]"]')).toHaveValue('entity_field');
  await expect(group.getByRole('combobox', { name: /^Field(?: \*)?$/ })).toHaveValue('field:user:user:name');
  // UI Patterns replaces a selected one-option source select with a hidden
  // input on rebuild. Its exact persisted source value remains the contract.
  await expect(group.locator('[name$="[field:user:user:name][value][source_id]"]')).toHaveValue('field_property:user:name:value');
  await expand(group, 'Body');
  await expect(group.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue(text);
  await expect(group.getByRole('checkbox', { name: 'counter.changed', exact: true })).toBeChecked();
});

Given('I open the mapped profile fixture', async ({ page }) => {
  await page.goto('/admin/structure/island/browser-mapping');
  await markDocument(page);
});

Then('both mapped instances show their own app context and configured body', async ({ page }) => {
  const islands = page.locator('[data-profile-instance] [id^="island-profile_"]');
  await expect(islands).toHaveCount(6);
  const ids = await islands.evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(6);
  for (const instance of ['first', 'second']) {
    const scope = page.locator(`[data-profile-instance="${instance}"]`);
    await expect(scope.locator('[id$="-mapped"] .note__lead')).toHaveText(`Initial ${instance}`);
    await expect(scope.locator('[id$="-mapped"] .note__body')).toHaveText(body);
    await expect(scope.locator('[id$="-beta"]')).toHaveText('Original Beta');
  }
});

Then('exactly its trigger and mapped component were refreshed from current app data', async ({ page }) => {
  const { scope, instance } = await assertRefreshedPlacements(page, 'mapped');
  await expect(scope.locator('[id$="-mapped"] .note__lead')).toHaveText(`Refreshed ${instance}`);
  await expect(scope.locator('[id$="-mapped"] .note__body')).toHaveText(body);
  await expect(scope.locator('[id$="-beta"]')).toHaveText('Original Beta');
  const other = instance === 'first' ? 'second' : 'first';
  const retained = page.locator(`[data-profile-instance="${other}"]`);
  await expect(retained.locator('[id$="-mapped"] .note__lead')).toHaveText(`Initial ${other}`);
  await expect(retained.locator('[id$="-mapped"] .note__body')).toHaveText(body);
});
