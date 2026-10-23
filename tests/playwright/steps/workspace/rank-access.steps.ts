import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('the API collection excludes {string}', async ({ apiClient }, fixture: string) => {
    const document = await apiClient.response!.json();
    expect(document.data).toEqual(expect.any(Array));
    expect(document.data.map((row: { id: string }) => row.id)).not.toContain(apiClient.fixtureId(fixture));
});

Then('the API collection has no omitted rows', async ({ apiClient }) => {
    const document = await apiClient.response!.json();
    expect(document.meta ?? {}).not.toHaveProperty('omitted');
});

Then('the foreign account exposes only its display name', async ({ apiClient }) => {
    const document = await apiClient.response!.json();
    expect(document.data.attributes).toEqual({ display_name: 'south-contributor' });
});
