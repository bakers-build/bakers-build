import { BoxRenderable, h, type MouseEvent, type VNode } from '@opentui/core';
import {
  type ActionItem,
  type ActionSegment,
  footerActions,
  footerKey,
  withActionPipes,
} from '../Component/footer-actions/index.js';
import { type TabLocation, tabPartsFor } from '../Component/top-tabs/index.js';
import { resolveBbVersion } from '../lib/version.js';
import {
  BACKGROUND_ACTIVE,
  BORDER,
  BORDER_EMPHASIS,
  columnNode,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  FOREGROUND_HIGHLIGHT,
  isLeftPress,
  textNode,
} from '../lib/vnode.js';
import type { ScreenPresentation } from '../Screen/screen.js';
import { BODY_WINDOW_REGION, childrenOf, regionRoot } from './mount.js';

/**
 * BB-340 — the chrome the KERNEL owns, as renderables.
 *
 * This is what `Kernel/frame.ts`'s `composeFrame` was, minus the body: the
 * header box, the top-tab bar, the separator, the status footer and the modal
 * box. The kernel keeps the frame (ticket decision 4) — repeating the chrome
 * across thirteen screens is the mistake the row pool has just stopped making,
 * and `title`/`meta`/`status` stay plain `string` for the same reason (spec D2):
 * they are single-line LABELS the kernel places into chrome it owns, not a
 * painted surface.
 *
 * Each function returns a VNode COLUMN of the rows the composition always
 * produced, rooted through `regionRoot` — which gives it the `region-<id>`
 * identity the kernel mounts it under.
 *
 * BB-340 Task 12 — NOTHING HERE COMPOSES A STRING ANY MORE, and that is what
 * finally let `lib/ansi.ts` and `lib/styled-text.ts` go. Three templates died
 * here and each is now a prop the renderer resolves:
 *
 *  - `'╭─ ╳ bakers.build ' + '─'.repeat(width - displayWidth(prefix) - 1) + '╮'` and its
 *    `'│ ' + fitLine(line, width - 4) + ' │'` rows are ONE `BoxRenderable` with
 *    `border` and a `title` (see {@link headerBox}). The box draws the prefix
 *    byte for byte, `⚡`'s two columns included, and clips a row that does not
 *    fit at the box's own edge.
 *  - the footer is padding without a fill band (BB-375); selection/status no
 *    longer use inverse video (see {@link footerTree}).
 *  - the modal box's border became the renderer's in Task 9b, which is what let
 *    a converted screen's tree go inside it at all (see {@link modalTree}).
 *
 * BB-375: body ScrollBox is a rounded {@link BORDER} frame with no fill;
 * active tab + selection use {@link BACKGROUND_ACTIVE} + {@link FOREGROUND_ACTIVE};
 * header, tab bar and footer carry **no** fill band.
 *
 * Pure by construction: no stream, no renderer, no `process`, no clock. What is
 * deliberately NOT here is the terminal control that used to surround the lines
 * — the `\x1b[H\x1b[2J` that opened every frame and the modal's per-row
 * `\x1b[<row>;<col>H`. Those position bytes on a screen rather than compose a
 * line; the renderer owns them now, and the modal box's ORIGIN is the one thing
 * the kernel still places by hand (see `tui-kernel.ts`'s `draw`).
 */
