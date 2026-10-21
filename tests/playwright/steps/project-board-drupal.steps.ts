import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { Drush } from '@key-tec/playwright-core';
import { expect } from '@playwright/test';
import { php } from '../support/drush';
import { active, safe } from '../support/listing';

let boardPath = '';
let boardStatus = 0;

function projectId(name: string): string {
  const id = php(
    '$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"])); print $p ? $p->id() : "";`,
  );
  expect(id, 'The recipe supplies the Board project').not.toBe('');
  return id;
}

When('I visit the project board for {string}', async ({ page }, name: string) => {
  boardPath = `/bakers/project/${projectId(name)}/board`;
  const response = await page.goto(boardPath);
  boardStatus = response?.status() ?? 0;
});

Then('the Board shows the columns {string}', async ({ page }, names: string) => {
  const target = active(page);
  const columns = names.split(', ');
  for (const name of columns) {
    await expect(target.locator(`[data-col="${name}"]`)).toBeVisible();
  }
  await expect(target.locator('[data-col]')).toHaveCount(columns.length);
});

// People are filtered by the Assignee chips; a Conductor filter said the
// same thing twice.
Then('the Board shows no Conductor filter', async ({ page }) => {
  await expect(active(page).getByLabel('Conductor', { exact: true })).toHaveCount(0);
});

// The suite shares one world, and this project lands in the "bakers" workspace.
// Its open tickets therefore stay in `qualification`: `ticket-list` asserts that
// the "Coding" facet narrows a full page, and two more open `coding` tickets
// fill that page. The Blocked marker reads `blocked_by`, not the state.
Given('a dedicated Board project has a blocked ticket and a cancelled ticket', () => {
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      '$ps = $etm->getStorage("bb_project");',
      '$project = current($ps->loadByProperties(["name" => "Board markers"]));',
      'if (!$project) {',
      '$src = current($ps->loadByProperties(["name" => "bakers.build Platform"]));',
      'if (!$src) { throw new \\RuntimeException("Need bakers.build Platform"); }',
      '$teams = [];',
      'foreach ($src->get("teams") as $item) { $teams[] = $item->target_id; }',
      '$project = $ps->create(["name" => "Board markers", "key" => "BRDM", "group_id" => $src->get("group_id")->target_id, "teams" => $teams, "owner_user_id" => $src->get("owner_user_id")->target_id]);',
      '$project->save();',
      '}',
      '$ts = $etm->getStorage("bb_ticket");',
      'if (!current($ts->loadByProperties(["project_id" => $project->id(), "title" => "Board blocked"]))) {',
      '$team = $project->get("teams")->target_id;',
      '$peer = $ts->create(["project_id" => $project->id(), "title" => "Board peer", "workflow" => "bb_feature", "state" => "qualification", "team" => $team]);',
      '$peer->save();',
      '$blocked = $ts->create(["project_id" => $project->id(), "title" => "Board blocked", "workflow" => "bb_feature", "state" => "qualification", "team" => $team]);',
      '$blocked->set("blocked_by", [$peer->id()])->save();',
      '$cancelled = $ts->create(["project_id" => $project->id(), "title" => "Board cancelled", "workflow" => "bb_feature", "state" => "cancelled", "closed" => 1, "team" => $team]);',
      '$cancelled->save();',
      '}',
      'print $project->id();',
    ].join(' '),
  );
  Drush.exec('search-api:index bb_tickets');
});

// Scoped to the cards: the State facet's panel carries the same words
// ("Cancelled") as hidden option labels.
Then('the Board shows the marker {string}', async ({ page }, label: string) => {
  await expect(active(page).locator('[data-col] article').getByText(label, { exact: true }).first()).toBeVisible();
});

Then('the project board denies access', async ({ page }) => {
  expect([403, 404]).toContain(boardStatus);
  await expect(page.locator('[data-col]')).toHaveCount(0);
});
