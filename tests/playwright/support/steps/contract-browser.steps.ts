// Shared browser-contract steps: a recipe account's browser opening a route and
// asserting on its form fields. Consumers: features/sign-in (auth-contract),
// tickets (functional-forms), workspace (ambient-forms).
import { createBdd } from 'playwright-bdd';
import { Drush } from '../drush';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Given('the browser uses recipe account {string}', async ({ page, authProvider, apiClient }, name: string) => {
    const uuid = apiClient.fixtureId(`user.${name}`);
    const uid = Number(Drush.exec(`php:eval '$a = \\Drupal::service("entity.repository")->loadEntityByUuid("user", "${uuid}"); if (!$a) { throw new \\RuntimeException("Missing account fixture"); } print $a->id();'`).trim());
    expect(uid).toBeGreaterThan(0);
    await authProvider.login(page, String(uid));
});

When('the contract browser opens {string} with status {int}', async ({ page, apiClient }, path: string, status: number) => {
    const response = await page.goto(apiClient.resolve(path));
    expect(response?.status(), page.url()).toBe(status);
});

Then('the contract field {string} is absent', async ({ page }, name: string) => {
    await expect(page.locator(`[name="${name}"]`)).toHaveCount(0);
});
Then('the contract field {string} is visible', async ({ page }, name: string) => {
    await expect(page.locator(`[name="${name}"]`)).toBeVisible();
});
Then('the contract page contains {string}', async ({ page }, text: string) => {
    await expect(page.locator('body')).toContainText(text);
});
