import type { VNode } from '@opentui/core';
import { actionItem } from '../Component/footer-actions/index.js';
import { serverMessage } from '../lib/jsonapi-error.js';
import { columnNode, rowNode, textNode } from '../lib/vnode.js';
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

type Button = 'confirm' | 'close';
const BUTTON_LABELS: Record<Button, string> = {
  confirm: 'Confirm',
  close: 'Close',
};

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
  /** Index of the focused button; Confirm, the first, when there is one. */
  private focus = 0;

  private buttons(): Button[] {
    return this.readyValue?.confirm ? ['confirm', 'close'] : ['close'];
  }

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
      textNode({ id: 'confirm-dialog-gap', content: '' }),
      rowNode(
        'confirm-dialog-buttons',
        ...this.buttons().flatMap((button, index) => [
          ...(index > 0
            ? [textNode({ id: `confirm-dialog-gap-${index}`, content: '  ' })]
            : []),
          textNode({
            id: `confirm-dialog-button-${button}`,
            content: `${index === this.focus ? '▸' : ' '}[ ${BUTTON_LABELS[button]} ]`,
            selected: index === this.focus,
          }),
        ]),
      ),
    );
  }

  protected modalChrome(): ModalChrome {
    return { title: this.request?.title ?? '' };
  }

  protected override actions() {
    return [
      actionItem('confirm-move', '←→', 'button'),
      actionItem('confirm-press', 'Enter', 'press'),
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
    if (!this.readyValue) return false;
    const buttons = this.buttons();
    const step =
      input === 'right' || input === 'tab'
        ? 1
        : input === 'left' || input === 'shift+tab'
          ? -1
          : 0;
    if (step !== 0) {
      if (!this.submitting)
        this.focus = (this.focus + step + buttons.length) % buttons.length;
      context.requestDraw();
      return true;
    }
    const pressed =
      input === 'escape'
        ? 'close'
        : input === 'enter' || input === ' '
          ? buttons[this.focus]
          : undefined;
    if (!pressed) return false;
    // A pending write still lands; leaving now would let its result pop the
    // screen below as well, and a second confirm would write twice.
    if (this.submitting) return true;
    const confirm = this.readyValue.confirm;
    if (pressed === 'close' || !confirm) {
      this.action = { type: 'back' };
      context.requestDraw();
      return true;
    }
    this.submitting = true;
    this.message = '';
    void confirm(context)
      .then((result) => {
        if (!context.isActive()) return;
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
    this.focus = 0;
    super.reset();
  }
}
