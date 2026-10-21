import type { VNode } from '@opentui/core';
import type { ActionItem } from '../Component/footer-actions/index.js';
import {
  BODY_WINDOW_REGION,
  bodyWindowRoot,
  regionRoot,
} from '../Kernel/mount.js';

export type ScreenId = string;
export type ScreenAction =
  | {
      type: 'navigate';
      routeId: string;
      params?: Readonly<Record<string, string>>;
      result?: unknown;
    }
  | { type: 'back'; result?: unknown }
  | { type: 'redraw' };

/** Destination-owned presentation consumed by the terminal composition root. */
export interface ScreenPresentation {
  /**
   * BB-340 D1 — the screen's own surface, as a renderable TREE.
   *
   * This is the boundary the ticket exists to move: a destination hands over
   * nodes the renderer owns rather than rows of text somebody had to measure
   * into columns. Every node needs a stable, entity-derived `props.id` — see
   * `Kernel/mount.ts`, which patches by that id and throws on a missing or
   * repeated one — and the root is `region-body-window` (`BODY_WINDOW_REGION`),
   * the id the kernel mounts the body slot's tree under.
   */
  readonly body: VNode;
  readonly selectable: number;
  readonly selectedIndex: number;
  /**
   * BB-340 Task 11 — the NODE of each selectable row, in selection order.
   *
   * What a click needs to know, and the successor of the geometry it replaced:
   * the kernel used to find the entry under the pointer by counting chrome rows
   * off a terminal row and mapping the body line back through a `selectedRow`
   * (`lib/hit-test.ts`, deleted in that task — spec D6). A click lands on a node
   * now, so the question is "which entry is this node", and the answer is a
   * position in this list.
   *
   * Task 12 made it the successor of the SCROLL geometry too. `selectedRow` was
   * the absolute physical row of the highlight, and it was the last row NUMBER
   * on the contract; the kernel keeps the cursor in view by asking the layout
   * where `rowIds[selectedIndex]` ended up, so a screen no longer has to know
   * how many rows its own header takes.
   *
   * The ids are the entities' own — `ticket-row-<uuid>`, never `row-7` (D4/R4) —
   * so a re-sorted or re-paged list carries each row's meaning with its row.
   * A screen with nothing selectable publishes none.
   */
  readonly rowIds?: readonly string[];
  readonly cursorMode?: 'select' | 'scroll';
  readonly title?: string;
  readonly meta?: string;
  /**
   * Complete destination-specific header content, when more than title/meta —
   * BB-340 D1, and a TREE since the 2026-08-13 review.
   *
   * ONE COLUMN, ONE CHILD PER ROW. That is the whole contract, and it is what
   * lets the header be a tree at all: the kernel needs the header's ROW COUNT
   * before Yoga has run — `chromeHeight` sizes the body window from it — and a
   * column's children are that count without a layout pass (`chrome.ts`'s
   * `headerRowCount`). Measuring the rows was never necessary; counting them was,
   * and that is why this was the last `string[]` on the contract rather than a
   * thing nobody got round to.
   *
   * The node is placed in the header box WHOLE, so the ids that reach the frame
   * are the screen's own: the kernel neither renames the rows nor re-wraps them,
   * and it publishes no click intent over them (`Kernel/chrome.ts`'s
   * `headerBox`). The ticket detail is the worked example — its header is
   * `ticket-detail-header-title`, `ticket-detail-header-labels`,
   * `ticket-detail-header-state`, `ticket-detail-header-assigned` and
   * `ticket-detail-header-created`, in that order, plus a trailing
   * `ticket-detail-header-mode` row last in a compact view, each found in the
   * composed frame under exactly that id (`Entity/ticket/Screen/ticket-detail.ts`'s
   * `headerTree`). That is what lets a screen grow a header row — the Labels row was
   * one, and Assigned / Created by follow State — without the kernel learning
   * anything about labels or identities, and what a row that means something would
   * need to take its own click.
   *
   * AND WHAT A GROWN ROW COSTS, which is the reason this example is worth keeping
   * accurate: `chromeHeight` counts these children, so each one takes a body row off
   * every frame of that screen. The identity rows are why the ticket screen's
   * chrome is taller than every other bar screen's.
   *
   * No header row takes one TODAY. The one that did was the ticket detail's own
   * tab bar, drawn as the box's last content row; BB-346 made the ticket's
   * sections entries of the top-tab registry, so that bar is the chrome's bar row
   * now, below the box, and it resolves the pointer through the renderer like
   * every other level's.
   */
  readonly header?: VNode;
  readonly status?: string;
  /**
   * Transient action result, shown at the footer's right edge (`✓ tunnel started`).
   * Standing notices stay on {@link status}.
   */
  readonly toast?: string;
  /**
   * Screen-specific footer actions (BB-375) — structured {@link ActionItem}
   * chips rendered by `Component/footer-actions` above the kernel basics.
   * Kernel owns Esc/q/↑↓/Enter via the same action-item primitives.
   */
  readonly actions?: readonly ActionItem[];
}

