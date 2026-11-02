import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('the autocomplete {string} offers only the current workspace', async ({ page }, field: string) => {
    const input = page.locator(`[name="${field}"]`);
    await expect(input).toBeVisible();
    const path = await input.getAttribute('data-autocomplete-path');
    expect(path).toBeTruthy();
    const response = await page.request.get(`${path}?q=API`);
    expect(response.status()).toBe(200);
    const suggestions = await response.json();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(JSON.stringify(suggestions)).toContain('API home');
    expect(JSON.stringify(suggestions)).not.toContain('API other');
});

When('the browser creates a scoped {string} named {string}', async ({ page, apiClient }, kind: string, prefix: string) => {
    if (!['group', 'team', 'environment'].includes(kind)) throw new Error(`Unsupported form: ${kind}`);
    const name = `${prefix} ${crypto.randomUUID()}`;
    const type = `bb_${kind}`;
    await page.locator('input[name="name[0][value]"]').fill(name);
    try {
        await page.locator('#gin-sticky-edit-submit, #edit-submit').first().click();
        await page.waitForLoadState('networkidle');
    } finally {
        await apiClient.identify('site-admin');
        await apiClient.read(`/jsonapi/${type}/${type}?filter[name]=${encodeURIComponent(name)}`);
        expect(apiClient.response!.status()).toBe(200);
        const document = await apiClient.response!.json();
        for (const resource of document.data) apiClient.trackCreated(resource);
        expect(document.data).toHaveLength(1);
        const field = kind === 'environment' ? 'project_id' : 'workspace_id';
        const fixture = kind === 'environment' ? 'project.home' : 'workspace.home';
        expect(document.data[0].relationships[field].data.id).toBe(apiClient.fixtureId(fixture));
    }
});

When('the contract browser opens the edit form for fixture {string}', async ({ page, apiClient }, fixture: string) => {
    const uuid = apiClient.fixtureId(fixture);
    const type = `bb_${fixture.split('.')[0]}`;
    if (!['bb_group', 'bb_team'].includes(type)) throw new Error(`Unsupported edit fixture: ${fixture}`);
    const path = Drush.exec(`php:eval '$e = \\Drupal::service("entity.repository")->loadEntityByUuid("${type}", "${uuid}"); if (!$e) { throw new \\RuntimeException("Missing edit fixture"); } print $e->toUrl("edit-form")->toString();'`).trim();
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
});
