// BB-284 D4 — the parent-filter picker as a one-field modal screen over the
// BB-236 kernel. The kernel's `autocomplete` kind and the
// `Widget/option-source.ts` driver supply the mechanics: type to filter,
// debounced server re-query, ←/→ to browse, Enter to pick, Esc to cancel.
//
// AC-4: the picker's ONLY ticket read is `loadParentCandidates`, composed as
// `parentOptionSource` (D5) — the same source the create form's Parent field
// loads through, never a second lookup. The source builds its query with
// `parent: null` criteria (F7), so an active parent filter can never narrow
// the picker to that parent's own children.

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
  PARENT_FILTER_FORM,
  type ParentFilterOptions,
  type ParentFilterState,
} from '../Form/parent-filter.js';
import { parentOptionSource } from '../Form/parent-source.js';

export class ParentFilterScreen extends AsyncModalScreen<ParentFilterOptions> {
  readonly modal = true;
  static readonly route = {
    id: 'project.tickets.parent-filter',
    path: '/projects/:projectId/tickets/parent',
    parent: 'project.tickets',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = ParentFilterScreen.route.id;
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
    // The route only exists under a project's ticket list, so both are
    // required — there is no meaningful parent picker without a project.
    if (!context.services || !context.project)
      throw new Error('Parent filter requires services and project context');
    const sources: OptionSources = {
      // 'identifier': this picker filters a list the operator scans by
      // identifier — title matching is deliberately off here (PM steer),
      // while the create form keeps the default identifier+title search.
      parent: parentOptionSource(
        context.services.client,
        context.project.id,
        'identifier',
      ),
    };
    this.sources = sources;
    // Primed with the EMPTY query, so ←/→ browses the project's most recently
    // changed tickets before a single character is typed (BB-257 D7).
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
      // Absent unless the caller injected one: `createOptionLoader` owns the
      // timer default (`timerDebounce`).
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
  /**
   * BB-340 D1/D3 — the one declared field, as the tree the widget layer builds.
   *
   * MOUNTED WHOLE, and the bound is the FIELD's rather than the project's: an
   * autocomplete draws its query row plus the suggestion window its own kind
   * caps — the `+N more — narrow the search` row exists because that cap is real
   * — so this body is a fixed handful of nodes however many tickets the project
   * holds, three orders of magnitude under `@opentui/core@0.5.1`'s ceiling of
   * 16 382 renderables.
   *
   * The insertion point is a `FieldTextarea` NODE inside that tree, so this
   * screen publishes no `caret` coordinate any more. What the caret's row had to
   * be rebased ONTO — first the widget's rows, then the `flatMap`ped surface,
   * then the composed box — is a chain of translations the node does not need:
   * it sits in the layout where the widget put it.
   */
  protected renderReady(options: ParentFilterOptions): VNode {
    // Ready without a form is unreachable — `didLoad` builds one the moment the
    // state becomes ready — and it shows nothing when it happens, exactly as the
    // empty row surface did. Rooted at the SAME id so a frame that did hit it
    // would patch the standing tree rather than build a second one beside it.
    if (!this.form) return columnNode(FIELDS_REGION);
    // The suggestion window, the caret and the page-cap disclosure are the
    // autocomplete KIND's to draw, not this screen's.
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
    // BB-300 — the key's meaning here depends on the typed query (Backspace
    // clears only an empty one, D2) and on this being a ONE-field form (↑/↓
    // browse suggestions instead of moving fields, D3).
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
      // Esc: a plain back with NO result — the criteria stay as they were.
      if (context.back) context.back();
      else this.action = { type: 'back' };
    } else if (intent.kind === 'pick') {
      // Enter on the one field: apply the pick, then commit. The payload is
      // null when nothing under the cursor is pickable — then there is nothing
      // to commit and the picker stays open (a dead identifier is
      // unexpressible, spec question 1).
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
      // BB-300 D2 — clearing IS a commit: the null payload reaches the list,
      // which drops the parent criterion and keeps the rest (AC-3).
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
  protected modalChrome(context: ScreenContext): ModalChrome {
    return {
      title: '⚡ Filter by parent',
      meta: context.project?.name ?? context.project?.slug ?? '',
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
