// Activities proposed through the bakers_time_propose tool over /mcp.
// Consumers: work-activity-input.feature and work-schedule.feature, including no-JS.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { When, Then } from '../../bdd.fixtures';
import { callTool, type ToolResult } from '../mcp';
import { uidOf } from '../shell';

let activityEntry: Record<string, unknown>;
let activityId = '';
let activityResult: ToolResult;
const projectUuid = '612a0000-0000-4000-8000-000000000001';

When('I set a personal two-hour schedule as {string}', async ({ page }, account: string) => {
  const uid = uidOf(account);
  await page.goto(`/user/${uid}/schedule`);
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    await page.getByLabel(`${day} (H:MM)`, { exact: true }).fill(day === 'Monday' ? '2:00' : '0:00');
  }
  await page.getByLabel('Optional proposal-day cap (H:MM)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/user/${uid}/schedule$`));
  await expect(page.locator('#bb-track-schedule').getByText('Personal schedule saved.', { exact: true })).toBeVisible();
});

When('I submit a two-hour activity for {string} with source {string}', async ({ page }, date: string, source: string) => {
  activityEntry = { source_system: 'browser', source_key: `${source}-${randomUUID()}`, source_version: '1', work_date: date,
    description: source, duration_seconds: 7200 };
  const result = await callTool(page.request, 'bakers_time_propose', { project: projectUuid, entries: [activityEntry] });
  expect(result.isError, result.message).toBe(false);
  activityId = (result.structuredContent?.worklogs as string[])[0];
});

When('I repeat the last activity submission', async ({ page }) => {
  activityResult = await callTool(page.request, 'bakers_time_propose', { project: projectUuid, entries: [activityEntry] });
});

When('I open the submitted activity', async ({ page }) => {
  await page.goto(`/time/${activityId}/edit`);
});

When('I submit an activity with a forged owner', async ({ page }) => {
  activityResult = await callTool(page.request, 'bakers_time_propose', { project: projectUuid, entries: [{
    source_system: 'browser', source_key: 'forged', source_version: '1', work_date: '2024-05-06',
    description: 'Forged activity', duration_seconds: 3600, owner_user_id: 1 }] });
});

When('I submit an activity for the time capture project', async ({ page }) => {
  activityResult = await callTool(page.request, 'bakers_time_propose', { project: projectUuid, entries: [{
    source_system: 'browser', source_key: 'foreign', source_version: '1', work_date: '2024-05-06',
    description: 'Foreign project activity', duration_seconds: 3600 }] });
});

Then('the activity is refused with {string}', async ({}, message: string) => {
  expect(activityResult.isError, activityResult.message).toBe(true);
  expect(activityResult.message).toContain(message);
});
