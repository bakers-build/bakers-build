import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

// Composite discovery returns titled groups containing complete atomic
// figures for explicitly named contexts.

// Both steps mutate a membership fixture named by the scenario, and every
// caller of either lives in statistics.feature (grep confirms it) — no other
// feature's fixture is touched.
Given('membership {string} is granted role {string}', async ({ apiClient }, membership: string, role: string) => {
    const uuid = apiClient.fixtureId(membership);
    Drush.exec(`php:eval '$m = \\Drupal::service("entity.repository")->loadEntityByUuid("og_membership", "${uuid}"); if (!$m) { throw new \\RuntimeException("Missing membership fixture ${membership}"); } $m->set("roles", ["${role}"])->save();'`);
});

Given('membership {string} holds no extra role', async ({ apiClient }, membership: string) => {
    const uuid = apiClient.fixtureId(membership);
    Drush.exec(`php:eval '$m = \\Drupal::service("entity.repository")->loadEntityByUuid("og_membership", "${uuid}"); if (!$m) { throw new \\RuntimeException("Missing membership fixture ${membership}"); } $m->set("roles", [])->save();'`);
});

Then('the statistics discovery lists {string}', async ({ apiClient }, figureId: string) => {
    const document = await apiClient.response!.json();
    const figures = document.data.attributes.groups.flatMap(
        (group: { figures: Array<{ id: string }> }) => group.figures,
    );
    expect(figures.map((figure: { id: string }) => figure.id)).toContain(figureId);
});

Then('the statistics discovery omits {string}', async ({ apiClient }, figureId: string) => {
    const document = await apiClient.response!.json();
    const figures = document.data.attributes.groups.flatMap(
        (group: { figures: Array<{ id: string }> }) => group.figures,
    );
    expect(figures.map((figure: { id: string }) => figure.id)).not.toContain(figureId);
});

Then('the figure value carries categories and measurements', async ({ apiClient }) => {
    const document = await apiClient.response!.json();
    const attributes = document.data.attributes;
    expect(attributes.generated).toBeTruthy();
    expect(attributes.categories).toEqual(expect.any(Array));
    expect(attributes.measurements).toEqual(expect.any(Array));
    expect(attributes.measurements.length).toBeGreaterThan(0);
    for (const measurement of attributes.measurements) {
        expect(measurement.values).toEqual(expect.any(Object));
    }
});
