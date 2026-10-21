import { test, expect } from '@playwright/test';

test('tasks.changed re-renders the peer counter island OOB', async ({ page }) => {
  await page.goto('/island-example/tasks');
  const before = await page.locator('#island-tasks-task_count').innerText();
  await page.getByLabel('Title').fill('Peer update');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('#island-tasks-task_count')).not.toHaveText(before);
});
