// BB-540 — the project-filter picker as a one-field modal screen over the
// BB-236 kernel, mirroring the BB-299 `WhoFilterScreen`. The kernel's
// `autocomplete` kind and the `Widget/option-source.ts` driver supply the
// mechanics: type to filter, debounced server re-query, ←/→ to browse, Enter
// to pick, Esc to cancel.
//
// The picker's ONLY project read is `loadProjectCandidates`, composed as
// `projectOptionSource`. The two-character gate lives inside that source's
// `load()` (AC-3), so the prime at open issues NO query — the picker opens
// empty rather than pre-browsable.
//
// Unlike the parent picker, this screen requires NO project context: the
// candidate read is not project-scoped, so services are the only requirement.
// That is what makes this single screen serve both `project.tickets` (no
// route entry here — that one already has no My work analogue, and the
// project list is route-scoped anyway) and `my.work` (the entry the My work
// screen's bar dispatches to via `r`).

import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncModalScreen } from '../../../Screen/async-modal-screen.js';
import type { ModalChrome } from '../../../Screen/modal-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import {
  createOptionLoader,
  type OptionLoader,
  type OptionSources,
  primeSources,
} from '../../../Widget/option-source.js';
import {
  FIELDS_REGION,
  renderDeclaredFieldsTree,
} from '../../../Widget/render.js';
import { keyToIntent } from '../Form/keys.js';
import {
  PROJECT_FILTER_FORM,
  type ProjectFilterOptions,
  type ProjectFilterState,
} from '../Form/project-filter.js';
import { projectOptionSource } from '../Form/project-source.js';

export class ProjectFilterScreen extends AsyncModalScreen<ProjectFilterOptions> {
  readonly modal = true;
  static readonly route = {
    id: 'my.work.project-filter',
    path: '/work/project',
    parent: 'my.work',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = ProjectFilterScreen.route.id;
  private form: ProjectFilterState | undefined;
  private action: ScreenAction | undefined;
  private context: ScreenContext | undefined;
  private sources: OptionSources = {};
  private optionLoader: OptionLoader | undefined;

  get options(): ProjectFilterOptions | undefined {
    return this.readyValue;
  }
  protected async load(context: ScreenContext): Promise<ProjectFilterOptions> {
    this.context = context;
    // Projects are control-plane-wide (not project-scoped), so services are the
    // only requirement. The parent picker's `context.project` guard is not
    // reproduced here for that reason.
    if (!context.services)
      throw new Error('Project filter requires services context');
    const sources: OptionSources = {
      // The map is keyed by FIELD id (here `project` — declared on the form
      // field), not the source's own `bag`. The reload's lookup is the field
      // id. The `bag` field is what the option loader merges back into the
      // options object (`projects: outcome.options`).
      project: projectOptionSource(context.services.client),
    };
    this.sources = sources;
    // Primed with the EMPTY query — which the source's two-character gate
    // answers with an empty bag and NO client call (AC-3).
    const { bags, errors } = await primeSources(sources);
    return {
      ...(bags as Partial<ProjectFilterOptions>),
      ...(Object.keys(errors).length > 0
        ? { errors: errors as ProjectFilterOptions['errors'] }
        : {}),
    };
  }
  protected override didLoad(options: ProjectFilterOptions): void {
    this.form = PROJECT_FILTER_FORM.initial(options);
    this.optionLoader = createOptionLoader<ProjectFilterOptions>({
      sources: this.sources,
      ...(this.context?.options?.debounce
        ? { debounce: this.context.options.debounce }
        : {}),
      current: () => this.readyValue ?? null,
      onLoaded: (next) => {
        this.replaceReady(next);
        this.context?.requestDraw();
      },
    });
  }
  protected renderLoading(): string[] {
    return ['Loading projects…'];
  }
  protected renderReady(options: ProjectFilterOptions): VNode {
    if (!this.form) return columnNode(FIELDS_REGION);
    return renderDeclaredFieldsTree(
      PROJECT_FILTER_FORM.fields,
      this.form,
      options,
      {
        width: 58,
        errorFor: (field) =>
          field.from === 'projects' && options.errors?.projects !== undefined
            ? `Project options could not be loaded: ${options.errors.projects}`
            : undefined,
      },
    );
  }
  takeAction(): ScreenAction | undefined {
    const action = this.action;
    this.action = undefined;
    return action;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    const options = this.readyValue;
    if (!options || !this.form) return false;
    const field = PROJECT_FILTER_FORM.activeField(this.form);
    const intent = keyToIntent(input, field);
    if (!intent) return true;
    if (intent.kind === 'cancel') {
      if (context.back) context.back();
      else this.action = { type: 'back' };
    } else if (intent.kind === 'pick') {
      this.form = PROJECT_FILTER_FORM.apply(this.form, options, intent);
      const project = PROJECT_FILTER_FORM.toObject(this.form, options);
      if (project !== null) {
        if (context.back) context.back({ type: 'project-filter-set', project });
        else
          this.action = {
            type: 'back',
            result: { type: 'project-filter-set', project },
          };
      }
    } else if (intent.kind === 'clear') {
      // AC-3: clearing IS a commit — the null payload reaches the list, which
      // drops the project criterion and keeps the rest.
      this.form = PROJECT_FILTER_FORM.apply(this.form, options, intent);
      const result = { type: 'project-filter-set', project: null };
      if (context.back) context.back(result);
      else this.action = { type: 'back', result };
    } else {
      this.form = PROJECT_FILTER_FORM.apply(this.form, options, intent);
      if (
        field.query !== undefined &&
        (intent.kind === 'insert' || intent.kind === 'backspace')
      ) {
        const query = (this.form as unknown as Record<string, unknown>)[
          field.query
        ];
        this.optionLoader?.reload(
          field.id,
          typeof query === 'string' ? query : '',
        );
      }
    }
    context.requestDraw();
    return true;
  }
  override reset(): void {
    this.form = undefined;
    this.action = undefined;
    this.context = undefined;
    this.optionLoader?.cancel();
    this.optionLoader = undefined;
    this.sources = {};
    super.reset();
  }
  protected modalChrome(_context: ScreenContext): ModalChrome {
    return {
      title: '⚡ Filter by project',
    };
  }

  protected override actions() {
    return [
      actionItem('project-field', '↑↓', 'field'),
      actionItem('project-suggest', '←→', 'suggestion'),
      actionItem('project-pick', 'Enter', 'pick'),
      actionItem('project-clear', 'Del', 'clear'),
      actionItem('project-esc', 'Esc', 'cancel'),
    ];
  }
}
