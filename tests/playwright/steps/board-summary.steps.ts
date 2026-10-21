// The Project Board's parent focus and selection summary.
//
// THE FIXTURE IS THIS CAPABILITY'S OWN: a dedicated "Board focus" project in
// the "bakers" workspace, built per scenario and removed after it, so no scenario
// depends on another's leftovers and the shared recipe world keeps its counts.
// Project and account names carry a per-scenario suffix because the JS and
// no-JS Playwright projects run at the same time against one database. Its tickets stay in `qualification` and hold no conductor, for
// the reason `project-board-drupal.steps.ts` records: open `coding` tickets in
// this workspace would change what `ticket-list` measures. No conductor also
// means nothing here can ever be dispatched.
import { Given, When, Then, test } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import { Drush } from '@key-tec/playwright-core';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { php } from '../support/drush';
import { active, safe } from '../support/listing';

const { After } = createBdd(test);

/** This scenario's fixture: suffix, parent UUID and the account names. */
const focus = {
  suffix: '',
  parentUuid: '',
  parentIdentifier: '',
  leafUuid: '',
  projectId: '',
  emptyProjectId: '',
  names: [] as string[],
};

/** The project name of this scenario's fixture. */
function projectName(): string {
  return `Board focus ${focus.suffix}`;
}

/** The childless project that proves the parent picker can be absent. */
function emptyProjectName(): string {
  return `Board empty ${focus.suffix}`;
}

/** A Gherkin text with each fixture account name given its suffix. */
function suffixed(text: string): string {
  return focus.names.reduce((out, name) => out.split(name).join(`${name}-${focus.suffix}`), text);
}

/** The PHP that removes this scenario's project, tickets and accounts. */
function removal(): string {
  const names = focus.names.map((name) => `"${name}-${focus.suffix}"`).join(', ');
  const parts = [
    '$etm = \\Drupal::entityTypeManager();',
    `foreach (["${projectName()}", "${emptyProjectName()}"] as $n) {`,
    'foreach ($etm->getStorage("bb_project")->loadByProperties(["name" => $n]) as $p) {',
    '$ts = $etm->getStorage("bb_ticket");',
    '$ts->delete($ts->loadByProperties(["project_id" => $p->id()]));',
    '$p->delete(); } }',
  ];
  if (names) {
    parts.push('$us = $etm->getStorage("user");');
    parts.push(`$us->delete($us->loadByProperties(["name" => [${names}]]));`);
  }
  return parts.join(' ');
}

