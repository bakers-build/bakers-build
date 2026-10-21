import type { VNode } from '@opentui/core';
import type { ActionItem } from '../Component/footer-actions/index.js';
import {
  filterBadgeStrip,
  type ListFilterBadge,
} from '../Component/list-chrome/index.js';
import { serverMessage } from '../lib/jsonapi-error.js';
import { columnNode, messageTree } from '../lib/vnode.js';
import {
  BaseScreen,
  presentation,
  type ScreenContext,
  type ScreenId,
  type ScreenPresentation,
} from './screen.js';

export type { ListFilterBadge };

export type AsyncScreenState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Header fields — not the footer.
 * Footer chips go through {@link AsyncScreen.actions}; notices through
 * {@link AsyncScreen.notice}.
 */
export type FullScreenChrome = Partial<
  Pick<
    ScreenPresentation,
    | 'title'
    | 'meta'
    | 'header'
    | 'selectable'
    | 'selectedIndex'
    | 'rowIds'
    | 'cursorMode'
  >
>;

interface LifecycleGuard {
  readonly generation: number;
  readonly activation: number;
  readonly revision: number;
  readonly session: number;
  readonly scope: string;
}

/**
 * BB-340 D1 + BB-375 — every (non-modal) screen is async.
 *
 * Owns load lifecycle AND chrome: inlined FRAME + flush + `actions()` /
 * `notice()`. Subclasses supply `load` / `renderReady` / `chrome` / optional
 * `badges` / `actions` — not `present()`.
 */
export abstract class AsyncScreen<T> extends BaseScreen {
  abstract readonly id: ScreenId;
  /**
   * Body id prefix (`tickets` → `tickets-body`).
   * Defaults to {@link id}.
   */
  readonly frameId?: string;

  private generation = 0;
  private activation = 0;
  private revision = 0;
  private sessionGeneration = -1;
  private contextKey = '';
  private data: T | undefined;
  private failure: Error | undefined;
  state: AsyncScreenState = 'idle';
  private staleRedrawCount = 0;
  /** True while a re-read runs over a ready surface — footer spinner, body stays. */
  private refreshing = false;
  /** Transient action result — footer right edge, not a standing notice. */
  protected toast = '';

  staleRedraws(): number {
    return this.staleRedrawCount;
  }
  get busy(): boolean {
    return this.state === 'loading' || this.refreshing;
  }
  protected get readyValue(): T | undefined {
    return this.state === 'ready' ? this.data : undefined;
  }
  /** Replace a ready document after a screen-owned local mutation. */
  protected replaceReady(data: T): void {
    this.revision++;
    this.data = data;
    this.state = 'ready';
  }

  protected abstract load(context: ScreenContext): Promise<T>;
  protected abstract renderLoading(context: ScreenContext): string[];
  protected abstract renderReady(data: T, context: ScreenContext): VNode;
  protected renderError(error: Error): string[] {
    return [error.message, '', 'Press Enter to retry.'];
  }
  protected didLoad(_data: T, _context: ScreenContext): void {}

  /**
   * Whether the body sits flush against the frame. A document screen that
   * reads as content inside the frame returns `false` for the body-window
   * inset every framed row surface used to have.
   */
  protected flushBody(): boolean {
    return true;
  }

  /** Optional filter chips above the FRAME. */
  protected badges(_context: ScreenContext): readonly ListFilterBadge[] {
    return [];
  }

  /** title / meta / header / selection — not footer. */
  protected abstract chrome(context: ScreenContext): FullScreenChrome;

  /** Footer action chips above kernel basics. */
  protected actions(_context: ScreenContext): readonly ActionItem[] {
    return [];
  }

  /**
   * Short notice prefix in the basics row — never key ladders.
   * Named `notice` so screens can keep a `private status` field for the value.
   */
  protected notice(_context: ScreenContext): string | undefined {
    return undefined;
  }

  protected captureLifecycle(
    context: ScreenContext,
    supersedeRequests = false,
  ): LifecycleGuard {
    if (supersedeRequests) this.generation++;
    return {
      generation: this.generation,
      activation: this.activation,
      revision: this.revision,
      session: context.sessionGeneration,
      scope: this.contextKey,
    };
  }

  protected lifecycleIsCurrent(
    guard: LifecycleGuard,
    context: ScreenContext,
  ): boolean {
    return (
      guard.generation === this.generation &&
      this.actionStillCurrent(guard, context)
    );
  }

  /**
   * The screen we started an action on is still the one showing. A quiet
   * refresh bumps `generation`, so {@link lifecycleIsCurrent} is false after
   * `reload()` even though the operator never left.
   */
  protected actionStillCurrent(
    guard: LifecycleGuard,
    context: ScreenContext,
  ): boolean {
    return (
      guard.activation === this.activation &&
      guard.revision === this.revision &&
      guard.session === this.sessionGeneration &&
      guard.scope === this.contextKey &&
      context.isActive()
    );
  }

  protected replaceReadyIfCurrent(
    guard: LifecycleGuard,
    data: T,
    context: ScreenContext,
  ): boolean {
    if (!this.lifecycleIsCurrent(guard, context)) return false;
    this.data = data;
    this.state = 'ready';
    return true;
  }

