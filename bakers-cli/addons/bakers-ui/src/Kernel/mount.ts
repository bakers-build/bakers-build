import {
  BoxRenderable,
  h,
  instantiate,
  isVNode,
  type Renderable,
  type RenderContext,
  type VNode,
} from '@opentui/core';

/**
 * BB-340 — mount once, patch by id.
 *
 * `@opentui/core@0.5.1` ships no reconciler: `h`, `instantiate` and
 * `Renderable.add` all CONSTRUCT. Instantiating a screen's tree on every draw
 * would rebuild every renderable per frame — the ~38 FFI round trips BB-326
 * Step A's row pool removed. So construction is bound to NAVIGATION (the router
 * already calls `leave()`/`enter()`) and a draw only writes props onto the nodes
 * that are already standing.
 *
 * The key is `props.id`, never the position. A positional key patches one
 * entity's content onto another entity's node after a reorder, with no error and
 * nothing on screen to say so.
 *
 * A reordered next tree is followed in BOTH senses since BB-340 Task 7: each
 * entity's content stays on that entity's node, and the live children are
 * re-inserted into the order the next tree declares — see {@link reorder}.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, so the task that needs it knows:
 *
 * - **It never CLEARS a prop the next tree omits.** `applyProps` writes what the
 *   next node declares; a key that is simply absent leaves whatever the last
 *   frame wrote standing. So a prop that VARIES between frames must be stated in
 *   every frame — `attributes: selected ? INVERSE : 0`, never a spread that
 *   appears only on the selected row. Measured on the ticket list, where the
 *   omitted form left the highlight on the row the cursor started on and put a
 *   second one on every row it visited. Clearing is not done here because this
 *   module knows no defaults: the value to restore is the renderable class's, and
 *   only the component knows which prop it means to vary.
 * - **It only sees VNode children.** A raw `Renderable` handed to `h()` as a
 *   child is mounted by `instantiate` and then invisible to every later patch:
 *   never re-applied, never parked.
 * - **A functional construct is never reused.** `instantiate` resolves
 *   `h(fn, props)` to whatever VNode `fn` returns, so the instance's constructor
 *   is the inner renderable's, never `fn`. Such a node is torn down and rebuilt
 *   on every patch. Build trees from renderable classes.
 */
export interface MountedTree {
  /** The root renderable, already added to its parent. */
  readonly root: Renderable;
  /** Every mounted node by its `id`, so a patch is a lookup rather than a walk. */
  readonly byId: ReadonlyMap<string, Renderable>;
}

const nameOf = (node: VNode): string =>
  (node.type as { name?: string } | undefined)?.name ?? 'anonymous construct';

/**
 * Every node's `id`, required.
 *
 * MEASURED, and the reason this is an error rather than a shrug: a renderable
 * always HAS an id — `BaseRenderable`'s constructor falls back to
 * `renderable-<n>` — so an unkeyed node is not "unkeyed" downstream, it is keyed
 * by an accident that changes on every construction. `patchTree` can then never
 * find it again: it rebuilds the node on every draw and grows the tree by one
 * per frame, which is precisely the per-frame construction this module exists to
 * remove. Refusing the tree makes that loud at the first draw instead of silent
 * forever.
 */
function requireId(node: VNode): string {
  const id = (node.props as { id?: string } | undefined)?.id;
  if (id === undefined || id === '') {
    throw new Error(
      `BB-340: every node in a mounted tree needs a stable props.id; <${nameOf(node)}> has none. Derive it from the entity (ticket-row-<uuid>), never from the position.`,
    );
  }
  return id;
}

/**
 * The VNode children of a node. `h()` flattens; a hand-built tree may not.
 *
 * Exported since BB-340's header conversion: `Kernel/chrome.ts` counts the
 * header's rows off the node a screen handed over (one child, one row) and has to
 * count them the way the mount will walk them, or the chrome is sized against a
 * different number of rows than the box draws.
 */
export const childrenOf = (node: VNode): VNode[] =>
  ((node.children ?? []) as unknown[])
    .flat(Number.POSITIVE_INFINITY)
    .filter(isVNode);

/**
 * Collect every id the tree declares, rejecting a missing or repeated one.
 *
 * A repeat is the same silent mis-patch as a positional key from the other
 * direction: two nodes would share one renderable, so the second one's props
 * would overwrite the first's and only one of them would ever be on screen.
 */
