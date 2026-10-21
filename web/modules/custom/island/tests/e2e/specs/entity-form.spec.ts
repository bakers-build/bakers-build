import { test, expect } from '@playwright/test';

test('entity edit form saves over HTMX and refreshes only the island', async ({ page }) => {
  await page.goto('/island-example/notes');
  await expect(page.locator('#island-tasks-note')).toContainText('Release note');
  await page.evaluate(() => (window as any).__chromeMarker = 'alive');

  await page.locator('#island-tasks-note').getByLabel('Title').fill('Updated note');
  await page.locator('#island-tasks-note').getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('#island-tasks-note')).toContainText('Updated note');
  expect(await page.evaluate(() => (window as any).__chromeMarker)).toBe('alive');

  // The entity was actually persisted server-side.
  await page.goto('/island-example/notes');
  await expect(page.locator('#island-tasks-note')).toContainText('Updated note');
});

test('invalid entity input re-renders the island with errors, no reload', async ({ page }) => {
  await page.goto('/island-example/notes');
  await page.evaluate(() => (window as any).__chromeMarker = 'alive');
  const title = page.locator('#island-tasks-note input[name="title[0][value]"]');
  const before = await title.inputValue();
  await title.fill('');
  await page.locator('#island-tasks-note').getByRole('button', { name: 'Save' }).click();
  // Drupal 11.3 renders form errors on the element itself (aria-invalid +
  // error class; inline error messages are suppressed in core). The message
  // text lives in the page's status area.
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveClass(/error/);
  expect(await page.evaluate(() => (window as any).__chromeMarker)).toBe('alive');

  // The entity was not changed server-side.
  await page.goto('/island-example/notes');
  await expect(page.locator('#island-tasks-note input[name="title[0][value]"]')).toHaveValue(before);
});
