// BB-375 — async modal forms (Create / Edit / Who / Parent).

import type { ActionItem } from '../Component/footer-actions/index.js';
import { formatActionLadder } from '../Component/footer-actions/index.js';
import { AsyncScreen, type FullScreenChrome } from './async-screen.js';
import type { ModalChrome } from './modal-screen.js';
import {
  presentation,
  type ScreenContext,
  type ScreenPresentation,
} from './screen.js';

/**
 * Async load lifecycle for modal forms — same state machine as
 * {@link AsyncScreen}, popup chrome (no full-screen FRAME).
 *
 * Screens still publish {@link actions}; the modal box only has a string
 * status row today, so chips are formatted via {@link formatActionLadder}.
 */
export abstract class AsyncModalScreen<T> extends AsyncScreen<T> {
  readonly modal = true;

  protected abstract modalChrome(context: ScreenContext): ModalChrome;

  /** Unused for modals — {@link present} reads {@link modalChrome}. */
  protected chrome(_context: ScreenContext): FullScreenChrome {
    return {};
  }

  protected override actions(_context: ScreenContext): readonly ActionItem[] {
    return [];
  }

  /** Optional extra status lines under the action ladder. */
  protected override notice(_context: ScreenContext): string | undefined {
    return undefined;
  }

  /**
   * Status rows inside the modal box. Default: one ladder from {@link actions},
   * then {@link notice}. Override to split long ladders across rows (create form).
   */
  protected modalStatusLines(context: ScreenContext): string[] {
    const ladder = formatActionLadder(this.actions(context));
    const notice = this.notice(context)?.trim();
    return [ladder, notice].filter((s): s is string => !!s && s.length > 0);
  }

  override present(context: ScreenContext): ScreenPresentation {
    const actions = this.actions(context);
    const lines = this.modalStatusLines(context);
    return presentation(this.surface(context), {
      modal: true,
      ...this.modalChrome(context),
      ...(actions.length > 0 ? { actions } : {}),
      ...(lines.length > 0 ? { status: lines.join('\n') } : {}),
    });
  }
}
