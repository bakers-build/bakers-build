import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import {
  sectionRowNode,
  sectionRows,
} from '../../../Component/section-list/index.js';
import { workloadSummaryRows } from '../../../Component/workload-summary/index.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type {
  FullScreenChrome,
  ListFilterBadge,
} from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { TicketSearch } from '../../ticket/Screen/ticket-search.js';
import { loadTeamWorkload, type TeamWorkloadResult } from '../Data/workload.js';

export class TeamWorkScreen extends AsyncScreen<TeamWorkloadResult> {
  readonly frameId = 'team-work';
  static readonly route = {
    id: 'team.work',
    path: '/teams/:teamId/work',
    tab: { id: 'work', label: 'Work', scope: 'team', weight: 5 },
    fallback: { routeId: 'teams' },
  } satisfies RouteMetadata;
  readonly id = TeamWorkScreen.route.id;
  searchQuery = '';
  private readonly search = new TicketSearch(this);

  /** No ticket rows here, so only a refusal lands: nothing was found, and the
   *  counts say so instead of standing over the previous search. */
  showRows(): void {
    const current = this.readyValue;
    if (!current) return;
    const none = { open: 0, running: 0, waiting: 0 };
    this.replaceReady({
      ...current,
      members: current.members.map((member) => ({ ...member, ...none })),
      total: none,
    });
  }

  reloadSearch(context: ScreenContext): Promise<boolean> {
    return this.reloadInPlace(context);
  }

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected load(context: ScreenContext): Promise<TeamWorkloadResult> {
    if (!context.services) throw new Error('Team Work requires services');
    const teamId = context.params?.teamId;
    if (!teamId) throw new Error('Team Work requires teamId');
    return loadTeamWorkload(context.services.client, teamId, this.searchQuery);
  }

  protected renderLoading(): string[] {
    return ['Loading team work…'];
  }

  protected renderReady(result: TeamWorkloadResult): VNode {
    const rows = sectionRows([
      {
        heading: 'Team',
        lines: [
          ...(result.team.workspace
            ? [`Workspace: ${result.team.workspace}`]
            : []),
          `Members: ${result.team.memberCount}`,
          `Projects: ${result.team.projectCount}`,
        ],
      },
      {
        heading: 'Current work',
        lines: workloadSummaryRows([
          ['Open', result.total.open],
          ['Running', result.total.running],
          ['Waiting', result.total.waiting],
          ['Members', result.team.memberCount],
        ]),
      },
    ]);
    return columnNode(
      'team-work',
      ...rows.map((row) => sectionRowNode('team-work', row)),
    );
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const teamName =
      this.readyValue?.team.name ??
      context.params?.teamName ??
      context.params?.teamId ??
      'Team';
    return {
      title: `${teamName} · work`,
      meta: [
        `${this.readyValue?.team.projectCount ?? 0} project(s)`,
        context.services?.baseUrl ?? '',
        this.search.hint(),
      ]
        .filter(Boolean)
        .join('  ·  '),
    };
  }

  protected badges(): readonly ListFilterBadge[] {
    return [this.search.badge()];
  }

  protected notice(): string | undefined {
    return this.search.status || undefined;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    return this.search.handleKey(input, context);
  }

  override leave(): void {
    this.search.close();
    super.leave();
  }

  override reset(): void {
    this.searchQuery = '';
    this.search.reset();
    super.reset();
  }

  protected actions() {
    return [actionItem('team-work-tab', 'Tab', 'tabs')];
  }
}