export interface NonInteractivePresentation {
  readonly lines: readonly string[];
  readonly stream?: 'stdout' | 'stderr';
  readonly exitCode?: number;
}

/**
 * What {@link presentation} needs to know that the presentation does not carry.
 *
 * BB-340 Task 9c — MEASURED, on the first popup that handed over a tree. A
 * converted body is rooted through `bodyWindowRoot`, which insets it by the two
 * columns `styleVisibleLines` bakes into the text of every BRIDGED row. A popup
 * is not the body window: `Kernel/chrome.ts`'s `modalTree` puts the body inside
 * a box that already spends a border and a column of padding on each side, so
 * the same inset put a converted popup's fields two columns right of where the
 * same popup's rows sit (captured on a real renderer: column 4 against column
 * 2). The flag chooses the ROOT and nothing else — the root ID is the same
 * either way, because the kernel mounts the same slot for both.
 *
 * It is not part of {@link ScreenPresentation} and is stripped before the
 * options are spread: `Screen.modal` is the one declaration the kernel reads to
 * decide the frame, and a second copy on the presentation would be a second
 * thing to disagree with it.
 */
interface PresentationOptions {
  readonly modal?: boolean;
  /**
   * Framed list/detail bodies (BB-375) — root without the body-window inset
   * so the FRAME outer edge aligns with the chrome header box. Popups already
   * use `modal` for the same inset-free root.
   */
  readonly flush?: boolean;
}

/**
 * A screen's presentation — BB-340 D1, and since Task 12 the ONLY surface.
 *
 * It used to take `string[] | VNode` and bridge the rows into the same tree, so
 * that there was exactly one render path while the conversion was in flight
 * (D5). Every screen hands over renderables now, so the union is gone and with
 * it the bridge: a `string[]` reaching here is a compile error rather than
 * something quietly painted as text (spec A1).
 *
 * The tree is rooted HERE rather than by the screen (BB-340 Task 6). The root
 * id belongs to the kernel — it is the slot the kernel already stands an empty
 * tree in, and `patchTree` reuses that standing box only when the id matches —
 * while a component may not import the kernel to learn it
 * (`tests/boundary.test.ts` G5). Rooting it once here is what keeps that id out
 * of thirteen screens without making any of them reach across the boundary for
 * it.
 */
export const presentation = (
  surface: VNode,
  {
    modal = false,
    flush = false,
    ...options
  }: Partial<Omit<ScreenPresentation, 'body'>> & PresentationOptions = {},
): ScreenPresentation => ({
  body:
    modal || flush
      ? regionRoot(BODY_WINDOW_REGION, surface)
      : bodyWindowRoot(surface),
  selectable: 0,
  selectedIndex: 0,
  ...options,
});

