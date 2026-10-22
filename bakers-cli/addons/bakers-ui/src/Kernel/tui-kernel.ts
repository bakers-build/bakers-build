import { CliRenderEvents, type KeyEvent, type MouseEvent } from '@opentui/core';
import {
  type TabLocation,
  tabsOfLocation,
} from '../Component/top-tabs/index.js';
import { createSessionStore } from '../Data/session-store.js';
import { loadContributions } from '../Extension/load.js';
import { createInputTrace } from '../lib/input-trace.js';
import {
  createRefreshSignal,
  type RefreshSignal,
} from '../lib/refresh-signal.js';
import { scrollTo } from '../lib/scroll.js';
import { Router } from '../Routing/router.js';
import {
  bootLocationFor,
  buildRoutes,
  WORKSPACE_PICKER_ROUTE_ID,
} from '../Routing/routes.js';
import type {
  Screen,
  ScreenAction,
  ScreenContext,
  ScreenPresentation,
} from '../Screen/screen.js';
import type { RendererServices, TuiOptions } from '../types.js';
import { timerDebounce } from '../Widget/option-source.js';
import {
  bodyRowsFor,
  type ChromeInput,
  chromeInputFor,
  FOOTER_SPINNER_MS,
  frameTrees,
  modalBoxWidth,
  NOTICE_ANIM_MS,
} from './chrome.js';
import { clipboardWriter } from './clipboard.js';
import { guardContribution } from './contribution-guard.js';
import { keyEventToKeys } from './key-input.js';
import {
  laidOutTop,
  mountTree,
  renderBodyToText,
  unmountTree,
} from './mount.js';
import { renderPipe } from './pipe.js';
import { createRegions } from './regions.js';
import { createTerminalShell } from './renderer.js';
import {
  awaitSplash,
  SPLASH_MS,
  shouldSkipSplash,
  splashTree,
} from './splash.js';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export async function runTicketTui(
  _document: unknown,
  _context: unknown,
  services: RendererServices,
  options: TuiOptions = {},
): Promise<void> {
  const output = process.stdout;
  const input = process.stdin;
  // BB-326 — off unless the operator names a file. See `lib/input-trace.ts`
  // for why the three call sites below are the ones that separate a transport
  // fault from a parser fault from a binding that correctly does nothing.
  const trace = createInputTrace(process.env.BB_UI_INPUT_TRACE);
  // BB-326: an injected renderer IS the interactive answer. The test renderer
  // has no TTY behind it, so asking the streams would send every kernel test
  // down the plain-lines branch — which has no renderer and never had one.
  const interactive =
    options.renderer !== undefined || Boolean(input.isTTY && output.isTTY);
  // Injectable clock (bakers.build test-flake fix): the footer notice picks `·` vs `✓`
  // from a wall-clock age, so tests assert the transient dot phase against a
  // controlled time rather than racing a real setTimeout. Defaults to Date.now.
  const now = services.now ?? ((): number => Date.now());
  const environment = {
    services: {
      ...services,
      ...(options.agents ? { agents: options.agents } : {}),
      ...(options.writeClient ? { writeClient: options.writeClient } : {}),
      ...(options.conductorProcess
        ? { conductorProcess: options.conductorProcess }
        : {}),
      ...(options.restartProcess
        ? { restartProcess: options.restartProcess }
        : {}),
      ...(options.selectWorkspace
        ? { selectWorkspace: options.selectWorkspace }
        : {}),
      ...(options.workspace !== undefined
        ? { workspace: options.workspace }
        : {}),
      ...(options.workspaceId !== undefined
        ? { workspaceId: options.workspaceId }
        : {}),
      ...(options.configPath !== undefined
        ? { configPath: options.configPath }
        : {}),
      ...(options.bakersDir !== undefined
        ? { bakersDir: options.bakersDir }
        : {}),
      ...(options.currentUser ? { currentUser: options.currentUser } : {}),
      isWorkspaceAdmin: options.isWorkspaceAdmin ?? false,
      ...(options.ownConductorMachineId
        ? { ownConductorMachineId: options.ownConductorMachineId }
        : {}),
    },
    nowSeconds,
  };
  // BB-373 — the contributions, loaded ONCE and strictly before the terminal
  // is taken (`createTerminalShell` is below). An entry module that cannot be
  // imported therefore rejects out of here into `cmdUi`'s catch: one stderr
  // line and exit 1, no alternate screen and no raw mode. The drain happens
  // inside, so the collector singleton is emptied into this immutable list and
  // no render path ever reads module state (spec D3/R4).
  const contributed = await loadContributions(options.uiEntries ?? []);
  const routes = buildRoutes(contributed, options.isWorkspaceAdmin ?? false);
  const session = routes.createSession(environment);
  for (const ScreenType of contributed) {
    guardContribution(session.screen(ScreenType.route.id) as Screen);
  }
  let closing = false;
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // BB-326 — the ONE renderer that owns the terminal, and the shell box every
  // region is laid out inside. Taken before the router, because `draw` closes
  // over both and the router paints on its first `navigate`. BB-382 moved the
  // bring-up itself to `Kernel/renderer.ts`, rationale included: it reads five
  // values and returns a terminal, so it never belonged to this closure.
  const { renderer, shell, ownsRenderer } = await createTerminalShell({
    options,
    input,
    output,
    trace,
    interactive,
  });

  /**
   * The selection this kernel last scrolled into view.
   *
   * The follow is driven by the selection MOVING, not applied on every draw. A
   * wheel notch triggers its own repaint, so "always keep the cursor visible"
   * would undo the scroll in the very frame that caused it and the wheel would
   * be dead on every list screen. The key changes when the cursor moves and
   * when the screen underneath it changes; a reload that returns the same rows
   * changes neither and does not snap the viewport back.
   */
  let scrolledSelection: string | null = null;
  /**
   * BB-376 — declared above `finish()` and `chromeFor`: the watcher is built
   * after the non-interactive return, but the first navigation has already
   * drawn by then. A later `const` read by either closure would be in its TDZ.
   */
  let autoRefresh: RefreshSignal | undefined;
  let autoRefreshOn = false;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let lastToast: string | undefined;
  let toastShownAt = 0;

  const runtime = {
    ...environment,
    store: createSessionStore(),
    options,
    copyToClipboard: clipboardWriter(renderer),
    // Read when a context is built — once per present — so a screen sees the
    // width of the frame it is drawing. The pipe has no terminal to measure.
    get terminalColumns(): number | undefined {
      return interactive ? terminalColumns() : undefined;
    },
  };
  let router!: Router;
  const context = (): ScreenContext => router.context();
  const active = (): Screen | null => router.active;
  /**
   * BB-382 — the frame's four regions, mounted here and owned by
   * `Kernel/regions.ts`: the trees, the body's ScrollBox, the retirement of a
   * departed screen's subtree, the row-click binding, the modal's placement.
   *
   * Below `active`/`context` because WHAT A CLICK MEANS stays the kernel's — one
   * rule for thirteen screens, the same one `Enter` and `↑↓` go through. The
   * handlers are late-bound closures over the router, so the mount happening here
   * rather than above `runtime` changes nothing: the shell's child order is
   * `createRegions`'s own property (see its eager mount block) and nothing
   * between the two reads a region.
   */
  const regions = createRegions(renderer, shell, {
    select: (index: number): void => {
      active()?.select?.(index, context());
    },
    activate: (index: number): void => {
      active()?.activate?.(index, context());
    },
  });
  // BB-285 spec D4 — ONE capability check behind both the key binding and the
  // footer hint, so the two can never disagree about whether a screen reloads.
  const reloadable = (): Screen | null => {
    const screen = active();
    return screen && typeof screen.reload === 'function' ? screen : null;
  };
  const tabLocation = (): TabLocation | null => {
    const screen = active();
    return screen
      ? routes.tabLocation(screen.id, context().params ?? {})
      : null;
  };
  // The terminal geometry. The renderer knows it once there is one — it is the
  // surface being painted, and under a test it is the only thing that does.
  const terminalColumns = () => renderer?.width || output.columns || 80;
  const terminalRows = () => renderer?.height || output.rows || 24;
  const width = () => Math.max(40, terminalColumns());
  // There is no `height()` any more. It was `Math.max(3, terminalRows() - 8)`,
  // and the 8 was an unwritten six-row chrome plus a one-row footer plus one —
  // see `bodyRowsFor`, which states the subtraction over the chrome the frame
  // actually draws.

  /**
   * What `Kernel/chrome.ts` composes from; see `chromeInputFor` there.
   *
   * BB-340 Task 11 — the two click intents ride along, because the chrome
   * resolves WHICH tab or WHICH column was hit and only the kernel knows what
   * to do about it. They are recomposed on every draw, so each handler closes
   * over the frame it was drawn for: `tab` is this screen's location, and the
   * active screen is whichever one the router has.
   */
  const chromeFor = (shown: ScreenPresentation): ChromeInput => {
    const tab = tabLocation();
    const nowMs = now();
    const toast = shown.toast;
    if (toast !== lastToast) {
      lastToast = toast;
      toastShownAt = toast ? nowMs : 0;
    }
    const toastAgeMs =
      toast && toastShownAt > 0 ? nowMs - toastShownAt : undefined;
    return chromeInputFor(shown, {
      tab,
      busy: Boolean(active()?.busy),
      nowMs,
      ...(toastAgeMs !== undefined ? { toastAgeMs } : {}),
      reloadable: reloadable() !== null,
      autoRefresh: autoRefreshOn,
      modal: Boolean(active()?.modal),
      width: width(),
      ...(options.workspace !== undefined
        ? { workspace: options.workspace }
        : {}),
      onTabClick: (id: string): void => {
        // The bar you see is the bar you click: the target came from this
        // level's own registry, so it is paired with this level (BB-256 D2 —
        // an id may be declared on more than one of the three levels, and a
        // level-blind lookup would resolve the project `dashboard` to the root
        // location and the ticket's `runs` section to the project's Runs
        // screen).
        if (tab && id !== tab.tab) router.navigateTab(tab.level, id);
      },
    });
  };

  const draw = (): void => {
    const bodyBox = regions.body;
    if (closing || !renderer || !shell || !bodyBox || !active()) return;
    regions.retire(router.visitCount);
    const shown = active()?.present(context());
    if (!shown) return;
    const chrome = chromeFor(shown);
    const { modal } = chrome;
    const bodyRows = bodyRowsFor(chrome, terminalRows());
    const framed = active()?.bodyFrame !== false;
    bodyBox.border = framed;
    bodyBox.paddingLeft = framed ? 1 : 0;
    bodyBox.paddingRight = framed ? 1 : 0;
    const bodyViewportRows = Math.max(1, bodyRows - (framed ? 2 : 0));
    // Publish the geometry the box scrolls over BEFORE reading the position
    // back. `ScrollBarRenderable.scrollPosition` clamps against exactly these
    // two, so a screen that just got shorter is clamped by the box — the
    // `Math.min(…, lines.length - height())` the kernel used to keep here is
    // gone, along with the second copy of the scroll state it protected.
    bodyBox.verticalScrollBar.viewportSize = bodyViewportRows;
    // `Math.max(bodyRows, …)` is NOT belt and braces. `ScrollBarRenderable`'s
    // clamp is `min(max(0, value), scrollSize - viewportSize)`, which is
    // NEGATIVE whenever the content is shorter than the window — so a screen
    // with one line of body (`Loading ticket…`, 34 rows of window) clamped
    // `scrollTop` to -33, the content was translated DOWN by 33 rows, and the
    // ticket screen opened somewhere in the middle of itself. Measured, and
    // exactly the failure mode a virtualised box hides best: the scroll
    // position was wrong while every row on it was right.
    //
    // It is also what the LAYOUT computes: the box's content carries
    // `minHeight: '100%'`, so once Yoga has run, `content.height` is
    // `max(content, viewport)` and `recalculateBarProps` publishes that same
    // number. Feeding it here keeps the two agreeing between the assignment
    // and the layout pass rather than only after it. `scrollHeight` IS that
    // number, and since BB-340 Task 12 it is the ONLY thing the box scrolls
    // by: a screen is mounted whole, so there is no line count to take a
    // maximum against any more.
    bodyBox.verticalScrollBar.scrollSize = modal
      ? bodyViewportRows
      : Math.max(bodyViewportRows, bodyBox.scrollHeight);
    // THE ONE RENDER PATH, and the whole of it: the frame's parts as trees, in
    // the order Yoga stacks them.
    const frame = frameTrees(chrome, shown.body);
    const rowWidth = modal ? modalBoxWidth(width()) : width();
    // Off first, on below: the frame's own regions are the ones it turns back
    // on. A modal frame carries no chrome/body/footer, and a normal one no box.
    regions.parkAll();
    for (const [id, next] of frame) {
      const slot = regions.slotOf(id);
      if (!slot || !regions.treeOf(id)) continue;
      slot.visible = true;
      // TRAP, and an expensive one: `Renderable.set width` turns `flexShrink`
      // OFF when it is handed a NUMBER (`if (typeof value === 'number' &&
      // this._flexShrink === 1) this.yogaNode.setFlexShrink(0)`), on the theory
      // that an explicitly sized box does not want to be squeezed. A numeric
      // width on the body ScrollBox therefore disabled its shrink on the FIRST
      // draw, and the box then grew to the full height of its virtual content —
      // 81 rows inside a 40-row terminal, with the footer pushed off the
      // bottom. The body spans the terminal in any case, so it says so as a
      // PERCENTAGE, which the same setter leaves alone.
      slot.width = id === 'body' ? '100%' : rowWidth;
      regions.patch(id, next);
    }
    // Keep the cursor in view — when it MOVES. See `scrolledSelection`.
    //
    // BB-340 Task 12 — AFTER the patch, and asking the LAYOUT rather than the
    // screen. `ScreenPresentation.selectedRow` was the absolute physical row of
    // the highlight, the last row NUMBER on the contract, and it obliged every
    // list screen to state `1 + index` for a header row it did not draw. The
    // presentation names the selected row's NODE instead (`rowIds`), and
    // `laidOutTop` reads where that node sits inside the box the wheel scrolls.
    // `calculateLayout()` first, because this frame's tree has just changed and
    // a renderable's cached `y` still holds the previous frame's answer.
    const selectedRowId = shown.rowIds?.[shown.selectedIndex];
    const selection = `${active()?.id} | ${shown.selectedIndex} | ${shown.selectable}`;
    if (
      !modal &&
      selectedRowId !== undefined &&
      selection !== scrolledSelection
    ) {
      const row = regions.treeOf('body')?.byId.get(selectedRowId);
      if (row) {
        renderer.root.calculateLayout();
        // `lib/scroll.ts` — the clamp the autocomplete already scrolls by, fed
        // the ABSOLUTE row of the highlight exactly as its contract demands.
        bodyBox.scrollTop = scrollTo(
          laidOutTop(row, bodyBox.content),
          bodyBox.scrollTop,
          bodyViewportRows,
        );
      }
    }
    scrolledSelection = selection;
    // Strictly after the patch: a row this frame just mounted has no renderable
    // to bind before it. What the modal flag does there is `regions`' business
    // (`bindRowClicks`), and so is where the box lands (`modalOrigin`).
    regions.bindRowClicks(shown, modal);
    if (modal) regions.placeModal(chrome, terminalRows());
    const noticeAnimating =
      Boolean(shown.toast) &&
      toastShownAt > 0 &&
      now() - toastShownAt < NOTICE_ANIM_MS;
    if (active()?.busy || noticeAnimating) {
      if (spinnerTimer === undefined) {
        spinnerTimer = setInterval(() => {
          draw();
        }, FOOTER_SPINNER_MS);
        spinnerTimer.unref?.();
      }
    } else if (spinnerTimer !== undefined) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
    renderer.requestRender();
  };

  router = new Router(
    session.screens(),
    interactive ? draw : () => {},
    1,
    runtime,
    session.navigation(),
  );

  // BB-375 D6 — timed splash on interactive production TTY only. Injected
  // renderers skip by default (`shouldSkipSplash`) so the harness stays fast.
  // Best-effort: paint/timer failure must not block reaching the main UI.
  if (interactive && renderer && shell && !shouldSkipSplash(options)) {
    try {
      const splash = mountTree(renderer, shell, splashTree());
      renderer.requestRender();
      await awaitSplash(SPLASH_MS, options.wait);
      unmountTree(shell, splash);
    } catch {
      // Ignore — proceed into the first chrome frame.
    }
  }

  const location = bootLocationFor(options.route);
  if (!interactive) {
    try {
      const result = await renderPipe(router, routes, location, (shown) =>
        renderBodyToText(shown.body, {
          width: width(),
          height: terminalRows(),
        }),
      );
      const stream = result.stream === 'stderr' ? process.stderr : output;
      stream.write(`${result.lines.join('\n')}\n`);
      if (result.exitCode !== undefined) process.exitCode = result.exitCode;
    } finally {
      runtime.store.clear();
    }
    return;
  }
  router.navigate(location.routeId, location.params, true, location.state);
  // Past the non-interactive return, `interactive` is true — which is exactly
  // the condition both were created under. Narrowed rather than asserted, so a
  // future change to that condition is a compile error, not a null deref.
  if (!renderer || !shell)
    throw new Error('bakers ui: the interactive kernel has no renderer');

  /**
   * BB-326 — teardown, in the one order that survives `destroy()`.
   *
   * Everything the screens still need is HARVESTED FIRST: `leave()` is what
   * lets the active screen read its own final state, and an
   * `InputRenderable.value` throws `EditBuffer is destroyed` the moment the
   * renderer is gone. The natural "tear down, then return the result" order is
   * a crash waiting for the first form that returns a value.
   *
   * The renderer is destroyed only when the kernel MADE it. An injected one
   * belongs to its test, which still wants to read the last frame after `q` —
   * and destroying someone else's renderer is not this function's business.
   */
  const finish = (): void => {
    if (closing) return;
    closing = true;
    if (spinnerTimer !== undefined) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
    trace?.close();
    autoRefresh?.close();
    active()?.leave();
    runtime.store.clear();
    renderer?.keyInput.off('keypress', onKeypress);
    renderer?.off(CliRenderEvents.RESIZE, draw);
    if (renderer) renderer.root.onMouse = undefined;
    if (renderer && shell) {
      // Every region's tree and the body's box, in that order — `regions` made
      // them, so `regions` takes them down. The shell is the kernel's, and it
      // goes last: destroying a parent before its children leaves their Yoga
      // nodes unfreed.
      regions.destroy();
      renderer.root.remove(shell);
      shell.destroy();
    }
    if (ownsRenderer) renderer?.destroy();
    resolveDone?.();
  };

  const dispatchAction = (action: ScreenAction | undefined): void => {
    if (!action) return;
    if (action.type === 'navigate')
      router.navigate(action.routeId, action.params ?? {}, true, action.result);
    else if (action.type === 'back') router.back(action.result);
    else draw();
  };

  /**
   * BB-285's reload, now with two triggers and still ONE body.
   *
   * `R` runs it behind `!handled`; the `.bakers/ui-refresh` watcher runs it with no
   * key in front of it. Screens that declare no `reload` resolve to `null`, so a
   * bump while a form, picker, or modal is open does nothing.
   */
  const runReload = (): void => {
    const screen = reloadable();
    if (!screen) return;
    screen.reload?.(context());
    draw();
  };

  const handleKey = (key: string): void => {
    if (key === 'ctrl+c') {
      finish();
      return;
    }
    const handled = active()?.handleInput(key, context()) ?? false;
    if (key === 'q' && !active()?.modal) {
      finish();
      return;
    }
    if (key === 'escape') {
      const screen = active()?.id ?? '(none)';
      if (handled) {
        trace?.route({ key, screen, handled, outcome: 'screen-action' });
        dispatchAction(
          (
            active() as Screen & { takeAction?: () => ScreenAction | undefined }
          )?.takeAction?.(),
        );
        return;
      }
      // `back()` false means there was nowhere to go back TO, and `fallback()`
      // re-enters the current route — which is why Escape on the root dashboard
      // correctly does nothing visible. The trace records which of the two ran,
      // because from the operator's chair they are indistinguishable.
      const went = router.back();
      if (!went) router.fallback();
      trace?.route({
        key,
        screen,
        handled,
        outcome: went ? 'router-back' : 'router-fallback',
      });
      return;
    }
    if (key === 'tab' || key === 'shift+tab') {
      if (handled) {
        dispatchAction(
          (
            active() as Screen & { takeAction?: () => ScreenAction | undefined }
          )?.takeAction?.(),
        );
        return;
      }
      const here = tabLocation();
      if (!here) {
        active()?.handleInput(key, context());
        return;
      }
      // BB-373 D5 — the location's own bar when it carries one, read through
      // the SAME expression the chrome draws from, so Tab cycles exactly the
      // entries the operator can see and click, contributed tabs included.
      const tabs = tabsOfLocation(here);
      const index = tabs.findIndex((tab) => tab.id === here.tab);
      const direction = key === 'tab' ? 1 : -1;
      const target = tabs[(index + direction + tabs.length) % tabs.length];
      if (!target) return;
      router.navigateTab(here.level, target.id);
      return;
    }
    if (!handled && key === 'R') {
      // `!handled` is load-bearing (BB-285 spec D3): a screen typing an `R` —
      // the Tickets search, a form field — keeps it as TEXT. `q` fires
      // regardless; the reload deliberately does not. The signal path has no key
      // and therefore no guard.
      runReload();
    }
    // BB-472 — `W` reaches the workspace switch from anywhere, on the same
    // `!handled` guard `R` uses: a screen typing a `W` — a search field, a form
    // — keeps it as text.
    if (!handled && key === 'W') {
      router.navigate(WORKSPACE_PICKER_ROUTE_ID, {}, true);
    }
    if (!handled && key === 'enter') {
      const shown = active()?.present(context());
      active()?.activate?.(shown?.selectedIndex ?? 0, context());
    }
    // The fallback scroll, on a screen that did not claim the key itself. Both
    // ends of the clamp are the scrollbar's: `scrollTop`'s setter floors at 0
    // and ceilings at `scrollHeight - viewportHeight`, so there is no kernel
    // arithmetic left here to disagree with the box.
    if (!handled && (key === 'down' || key === 'j')) {
      if (regions.body) regions.body.scrollTop += 1;
      draw();
    } else if (!handled && (key === 'up' || key === 'k')) {
      if (regions.body) regions.body.scrollTop -= 1;
      draw();
    } else if (
      !handled &&
      !active()?.modal &&
      (key === 'pagedown' || key === 'pageup') &&
      regions.body
    ) {
      const amount = Math.max(
        1,
        regions.body.verticalScrollBar.viewportSize - 1,
      );
      regions.body.scrollTop += key === 'pagedown' ? amount : -amount;
      draw();
    }
    if (!handled) dispatchAction(active()?.actionForInput?.(key, context()));
    dispatchAction(
      (
        active() as Screen & { takeAction?: () => ScreenAction | undefined }
      )?.takeAction?.(),
    );
  };

  /**
   * BB-326 — the ONE input seam. `keyEventToKeys` hands the parser's own
   * bytes straight back, so every screen, widget and form still compares
   * against the raw literals it always did.
   *
   * It returns a LIST because one parser event can carry more than one
   * keypress: a link that coalesces (mosh on the operator's phone) delivers an
   * Escape glued to the key after it, and the parser reports the pair as a
   * single ALT chord. `keyEventToKeys` splits that back apart — see its own
   * comment for why the split is decidable without a clock. `closing` is
   * re-checked per key, exactly as the pre-swap kernel re-checked it per token:
   * the first key of a pair may be the one that tears the cockpit down.
   *
   * The `try/catch` is not defensive tidiness: `InternalKeyHandler` SWALLOWS a
   * handler exception, and `consoleMode: 'disabled'` only stops it being
   * painted on top of the cockpit — it does not make it reach anybody. Without
   * this, a throw in a screen is a UI that stops responding and says nothing.
   */
  const onKeypress = (event: KeyEvent): void => {
    if (closing) return;
    try {
      const keys = keyEventToKeys(event);
      trace?.key(event, keys);
      for (const key of keys) {
        if (closing) break;
        handleKey(key);
      }
    } catch (error) {
      process.stderr.write(
        `bakers ui: keypress handler threw: ${String(error)}\n`,
      );
    }
  };

  /**
   * BB-326 — the mouse, as OpenTUI already parsed it. BB-340 Task 11 — and
   * routed to the renderable it lands on.
   *
   * `lib/mouse.ts` went with BB-326: the renderer decodes the SGR reports,
   * splits them off stdin and hands over a typed `MouseEvent`. `lib/hit-test.ts`
   * goes with this task (spec D6), and with it everything that used to happen
   * here — `row - 1 - chromeRows(shape)` to find a body line, `columnToSpan` to
   * find a tab, `rowToIndex` to find an entry. A click lands on a NODE now: the
   * chrome's own rows resolve theirs (`Kernel/chrome.ts`) and a selectable row
   * carries its own handler (see `bindRowClicks`), so the only thing left for
   * the root listener is the wheel, which belongs to no row at all.
   */
  const onMouse = (event: MouseEvent): void => {
    if (closing) return;
    if (event.type !== 'scroll') return;
    // BB-326 Step C — THE BOX ALREADY MOVED. Mouse events travel from the
    // hit renderable up the parent chain, and the body rows are inside the
    // ScrollBox, so `ScrollBoxRenderable.onMouseEvent` has applied the notch
    // (with its own acceleration and its own clamp) before this listener on
    // the ROOT is reached. Moving `scrollTop` again here would double every
    // wheel notch. All that is left is to repaint the window the new position
    // selects.
    if (active()?.modal) return;
    draw();
  };

  renderer.keyInput.on('keypress', onKeypress);
  // Mouse events bubble up the parent chain, so the ROOT is the one listener
  // that sees every click regardless of which row it landed on.
  renderer.root.onMouse = onMouse;
  renderer.on(CliRenderEvents.RESIZE, draw);
  // BB-376 — auto-refresh. Past the non-interactive return by construction, so
  // a piped run builds no watcher at all (spec D6) and the pipe keeps the
  // behaviour it always had. The debounce comes from the same seam the form
  // screens resolve, so a kernel test can make the window synchronous.
  autoRefresh = createRefreshSignal({
    dir: options.bakersDir,
    onSignal: runReload,
    debounce: options.debounce ?? timerDebounce,
    ...(options.watchDirectory !== undefined
      ? { watchDirectory: options.watchDirectory }
      : {}),
  });
  autoRefreshOn = autoRefresh !== undefined;
  draw();
  return done;
}
