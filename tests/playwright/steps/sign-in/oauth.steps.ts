import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { provisionState, provisionDelta, type ProvisionState } from '../../support/provision-state';

/**
 * Provider sign-in steps, driven through the stub route rather than a live
 * Google call (BB-476 AC-12). The OAuth traffic is server-side PHP, so
 * Playwright cannot intercept it — `/user/login/stub` hands the SAME decorated
 * authenticator exactly what a provider callback would, so these scenarios
 * exercise the real security decision.
 *
 * `before` IS THIS FILE'S OWN SNAPSHOT, taken in the `When` step below rather
 * than reused from `login.steps.ts`'s module-scoped `beforeState` or
 * `signup.steps.ts`'s `before` — those are private to their own files, so a
 * cross-file read would be `undefined` here.
 */
let before: ProvisionState;
let lastMail: string;

When('the provider returns {string} as confirmed', async ({ page }, mail: string) => {
  lastMail = mail;
  before = provisionState(mail);
  await page.goto(`/user/login/stub?mail=${encodeURIComponent(mail)}&verified=1`);
  await page.waitForLoadState('networkidle');
});

When('the provider returns {string} as confirmed with the picture {string}', async ({ page }, mail: string, picture: string) => {
  lastMail = mail;
  before = provisionState(mail);
  await page.goto(`/user/login/stub?mail=${encodeURIComponent(mail)}&verified=1&picture=${encodeURIComponent(picture)}`);
  await page.waitForLoadState('networkidle');
});

When('the provider returns {string} as unconfirmed', async ({ page }, mail: string) => {
  lastMail = mail;
  before = provisionState(mail);
  await page.goto(`/user/login/stub?mail=${encodeURIComponent(mail)}&verified=0`);
  await page.waitForLoadState('networkidle');
});

Then('no entities were created', async () => {
  const delta = provisionDelta(before, provisionState(lastMail));
  expect(delta.user).toBe(0);
  expect(delta.bb_workspace).toBe(0);
  expect(delta.bb_team).toBe(0);
});

Then('exactly one account was created', async () => {
  expect(provisionDelta(before, provisionState(lastMail)).user).toBe(1);
});

Then('no workspace was created', async () => {
  const delta = provisionDelta(before, provisionState(lastMail));
  expect(delta.bb_workspace).toBe(0);
  expect(delta.bb_team).toBe(0);
});

Then('the Google sign-in button is present', async ({ page }) => {
  const button = page.locator('[data-test="oauth-google"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('href', '/user/login/google');
});