export interface ChromeInput {
  /** The screen's title — the header box's first row. */
  readonly title?: string | undefined;
  /** The meta row under the title. */
  readonly meta?: string | undefined;
  /** Complete destination-specific header content, when more than title/meta. */
  readonly header?: VNode | undefined;
  /** The footer's status text, or the box's last row on a modal. */
  readonly status?: string | undefined;
  /** Transient action result at the right edge (`✓ tunnel started`). */
  readonly toast?: string | undefined;
  /**
   * Screen-specific footer action-items above the kernel basics (BB-375).
   * Empty/omitted → no actions row.
   */
  readonly actions?: readonly ActionItem[] | undefined;
  /** The active top-tab location, or `null` when the screen has no tab bar. */
  readonly tab: TabLocation | null;
  /**
   * `Screen.busy` — while true the footer keeps the key row and paints a spinner
   * at the right edge. The body is not replaced.
   */
  readonly busy: boolean;
  /**
   * Clock for the busy spinner and notice appear, injected by the kernel.
   * Chrome itself stays clock-free; absent (tests that do not care) uses frame 0.
   */
  readonly nowMs?: number | undefined;
  /**
   * Milliseconds since the current toast appeared. Drives the right-edge mark
   * (`·` → `✓`). Absent ⇒ the toast is fully appeared.
   */
  readonly toastAgeMs?: number | undefined;
  /** Whether the active screen declares `reload()` (BB-285 spec D4). */
  readonly reloadable: boolean;
  /**
   * BB-376 D7 — whether a `.bakers/ui-refresh` watcher is live.
   *
   * OPTIONAL, unlike `reloadable`: every composition test builds a `ChromeInput`
   * literal, and a required field would have made adding a footer marker a
   * rewrite of a dozen fixtures. Absent reads as off, which is what a cockpit
   * outside any project is.
   */
  readonly autoRefresh?: boolean | undefined;
  /** `Screen.modal` — chooses the boxed popup over the full-screen chrome. */
  readonly modal: boolean;
  /** Terminal columns, as the kernel's `width()` floor-clamps them. */
  readonly width: number;
  /**
   * BB-340 Task 11 — what a click on the top tab bar MEANS, supplied by the
   * kernel.
   *
   * The chrome resolves WHICH tab the pointer landed on (spec D6); what that
   * click then DOES — navigate — belongs to the kernel, the only thing here
   * holding a router. Absent in every pure composition test, where a click has
   * nowhere to go.
   *
   * It is the only such intent left. The header box had a second one until the
   * header became a tree: see the click note in {@link headerBox}.
   */
  readonly onTabClick?: ((tab: string) => void) | undefined;
  /**
   * BB-472 — the active `bb_workspace`'s NAME (never its uuid — noise in a
   * status bar), read once at boot beside `readOwnConductor()`. The cockpit is
   * a fixed value for a process lifetime (one conductor per workspace is the
   * operating model), so an
   * operator running several at once needs this to tell them apart on sight.
   * Absent ⇒ no suffix, which is every existing fixture and every connection
   * that resolved with no discoverable workspace name.
   */
  readonly workspace?: string | undefined;
}

/** Braille frames for the footer busy spinner, 80 ms apart. */
export const FOOTER_SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;
export const FOOTER_SPINNER_MS = 80;

export const footerSpinnerFrame = (nowMs = 0): string =>
  FOOTER_SPINNER_FRAMES.at(
    Math.floor(nowMs / FOOTER_SPINNER_MS) % FOOTER_SPINNER_FRAMES.length,
  ) ?? '⠋';

/** How long the notice mark stays a `·` before becoming `✓`. */
export const NOTICE_ANIM_MS = FOOTER_SPINNER_MS;

/** Right-edge notice: ` · text` then ` ✓ text`. */
export const footerNoticeAppear = (
  text: string,
  ageMs = NOTICE_ANIM_MS,
): string => ` ${ageMs < NOTICE_ANIM_MS ? '·' : '✓'} ${text}`;

/**
 * A {@link ChromeInput} from the screen's presentation plus the five facts the
 * kernel owns.
 *
 * Here rather than in the kernel because the header's row COUNT sizes the chrome
 * and therefore the body window: `draw` needs `chromeHeight` and `bodyRowsFor`
 * off the same input it composes the chrome from, and a second hand-built copy of
 * that input is how the two come to disagree.
 */
export const chromeInputFor = (
  shown: Pick<
    ScreenPresentation,
    'title' | 'meta' | 'header' | 'status' | 'toast' | 'actions'
  >,
  frame: Omit<
    ChromeInput,
    'title' | 'meta' | 'header' | 'status' | 'toast' | 'actions'
  >,
): ChromeInput => ({
  ...frame,
  title: shown.title,
  meta: shown.meta,
  header: shown.header,
  status: shown.status,
  toast: shown.toast,
  actions: shown.actions,
});

/**
 * BB-326 Step B — the parts of a frame the caller lays out.
 *
 * `chrome` is the header box plus, when the screen has one, the top-tab bar,
 * plus the blank separator; `body` is the visible window; `footer` is the status
 * row. A modal has none of those: its header, body and status are stacked inside
 * one bordered box, so it is one `modal` region and the caller places the box.
 */
export type FrameRegionId = 'chrome' | 'body' | 'footer' | 'modal';

/**
 * The modal box's OUTER width in columns. Exported because the caller has to
 * centre the box horizontally and would otherwise re-derive this geometry in a
 * second place, where it could drift.
 */
