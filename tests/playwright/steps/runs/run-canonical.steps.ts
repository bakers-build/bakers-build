import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { PAGE_HEADER_ISLAND, markDocument } from '../../support/shell';
import { lastLine, subject } from '../../support/disposable-ticket';

/** Last HTTP status from a run-page navigation. */
let lastStatus = 0;

/** Heading Drupal titles the last visited run with. */
let lastHeading = '';

function loadRun(uuid: string): { url: string; heading: string; id: string } {
  const url = lastLine(
    'print (($e = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_run", "' +
      uuid +
      '")) ? $e->toUrl()->toString() : "");',
  );
  if (!url) {
    throw new Error(`No bb_run ${uuid} exists in the seeded world.`);
  }
  const id = lastLine(
    'print (($e = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_run", "' +
      uuid +
      '")) ? $e->id() : "");',
  );
  return { url, heading: `Run #${id}`, id };
}

When('I visit the seeded run {string}', async ({ page }, uuid: string) => {
  const run = loadRun(uuid);
  lastHeading = run.heading;
  const response = await page.goto(run.url);
  lastStatus = response?.status() ?? 0;
  if (lastStatus < 400) {
    await markDocument(page);
  }
});

When(
  'I open the un-nested address of the seeded run {string}',
  async ({ page }, uuid: string) => {
    const run = loadRun(uuid);
    const response = await page.goto(`/bakers/run/${run.id}`);
    lastStatus = response?.status() ?? 0;
  },
);

When(
  'I visit the seeded run {string} under a different ticket',
  async ({ page }, uuid: string) => {
    const path = lastLine(
      '$run = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_run", "' +
        uuid +
        '"); $ownTicket = $run ? $run->getTicket() : NULL; $own = $ownTicket ? (int) $ownTicket->id() : 0; $project = $ownTicket ? $ownTicket->get("project_id")->entity : NULL; $group = $project ? $project->get("group_id")->entity : NULL; $ws = $group ? (int) $group->get("workspace_id")->target_id : 0; $other = NULL; if ($ws) { foreach (\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadMultiple() as $t) { if ((int) $t->id() === $own) { continue; } $p = $t->get("project_id")->entity; $g = $p ? $p->get("group_id")->entity : NULL; if ($g && (int) $g->get("workspace_id")->target_id === $ws) { $other = $t; break; } } } print ($run && $other) ? "/bakers/ticket/" . mb_strtolower((string) $other->get("identifier")->value) . "/run/" . $run->id() : "";',
    );
    if (!path) {
      throw new Error(`Could not build a parentage-mismatch URL for ${uuid}.`);
    }
    const response = await page.goto(path);
    lastStatus = response?.status() ?? 0;
  },
);

When('I visit the disposable run page', async ({ page }) => {
  const { run } = subject(page);
  if (!run) {
    throw new Error('The scenario created no run.');
  }
  const loaded = loadRun(run);
  lastHeading = loaded.heading;
  const response = await page.goto(loaded.url);
  lastStatus = response?.status() ?? 0;
  if (lastStatus < 400) {
    await markDocument(page);
  }
});

When('I open the disposable run from its history row', async ({ page }) => {
  const { runId } = subject(page);
  await page.locator(`a[href*="/run/${runId}"]`).first().click();
});

When('I follow the ticket crumb in the breadcrumb', async ({ page }) => {
  const { identifier } = subject(page);
  await page.locator(`${PAGE_HEADER_ISLAND} [data-breadcrumb]`).getByRole('link', {
    name: identifier,
    exact: true,
  }).click();
});

Then('the page heading is the disposable run title', async ({ page }) => {
  const { runId } = subject(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Run #${runId}`, {
    timeout: 10000,
  });
});

Then('the page heading is the disposable ticket title', async ({ page }) => {
  const { identifier, title } = subject(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `${identifier} · ${title}`,
    { timeout: 10000 },
  );
});

Then('the run page offers {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
});

Then('the run page offers no {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
});

Then('the page heading is the run title', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(lastHeading, {
    timeout: 10000,
  });
});

Then('a breadcrumb trail is present', async ({ page }) => {
  await expect(
    page.locator(`${PAGE_HEADER_ISLAND} [data-breadcrumb]`),
  ).toHaveCount(1);
});

Then('the canonical run page has no inline log viewer', async ({ page }) => {
  await expect(page.locator('[data-component-id="bb_theme:log-viewer"]')).toHaveCount(0);
});

Then('the run page response status is {int}', async ({}, status: number) => {
  expect(lastStatus).toBe(status);
});
