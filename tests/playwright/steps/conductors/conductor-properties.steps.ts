// Conductor Overview cards: label and states saved on their own cards,
// Disable/Enable behind a confirmation, peers read-only. Card and Activities
// steps are shared (support/steps/detail-cards.steps.ts); dialog and page
// steps ("I open", "I choose … in the dialog") live in
// ticket-interventions.steps.ts.
import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { markDocument } from '../../support/shell';
import world from '../../support/contract-world.json';

const { When, Then, After } = createBdd(test);

type Fixture = { uuid: string; url: string; id: string; label: string };

function fixture(name: string): Fixture {
  const row = world[name as keyof typeof world];
  if (!row || row.entityType !== 'bb_conductor') {
    throw new Error(`Unknown conductor fixture: ${name}`);
  }
  const raw = php(
    `$c = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_conductor", "${row.uuid}");` +
      ' print $c ? json_encode(["url" => $c->toUrl()->toString(), "id" => $c->id(), "label" => (string) $c->label()]) : "";',
  );
  if (!raw) {
    throw new Error(`The conductor fixture "${name}" is not in the seeded world.`);
  }
  return { uuid: row.uuid, ...(JSON.parse(raw) as Omit<Fixture, 'uuid'>) };
}

function field(name: string, uuid: string): string {
  return php(
    `print (string) \\Drupal::service("entity.repository")->loadEntityByUuid("bb_conductor", "${uuid}")->get("${name}")->value;`,
  );
}

// The recipe's values (recipes/bb_e2e/content/bb_conductor/1f1764cf-….yml);
// only this feature edits that conductor, so it is restored after each scenario.
After({ tags: '@feature:conductor-properties' }, async () => {
  php(
    `$c = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_conductor", "${world['conductor.properties'].uuid}");` +
      ' $c->set("label", "BDD properties conductor"); $c->set("states", ["coding"]); $c->set("active", TRUE); $c->save();',
  );
});

When('I visit the fixture conductor {string}', async ({ page }, name: string) => {
  const current = fixture(name);
  const response = await page.goto(current.url);
  expect(response?.status() ?? 0, `The conductor "${name}" did not render`).toBeLessThan(400);
  await markDocument(page);
});

Then('the fixture conductor {string} has the label {string}', async ({}, name: string, label: string) => {
  expect(field('label', fixture(name).uuid)).toBe(label);
});

Then('the fixture conductor {string} is active', async ({}, name: string) => {
  await expect.poll(() => field('active', fixture(name).uuid)).toBe('1');
});

Then('the fixture conductor {string} is inactive', async ({}, name: string) => {
  await expect.poll(() => field('active', fixture(name).uuid)).toBe('0');
});

Then('the fixture conductor {string} answers {int} on {string}', async ({ page }, name: string, status: number, suffix: string) => {
  const { url } = fixture(name);
  const response = await page.request.get(`${url}/${suffix}`, { maxRedirects: 0 });
  expect(response.status(), `${url}/${suffix}`).toBe(status);
});

Then('the fixture conductor {string} serves the states {string}', async ({}, name: string, states: string) => {
  const stored = php(
    `print implode(", ", array_column(\\Drupal::service("entity.repository")->loadEntityByUuid("bb_conductor", "${fixture(name).uuid}")->get("states")->getValue(), "value"));`,
  );
  expect(stored.split(', ').sort().join(', ')).toBe(states);
});

Then('the conductor offers no Disable or Enable', async ({ page }) => {
  for (const name of ['Disable conductor', 'Enable conductor']) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
});

Then('the fixture conductor {string} administrative edit form answers 200', async ({ page }, name: string) => {
  const response = await page.request.get(`/admin/bakers/conductor/${fixture(name).id}/edit`);
  expect(response.status()).toBe(200);
});

Then('the conductor confirmation is a page of its own', async ({ page }) => {
  await expect(page).toHaveURL(/\/action\?/);
  await expect(page.locator('#bakers-overlay dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disable conductor', exact: true })).toBeVisible();
});

