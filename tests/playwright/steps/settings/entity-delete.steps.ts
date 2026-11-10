// Delete action, confirm dialog, confirm page and denials on disposable
// entities of every deletable type. Each scenario creates its own entity and
// removes what is left.
import { createBdd } from 'playwright-bdd';
import type { Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { lastLine } from '../../support/disposable-ticket';
import { disposableSnippet } from '../../support/disposable-entity';
import { markDocument } from '../../support/shell';

const { Given, When, Then, After } = createBdd(test);

type Disposable = {
  // Every created entity as "type:id", the subject first.
  created: string[];
  label: string;
  manage: string;
  deletePath: string;
  // The address the delete dialog was opened over.
  openedOver?: string;
};

const disposables = new WeakMap<Page, Disposable>();

function subject(page: Page): Disposable {
  const found = disposables.get(page);
  if (!found) throw new Error('No disposable entity was created in this scenario.');
  return found;
}

function exists(reference: string): boolean {
  const [type, id] = reference.split(':');
  return lastLine(`print \\Drupal::entityTypeManager()->getStorage("${type}")->load("${id}") ? "yes" : "no";`) === 'yes';
}

After({ tags: '@feature:entity-delete or @feature:delete-dialog' }, async ({ page }) => {
  const record = disposables.get(page);
  disposables.delete(page);
  if (!record) return;
  // Helpers first (a ticket blocks its project), then the subject.
  const references = [...record.created.slice(1), record.created[0]];
  lastLine([
    `foreach (${JSON.stringify(references)} as $r) { [$type, $id] = explode(":", $r);`,
    'try { $x = \\Drupal::entityTypeManager()->getStorage($type)->load($id); if ($x) { $x->delete(); } } catch (\\Throwable $e) {} }',
    'print "ok";',
  ].join(' '));
});

Given('a disposable {string} exists in the Northside workspace', async ({ page }, kind: string) => {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const output = lastLine(disposableSnippet(kind, n));
  const [created, label, manage, deletePath] = output.split('|');
  if (!created || !manage || !deletePath) {
    throw new Error(`The disposable ${kind} did not settle: "${output}".`);
  }
  disposables.set(page, { created: created.split(','), label, manage, deletePath });
});

When('I open the page where the disposable entity is managed', async ({ page }) => {
  const response = await page.goto(subject(page).manage);
  expect(response?.status()).toBe(200);
});

Then('the disposable entity offers its Delete action', async ({ page }) => {
  await expect(page.locator(`a[href^="${subject(page).deletePath}"]`).first()).toBeAttached();
});

Then('the disposable entity offers no Delete action', async ({ page }) => {
  await expect(page.locator(`a[href^="${subject(page).deletePath}"]`)).toHaveCount(0);
});

When('I open the Delete action of the disposable entity', async ({ page }) => {
  const response = await page.goto(subject(page).deletePath);
  expect(response?.status()).toBe(200);
});

Then('the delete page names {string}', async ({ page }, text: string) => {
  await expect(page.locator('main, body').first()).toContainText(text);
});

Then('the delete page is titled after the disposable entity', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(`Delete ${subject(page).label}`);
});

Then('the delete page offers no confirm button', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
});

When('I confirm the deletion', async ({ page }) => {
  await Promise.all([
    page.waitForURL((url) => url.pathname !== subject(page).deletePath),
    page.getByRole('button', { name: 'Delete', exact: true }).click(),
  ]);
});

Then('the page confirms the disposable entity was deleted', async ({ page }) => {
  await expect(page.locator('body')).toContainText(`Deleted ${subject(page).label}.`);
});

Then('the disposable entity no longer exists', async ({ page }) => {
  expect(exists(subject(page).created[0])).toBe(false);
});

Then('the disposable entity still exists', async ({ page }) => {
  expect(exists(subject(page).created[0])).toBe(true);
});

Then('the entities the disposable entity needed no longer exist', async ({ page }) => {
  for (const reference of subject(page).created.slice(1)) {
    expect(exists(reference), reference).toBe(false);
  }
});

Then('the delete page of the disposable entity answers {int}', async ({ page }, status: number) => {
  const response = await page.goto(subject(page).deletePath);
  expect(response?.status()).toBe(status);
});

// The open delete dialog: the shell's hull holding a delete confirm form.
function deleteDialog(page: Page) {
  return page.locator('dialog[data-dialog][open]:has(form[id$="-delete-form"])');
}

When('I open the Delete dialog of the disposable entity', async ({ page }) => {
  const record = subject(page);
  const trigger = page.locator(`a[href^="${record.deletePath}"][data-hx-get]`).first();
  await expect(trigger, 'The Delete action does not open the overlay').toBeAttached();
  // A click before htmx owns the anchor would follow its page href instead.
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      message: 'htmx never processed the Delete action',
      timeout: 20000,
    })
    .toBe(true);
  // A list row's Delete sits in the row's closed action menu.
  const menu = trigger.locator('xpath=ancestor::details[@data-action-menu][1]');
  if ((await menu.count()) > 0 && !(await menu.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await menu.locator(':scope > summary').click();
  }
  record.openedOver = page.url();
  await markDocument(page);
  const answered = page.waitForResponse(
    (candidate) => candidate.request().method() === 'GET' && candidate.url().includes('_wrapper_format=island_dialog'),
    { timeout: 20000 },
  );
  await trigger.click();
  await answered;
  await expect(deleteDialog(page)).toBeVisible();
});

Then('the delete dialog is titled after the disposable entity', async ({ page }) => {
  await expect(deleteDialog(page).getByRole('heading', { level: 2 })).toHaveText(`Delete ${subject(page).label}`);
});

Then('the delete dialog names {string}', async ({ page }, text: string) => {
  await expect(deleteDialog(page)).toContainText(text);
});

Then('the delete dialog links the blocking ticket', async ({ page }) => {
  await expect(deleteDialog(page).getByRole('link', { name: subject(page).label, exact: true })).toBeVisible();
});

Then('the delete dialog offers only Close', async ({ page }) => {
  const dialog = deleteDialog(page);
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(dialog.locator('[data-dialog-cancel]')).toHaveText('Close');
});

Then('the address is still the page the dialog was opened over', async ({ page }) => {
  expect(page.url()).toBe(subject(page).openedOver);
});

When('I cancel the delete dialog', async ({ page }) => {
  await deleteDialog(page).locator('[data-dialog-cancel]').click();
});

When('I close the delete dialog by its close control', async ({ page }) => {
  await deleteDialog(page).locator('[data-dialog-close]').click();
});

Then('the delete dialog is closed', async ({ page }) => {
  await expect(page.locator('dialog[data-dialog]:has(form[id$="-delete-form"])')).toHaveCount(0);
  expect(page.url()).toBe(subject(page).openedOver);
});

When('I confirm the deletion in the dialog', async ({ page }) => {
  // The landing may be the page the dialog was opened over, so wait for the
  // dialog to leave rather than for the address to change.
  await deleteDialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('dialog[data-dialog]:has(form[id$="-delete-form"])')).toHaveCount(0);
});
