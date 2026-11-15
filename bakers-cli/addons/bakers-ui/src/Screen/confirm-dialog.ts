import type { VNode } from '@opentui/core';
import { actionItem } from '../Component/footer-actions/index.js';
import { serverMessage } from '../lib/jsonapi-error.js';
import { columnNode, textNode } from '../lib/vnode.js';
import { wrapToWidth } from '../lib/width.js';
import { defineContext } from '../Routing/context.js';
import type { RouteMetadata } from '../Routing/route.js';
import { AsyncModalScreen } from './async-modal-screen.js';
import type { ModalChrome } from './modal-screen.js';
import type { ScreenAction, ScreenContext } from './screen.js';

/** What the dialog shows once its request is prepared. */
export interface ConfirmPrompt {
  readonly message: string;
  readonly detail?: string;
  /** Absent: there is nothing to confirm, and Enter writes nothing. */
  readonly confirm?: (context: ScreenContext) => Promise<unknown>;
}

/**
 * One confirmable action. The dialog knows no entity: each slice builds its
 * own request, so a shared screen never imports a slice.
 */
export interface ConfirmRequest {
  readonly title: string;
  readonly prepare: (context: ScreenContext) => Promise<ConfirmPrompt>;
}

export const confirmRequestContext = defineContext<ConfirmRequest>(
  'confirm-request',
  'input',
);

/** The action that opens the dialog for `request`. */
export const confirmNavigation = (request: ConfirmRequest): ScreenAction => ({
  type: 'navigate',
  routeId: ConfirmDialogScreen.route.id,
  params: {},
  result: request,
});

/** Text width inside the popup, as the edit popup measures it. */
const WIDTH = 58;

/** One node per physical row: a server message is longer than the popup. */
const rowsOf = (id: string, text: string): VNode[] =>
  text
    .split('\n')
    .flatMap((line) => wrapToWidth(line, WIDTH))
    .map((content, index) => textNode({ id: `${id}-${index}`, content }));

/** The confirmation dialog: Enter confirms, Esc closes and writes nothing. */
export class ConfirmDialogScreen extends AsyncModalScreen<ConfirmPrompt> {
  static readonly route = {
    id: 'confirm',
    path: '/confirm',
    presentation: 'modal',
    context: (_params, state, base) =>
      state ? base.set(confirmRequestContext, state as ConfirmRequest) : base,
  } satisfies RouteMetadata;
  readonly id = ConfirmDialogScreen.route.id;
  private request: ConfirmRequest | undefined;
  private action: ScreenAction | undefined;
  private message = '';
  private submitting = false;

  protected load(context: ScreenContext): Promise<ConfirmPrompt> {
    this.request = context.contexts?.has(confirmRequestContext)
      ? context.contexts.get(confirmRequestContext)
      : undefined;
    return this.request?.prepare(context) ?? Promise.resolve({ message: '' });
  }

  protected renderLoading(): string[] {
    return ['Loading…'];
  }

  protected renderReady(prompt: ConfirmPrompt): VNode {
    return columnNode(
      'confirm-dialog',
      ...rowsOf('confirm-dialog-message', prompt.message),
      ...rowsOf('confirm-dialog-detail', this.message || prompt.detail || ''),
    );
  }

  protected modalChrome(): ModalChrome {
    return { title: this.request?.title ?? '' };
  }

  protected override actions() {
    return [
      ...(this.readyValue?.confirm
        ? [actionItem('confirm-submit', 'Enter', 'confirm')]
        : []),
      actionItem('confirm-esc', 'Esc', 'close'),
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
    const confirm = this.readyValue?.confirm;
    if (input !== 'enter' || !confirm) return false;
    if (this.submitting) return true;
    this.submitting = true;
    this.message = '';
    void confirm(context)
      .then((result) => {
        if (context.back) context.back(result);
        else this.action = { type: 'back', result };
      })
      .catch((caught: unknown) => {
        this.message = serverMessage(caught);
      })
      .finally(() => {
        this.submitting = false;
        if (context.isActive()) context.requestDraw();
      });
    return true;
  }

  /** Closing drops the prompt: the next open carries a different request. */
  override leave(): void {
    this.reset();
    super.leave();
  }

  override reset(): void {
    this.request = undefined;
    this.action = undefined;
    this.message = '';
    this.submitting = false;
    super.reset();
  }
}