function collectIds(node: VNode, into: Set<string>): void {
  const id = requireId(node);
  if (into.has(id)) {
    throw new Error(
      `BB-340: the id "${id}" is declared twice in one tree; ids are the identity a patch follows, so they must be unique.`,
    );
  }
  into.add(id);
  for (const child of childrenOf(node)) collectIds(child, into);
}

/** Write every prop except `id` onto a live renderable. */
function applyProps(target: Renderable, node: VNode): void {
  const props = (node.props ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'id') continue;
    (target as unknown as Record<string, unknown>)[key] = value;
  }
}

/**
 * Index a freshly instantiated subtree by the ids its VNodes declare.
 *
 * It walks the VNODE tree and resolves each node through `findDescendantById`
 * rather than walking the renderable tree in parallel, for two reasons: only a
 * declared id may become a patch key (a renderable's auto-generated
 * `renderable-<n>` must never be one, or the surplus pass below would park a
 * node nobody asked about), and a composite renderable is free to hold children
 * of its own that no VNode corresponds to.
 */
function register(
  node: Renderable,
  vnode: VNode,
  into: Map<string, Renderable>,
): void {
  into.set(requireId(vnode), node);
  for (const child of childrenOf(vnode)) {
    const found = node.findDescendantById(requireId(child));
    if (found !== undefined) register(found, child, into);
  }
}

/** Forget a node and everything below it — called before it is destroyed. */
function forgetSubtree(
  byId: Map<string, Renderable>,
  removed: Renderable,
): void {
  for (const [id, node] of byId) {
    if (node === removed || isDescendantOf(node, removed)) byId.delete(id);
  }
}

const isDescendantOf = (node: Renderable, ancestor: Renderable): boolean => {
  for (let walk = node.parent; walk !== null; walk = walk.parent) {
    if (walk === ancestor) return true;
  }
  return false;
};

export function mountTree(
  ctx: RenderContext,
  parent: Renderable,
  tree: VNode,
): MountedTree {
  // Validate before constructing: a tree that cannot be patched must not reach
  // the terminal at all.
  collectIds(tree, new Set<string>());
  const root = instantiate(ctx, tree) as Renderable;
  parent.add(root);
  const byId = new Map<string, Renderable>();
  register(root, tree, byId);
  return { root, byId };
}

export function patchTree(
  ctx: RenderContext,
  mounted: MountedTree,
  next: VNode,
): MountedTree {
  /** Every id the NEXT tree still wants; everything else is parked below. */
  const wanted = new Set<string>();
  collectIds(next, wanted);

  const host = mounted.root.parent;
  if (host === null) {
    throw new Error(
      'BB-340: patchTree needs the mounted root to still have a parent; it was removed without unmountTree.',
    );
  }

  const byId = new Map(mounted.byId);

  /**
   * Put a node's live children back into the order the next tree declares.
   *
   * Yoga stacks a column in CHILD ORDER while `Renderable.add` appends, so a
   * walk that only writes props paints a re-sorted list in the order it first
   * grew in: every row's content correct, the rows in the wrong places, and
   * nothing on screen to say so. Chosen over the alternative the module used to
   * name — keeping the child order fixed and moving only the data — because
   * that one requires POSITIONAL keys, which is the defect this whole module
   * exists to prevent (D4/R4).
   *
   * `add(child, index)` is a MOVE for a child that is already there: it splices
   * the node out of the layout order and re-inserts it before the node standing
   * at `index`. It is called only where the order actually differs, because
   * `add(x, index)` with `x` already AT `index` resolves to `insertBefore(x, x)`,
   * which OpenTUI answers with a warning and no move.
   *
   * The surplus rides along: a parked node keeps its place among the children,
   * so the ones the next tree wants are re-inserted around it and it stays
   * where it was, invisible and zero rows tall.
   */
  const reorder = (parent: Renderable, nodes: readonly VNode[]): void => {
    nodes.forEach((node, index) => {
      const live = byId.get(requireId(node));
      if (live !== undefined && parent.getChildren()[index] !== live)
        parent.add(live, index);
    });
  };

  const walk = (parent: Renderable, node: VNode): Renderable => {
    const id = requireId(node);
    const existing = byId.get(id);
    // Same id AND same construct -> the node stands, and we only write props.
    const reusable =
      existing !== undefined &&
      (existing.constructor as unknown) === (node.type as unknown);
    if (existing !== undefined && reusable) {
      // Un-park BEFORE the props, so a `visible`/`height` the tree declares
      // still wins. `height` goes back to `auto` — the value a renderable that
      // declares none is constructed with — because parking wrote a 0 into the
      // Yoga node that `visible = true` alone does not undo, and a row that
      // comes back 0 rows tall is a row that never comes back.
      existing.visible = true;
      existing.height = 'auto';
      applyProps(existing, node);
      const children = childrenOf(node);
      for (const child of children) walk(existing, child);
      reorder(existing, children);
      return existing;
    }
    if (existing !== undefined) {
      forgetSubtree(byId, existing);
      // `destroy()` only DETACHES its children, leaving their Yoga nodes
      // unfreed; `destroyRecursively()` is what actually frees the subtree.
      existing.destroyRecursively();
    }
    // `instantiate` builds this node's whole subtree, so the children are not
    // walked again here — walking them would construct a second copy of each.
    const created = instantiate(ctx, node) as Renderable;
    parent.add(created);
    register(created, node, byId);
    return created;
  };

  const root = walk(host, next);

  // Park, never destroy: a shrink is nearly always followed by a grow, and
  // destroying re-pays the FFI cost for rows the next frame wants back. Height 0
  // as well as `visible = false` — `visible` alone is enough to take a node out
  // of the Yoga column on 0.5.1 (its setter sets `display: none`), but the pair
  // is what the row pool has always written and it does not depend on that.
  for (const [id, node] of byId) {
    if (wanted.has(id)) continue;
    node.visible = false;
    node.height = 0;
  }
  return { root, byId };
}

