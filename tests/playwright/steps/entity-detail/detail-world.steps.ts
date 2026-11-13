// Entity detail pages: the disposable world the editing scenarios mutate, the
// run-attribution fixtures of the Activities feed, and the access checks on
// seeded fixtures (read-only readers, foreign readers, retired addresses).
// Consumer: features/entity-detail. Card and Activities steps are shared in
// support/steps/detail-cards.steps.ts.
//
// Every editing scenario builds its own workspace, group, team, project,
// machine and conductor, edited by the recipe's `fixture-lead` (workspace and
// team lead, owner of the machine and conductor), and removes them in an
// After hook, so no seeded name changes under a concurrent worker.
import { randomUUID } from 'node:crypto';
import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { markDocument } from '../../support/shell';
import { activityRows, card } from '../../support/detail-cards';
import contractWorld from '../../support/contract-world.json';

const { Given, When, Then, After } = createBdd(test);

type Kind = 'machine' | 'group' | 'project' | 'team' | 'conductor';
type Key = Kind | 'second machine' | 'second conductor';

interface DetailWorld {
  suffix: string;
  ids: Partial<Record<Key, string>>;
  urls: Partial<Record<Key, string>>;
  originals: Record<string, string>;
  lead: string;
  ticket?: { id: string; ident: string };
}

let world: DetailWorld | undefined;

function requireWorld(): DetailWorld {
  if (!world) throw new Error('No disposable detail world was built.');
  return world;
}

/**
 * Reads one stored field, every item joined by ", "; `field.property` reads a
 * property other than `value`.
 */
function readField(kind: Kind, id: string, field: string): string {
  const [name, property = 'value'] = field.split('.');
  return php(
    `$e = \\Drupal::entityTypeManager()->getStorage("bb_${kind}")->loadUnchanged(${Number(id)});` +
      ` $v = []; foreach ($e->get("${name}") as $item) { $v[] = (string) $item->${property}; } print implode(", ", $v);`,
  );
}

