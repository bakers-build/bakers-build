import {
  type BoxRenderable,
  type CliRenderer,
  type MouseEvent,
  type Renderable,
  ScrollBoxRenderable,
  type VNode,
} from '@opentui/core';
import { BORDER } from '../lib/theme.js';
import type { ScreenPresentation } from '../Screen/screen.js';
import {
  type ChromeInput,
  emptyRegionTree,
  type FrameRegionId,
  modalOrigin,
} from './chrome.js';
import {
  laidOutHeight,
  type MountedTree,
  mountTree,
  parkRegion,
  patchTree,
  unmountTree,
} from './mount.js';

/**
 * BB-382 — THE FOUR FRAME REGIONS, and everything that is true of them.
 *
 * One responsibility, stated as the questions this module answers and the kernel
 * no longer does: which renderable owns a region's SLOT in the layout, which one
 * a region's tree is mounted INTO, in what order they are stood up, what happens
 * to a screen-owned tree when a navigation leaves the screen that named its
 * nodes, which row takes which click, and where the modal box goes.
 *
 * Extracted because it CARRIES ITS STATE WITH IT. `mounted`, `bodyBox`,
 * `mountedVisit` and `boundRows` were four ambient closure bindings in
 * `runTicketTui`, readable and writable by every other closure in an
 * 800-line function; here they are private and the surface is nine methods. That
 * lowers the coupling rather than relocating it — the opposite of extracting
 * `draw` or `handleKey`, each of which would need a parameter bag naming the ten
 * bindings it reads.
 *
 * What deliberately STAYED in the kernel: what a frame IS (`draw` sizes each
 * slot and decides the scroll geometry) and what a key MEANS (`handleKey`). This
 * module is asked; it does not decide.
 */

/** The two intents a row click can carry, as the kernel resolves them. */
export interface RowClickHandlers {
  /** A click on a row that is not the selected one. */
  readonly select: (index: number) => void;
  /** A click on the row that is already selected. */
  readonly activate: (index: number) => void;
}

/**
 * The regions of one cockpit's frame.
 *
 * Every method is a no-op on a kernel with no renderer (the piped run): the
 * non-interactive branch mounts nothing and there is nothing to park, patch or
 * retire.
 */
export interface Regions {
  /**
   * The body's scrolling viewport — the ONE region whose slot the kernel itself
   * reads, because the frame's scroll geometry is `draw`'s business and the
   * fallback scroll is `handleKey`'s.
   */
  readonly body: ScrollBoxRenderable | undefined;
  /** The renderable that owns a region's slot in the layout. */
  slotOf(id: FrameRegionId): Renderable | undefined;
  /** The tree standing in a region, or none while there is no renderer. */
  treeOf(id: FrameRegionId): MountedTree | undefined;
  /** Park every region's slot, cursor included — the frame turns its own back on. */
  parkAll(): void;
  /** Patch a region's standing tree into the next one for this frame. */
  patch(id: FrameRegionId, next: VNode): void;
  /** Destroy the screen-owned trees when the router's visit count has moved on. */
  retire(visitCount: number): void;
  /** Rebind — and unbind — this frame's selectable rows. */
  bindRowClicks(shown: ScreenPresentation, modal: boolean): void;
  /** Place the modal box, which is the one thing still positioned by hand. */
  placeModal(chrome: ChromeInput, terminalRows: number): void;
  /** Teardown: every tree, then the body's box. The shell is the caller's. */
  destroy(): void;
}

/**
 * The regions whose nodes belong to the SCREEN rather than to the kernel.
 *
 * `chrome` and `footer` are the kernel's own composition and their ids are a
 * bounded set (`chrome-header-<index>`, one tab node per registered tab), so a
 * shrink there is the resize `patchTree` parks for. `body` and `modal` hold
 * whatever `present()` handed over, keyed by the entities the screen was
 * showing — an unbounded set the next screen never asks for again.
 */
const SCREEN_OWNED_REGIONS: readonly FrameRegionId[] = ['body', 'modal'];