export const modalBoxWidth = (width: number): number =>
  Math.min(60, width - 8) + 4;

/**
 * Status row only — {@link footerTree} emits one by default (BB-375). Body
 * ScrollBox is the framed scroll surface; footer has no wash spacer. Screens
 * that publish {@link ChromeInput.actions} add one actions row above basics —
 * see {@link footerRowsFor}.
 */
export const FOOTER_ROWS = 1;

/**
 * Footer rows for this chrome input (1, or 2 when `actions` is set:
 * actions + basics).
 */
export const footerRowsFor = (input: Pick<ChromeInput, 'actions'>): number =>
  (input.actions?.length ?? 0) > 0 ? FOOTER_ROWS + 1 : FOOTER_ROWS;

/**
 * The header box's content when the screen states none: the title/meta pair, or
 * one joined row inside a modal box.
 *
 * Still strings, and legitimately: these are the two single-line LABELS the
 * contract keeps as `string` by spec D2, placed by the chrome that owns them.
 * What D1 is about is the SURFACE a screen hands over — see {@link headerFor}.
 *
 * BB-472: a modal carries no `headerBox`, so it never got the workspace name
 * `headerBox`'s own `title` prop appends for a full screen (below) — a modal
 * opened over a screen showing "keytec" gave no hint it was still "keytec"
 * once its own box took over the frame. The workspace joins the same row as
 * title/meta rather than a new one, because {@link headerRowCount} counts rows
 * off this array and a screen's modal box height is sized from that count.
 */
const defaultHeaderRows = (input: ChromeInput): readonly string[] =>
  input.modal
    ? [
        [
          input.title,
          input.workspace ? `workspace: ${input.workspace}` : undefined,
          input.meta,
        ]
          .filter((part): part is string => !!part && part.length > 0)
          .join(' · '),
      ]
    : [input.title ?? '', input.meta ?? ''];

/**
 * The header box's content, as ONE node — spec D1, and the clause of A1 that the
 * 2026-08-13 review found unmet.
 *
 * `ScreenPresentation.header` was `readonly string[]` until then: the last row
 * surface on the screen contract, kept because {@link chromeHeight} needs the
 * header's ROW COUNT before Yoga has run and a tree cannot be measured without a
 * layout pass. It never needed a layout — a column's CHILDREN are that count, one
 * child per row, which is what {@link headerRowCount} reads. So the strings go
 * the way the body's went, and with them the last coordinate translation in the
 * chrome (see the click note in {@link headerBox}).
 *
 * The screen's node is passed through WHOLE, never unwrapped: it is the screen's
 * subtree with the screen's own ids, and the box places it. `region` names the
 * frame the default is being built for, so the kernel's own rows keep the
 * `chrome-header-<i>` / `modal-header-<i>` ids they have always had — two trees
 * are mounted at once and each has to name its rows for itself.
 */
export const headerFor = (
  input: ChromeInput,
  region: 'chrome' | 'modal',
): VNode =>
  input.header ??
  columnNode(
    `${region}-header-rows`,
    ...defaultHeaderRows(input).map((line, index) =>
      textNode({
        id: `${region}-header-${index}`,
        content: line,
        // The `ESC[1m` the title row opened with.
        bold: index === 0,
        fg: index === 0 ? FOREGROUND_HIGHLIGHT : FOREGROUND,
      }),
    ),
  );

/**
 * How many ROWS the header box will draw — one per child of {@link headerFor}'s
 * node.
 *
 * The one fact {@link chromeHeight} needs and the only reason the header was a
 * `string[]`. It is not a measurement (R5): nothing here looks at a character.
 * The rule it rests on is stated where a screen can read it — one child, one row
 * — and asserted against real Yoga in `tests-bun/Kernel/layout.test.ts`, which
 * compares the laid-out chrome pane against this count.
 */
export const headerRowCount = (input: ChromeInput): number =>
  input.header === undefined
    ? defaultHeaderRows(input).length
    : childrenOf(input.header).length;

/**
 * The header box's frames: one row above its content, one below.
 *
 * Exported since BB-340 Task 12, when the frame stopped being two composed
 * rows and became the `BoxRenderable`'s own border. The tests that count the
 * chrome's rows off the composed tree (`tests/chrome-rows.ts`) can no longer see
 * those two — a border carries no node and no text — so they read the number
 * here rather than restating a 2 of their own. It is checked against real Yoga
 * in `tests-bun/Kernel/layout.test.ts`, which compares the laid-out chrome pane
 * against exactly that count.
 */