function removeWorld(suffix: string): void {
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "detail-${suffix}"]));`,
      'if ($w) {',
      'foreach ($etm->getStorage("bb_group")->loadByProperties(["workspace_id" => $w->id()]) as $g) {',
      'foreach ($etm->getStorage("bb_project")->loadByProperties(["group_id" => $g->id()]) as $p) {',
      'foreach ($etm->getStorage("bb_ticket")->loadByProperties(["project_id" => $p->id()]) as $t) {',
      'foreach (["bb_activity", "bb_run"] as $type) { foreach ($etm->getStorage($type)->loadByProperties(["ticket_id" => $t->id()]) as $row) { $row->delete(); } }',
      '$t->delete(); }',
      'foreach ($etm->getStorage("bb_conductor")->loadByProperties(["project_id" => $p->id()]) as $c) { $c->delete(); }',
      '$p->delete(); }',
      '$g->delete(); }',
      'foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()]) as $t) { $t->delete(); }',
      '$owner = $w->get("owner_user_id")->target_id;',
      '$w->delete();',
      'if ($owner) { $etm->getStorage("user")->load($owner)?->delete(); } }',
      `foreach ($etm->getStorage("bb_machine")->loadByProperties(["name" => ["Detail machine ${suffix}", "Second machine ${suffix}"]]) as $m) { $m->delete(); }`,
    ].join(' '),
  );
}

After({ tags: '@feature:detail-cards' }, async () => {
  if (!world) return;
  const { suffix } = world;
  world = undefined;
  removeWorld(suffix);
});

Given('I edit a disposable detail world', async ({ page, authProvider, apiClient }) => {
  const suffix = randomUUID().slice(0, 8);
  const key = `D${suffix.toUpperCase().replace(/[^A-Z]/g, 'X').slice(0, 4)}`;
  const lead = apiClient.fixtureId('user.lead');
  const out = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$lead = current($etm->getStorage("user")->loadByProperties(["uuid" => "${lead}"]));`,
      `$owner = $etm->getStorage("user")->create(["name" => "detail-${suffix}-owner", "status" => 1]); $owner->save();`,
      `$w = $etm->getStorage("bb_workspace")->create(["name" => "Detail ${suffix}", "slug" => "detail-${suffix}", "owner_user_id" => $owner->id()]); $w->save();`,
      `$g = $etm->getStorage("bb_group")->create(["name" => "Detail group ${suffix}", "description" => "Seeded group text", "workspace_id" => $w->id(), "owner_user_id" => $owner->id()]); $g->save();`,
      `$t = $etm->getStorage("bb_team")->create(["name" => "Detail team ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $owner->id()]); $t->save();`,
      '\\Drupal\\og\\Og::createMembership($w, $lead)->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-lead")])->save();',
      '\\Drupal\\og\\Og::createMembership($t, $lead)->setRoles([$etm->getStorage("og_role")->load("bb_team-bb_team-lead")])->save();',
      `$p = $etm->getStorage("bb_project")->create(["name" => "Detail project ${suffix}", "key" => "${key}", "description" => "Seeded project text", "repository" => ["url" => "https://example.com/detail.git", "default_branch" => "main"], "group_id" => $g->id(), "teams" => [$t->id()], "owner_user_id" => $owner->id()]); $p->save();`,
      `$m = $etm->getStorage("bb_machine")->create(["name" => "Detail machine ${suffix}", "host_key" => "detail-${suffix}-a", "owner_user_id" => $lead->id(), "max_parallel" => 2]); $m->save();`,
      `$c = $etm->getStorage("bb_conductor")->create(["conductor_id" => "detail-${suffix}-a", "label" => "Detail conductor ${suffix}", "owner_user_id" => $lead->id(), "status" => "online", "project_id" => $p->id(), "machine" => $m->id(), "states" => ["working"]]); $c->save();`,
      '\\Drupal::service("cache.static")->deleteAll();',
      '$all = ["machine" => $m, "group" => $g, "project" => $p, "team" => $t, "conductor" => $c];',
      'print json_encode([',
      '"lead" => $lead->id(),',
      '"ids" => array_map(fn ($e) => (string) $e->id(), $all),',
      '"urls" => array_map(fn ($e) => $e->toUrl()->toString(), $all),',
      '"originals" => [',
      '"machine.name" => $m->label(), "machine.max_parallel" => (string) $m->get("max_parallel")->value,',
      '"group.name" => $g->label(), "group.description" => (string) $g->get("description")->value,',
      '"project.name" => $p->label(), "project.description" => (string) $p->get("description")->value,',
      '"project.repository.default_branch" => (string) $p->get("repository")->default_branch,',
      '"team.name" => $t->label(), "conductor.label" => $c->label(), "conductor.states" => "working",',
      ']]);',
    ].join(' '),
  );
  const built = JSON.parse(out) as Omit<DetailWorld, 'suffix'>;
  world = { suffix, ...built };
  await authProvider.login(page, built.lead);
});

When(/^I open the (second )?(machine|group|project|team|conductor) detail page$/, async ({ page }, second: string | undefined, kind: Kind) => {
  const key = `${second ?? ''}${kind}` as Key;
  const url = requireWorld().urls[key];
  if (!url) throw new Error(`The detail world has no ${key}.`);
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await markDocument(page);
});

Then('the stored {word} {word} is {string}', async ({}, kind: Kind, field: string, value: string) => {
  const id = requireWorld().ids[kind]!;
  await expect.poll(() => readField(kind, id, field)).toBe(value);
});

Then('the stored {word} {word} is still its original value', async ({}, kind: Kind, field: string) => {
  const { ids, originals } = requireWorld();
  expect(originals[`${kind}.${field}`], `no original ${kind}.${field}`).toBeDefined();
  expect(readField(kind, ids[kind]!, field)).toBe(originals[`${kind}.${field}`]);
});

Given('another editor stores the {word} {word} {string}', async ({}, kind: Kind, field: string, value: string) => {
  const id = requireWorld().ids[kind]!;
  php(
    `$e = \\Drupal::entityTypeManager()->getStorage("bb_${kind}")->load(${Number(id)});` +
      ` $e->set("${field}", ${JSON.stringify(value)}); $e->save();`,
  );
});

