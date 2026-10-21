import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('the conductor assignment outcome is {int}', async ({ apiClient }, status: number) => {
    expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(status);
    const document = await apiClient.response!.json();
    if (status === 403) {
        expect(document.errors).toEqual(expect.any(Array));
    } else {
        expect(document.data.relationships.conductor_id.data.id).toBe(apiClient.fixtureId('conductor.home'));
    }
});
