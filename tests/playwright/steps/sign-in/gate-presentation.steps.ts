// Device consent and its visible result.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { markDocument } from '../../support/shell';

/** The public device client the e2e recipe seeds. */
const DEVICE_CLIENT = 'bakers-cli-device-e2e';

const GATE_CONTENT = '.gate__content';
const RESULT_TITLE = `${GATE_CONTENT} h1[data-component-id="bb_theme:text"]`;
const RESULT_BODY = `${GATE_CONTENT} p[data-component-id="bb_theme:text"]`;

let userCode = '';

Given('a device code was requested by the CLI', async ({ page }) => {
  const response = await page.request.post('/oauth/device_authorization', {
    form: { client_id: DEVICE_CLIENT, scope: 'bb:session' },
  });
  expect(response.status(), await response.text()).toBe(200);
  userCode = (await response.json()).user_code;
  expect(userCode).toBeTruthy();
});

Given('the viewport is {int} pixels wide', async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 800 });
});

When('I open the device verification page for that code', async ({ page }) => {
  await page.goto(`/oauth/device?user_code=${encodeURIComponent(userCode)}`);
  await markDocument(page);
});

When('I confirm the device sign-in', async ({ page }) => {
  await page.getByLabel('Device code').fill(userCode);
  await page.getByRole('button', { name: 'Confirm sign-in' }).click();
  await page.waitForURL('**/oauth/device?done=*');
});

When('I deny the device sign-in', async ({ page }) => {
  await page.getByLabel('Device code').fill(userCode);
  await page.getByRole('button', { name: 'Deny' }).click();
  await page.waitForURL('**/oauth/device?done=*');
});

When("I follow the result's {string} action", async ({ page }, label: string) => {
  await page.locator(GATE_CONTENT).getByRole('link', { name: label }).click();
  await page.waitForLoadState('load');
});

Then('the device result offers no {string} action', async ({ page }, label: string) => {
  await expect(page.locator(GATE_CONTENT).getByRole('link', { name: label })).toHaveCount(0);
});

Then('the consent names the requesting client', async ({ page }) => {
  await expect(page.locator(GATE_CONTENT).getByText(/wants to sign in/)).toBeVisible();
});

Then('the consent asks for the device code', async ({ page }) => {
  await expect(page.getByLabel('Device code')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Confirm sign-in' })).toBeVisible();
});

Then('the page does not overflow horizontally', async ({ page }) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1);
});

Then('the device result message is visible', async ({ page }) => {
  await expect(page.locator(RESULT_TITLE)).toBeVisible();
  await expect(page.locator(RESULT_BODY)).toBeVisible();
});

// Readable result text on a narrow screen is visibility, not a pixel-style contract.
Then('the device result title is not clipped', async ({ page }) => {
  const title = page.locator(RESULT_TITLE);
  const fits = await title.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  const titleBox = await title.boundingBox();
  const contentBox = await page.locator(GATE_CONTENT).boundingBox();
  expect(titleBox && contentBox && titleBox.x + titleBox.width <= contentBox.x + contentBox.width + 1).toBe(true);
});