// Run attribution: a second machine with its own conductor, one ticket, and
// claims made through runs of either conductor, as a conductor records them.
Given('the world has a second machine with its own conductor', async () => {
  const w = requireWorld();
  const out = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$m = $etm->getStorage("bb_machine")->create(["name" => "Second machine ${w.suffix}", "host_key" => "detail-${w.suffix}-b", "owner_user_id" => ${Number(w.lead)}, "max_parallel" => 2]); $m->save();`,
      `$c = $etm->getStorage("bb_conductor")->create(["conductor_id" => "detail-${w.suffix}-b", "label" => "Second conductor ${w.suffix}", "owner_user_id" => ${Number(w.lead)}, "status" => "online", "project_id" => ${Number(w.ids.project)}, "machine" => $m->id(), "states" => ["working"]]); $c->save();`,
      'print json_encode(["machine" => [(string) $m->id(), $m->toUrl()->toString()], "conductor" => [(string) $c->id(), $c->toUrl()->toString()]]);',
    ].join(' '),
  );
  const second = JSON.parse(out) as Record<'machine' | 'conductor', [string, string]>;
  for (const kind of ['machine', 'conductor'] as const) {
    w.ids[`second ${kind}`] = second[kind][0];
    w.urls[`second ${kind}`] = second[kind][1];
  }
});

Given('a ticket of the world project moved on without a run', async () => {
  const w = requireWorld();
  const out = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$t = $etm->getStorage("bb_ticket")->create(["title" => "Two runs ${w.suffix}", "workflow" => "bb_work", "project_id" => ${Number(w.ids.project)}]); $t->save();`,
      '$t->getState()->applyTransitionById("qualify"); $t->save();',
      'print json_encode(["id" => (string) $t->id(), "ident" => (string) $t->get("identifier")->value]);',
    ].join(' '),
  );
  w.ticket = JSON.parse(out) as { id: string; ident: string };
  expect(w.ticket.ident).not.toBe('');
});

function requireTicket(): { id: string; ident: string } {
  const ticket = requireWorld().ticket;
  if (!ticket) throw new Error('The detail world has no ticket.');
  return ticket;
}

function conductorId(which: string): string {
  const w = requireWorld();
  const id = which === 'second' ? w.ids['second conductor'] : w.ids.conductor;
  if (!id) throw new Error(`The detail world has no ${which} conductor.`);
  return id;
}

Given(/^the ticket was claimed at "([^"]+)" by a run of the (first|second) conductor$/, async ({}, step: string, which: string) => {
  const w = requireWorld();
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$t = $etm->getStorage("bb_ticket")->load(${Number(requireTicket().id)});`,
      `$c = $etm->getStorage("bb_conductor")->load(${Number(conductorId(which))});`,
      `$r = $etm->getStorage("bb_run")->create(["ticket_id" => $t->id(), "conductor_id" => $c->id(), "owner_user_id" => ${Number(w.lead)}, "state" => "done", "state_at_start" => "${step}"]); $r->save();`,
      '\\Drupal::service("event_dispatcher")->dispatch(new \\Drupal\\bb_core\\Claim\\TicketClaimedEvent($t, $r, $c), \\Drupal\\bb_core\\Claim\\TicketClaimedEvent::NAME);',
    ].join(' '),
  );
});

Given(/^a run of the (first|second) conductor failed at "([^"]+)"$/, async ({}, which: string, step: string) => {
  const w = requireWorld();
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$r = $etm->getStorage("bb_run")->create(["ticket_id" => ${Number(requireTicket().id)}, "conductor_id" => ${Number(conductorId(which))}, "owner_user_id" => ${Number(w.lead)}, "state" => "claimed", "state_at_start" => "${step}"]); $r->save();`,
      '$r->setRunState("failed")->save();',
    ].join(' '),
  );
});

Given(/^the ticket is assigned to the (first|second) conductor$/, async ({}, which: string) => {
  php(
    `$t = \\Drupal::entityTypeManager()->getStorage("bb_ticket")->load(${Number(requireTicket().id)});` +
      ` $t->set("conductor_id", ${Number(conductorId(which))}); $t->save();`,
  );
});

Then('the Activities list the ticket {string}', async ({ page }, text: string) => {
  await expect(activityRows(page).filter({ hasText: requireTicket().ident }).filter({ hasText: text })).toHaveCount(1, { timeout: 10000 });
});