/**
 * The height Yoga has just computed for a mounted renderable — Task 9b.
 *
 * NOT `Renderable.height`, which is a CACHE that only `updateFromLayout()`
 * refreshes and which that method refuses to refresh twice in one frame
 * (`_lastLayoutFrame === frameId`). Read during a draw it still holds the
 * PREVIOUS frame's answer — measured: the modal box placed against it opened ten
 * rows too low, because the height it reported was the empty box's. The Yoga
 * node is the layout itself and has no such cache.
 *
 * Reached through a cast because `@opentui/core@0.5.1` keeps `yogaNode`
 * `protected` and publishes no other reader for a freshly calculated layout.
 */
export const laidOutHeight = (node: Renderable): number =>
  (
    node as unknown as { yogaNode: { getComputedHeight(): number } }
  ).yogaNode.getComputedHeight();

/**
 * How many rows `node` sits below `ancestor` — BB-340 Task 12.
 *
 * The successor of `ScreenPresentation.selectedRow`, which was the last row
 * NUMBER on the screen contract: a screen stated the absolute physical row of
 * its highlight so the kernel could keep it in view, which meant every list
 * screen had to know how many rows its own header took and state `1 + index`.
 * The layout knows, so the screen no longer has to — the kernel names the
 * selected row's NODE (`rowIds[selectedIndex]`) and asks here where it ended up.
 *
 * Read off the Yoga nodes rather than off `Renderable.y` for the reason
 * {@link laidOutHeight} exists: `y` is a CACHE that only `updateFromLayout()`
 * refreshes, once per frame, so during a draw it still holds the previous
 * frame's answer — which for a screen that has just been navigated to is no
 * answer at all. `calculateLayout()` is what the caller runs first; the Yoga
 * node then IS the layout. This is not string measurement (R5/D8): nothing here
 * looks at a character.
 *
 * Returns 0 when `node` is not below `ancestor` — the caller's row belongs to
 * the tree it just patched, so that is a "nothing to scroll to", not a fault.
 */
export const laidOutTop = (node: Renderable, ancestor: Renderable): number => {
  let total = 0;
  for (let walk: Renderable | null = node; walk !== null; walk = walk.parent) {
    if (walk === ancestor) return total;
    total += (
      walk as unknown as { yogaNode: { getComputedTop(): number } }
    ).yogaNode.getComputedTop();
  }
  return 0;
};

