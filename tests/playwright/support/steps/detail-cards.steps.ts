// Shared steps of entity detail pages: the inspector cards (each its own form
// with its own Save, or read-only rows) and the Activities feed with its
// Refresh. Cards are named by their heading, fields by their label.
// Consumers: features/entity-detail, conductors, machines, projects.
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { Dialog, Page } from '@playwright/test';
import { activities, activityRows, card, cardField, cardForm, cardRow, submitSaveForm } from '../detail-cards';

/** Lets the server, not the browser, judge the card's input. */
async function skipBrowserValidation(page: Page, heading: string, label: string): Promise<void> {
  await cardForm(page, heading).evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await cardField(page, heading, label).evaluate((el) => el.removeAttribute('maxlength'));
}

When('I set {string} to {string} in the {string} card', async ({ page }, label: string, value: string, heading: string) => {
  await cardField(page, heading, label).fill(value);
});

When('I choose {string} for {string} in the {string} card', async ({ page }, values: string, label: string, heading: string) => {
  await cardField(page, heading, label).selectOption(values.split(', '));
});

When(
  'I set {string} to {string} in the {string} card past browser validation',
  async ({ page }, label: string, value: string, heading: string) => {
    await skipBrowserValidation(page, heading, label);
    await cardField(page, heading, label).fill(value);
  },
);

When('I save the {string} card', async ({ page }, heading: string) => {
  const form = cardForm(page, heading);
  await submitSaveForm(page, form, form.getByRole('button', { name: 'Save', exact: true }));
});

Then('the {string} card says {string}', async ({ page }, heading: string, text: string) => {
  await expect(card(page, heading)).toContainText(text, { timeout: 10000 });
});

Then('the {string} card field {string} holds {string}', async ({ page }, heading: string, label: string, value: string) => {
  await expect(cardField(page, heading, label)).toHaveValue(value);
});

Then('the {string} card offers {string} with Save', async ({ page }, heading: string, label: string) => {
  await expect(cardField(page, heading, label)).toBeEditable({ timeout: 10000 });
  await expect(cardForm(page, heading).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
});

Then('the {string} card offers no Save and no inputs', async ({ page }, heading: string) => {
  await expect(card(page, heading)).toBeVisible({ timeout: 10000 });
  await expect(card(page, heading).locator('input:not([type="hidden"]), select, textarea')).toHaveCount(0);
  await expect(card(page, heading).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

Then('the detail page has no {string} card', async ({ page }, heading: string) => {
  await expect(card(page, 'Identity')).toBeVisible({ timeout: 10000 });
  await expect(card(page, heading)).toHaveCount(0);
});

Then('the first card is {string}', async ({ page }, heading: string) => {
  await expect(page.locator('[data-canvas-region="inspector"] [data-zone-heading]').first()).toHaveText(heading, { timeout: 10000 });
});

Then('the {string} card shows {string} as {string}', async ({ page }, heading: string, label: string, value: string) => {
  const row = cardRow(page, heading, label);
  await expect(row).toHaveCount(1, { timeout: 10000 });
  await expect(row).toContainText(value);
  await expect(row.locator('input, select, textarea')).toHaveCount(0);
});

Then('the {string} card has no row {string}', async ({ page }, heading: string, label: string) => {
  await expect(card(page, heading)).toBeVisible({ timeout: 10000 });
  await expect(cardRow(page, heading, label)).toHaveCount(0);
});

Then('the {string} card lists {int} table rows', async ({ page }, heading: string, count: number) => {
  await expect(card(page, heading).locator('tbody tr')).toHaveCount(count, { timeout: 10000 });
});

Then('the {string} card lists {string} marked {string}', async ({ page }, heading: string, name: string, badge: string) => {
  const row = card(page, heading).locator('tbody tr').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 10000 });
  await expect(row.locator('[data-component-id="bb_theme:badge"]')).toHaveText(badge);
});

/** Clicks a card's own Refresh and waits until its fresh form is swapped in. */
async function refreshCard(page: Page, heading: string): Promise<void> {
  const refreshed = page.waitForResponse((r) => r.request().method() === 'GET' && r.request().headers()['hx-request'] === 'true');
  await card(page, heading).getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(cardForm(page, heading)).toBeVisible();
}

When('I refresh the {string} card', async ({ page }, heading: string) => {
  const asked: string[] = [];
  const listener = async (dialog: Dialog): Promise<void> => {
    asked.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', listener);
  try {
    await refreshCard(page, heading);
  }
  finally {
    page.off('dialog', listener);
  }
  expect(asked, 'A clean card refreshes without asking').toEqual([]);
});

When('I refresh the {string} card and keep my changes', async ({ page }, heading: string) => {
  const asked = new Promise<string>((resolve) => page.once('dialog', async (dialog) => {
    resolve(dialog.message());
    await dialog.dismiss();
  }));
  await card(page, heading).getByRole('button', { name: 'Refresh', exact: true }).click();
  expect(await asked).toContain('unsaved');
});

When('I refresh the {string} card and discard my changes', async ({ page }, heading: string) => {
  page.once('dialog', (dialog) => dialog.accept());
  await refreshCard(page, heading);
});

When('I refresh the Activities', async ({ page }) => {
  const zone = activities(page);
  const refreshed = page.waitForResponse((r) => r.request().method() === 'GET' && r.request().headers()['hx-request'] === 'true');
  await zone.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await refreshed).status()).toBe(200);
});

Then('the Activities list {string}', async ({ page }, text: string) => {
  await expect(activityRows(page).filter({ hasText: text })).toHaveCount(1, { timeout: 10000 });
});

Then('the Activities do not list {string}', async ({ page }, text: string) => {
  await expect(activities(page)).toBeVisible();
  await expect(activityRows(page).filter({ hasText: text })).toHaveCount(0);
});

Then('the Activities say {string}', async ({ page }, text: string) => {
  await expect(activities(page)).toContainText(text, { timeout: 10000 });
  await expect(activityRows(page)).toHaveCount(0);
});
