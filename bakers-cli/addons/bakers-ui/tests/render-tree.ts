import { isVNode, type VNode } from '@opentui/core';

/**
 * BB-340 D8 — turn a VNode tree into the text it carries, in tree order.
 *
 * DELIBERATELY NOT A LAYOUT ENGINE. It does not measure display columns, pad,
 * truncate or wrap. One that did would be `lib/width.ts` under a new name, and
 * deleting that file is half of what this ticket is for. Column accuracy is
 * asserted in the Bun suite through `captureCharFrame`, against real Yoga.
 *
 * A test helper, and it lives in `tests/` for that reason: in `src/` it would
 * count against the line target for something the product never runs.
 */
const textOf = (content: unknown): string | undefined => {
  if (content === undefined || content === null) return undefined;
  if (typeof content === 'string') return content;
  const chunks = (content as { chunks?: readonly { text?: string }[] }).chunks;
  if (chunks) return chunks.map((chunk) => chunk.text ?? '').join('');
  return String(content);
};

/** The VNode children of a node, in tree order. `h()` flattens; a tree may not. */
export const childrenOf = (node: VNode): VNode[] =>
  ((node.children ?? []) as unknown[])
    .flat(Number.POSITIVE_INFINITY)
    .filter(isVNode) as VNode[];

export function renderTree(node: VNode): string[] {
  const out: string[] = [];
  const walk = (current: VNode): void => {
    const text = textOf(
      (current.props as { content?: unknown } | undefined)?.content,
    );
    if (text !== undefined) out.push(text);
    for (const child of childrenOf(current)) walk(child);
  };
  walk(node);
  return out;
}

/**
 * The same, for a LIST TABLE's tree: the values, without the fill — BB-345.
 *
 * A table cell's content is `<separator><value><fill>` since the selection
 * highlight became a continuous bar. The blanks are there so the row's ATTRIBUTE
 * covers the columns the value does not; how many of them are painted is Yoga's
 * answer against a terminal, and a GROWING cell carries a deliberately over-long
 * run of them because nothing declares how wide it resolves to. This helper
 * answers "what does the row SAY", which is the only question a node-level suite
 * can ask — the geometry lives in `tests-bun/Screen/list-table-layout.test.ts`,
 * on a real renderer, where the fill can be seen at all.
 *
 * SEPARATE from {@link renderTree} rather than folded into it, because trailing
 * blanks are not always fill: the chrome's tab bar and status footer pad their
 * own full-width rows on purpose, and `tests/Kernel/chrome.test.ts` pins that
 * padding. Trimming there would have deleted five real assertions.
 *
 * The LEADING separator is deliberately kept. It is one column of the cell now
 * rather than the row's Yoga `gap`, and the project picker's own marker column
 * begins with a blank for an unrelated reason (` ` where the selected row has
 * `▸`) — a helper that stripped it could not tell the two apart, and the
 * picker's node tree is compared against its piped form character by character.
 *
 * NOT a weakening of the fill's guarantee, which is asserted where this trim
 * cannot reach: `tests/Screen/list-table.test.ts` pins the exact padded
 * `props.content` of a cell, and the Bun suite pins that a selected row paints
 * as ONE inverse run from column 0 to the right edge. Removing the fill fails
 * both.
 */
export const cellValues = (node: VNode): string[] =>
  renderTree(node).map((text) => text.replace(/ +$/, ''));

/**
 * Every `props.id` the tree declares, in tree order.
 *
 * The id is the identity `Kernel/mount.ts` patches by (D4), so "no id is used
 * twice" and "the ids are the entities' own" (R4) are assertions a test has to
 * be able to make directly rather than by counting rows from the top.
 */
export function idsOf(node: VNode): string[] {
  const out: string[] = [];
  const walk = (current: VNode): void => {
    const id = (current.props as { id?: string } | undefined)?.id;
    if (id !== undefined) out.push(id);
    for (const child of childrenOf(current)) walk(child);
  };
  walk(node);
  return out;
}

/** The node with this `props.id`, anywhere in the tree, or undefined. */
export function nodeById(node: VNode, id: string): VNode | undefined {
  if ((node.props as { id?: string } | undefined)?.id === id) return node;
  for (const child of childrenOf(node)) {
    const found = nodeById(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The `props.id`s of the DIRECT children of the node with this id, in order.
 *
 * BB-340 Task 9 — what a caret's `row` used to be. The insertion point is a
 * node inside its own field's column now, so "which row of this field does the
 * block occupy" is a question about child ORDER rather than about an index into
 * a shared array of strings, and it is answered here rather than by counting
 * text.
 */
export function childIdsOf(node: VNode, id: string): string[] {
  const parent = nodeById(node, id);
  if (parent === undefined) return [];
  return childrenOf(parent).map(
    (child) => (child.props as { id?: string } | undefined)?.id ?? '',
  );
}
