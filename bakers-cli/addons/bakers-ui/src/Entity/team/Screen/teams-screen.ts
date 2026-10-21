import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import {
  type SectionRow,
  sectionRowNode,
} from '../../../Component/section-list/index.js';
import { ListCursor } from '../../../lib/cursor.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import { EmptyOverviewScreen } from '../../../Screen/empty-overview.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  type GroupStatisticsResult,
  loadGroupStatistics,
} from '../../../Statistics/client.js';
import { StatisticsScreen } from '../../../Statistics/screen.js';
import { listRowIds, listTableTree } from '../../collection.js';
import {
  loadTeamRows,
  TEAM_LIST_PAGE_SIZE,
  TEAM_TABLE,
  type TeamListResult,
  type TeamListRow,
} from '../Data/teams.js';
import { TeamWorkScreen } from './team-work.js';

// BB-391 (AC4) — the team SURFACE: a list on the root level and a detail that
// is the team-scoped statistics.
//
// Both screens live in one module because they are one surface, exactly as
// `Entity/project/Screen/projects-screen.ts` is one list and
// `Entity/user/Screen/` splits a list from an overview: the split there exists
// because the user OVERVIEW owns a whole tab LEVEL (Overview · Tickets · Runs),
// and a team owns no level — there is nothing under it to tab between.
//
// The detail reads `?team_id=` and nothing else, matching the user statistics
// overview. BB-321 decided a team is a reporting crew, not an access carrier,
// so this surface deliberately does
// not offer membership editing (BB-320's work) and there is no team filter
// on the ticket list: `bb_ticket` carries no `team_id`, and expanding one
// client-side through `og_membership` would build the access carrier that
// decision refused.
//
// BB-456 — the figures themselves are read through the configured-figure
// contract (spec D5) rather than a fixed document: discovery names whichever
// of `team_runs_per_user`, `team_runs_per_project` and
// `team_tickets_per_user` the account's rank grants, and `figureSections`
// maps each by its own `display` kind.

const plainRows = (key: string, lines: string[]): SectionRow[] =>
  lines.map((text, index) => ({ key: `${key}-${index}`, text, bold: false }));

/**
 * The Teams list — a ROOT tab, which is what makes it reachable.
 *
 * Root rather than project level, by the argument BB-232 used for Conductors: a
 * team cuts ACROSS customer projects (it is the level that does, per BB-321), so
 * "which crews are there" must be answerable without first choosing a project.
 *
 * `weight: 40` puts it last, after Conductors, preserving the root navigation
 * order while leaving intermediate weights available for addon screens.
 */
export class TeamsScreen extends AsyncScreen<TeamListResult> {
  readonly frameId = 'teams';
  reload(context: ScreenContext): void {
    this.retry(context);
  }
  static readonly route = {
    id: 'teams',
    path: '/teams',
    tab: { id: 'teams', label: 'Teams', scope: 'root', weight: 30 },
  } satisfies RouteMetadata;
  readonly id = TeamsScreen.route.id;
  private readonly cursor = new ListCursor();
  get selectedIndex(): number {
    return this.cursor.index;
  }
  set selectedIndex(value: number) {
    this.cursor.index = value;
  }
  saveState(): { selectedIndex: number } {
    return { selectedIndex: this.selectedIndex };
  }
  restoreState(token: unknown): void {
    if (
      token &&
      typeof token === 'object' &&
      typeof (token as { selectedIndex?: unknown }).selectedIndex === 'number'
    ) {
      this.selectedIndex = (token as { selectedIndex: number }).selectedIndex;
    }
  }
  get rows(): readonly TeamListRow[] {
    return this.readyValue?.error === undefined
      ? (this.readyValue?.rows ?? [])
      : [];
  }
  protected load(context: ScreenContext): Promise<TeamListResult> {
    if (!context.services) throw new Error('Teams requires services');
    return loadTeamRows({ client: context.services.client });
  }
  protected renderLoading(): string[] {
    return ['Loading teams…'];
  }
  protected renderReady(result: TeamListResult): VNode {
    // A REFUSED read and an empty collection are different answers, and the
    // loader is the only thing that knows which one this is (BB-257 D4). The
    // table's own `emptyMessage` speaks for the second case only; rendering the
    // first through it would report a 403 as "this instance has no crews".
    if (result.error !== undefined) {
      return columnNode(
        'teams',
        ...plainRows('teams-error', [
          'Could not read the team list.',
          '',
          result.error,
        ]).map((row) => sectionRowNode('teams', row)),
      );
    }
    return listTableTree(TEAM_TABLE, result.rows, undefined, {
      selectedIndex: this.selectedIndex,
    });
  }
  protected chrome(context: ScreenContext): FullScreenChrome {
    const rows = this.rows;
    const where = `  ·  ${context.services?.baseUrl ?? ''}`;
    if (this.readyValue?.error !== undefined) {
      return {
        selectable: 0,
        selectedIndex: 0,
        rowIds: [],
        title: 'bakers.build teams',
        meta: `team list unavailable${where}`,
      };
    }
    // `links.next` and nothing else. `rows.length >= TEAM_LIST_PAGE_SIZE` was a
    // guess dressed as a measurement: the server bounds a page at 50 rows
    // whatever `page[limit]` asked for, so a full page says nothing about what
    // follows it — and an instance with exactly 50 teams was told, every draw,
    // that it was seeing only the first page of them.
    const capped = this.readyValue?.hasNext ?? false;
    return {
      selectable: rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: listRowIds(TEAM_TABLE, rows),
      title: 'bakers.build teams',
      meta: capped
        ? `${rows.length} team(s) · first page (≤${TEAM_LIST_PAGE_SIZE})${where}`
        : `${rows.length} team(s)${where}`,
    };
  }
  protected actions() {
    return [
      actionItem('teams-enter', 'Enter', 'open'),
      actionItem('teams-tab', 'Tab', 'tabs'),
    ];
  }
  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    if (!row || !context.navigate) return false;
    context.navigate(TeamWorkScreen.route.id, {
      teamId: row.id,
      teamName: row.name,
    });
    return true;
  }
  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.readyValue === undefined) return false;
    const rows = this.rows;
    if (this.cursor.handle(input, rows.length)) {
      context.requestDraw();
      return true;
    }
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return false;
  }
  override reset(): void {
    this.cursor.reset();
    super.reset();
  }
}

