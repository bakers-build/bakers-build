// BB-345 (re-entry) — `Agent/Component/agent-list/` is GONE, and the list it
// hand-rendered is the SIXTH `ListTable` configuration, declared here in its only
// consumer.
//
// It was the last per-entity list renderer in the tree, and it was missed when
// the scope was fixed at qualification for a structural reason worth recording:
// it entered this branch with the rebase onto the merged BB-340 tip, AFTER the
// four surfaces had been enumerated. All three of the ticket's findings were
// still live on this tab — no header emphasis at all, a fixed `LABEL_WIDTH = 32`
// that cut an ordinary agent label at every terminal width, and a selection
// highlight fragmented across the row because `selected` sat on each cell's
// content while the cells were unfilled.
//
// WHY THE CONFIGURATION LIVES IN THE SCREEN and not in a `Data/` module (spec
// D10): a configuration belongs beside its row mapper, and this list has none —
// its rows are the herdr host's live set (`context.services.agents.list(slug)`),
// a host-service value rather than a JSON:API resource, so the slice has no
// `Agent/Data/` for it to sit in. `PICKER_TABLE` is the precedent for exactly
// that case, and it sits in `Entity/project/Screen/project-picker.ts` for exactly
// this reason.

import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { ListCursor } from '../../../lib/cursor.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { HostedAgent } from '../../../types.js';
import { type ListTable, listRowIds, listTableTree } from '../../collection.js';

/**
 * The ticket agents list, declared once (BB-345 D2/D10).
 *
 * `noun: 'agent'` is KEPT rather than chosen afresh, and that is load-bearing:
 * `listTableTree` keys a row `<noun>-row-<id>` and a cell
 * `<noun>-cell-<id>-<column key>`, which is byte for byte what the deleted
 * renderer spelled by hand — so every row id the mouse resolves through and
 * every node `Kernel/mount.ts` patches by is unchanged. The two column keys are
 * `label` and `project` for the same reason. Only the container moves,
 * `agent-list` → `agent-table`, because the shared renderer keys it `<noun>-table`
 * for every list.
 *
 * `Ctx` is `void`: both columns read the row and nothing else. `fields` is
 * DESCRIPTIVE here, as on `PICKER_TABLE` — a `HostedAgent` is
 * `{ id, group, label }` off the herdr host, not a JSON:API resource, so there is
 * no sparse fieldset for it to derive and no `AssertExhaustive` proof to bind it
 * to. Declaring it anyway keeps that a fact about this list's source rather than
 * a hole in the column model.
 */
export const AGENT_TABLE = {
  noun: 'agent',
  emptyMessage: 'No ticket agents.',
  columns: [
    {
      /**
       * FREE TEXT, and therefore THE GROWER of this list — the operator's rule
       * applied to the surface the review found still breaking it.
       *
       * An agent's label is built from its ticket's own title (`Agent/launch.ts`'s
       * `shortName`), so it is exactly the value class the projects list's
       * PROJECT and the conductors list's NAME grow for. The old renderer fixed
       * it at 32 columns, which cut an ordinary label at 80, 120 and 160 alike
       * while the second column held the whole surplus in whitespace — finding 3
       * of this very ticket, reproduced on the Ticket-Agents tab.
       *
       * The 32 SURVIVES as the flex BASIS, not as a bound: it is what the column
       * starts from and what a terminal with nothing to share leaves it, so the
       * narrow case is unchanged and only the wide case improves.
       *
       * `grow: 1` — an EQUAL share with the trailing column, and not the `grow: 2`
       * that `CONDUCTOR_TABLE`'s NAME takes. That weighting was written first, on
       * the same "the identity column is read first" argument, and MEASURED
       * against it: at 80 columns a 2:1 split leaves PROJECT 16 columns and cuts
       * an ordinary 20-character project slug to `keytec-bakers-pla` while AGENT
       * holds 21 idle columns behind a 42-character label — a column cut while
       * the row still has columns to give, which is the defect AC 4 is about. The
       * conductors list can afford the weighting because seven budgeted columns
       * bound its second grower; this list has only two columns, so the whole
       * surplus lands on the ratio. Equal shares keep both values whole at 80,
       * 120 and 160.
       *
       * WHAT IS PAID, stated because it is a real narrowing of AC 5: a grower has
       * no declared width for `cellText` to mark its cut against, so a label long
       * enough to outgrow the whole terminal is cut SILENTLY where a fixed 32 cut
       * it with an `…`. The trade is the one the operator already took twice: a
       * cut only becomes necessary at absurd lengths once the column grows,
       * whereas the fixed 32 cut a perfectly ordinary label every time.
       *
       * No `min`, for the reason the ticket list's TITLE and the conductors
       * list's PROJECT both give: without one the cell keeps `flexShrink: 0` and
       * a floor the row cannot meet pushes it past the right edge.
       */
      key: 'label',
      label: 'AGENT',
      width: 32,
      grow: 1,
      fields: ['label', 'id'],
      get: (row: HostedAgent) => row.label || row.id,
    },
    {
      /**
       * The project the agent runs for — the TRAILING column, and a grower too.
       *
       * It carries a project slug, which is free text like the column before it,
       * so the same rule applies. Budgeting it instead would need a domain
       * constant nobody can name: a `bb_project` slug has no declared maximum,
       * and inventing one is precisely the fixed budget this ticket exists to
       * remove.
       *
       * IT IS DECLARED EXACTLY AS IT WAS before this ticket — `width: 0` and
       * nothing else, which `textNode` reads as `flexGrow: 1`. So the whole of
       * the change on this list is one `grow: 1` on the column beside it, and the
       * two columns end up sharing the surplus equally (see the measurement
       * argued there).
       */
      key: 'project',
      label: 'PROJECT',
      width: 0,
      fields: ['group'],
      get: (row: HostedAgent) => row.group,
    },
  ],
} as const satisfies ListTable<HostedAgent, void>;

