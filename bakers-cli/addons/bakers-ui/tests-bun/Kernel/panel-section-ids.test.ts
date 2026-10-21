import { afterEach, describe, expect, it } from 'bun:test';
import { TICKET_SECTIONS } from '../../src/Entity/ticket/Component/sections/index.js';
import { tabViewTree } from '../../src/Entity/ticket/Component/ticket-detail/index.js';
import { mountTree } from '../../src/Kernel/mount.js';
import { type BareHarness, createHarness } from '../tui-harness.js';

/**
 * BB-373 AC-10 — a contributed panel's tab, driven through the REAL
 * `mountTree`.
 *
 * The node-level suite asserts that the derivation is injective; this one
 * asserts what that buys. `mount` is where a repeated id is refused, and it is
 * refused while MOUNTING — past the host's `try` around `panel.sections()`, on a
 * path (`Kernel/tui-kernel.ts` registers `draw` straight onto the resize event)
 * that has no `catch` of its own. So "colliding ids take the cockpit down" is
 * only ASSERTED until the real mount runs; here it is run.
 *
 * A bare harness rather than a booted cockpit, for `mount.test.ts`'s reason: the
 * question is about a tree and a renderer, and booting a kernel to ask it would
 * put a route, a registry and a document between the case and its subject.
 */
const live: BareHarness[] = [];

const newHarness = async (): Promise<BareHarness> => {
  const harness = await createHarness();
  live.push(harness);
  return harness;
};

afterEach(() => {
  for (const harness of live.splice(0)) harness.renderer.destroy();
});

/** The first index past the built-ins — where a contributed panel sits. */
const PANEL_TAB = TICKET_SECTIONS.length;

describe('a contributed panel mounts', () => {
  /**
   * The two headings are ordinary: one artifact written into a subdirectory and
   * one written beside it with a hyphen in its name. Under the collapsing
   * derivation both keyed `playwright-logs-walk-txt`, and this mount threw
   * `BB-340: the id "…" is declared twice in one tree` — a message naming
   * neither the addon nor the file that produced the heading.
   */
  it('AC-10: two artifact paths differing only in a separator mount as two nodes', async () => {
    const { renderer, root } = await newHarness();
    const view = tabViewTree({}, PANEL_TAB, {
      panelSections: [
        {
          heading: 'playwright/logs/walk.txt',
          expandable: true,
          lines: ['pnpm playwright test', 'ok'],
        },
        {
          heading: 'playwright/logs-walk.txt',
          expandable: true,
          lines: ['pnpm playwright test --headed', 'ok'],
        },
      ],
    });

    const mounted = mountTree(renderer, root, view.body);

    // Both caret rows are live nodes of their own — the property `patchTree`
    // needs to write the flipped glyph onto the entry the operator toggled
    // rather than onto the one above it.
    expect(view.rowIds).toHaveLength(2);
    for (const id of view.rowIds) {
      expect(mounted.byId.get(id), `${id} is mounted`).toBeDefined();
    }
    expect(mounted.byId.get(view.rowIds[0] ?? '')).not.toBe(
      mounted.byId.get(view.rowIds[1] ?? ''),
    );
  });
});
