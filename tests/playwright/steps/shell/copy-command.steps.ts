// The `setup_command` copy control, wherever it renders: a row is found by
// its Copy button's accessible label. Consumers: features/user/api-keys.
import { When, Then } from '../../bdd.fixtures';
import { expect, type Page } from '@playwright/test';

const SETUP_COMMAND = '[data-component-id="bb_theme:setup_command"]';

/** The copy row whose Copy button carries the given label. */
function copyRow(page: Page, label: string) {
    return page.locator(SETUP_COMMAND).filter({ has: page.getByRole('button', { name: label, exact: true }) }).first();
}

When('clipboard writes fail', async ({ page }) => {
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText() {
                    return Promise.reject(new Error('denied'));
                },
            },
        });
    });
});

When('the clipboard API is unavailable', async ({ page }) => {
    await page.evaluate(() => {
        Reflect.deleteProperty(Navigator.prototype, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: undefined,
        });
    });
});

When('clipboard writes succeed', async ({ page }) => {
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText(text) {
                    window.__bakersClipboard = text;
                    return Promise.resolve();
                },
                readText() {
                    return Promise.resolve(window.__bakersClipboard || '');
                },
            },
        });`);
});

When('I press the copy button {string}', async ({ page }, label: string) => {
    await copyRow(page, label).getByRole('button', { name: label, exact: true }).click();
});

When('I press the copy button {string} with the keyboard', async ({ page }, label: string) => {
    await copyRow(page, label).getByRole('button', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
});

Then('the copy status of {string} is {string}', async ({ page }, label: string, status: string) => {
    await expect(copyRow(page, label).getByRole('status')).toHaveText(status);
});

Then('the clipboard holds the command of {string}', async ({ page }, label: string) => {
    const command = (await copyRow(page, label).locator('code').innerText()).trim();
    expect(await page.evaluate('window.__bakersClipboard || ""')).toBe(command);
});

When('I set the viewport to {int} by {int}', async ({ page }, width: number, height: number) => {
    await page.setViewportSize({ width, height });
});
