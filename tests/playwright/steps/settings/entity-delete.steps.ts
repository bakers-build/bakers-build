// Delete action, confirm page and denials on disposable entities of every
// deletable type. Each scenario creates its own entity and removes what is left.
import { createBdd } from 'playwright-bdd';
import type { Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { lastLine } from '../../support/disposable-ticket';
import { disposableSnippet } from '../../support/disposable-entity';

const { Given, When, Then, After } = createBdd(test);

type Disposable = {
  // Every created entity as "type:id", the subject first.
  created: string[];
  label: string;
  manage: string;
  deletePath: string;
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

After({ tags: '@feature:entity-delete' }, async ({ page }) => {
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

Then('the delete page of the disposable entity answers {int}', async ({ page }, status: number) => {
  const response = await page.goto(subject(page).deletePath);
  expect(response?.status()).toBe(status);
});
