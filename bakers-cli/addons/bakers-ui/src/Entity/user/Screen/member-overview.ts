import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import {
  sectionRowNode,
  sectionRows,
} from '../../../Component/section-list/index.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { assertActiveMember } from '../Data/member-context.js';
import { loadUserProfile, type UserProfile } from '../Data/users.js';

const profileLines = (profile: UserProfile): string[] => {
  const [first = 'none', ...rest] = profile.aboutMe
    ? profile.aboutMe.replace(/\r\n?/g, '\n').split('\n')
    : [];
  return [
    `Username: ${profile.username || 'none'}`,
    `Position: ${profile.position || 'none'}`,
    `About me: ${first}`,
    ...rest.map((line) => `  ${line}`),
  ];
};

/** The workspace member landing tab: the person's profile, once their active
 *  membership in the workspace is confirmed. */
export class WorkspaceMemberOverviewScreen extends AsyncScreen<UserProfile> {
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

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected async load(context: ScreenContext): Promise<UserProfile> {
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
    return loadUserProfile(context.services.client, userId);
  }

  protected renderLoading(): string[] {
    return ['Loading member…'];
  }

  protected renderReady(profile: UserProfile): VNode {
    const rows = sectionRows([
      { heading: 'Profile', lines: profileLines(profile) },
    ]).map((row) => sectionRowNode(this.frameId, row));
    return columnNode(this.frameId, ...rows);
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const name = context.user?.name ?? context.params?.userName ?? 'member';
    return { title: `${name} · overview` };
  }

  protected actions() {
    return [actionItem(`${this.id}-tab`, 'Tab', 'tabs')];
  }
}
