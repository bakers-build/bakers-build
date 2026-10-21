import { createBdd } from 'playwright-bdd';
import { Drush } from '@key-tec/playwright-core';
import { test, expect } from '../../bdd.fixtures';
import world from '../../support/contract-world.json';

const { Given, Then } = createBdd(test);

Given('the pagination accounts have only their ordinary workspace memberships', async ({ apiClient }) => {
    for (const side of ['home', 'other']) {
        const uuid = apiClient.fixtureId(`membership.pagination-${side}`);
        // Conductor registration places app rank. These fixtures deliberately
        // exercise the independent owner grant, matching the PHP contract.
        // `membership.pagination-*` is used nowhere outside this file (grep
        // confirms it), and the write is the same fixed empty list every time.
        Drush.exec(`php:eval '$m = \\Drupal::service("entity.repository")->loadEntityByUuid("og_membership", "${uuid}"); if (!$m) { throw new \\RuntimeException("Missing pagination membership"); } $m->set("roles", [])->save();'`);
    }
});
Then('the API collection has {int} rows and reports total {int}', async ({ apiClient }, rows: number, total: number) => {
    const document = await apiClient.response!.json();
    expect(document.data).toHaveLength(rows);
    expect(document.meta.count).toBe(total);
    expect(document.meta).not.toHaveProperty('omitted');
});
Then('walking both run pages yields exactly the 25 owned fixtures', async ({ apiClient }) => {
    const seen: string[] = [];
    for (const offset of [0, 20]) {
        await apiClient.read(`/jsonapi/bb_run/bb_run?page[limit]=20&page[offset]=${offset}&sort=drupal_internal__id`);
        expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(200);
        const document = await apiClient.response!.json();
        expect(document.meta).not.toHaveProperty('omitted');
        seen.push(...document.data.map((row: { id: string }) => row.id));
    }
    const expected = Object.entries(world).filter(([key]) => key.startsWith('run.pagination-home-')).map(([, resource]) => resource.uuid);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen.sort()).toEqual(expected.sort());
});