export const BOX_FRAME_ROWS = 2;

/**
 * Blank rows between the tab bar (or header box) and the body.
 * Zero when a framed panel's top border is the content edge (BB-375).
 */
export const SEPARATOR_ROWS = 0;
/**
 * Blank rows between the header box and the tab bar — pulls tabs toward the
 * body and away from the header (BB-375).
 */
export const HEADER_TAB_GAP_ROWS = 1;
/** The tab-bar row itself — drawn only by a screen that HAS a bar. */
const TOP_TAB_ROWS = 1;
const CHROME_TAB_GAP_ID = 'chrome-tab-gap';

/**
 * The chrome this frame will draw, in rows.
 *
 * The number the body window is sized against, and therefore where the body
 * starts. It used to be read through `lib/hit-test.ts`'s `chromeRows`, because
 * the click mapping needed the same answer; BB-340 Task 11 deleted that module
 * (spec D6) — a click lands on a node now and skips no rows — so the definition
 * comes home to the composition it describes.
 *
 * It is not a second copy of {@link chromeTree}: it is checked AGAINST it.
 * `tests/Kernel/chrome.test.ts` pins the composed tree's row count against this
 * number with a hand-derived floor, and `tests-bun/Kernel/layout.test.ts` checks
 * the laid-out pane against the same composed tree. A row added to `chromeTree`
 * and not here fails both.
 *
 * BB-239/BB-255 are why it is a FUNCTION of the screen, and two of the three
 * reasons they named still hold. The ticket detail carries a labels row, so its
 * header box is one row taller than the default; the run detail screen has no bar
 * at all (`input.tab === null`), so it is a shorter value again. There is no
 * `BOX_ROWS` constant that can express both.
 *
 * The third reason is HISTORY as of BB-346: the ticket detail used to draw its
 * own tab bar inside the header box, which was why it alone had no bar row under
 * it. It no longer does — its sections are entries of the `ticket` level and the
 * chrome draws that bar in the same row as every other level's — so the ticket
 * screen is composed exactly like a project screen plus its labels row. The two
 * reasons above are what is left, and both are read from the screen, never
 * branched on which screen it is.
 */
export const chromeHeight = (input: ChromeInput): number =>
  BOX_FRAME_ROWS +
  headerRowCount(input) +
  (input.tab !== null ? HEADER_TAB_GAP_ROWS + TOP_TAB_ROWS : 0) +
  SEPARATOR_ROWS;

/**
 * BB-326 Step C — the body window: everything the chrome and the status row
 * leave, and no magic number.
 *
 * This replaced the kernel's `Math.max(3, terminalRows() - 8)`. Eight was a
 * six-row chrome plus a one-row footer plus one, with all three unwritten: on a
 * screen with no tab bar the chrome is FIVE rows, so the window was a row
 * shorter than the space it had, and the spare row was why the frame stopped one
 * row above the bottom of the terminal. Stated as a subtraction, the frame is
 * exactly as tall as the terminal and the status footer sits on its last row.
 *
 * A modal has no window — it is one boxed region — so the value is only ever
 * read for a normal frame; it stays defined there so a caller need not branch.
 */
export const bodyRowsFor = (input: ChromeInput, terminalRows: number): number =>
  Math.max(1, terminalRows - chromeHeight(input) - footerRowsFor(input));

/** The row ids the chrome composes, named rather than numbered. */
const CHROME_SEPARATOR_ID = 'chrome-separator';
/**
 * The header box itself — one node where `chrome-top` and `chrome-bottom` used
 * to be two composed rows. Exported because the tests that read the chrome's
 * rows off the tree have to know which child is the box whose border they cannot
 * see.
 */
export const CHROME_HEADER_BOX_ID = 'chrome-header-box';
/** The tab-bar row — the box the top tabs are laid out in. */
export const TAB_BAR_ID = 'chrome-tab-bar';
/**
 * ONE TAB'S OWN NODE, and the whole point of Task 11: the id names the tab, so
 * "which tab did the pointer land on" is answered by the renderer's hit test
 * rather than by mapping a column onto a span map the composition published
 * beside itself.
 */
