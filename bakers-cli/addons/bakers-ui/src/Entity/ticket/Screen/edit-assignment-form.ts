import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { serverMessage } from '../../../lib/jsonapi-error.js';
import { columnNode } from '../../../lib/vnode.js';
import { defineContext } from '../../../Routing/context.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncModalScreen } from '../../../Screen/async-modal-screen.js';
import type { ModalChrome } from '../../../Screen/modal-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import {
  createOptionLoader,
  type OptionLoader,
  type OptionSources,
} from '../../../Widget/option-source.js';
import { OwnerIdentity } from '../../conductor/Data/own-rows.js';
import { activeRunInfo } from '../../run/Data/active-run.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  EDIT_FORM_REGION,
  editFormTree,
} from '../Component/edit-form/index.js';
import { loadTicketDetail } from '../Data/detail.js';
import type { FieldDef } from '../Form/edit.js';
import {
  CANCEL_TICKET_ACTION_ID,
  cancelEditPayload,
  EDIT_FORM_CLOSED,
  type EditFieldId,
  type EditFormDeclaration,
  type EditFormOptions,
  type EditFormState,
  EMPTY_EDIT_FORM_OPTIONS,
  editFormFor,
  initialEditForm,
  serializeEdit,
} from '../Form/edit.js';
import { loadEditFormOptions } from '../Form/edit-data.js';
import { editParentOptionSource } from '../Form/edit-parent-source.js';
import { keyToIntent } from '../Form/keys.js';
import { withSelectedReviewers } from '../Form/reviewer-options.js';

interface EditAssignmentData {
  document: TicketDetailDocument;
  options: EditFormOptions;
}

interface EditAssignmentInput {
  readonly document: TicketDetailDocument;
}

export const editAssignmentInputContext = defineContext<EditAssignmentInput>(
  'edit-assignment-input',
  'input',
);

const relationshipId = (
  document: TicketDetailDocument,
  name: string,
): string | undefined => {
  const data = document.data?.relationships?.[name]?.data;
  if (!data) return undefined;
  return Array.isArray(data) ? data[0]?.id : data.id;
};

const reviewerIds = (document: TicketDetailDocument): string[] => {
  const data = document.data?.relationships?.reviewers?.data;
  if (!data) return [];
  return (Array.isArray(data) ? data : [data])
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));
};

const includedUserLabels = (
  document: TicketDetailDocument,
): Map<string, string> => {
  const labels = new Map<string, string>();
  for (const row of document.included ?? []) {
    if (row.type !== 'user--user' || !row.id) continue;
    const attrs = row.attributes ?? {};
    const label =
      (typeof attrs.display_name === 'string' && attrs.display_name) ||
      (typeof attrs.name === 'string' && attrs.name) ||
      row.id;
    labels.set(row.id, label);
  }
  return labels;
};

export class EditAssignmentFormScreen extends AsyncModalScreen<EditAssignmentData> {
  static result(ticketId: string, assigneeId: string) {
    return { type: 'ticket-assignment-updated' as const, ticketId, assigneeId };
  }
  readonly modal = true;
  static readonly route = {
    id: 'ticket.assignment.edit',
    path: '/tickets/:ticketId/assignment',
    parent: 'ticket.detail',
    presentation: 'modal',
    context: (_params, state, base) => {
      const supplied = state as EditAssignmentInput | undefined;
      return supplied?.document
        ? base.set(editAssignmentInputContext, supplied)
        : base;
    },
  } satisfies RouteMetadata;
  readonly id = EditAssignmentFormScreen.route.id;
  /**
   * The declaration THIS ticket's popup runs on (BB-313 D3 / BB-360 D8).
   *
   * Chosen once, in `didLoad`, and used for BOTH the rendered rows and the key
   * routing — the kernel indexes its field array by `state.active`, so two
   * sources for that array is two ways to disagree about which row the `▸`
   * marker is on. Defaults to the closed (read-only) declaration: a screen
   * that somehow renders before its document has arrived offers less rather
   * than more.
   */
  private declaration: EditFormDeclaration = EDIT_FORM_CLOSED;
  private form: EditFormState | undefined;
  private action: ScreenAction | undefined;
  private message = '';
  private submitting = false;
  private context: ScreenContext | undefined;
  private sources: OptionSources = {};
  private optionLoader: OptionLoader | undefined;
  /**
   * The operator's uuid, resolved at most once per screen lifetime (BB-460
   * fix round 1). `context.services.currentUser` may be a username, not the
   * uuid `Conductor.ownerUserId` compares against — threading it straight through
   * silently no-oped the owner-first ordering.
   */
  private readonly ownerIdentity = new OwnerIdentity(resolveWhoCandidate);