Given(
  'a Board project has a parent with {int} tickets for {string}, {int} for {string} and {int} unassigned',
  async ({}, aliceCount: number, alice: string, bobCount: number, bob: string, unassigned: number) => {
    focus.suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    focus.names = [safe(alice), safe(bob)];
    const keyBase = focus.suffix.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
    const focusKey = (`F${keyBase}`).slice(0, 10);
    const emptyKey = (`E${keyBase}`).slice(0, 10);
    const [result] = [php(
      [
        '$etm = \\Drupal::entityTypeManager();',
        '$ps = $etm->getStorage("bb_project");',
        '$src = current($ps->loadByProperties(["name" => "bakers.build Platform"]));',
        'if (!$src) { throw new \\RuntimeException("Need bakers.build Platform"); }',
        '$teams = [];',
        'foreach ($src->get("teams") as $item) { $teams[] = $item->target_id; }',
        `$project = $ps->create(["name" => "${projectName()}", "key" => "${focusKey}", "group_id" => $src->get("group_id")->target_id, "teams" => $teams, "owner_user_id" => $src->get("owner_user_id")->target_id]);`,
        '$project->save();',
        `$empty = $ps->create(["name" => "${emptyProjectName()}", "key" => "${emptyKey}", "group_id" => $src->get("group_id")->target_id, "teams" => $teams, "owner_user_id" => $src->get("owner_user_id")->target_id]);`,
        '$empty->save();',
        '$us = $etm->getStorage("user");',
        `$a = $us->create(["name" => "${focus.names[0]}-${focus.suffix}", "status" => 1]); $a->save();`,
        `$b = $us->create(["name" => "${focus.names[1]}-${focus.suffix}", "status" => 1]); $b->save();`,
        '$ts = $etm->getStorage("bb_ticket");',
        '$team = $project->get("teams")->target_id;',
        '$make = function ($title, $parent, $assignee) use ($ts, $project, $team) {',
        '$t = $ts->create(["project_id" => $project->id(), "title" => $title, "workflow" => "bb_feature", "state" => "qualification", "team" => $team, "parent_id" => $parent, "assignee_user_id" => $assignee]);',
        '$t->save(); return $t; };',
        '$parent = $make("Focus parent", NULL, NULL);',
        `for ($i = 0; $i < ${aliceCount}; $i++) { $make("Focus child", $parent->id(), $a->id()); }`,
        `for ($i = 0; $i < ${bobCount}; $i++) { $make("Focus child", $parent->id(), $b->id()); }`,
        `for ($i = 0; $i < ${unassigned}; $i++) { $make("Focus child", $parent->id(), NULL); }`,
        'for ($i = 0; $i < 2; $i++) { $c = $make("Focus closed", $parent->id(), NULL); $c->set("closed", 1)->save(); }',
        '$leaf = $make("Focus leaf", NULL, NULL);',
        '$closedP = $make("Closed parent", NULL, NULL); $closedP->set("closed", 1)->save();',
        '$make("Child of closed", $closedP->id(), NULL);',
        '$termP = $make("Cancelled parent", NULL, NULL); $termP->set("state", "cancelled")->set("closed", 1)->save();',
        '$make("Child of cancelled", $termP->id(), NULL);',
        '$onlyClosedP = $make("Closed-child parent", NULL, NULL);',
        '$onlyClosedC = $make("Closed only child", $onlyClosedP->id(), NULL); $onlyClosedC->set("closed", 1)->save();',
        'print $project->id() . " " . $parent->uuid() . " " . $parent->getIdentifier() . " " . $leaf->uuid() . " " . $empty->id();',
      ].join(' '),
    )];
    const [projectId, parentUuid, parentIdentifier, leafUuid, emptyProjectId] = result.split(' ');
    focus.projectId = projectId;
    focus.parentUuid = parentUuid;
    focus.parentIdentifier = parentIdentifier;
    focus.leafUuid = leafUuid;
    focus.emptyProjectId = emptyProjectId;
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

function boardPath(): string {
  expect(focus.projectId, 'The Board focus fixture project exists').not.toBe('');
  return `/bakers/project/${focus.projectId}/board`;
}

When('I visit the focus Board', async ({ page }) => {
  const response = await active(page).goto(boardPath());
  expect(response?.status() ?? 0).toBeLessThan(400);
});

When('I visit the empty Board', async ({ page }) => {
  expect(focus.emptyProjectId, 'The empty Board fixture project exists').not.toBe('');
  const response = await active(page).goto(`/bakers/project/${focus.emptyProjectId}/board`);
  expect(response?.status() ?? 0).toBeLessThan(400);
});

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

When('I visit the focus Board focused on its parent with a search query', async ({ page }) => {
  const response = await active(page).goto(
    `${boardPath()}?parent_id=${focus.parentUuid}&title=nope`,
  );
  expect(response?.status() ?? 0).toBeLessThan(400);
});

When('I choose the focus parent', async ({ page }) => {
  expect(focus.parentIdentifier, 'The fixture parent identifier exists').not.toBe('');
  const target = active(page);
  const link = parentChip(target, focus.parentIdentifier);
  await expect(link, `No parent chip named "${focus.parentIdentifier}"`).toBeVisible();
  await link.click();
  await target.waitForFunction(
    (expected) => decodeURIComponent(window.location.search).includes(expected),
    `parent_id=${focus.parentUuid}`,
    { timeout: 20000 },
  );
});

Then('the Parent chips offer the focus parent', async ({ page }) => {
  await expect(parentChip(active(page), focus.parentIdentifier)).toBeVisible();
});

Then('the Parent chips offer {string}', async ({ page }, title: string) => {
  await expect(active(page).locator(`a[title="${title}"]`)).toBeVisible();
});

Then('the Parent chips do not offer {string}', async ({ page }, title: string) => {
  await expect(active(page).locator(`a[title="${title}"]`)).toHaveCount(0);
});

Then('the Parent chips are absent', async ({ page }) => {
  await expect(active(page).getByText('By parent', { exact: true })).toHaveCount(0);
});

Then('the Board summary says {string}', async ({ page }, text: string) => {
  await expect(active(page).getByText(text, { exact: true }).first()).toBeVisible({ timeout: 20000 });
});

Then('the Board summary does not say {string}', async ({ page }, text: string) => {
  await expect(active(page).getByText(text, { exact: true })).toHaveCount(0);
});

Then('the Board summary counts {string}', async ({ page }, counts: string) => {
  const target = active(page);
  for (const label of counts.split(', ')) {
    await expect(target.getByText(suffixed(label), { exact: true }).first()).toBeVisible();
  }
});

Then('the Board summary counts are chips', async ({ page }) => {
  const target = active(page);
  await expect(target.getByRole('link', { name: / · \d+$/ }).first()).toBeVisible();
});

Then('the Board has no search field', async ({ page }) => {
  const target = active(page);
  await expect(target.locator('input[name="title"]')).toHaveCount(0);
  await expect(target.getByLabel('Search', { exact: true })).toHaveCount(0);
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

When('I click the Board summary action {string}', async ({ page }, label: string) => {
  const target = active(page);
  const before = target.url();
  await target.getByRole('link', { name: label, exact: true }).click();
  await target.waitForFunction((url) => window.location.href !== url, before, { timeout: 20000 });
});

When('I click the work-state chip {string}', async ({ page }, label: string) => {
  const target = active(page);
  const before = target.url();
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await target.getByRole('link', { name: new RegExp(`^${escaped} · `) }).click();
  await target.waitForFunction((url) => window.location.href !== url, before, { timeout: 20000 });
});

/** A parent chip whose visible name starts with the identifier. */
function parentChip(page: Page, identifier: string) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('link', { name: new RegExp(`^${escaped} · `) });
}
