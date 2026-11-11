// The Project Board's parent focus and selection summary.
//
// THE FIXTURE IS THIS CAPABILITY'S OWN: a dedicated "Board focus" project in
// the "bakers" workspace, built per scenario and removed after it, so no scenario
// depends on another's leftovers and the shared recipe world keeps its counts.
// Project and account names carry a per-scenario suffix because the JS and
// no-JS Playwright projects run at the same time against one database. Its tickets stay in `qualification` and hold no conductor, for
// the reason `project-board-drupal.steps.ts` records: open `working` tickets in
// this workspace would change what `ticket-list` measures. No conductor also
// means nothing here can ever be dispatched. Its own viewer, a lead of the
// workspace, keeps the Board preferences (stored per account) to itself.
//
// The Board is addressed by project id: on a key address BbBoardParent reads
// the raw key and ignores parent_id, a known defect outside this suite.
import { randomUUID } from 'node:crypto';
import { Given, When, Then, test } from '../bdd.fixtures';
import { createBdd } from 'playwright-bdd';
import { Drush } from '../support/drush';
import { expect } from '@playwright/test';
import { php, phpUnderLock } from '../support/drush';
import { active, safe } from '../support/listing';

const { After } = createBdd(test);

/** This scenario's fixture: suffix, parent UUID and the account names. */
const focus = {
  suffix: '',
  parentUuid: '',
  parentIdentifier: '',
  leafUuid: '',
  projectId: '',
  viewer: '',
  names: [] as string[],
};

/** The project name of this scenario's fixture. */
function projectName(): string {
  return `Board focus ${focus.suffix}`;
}

/** A fixture account name given its suffix. */
function suffixed(name: string): string {
  return `${name}-${focus.suffix}`;
}

/** The PHP that removes this scenario's project, tickets and accounts. */
function removal(): string {
  const names = [...focus.names, 'board-viewer'].map((name) => `"${suffixed(name)}"`).join(', ');
  return [
    '$etm = \\Drupal::entityTypeManager();',
    `foreach ($etm->getStorage("bb_project")->loadByProperties(["name" => "${projectName()}"]) as $p) {`,
    '$ts = $etm->getStorage("bb_ticket");',
    '$ts->delete($ts->loadByProperties(["project_id" => $p->id()]));',
    '$p->delete(); }',
    '$us = $etm->getStorage("user");',
    `$us->delete($us->loadByProperties(["name" => [${names}]]));`,
  ].join(' ');
}

Given(
  'a Board project has a parent with {int} tickets for {string}, {int} for {string} and {int} unassigned',
  async ({}, aliceCount: number, alice: string, bobCount: number, bob: string, unassigned: number) => {
    focus.suffix = randomUUID().slice(0, 8);
    focus.names = [safe(alice), safe(bob)];
    // The project insert takes the global billing lock and is this snippet's
    // first write, so a refused attempt leaves nothing behind and is retried.
    const result = await phpUnderLock(
      [
        '$etm = \\Drupal::entityTypeManager();',
        '$ps = $etm->getStorage("bb_project");',
        '$src = current($ps->loadByProperties(["name" => "bakers.build Platform"]));',
        'if (!$src) { throw new \\RuntimeException("Need bakers.build Platform"); }',
        '$teams = [];',
        'foreach ($src->get("teams") as $item) { $teams[] = $item->target_id; }',
        `$project = $ps->create(["name" => "${projectName()}", "key" => "F${focus.suffix.toUpperCase()}", "group_id" => $src->get("group_id")->target_id, "teams" => $teams, "owner_user_id" => $src->get("owner_user_id")->target_id]);`,
        '$project->save();',
        '$us = $etm->getStorage("user");',
        `$a = $us->create(["name" => "${suffixed(focus.names[0])}", "status" => 1]); $a->save();`,
        `$b = $us->create(["name" => "${suffixed(focus.names[1])}", "status" => 1]); $b->save();`,
        `$viewer = $us->create(["name" => "${suffixed('board-viewer')}", "status" => 1, "field_onboarding_completed" => 1]); $viewer->save();`,
        '$workspace = $src->get("group_id")->entity->get("workspace_id")->entity;',
        '\\Drupal\\og\\Og::createMembership($workspace, $viewer)->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-lead")])->save();',
        '$ts = $etm->getStorage("bb_ticket");',
        '$team = $project->get("teams")->target_id;',
        '$make = function ($title, $parent, $assignee) use ($ts, $project, $team) {',
        '$t = $ts->create(["project_id" => $project->id(), "title" => $title, "workflow" => "bb_work", "state" => "qualification", "team" => $team, "parent_id" => $parent, "assignee_user_id" => $assignee]);',
        '$t->save(); return $t; };',
        '$parent = $make("Focus parent", NULL, NULL);',
        `for ($i = 0; $i < ${aliceCount}; $i++) { $make("Focus child", $parent->id(), $a->id()); }`,
        `for ($i = 0; $i < ${bobCount}; $i++) { $make("Focus child", $parent->id(), $b->id()); }`,
        `for ($i = 0; $i < ${unassigned}; $i++) { $make("Focus child", $parent->id(), NULL); }`,
        'for ($i = 0; $i < 2; $i++) { $c = $make("Focus closed", $parent->id(), NULL); $c->set("closed", 1)->save(); }',
        '$leaf = $make("Focus leaf", NULL, NULL);',
        'print $project->id() . " " . $parent->uuid() . " " . $parent->getIdentifier() . " " . $leaf->uuid() . " " . $viewer->id();',
      ].join(' '),
    );
    [focus.projectId, focus.parentUuid, focus.parentIdentifier, focus.leafUuid, focus.viewer] = result.split(' ');
    expect(focus.parentUuid, 'The fixture parent was created').toMatch(/^[0-9a-f-]{36}$/);
    expect(focus.leafUuid, 'The fixture leaf was created').toMatch(/^[0-9a-f-]{36}$/);
    expect(focus.parentIdentifier, 'The parent chip shows the identifier').toMatch(/^\S+$/);
    Drush.exec('search-api:index bb_tickets');
  },
);

