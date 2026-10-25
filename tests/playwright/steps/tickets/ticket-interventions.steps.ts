// The ticket page as an intervention surface: AI agents drive the workflow,
// a person cancels the ticket or one run, and Settings hold the exceptions.
// Every scenario creates its own disposable ticket through drush, so no seeded
// fixture is changed and the suite stays re-runnable.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { markDocument } from '../../support/shell';
import {
  createDisposableTicket,
  deleteDisposableTicket,
  lastLine,
  subject,
} from '../../support/disposable-ticket';

const { After } = createBdd(test);

After({ tags: '@feature:ticket-interventions or @feature:run-canonical' }, async ({ page }) => {
  deleteDisposableTicket(page);
});

Given('a disposable {string} ticket in state {string}', async ({ page }, workflow: string, state: string) => {
  createDisposableTicket(page, workflow, state, false);
});

Given('a disposable {string} ticket in state {string} with a running run', async ({ page }, workflow: string, state: string) => {
  createDisposableTicket(page, workflow, state, true);
});

When('I visit the disposable ticket', async ({ page }) => {
  await page.goto(subject(page).url);
  await markDocument(page);
});

When('I open {string}', async ({ page }, name: string) => {
  await page.getByRole('link', { name, exact: true }).first().click();
});

When('I open {string} on the disposable run\'s own row', async ({ page }, name: string) => {
  const { run } = subject(page);
  // The run row's `cancel` cell, and the link in it names this run.
  await page.locator('[data-cell="cancel"]').getByRole('link', { name, exact: true })
    .and(page.locator(`[href*="run=${run}"]`)).click();
});

Then('the dialog names the disposable run and that the conductor may start another run', async ({ page }) => {
  const { runId } = subject(page);
  const dialog = page.locator('#bakers-overlay dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Run #${runId} stops.`);
  await expect(dialog).toContainText('the conductor may start another run');
});

Then('the dialog\'s first choice is {string}', async ({ page }, name: string) => {
  // The choices, after the dialog's own Close button.
  const controls = page.locator('#bakers-overlay dialog').locator('a[href], button:not([disabled]):not([data-dialog-close]), input[type="submit"]');
  await expect(controls.first()).toHaveAccessibleName(name);
});

Then('a dialog asks {string}', async ({ page }, question: string) => {
  const dialog = page.locator('#bakers-overlay dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(question);
});

When('I choose {string} in the dialog', async ({ page }, name: string) => {
  const dialog = page.locator('#bakers-overlay dialog');
  const control = dialog.getByRole('button', { name, exact: true }).or(dialog.getByRole('link', { name, exact: true }));
  await control.first().click();
  await expect(dialog).toBeHidden();
});

Then('the confirmation is a page of its own', async ({ page }) => {
  await expect(page).toHaveURL(/\/action\?/);
  await expect(page.locator('#bakers-overlay dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Cancel ticket|Freeze ticket|Unfreeze ticket)$/ })).toBeVisible();
});

When('I choose {string} on the page', async ({ page }, name: string) => {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page).not.toHaveURL(/\/action\?/);
});

Then('the disposable ticket is in state {string}', async ({ page }, state: string) => {
  const { ticket } = subject(page);
  await expect.poll(() => lastLine(
    `print current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadByProperties(["uuid" => "${ticket}"]))->getState()->getId();`,
  )).toBe(state);
});

Then('the disposable run is {string}', async ({ page }, state: string) => {
  const { run } = subject(page);
  expect(run, 'the scenario created a run').toBeDefined();
  await expect.poll(() => lastLine(
    `print current(\\Drupal::entityTypeManager()->getStorage("bb_run")->loadByProperties(["uuid" => "${run}"]))->getRunState();`,
  )).toBe(state);
});

Then('the page says {string}', async ({ page }, text: string) => {
  await expect(page.locator('body')).toContainText(text);
});

Then('the ticket page offers no workflow step', async ({ page }) => {
  await expect(page.locator('[name^="bb_transition_"]')).toHaveCount(0);
  for (const name of ['Qualify', 'Start work', 'Redo plan', 'Request review', 'Done', 'Deploy', 'Summarize', 'Requalify']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Freeze ticket', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancel ticket', exact: true })).toBeVisible();
});

Then('the ticket page offers {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
});

Then('the inspector names the stall {string}', async ({ page }, reason: string) => {
  const inspector = page.locator('[data-canvas-region="inspector"]');
  await expect(inspector).toContainText('Stall');
  await expect(inspector).toContainText(reason);
  await expect(page.locator('[data-page-header]')).toContainText(reason);
});

Then('the Properties block offers no picker', async ({ page }) => {
  const inspector = page.locator('[data-canvas-region="inspector"]');
  await expect(inspector).toContainText('Properties');
  await expect(inspector.locator('[data-option-picker-name]')).toHaveCount(0);
});

Then('the ticket page offers no intervention', async ({ page }) => {
  for (const name of ['Freeze ticket', 'Unfreeze ticket', 'Cancel ticket', 'Cancel run', 'More settings']) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
});

Then('the Settings screen renders inside the app shell', async ({ page }) => {
  await expect(page).toHaveURL(/\/edit$/);
  // The app shell's rail exists only in the front theme, never in Gin.
  await expect(page.locator('[data-sidebar]')).toBeVisible();
});

Then('the Settings screen offers only title, description and env vars', async ({ page }) => {
  for (const name of ['title[0][value]', 'description[0][value]', 'env_vars[0][value]']) {
    await expect(page.locator(`[name="${name}"]`)).toBeVisible();
  }
  for (const name of ['identifier[0][value]', 'priority', 'parent_id', 'labels[]', 'state']) {
    await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[name^="bb_transition_"]')).toHaveCount(0);
});
