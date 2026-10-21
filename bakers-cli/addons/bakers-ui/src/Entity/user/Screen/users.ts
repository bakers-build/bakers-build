import { actionItem } from '../../../Component/footer-actions/index.js';
import { ListCursor } from '../../../lib/cursor.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { type ListTable, listRowIds, listTableTree } from '../../collection.js';
import { loadWorkspaceMemberships } from '../../workspace/Data/members.js';
import { listAllUsers } from '../Data/users.js';

interface MemberRow {
  id: string;
  label: string;
}

const MEMBER_TABLE = {
  noun: 'workspace-member',
  emptyMessage: 'No active workspace members.',
  columns: [
    {
      key: 'label',
      label: 'MEMBER',
      width: 0,
      fields: ['display_name', 'name'],
      get: (row: MemberRow) => row.label,
    },
  ],
} as const satisfies ListTable<MemberRow, void>;

export class UsersScreen extends AsyncScreen<{ rows: MemberRow[] }> {
  readonly frameId = 'users';
  static readonly route = {
    id: 'workspace.members',
    path: '/members',
    tab: { id: 'members', label: 'Members', scope: 'root', weight: 40 },
  } satisfies RouteMetadata;
  readonly id = UsersScreen.route.id;
  private readonly cursor = new ListCursor();

  private get rows() {
    return this.readyValue?.rows ?? [];
  }

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected async load(context: ScreenContext) {
    if (!context.services?.isWorkspaceAdmin) {
      throw new Error('Workspace Members requires workspace lead access');
    }
    const workspaceId = context.services.workspaceId;
    if (!workspaceId) throw new Error('Workspace Members requires workspaceId');
    const [memberships, users] = await Promise.all([
      loadWorkspaceMemberships(context.services.client, workspaceId),
      listAllUsers(context.services.client),
    ]);
    if (users.error) throw new Error(users.error);
    const memberIds = new Set(memberships.memberIds);
    const resolvedIds = new Set(users.rows.map(({ id }) => id));
    const unresolved = memberships.memberIds.find((id) => !resolvedIds.has(id));
    if (unresolved) {
      throw new Error(
        `active workspace member ${unresolved} could not be resolved`,
      );
    }
    return {
      rows: users.rows
        .filter((user) => memberIds.has(user.id) && user.uid !== 0)
        .map((user) => ({ id: user.id, label: user.label })),
    };
  }

  protected renderLoading(): string[] {
    return ['Loading workspace members…'];
  }

  protected renderReady(result: { rows: MemberRow[] }) {
    return listTableTree(MEMBER_TABLE, result.rows, undefined, {
      selectedIndex: this.cursor.index,
    });
  }

  protected chrome(): FullScreenChrome {
    return {
      title: 'Workspace members',
      meta: `${this.rows.length} member(s)`,
      selectable: this.rows.length,
      selectedIndex: this.cursor.index,
      rowIds: listRowIds(MEMBER_TABLE, this.rows),
    };
  }

  protected actions() {
    return [
      actionItem('workspace-members-open', 'Enter', 'open'),
      actionItem('workspace-members-tab', 'Tab', 'tabs'),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    const workspaceId = context.services?.workspaceId;
    if (!row || !workspaceId || !context.navigate) return false;
    context.navigate('workspace.member.overview', {
      workspaceId,
      userId: row.id,
      userName: row.label,
    });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.cursor.handle(input, this.rows.length)) {
      context.requestDraw();
      return true;
    }
    if (input === 'enter') return this.activate(this.cursor.index, context);
    return false;
  }
}
