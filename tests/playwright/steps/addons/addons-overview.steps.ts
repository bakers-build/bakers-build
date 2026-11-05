// The workspace addon overview. Probe addon versions are drush fixtures, one
// run by a seeded conductor, and deleted after the scenario, so no seeded fixture
// changes and the feature stays re-runnable.
import { Given, When, Then } from '../../bdd.fixtures';
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';
import { CONTENT_ISLAND, RAIL_ISLAND, markDocument } from '../../support/shell';

const { After } = createBdd(test);

const LABEL = 'Overview probe';
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';

// One name per scenario, so parallel workers never share a row.
const probes = new WeakMap<Page, { name: string; ids: string[] }>();
const statuses = new WeakMap<Page, number>();

function probe(page: Page) {
  const found = probes.get(page);
  if (!found) throw new Error('No probe addon was registered in this scenario.');
  return found;
}

function probeRow(page: Page): Locator {
  return page.locator(`${CONTENT_ISLAND} li[data-list-item]`).filter({ hasText: probe(page).name });
}

/**
 * Stores one version of the probe addon, run by the conductor when one is named.
 */
function storeVersion(page: Page, version: string, conductor?: string): void {
  const name = probes.get(page)?.name ?? `overview-probe-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const definition = {
    name,
    version,
    contract: 2,
    label: LABEL,
    icon: ICON,
    messages: { open: { label: 'Open' } },
  };
  const json = Buffer.from(JSON.stringify(definition)).toString('base64');
  // `workspace_id` is required (BB-661 D/A): derived from the conductor's
  // project → group → workspace, the same `AddonWorkspaceResolver` real
  // registration uses, so an omitted value here can never desync from what a
  // real conductor would register. The "newer version" step has no conductor
  // of its own, so it reuses the workspace of the probe's first row.
  const output = php([
    '$etm = \\Drupal::entityTypeManager();',
    conductor
      ? `$c = current($etm->getStorage("bb_conductor")->loadByProperties(["label" => "${safe(conductor)}"])); if (!$c) { print "NO_CONDUCTOR"; return; } $ws = \\Drupal::service("bb_addon.workspace_resolver")->resolve($c); if (!$ws) { print "NO_WORKSPACE"; return; } $wsid = (int) $ws->id();`
      : `$prior = $etm->getStorage("bb_addon")->load(${probe(page).ids[0] ?? 0}); if (!$prior) { print "NO_PRIOR_ADDON"; return; } $wsid = $prior->workspaceId();`,
    `$a = $etm->getStorage("bb_addon")->create(["workspace_id" => $wsid, "name" => "${name}", "version" => "${version}", "contract" => 2, "definition" => base64_decode("${json}")]);`,
    // The newer version must sort after the older one, also in the same second.
    `$a->set("created", \\Drupal::time()->getRequestTime() + ${probes.get(page)?.ids.length ?? 0});`,
    conductor ? '$a->addConductor($c);' : '',
    '$a->save();',
    'print "ID:" . $a->id();',
  ].join(' '));
  const id = /ID:(\d+)/.exec(output)?.[1];
  if (!id) throw new Error(`The probe addon did not settle: "${output}".`);
  probes.set(page, { name, ids: [...(probes.get(page)?.ids ?? []), id] });
}

Given(
  'a probe addon at version {string} runs on the conductor {string}',
  async ({ page }, version: string, conductor: string) => {
    storeVersion(page, version, conductor);
  },
);

Given('the probe addon has a newer version {string}', async ({ page }, version: string) => {
  probe(page);
  storeVersion(page, version);
});

When('I open the workspace settings of {string}', async ({ page }, slug: string) => {
  const response = await page.goto(`/${safe(slug)}/settings`);
  expect(response?.status() ?? 0, 'Workspace settings did not render').toBeLessThan(400);
  await markDocument(page);
});

When('I open the addon overview of {string}', async ({ page }, slug: string) => {
  const response = await page.goto(`/${safe(slug)}/settings/addons`);
  expect(response?.status() ?? 0, 'The addon overview did not render').toBeLessThan(400);
});

When('I request the addon overview of {string}', async ({ page }, slug: string) => {
  const response = await page.goto(`/${safe(slug)}/settings/addons`);
  statuses.set(page, response?.status() ?? 0);
});

Then('access to the addon overview is denied', async ({ page }) => {
  expect(statuses.get(page)).toBe(403);
});

Then(
  'the addon overview lists the probe addon once with the versions {string}',
  async ({ page }, versions: string) => {
    await expect(probeRow(page)).toHaveCount(1);
    await expect(probeRow(page)).toContainText(LABEL);
    await expect(probeRow(page)).toContainText(versions);
  },
);

Then('the probe addon row shows the conductor {string}', async ({ page }, conductor: string) => {
  await expect(probeRow(page).locator('[data-list-region="right"]')).toContainText(conductor);
});

Then('the addon overview does not list the probe addon', async ({ page }) => {
  await expect(probeRow(page)).toHaveCount(0);
});

Then('the probe addon row shows its icon', async ({ page }) => {
  await expect(probeRow(page).locator('img[src^="data:image/svg+xml;base64,"]')).toHaveCount(1);
});

Then('the rail has no entry {string}', async ({ page }, label: string) => {
  await expect(page.locator(RAIL_ISLAND)).toBeAttached();
  await expect(page.locator(RAIL_ISLAND).getByRole('link', { name: label, exact: true })).toHaveCount(0);
});

After({ tags: '@feature:addons-overview' }, async ({ page }) => {
  const ids = probes.get(page)?.ids ?? [];
  probes.delete(page);
  if (ids.length === 0) return;
  php(`$s = \\Drupal::entityTypeManager()->getStorage("bb_addon"); $s->delete($s->loadMultiple([${ids.map(Number).join(', ')}]));`);
});
