// BB-540 — the My work PARENT-FILTER picker as a one-field modal screen over
// the BB-236 kernel, mirroring the BB-284 `ParentFilterScreen` but for the
// no-project case: the candidate read is NOT project-scoped (see
// `my-work-parent-source.ts`), so the screen requires NO project context.
// That is what makes this a separate screen rather than a route variant of
// `parent-filter-form.ts` — the source itself differs.

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
import { myWorkParentOptionSource } from '../Form/my-work-parent-source.js';
import {
  PARENT_FILTER_FORM,
  type ParentFilterOptions,
  type ParentFilterState,
} from '../Form/parent-filter.js';

export class MyWorkParentFilterScreen extends AsyncModalScreen<ParentFilterOptions> {
  readonly modal = true;
  static readonly route = {
    id: 'my.work.parent-filter',
    path: '/work/parent',
    parent: 'my.work',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = MyWorkParentFilterScreen.route.id;
  private form: ParentFilterState | undefined;
  private action: ScreenAction | undefined;
  private context: ScreenContext | undefined;
  private sources: OptionSources = {};
  private optionLoader: OptionLoader | undefined;

  get options(): ParentFilterOptions | undefined {
    return this.readyValue;
  }
  protected async load(context: ScreenContext): Promise<ParentFilterOptions> {
    this.context = context;
    // Unlike the project-scoped parent picker, this one does NOT require
    // `context.project` — the candidate read is not project-scoped.
    if (!context.services)
      throw new Error('My work parent filter requires services context');
    const sources: OptionSources = {
      parent: myWorkParentOptionSource(context.services.client),
    };
    this.sources = sources;
    // Primed with the EMPTY query — which the source's two-character gate
    // answers with an empty bag and NO client call (mirrors the project
    // picker's D6 of BB-299).
    const { bags, errors } = await primeSources(sources);
    return {
      ...(bags as Partial<ParentFilterOptions>),
      ...(Object.keys(errors).length > 0
        ? { errors: errors as ParentFilterOptions['errors'] }
        : {}),
    };
  }
  protected override didLoad(options: ParentFilterOptions): void {
    this.form = PARENT_FILTER_FORM.initial(options);
    this.optionLoader = createOptionLoader<ParentFilterOptions>({
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
    return ['Loading parents…'];
  }
  protected renderReady(options: ParentFilterOptions): VNode {
    if (!this.form) return columnNode(FIELDS_REGION);
    return renderDeclaredFieldsTree(
      PARENT_FILTER_FORM.fields,
      this.form,
      options,
      {
        width: 58,
        errorFor: (field) =>
          field.from === 'parents' && options.errors?.parents !== undefined
            ? `Parent options could not be loaded: ${options.errors.parents}`
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
    const field = PARENT_FILTER_FORM.activeField(this.form);
    const intent = keyToIntent(input, field, {
      query:
        field.query !== undefined
          ? String(
              (this.form as unknown as Record<string, unknown>)[field.query] ??
                '',
            )
          : undefined,
      fieldCount: PARENT_FILTER_FORM.fields.length,
    });
    if (!intent) return true;
    if (intent.kind === 'cancel') {
      if (context.back) context.back();
      else this.action = { type: 'back' };
    } else if (intent.kind === 'pick') {
      this.form = PARENT_FILTER_FORM.apply(this.form, options, intent);
      const parent = PARENT_FILTER_FORM.toObject(this.form, options);
      if (parent !== null) {
        if (context.back) context.back({ type: 'parent-filter-set', parent });
        else
          this.action = {
            type: 'back',
            result: { type: 'parent-filter-set', parent },
          };
      }
    } else if (intent.kind === 'clear') {
      this.form = PARENT_FILTER_FORM.apply(this.form, options, intent);
      const result = { type: 'parent-filter-set', parent: null };
      if (context.back) context.back(result);
      else this.action = { type: 'back', result };
    } else {
      this.form = PARENT_FILTER_FORM.apply(this.form, options, intent);
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
      title: '⚡ Filter by parent',
    };
  }

  protected override actions() {
    return [
      actionItem('parent-suggest', '↑↓/←→', 'suggestion'),
      actionItem('parent-pick', 'Enter', 'pick'),
      actionItem('parent-clear', 'Del', 'clear'),
      actionItem('parent-esc', 'Esc', 'cancel'),
    ];
  }
}
