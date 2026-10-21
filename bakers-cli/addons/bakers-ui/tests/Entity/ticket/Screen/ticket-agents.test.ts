// BB-345 (re-entry) — the agents list, as the SIXTH `ListTable` configuration.
//
// This file is `tests/Agent/Component/agent-list/index.test.ts` moved to the
// configuration's new home, with every assertion it made kept. The renderer it
// tested (`agentListTree` / `agentRowIds`, `Agent/Component/agent-list/`) is
// deleted: it was a hand-written per-entity list with its own `LABEL_WIDTH`, its
// own noun and its own row-id derivation — exactly the duplication `ListTable`
// exists to make unrepresentable. It was missed at qualification because it
// entered the tree with the rebase onto the merged BB-340 tip, after the scope
// was fixed.
//
// WHAT MOVED IN THE EXPECTATIONS, and why each edit is a decision rather than a
// failure silenced (spec R1):
//
//  - The container node is `agent-table`, not `agent-list`: `listTableTree` keys
//    it `<noun>-table` for every list. Every OTHER id is BYTE-IDENTICAL, which is
//    deliberate — `noun: 'agent'` is kept, and the two columns are keyed `label`
//    and `project`, so the rows stay `agent-row-<id>`, the cells
//    `agent-cell-<id>-label` / `-project`, the header `agent-header-*` and the
//    empty row `agent-empty`. `Kernel/mount.ts` patches by id and the mouse
//    resolves a click through `rowIds`, so keeping them was worth choosing the
//    column keys around.
//  - A cell's text now carries the column SEPARATOR as a leading blank and a
//    trailing FILL, because the row's cells touch and the highlight is a
//    continuous bar (`Entity/collection.ts`'s `cellFill` / `seamlessRowNode`).
//    The row-text assertions match on the value, and `cellValues` trims the fill,
//    exactly as the other five lists' node suites do.
//  - The highlight assertion gains the HEADER's `bold`, which is the second of
//    the two findings this ticket exists to fix and which the hand-written
//    renderer had no way to state at all.