/**
 * ONE team's report: the crew's identity plus its configured figures,
 * discovered and read for the team's own uuid (BB-456 spec D5).
 *
 * `fallback` points at the list, so Escape from a deep link lands somewhere real
 * rather than on the default route — the rule `UserOverviewScreen` follows.
 */
export class TeamOverviewScreen extends EmptyOverviewScreen {
  readonly frameId = 'team-overview';
  /**
   * BB-391 AC4 (second round) — the team level's landing tab.
   *
   * The earlier round declared no `tab` here and argued a team owns no LEVEL
   * because "there is nothing under it to tab between". The operator's ruling is
   * the opposite: the users level is under it, so the crew has a bar of its own
   * (Overview · Users) and this screen is its first entry.
   */
  static readonly route = {
    id: 'team.overview',
    path: '/teams/:teamId',
    tab: { id: 'overview', label: 'Overview', scope: 'team', weight: 1 },
    fallback: { routeId: TeamsScreen.route.id },
  } satisfies RouteMetadata;
  readonly id = TeamOverviewScreen.route.id;

  protected chrome(context: ScreenContext): FullScreenChrome {
    const name = context.params?.teamName ?? context.params?.teamId ?? 'team';
    return { title: `${name} · overview` };
  }

  protected actions() {
    return [actionItem('team-overview-tab', 'Tab', 'tabs')];
  }
}

export class TeamStatsScreen extends StatisticsScreen<GroupStatisticsResult> {
  readonly frameId = 'team-stats';
  static readonly route = {
    id: 'team.stats',
    path: '/teams/:teamId/stats',
    tab: { id: 'stats', label: 'Stats', scope: 'team', weight: 10 },
    fallback: { routeId: TeamOverviewScreen.route.id, preserveParams: true },
  } satisfies RouteMetadata;
  readonly id = TeamStatsScreen.route.id;

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected load(context: ScreenContext): Promise<GroupStatisticsResult> {
    if (!context.services) throw new Error('Team overview requires services');
    const teamId = context.params?.teamId;
    if (!teamId) throw new Error('Team overview requires teamId');
    return loadGroupStatistics(
      context.services.client,
      { team: teamId },
      this.statisticsFilters(),
    );
  }

  protected renderLoading(): string[] {
    return ['Loading team overview…'];
  }

  protected readyRows(statistics: GroupStatisticsResult): SectionRow[] {
    if (statistics.kind === 'unsupported')
      return plainRows('unsupported', [
        'This control plane does not serve /jsonapi/bakers/statistics.',
      ]);
    if (statistics.kind === 'error')
      return plainRows('error', [
        'Could not read /jsonapi/bakers/statistics.',
        '',
        statistics.message,
      ]);
    if (statistics.groups.length === 0)
      return plainRows('empty', ['No figures configured for this team.']);
    // A zero month is a real answer — a crew that closed nothing this month is
    // not an empty screen.
    return [];
  }

  protected statistics(value: GroupStatisticsResult) {
    return value;
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const result = this.readyValue;
    // The RESOLVED name wins over the param: the param is what the list happened
    // to be showing when the operator pressed Enter, and a deep link carries
    // none at all. It is the placeholder while the read is in flight, which is
    // the one thing it is good for.
    const name = context.params?.teamName ?? context.params?.teamId ?? 'team';
    const meta =
      result?.kind === 'ok'
        ? `${result.groups.reduce((sum, group) => sum + group.figures.length, 0)} figure(s)`
        : this.state === 'loading'
          ? 'loading…'
          : 'statistics unavailable';
    return { title: `${name} · stats`, meta };
  }

  protected actions() {
    return [actionItem('team-stats-tab', 'Tab', 'tabs')];
  }
}