  /**
   * Re-read over the ready surface, superseding any read still in flight.
   * Resolves `false` when a newer read or a local mutation overtook this one;
   * rejects only while it is still the current read, so a stale failure
   * cannot overwrite a newer answer.
   */
  protected async reloadInPlace(context: ScreenContext): Promise<boolean> {
    const guard = this.captureLifecycle(context, true);
    let data: T;
    try {
      data = await this.load(context);
    } catch (caught) {
      if (!this.lifecycleIsCurrent(guard, context)) return false;
      throw caught;
    }
    if (!this.replaceReadyIfCurrent(guard, data, context)) return false;
    this.requestActiveDraw(context);
    return true;
  }

  protected requestActiveDraw(context: ScreenContext): boolean {
    if (!context.isActive()) {
      this.staleRedrawCount++;
      return false;
    }
    context.requestDraw();
    return true;
  }

  override enter(context: ScreenContext): void {
    const contextKey = this.keyFor(context);
    if (
      this.sessionGeneration !== context.sessionGeneration ||
      this.contextKey !== contextKey
    )
      this.reset();
    this.sessionGeneration = context.sessionGeneration;
    this.contextKey = contextKey;
    if (this.state === 'loading' || this.state === 'ready') {
      context.requestDraw();
      return;
    }
    void this.start(context);
  }

  retry(context: ScreenContext): Promise<void> {
    return this.start(context);
  }

  private start(context: ScreenContext): Promise<void> {
    const keepSurface = this.state === 'ready' && this.data !== undefined;
    const generation = ++this.generation;
    const activation = this.activation;
    const revision = this.revision;
    const session = context.sessionGeneration;
    const scope = this.contextKey;
    this.refreshing = keepSurface;
    if (!keepSurface) this.state = 'loading';
    this.failure = undefined;
    context.requestDraw();
    let operation: Promise<T>;
    try {
      operation = this.load(context);
    } catch (caught) {
      operation = Promise.reject(caught);
    }
    return operation.then(
      (data) => {
        if (
          generation !== this.generation ||
          activation !== this.activation ||
          revision !== this.revision ||
          session !== this.sessionGeneration ||
          scope !== this.contextKey
        )
          return;
        this.refreshing = false;
        this.data = data;
        this.state = 'ready';
        this.didLoad(data, context);
        this.requestActiveDraw(context);
      },
      (caught) => {
        if (
          generation !== this.generation ||
          activation !== this.activation ||
          revision !== this.revision ||
          session !== this.sessionGeneration ||
          scope !== this.contextKey
        )
          return;
        this.refreshing = false;
        if (keepSurface) {
          this.toast = serverMessage(caught);
          this.requestActiveDraw(context);
          return;
        }
        this.failure = new Error(serverMessage(caught));
        this.state = 'error';
        this.requestActiveDraw(context);
      },
    );
  }

  override leave(): void {
    this.activation++;
    this.refreshing = false;
    if (this.state === 'loading') {
      this.generation++;
      this.state = 'idle';
    }
  }

  /** Ready / loading / error tree — framed by {@link present}. */
  protected surface(context: ScreenContext): VNode {
    const notice = this.noticeRows(context);
    return notice === undefined
      ? this.renderReady(this.data as T, context)
      : messageTree(this.id, notice);
  }

  protected noticeRows(context: ScreenContext): string[] | undefined {
    if (this.state === 'loading' || this.state === 'idle')
      return this.renderLoading(context);
    if (this.state === 'error')
      return this.renderError(this.failure ?? new Error('Unknown error'));
    return undefined;
  }

  present(context: ScreenContext): ScreenPresentation {
    const id = this.frameId ?? this.id;
    const badges = this.badges(context);
    const actions = this.actions(context);
    const notice = this.notice(context);
    // Frame lives on region-body ScrollBox (BB-375) — no nested framedPanel.
    const children: VNode[] = [];
    if (badges.length > 0) {
      children.push(filterBadgeStrip(`${id}-filter`, badges));
    }
    children.push(this.surface(context));
    return presentation(columnNode(`${id}-body`, ...children), {
      flush: this.flushBody(),
      ...this.chrome(context),
      ...(actions.length > 0 ? { actions } : {}),
      ...(notice !== undefined && notice !== '' ? { status: notice } : {}),
      ...(this.toast !== '' ? { toast: this.toast } : {}),
    });
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (input === 'enter' && this.state === 'error') {
      this.retry(context);
      return true;
    }
    return false;
  }

  override reset(): void {
    this.generation++;
    this.activation++;
    this.revision++;
    this.sessionGeneration = -1;
    this.contextKey = '';
    this.data = undefined;
    this.failure = undefined;
    this.state = 'idle';
    this.refreshing = false;
    this.toast = '';
    this.staleRedrawCount = 0;
  }

  private keyFor(context: ScreenContext): string {
    return `${context.contexts?.scopeKey() ?? ''}|${JSON.stringify(
      Object.entries(context.params ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    )}`;
  }
}
