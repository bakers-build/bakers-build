// BB-223 AC-8 (spec Decision 14) — the picker `bakers ui --here` shows when the
// cwd's repo is claimed by MORE THAN ONE bakers project.
//
// One repo mapping to several projects is designed for, not an edge case:
// BB-126/137 let `.bakers/` hold one conductor config per project, which is how
// a Drupal multisite repo maps each site to its own bakers.build project. Erroring on
// N>1 would fail permanently, by design, in exactly the repos the feature is
// most useful in — so the ambiguity is shown rather than resolved behind the
// user's back.
//
// BB-345 D8 — `Component/project-picker/` is GONE and its two survivors live
// here, in their only consumer: the candidate type and the one-column table the
// two surfaces are both made of.

import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import {
  lineText,
  type SectionLine,
} from '../../../Component/section-list/index.js';
import { defineContext } from '../../../Routing/context.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  type ListTable,
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../collection.js';

/**
 * A project that claims the repo.
 *
 * `id` is what every node of its row is keyed on, which is what lets the
 * picker's rows go through the shared table at all: `ListTable` reads row
 * identity as `rowNodeId(noun, row.id)` for every list.
 */
export interface PickerCandidate {
  id: string;
  name: string;
}

/**
 * The picker as a configuration (BB-345 D8) — one column, and NO HEADER.
 *
 * The header is declared away, and that is an operator decision taken against
 * the direction that every other list gets one (D6): this is a question with
 * choices rather than a table of records, and its single column has an empty
 * label — so a header would paint an empty bold bar above the question.
 *
 * The `▸` stays in the cell's TEXT rather than becoming an attribute. It is
 * what says "selected" to the pipe, which has no attributes to carry a
 * highlight; the tree carries BOTH, the marker in the text and the inverse on
 * the node, exactly as it did before this ticket.
 *
 * `Ctx` is the selected CANDIDATE rather than its index, because the column
 * receives the row and not its position — the same reason row identity is the
 * entity's uuid. The screen resolves it once per frame, clamped.
 */
const PICKER_TABLE = {
  noun: 'project-picker',
  header: false,
  emptyMessage: 'No projects.',
  columns: [
    {
      key: 'name',
      label: '',
      width: 0,
      fields: ['name'],
      get: (
        candidate: PickerCandidate,
        selected: PickerCandidate | undefined,
      ) => `${candidate === selected ? '▸' : ' '} ${candidate.name}`,
    },
  ],
} as const satisfies ListTable<PickerCandidate, PickerCandidate | undefined>;

export interface ProjectPickerInput {
  readonly candidates: readonly PickerCandidate[];
  readonly repo: string;
}

export const projectPickerInputContext = defineContext<ProjectPickerInput>(
  'project-picker-input',
  'input',
);

/** Clamp a selection index into the candidate range (0 when there are none). */
const clamp = (selected: number, length: number): number => {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(selected), length - 1));
};

/**
 * Project picker — normal {@link AsyncScreen}. Candidates arrive via navigation
 * context; refresh is the shared R / ui-refresh path.
 */
export class ProjectPickerScreen extends AsyncScreen<ProjectPickerInput> {
  readonly frameId = 'project-picker';
  static readonly route = {
    id: 'project.picker',
    path: '/projects/pick',
    parent: 'projects',
    activeTab: { scope: 'root', id: 'projects' },
    fallback: { routeId: 'my.work' },
    context: (_params, state, base) =>
      state
        ? base.set(projectPickerInputContext, state as ProjectPickerInput)
        : base,
  } satisfies RouteMetadata;
  readonly id = ProjectPickerScreen.route.id;
  selectedIndex = 0;

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  get candidates(): readonly PickerCandidate[] {
    return this.readyValue?.candidates ?? [];
  }

  get repo(): string {
    return this.readyValue?.repo ?? '';
  }

  get rows(): readonly PickerCandidate[] {
    return this.candidates;
  }

  protected load(context: ScreenContext): Promise<ProjectPickerInput> {
    if (context.contexts?.has(projectPickerInputContext)) {
      const input = context.contexts.get(projectPickerInputContext);
      return Promise.resolve({
        candidates: [...input.candidates],
        repo: input.repo,
      });
    }
    return Promise.resolve({ candidates: [], repo: '' });
  }

  protected renderLoading(): string[] {
    return ['Loading projects…'];
  }

  /**
   * The question this screen asks, and the one place it is written.
   *
   * Both surfaces open with it — the tree via meta, the pipe as its first line —
   * so composing it twice is how the two would come to disagree about the repo.
   */
  private headingText(): string {
    return `Several bakers projects claim ${this.repo} — which one?`;
  }

  private selected(): PickerCandidate | undefined {
    return this.candidates[clamp(this.selectedIndex, this.candidates.length)];
  }

  protected renderReady(data: ProjectPickerInput): VNode {
    return listTableTree(PICKER_TABLE, data.candidates, this.selected(), {
      selectedIndex: clamp(this.selectedIndex, data.candidates.length),
    });
  }

  /**
   * F5 — the pipe's own output, and it stays `string[]`.
   *
   * BB-345 D7/D8 — built from the SAME configuration the tree is.
   */
  renderNonInteractive(): string[] {
    return [
      this.headingText(),
      '',
      ...listTableRows(PICKER_TABLE, this.candidates, this.selected()).map(
        (line: SectionLine) => lineText(line),
      ),
      '',
      'Run bakers ui project:<name> to choose directly.',
    ];
  }

  protected chrome(_context: ScreenContext): FullScreenChrome {
    return {
      selectable: this.candidates.length,
      selectedIndex: this.selectedIndex,
      rowIds: listRowIds(PICKER_TABLE, this.candidates),
      title: 'Which project?',
      meta: `${this.candidates.length} project(s) claim ${this.repo} · ${this.headingText()}`,
    };
  }

  protected actions() {
    return [actionItem('picker-enter', 'Enter', 'open')];
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
    if (!picked || !context.navigate) return false;
    context.navigate('project.overview', {
      projectId: picked.id,
      projectName: picked.name,
      projectSlug: picked.name,
    });
    return true;
  }

  select(index: number, context: ScreenContext): boolean {
    if (index < 0 || index >= this.candidates.length) return false;
    this.selectedIndex = index;
    context.requestDraw();
    return true;
  }

  override reset(): void {
    this.selectedIndex = 0;
    super.reset();
  }
}
