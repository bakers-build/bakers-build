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
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { listRowIds, listTableTree } from '../../collection.js';
import {
  listAllUsers,
  TEAM_MEMBER_TABLE,
  type User,
  type UserListRow,
} from '../../user/Data/users.js';
import { loadTeamWorkload } from '../Data/workload.js';
import { TeamsScreen } from './teams-screen.js';

// BB-391 AC4 (second round) — the crew's people, on the TEAM level.
//
// This is where the former `users` root tab went, by operator ruling: current
// assignments are read through the crew they belong to, so the roster is
// team-scoped.
//
// The answer combines three resources:
//
//   - who is in the crew: `og_membership`
//   - how those people are named: the `user` collection
//   - what is assigned now: open tickets from the team's linked projects
//
// The composition lives here because it joins the team workload with the user
// slice's display identities; the team data loader itself stays slice-local.

/** Rows that are plain text, keyed under one name: a failure state. */
const plainRows = (key: string, lines: string[]): SectionRow[] =>
  lines.map((text, index) => ({ key: `${key}-${index}`, text, bold: false }));

/** What this screen says when it was opened without a crew to open. */
const NO_CREW = 'Open a crew from Teams to see who is in it.';

/** The crew as rows, or the reason there are none. */
interface CrewList {
  rows: UserListRow[];
  /**
   * Present only when the crew could not be ESTABLISHED — a refused membership
   * read, a team that did not resolve, a refused user collection. Never set for
   * a crew that is genuinely empty: that is `rows: []`, and the table's own
   * `emptyMessage` says it.
   */
  error?: string;
  /**
   * No crew was named at all, which is NOT a failure — see
   * {@link TeamUsersScreen.load}. Kept apart from `error` so the two are not
   * reported in the same words: one says a read went wrong, the other says
   * nothing has been chosen yet.
   */
  unscoped?: boolean;
}

/**
 * The atomic team-members figure, keyed by user id. All three measurements
 * share its category axis and arrive from PHP as one payload.
 */
/** One member's row: identity plus live assignments from the team workload. */
function rowOf(
  user: User,
  workload: { open: number; running: number; waiting: number },
): UserListRow {
  return {
    id: user.id,
    label: user.label,
    open: workload.open,
    running: workload.running,
    waiting: workload.waiting,
  };
}

/**
 * One crew's people — the team level's Members tab.
 *
 * `fallback` points at the crews list: Escape lands where the operator came from,
 * which after the ruling is Teams and no longer a root Users tab.
 */
export class TeamUsersScreen extends AsyncScreen<CrewList> {
  readonly frameId = 'team-users';
  reload(context: ScreenContext): void {
    this.retry(context);
  }
  static readonly route = {
    id: 'team.members',
    path: '/teams/:teamId/members',
    tab: { id: 'members', label: 'Members', scope: 'team', weight: 20 },
    fallback: { routeId: TeamsScreen.route.id },
  } satisfies RouteMetadata;
  readonly id = TeamUsersScreen.route.id;
  private readonly cursor = new ListCursor();

  get selectedIndex(): number {
    return this.cursor.index;
  }
  set selectedIndex(value: number) {
    this.cursor.index = value;
  }
  get rows(): readonly UserListRow[] {
    return this.drawable ? (this.readyValue?.rows ?? []) : [];
  }

  /** Whether the ready value is a CREW at all, rather than a notice about one. */
  private get drawable(): boolean {
    const result = this.readyValue;
    return (
      result !== undefined && result.error === undefined && !result.unscoped
    );
  }

  protected async load(context: ScreenContext): Promise<CrewList> {
    if (!context.services) throw new Error('Team users requires services');
    const teamId = context.params?.teamId;
    // Reached without a crew — the shape the user level's `fallback` produces,
    // because a person's route carries `userId` and never a `teamId`. A notice
    // rather than a throw: there is nothing wrong here, there is just no crew
    // chosen yet, and the operator needs to be told where to choose one.
    if (!teamId) return { rows: [], unscoped: true };
    const client = context.services.client;
    let workload: Awaited<ReturnType<typeof loadTeamWorkload>>;
    const users = await listAllUsers(client);
    try {
      workload = await loadTeamWorkload(client, teamId);
    } catch (caught) {
      return {
        rows: [],
        error: caught instanceof Error ? caught.message : String(caught),
      };
    }
    // Either failure leaves the crew unknown, and an unknown crew must not be
    // drawn as an empty one: without the memberships there is nobody to keep,
    // and without the collection there is nobody to name.
    if (users.error !== undefined) return { rows: [], error: users.error };

    const resolvedIds = new Set(users.rows.map(({ id }) => id));
    const unresolved = workload.members.find(
      ({ userId }) => !resolvedIds.has(userId),
    );
    if (unresolved) {
      return {
        rows: [],
        error: `active member ${unresolved.userId} could not be resolved`,
      };
    }

    const byUser = new Map(
      workload.members.map((member) => [member.userId, member]),
    );
    return {
      rows: users.rows
        // Anonymous (0) and Drupal uid 1 are never operator rows — the rule the
        // root list carried, kept where the list now lives.
        .filter(
          (user) => byUser.has(user.id) && user.uid !== 0 && user.uid !== 1,
        )
        .flatMap((user) => {
          const memberWorkload = byUser.get(user.id);
          return memberWorkload ? [rowOf(user, memberWorkload)] : [];
        }),
    };
  }

  protected renderLoading(): string[] {
    return ['Loading crew…'];
  }

  protected renderReady(result: CrewList): VNode {
    const notice = (key: string, lines: string[]): VNode =>
      columnNode(
        'team-users',
        ...plainRows(key, lines).map((row) =>
          sectionRowNode('team-users', row),
        ),
      );
    if (result.unscoped) return notice('team-users-unscoped', [NO_CREW]);
    if (result.error !== undefined)
      return notice('team-users-error', [
        'Could not read the crew.',
        '',
        result.error,
      ]);
    return listTableTree(TEAM_MEMBER_TABLE, result.rows, undefined, {
      selectedIndex: this.selectedIndex,
    });
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const rows = this.rows;
    const result = this.readyValue;
    const name = context.params?.teamName ?? context.params?.teamId ?? 'team';
    if (result?.unscoped)
      return {
        selectable: 0,
        selectedIndex: 0,
        rowIds: [],
        title: 'bakers.build crew',
        meta: 'no crew chosen',
      };
    if (result?.error !== undefined)
      return {
        selectable: 0,
        selectedIndex: 0,
        rowIds: [],
        title: `${name} · members`,
        meta: 'crew unavailable',
      };
    return {
      selectable: rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: listRowIds(TEAM_MEMBER_TABLE, rows),
      title: `${name} · members`,
      meta: `${rows.length} member(s)`,
    };
  }

  protected actions() {
    return [
      actionItem('team-users-open', 'Enter', 'open'),
      actionItem('team-users-tab', 'Tab', 'tabs'),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    const teamId = context.params?.teamId;
    if (!row || !teamId || !context.navigate) return false;
    context.navigate('team.member.overview', {
      teamId,
      teamName: context.params?.teamName ?? teamId,
      userId: row.id,
      userName: row.label,
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
    if (this.cursor.handle(input, this.rows.length)) {
      context.requestDraw();
      return true;
    }
    if (input === 'enter') return this.activate(this.cursor.index, context);
    return false;
  }

  override reset(): void {
    this.cursor.reset();
    super.reset();
  }
}