export const tabNodeId = (tab: string): string => `${TAB_BAR_ID}-tab-${tab}`;

/**
 * The top-tab bar: one node per tab, and the row that resolves a click to it.
 *
 * The handler sits on the ROW rather than on each tab because the bar is what
 * knows the pieces: the child under the pointer is `event.target`, and its id is
 * that tab's own. A click on the join between two tabs, or on the row's empty
 * space past the last one, therefore resolves to no tab and is inert — the same
 * answer the gaps between the old column spans gave, without a second layout to
 * keep in step.
 */
const tabBarNode = (input: ChromeInput, tab: TabLocation): VNode => {
  const parts = tabPartsFor(tab);
  return h(
    BoxRenderable,
    {
      id: TAB_BAR_ID,
      flexDirection: 'row',
      height: 1,
      flexShrink: 0,
      // No bar fill — only the active tab paints {@link BACKGROUND_ACTIVE}.
      onMouse: (event: MouseEvent): void => {
        if (!isLeftPress(event)) return;
        const hit = parts.find(
          (part) =>
            part.tab !== undefined && tabNodeId(part.tab) === event.target?.id,
        );
        if (hit?.tab !== undefined) input.onTabClick?.(hit.tab);
      },
    },
    // The leading blank the bar was written with (`fitLine(' ' + bar, width)`).
    // A node of its own so it belongs to no tab, exactly as column 0 did.
    textNode({ id: `${TAB_BAR_ID}-pad`, content: ' ', bold: true }),
    ...parts.map((part, index) =>
      part.tab === undefined
        ? textNode({
            id: `${TAB_BAR_ID}-join-${index}`,
            content: part.text,
            bold: true,
          })
        : textNode({
            id: tabNodeId(part.tab),
            content: part.text,
            bold: true,
            // BB-375 — active tab: BACKGROUND_ACTIVE wash + FOREGROUND_ACTIVE fg.
            // Idle tabs must still state DEFAULT_BACKGROUND so patchTree clears
            // a prior active wash when the selection moves.
            ...(part.tab === tab.tab
              ? { fg: FOREGROUND_ACTIVE, bg: BACKGROUND_ACTIVE }
              : { bg: DEFAULT_BACKGROUND }),
          }),
    ),
  );
};

/**
 * The header box — a real `BoxRenderable`, since BB-340 Task 12.
 *
 * The top row is the box's own `title`, and that is not a near-enough
 * substitute: measured on a real renderer, `title: ' ╳ bakers.build '` with
 * `titleAlignment: 'left'` and a rounded border draws `╭─ ╳ bakers.build ─…─╮` —
 * character for character what the template wrote, `⚡`'s two columns included.
 * `tests/pty/verify-anchor.mjs` matches the cockpit's surface on that prefix, so
 * "near enough" would have been a failed driver rather than a nuance.
 *
 * BB-375: header box has **no** `backgroundColor` (no fill token); border
 * stays {@link BORDER} and `╳ bakers.build` keeps {@link BORDER_EMPHASIS} on the title run.
 *
 * WHERE THE HEADER'S CLICK WENT. The box used to publish an
 * `onHeaderClick(column, keptWidth)` on every one of its rows, because the
 * screen-owned bar was drawn as the last row and a STRING has no children the
 * renderer can hit: the click arrived as a buffer column, the box shifted it by
 * its own two frame columns, and the screen looked the column up in a span map it
 * published beside its own text. That was the last coordinate translation in the
 * chrome. A header row is a NODE now, so nothing inside this box needs a column
 * looked up at all — and the bar that used to need it is not in the box any more
 * either: since BB-346 the chrome composes it as its own row of one node per
 * tab, which resolves its own click, the mechanism the top tab bar has used since
 * Task 11. The span map, the `keptWidth` and the shift are all gone with it.
 */
const headerBox = (header: VNode, workspace?: string): VNode =>
  h(
    BoxRenderable,
    {
      id: CHROME_HEADER_BOX_ID,
      border: true,
      // `rounded` IS `╭ ╮ ╰ ╯ ─ │` — the six characters the templates drew.
      borderStyle: 'rounded',
      borderColor: BORDER,
      // The spaces are the template's: `'╭─ '` before and `' '` after, which the
      // box reproduces by drawing the title verbatim into the top border run.
      // BB-472: an active workspace appends ` — <name> ` — one operator-facing
      // string, never a second title node the border would have to re-measure.
      title: workspace ? ` ╳ bakers.build — ${workspace} ` : ' ╳ bakers.build ',
      titleColor: BORDER_EMPHASIS,
      titleAlignment: 'left',
      flexDirection: 'column',
      flexShrink: 0,
      // The ` ` of `'│ ' … ' │'`, on both sides.
      paddingLeft: 1,
      paddingRight: 1,
    },
    header,
  );

