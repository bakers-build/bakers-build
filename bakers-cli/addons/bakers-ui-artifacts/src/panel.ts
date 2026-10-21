import {
  type ActionItem,
  AsyncScreen,
  actionItem,
  firstLineSummary,
  flattenSections,
  handleTicketCopy,
  plainLine,
  type RouteMetadata,
  readTicket,
  type ScreenAction,
  type ScreenContext,
  type Section,
  saveTicket,
  type TicketDetailDocument,
  tabViewTree,
  ticketCopyActions,
  ticketEditAction,
  ticketHeaderTree,
  ticketInputContext,
  ticketTitleOf,
  watchTicket,
} from '@bakers-build/addon-bakers-ui/ui';
import { artifactRoots, artifactSections } from './tree.js';

/** How many lines of one artifact an expanded entry shows (spec D9). */
const HEAD_LINES = 200;

const attribute = (doc: unknown, name: string): string => {
  const value = (
    doc as { data?: { attributes?: Record<string, unknown> } } | undefined
  )?.data?.attributes?.[name];
  return typeof value === 'string' ? value : '';
};

export class ArtifactsTabScreen extends AsyncScreen<TicketDetailDocument> {
  static readonly route: RouteMetadata = {
    id: 'ticket.artifacts',
    path: '/tickets/:ticketId/artifacts',
    parent: 'project.tickets',
    tab: { id: 'artifacts', label: 'Artifacts', scope: 'ticket', weight: 50 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = 'ticket.artifacts';
  readonly frameId = 'ticket';
  private selectedEntry = 0;
  private expanded = new Set<number>();
  private status = '';
  private releaseStore: (() => void) | undefined;
  protected load(context: ScreenContext): Promise<TicketDetailDocument> {
    return Promise.resolve(readTicket(context));
  }
  override enter(context: ScreenContext): void {
    this.releaseStore?.();
    super.enter(context);
    if (this.state === 'ready')
      this.replaceReady(readTicket(context, this.readyValue));
    this.releaseStore = watchTicket(context, (document) => {
      if (this.state === 'ready') this.replaceReady(document);
      context.requestDraw();
    });
  }
  override leave(): void {
    this.releaseStore?.();
    this.releaseStore = undefined;
    super.leave();
  }
  reload(context: ScreenContext): void {
    this.retry(context);
  }
  protected renderLoading() {
    return ['Loading artifacts…'];
  }
  private sections(
    context: ScreenContext,
  ): readonly (Section & { expandable?: boolean })[] {
    const doc = this.readyValue;
    const ctx = { cwd: context.options?.cwd };
    const identifier = attribute(doc, 'identifier');
    if (ctx.cwd === undefined || identifier === '') {
      return [
        {
          heading: 'Artifacts',
          lines: [
            'This cockpit has no checkout to read artifacts from.',
            'Artifacts are transient and local (BB-371 D1/D10).',
          ],
        },
      ];
    }
    const roots = artifactRoots(
      ctx.cwd,
      identifier,
      attribute(doc, 'branch_name'),
    );
    const sections = artifactSections(roots, { headLines: HEAD_LINES });
    // The empty state NAMES BOTH PROBED PATHS. BB-371 D10 is a real hole —
    // on another machine the worktree is gone — and naming the paths is what
    // turns a blank tab into a diagnosis.
    return sections.length > 0
      ? sections
      : [
          {
            heading: 'Artifacts',
            lines: [
              'No artifacts in this checkout. Probed:',
              ...roots.map((root) => `  ${root}`),
              '',
              'Artifacts die with the worktree (BB-371 D1/D10).',
            ],
          },
        ];
  }
  private view(context: ScreenContext) {
    return tabViewTree(this.readyValue, -1, {
      panelSections: this.sections(context),
      expanded: this.expanded,
      selectedIndex: this.selectedEntry,
    });
  }
  protected renderReady(
    _document: TicketDetailDocument,
    context: ScreenContext,
  ) {
    return this.view(context).body;
  }
  protected chrome(context: ScreenContext) {
    const document = this.readyValue;
    const { identifier, title } = ticketTitleOf(document ?? {});
    const view = this.view(context);
    return {
      title: document?.data
        ? `${identifier} · ${title}`
        : (context.params?.ticketId ?? 'ticket'),
      ...(document?.data
        ? { header: ticketHeaderTree(document, identifier, title, []) }
        : {}),
      selectable: view.selectable,
      selectedIndex: this.selectedEntry,
      rowIds: view.rowIds,
      cursorMode:
        view.selectable > 1 ? ('select' as const) : ('scroll' as const),
    };
  }
  protected actions(context: ScreenContext): readonly ActionItem[] {
    const count = this.view(context).selectable;
    return [
      actionItem('detail-tab', 'Tab', 'section'),
      actionItem('detail-edit', 'e', 'edit'),
      ...ticketCopyActions(),
      actionItem('detail-arrows', '↑↓', count > 1 ? 'select' : 'scroll'),
      ...(count > 0
        ? [actionItem('detail-enter', 'Enter/Space', 'expand')]
        : []),
    ];
  }
  protected override notice() {
    return this.status || undefined;
  }
  select(index: number, context: ScreenContext): boolean {
    const next = Math.max(
      0,
      Math.min(index, this.view(context).selectable - 1),
    );
    if (next === this.selectedEntry) return false;
    this.selectedEntry = next;
    context.requestDraw();
    return true;
  }
  activate(index: number, context: ScreenContext): boolean {
    if (!this.view(context).selectable) return false;
    if (this.expanded.has(index)) this.expanded.delete(index);
    else this.expanded.add(index);
    context.requestDraw();
    return true;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (this.state !== 'ready') return false;
    if (input === 'y' || input === 'Y') {
      this.status = handleTicketCopy(input, context, this.readyValue) ?? '';
      context.requestDraw();
      return true;
    }
    if (input === 'enter' || input === ' ')
      return this.activate(this.selectedEntry, context);
    const count = this.view(context).selectable;
    if (count > 1) {
      if (input === 'down' || input === 'j')
        return this.select(this.selectedEntry + 1, context);
      if (input === 'up' || input === 'k')
        return this.select(this.selectedEntry - 1, context);
      if (input === 'g') return this.select(0, context);
      if (input === 'G') return this.select(count - 1, context);
    }
    return false;
  }
  commandForInput(input: string) {
    return this.state === 'ready' && input === 'e'
      ? 'edit-assignment'
      : undefined;
  }
  actionForInput(
    input: string,
    context: ScreenContext,
  ): ScreenAction | undefined {
    return this.commandForInput(input)
      ? ticketEditAction(context, this.readyValue)
      : undefined;
  }
  receiveResult(result: unknown, context: ScreenContext) {
    const returned = result as {
      type?: string;
      document?: TicketDetailDocument;
    };
    if (returned?.type === 'ticket-assignment-updated' && returned.document) {
      this.replaceReady(saveTicket(context, returned.document));
      context.requestDraw();
    }
  }
  renderNonInteractive(context: ScreenContext) {
    return flattenSections(
      this.sections(context).map((section) => ({
        ...section,
        lines: section.expandable
          ? firstLineSummary(
              section.lines.map((line) => plainLine(String(line))),
            ).map((line) => line.text)
          : [...section.lines],
      })),
    ).lines;
  }
  override reset() {
    this.releaseStore?.();
    this.releaseStore = undefined;
    super.reset();
    this.selectedEntry = 0;
    this.expanded = new Set();
    this.status = '';
  }
}
