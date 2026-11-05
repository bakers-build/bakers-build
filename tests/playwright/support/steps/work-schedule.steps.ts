import { expect } from '@playwright/test';
import { When, Then } from '../../bdd.fixtures';
import { uidOf } from '../shell';

When('I open the personal schedule of {string}', async ({ page }, account: string) => {
  await page.goto(`/user/${uidOf(account)}/schedule`);
});

When('I change the personal Tuesday to {string} and the cap to {string}', async ({ page }, tuesday: string, cap: string) => {
  await page.getByLabel('Tuesday (H:MM)', { exact: true }).fill(tuesday);
  await page.getByLabel('Optional proposal-day cap (H:MM)', { exact: true }).fill(cap);
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
});

Then('the personal schedule rejects the input', async ({ page }) => {
  await expect(page.getByRole('alert').getByText('Use hours:minutes, for example 8:00 or 0:00.')).toBeVisible();
});

Then('the personal schedule shows Monday {string}, Tuesday {string} and cap {string}', async ({ page }, monday: string, tuesday: string, cap: string) => {
  await expect(page.getByLabel('Monday (H:MM)', { exact: true })).toHaveValue(monday);
  await expect(page.getByLabel('Tuesday (H:MM)', { exact: true })).toHaveValue(tuesday);
  for (const day of ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    await expect(page.getByLabel(`${day} (H:MM)`, { exact: true })).toHaveValue('0:00');
  }
  await expect(page.getByLabel('Optional proposal-day cap (H:MM)', { exact: true })).toHaveValue(cap);
});
