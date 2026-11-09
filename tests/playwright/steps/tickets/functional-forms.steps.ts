import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('the contract form has an entity sidebar', async ({ page }) => {
    await expect(page.locator('.entity-meta')).toHaveCount(1);
});

Then('the ticket sidebar exposes its panels and labels', async ({ page }) => {
    await expect(page.locator('.entity-meta__header')).toHaveCount(1);
    for (const text of ['Status', 'People & Project', 'Relations', 'Source']) await expect(page.locator('.entity-meta')).toContainText(text);
    await expect(page.getByRole('textbox', { name: 'Labels', exact: true })).toBeVisible();
});

// Settings never offer the identifier; a rename through them keeps it.
Then('the stored ticket identifier still matches resource {string}', async ({ apiClient }, name: string) => {
    await apiClient.read(`/jsonapi/bb_ticket/bb_ticket/{saved.${name}}`);
    expect(apiClient.response!.status()).toBe(200);
    const document = await apiClient.response!.json();
    expect(document.data.attributes.identifier).toBe(apiClient.savedAttribute(name, 'identifier'));
});

When('the ticket is renamed through its form to {string}', async ({ page }, title: string) => {
    await page.locator('input[name="title[0][value]"]').fill(title);
    await page.locator('#edit-submit').first().click();
    await page.waitForLoadState('networkidle');
});

Then('the ticket routes resolve identifier, ID and UUID for {string}', async ({ page, apiClient }, name: string) => {
    await apiClient.read(`/jsonapi/bb_ticket/bb_ticket/{saved.${name}}`);
    expect(apiClient.response!.status()).toBe(200);
    const { data } = await apiClient.response!.json();
    for (const key of [data.attributes.identifier.toLowerCase(), String(data.attributes.drupal_internal__id), data.id]) {
        const response = await page.goto(`/bakers/ticket/${key}`);
        expect(response?.status()).toBe(200);
        await expect(page.locator('body')).toContainText(data.attributes.title);
    }
    for (const suffix of ['/edit', '/delete']) {
        const response = await page.goto(`/bakers/ticket/${data.id}${suffix}`);
        expect(response?.status()).toBe(200);
    }
    const old = await page.goto(`/admin/bakers/ticket/${data.attributes.drupal_internal__id}`);
    expect(old?.status()).toBe(404);
});