After({ tags: '@feature:board-parent-focus' }, async () => {
  if (!focus.suffix) {
    return;
  }
  php(removal());
});

Given("I am signed in as the focus Board's viewer", async ({ page, authProvider }) => {
  await authProvider.login(page, focus.viewer);
});

function boardPath(): string {
  expect(focus.projectId, 'The Board focus fixture project exists').not.toBe('');
  return `/bakers/project/${focus.projectId}/board`;
}

When('I visit the focus Board with an unknown parent', async ({ page }) => {
  await active(page).goto(`${boardPath()}?parent_id=00000000-0000-4000-8000-000000000000`);
});

When('I visit the focus Board focused on its leaf', async ({ page }) => {
  expect(focus.leafUuid, 'The fixture leaf exists').toMatch(/^[0-9a-f-]{36}$/);
  const response = await active(page).goto(`${boardPath()}?parent_id=${focus.leafUuid}`);
  expect(response?.status() ?? 0).toBeLessThan(400);
});

When('I open the focus Board focused on its parent', async ({ page }) => {
  const response = await active(page).goto(`${boardPath()}?parent_id=${focus.parentUuid}`);
  expect(response?.status() ?? 0).toBeLessThan(400);
});

Then('the Board shows the focus parent chip counting {int}', async ({ page }, count: number) => {
  const chip = active(page).locator('[data-facet]').filter({ hasText: focus.parentIdentifier });
  await expect(chip.locator('[data-part="field"]')).toHaveText('Parent');
  await expect(chip.locator('[data-part="count"]')).toHaveText(`· ${count}`);
});

// An avatar is named "<name>, N tickets"; the Unassigned toggle reads "Unassigned · N".
Then('the Board assignees count {string}', async ({ page }, counts: string) => {
  for (const pair of counts.split(', ')) {
    const [label, count] = pair.split(' · ');
    const names: Record<string, string> = { Unassigned: pair };
    const name = names[label] ?? `${suffixed(label)}, ${count} ${count === '1' ? 'ticket' : 'tickets'}`;
    await expect(active(page).getByRole('link', { name, exact: true })).toBeVisible();
  }
});

Then('the Board summary says {string}', async ({ page }, text: string) => {
  await expect(active(page).getByText(text, { exact: true }).first()).toBeVisible({ timeout: 20000 });
});

Then('the {string} column shows {int} cards', async ({ page }, column: string, count: number) => {
  const cards = active(page).locator(`[data-col="${safe(column)}"] article[data-state]`);
  await expect(cards).toHaveCount(count);
});

When('I open the next {string} page', async ({ page }, column: string) => {
  const target = active(page);
  const before = target.url();
  await target.locator(`[data-col="${safe(column)}"] a[rel="next"]`).click();
  await target.waitForFunction((url) => window.location.href !== url, before, { timeout: 20000 });
});