  get options(): EditFormOptions | undefined {
    return this.readyValue?.options;
  }
  protected async load(context: ScreenContext): Promise<EditAssignmentData> {
    this.context = context;
    const ticketId = context.params?.ticketId;
    if (!context.services || !ticketId)
      throw new Error('Assignment form requires ticketId and services');
    const supplied = context.contexts?.has(editAssignmentInputContext)
      ? context.contexts.get(editAssignmentInputContext)
      : undefined;
    const document =
      supplied?.document ??
      (await loadTicketDetail(context.services.client, ticketId));
    const projectId = relationshipId(document, 'project_id');
    // BB-460 fix round 1: `currentUser` is a username; `ownerUserId` must be
    // the operator's uuid (`Conductor.ownerUserId`'s shape), so it is resolved
    // once per screen lifetime through `OwnerIdentity` rather than threaded
    // straight through. Fails open: `unavailable` omits the hint entirely.
    const ownerOutcome = await this.ownerIdentity.resolve(
      context.services.client,
      context.services.currentUser,
    );
    const loaded = await loadEditFormOptions(
      {
        read: context.services.client,
        ...(context.services.writeClient === undefined
          ? {}
          : { write: context.services.writeClient }),
      },
      {
        ...(projectId === undefined ? {} : { projectId }),
        ...(ownerOutcome.kind === 'resolved'
          ? { ownerUserId: ownerOutcome.id }
          : {}),
        ...(context.services.workspaceId === undefined
          ? {}
          : { workspaceId: context.services.workspaceId }),
      },
    ).catch(() => EMPTY_EDIT_FORM_OPTIONS);
    const options = {
      ...loaded,
      reviewers: withSelectedReviewers(
        loaded.reviewers,
        reviewerIds(document),
        includedUserLabels(document),
      ),
    };

    // Parent typeahead: project-scoped source with self-exclusion (D5/D11).
    // No project ⇒ no source, so the bag stays absent and the field shows
    // its absentNote. Built as one object: OptionSources is Readonly and
    // does not permit property assignment after construction.
    this.sources =
      projectId === undefined
        ? {}
        : {
            parent: editParentOptionSource(
              context.services.client,
              projectId,
              ticketId,
            ),
          };

    return { document, options };
  }
  protected override didLoad(data: EditAssignmentData): void {
    this.declaration = editFormFor(data.document);
    this.form = initialEditForm(data.document);
    this.optionLoader = createOptionLoader<EditFormOptions>({
      sources: this.sources,
      ...(this.context?.options?.debounce
        ? { debounce: this.context.options.debounce }
        : {}),
      current: () => this.readyValue?.options ?? null,
      onLoaded: (next) => {
        const ready = this.readyValue;
        if (!ready) return;
        this.replaceReady({ ...ready, options: next });
        this.context?.requestDraw();
      },
    });
    // Prime parent candidates with the empty query so ←/→ browses before typing.
    if (this.sources.parent) this.optionLoader.reload('parent', '');
  }
  protected renderLoading(): string[] {
    return ['Loading assignment…'];
  }
  /**
   * BB-340 D1/D3 — the popup's body as the tree the widget layer builds.
   *
   * The insertion point of the two `text` fields (Estimate, Spent) is a
   * `FieldTextarea` NODE inside that tree, so this screen publishes no `caret`
   * coordinate any more: the chain the caret's row used to travel — the widget's
   * rows, then this screen's array, then the composed box — is a set of
   * translations the node does not need. It sits in the layout where the widget
   * put it.
   */
  protected renderReady(
    data: EditAssignmentData,
    _context: ScreenContext,
  ): VNode {
    // Ready without a form is unreachable — `didLoad` builds one the moment the
    // state becomes ready. Rooted at the SAME id so a frame that did hit it
    // would patch the standing tree rather than build a second one beside it.
    if (!this.form) return columnNode(EDIT_FORM_REGION);
    // The field list is handed in (BB-313 D4): this screen owns which
    // declaration THIS ticket runs on, so the component may not import either.
    return editFormTree(
      this.declaration.fields as unknown as FieldDef<EditFieldId>[],
      this.form,
      data.options,
      {
        message: this.message,
        activeRun: activeRunInfo(data.document),
        width: 58,
      },
    );
  }
  takeAction(): ScreenAction | undefined {
    const action = this.action;
    this.action = undefined;
    return action;
  }
  private submit(
    context: ScreenContext,
    data: EditAssignmentData,
    /** When true, Cancel ticket path (lifecycle-only). */
    cancelTicket: boolean,
  ): void {
    if (this.submitting || !this.form || !context.services) return;
    this.submitting = true;
    this.message = '';
    const ticketId = data.document.data?.id ?? context.params?.ticketId ?? '';
    const payload = cancelTicket
      ? cancelEditPayload()
      : serializeEdit(this.form);
    const assigneeId = cancelTicket
      ? (relationshipId(data.document, 'assignee_user_id') ?? '')
      : 'relationships' in payload
        ? (payload.relationships.assignee_user_id.data?.id ?? '')
        : '';
    void (context.services.writeClient ?? context.services.client)
      .update('bb_ticket--bb_ticket', ticketId, payload)
      .then(async () => {
        const document = await loadTicketDetail(
          context.services?.client as NonNullable<
            ScreenContext['services']
          >['client'],
          ticketId,
        );
        const result = {
          ...EditAssignmentFormScreen.result(ticketId, assigneeId),
          document,
          options: data.options,
        };
        if (context.back) context.back(result);
        else
          this.action = {
            type: 'back',
            result: EditAssignmentFormScreen.result(ticketId, assigneeId),
          };
      })
      .catch((caught: unknown) => {
        this.message = serverMessage(caught);
      })
      .finally(() => {
        this.submitting = false;
        if (context.isActive()) context.requestDraw();
      });
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    const data = this.readyValue;
    if (!data || !this.form) return false;
    const field = this.declaration.activeField(this.form);
    // BB-300 D3 — the field count is passed so the kernel can scope ↑/↓
    // suggestion-browsing to single-field forms; this form has several, so
    // its ↑/↓ behaviour is unchanged.
    const intent = keyToIntent(input, field, {
      fieldCount: this.declaration.fields.length,
      ...(field.query !== undefined
        ? {
            query: String(
              (this.form as unknown as Record<string, unknown>)[field.query] ??
                '',
            ),
          }
        : {}),
    });
    if (!intent) return true;
    if (intent.kind === 'cancel') this.action = { type: 'back' };
    else if (intent.kind === 'submit' && !this.savable) {
      // A closed ticket's popup is read-only: Ctrl+S writes nothing.
      this.message = 'This ticket is closed and read-only.';
    } else if (intent.kind === 'submit') {
      // D10: Ctrl+S ALWAYS Save, even when the cursor is on Cancel ticket.
      // Only Enter/submit while standing on the cancelTicket action cancels.
      const cancelTicket =
        input !== 'ctrl+s' && field.id === CANCEL_TICKET_ACTION_ID;
      this.submit(context, data, cancelTicket);
    } else if (!this.savable && intent.kind !== 'move') {
      // A closed ticket's values stay as they are; only ↑↓ moves.
    } else {
      this.form = this.declaration.apply(this.form, data.options, intent);
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
  /**
   * Closing the popup DROPS its document (BB-313).
   *
   * `AsyncScreen.enter` re-loads only when the session generation or the context
   * key changed, and neither changes between two opens of the same ticket:
   * `keyFor` is the scope-role contexts plus the route params, and this screen's
   * own input context is declared `role: 'input'`, which `scopeKey()` filters
   * out. So without this the second open reuses the first open's `form` and
   * `declaration` — and BB-313 put the first LIFECYCLE-MUTATING value into that
   * reused state. Overridden HERE and not on `AsyncScreen`, deliberately: the
   * sibling modals share the caching shape but carry no lifecycle-mutating
   * residual that must die with the popup.
   */
  override leave(): void {
    this.reset();
    super.leave();
  }
  override reset(): void {
    this.declaration = EDIT_FORM_CLOSED;
    this.form = undefined;
    this.action = undefined;
    this.message = '';
    this.submitting = false;
    this.optionLoader?.cancel();
    this.optionLoader = undefined;
    this.sources = {};
    this.ownerIdentity.reset();
    this.context = undefined;
    super.reset();
  }
  protected modalChrome(context: ScreenContext): ModalChrome {
    // BB-308: chrome names the ticket, not only assignment.
    return {
      title: '✎ Edit ticket',
      meta: String(
        this.readyValue?.document.data?.attributes?.identifier ??
          context.params?.ticketId ??
          '',
      ),
    };
  }

  /** Whether this ticket's popup can write at all; a closed one cannot. */
  private get savable(): boolean {
    return this.declaration.fields.some((f) => f.id === 'submit');
  }

  protected override actions() {
    // BB-360 D12 — Esc:close (not cancel); Cancel ticket is lifecycle.
    return [
      actionItem('edit-field', '↑↓', 'field'),
      ...(this.savable
        ? [
            actionItem('edit-change', '←→', 'change'),
            actionItem('edit-save', 'Ctrl+S', 'save'),
          ]
        : []),
      actionItem('edit-esc', 'Esc', 'close'),
    ];
  }
}