export interface ScreenContext {
  readonly store?: import('../Data/session-store.js').SessionStore;
  readonly sessionGeneration: number;
  readonly requestDraw: () => void;
  readonly isActive: () => boolean;
  readonly params?: Readonly<Record<string, string>>;
  readonly navigationState?: unknown;
  readonly project?: Readonly<{ id: string; name: string; slug: string }>;
  /** BB-377 — the open user, when the route carries `userId`. */
  readonly user?: Readonly<{ id: string; name: string }>;
  /** Runtime dependencies are supplied by the composition root, never globals. */
  readonly services?: import('../types.js').RendererServices;
  readonly nowSeconds?: () => number;
  readonly contexts?: import('../Routing/context.js').ContextBag;
  readonly options?: import('../types.js').TuiOptions;
  readonly navigate?: (
    routeId: string,
    params?: Readonly<Record<string, string>>,
    state?: unknown,
  ) => void;
  readonly back?: (result?: unknown) => boolean;
  /**
   * BB-326 — put one string in the OPERATOR'S clipboard (OSC 52).
   *
   * On the context rather than in `services`, because it is a property of the
   * terminal the kernel owns and not of the control-plane connection; and on
   * the context rather than reached for, because a screen may not import the
   * kernel (`tests/boundary.test.ts` G5).
   *
   * Absent on the non-interactive path, which has no terminal at all.
   */
  readonly copyToClipboard?: import('../types.js').ClipboardWriter;
  /**
   * The terminal's width in columns, as the kernel last measured it — the one
   * geometry fact a layout breakpoint needs before Yoga has run. Absent on the
   * non-interactive path, which has no terminal; a reader takes a default.
   */
  readonly terminalColumns?: number | undefined;
}

export interface Screen {
  readonly id: ScreenId;
  readonly busy?: boolean;
  enter(context: ScreenContext): void;
  leave(): void;
  /**
   * F5's deliberate exception — the pipe's own text, and NOT a row surface.
   *
   * `ScreenPresentation` carries no `string[]` any more (spec A1): a screen that
   * draws hands over renderables. This is a different question with a different
   * answer — what four screens print when `bakers ui` is piped, which is a report
   * rather than a picture of a terminal. Its rows and the screen's tree come
   * from ONE traversal, guarded by an equality test per screen, so the two
   * cannot describe different data.
   */
  renderNonInteractive?(context: ScreenContext): string[];
  nonInteractive?(context: ScreenContext): NonInteractivePresentation;
  present(context: ScreenContext): ScreenPresentation;
  handleInput(input: string, context: ScreenContext): boolean;
  /**
   * BB-285: the ONE capability declaration — "I can re-read my data". Its
   * PRESENCE is the opt-in: the kernel binds `R` and renders the footer hint
   * for exactly the screens that implement this. A screen with nothing to
   * re-read (a form, the picker, the run detail) declares NOTHING, so it can
   * never show a dead control (AC-3).
   */
  reload?(context: ScreenContext): void;
  commandForInput?(input: string): string | undefined;
  actionForInput?(
    input: string,
    context: ScreenContext,
  ): ScreenAction | undefined;
  /** Generic terminal-composition facts owned by the destination. */
  readonly modal?: boolean;
  /** Defaults to a framed, inset scrolling body; false keeps scrolling flush. */
  readonly bodyFrame?: boolean;
  readonly document?: unknown;
  /** Temporary legacy-frame selector consumed without destination branching. */
  readonly frameId?: string;
  /** Optional list intents used by keyboard and mouse composition. */
  select?(index: number, context: ScreenContext): boolean;
  activate?(index: number, context: ScreenContext): boolean;
  /** Receives a typed result when a child destination returns. */
  receiveResult?(result: unknown, context: ScreenContext): void;
  reset(): void;
}

export abstract class BaseScreen implements Screen {
  abstract readonly id: ScreenId;
  enter(_context: ScreenContext): void {}
  leave(): void {}
  /**
   * ABSTRACT since BB-340 Task 12 — a screen says what it shows, in one way.
   *
   * The base used to carry a default that read the screen's rows through an
   * optional `render()` and bridged them. With the row surface off the contract
   * there is nothing left to default TO: a body is a tree, and only the screen
   * can build its own. Declared abstract rather than left as a throwing stub, so
   * a screen that provides neither is a compile error instead of a blank frame
   * at runtime.
   */
  abstract present(context: ScreenContext): ScreenPresentation;
  handleInput(_input: string, _context: ScreenContext): boolean {
    return false;
  }
  reset(): void {}
}
