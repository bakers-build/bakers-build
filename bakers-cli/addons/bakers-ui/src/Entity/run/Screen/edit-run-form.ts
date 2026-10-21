import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { columnNode, textNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncModalScreen } from '../../../Screen/async-modal-screen.js';
import type { ModalChrome } from '../../../Screen/modal-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import { runResource } from '../Component/run-detail/index.js';
import { cancelRunPayload, isRunCancellable } from '../Form/edit.js';
import { runDetailInputContext } from './run-detail.js';

export class EditRunFormScreen extends AsyncModalScreen<TicketDetailDocument> {
  readonly modal = true;
  static readonly route = {
    id: 'run.edit',
    path: '/tickets/:ticketId/runs/:runId/edit',
    parent: 'run.detail',
    presentation: 'modal',
    context: (_params, state, base) =>
      state
        ? base.set(runDetailInputContext, {
            document: state as TicketDetailDocument,
          })
        : base,
  } satisfies RouteMetadata;
  readonly id = EditRunFormScreen.route.id;
  private action: ScreenAction | undefined;
  private message = '';
  private submitting = false;

  protected load(context: ScreenContext): Promise<TicketDetailDocument> {
    if (context.contexts?.has(runDetailInputContext))
      return Promise.resolve(
        context.contexts.get(runDetailInputContext).document,
      );
    return Promise.resolve({});
  }

  protected renderLoading(): string[] {
    return ['Loading run edit…'];
  }

  protected renderReady(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): VNode {
    const run = runResource(document, context.params?.runId);
    return columnNode(
      'run-edit-form',
      textNode({
        id: 'run-edit-form-label',
        content: `Cancel run${run ? ` #${String(run.attributes?.drupal_internal__id ?? run.id)}` : ''}?`,
      }),
      textNode({
        id: 'run-edit-form-message',
        content: this.message || 'This marks the run as cancelled.',
      }),
    );
  }

  protected modalChrome(_context: ScreenContext): ModalChrome {
    return { title: '✕ Cancel run' };
  }

  protected override actions() {
    return [
      actionItem('run-cancel-submit', 'Enter', 'cancel'),
      actionItem('run-cancel-esc', 'Esc', 'close'),
    ];
  }

  takeAction(): ScreenAction | undefined {
    const action = this.action;
    this.action = undefined;
    return action;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input === 'escape') {
      this.action = { type: 'back' };
      context.requestDraw();
      return true;
    }
    if (input !== 'enter' || this.submitting) return false;
    const document = this.readyValue;
    const runId = context.params?.runId;
    if (!document || !runId) return false;
    const run = runResource(document, runId);
    if (!run || !isRunCancellable(String(run.attributes?.state ?? '')))
      return false;
    const client = context.services?.writeClient ?? context.services?.client;
    if (!client) return false;
    this.submitting = true;
    void client
      .update('bb_run--bb_run', runId, cancelRunPayload())
      .then(() => {
        const updatedDocument: TicketDetailDocument = {
          ...document,
          ...(document.included
            ? {
                included: document.included.map((resource) =>
                  resource.id === runId
                    ? {
                        ...resource,
                        attributes: {
                          ...resource.attributes,
                          state: 'cancelled',
                        },
                      }
                    : resource,
                ),
              }
            : {}),
        };
        const result = {
          type: 'run-cancelled' as const,
          runId,
          document: updatedDocument,
        };
        if (context.back) context.back(result);
        else this.action = { type: 'back', result };
      })
      .catch((caught: unknown) => {
        this.message =
          caught instanceof Error ? caught.message : String(caught);
      })
      .finally(() => {
        this.submitting = false;
        if (context.isActive()) context.requestDraw();
      });
    return true;
  }
}