/** The header box, the tab bar and the separator, as one column. */
export function chromeTree(input: ChromeInput): VNode {
  const tabGap =
    input.tab !== null
      ? Array.from({ length: HEADER_TAB_GAP_ROWS }, (_row, index) =>
          textNode({
            id:
              index === 0 ? CHROME_TAB_GAP_ID : `${CHROME_TAB_GAP_ID}-${index}`,
            content: '',
          }),
        )
      : [];
  return regionRoot(
    'chrome',
    headerBox(headerFor(input, 'chrome'), input.workspace),
    // Air between header box and tabs — tabs read with the body (BB-375).
    ...tabGap,
    ...(input.tab ? [tabBarNode(input, input.tab)] : []),
    // Blank rows between the chrome and the body: they were the second `\n` of
    // the tab bar's write, and the whole of the bare `write('\n')` without one.
    // They belong to the CHROME — `chromeHeight` counts them there, and the body
    // region has to start where the body's first row is painted. BB-375 keeps
    // SEPARATOR_ROWS at 0 when the framed panel top border is the content edge.
    ...Array.from({ length: SEPARATOR_ROWS }, (_row, index) =>
      textNode({
        id:
          index === 0 ? CHROME_SEPARATOR_ID : `${CHROME_SEPARATOR_ID}-${index}`,
        content: '',
      }),
    ),
  );
}

/**
 * Screen key ladders are ignored — the kernel owns `↑↓ │ Enter │ Esc:back │
 * q:quit`. A short notice/error (no navigation glyphs) becomes a muted prefix.
 */
const footerNotice = (status: string | undefined): string => {
  const trimmed = status?.trim() ?? '';
  if (trimmed === '') return '';
  if (/↑↓|q\s*quit|Esc(?:\s|:)|Tab\s+tabs/i.test(trimmed)) return '';
  return trimmed;
};

/**
 * Status footer (BB-375): optional screen actions + kernel basics. No wash
 * spacer — the body ScrollBox is the framed scroll surface. Screens publish
 * {@link ActionItem} lists; chrome renders them through {@link footerActions}.
 * Standing notices prefix the keys; action toasts sit at the right edge,
 * same slot as the busy spinner.
 */
