import { test, expect } from '@playwright/test';

test('fragment navigation swaps only the content island', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await page.evaluate(() => (window as any).__chromeMarker = 'alive');
  const chrome = await page.locator('[data-testid="chrome"]').innerHTML();

  await page.locator('[data-task-id] [data-testid="open-task"]').first().click();

  // Only the content island was swapped; no document reload happened.
  await expect(page.locator('#island-tasks-task_detail')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__chromeMarker)).toBe('alive');
  expect(await page.locator('[data-testid="chrome"]').innerHTML()).toBe(chrome);

  // History was updated (push-url) and back restores the list.
  expect(page.url()).toContain('/island-example/tasks/');
  await page.goBack();
  await expect(page.locator('#island-tasks-task_list')).toBeVisible();
});
