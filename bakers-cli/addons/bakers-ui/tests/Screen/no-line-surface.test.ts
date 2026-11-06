import { isVNode } from '@opentui/core';
import { describe, expect, it } from 'vitest';
import { buildRoutes } from '../../src/Routing/routes.js';

const routes = buildRoutes();

import { idsOf } from '../render-tree.js';
import { contextFor, expectScreenLifecycle } from './contract.js';

/**
 * BB-340 spec A1 — the teardown criterion, as a test over every screen.
 *
 * The ticket's whole point is that a destination hands over renderables rather
 * than rows of text somebody had to measure into columns. "No screen returns
 * `lines`" is asserted here rather than left to convention, because convention
 * is what let the row surface survive twelve conversions: a screen that quietly
 * grew one back would still draw, through the bridge, and nothing would say so.
 *
 * `pnpm run typecheck` is the second and stronger observer — with `lines` off
 * `ScreenPresentation` a straggler is a compile error — but a type says nothing
 * about a screen that never gets constructed. This enumerates the registry, so
 * a route that is registered is a route that is checked.
 */
describe('the boundary is a renderable tree (BB-340 A1)', () => {
  const session = routes.createSession({ services: {}, nowSeconds: () => 0 });
  const screens = [...session.screens().values()];

  it('registers thirty-nine screens', () => {
    // The count is `src/Routing/routes.ts`'s own list. It is pinned so that a
    // screen added without a line in this suite fails here rather than being
    // silently unchecked. BB-377 added Users + three user-level screens.
    // BB-391 added the Teams list and the team detail — and this suite's
    // per-screen cases are generated from the registry, so both are covered by
    // the enumeration below the moment they are registered. BB-450 added the
    // project-scoped Conductors tab (`ProjectConductorsScreen`), 19 → 20.
    // BB-472 added the workspace-picker (`WorkspacePickerScreen`), 20 → 21.
    // Comments, Related and Runs now own screens; Planning joins that set.
    // BB-516 removed TicketRelatedScreen (now in the Overview sidebar), 31 → 30.
    // The run-edit screen the cancel action reaches took 30 → 31.
    // The conductor detail scope added four screens (Overview, Held work,
    // Assigned, Log), 31 → 35.
    // BB-540 added the project-filter picker (My work, `ProjectFilterScreen`)
    // and the no-project parent picker (`MyWorkParentFilterScreen`), 35 → 37.
    // The ticket Addons tab and its action form took 37 → 39.
    // Statistics (My, Project, Team, Team-member), the create form and
    // Ticket-Agents left, 39 → 33.
    expect(screens).toHaveLength(33);
  });

  for (const screen of screens) {
    it(`${screen.id} presents a VNode body and no rows`, () => {
      const shown = screen.present(contextFor());
      expect(isVNode(shown.body)).toBe(true);
      expect('lines' in shown).toBe(false);
    });

    /**
     * A1's SECOND CLAUSE — "`ScreenPresentation` carries no `string[]` surface".
     *
     * The case above asserts `'lines' in shown === false` and nothing else, which
     * is why it could report PASS while `header?: readonly string[]` was still on
     * the contract: it observes one KEY where the criterion is about a KIND. This
     * checks the kind, over whatever the presentation actually carries, so a row
     * surface cannot come back under another name.
     *
     * An EMPTY array is a violation as much as a full one: a regrown surface would
     * be empty on a screen with no data, which is the state most screens are in
     * here, so exempting `[]` would exempt exactly the case this guard is for.
     *
     * ONE MEMBER IS EXEMPT, AND EARNS IT BY SHAPE. `rowIds` is `readonly string[]`
     * and is not a surface: it is IDENTITY — the node of each selectable row, in
     * selection order (Task 11), the successor of the `selectedRow` NUMBER that
     * came off the contract with the rows. So the exemption is not taken on trust:
     * every entry must name a node of the body it was published with. A `rowIds`
     * that started carrying text would fail on that, not pass on its name — and
     * because every screen this file can construct is EMPTY, the populated half of
     * the same claim is asserted in `tests/Screen/project-screens.test.ts`, on a
     * run list that really has rows.
     */
    it(`${screen.id} carries no string-array surface, only node ids (A1)`, () => {
      const shown = screen.present(contextFor());
      const stringLists = Object.entries(shown)
        .filter(
          ([, value]) =>
            Array.isArray(value) &&
            value.every((item) => typeof item === 'string'),
        )
        .map(([key]) => key);
      expect(stringLists.filter((key) => key !== 'rowIds')).toEqual([]);

      const nodes = new Set(idsOf(shown.body));
      for (const id of shown.rowIds ?? [])
        expect(
          nodes.has(id),
          `rowIds entry ${id} names a node of the body`,
        ).toBe(true);
    });

    it(`${screen.id} survives the lifecycle with the same contract`, () => {
      expectScreenLifecycle(screen, contextFor());
    });
  }
});
