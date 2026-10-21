import type { ScreenContext } from './screen.js';

export interface RowActionOptions<G> {
  readonly rowId: string;
  readonly busy: Set<string>;
  readonly context: ScreenContext;
  perform(): Promise<{ readonly message: string }>;
  refresh(context: ScreenContext): void | Promise<void>;
  setStatus(status: string): void;
  captureLifecycle(): G;
  lifecycleIsCurrent(guard: G, context: ScreenContext): boolean;
  /** After `refresh`, generation has moved; default is {@link lifecycleIsCurrent}. */
  statusIsCurrent?(guard: G, context: ScreenContext): boolean;
  readonly failPrefix: string;
}

export function runRowAction<G>(options: RowActionOptions<G>): boolean {
  const {
    rowId,
    busy,
    context,
    perform,
    refresh,
    setStatus,
    captureLifecycle,
    lifecycleIsCurrent,
    statusIsCurrent = lifecycleIsCurrent,
    failPrefix,
  } = options;
  if (busy.has(rowId)) return true;
  const guard = captureLifecycle();
  busy.add(rowId);
  context.requestDraw();
  void (async () => {
    let notice: string | undefined;
    try {
      const result = await perform();
      notice = result.message;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notice = `${failPrefix}: ${detail}`;
    } finally {
      busy.delete(rowId);
      if (lifecycleIsCurrent(guard, context)) {
        try {
          const pending = refresh(context);
          if (pending !== undefined) await pending;
        } catch {
          // Still show the action result if the re-read throws.
        }
        if (statusIsCurrent(guard, context) && notice !== undefined) {
          setStatus(notice);
          context.requestDraw();
        }
      }
    }
  })();
  return true;
}
