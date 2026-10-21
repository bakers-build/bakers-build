import { test, expect } from '@playwright/test';

test('add form refreshes only the triggering island', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await page.evaluate(() => (window as any).__chromeMarker = 'alive');
  await page.getByLabel('Title').fill('From the form');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('#island-tasks-task_list')).toContainText('From the form');
  expect(await page.evaluate(() => (window as any).__chromeMarker)).toBe('alive');
});

test('invalid input re-renders the form island with errors, no reload', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await page.evaluate(() => (window as any).__chromeMarker = 'alive');
  await page.getByRole('button', { name: 'Add task' }).click();
  // Drupal 11.3 renders form errors on the element itself (aria-invalid +
  // error class; inline error messages are suppressed in core). The message
  // text lives in the page's status area.
  const title = page.locator('#island-tasks-task_list input[name="title"]');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveClass(/error/);
  expect(await page.evaluate(() => (window as any).__chromeMarker)).toBe('alive');
});
