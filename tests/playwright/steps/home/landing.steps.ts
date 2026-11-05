import { Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';

Then('the address is not {string}', async ({ page }, unexpected: string) => {
  expect(new URL(page.url()).pathname).not.toBe(unexpected);
});
