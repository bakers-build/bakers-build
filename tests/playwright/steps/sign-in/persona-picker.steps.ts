import { When, Then } from '../../bdd.fixtures';
import { expect, type Page } from '@playwright/test';

/** The picker's section on the sign-in page; only `bb_e2e` installs it. */
const picker = (page: Page) => page.locator('[data-test="test-personas"]');

Then('the test persona picker lists {string} under {string}', async ({ page }, account: string, group: string) => {
  const fieldset = picker(page).getByRole('group', { name: group, exact: true });
  await expect(fieldset.getByRole('button', { name: account, exact: true })).toBeVisible();
});

Then('the test persona picker does not list {string}', async ({ page }, account: string) => {
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole('button', { name: account, exact: true })).toHaveCount(0);
});

When('I sign in as the test persona {string}', async ({ page }, account: string) => {
  await Promise.all([
    page.waitForURL(url => url.pathname !== '/user/login'),
    picker(page).getByRole('button', { name: account, exact: true }).click(),
  ]);
});