export class TicketAgentsScreen extends AsyncScreen<HostedAgent[]> {
  readonly frameId = 'ticket-agents';
  reload(context: ScreenContext): void {
    this.retry(context);
  }
  commandForInput(input: string): string | undefined {
    return input === 'r' ? 'retry-selected-agent' : undefined;
  }
  static readonly route = {
    id: 'project.ticket-agents',
    path: '/projects/:projectId/agents',
    parent: 'project.overview',
    tab: {
      id: 'ticket-agents',
      label: 'Ticket-Agents',
      scope: 'project',
      weight: 30,
    },
  } satisfies RouteMetadata;
  readonly id = TicketAgentsScreen.route.id;
  private readonly cursor = new ListCursor();
  /** Kept as a settable PUBLIC member: the kernel reads it and the `x` branch
   *  below writes it (BB-294 D2). */
  get selectedIndex(): number {
    return this.cursor.index;
  }
  set selectedIndex(value: number) {
    this.cursor.index = value;
  }
  private status = '';
  get rows(): readonly HostedAgent[] {
    return this.readyValue ?? [];
  }
  saveState(): { selectedAgentId: string | null } {
    return { selectedAgentId: this.rows[this.selectedIndex]?.id ?? null };
  }
  restoreState(token: unknown): void {
    const id =
      token && typeof token === 'object'
        ? (token as { selectedAgentId?: unknown }).selectedAgentId
        : null;
    if (typeof id !== 'string') return;
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.selectedIndex = index;
  }
  protected load(context: ScreenContext): Promise<HostedAgent[]> {
    if (!context.project)
      throw new Error('Ticket agents requires project context');
    return (
      context.services?.agents?.list(context.project.slug) ??
      Promise.resolve([])
    );
  }
  protected renderLoading(): string[] {
    return ['Loading ticket agents…'];
  }
  protected renderReady(rows: HostedAgent[]): VNode {
    return listTableTree(AGENT_TABLE, rows, undefined, {
      selectedIndex: this.selectedIndex,
    });
  }
  protected chrome(_context: ScreenContext): FullScreenChrome {
    const rows = this.rows;
    return {
      selectable: rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: listRowIds(AGENT_TABLE, rows),
      title: 'Ticket-Agents',
      meta: `${rows.length} agent(s)`,
    };
  }

  protected actions() {
    return [
      actionItem('agents-enter', 'Enter', 'switch'),
      actionItem('agents-tab', 'Tab', 'tabs'),
    ];
  }

  protected notice(): string | undefined {
    return this.status || undefined;
  }
  focus(index: number, context: ScreenContext): boolean {
    const row = this.readyValue?.[index];
    if (!row || !context.services?.agents) return false;
    void context.services.agents.focus(row.id).then(() => {
      this.status = `switched to ${row.label || row.id}`;
      context.requestDraw();
    });
    return true;
  }
  activate(index: number, context: ScreenContext): boolean {
    return this.focus(index, context);
  }
  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.rows.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    const rows = this.readyValue;
    if (!rows) return false;
    if (this.cursor.handle(input, rows.length)) {
      context.requestDraw();
      return true;
    }
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    if (input === 'h' || input === 'z') {
      if (!context.project || !context.services?.agents) return false;
      void context.services.agents.hide(context.project.slug);
    } else if (input === 'x') {
      const selected = rows[this.selectedIndex];
      if (!selected || !context.services?.agents) return false;
      void context.services.agents.kill(selected.id);
      const remaining = rows.filter((row) => row.id !== selected.id);
      this.replaceReady(remaining);
      this.selectedIndex = Math.min(
        this.selectedIndex,
        Math.max(0, remaining.length - 1),
      );
    } else return false;
    context.requestDraw();
    return true;
  }
  override reset(): void {
    this.cursor.reset();
    this.status = '';
    super.reset();
  }
}