import { expect, it } from 'vitest';
import {
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../../../src/Entity/collection.js';
import { AGENT_TABLE } from '../../../../src/Entity/ticket/Screen/ticket-agents.js';
import {
  BOLD,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
} from '../../../../src/lib/vnode.js';
import type { HostedAgent } from '../../../../src/types.js';
import {
  cellValues,
  idsOf,
  nodeById,
  renderTree,
} from '../../../render-tree.js';

const agent = (over: Partial<HostedAgent>): HostedAgent => ({
  id: 'p1',
  group: 'bakers',
  label: 'New feature',
  ...over,
});

const tree = (agents: HostedAgent[], selectedIndex = -1) =>
  listTableTree(AGENT_TABLE, agents, undefined, { selectedIndex });

/** One row's cells as text — a row is a box of cells now, not a padded line. */
const rowText = (node: ReturnType<typeof tree>, id: string): string => {
  const found = nodeById(node, id);
  if (!found) throw new Error(`no node ${id} in ${idsOf(node).join(', ')}`);
  return renderTree(found).join(' ');
};

it('renders a header + one row per agent (label · project)', () => {
  const node = tree([
    agent({ id: 'p1', group: 'bakers', label: 'New feature' }),
    agent({ id: 'p2', group: 'shop', label: 'fix cart' }),
  ]);
  expect(rowText(node, 'agent-header')).toMatch(/AGENT/);
  expect(rowText(node, 'agent-header')).toMatch(/PROJECT/);
  expect(rowText(node, 'agent-row-p1')).toMatch(/New feature/);
  expect(rowText(node, 'agent-row-p1')).toMatch(/bakers/);
  expect(rowText(node, 'agent-row-p2')).toMatch(/fix cart/);
  expect(rowText(node, 'agent-row-p2')).toMatch(/shop/);
});

it('keys every row on the agent, never on its position (BB-340 D4/R4)', () => {
  // The host's live set is re-read on every refresh and a finished agent drops
  // out of it, so the rows below any removal shift up. A positional key would
  // move one agent's label onto another agent's node with nothing to say so.
  const ids = idsOf(
    tree([agent({ id: 'p1' }), agent({ id: 'p2', label: 'second' })], 0),
  );
  expect(ids).toEqual([
    'agent-table',
    'agent-header',
    'agent-header-label',
    'agent-header-project',
    'agent-row-p1',
    'agent-cell-p1-label',
    'agent-cell-p1-project',
    'agent-row-p2',
    'agent-cell-p2-label',
    'agent-cell-p2-project',
  ]);
  expect(new Set(ids).size, 'no id is declared twice').toBe(ids.length);
  // …and the ids the SCREEN publishes for the mouse are those row ids, read off
  // the same configuration that keys them (BB-345 D2).
  expect(
    listRowIds(AGENT_TABLE, [agent({ id: 'p1' }), agent({ id: 'p2' })]),
  ).toEqual(['agent-row-p1', 'agent-row-p2']);
});

it('highlights exactly the selected row, and states the prop as off on the rest', () => {
  const node = tree(
    [agent({ id: 'p1' }), agent({ id: 'p2', label: 'second' })],
    1,
  );
  const active = idsOf(node).filter((id) => {
    const props = nodeById(node, id)?.props as { fg?: unknown };
    return props?.fg === FOREGROUND_ACTIVE;
  });
  expect(active).toEqual(['agent-cell-p2-label', 'agent-cell-p2-project']);
  // Stated either way — `patchTree` writes only what the next tree declares, so
  // a highlight left off the unselected rows could never be taken off again.
  for (const id of ['agent-cell-p1-label', 'agent-header-label']) {
    const props = nodeById(node, id)?.props as {
      attributes?: number;
      fg?: unknown;
      bg?: unknown;
    };
    expect(typeof props?.attributes, `${id} states its attributes`).toBe(
      'number',
    );
    expect(props?.fg, `${id} states default fg`).toBe(FOREGROUND);
    expect(props?.bg, `${id} states DEFAULT_BACKGROUND`).toBe(
      DEFAULT_BACKGROUND,
    );
  }
});

it('the header row is BOLD and no data row is (finding 2)', () => {
  // The first of the two findings this conversion delivers on this tab: the
  // hand-written renderer emitted no `bold` anywhere, so its header read as one
  // more data row. Asserted on the ATTRIBUTE here and on painted CELLS in
  // `tests-bun/Screen/list-table-layout.test.ts`, which is the only harness that
  // can see what a terminal actually paints.
  const node = tree([agent({ id: 'p1' })], 0);
  const boldOf = (id: string): number =>
    ((nodeById(node, id)?.props as { attributes?: number })?.attributes ?? 0) &
    BOLD;
  expect(boldOf('agent-header-label')).toBe(BOLD);
  expect(boldOf('agent-header-project')).toBe(BOLD);
  expect(boldOf('agent-cell-p1-label')).toBe(0);
  expect(boldOf('agent-cell-p1-project')).toBe(0);
});

it('falls back to the id when an agent has no label', () => {
  expect(
    rowText(tree([agent({ id: 'pane-9', label: '' })]), 'agent-row-pane-9'),
  ).toMatch(/pane-9/);
});

it('renders an explicit empty state', () => {
  const node = tree([]);
  expect(cellValues(node).at(-1)).toBe('No ticket agents.');
  expect(idsOf(node)).toContain('agent-empty');
});

it('is cell-identical, header and row alike (AC-7)', () => {
  // The identity pin the other five lists carry in
  // `tests/Entity/list-render-identity.test.ts`: exact cell values in column
  // order, so a changed width, a lost label or a reordered column fails loudly
  // rather than passing a /AGENT/ match. The leading blank on the second cell is
  // the column separator, which is a column of the cell that follows it now.
  expect(cellValues(nodeById(tree([]), 'agent-header') as never)).toEqual([
    'AGENT',
    ' PROJECT',
  ]);
  expect(
    cellValues(nodeById(tree([agent({ id: 'p1' })]), 'agent-row-p1') as never),
  ).toEqual(['New feature', ' bakers']);
});

it('feeds the surface with no layout from the SAME configuration (D7)', () => {
  // Not a surface the agents tab has today — `TicketAgentsScreen` renders no
  // pipe — but `listTableRows` is half of what makes "one component renders
  // every list" true, and a configuration that could not feed it would be a
  // configuration in name only.
  expect(listTableRows(AGENT_TABLE, [agent({ id: 'p1' })], undefined)).toEqual([
    {
      cells: [
        { text: 'AGENT', width: 32 },
        { text: 'PROJECT', width: 0 },
      ],
    },
    {
      cells: [
        { text: 'New feature', width: 32 },
        { text: 'bakers', width: 0 },
      ],
    },
  ]);
});
