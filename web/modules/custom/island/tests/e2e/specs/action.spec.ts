import { test, expect } from '@playwright/test';

test('action link delete removes the row and updates the counter', async ({ page }) => {
  await page.goto('/island-example/tasks');
  const countBefore = await page.locator('#island-tasks-task_list [data-task-id]').count();
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('[data-testid="delete-task"]').first().click();
  await expect(page.locator('#island-tasks-task_list [data-task-id]')).toHaveCount(countBefore - 1);
});

test('an action with a forged token is refused', async ({ request }) => {
  const response = await request.post('/island-example/tasks', {
    form: { _island: 'task_list', _island_action: 'delete', _island_host: 'tasks', _island_token: 'bogus' },
  });
  expect(response.status()).toBe(403);
});
