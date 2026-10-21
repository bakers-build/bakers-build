import { actionItem } from '../../../Component/footer-actions/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { EmptyOverviewScreen } from '../../../Screen/empty-overview.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { assertActiveMember } from '../Data/member-context.js';

abstract class MemberOverviewScreen extends EmptyOverviewScreen {
  protected abstract validate(context: ScreenContext): Promise<void>;

  protected override load(context: ScreenContext): Promise<void> {
    return this.validate(context);
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const name = context.user?.name ?? context.params?.userName ?? 'member';
    return { title: `${name} · overview` };
  }

  protected actions() {
    return [actionItem(`${this.id}-tab`, 'Tab', 'tabs')];
  }
}

export class WorkspaceMemberOverviewScreen extends MemberOverviewScreen {
  readonly frameId = 'workspace-member-overview';
  static readonly route = {
    id: 'workspace.member.overview',
    path: '/members/:userId',
    fallback: { routeId: 'workspace.members', preserveParams: true },
    tab: {
      id: 'overview',
      label: 'Overview',
      scope: 'workspace-member',
      weight: 10,
    },
  } satisfies RouteMetadata;
  readonly id = WorkspaceMemberOverviewScreen.route.id;

  protected async validate(context: ScreenContext): Promise<void> {
    if (!context.services) throw new Error('Member Overview requires services');
    const workspaceId =
      context.params?.workspaceId ?? context.services.workspaceId;
    const userId = context.user?.id ?? context.params?.userId;
    if (!workspaceId || !userId)
      throw new Error(
        'Workspace member Overview requires workspaceId and userId',
      );
    await assertActiveMember(
      context.services.client,
      'bb_workspace',
      workspaceId,
      userId,
    );
  }
}

export class TeamMemberOverviewScreen extends MemberOverviewScreen {
  readonly frameId = 'team-member-overview';
  static readonly route = {
    id: 'team.member.overview',
    path: '/teams/:teamId/members/:userId',
    fallback: { routeId: 'team.members', preserveParams: true },
    tab: {
      id: 'overview',
      label: 'Overview',
      scope: 'team-member',
      weight: 10,
    },
  } satisfies RouteMetadata;
  readonly id = TeamMemberOverviewScreen.route.id;

  protected async validate(context: ScreenContext): Promise<void> {
    if (!context.services) throw new Error('Member Overview requires services');
    const teamId = context.params?.teamId;
    const userId = context.user?.id ?? context.params?.userId;
    if (!teamId || !userId)
      throw new Error('Team member Overview requires teamId and userId');
    await assertActiveMember(
      context.services.client,
      'bb_team',
      teamId,
      userId,
    );
  }
}
