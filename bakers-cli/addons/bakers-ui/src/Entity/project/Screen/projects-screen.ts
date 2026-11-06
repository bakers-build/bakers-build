import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { ListCursor } from '../../../lib/cursor.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import { listRowIds, listTableTree } from '../../collection.js';
import {
  loadProjectRows,
  PROJECT_TABLE,
  type ProjectRow,
} from '../Data/projects.js';
import { ProjectOverviewScreen } from './project-overview.js';

/**
 * BB-340 D1 — the ready page is a renderable TREE; `loading` and `error` are
 * still three lines of text and stay rows (see `AsyncScreen`'s `Surface`).
 *
 * MOUNTED WHOLE, so the bound on its nodes is the data's own length against
 * `@opentui/core@0.5.1`'s ceiling of 16 382 renderables. A project row is one
 * box of 3 cells, and the rows are the user's own projects read from the
 * `bb_conductor` collection page by page, grouped by project — three orders of
 * magnitude of headroom on any control plane a person works with. This screen
 * therefore windows nothing of its own, deliberately rather than by omission.
 */
export class ProjectsScreen extends AsyncScreen<ProjectRow[]> {
  readonly frameId = 'projects';
  reload(context: ScreenContext): void {
    this.retry(context);
  }
  static readonly route = {
    id: 'projects',
    path: '/projects',
    tab: { id: 'projects', label: 'Projects', scope: 'root', weight: 20 },
  } satisfies RouteMetadata;
  readonly id = ProjectsScreen.route.id;
  private readonly cursor = new ListCursor();
  /** Kept as a settable PUBLIC member: the kernel reads it and
   *  `tests/Screen/project-screens.test.ts` writes it (BB-294 D2). */
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
  get rows(): readonly ProjectRow[] {
    return this.readyValue ?? [];
  }
  protected load(context: ScreenContext): Promise<ProjectRow[]> {
    if (!context.services) throw new Error('Projects requires services');
    return loadProjectRows({
      client: context.services.client,
      nowSeconds: context.nowSeconds ?? (() => Math.floor(Date.now() / 1000)),
    });
  }
  protected renderLoading(): string[] {
    return ['Loading projects…'];
  }
  protected renderReady(rows: ProjectRow[]): VNode {
    // BB-345 AC 1 — the one table, configured. There is no `project-list`
    // component any more: the columns, the noun and the empty message are
    // `PROJECT_TABLE`, declared beside the row mapper that produces the rows.
    return listTableTree(PROJECT_TABLE, rows, undefined, {
      selectedIndex: this.selectedIndex,
    });
  }
  protected chrome(context: ScreenContext): FullScreenChrome {
    const rows = this.rows;
    return {
      selectable: rows.length,
      selectedIndex: this.selectedIndex,
      // Click targets match listTableTree row ids (BB-345 D2).
      rowIds: listRowIds(PROJECT_TABLE, rows),
      title: 'bakers.build projects',
      meta: `${rows.length} registered project(s)  ·  ${context.services?.baseUrl ?? ''}`,
    };
  }

  protected actions() {
    return [actionItem('projects-tab', 'Tab', 'tabs')];
  }
  activate(index: number, context: ScreenContext): boolean {
    const row = this.readyValue?.[index];
    if (!row || !context.navigate) return false;
    context.navigate(ProjectOverviewScreen.route.id, {
      projectId: row.id,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
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
    const rows = this.readyValue;
    if (!rows) return false;
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
