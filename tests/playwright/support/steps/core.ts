// Shared authentication vocabulary and button interaction used across feature folders.
import { Given, When } from '../../bdd.fixtures';

Given('I am logged in as {string}', async ({ page, authProvider }, role: string) => {
    switch (role.trim().toLowerCase()) {
        case 'administrator':
        case 'admin':
            await authProvider.login(page, '1');
            break;
        case 'anonymous':
            await authProvider.logout(page);
            break;
        default:
            throw new Error(`Unknown role "${role}". Known: Administrator, Anonymous.`);
    }
});

When('I click button {string}', async ({ page }, name: string) => {
    await page.getByRole('button', { name }).click();
});
