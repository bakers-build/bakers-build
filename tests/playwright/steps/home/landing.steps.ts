import { Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';

Then('the address is not {string}', async ({ page }, unexpected: string) => {
  expect(new URL(page.url()).pathname).not.toBe(unexpected);
});
