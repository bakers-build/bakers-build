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

/** One row of a confirmation's checklist. */
export interface ChecklistItem {
  readonly id: string;
  readonly label: string;
}

/** What the dialog shows once its request is prepared. */
export interface ConfirmPrompt {
  readonly message: string;
  readonly detail?: string;
  /** Rows the person may uncheck, all checked at first; confirm gets the checked ids. */
  readonly checklist?: readonly ChecklistItem[];
  /** Button labels; default Confirm and Close. */
  readonly labels?: { readonly confirm: string; readonly close: string };
  /** Absent: there is nothing to confirm, and Enter writes nothing. */
  readonly confirm?: (
    context: ScreenContext,
    checked: readonly string[],
  ) => Promise<unknown>;
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

/**
 * The confirmation dialog: Enter confirms, Esc closes and writes nothing. A
 * checklist moves with ↑/↓ and toggles with Space.
 */
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
  /** The checklist's checked ids and cursor, for the prompt they were set up for. */
  private checked = new Set<string>();
  private cursor = 0;
  private checklistOf: ConfirmPrompt | undefined;

  private checklist(prompt: ConfirmPrompt): readonly ChecklistItem[] {
    const items = prompt.checklist ?? [];
    if (this.checklistOf !== prompt) {
      this.checklistOf = prompt;
      this.checked = new Set(items.map((item) => item.id));
      this.cursor = 0;
    }
    return items;
  }

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
      ...this.checklist(prompt).map((item, index) =>
        textNode({
          id: `confirm-dialog-item-${index}`,
          content: `${index === this.cursor ? '▸' : ' '}[${this.checked.has(item.id) ? 'x' : ' '}] ${item.label}`,
          selected: index === this.cursor,
        }),
      ),
      textNode({ id: 'confirm-dialog-gap', content: '' }),
      rowNode(
        'confirm-dialog-buttons',
        ...this.buttons().flatMap((button, index) => [
          ...(index > 0
            ? [textNode({ id: `confirm-dialog-gap-${index}`, content: '  ' })]
            : []),
          textNode({
            id: `confirm-dialog-button-${button}`,
            content: `${index === this.focus ? '▸' : ' '}[ ${prompt.labels?.[button] ?? BUTTON_LABELS[button]} ]`,
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
      ...(this.readyValue?.checklist?.length
        ? [
            actionItem('confirm-rows', '↑↓', 'row'),
            actionItem('confirm-toggle', 'Space', 'check'),
          ]
        : []),
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
    const items = this.checklist(this.readyValue);
    if (items.length > 0 && !this.submitting) {
      const move = input === 'down' ? 1 : input === 'up' ? -1 : 0;
      if (move !== 0) {
        this.cursor = (this.cursor + move + items.length) % items.length;
        context.requestDraw();
        return true;
      }
      const item = input === ' ' ? items[this.cursor] : undefined;
      if (item) {
        if (!this.checked.delete(item.id)) this.checked.add(item.id);
        context.requestDraw();
        return true;
      }
    }
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
    const checked = items
      .filter((item) => this.checked.has(item.id))
      .map((item) => item.id);
    void confirm(context, checked)
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
    this.checked = new Set();
    this.cursor = 0;
    this.checklistOf = undefined;
    super.reset();
  }
}
