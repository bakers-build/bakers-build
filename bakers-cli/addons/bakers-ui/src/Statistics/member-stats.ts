import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { actionItem } from '../Component/footer-actions/index.js';
import { lineText, type SectionRow } from '../Component/section-list/index.js';
import { statsPanelRows } from '../Component/stats-panel/index.js';
import type { RouteMetadata } from '../Routing/route.js';
import type { FullScreenChrome } from '../Screen/full-screen.js';
import type { ScreenContext } from '../Screen/screen.js';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
} from '../types.js';
import {
  type GroupStatisticsResult,
  loadGroupStatistics,
  type StatisticsContexts,
} from './client.js';
import { StatisticsScreen } from './screen.js';

type MemberParentType = 'bb_team' | 'bb_workspace';
const MEMBERSHIP_PAGE_SIZE = 20;

const relationshipId = (
  relationship: JsonApiRelationship | undefined,
): string | undefined => {
  const data = relationship?.data;
  return data && !Array.isArray(data) ? data.id : undefined;
};

/** Keep contextual statistics inside a readable, active membership. */
async function assertActiveMember(
  client: DropshClient,
  parentType: MemberParentType,
  parentId: string,
  userId: string,
): Promise<void> {
  const parent = await client
    .collection(parentType)
    .where('id', '=', parentId)
    .first();
  const internalId = parent?.attr('drupal_internal__id');
  if (typeof internalId !== 'number' && typeof internalId !== 'string') {
    throw new Error(`no readable ${parentType} with uuid ${parentId}`);
  }

  let offset = 0;
  while (true) {
    const params = new DrupalJsonApiParams()
      .addFilter('entity_type', parentType)
      .addFilter('entity_id', String(internalId))
      .addFilter('state', 'active')
      .addSort('drupal_internal__id', 'ASC')
      .addPageLimit(MEMBERSHIP_PAGE_SIZE);
    if (offset > 0) params.addPageOffset(offset);
    const document = (await client.get('og_membership/default', params)) as {
      data?: JsonApiResource[];
      links?: { next?: unknown };
      meta?: { omitted?: unknown };
    };
    if (document.meta?.omitted) {
      throw new Error(`the control plane withheld ${parentType} memberships`);
    }
    if (
      (document.data ?? []).some(
        (row) => relationshipId(row.relationships?.uid) === userId,
      )
    ) {
      return;
    }
    if (!document.links?.next) {
      throw new Error(
        `user ${userId} is not an active member of ${parentType} ${parentId}`,
      );
    }
    offset += MEMBERSHIP_PAGE_SIZE;
  }
}

const plainRows = (key: string, lines: string[]): SectionRow[] =>
  lines.map((text, index) => ({ key: `${key}-${index}`, text, bold: false }));

abstract class MemberStatsScreen extends StatisticsScreen<GroupStatisticsResult> {
  abstract readonly frameId: string;

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected abstract statisticsContexts(
    context: ScreenContext,
  ): StatisticsContexts;

  protected abstract validate(context: ScreenContext): Promise<void>;

  protected async load(context: ScreenContext): Promise<GroupStatisticsResult> {
    if (!context.services) throw new Error('Member Stats requires services');
    await this.validate(context);
    return loadGroupStatistics(
      context.services.client,
      this.statisticsContexts(context),
      this.statisticsFilters(),
    );
  }

  protected renderLoading(): string[] {
    return ['Loading member stats…'];
  }

  protected readyRows(result: GroupStatisticsResult): SectionRow[] {
    if (result.kind === 'unsupported')
      return plainRows('unsupported', [
        'This control plane does not serve /jsonapi/bakers/statistics.',
      ]);
    if (result.kind === 'error')
      return plainRows('error', [
        'Could not read /jsonapi/bakers/statistics.',
        '',
        result.message,
      ]);
    if (result.groups.length === 0)
      return plainRows(
        'empty',
        statsPanelRows([], {
          emptyMessage: 'No figures configured for this member.',
        }).map(lineText),
      );
    return [];
  }

  protected statistics(value: GroupStatisticsResult) {
    return value;
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const result = this.readyValue;
    const name = context.user?.name ?? context.params?.userName ?? 'member';
    const meta =
      result?.kind === 'ok'
        ? `${result.groups.reduce((sum, group) => sum + group.figures.length, 0)} figure(s)`
        : this.state === 'loading'
          ? 'loading…'
          : 'statistics unavailable';
    return { title: `${name} · stats`, meta };
  }

  protected actions() {
    return [actionItem(`${this.id}-tab`, 'Tab', 'tabs')];
  }
}

export class WorkspaceMemberStatsScreen extends MemberStatsScreen {
  readonly frameId = 'workspace-member-stats';
  static readonly route = {
    id: 'workspace.member.stats',
    path: '/members/:userId/stats',
    fallback: { routeId: 'workspace.members', preserveParams: true },
    tab: {
      id: 'stats',
      label: 'Stats',
      scope: 'workspace-member',
      weight: 20,
    },
  } satisfies RouteMetadata;
  readonly id = WorkspaceMemberStatsScreen.route.id;

  protected statisticsContexts(context: ScreenContext): StatisticsContexts {
    const userId = context.user?.id ?? context.params?.userId;
    return userId ? { user: userId } : {};
  }

  protected async validate(context: ScreenContext): Promise<void> {
    if (!context.services) throw new Error('Member Stats requires services');
    const workspaceId =
      context.params?.workspaceId ?? context.services.workspaceId;
    const userId = context.user?.id ?? context.params?.userId;
    if (!workspaceId || !userId)
      throw new Error('Workspace member Stats requires workspaceId and userId');
    await assertActiveMember(
      context.services.client,
      'bb_workspace',
      workspaceId,
      userId,
    );
  }
}

export class TeamMemberStatsScreen extends MemberStatsScreen {
  readonly frameId = 'team-member-stats';
  static readonly route = {
    id: 'team.member.stats',
    path: '/teams/:teamId/members/:userId/stats',
    fallback: { routeId: 'team.members', preserveParams: true },
    tab: {
      id: 'stats',
      label: 'Stats',
      scope: 'team-member',
      weight: 20,
    },
  } satisfies RouteMetadata;
  readonly id = TeamMemberStatsScreen.route.id;

  protected statisticsContexts(context: ScreenContext): StatisticsContexts {
    const teamId = context.params?.teamId;
    const userId = context.user?.id ?? context.params?.userId;
    return {
      ...(teamId ? { team: teamId } : {}),
      ...(userId ? { user: userId } : {}),
    };
  }

  protected async validate(context: ScreenContext): Promise<void> {
    if (!context.services) throw new Error('Member Stats requires services');
    const teamId = context.params?.teamId;
    const userId = context.user?.id ?? context.params?.userId;
    if (!teamId || !userId)
      throw new Error('Team member Stats requires teamId and userId');
    await assertActiveMember(
      context.services.client,
      'bb_team',
      teamId,
      userId,
    );
  }
}