export function footerTree(input: ChromeInput): VNode {
  const actions = footerActions(
    'footer-actions',
    input.actions ?? [],
    input.width,
  );
  const actionsRow = actions === null ? [] : [actions];

  const segments: ActionSegment[] = [];
  const standing = footerNotice(input.status);
  if (standing !== '') {
    segments.push([
      textNode({
        id: 'footer-notice',
        content: standing,
        fg: BORDER,
      }),
    ]);
  }
  const toast = input.toast?.trim() ?? '';
  segments.push([
    textNode({
      id: 'footer-ver',
      content: `bakers ${resolveBbVersion()}`,
      fg: BORDER,
    }),
  ]);
  if (input.reloadable) {
    // BB-376 D7 — mark when auto-refresh is armed.
    segments.push(
      footerKey(
        'footer-reload',
        'R',
        input.autoRefresh === true ? ':reload (auto)' : ':reload',
      ),
    );
  }
  segments.push([
    textNode({
      id: 'footer-nav',
      content: '↑↓',
      fg: FOREGROUND,
    }),
  ]);
  segments.push(footerKey('footer-enter', 'Enter'));
  segments.push(footerKey('footer-esc', 'Esc', ':back'));
  // BB-472: `W` is kernel-owned and reachable from every full screen
  // (tui-kernel.ts), same as Esc/q below — shown unconditionally rather
  // than gated like `R`, which only applies where a screen is reloadable.
  segments.push(footerKey('footer-workspace', 'W', ':workspace'));
  segments.push(footerKey('footer-quit', 'q', ':quit'));
  const keys: VNode[] = [
    // Leading pad so the row is not flush against the left edge.
    textNode({ id: 'footer-lead', content: ' ' }),
    // │ between notice / version / keys — never placed by hand.
    ...withActionPipes('footer-sep', segments),
  ];
  const statusChildren: VNode[] = [
    // A right-pinned spinner or toast keeps its columns; the key list gives up
    // its tail instead, as it does on any narrow terminal.
    ...(input.busy || toast !== ''
      ? [
          h(
            BoxRenderable,
            {
              id: 'footer-keys',
              flexDirection: 'row',
              height: 1,
              flexShrink: 1,
              minWidth: 0,
              overflow: 'hidden',
            },
            ...keys,
          ),
        ]
      : keys),
    ...(input.busy
      ? [
          textNode({
            id: 'footer-pad',
            content: ' ',
            width: 0,
            grow: 1,
          }),
          textNode({
            id: 'footer-spinner',
            content: ` ${footerSpinnerFrame(input.nowMs)}`,
            fg: FOREGROUND_HIGHLIGHT,
          }),
          textNode({
            id: 'footer-loading',
            content: ' loading ',
            fg: FOREGROUND_HIGHLIGHT,
          }),
        ]
      : toast !== ''
        ? [
            textNode({
              id: 'footer-pad',
              content: ' ',
              width: 0,
              grow: 1,
            }),
            textNode({
              id: 'footer-toast',
              content: `${footerNoticeAppear(toast, input.toastAgeMs)} `,
              fg: FOREGROUND_HIGHLIGHT,
            }),
          ]
        : [
            // Over-pad so the row covers the terminal width; layout clips surplus.
            textNode({
              id: 'footer-pad',
              content: ' '.repeat(input.width),
            }),
          ]),
  ];

  const rows = footerRowsFor(input);
  return regionRoot(
    'footer',
    h(
      BoxRenderable,
      {
        id: 'footer-fill',
        flexDirection: 'column',
        height: rows,
        flexShrink: 0,
        width: '100%',
      },
      ...actionsRow,
      h(
        BoxRenderable,
        {
          id: 'footer-row-0',
          flexDirection: 'row',
          height: 1,
          flexShrink: 0,
          width: '100%',
        },
        ...statusChildren,
      ),
    ),
  );
}

/**
 * The modal box — BB-340 Task 9b, and the step that unblocks the forms.
 *
 * The border is the RENDERER'S now. It used to be three string templates —
 * `╭───╮`, `'│ ' + fitLine(line) + ' │'`, `╰───╯` — which made the box a stack
 * of finished rows and therefore something a tree could not enter: a converted
 * screen handing over nodes drew an EMPTY box, not a clipped one. A Yoga border
 * holds a child; a string cannot. So the box's frame is `border` + one column of
 * `padding`, which is the same four columns the templates spent, and the body
 * goes in as whatever the screen handed over (spec D1/D5).
 *
 * The header, the blank separators and the status are still `string` on the
 * contract (spec D2), and since Task 12 they are `textNode`s carrying that
 * string verbatim: the `fitLine` that used to pad them to the box's inner width
 * is gone with `lib/ansi.ts`, because the box paints its own background across
 * that width and clips whatever overruns it. The BODY is a tree in every case: a
 * popup that still handed over rows was the last caller of the `string[]` leg
 * that used to sit here.
 */
export const modalTree = (input: ChromeInput, body: VNode): VNode => {
  // One element may carry embedded newlines — the popups' two-row status is one
  // string — so a section is split into its rows, exactly as the composed box's
  // `flatMap` did. Splitting is structure, not measurement: a `\n` is a row
  // boundary the popup declared, and `wrapMode: 'none'` would otherwise draw
  // only the text before it.
  const section = (lines: readonly string[], name: string): VNode[] =>
    lines
      .flatMap((line) => line.split('\n'))
      .map((line, index) =>
        textNode({
          id: `modal-${name}-${index}`,
          content: line,
          bg: DEFAULT_BACKGROUND,
        }),
      );
  return h(
    BoxRenderable,
    {
      id: `region-${'modal' satisfies FrameRegionId}`,
      border: true,
      // The four characters the templates drew, and the reason the swap is
      // invisible: `rounded` IS `╭ ╮ ╰ ╯ ─ │`.
      borderStyle: 'rounded',
      // Modal outline uses BORDER_EMPHASIS (same slot as FOREGROUND_HIGHLIGHT).
      borderColor: BORDER_EMPHASIS,
      // What the `fitLine` padding used to paint: the operator's own background.
      backgroundColor: DEFAULT_BACKGROUND,
      flexDirection: 'column',
      flexShrink: 0,
      // The space between the border and the text, on both sides — the ` ` of
      // `'│ ' … ' │'`.
      paddingLeft: 1,
      paddingRight: 1,
    },
    headerFor(input, 'modal'),
    ...section([''], 'gap-top'),
    body,
    ...section([''], 'gap-bottom'),
    ...section([input.status ?? ''], 'status'),
  );
};