/**
 * Take a whole region out of the frame — and take the terminal cursor with it.
 *
 * MEASURED, on the first popup whose insertion point was a node of its own
 * (BB-340 Task 9c). `visible = false` stops a subtree painting; it does NOT
 * blur what is focused inside it, and the terminal cursor follows FOCUS. So Esc
 * closed the converted picker, the frame went back to the ticket list, and the
 * cursor stayed blinking on the row the popup's query had been on — the exact
 * failure the deleted `Kernel/caret-slot.ts`'s `park()` documented, arriving by a
 * different door now that a screen's own tree can hold the cursor. BOTH calls are
 * needed and neither is redundant: `blur()` is what actually hides the cursor (it
 * calls `setCursorPosition(0, 0, false)`) and `visible = false` is what stops the
 * subtree painting.
 *
 * Recursive because the focused renderable is a DESCENDANT of the slot: the
 * kernel parks the four region slots, while the widget that holds the cursor is
 * a node inside one of the mounted trees. A parked region is a handful of nodes,
 * and the walk stops at the region's own root — this is not a whole-tree scan.
 */
export function parkRegion(slot: Renderable): void {
  slot.visible = false;
  const blur = (node: Renderable): void => {
    if (node.focused) node.blur();
    for (const child of node.getChildren()) blur(child);
  };
  blur(slot);
}

export function unmountTree(parent: Renderable, mounted: MountedTree): void {
  parent.remove(mounted.root);
  mounted.root.destroyRecursively();
}

/**
 * BB-340 D7 — the pipe path, rendered from the tree.
 *
 * Only `present().body` is mounted, NOT the shell: capturing the shell would add
 * the header box and the status footer, which are not in today's pipe output.
 * The three screens carrying their own `renderNonInteractive()` (spec F5) never
 * reach here.
 *
 * Accepted cost, stated in the spec: piping now dlopens the ~19 MB
 * libopentui.so on a path that constructed no renderable before. The runtime is
 * already there — `shouldReExecUnderBun` does not consult `isTTY`.
 *
 * THE GRID IS SIZED TO THE CONTENT'S HEIGHT, not to the terminal's, and that is
 * not a liberty taken with D7's "sized to the terminal": a pipe prints the WHOLE
 * screen and never a window into it. A run's log is its transcript
 * `split('\n')`, so a body of several hundred rows is ordinary, and
 * `captureCharFrame` returns exactly `height` rows — sized to 24 it would drop
 * every row after the first 24 with nothing to say so. The height comes from
 * Yoga (`laidOutHeight`), so nothing here counts rows or columns of anything
 * (R5).
 *
 * THE BODY-WINDOW INSET IS TAKEN OFF. `bodyWindowRoot` insets a screen's tree by
 * `BODY_INSET` columns because the body WINDOW sits inside a header box whose
 * content starts at column 2. A pipe has no window and no box, and today's
 * output starts at column 0, so the root's padding is cleared on the mounted
 * renderable — the same statement `presentation()` makes for a modal, which is
 * not the body window either.
 *
 * WIDTH IS THE CALLER'S, AND IT CLIPS. A cell grid is `width` columns wide, so a
 * row longer than that is cut at the edge — with no ellipsis, because nothing
 * here truncates. That is a real difference from the row surface, which handed
 * the pipe whatever length it had composed.
 */
export async function renderBodyToText(
  body: VNode,
  size: { readonly width: number; readonly height: number },
): Promise<string[]> {
  const { createTestRenderer } = await import('@opentui/core/testing');
  const setup = await createTestRenderer({
    width: size.width,
    height: size.height,
    // No terminal to overlay anything onto, and an error must reach the pipe's
    // stderr rather than a console the capture would then contain.
    consoleMode: 'disabled',
    openConsoleOnError: false,
  });
  const mounted = mountTree(setup.renderer, setup.renderer.root, body);
  mounted.root.paddingLeft = 0;
  mounted.root.paddingRight = 0;
  await setup.renderOnce();
  const rows = laidOutHeight(mounted.root);
  // A second pass, because the height cannot be known before Yoga has run and
  // `resize` is what re-allocates the capture buffer behind `captureCharFrame`.
  if (rows > 0 && rows !== size.height) {
    setup.resize(size.width, rows);
    await setup.renderOnce();
  }
  const frame = rows > 0 ? setup.captureCharFrame() : '';
  unmountTree(setup.renderer.root, mounted);
  setup.renderer.destroy();
  // Trailing spaces go because `captureCharFrame` returns a PADDED cell grid and
  // today's output is not padded; `slice` drops the grid's own trailing newline.
  return frame
    .split('\n')
    .slice(0, rows)
    .map((line) => line.replace(/\s+$/, ''));
}

