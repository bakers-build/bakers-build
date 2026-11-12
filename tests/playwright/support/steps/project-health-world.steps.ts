// The disposable project world (support/project-world.ts), signing in as its
// lead, opening its Overview and Board, and the Board observations an Overview
// scenario makes after it followed the Unhealthy metric there.
// Consumers: features/projects, features/project-board.
import { createBdd } from 'playwright-bdd';
import type { DataTable } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';
import { activeFilters, expectCards } from '../board';
import { active, resetOverridePage, safe } from '../listing';
import { php } from '../drush';
import { buildWorld, removeWorld, requireWorld, type TicketRow } from '../project-world';
import { markDocument } from '../shell';

const { Given, When, Then, After } = createBdd(test);

After({ tags: '@feature:project-overview or @project-board' }, () => removeWorld());

Given('a project world with these tickets:', async ({}, table: DataTable) => {
  resetOverridePage();
  await buildWorld(table.hashes() as TicketRow[]);
});

Given('a project world without tickets', async () => {
  resetOverridePage();
  await buildWorld([]);
});

// Project visibility follows team membership, so a shared persona needs a seat
// on the world's team (and its rank in the world's workspace) to see the project.
Given(
  /^the account "([^"]+)" is seated in the world as a (lead|contributor|guest)$/,
  async ({}, account: string, rank: string) => {
    const { ids } = requireWorld();
    php(
      [
        '$etm = \\Drupal::entityTypeManager(); $roles = $etm->getStorage("og_role");',
        `$u = current($etm->getStorage("user")->loadByProperties(["name" => "${safe(account)}"]));`,
        `if (!$u) { throw new \\RuntimeException("Missing account fixture: ${safe(account)}"); }`,
        `$w = $etm->getStorage("bb_workspace")->load(${ids.workspace}); $team = $etm->getStorage("bb_team")->load(${ids.team});`,
        `\\Drupal\\og\\Og::createMembership($w, $u)->setRoles([$roles->load("bb_workspace-bb_workspace-${rank}")])->save();`,
        `\\Drupal\\og\\Og::createMembership($team, $u)->setRoles(${rank === 'lead' ? '[$roles->load("bb_team-bb_team-lead")]' : '[]'})->save();`,
      ].join(' '),
    );
  },
);

Given("I am signed in as the world's lead", async ({ page, authProvider }) => {
  await authProvider.login(page, String(requireWorld().ids.lead));
});

When(/^I open the world project (Overview|Board)$/, async ({ page }, screen: string) => {
  const world = requireWorld();
  const url = { Overview: world.overview, Board: world.board }[screen];
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await markDocument(page);
});

Then('the Board shows only the tickets {string}', async ({ page }, titles: string) => {
  await expectCards(active(page), titles);
});

Then('the Board shows the active filter {string}', async ({ page }, chip: string) => {
  await expect.poll(() => activeFilters(active(page)), { timeout: 10000 }).toContain(chip);
});

Then('the Board reads {string}', async ({ page }, text: string) => {
  await expect(active(page).locator('[data-active-filters="meta"]')).toHaveText(text, { timeout: 10000 });
});
