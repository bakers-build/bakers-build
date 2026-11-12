// The disposable project world of the Overview and Board scenarios: its own
// workspace, group, team and project, the labels "Question" and "technical
// problem", the conductors "Oven A" (on a machine of two parallel runs) and
// "Oven B" (without a machine), an owner, a lead who owns the conductors, and
// the tickets a scenario lists. Its own workspace keeps its working tickets
// out of the shared "bakers" listings, and its own lead keeps the Board
// preferences (stored per account) away from the shared personas.
import { randomUUID } from 'node:crypto';
import { Drush, php, phpUnderLock } from './drush';
import { safe } from './listing';

/** The world's accounts and containers, by entity id. */
interface Ids {
  owner: number;
  lead: number;
  workspace: number;
  group: number;
  team: number;
}

export interface ProjectWorld {
  ids: Ids;
  overview: string;
  board: string;
  identifiers: Record<string, string>;
}

/** One ticket of the world, as a scenario table names it. */
export type TicketRow = Partial<Record<'ticket' | 'state' | 'conductor' | 'priority' | 'label' | 'runs' | 'blocked by' | 'closed', string>>;

let world: ProjectWorld | undefined;

/** The ticket field each table column sets; an empty cell sets nothing. */
const FIELDS: Record<string, (value: string) => string> = {
  state: (value) => `"state" => "${value}"`,
  conductor: (value) => `"conductor_id" => $conductors["${value}"]->id()`,
  priority: (value) => `"priority" => ${Number(value)}`,
  label: (value) => `"labels" => [$labels["${value}"]->id()]`,
  'blocked by': (value) => `"blocked_by" => [$tickets["${value}"]->id()]`,
};

/** The PHP that creates one row's ticket, closes it and adds its runs, oldest first. */
function ticketPhp(ids: Ids, row: TicketRow): string {
  const title = safe(row.ticket ?? '');
  const fields = Object.entries(row)
    .filter(([column, value]) => FIELDS[column] && value)
    .map(([column, value]) => FIELDS[column](safe(value ?? '')));
  const runs = (row.runs ?? '').split(',').map((state) => safe(state.trim())).filter(Boolean);
  return [
    `$t = $ts->create(["project_id" => $p->id(), "workflow" => "bb_work", "team" => ${ids.team}, "title" => "${title}", ${fields.join(', ')}]);`,
    row.closed ? `$t->markClosed($now - ${Number(row.closed)} * 86400);` : '',
    `$t->save(); $tickets["${title}"] = $t;`,
    `foreach (${JSON.stringify(runs)} as $state) { $rs->create(["ticket_id" => $t->id(), "conductor_id" => $conductors["Oven A"]->id(), "owner_user_id" => ${ids.lead}, "state" => $state, "state_at_start" => "working"])->save(); }`,
  ].join(' ');
}

/**
 * Builds a world with the given tickets, in table order, and indexes them.
 *
 * A project insert takes the global, non-waiting billing lock. It is the first
 * write of the second snippet, so a refused attempt leaves nothing behind and
 * is retried.
 */