/**
 * The region a SCREEN's own body tree is rooted under — `region-body-window`.
 *
 * Deliberately NOT `body`: `region-body` is the body ScrollBox the kernel
 * constructs, and one id for two renderables is exactly what `collectIds`
 * refuses. Both producers of a body tree read this one name — the screen
 * contract's `presentation()` and `Kernel/chrome.ts`'s `treeRegionOf` — so the
 * tree a screen hands over and the tree the kernel stands up in that slot share
 * a root id, which is what lets `patchTree` reuse the standing box instead of
 * building a second one beside it.
 */
export const BODY_WINDOW_REGION = 'body-window';

/**
 * The root box a REGION's tree hangs under, and the one place its shape is
 * stated.
 *
 * Both producers of a body tree go through it — the bridge below, and
 * `presentation()` for a screen that hands over renderables of its own — so the
 * tree the kernel stands up in a slot and the tree a screen hands over share a
 * root id AND a layout by construction. `patchTree` reuses a standing node only
 * when the id matches, so a second shape here would mean a second box beside the
 * first rather than a visible error.
 */
const rootBox = (
  region: string,
  inset: number,
  children: readonly VNode[],
): VNode =>
  h(
    BoxRenderable,
    {
      id: `region-${region}`,
      flexDirection: 'column',
      flexShrink: 0,
      // STATED WHETHER OR NOT IT IS ZERO. `patchTree` writes only the props the
      // next tree declares, so a padding set for a converted body and omitted by
      // the bridged one would survive the navigation between them and indent the
      // bridged body twice.
      paddingLeft: inset,
      paddingRight: inset,
    },
    ...children,
  );

export const regionRoot = (region: string, ...children: VNode[]): VNode =>
  rootBox(region, 0, children);

/**
 * The columns a BODY row is inset by on each side.
 *
 * Not decoration: `styleVisibleLines` (`lib/ansi.ts`) bakes exactly two columns
 * into the text of every bridged row and fits the rest to `width - 4`, so a
 * composed body occupies columns 2 … width-2. A CONVERTED body carries no such
 * text, so the same inset has to be declared as padding or the screen sits flush
 * at column 0 under a header box whose content starts at column 2.
 *
 * MEASURED, not deduced: plan Task 7 converted the two list screens and the
 * indent went with the rows, unnoticed — no pinned picture covered those two.
 * `tests-bun/Kernel/project-overview-pin.test.ts` is a pinned picture and it
 * caught it the moment the projects screen converted.
 */
export const BODY_INSET = 2;

/**
 * The root a CONVERTED screen's body hangs under: {@link regionRoot}'s shape,
 * plus the body window's own inset.
 *
 * The inset belongs to the WINDOW rather than to the screen, which is why it is
 * declared here and not in thirteen components — and why the bridged leg, whose
 * rows already carry it as text, roots through `regionRoot` instead.
 */
export const bodyWindowRoot = (tree: VNode): VNode =>
  rootBox(BODY_WINDOW_REGION, BODY_INSET, [tree]);

// BB-340 Task 12 — `lineNode` USED TO LIVE HERE, and is deliberately gone.
//
// It was the last reader of an SGR-carrying string: it took ONE composed row,
// handed it to `lib/styled-text.ts`'s `ansiToStyledText` to turn the escapes
// back into styled chunks, and gave the result to a `TextRenderable`. Its first
// caller was the bridge that wrapped a screen's `lines`; when the row surface
// left the contract its last caller was `Kernel/chrome.ts`, whose header box,
// status footer and modal header were still `fitLine`d templates.
//
// The chrome states cells now — a border prop, a title prop, an INVERSE
// attribute — so nothing composes a row for a renderable to read back, and
// `lib/styled-text.ts` and `lib/ansi.ts` went with it. What a caller wants
// instead is `lib/vnode.ts`'s `textNode`: the same physical row, with the
// styling stated as props rather than parsed out of bytes.
