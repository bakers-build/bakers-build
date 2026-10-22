// Consumers: work-activity-input.feature and work-schedule.feature, including no-JS.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { When, Then } from '@key-tec/playwright-core/bdd';
import { uidOf } from '../shell';

let activityStatus = 0;
let activityData: Record<string, unknown>;
let activityResult: { id: string; revision: number };
let repeatedResult: { id: string; revision: number };
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
  const token = await (await page.request.get('/session/token')).text();
  const data = { source_system: 'browser', source_key: `${source}-${randomUUID()}`, source_version: '1', work_date: date,
    description: source, project_id: projectUuid, duration_seconds: 7200 };
  const response = await page.request.post('/api/time/activity', { data, headers: { 'X-CSRF-Token': token } });
  expect(response.status(), await response.text()).toBe(200);
  activityData = data;
  activityResult = await response.json();
});

When('I repeat the last activity submission', async ({ page }) => {
  const token = await (await page.request.get('/session/token')).text();
  const response = await page.request.post('/api/time/activity', {
    data: activityData, headers: { 'X-CSRF-Token': token },
  });
  expect(response.status(), await response.text()).toBe(200);
  repeatedResult = await response.json();
});

Then('the activity response keeps the same identity and revision', async () => {
  expect(repeatedResult).toEqual(activityResult);
});

When('I open the submitted activity', async ({ page }) => {
  await page.goto(`/time/${activityResult.id}/edit`);
});

When('I submit an activity with a forged owner', async ({ page }) => {
  const token = await (await page.request.get('/session/token')).text();
  const response = await page.request.post('/api/time/activity', { headers: { 'X-CSRF-Token': token },
    data: { source_system: 'browser', source_key: 'forged', source_version: '1', work_date: '2024-05-06',
      description: 'Forged activity', project_id: projectUuid, duration_seconds: 3600, owner_user_id: 1 } });
  activityStatus = response.status();
});

When('I submit an activity for the time capture project', async ({ page }) => {
  const token = await (await page.request.get('/session/token')).text();
  const response = await page.request.post('/api/time/activity', { headers: { 'X-CSRF-Token': token },
    data: { source_system: 'browser', source_key: 'foreign', source_version: '1', work_date: '2024-05-06',
      description: 'Foreign project activity', project_id: projectUuid, duration_seconds: 3600 } });
  activityStatus = response.status();
});

Then('the activity response status is {int}', async ({}, status: number) => {
  expect(activityStatus).toBe(status);
});
