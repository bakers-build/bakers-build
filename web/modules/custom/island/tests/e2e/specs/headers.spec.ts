import { test, expect } from '@playwright/test';

test('location() performs a client-side redirect after a mutation', async ({ page }) => {
  // The suite shares the demo store; open whatever task exists.
  await page.goto('/island-example/tasks');
  await page.locator('[data-testid="open-task"]').first().click();
  await expect(page.locator('#island-tasks-task_detail')).toBeVisible();
  await page.locator('[data-testid="reset-tasks"]').click();
  await page.waitForURL('**/island-example/tasks');
  await expect(page.locator('#island-tasks-task_list')).toBeVisible();
});