/**
 * Where the modal box's origin goes — the cockpit's own centring, not Yoga's.
 *
 * Beside {@link modalTree} for the reason {@link chromeHeight} sits beside
 * {@link chromeTree}: one composition, two answers. It REPLACES `modalRows`,
 * which answered "how tall is the box" by counting the rows the box was
 * composed of — an answer a converted screen cannot give, because its body is a
 * tree with no row count until Yoga has run (BB-340 Task 9b). So the height is
 * now an INPUT, taken from the laid-out box, and this is the placement rule
 * alone.
 *
 * WHY THE BOX IS PLACED AT ALL, rather than centred with
 * `justifyContent: 'center'`: Yoga's answer is not the cockpit's. Vertically the
 * rule is one row higher than a centre, always. Horizontally the two agree only
 * on even free space — measured over 336 geometries, Yoga rounds a half-cell UP
 * where this floors, so on an odd-width terminal a Yoga-centred box sits one
 * column right of where the cockpit has always drawn it.
 */
export const modalOrigin = (
  input: ChromeInput,
  terminalRows: number,
  boxHeight: number,
): { readonly top: number; readonly left: number } => ({
  // Centred on the WHOLE terminal, so this reads the terminal's rows rather
  // than the body-window `bodyRowsFor`.
  top: Math.max(2, Math.floor((terminalRows - boxHeight) / 2)) - 1,
  left:
    Math.max(
      1,
      Math.floor((input.width - modalBoxWidth(input.width)) / 2) + 1,
    ) - 1,
});

/**
 * The name a region's rows are keyed under. The body's tree is mounted INSIDE
 * the ScrollBox rather than being it, so it needs an id of its own: `region-body`
 * is the ScrollBox, and one id for two renderables is what `mount.ts` refuses.
 */
export const treeRegionOf = (id: FrameRegionId): string =>
  id === 'body' ? BODY_WINDOW_REGION : id;

/**
 * A region's tree, EMPTY — what the kernel mounts the four regions as at
 * start-up. Here so that it and the frame's real trees carry the same root ids
 * by construction: `patchTree` reuses a standing tree only when the root id
 * matches, and a mismatch would rebuild the region on every draw.
 */
export const emptyRegionTree = (id: FrameRegionId): VNode =>
  regionRoot(treeRegionOf(id));

/**
 * BB-326 Step B / BB-340 — the frame, as the regions the caller lays out.
 *
 * A normal frame is chrome, body and footer; a modal is one box. The caller
 * cannot re-derive that split without restating this module's structure
 * somewhere else, and the ORDER is load-bearing: Yoga stacks a column in child
 * order, and the kernel mounts the four regions eagerly in exactly this one.
 *
 * THE BODY IS THE SCREEN'S OWN TREE, passed through whole. Task 12 deleted the
 * other leg: a screen that composed rows used to get a WINDOW composed for it
 * here — the slice of its surface the terminal had room for — because a row
 * surface has no identity and one renderable per line of a 5 000-line run log
 * would hit `@opentui/core@0.5.1`'s ceiling of 16 382 native renderables. A
 * screen's own tree is mounted once and PATCHED by id (`Kernel/mount.ts`), so
 * the body ScrollBox scrolls the real nodes and owns its own geometry. The
 * ceiling still applies to the tree itself; a screen whose body can exceed it
 * has to window its own nodes, which is the list screens' business (they cannot
 * — a page is 20 rows).
 */
export function frameTrees(
  input: ChromeInput,
  body: VNode,
): readonly (readonly [FrameRegionId, VNode])[] {
  // The box has no body WINDOW — it is sized by what it holds, not by the
  // terminal — so there is nothing here to slice for a modal either.
  if (input.modal) return [['modal', modalTree(input, body)]];
  return [
    ['chrome', chromeTree(input)],
    ['body', body],
    ['footer', footerTree(input)],
  ];
}