export async function buildWorld(rows: TicketRow[]): Promise<ProjectWorld> {
  const suffix = randomUUID().slice(0, 8);
  const ids = JSON.parse(php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      '$us = $etm->getStorage("user");',
      `$owner = $us->create(["name" => "health-${suffix}-owner", "status" => 1]); $owner->save();`,
      `$lead = $us->create(["name" => "health-${suffix}-lead", "status" => 1, "field_onboarding_completed" => 1]); $lead->save();`,
      `$w = $etm->getStorage("bb_workspace")->create(["name" => "Health ${suffix}", "slug" => "health-${suffix}", "owner_user_id" => $owner->id()]); $w->save();`,
      `$g = $etm->getStorage("bb_group")->create(["name" => "Health group ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $owner->id()]); $g->save();`,
      `$team = $etm->getStorage("bb_team")->create(["name" => "Health team ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $owner->id()]); $team->save();`,
      '$roles = $etm->getStorage("og_role");',
      '\\Drupal\\og\\Og::createMembership($w, $lead)->setRoles([$roles->load("bb_workspace-bb_workspace-lead")])->save();',
      '\\Drupal\\og\\Og::createMembership($team, $lead)->setRoles([$roles->load("bb_team-bb_team-lead")])->save();',
      'print json_encode(array_map(fn ($e) => (int) $e->id(), ["owner" => $owner, "lead" => $lead, "workspace" => $w, "group" => $g, "team" => $team]));',
    ].join(' '),
  )) as Ids;
  world = { ids, overview: '', board: '', identifiers: {} };
  const out = await phpUnderLock(
    [
      '$etm = \\Drupal::entityTypeManager();',
      '$now = \\Drupal::time()->getRequestTime();',
      `$p = $etm->getStorage("bb_project")->create(["name" => "Health project ${suffix}", "key" => "H${suffix.toUpperCase()}", "group_id" => ${ids.group}, "teams" => [${ids.team}], "owner_user_id" => ${ids.owner}]); $p->save();`,
      `$m = $etm->getStorage("bb_machine")->create(["name" => "Health machine ${suffix}", "host_key" => "health-${suffix}", "owner_user_id" => ${ids.lead}, "max_parallel" => 2]); $m->save();`,
      '$cs = $etm->getStorage("bb_conductor");',
      '$conductors = [',
      `"Oven A" => $cs->create(["conductor_id" => "health-${suffix}-a", "label" => "Oven A", "owner_user_id" => ${ids.lead}, "status" => "online", "project_id" => $p->id(), "machine" => $m->id(), "states" => ["working"]]),`,
      `"Oven B" => $cs->create(["conductor_id" => "health-${suffix}-b", "label" => "Oven B", "owner_user_id" => ${ids.lead}, "status" => "online", "project_id" => $p->id(), "states" => ["working"]]),`,
      '];',
      'foreach ($conductors as $c) { $c->save(); }',
      '$labels = [];',
      `foreach (["Question", "technical problem"] as $name) { $labels[$name] = $etm->getStorage("bb_term")->create(["vid" => "label", "name" => $name, "workspace_id" => ${ids.workspace}]); $labels[$name]->save(); }`,
      '$ts = $etm->getStorage("bb_ticket"); $rs = $etm->getStorage("bb_run"); $tickets = [];',
      ...rows.map((row) => ticketPhp(ids, row)),
      '\\Drupal::service("cache.static")->deleteAll();',
      'print json_encode([',
      '"overview" => $p->toUrl()->toString(),',
      '"board" => \\Drupal\\Core\\Url::fromRoute("view.project_board.project_board", $p->toUrl()->getRouteParameters())->toString(),',
      '"identifiers" => (object) array_map(fn ($t) => $t->getIdentifier(), $tickets),',
      ']);',
    ].join(' '),
  );
  world = { ids, ...JSON.parse(out) };
  Drush.exec('search-api:index bb_tickets');
  return world;
}

export function requireWorld(): ProjectWorld {
  if (!world) throw new Error('No disposable project world was built.');
  return world;
}

/**
 * Removes the world, its runs and activity rows, and its accounts with their
 * stored preferences; found by group, so a half-built world goes too.
 */
export function removeWorld(): void {
  if (!world) return;
  const { ids } = world;
  world = undefined;
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      '$del = function ($type, $props) use ($etm) { $s = $etm->getStorage($type); $s->delete($s->loadByProperties($props)); };',
      `$projects = array_keys($etm->getStorage("bb_project")->loadByProperties(["group_id" => ${ids.group}])) ?: [0];`,
      '$tickets = array_keys($etm->getStorage("bb_ticket")->loadByProperties(["project_id" => $projects])) ?: [0];',
      '$del("bb_activity", ["ticket_id" => $tickets]);',
      '$del("bb_run", ["ticket_id" => $tickets]);',
      '$del("bb_ticket", ["id" => $tickets]);',
      '$del("bb_conductor", ["project_id" => $projects]);',
      '$del("bb_project", ["id" => $projects]);',
      `$del("bb_machine", ["owner_user_id" => ${ids.lead}]);`,
      `$del("bb_group", ["workspace_id" => ${ids.workspace}]);`,
      `$del("bb_team", ["workspace_id" => ${ids.workspace}]);`,
      `$del("bb_term", ["workspace_id" => ${ids.workspace}]);`,
      `$del("bb_workspace", ["id" => ${ids.workspace}]);`,
      `$del("user", ["uid" => [${ids.owner}, ${ids.lead}]]);`,
    ].join(' '),
  );
}