Then('the Activities do not list the ticket {string}', async ({ page }, text: string) => {
  await expect(activityRows(page).first().or(page.locator('#entity-detail-activities [data-component-id="bb_theme:empty-state"]'))).toBeVisible();
  await expect(activityRows(page).filter({ hasText: requireTicket().ident }).filter({ hasText: text })).toHaveCount(0);
});

// Seeded fixtures: access checks only, nothing is written.
type Fixture = { url: string; label: string; entityType: string };

let lastStatus: number | undefined;

function fixture(name: string): Fixture {
  const row = contractWorld[name as keyof typeof contractWorld];
  if (!row) throw new Error(`Unknown recipe fixture: ${name}`);
  const raw = php(
    `$e = \\Drupal::service("entity.repository")->loadEntityByUuid("${row.entityType}", "${row.uuid}");` +
      ' print $e ? json_encode(["url" => $e->toUrl()->toString(), "label" => (string) $e->label()]) : "";',
  );
  if (!raw) throw new Error(`The fixture "${name}" is not in the seeded world.`);
  return { entityType: row.entityType, ...(JSON.parse(raw) as Omit<Fixture, 'entityType'>) };
}

/** The address each entity type's product edit form had before the cards. */
function formerSettings(subject: Fixture): string {
  const suffix: Record<string, string> = { bb_team: '/settings', bb_group: '/settings', bb_machine: '/edit' };
  if (!suffix[subject.entityType]) throw new Error(`${subject.entityType} had no retired settings address.`);
  return `${subject.url}${suffix[subject.entityType]}`;
}

When('I open the detail page of fixture {string}', async ({ page }, name: string) => {
  const subject = fixture(name);
  const response = await page.goto(subject.url);
  expect(response?.status(), subject.url).toBe(200);
});

When('I post the {string} card of fixture {string} directly', async ({ page }, operation: string, name: string) => {
  const response = await page.request.post(`${fixture(name).url}/card/${operation}`, {
    form: { 'name[0][value]': 'Reader must not write', 'label[0][value]': 'Reader must not write', op: 'Save' },
    maxRedirects: 0,
  });
  lastStatus = response.status();
});

When('I post the {string} card of the world {word} directly', async ({ page }, operation: string, kind: Kind) => {
  const response = await page.request.post(`${requireWorld().urls[kind]}/card/${operation}`, {
    form: { 'name[0][value]': 'Editor must not write here', op: 'Save' },
    maxRedirects: 0,
  });
  lastStatus = response.status();
});

Then('the card post is refused with status {int}', async ({}, status: number) => {
  expect(lastStatus).toBe(status);
});

// Not "equals the label seen before": entity-edit-access renames some of these
// fixtures on another worker, so only the refused value itself is asserted.
Then('the fixture {string} is not named {string}', async ({}, name: string, refused: string) => {
  expect(fixture(name).label).not.toBe(refused);
});

When('I request the detail page of fixture {string}', async ({ page }, name: string) => {
  lastStatus = (await page.goto(fixture(name).url))?.status();
});

Then('the detail page is refused and shows no cards', async ({ page }) => {
  // 403 for a row the reader may not see, 404 for a slug that is not theirs.
  expect([403, 404]).toContain(lastStatus);
  await expect(page.locator('[data-component-id="bb_theme:inspector"]')).toHaveCount(0);
  await expect(page.locator('#entity-detail-activities')).toHaveCount(0);
});

When('I request the former settings address of fixture {string}', async ({ page }, name: string) => {
  const subject = fixture(name);
  const response = await page.goto(formerSettings(subject));
  expect(response?.status()).toBe(200);
});

Then('I land on the detail page of fixture {string} with its {string} card', async ({ page }, name: string, heading: string) => {
  expect(new URL(page.url()).pathname).toBe(fixture(name).url);
  await expect(card(page, heading)).toBeVisible();
});

Then(
  'a POST to the former settings address of fixture {string} answers {int}',
  async ({ page }, name: string, status: number) => {
    const response = await page.request.post(formerSettings(fixture(name)), {
      form: { 'name[0][value]': 'Retired form must not write', op: 'Save' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(status);
  },
);
