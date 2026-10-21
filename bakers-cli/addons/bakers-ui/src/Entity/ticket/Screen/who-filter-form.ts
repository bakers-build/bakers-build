// BB-299 D5 — the who-filter picker as a one-field modal screen over the
// BB-236 kernel, mirroring the BB-284 `ParentFilterScreen`. The kernel's
// `autocomplete` kind and the `Widget/option-source.ts` driver supply the
// mechanics: type to filter, debounced server re-query, ←/→ to browse, Enter
// to pick, Esc to cancel.
//
// The picker's ONLY user read is `loadWhoCandidates`, composed as
// `whoOptionSource` (D5). The two-character gate lives inside that source's
// `load()` (D6), so the prime at open issues NO query — the picker opens
// empty rather than pre-browsable (AC-5).

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
  WHO_FILTER_FORM,
  type WhoFilterOptions,
  type WhoFilterState,
  type WhoFilterTarget,
} from '../Form/who-filter.js';
import { whoOptionSource } from '../Form/who-source.js';

export class WhoFilterScreen extends AsyncModalScreen<WhoFilterOptions> {
  readonly modal = true;
  static readonly route = {
    id: 'project.tickets.who-filter',
    path: '/projects/:projectId/tickets/who',
    parent: 'project.tickets',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = WhoFilterScreen.route.id;
  private form: WhoFilterState | undefined;
  private action: ScreenAction | undefined;
  private context: ScreenContext | undefined;
  private sources: OptionSources = {};
  private optionLoader: OptionLoader | undefined;

  get options(): WhoFilterOptions | undefined {
    return this.readyValue;
  }
  /**
   * BB-416 — which criterion this open sets, read from the route params so
   * the SAME screen serves both. Absent (every caller before this filter
   * existed) or anything but `'owner'` means `'assignee'` — the one path this
   * change must not move (D4 in the task brief).
   */
  private target(): WhoFilterTarget {
    return this.context?.params?.filterTarget === 'owner'
      ? 'owner'
      : 'assignee';
  }
  protected async load(context: ScreenContext): Promise<WhoFilterOptions> {
    this.context = context;
    // Unlike the parent picker the candidate read is not project-scoped (users
    // are control-plane-wide), so services are the only requirement.
    if (!context.services)
      throw new Error('Who filter requires services context');
    const sources: OptionSources = {
      who: whoOptionSource(context.services.client),
    };
    this.sources = sources;
    // Primed with the EMPTY query — which the source's two-character gate
    // answers with an empty bag and NO client call (D6).
    const { bags, errors } = await primeSources(sources);
    return {
      ...(bags as Partial<WhoFilterOptions>),
      ...(Object.keys(errors).length > 0
        ? { errors: errors as WhoFilterOptions['errors'] }
        : {}),
    };
  }
  protected override didLoad(options: WhoFilterOptions): void {
    this.form = WHO_FILTER_FORM.initial(options);
    this.optionLoader = createOptionLoader<WhoFilterOptions>({
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
    return ['Loading users…'];
  }
  /**
   * BB-340 D1/D3 — the one declared field, as the tree the widget layer builds.
   *
   * MOUNTED WHOLE, and the bound is the FIELD's rather than the document's: an
   * autocomplete draws its query row plus the suggestion window its own kind
   * caps, so this body is a fixed handful of nodes whatever the control plane
   * returns — three orders of magnitude under `@opentui/core@0.5.1`'s ceiling of
   * 16 382 renderables.
   *
   * The insertion point is a `FieldTextarea` NODE inside that tree, so this
   * screen publishes no `caret` coordinate any more: there is no row surface for
   * one to index, and nothing left for the modal caret slot to place.
   */
  protected renderReady(options: WhoFilterOptions): VNode {
    // Ready without a form is unreachable — `didLoad` builds one the moment the
    // state becomes ready — and it shows nothing when it happens, exactly as the
    // empty row surface did. Rooted at the SAME id so a frame that did hit it
    // would patch the standing tree rather than build a second one beside it.
    if (!this.form) return columnNode(FIELDS_REGION);
    // The suggestion window, the caret and the page-cap disclosure are the
    // autocomplete KIND's to draw, not this screen's.
    return renderDeclaredFieldsTree(
      WHO_FILTER_FORM.fields,
      this.form,
      options,
      {
        width: 58,
        errorFor: (field) =>
          field.from === 'who' && options.errors?.who !== undefined
            ? `Who options could not be loaded: ${options.errors.who}`
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
    const field = WHO_FILTER_FORM.activeField(this.form);
    const intent = keyToIntent(input, field);
    if (!intent) return true;
    if (intent.kind === 'cancel') {
      // Esc: a plain back with NO result — the criteria stay as they were.
      if (context.back) context.back();
      else this.action = { type: 'back' };
    } else if (intent.kind === 'pick') {
      // Enter on the one field: apply the pick, then commit. The payload is
      // null when nothing under the cursor is pickable — then there is nothing
      // to commit and the picker stays open (a dead name is unexpressible,
      // spec question 2).
      this.form = WHO_FILTER_FORM.apply(this.form, options, intent);
      const who = WHO_FILTER_FORM.toObject(this.form, options);
      if (who !== null) {
        // BB-416 — only the emitted result's type branches on the target;
        // the assignee path keeps emitting exactly `{ type: 'who-filter-set',
        // who }`, unconditionally, for every caller that names no target.
        const result =
          this.target() === 'owner'
            ? { type: 'owner-filter-set' as const, who }
            : { type: 'who-filter-set' as const, who };
        if (context.back) context.back(result);
        else this.action = { type: 'back', result };
      }
    } else {
      this.form = WHO_FILTER_FORM.apply(this.form, options, intent);
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
      title:
        this.target() === 'owner' ? '⚡ Filter by owner' : '⚡ Filter by who',
      meta: context.project?.name ?? context.project?.slug ?? '',
    };
  }

  protected override actions() {
    return [
      actionItem('who-field', '↑↓', 'field'),
      actionItem('who-suggest', '←→', 'suggestion'),
      actionItem('who-pick', 'Enter', 'pick'),
      actionItem('who-esc', 'Esc', 'cancel'),
    ];
  }
}