export function createRegions(
  renderer: CliRenderer | undefined,
  shell: BoxRenderable | undefined,
  rows: RowClickHandlers,
): Regions {
  /**
   * BB-340 — one MOUNTED TREE per frame region, in painting order.
   *
   * BB-326 Step A's row pool was "one renderable per line INDEX";
   * `Kernel/mount.ts` is the same retention keyed by `props.id`, which is what a
   * screen's own tree needs (spec D4) — the growth and the parking of the
   * surplus included, FFI cost and all (read it there). The whole part played
   * here is to hold the tree per region and to hand `patchTree` the next one,
   * which `draw` composes. That next one used to be able to come from
   * `linesToTree` — the bridge that made ONE render path out of two while
   * screens could still present a `string[]` (spec D5); it went with the last
   * screen to convert (BB-340 Task 12), and a `string[]` reaching
   * `presentation()` is a compile error now.
   */
  const mounted = new Map<FrameRegionId, MountedTree>();
  /**
   * BB-326 Step C — the body's own scrolling viewport.
   *
   * `region-body` is the one region that is not a plain stack of rows: it is a
   * `ScrollBoxRenderable` with `flexGrow: 1`, so Yoga hands it every row the
   * chrome and the footer leave and the footer lands on the terminal's last
   * row. It owns the viewport (its height is the layout's answer, not
   * `terminalRows() - 8`) and it owns `scrollTop`, clamp included.
   *
   * WHAT IT SCROLLS IS THE SCREEN'S OWN TREE — BB-340 Task 12.
   *
   * It used to be VIRTUAL, and for a measured reason: `@opentui/core@0.5.1`
   * hands out 16 382 native renderables and then THROWS (`Failed to create
   * native renderable`), so one `TextRenderable` per line of a 5 000-line run
   * log took the cockpit down rather than scrolling it. The box's content was
   * therefore two SPACERS around the visible window's rows, sized so that the
   * content was as tall as the screen's own line count while only the window
   * was ever a renderable. That was the ROW surface's answer to having no
   * identity. A converted screen is mounted once and patched by id, so its rows
   * are real nodes the box scrolls directly, and the spacers went with the
   * surface that needed them. The ceiling still applies to the tree; a screen
   * whose body can exceed it has to window its own nodes.
   */
  let bodyBox: ScrollBoxRenderable | undefined;
  /** The visit the standing screen-owned trees were built for. */
  let mountedVisit = 0;

  /**
   * The renderable that owns a region's SLOT in the layout — what `draw` parks
   * and sizes. For three regions that is the tree's own root box; for the body
   * it is the ScrollBox the tree sits inside, which Yoga grows and the wheel
   * scrolls.
   */
  const slotOf = (id: FrameRegionId): Renderable | undefined =>
    id === 'body' ? bodyBox : mounted.get(id)?.root;

  /**
   * The renderable a region's tree is mounted INTO — the shell for three of
   * them, and deliberately not {@link slotOf}, which for those three IS the
   * tree's own root: `unmountTree` would then ask a renderable to remove itself
   * from itself, which OpenTUI answers with a `skipping remove` warning that
   * leaks the whole column on `q`.
   */
  const treeHostOf = (id: FrameRegionId): Renderable | undefined =>
    id === 'body' ? bodyBox : shell;

  /**
   * Stand an EMPTY tree in a region's slot — at boot, and again whenever a
   * navigation retires a screen-owned region (spec F2, {@link Regions.retire}).
   *
   * One function for both, so the modal's absolute placement cannot be applied at
   * boot and forgotten on a remount: `region-modal` is out of the shell's column
   * and its origin is the one thing the kernel still writes by hand.
   */
  const mountRegion = (id: FrameRegionId): MountedTree | undefined => {
    const into = treeHostOf(id);
    if (!renderer || !into) return undefined;
    const tree = mountTree(renderer, into, emptyRegionTree(id));
    mounted.set(id, tree);
    if (id === 'modal') {
      tree.root.position = 'absolute';
      tree.root.left = 0;
      tree.root.top = 0;
    }
    return tree;
  };

  /**
   * Mounted eagerly, in the order a frame paints them, because Yoga stacks a
   * column in CHILD ORDER: mounting them lazily would put the regions in
   * whatever order the first screen happened to need — and a cockpit that
   * booted straight into a modal would then stack chrome, body and footer after
   * it. Each tree is mounted EMPTY here and grown by `patchTree` on every draw,
   * so the shell's child order is a property of this block and not of the first
   * frame. Written out rather than looped, because the body's bring-up is not
   * the other three's: those three ARE their tree's root box, which
   * `emptyRegionTree` gives the `region-<id>` identity and the column layout the
   * pane used to be constructed with. `region-modal` is additionally
   * `position: absolute` and therefore out of the column entirely; it is the ONE
   * thing the kernel still positions by hand (see {@link Regions.placeModal}).
   */
  if (renderer && shell) {
    mountRegion('chrome');
    bodyBox = new ScrollBoxRenderable(renderer, {
      id: 'region-body',
      // The ONE growing region: everything the chrome and the footer leave is
      // the body's, which is what pins the footer to the bottom of the
      // terminal.
      flexGrow: 1,
      flexShrink: 1,
      rootOptions: { flexGrow: 1, flexShrink: 1 },
      scrollX: false,
      scrollY: true,
      // BB-375 — fixed viewport frame, no fill; content scrolls inside.
      border: true,
      borderStyle: 'rounded',
      borderColor: BORDER,
      // Same optical inset the old content framedPanel used.
      paddingLeft: 1,
      paddingRight: 1,
    });
    shell.add(bodyBox);
    // The cockpit routes every key itself, through `renderer.keyInput`. A
    // focusable renderable that the renderer's `autoFocus` gives focus to on a
    // left click ALSO subscribes its own keypress handler, and
    // `ScrollBarRenderable.handleKeyPress` claims exactly the cockpit's own
    // scroll keys (`up`/`down`/`j`/`k`), a fifth of a viewport per press.
    //
    // Measured caveat, so nobody re-derives it: leaving this `true` DOES focus
    // the box on a click (`rendererFocus=region-body`) but does NOT currently
    // produce a second scroll in `@opentui/core@0.5.1`. The double claim is
    // latent, not live — this is a precaution against it waking up, and
    // `tests-bun/Kernel/scroll-box.test.ts` pins the outcome rather than
    // pretending to pin this line.
    bodyBox.focusable = false;
    // The scrollbars are hidden, and hidden the way this kernel has to hide
    // things: `visible = false` alone leaves a renderable in the Yoga layout
    // (the same trap the row pool's `height = 0` exists for), so the vertical
    // bar would keep its column and narrow the body by one. They are off rather
    // than styled because `SliderRenderable`'s default track and thumb are
    // HARDCODED RGBA — truecolor on the wire, which is the one thing
    // `tests/pty/verify-colors.mjs` fails the cockpit for, and the exact defect
    // that froze the operator's theme once already. Re-enabling them means
    // giving them `RGBA.defaultForeground()`/`defaultBackground()` first.
    bodyBox.verticalScrollBar.visible = false;
    bodyBox.verticalScrollBar.width = 0;
    bodyBox.horizontalScrollBar.visible = false;
    bodyBox.horizontalScrollBar.height = 0;
    mountRegion('body');
    mountRegion('footer');
    mountRegion('modal');
  }

  /**
   * BB-340 Task 11 — a selectable row takes its own click.
   *
   * The kernel used to map a terminal row to a body line and that line back to
   * an entry, through `lib/hit-test.ts`'s `bodyLineAt`/`rowToIndex`, over three
   * numbers it kept privately (`chromeRows`, a window height, an offset). All
   * three are the layout's now, and the layout answers the question directly:
   * the pointer lands on a node.
   *
   * The presentation names the node of each selectable row IN SELECTION ORDER
   * (`rowIds`), so the index a row means is its position in that list — the
   * screens' own `select`/`activate` take an index and go on doing so. The ids
   * are the entities' own (`ticket-row-<uuid>`, D4/R4), so a re-sorted or
   * re-paged list moves each row's handler with its row rather than leaving it
   * on whatever now stands in that position.
   *
   * WHAT A CLICK MEANS is the kernel's, one rule for thirteen screens, and it
   * arrives here as {@link RowClickHandlers}: the selected row activates, any
   * other row selects. That is the same binding `Enter` and `↑↓` go through, and
   * moving it into the screens would be thirteen copies of it.
   *
   * REBOUND, AND UNBOUND, ON EVERY DRAW. `patchTree` reuses a standing
   * renderable, so a handler written once outlives the frame it described: a row
   * that is still on screen but no longer selectable would keep acting. The
   * bound set is therefore cleared before it is rebuilt, which is `applyProps`'s
   * rule ("state a varying prop on every frame, off included") applied to the
   * one prop the kernel writes itself.
   *
   * A MODAL binds none — a popup's rows have never taken a click, and its
   * keyboard is the whole of its input — and that call is what takes the last
   * frame's handlers back off.
   */
  const boundRows: Renderable[] = [];
  const bindRowClicks = (shown: ScreenPresentation, modal: boolean): void => {
    for (const node of boundRows) node.onMouse = undefined;
    boundRows.length = 0;
    const tree = modal ? undefined : mounted.get('body');
    if (!tree) return;
    (shown.rowIds ?? []).forEach((id, index) => {
      const node = tree.byId.get(id);
      if (!node) return;
      node.onMouse = (event: MouseEvent): void => {
        // The press alone. One physical click also sends `up`, and a drag
        // arrives as its own type — acting on either fires the action twice.
        if (event.type !== 'down' || event.button !== 0) return;
        if (index === shown.selectedIndex) rows.activate(index);
        else rows.select(index);
      };
      boundRows.push(node);
    });
  };

  /**
   * BB-340 spec F2 — the departed screen's subtree is DESTROYED, not parked.
   *
   * `patchTree` parks the surplus on purpose (`visible = false`, `height = 0`)
   * because a shrink is nearly always followed by a grow. Across a NAVIGATION
   * that reasoning does not hold: the ids are the entities' own, so a
   * `ticket-row-<uuid>` the next screen does not want is a node no later frame
   * will ever want back. Parked, each one stays a live Yoga node behind FFI and
   * the surplus pass rewrites two of its props on every draw — bounded by the
   * entities and screens a session visits rather than by its frames, which is why
   * it is a growth rather than a leak, and invisible to every check that reads a
   * frame (a parked node is not in the picture).
   *
   * Here rather than in `Router` because the renderables are the kernel's: the
   * router's part is to say that a screen was left, which `Router.visitCount`
   * does, and it is passed in. Calling this from `draw` is what makes it the
   * *composition's* answer to `leave()` — `Router.navigate` calls `leave()` and
   * `enter()` and then the frame is drawn, so the first draw after a navigation
   * is the one place where the outgoing tree is dead and the incoming one is not
   * yet built.
   *
   * WHAT IT COSTS: the incoming screen's nodes are constructed either way (its
   * ids are its own — the prefixes are per screen), so nothing that would have
   * been reused is re-paid. What is re-paid is one region root box per
   * navigation, and a list rebuilt when you come BACK to it instead of un-parked.
   *
   * WHAT IT DOES NOT REACH, stated so it is not mistaken for solved: churn
   * WITHIN one screen. Page past twenty tickets, filter a list, collapse a
   * section, and those ids are parked until the screen is left. That is bounded
   * by one screen's own entities and freed at the next navigation, and taking it
   * further would mean evicting parked nodes on a timer — a cache policy this
   * kernel has no measurement to justify.
   */
  const retire = (visitCount: number): void => {
    if (visitCount === mountedVisit) return;
    mountedVisit = visitCount;
    // Dropped WITHOUT clearing their handlers: `bindRowClicks` writes
    // `onMouse = undefined` over the previous frame's rows, and these are about
    // to be destroyed — a write onto a freed renderable is the one thing worth
    // avoiding on a path whose whole point is that the nodes are gone.
    boundRows.length = 0;
    for (const id of SCREEN_OWNED_REGIONS) {
      const tree = mounted.get(id);
      const into = treeHostOf(id);
      if (tree && into) unmountTree(into, tree);
      mountRegion(id);
    }
  };

  return {
    body: bodyBox,
    slotOf,
    treeOf: (id: FrameRegionId): MountedTree | undefined => mounted.get(id),
    parkAll: (): void => {
      // Park every region's slot, CURSOR INCLUDED (`parkRegion` blurs what is
      // focused inside it, which a converted popup's insertion point is). The
      // frame's own regions turn theirs back on: a modal frame carries no
      // chrome/body/footer, and a normal one no box.
      for (const id of mounted.keys()) {
        const slot = slotOf(id);
        if (slot) parkRegion(slot);
      }
    },
    patch: (id: FrameRegionId, next: VNode): void => {
      // Patched into renderables that are already standing: a longer region
      // grows the tree by the rows it lacks, a shorter one parks the surplus,
      // and nothing here measures.
      const tree = mounted.get(id);
      if (!renderer || !tree) return;
      mounted.set(id, patchTree(renderer, tree, next));
    },
    retire,
    bindRowClicks,
    /**
     * WHY THE MODAL BOX IS STILL PLACED BY HAND — `modalOrigin` owns the rule.
     *
     * What is left here is the one step the rule cannot take: run the layout so
     * the box HAS a height, which since BB-340 Task 9b is Yoga's answer rather
     * than a count of composed rows. Writing `top` afterwards re-dirties the
     * layout, and the frame the draw requests recomputes it, so the box is never
     * painted at a stale origin.
     */
    placeModal: (chrome: ChromeInput, terminalRows: number): void => {
      const box = slotOf('modal');
      if (!box || !renderer) return;
      renderer.root.calculateLayout();
      const at = modalOrigin(chrome, terminalRows, laidOutHeight(box));
      box.top = at.top;
      box.left = at.left;
    },
    destroy: (): void => {
      if (!renderer || !shell) return;
      // BB-340 — one `unmountTree` per region, in place of the loop that
      // destroyed a pool of rows and then its pane. It destroys RECURSIVELY: a
      // plain `destroy()` leaves the children's Yoga nodes unfreed.
      for (const [id, tree] of mounted) {
        const into = treeHostOf(id);
        if (into) unmountTree(into, tree);
      }
      mounted.clear();
      // The body's box is this module's own: no tree's unmount carries it out.
      if (bodyBox) {
        shell.remove(bodyBox);
        bodyBox.destroy();
      }
    },
  };
}
