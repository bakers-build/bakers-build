// BB-472: the cockpit's workspace switch. A one-column `ListTable`,
// presented as a popup over whichever screen opened it — the same modal
// pattern `Entity/ticket/Screen/create-ticket-form.ts` uses
// (`AsyncModalScreen`), not a full-screen route: switching workspace is a
// short, dismissable action from wherever the operator already is, not a
// destination of its own.
//
// The switch does three things, in order, on Enter: (1) refuse silently when
// the choice is already active — a write and a restart over "the same" would
// be a no-op with side effects; (2) ask the command owner to persist the
// selection through the conductor config contract; (3) re-execute
// this process via the seam `ui/src/bun-runtime.ts` exposes, so any conductor
// reading the SAME config file re-binds on its next read.

import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import {
  lineText,
  type SectionLine,
} from '../../../Component/section-list/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncModalScreen } from '../../../Screen/async-modal-screen.js';
import type { ModalChrome } from '../../../Screen/modal-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  type ListTable,
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../collection.js';
import { loadWorkspaces, type WorkspaceOption } from '../Data/workspaces.js';

const PICKER_TABLE = {
  noun: 'workspace-picker',
  header: false,
  emptyMessage: 'No accessible workspace.',
  columns: [
    {
      key: 'name',
      label: '',
      width: 0,
      fields: ['name'],
      get: (candidate: WorkspaceOption, active: WorkspaceOption | undefined) =>
        `${candidate.id === active?.id ? '●' : ' '} ${candidate.name}`,
    },
  ],
} as const satisfies ListTable<WorkspaceOption, WorkspaceOption | undefined>;

/** Clamp a selection index into the candidate range (0 when there are none). */
const clamp = (selected: number, length: number): number => {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(selected), length - 1));
};

export class WorkspacePickerScreen extends AsyncModalScreen<WorkspaceOption[]> {
  static readonly route = {
    id: 'workspace.picker',
    path: '/workspace/switch',
    parent: 'projects',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = WorkspacePickerScreen.route.id;
  selectedIndex = 0;
  private lastMessage: string | undefined;

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  get candidates(): readonly WorkspaceOption[] {
    return this.readyValue ?? [];
  }

  get rows(): readonly WorkspaceOption[] {
    return this.candidates;
  }

  protected load(context: ScreenContext): Promise<WorkspaceOption[]> {
    const client = context.services?.client;
    if (!client) return Promise.resolve([]);
    return loadWorkspaces(client);
  }

  protected renderLoading(): string[] {
    return ['Loading workspaces…'];
  }

  private activeOf(context: ScreenContext): WorkspaceOption | undefined {
    const id = context.services?.workspaceId;
    if (!id) return undefined;
    return (
      this.candidates.find((c) => c.id === id) ??
      (context.services?.workspace
        ? { id, name: context.services.workspace }
        : undefined)
    );
  }

  protected renderReady(
    data: WorkspaceOption[],
    context: ScreenContext,
  ): VNode {
    return listTableTree(PICKER_TABLE, data, this.activeOf(context), {
      selectedIndex: clamp(this.selectedIndex, data.length),
    });
  }

  renderNonInteractive(context: ScreenContext): string[] {
    return [
      'Which workspace?',
      '',
      ...listTableRows(
        PICKER_TABLE,
        this.candidates,
        this.activeOf(context),
      ).map((line: SectionLine) => lineText(line)),
    ];
  }

  protected modalChrome(_context: ScreenContext): ModalChrome {
    return {
      selectable: this.candidates.length,
      selectedIndex: this.selectedIndex,
      rowIds: listRowIds(PICKER_TABLE, this.candidates),
      title: 'Which workspace?',
      meta: `${this.candidates.length} accessible workspace(s)`,
    };
  }

  protected override notice(_context: ScreenContext): string | undefined {
    return this.lastMessage;
  }

  protected override actions() {
    return [actionItem('picker-enter', 'Enter', 'switch')];
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input === 'j' || input === 'down')
      this.selectedIndex = Math.min(
        this.selectedIndex + 1,
        this.candidates.length - 1,
      );
    else if (input === 'k' || input === 'up')
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
    else if (input === 'enter')
      return this.activate(this.selectedIndex, context);
    else return false;
    context.requestDraw();
    return true;
  }

  activate(index: number, context: ScreenContext): boolean {
    const picked = this.candidates[index];
    if (!picked) return false;
    const active = this.activeOf(context);
    if (active?.id === picked.id) {
      this.lastMessage = `Already on ${picked.name}.`;
      context.requestDraw();
      return true;
    }
    void this.commit(picked, context);
    return true;
  }

  /** Write the selection, then restart — the two steps a manual edit and a
   *  cockpit switch share, ending in the SAME re-exec `bakers ui` took to boot. */
  private async commit(
    picked: WorkspaceOption,
    context: ScreenContext,
  ): Promise<void> {
    const selectWorkspace = context.services?.selectWorkspace;
    const restart = context.services?.restartProcess;
    if (!selectWorkspace || !restart) {
      this.lastMessage =
        'Cannot switch here: no project .bakers directory was resolved.';
      context.requestDraw();
      return;
    }
    try {
      await selectWorkspace(picked.name);
    } catch (error) {
      this.lastMessage = error instanceof Error ? error.message : String(error);
      context.requestDraw();
      return;
    }
    restart();
  }

  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.candidates.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }

  override reset(): void {
    this.selectedIndex = 0;
    this.lastMessage = undefined;
    super.reset();
  }
}
