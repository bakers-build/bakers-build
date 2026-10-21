import { afterEach, describe, expect, it } from 'bun:test';
import type { Renderable } from '@opentui/core';
import {
  filterBadgeStrip,
  type ListFilterBadge,
} from '../../src/Component/list-chrome/index.js';
import { mountTree, patchTree } from '../../src/Kernel/mount.js';
import { type BareHarness, createHarness } from '../tui-harness.js';

/**
 * Native OpenTUI layout for the shared filter chips: Yoga geometry and the
 * captured character frame, not `renderTree`.
 */
const live: BareHarness[] = [];

const newHarness = async (columns: number): Promise<BareHarness> => {
  const harness = await createHarness({ columns, rows: 16 });
  live.push(harness);
  return harness;
};

afterEach(() => {
  for (const harness of live.splice(0)) harness.renderer.destroy();
});

const shortBadges: readonly ListFilterBadge[] = [
  { id: 'closed', label: 'x closed', value: 'closed: hidden' },
  { id: 'search', label: '/ search', value: 'search: foo' },
  { id: 'who', label: 'w who', value: 'who: cw' },
  { id: 'mine', label: 'm mine', value: 'mine' },
  { id: 'clear', label: 'c clear' },
];

const idleBadges: readonly ListFilterBadge[] = shortBadges.map((badge) => ({
  id: badge.id,
  label: badge.label,
}));

const shortChipText = [
  'x closed: hidden',
  '/ search: foo',
  'w who: cw',
  'm mine',
  'c clear',
] as const;

const boxOf = (node: Renderable | undefined) => {
  if (node === undefined) throw new Error('missing chip');
  return { x: node.x, y: node.y, w: node.width, h: node.height };
};

const assertGeometry = (
  mounted: { readonly byId: ReadonlyMap<string, Renderable> },
  columns: number,
): void => {
  const chips = ['closed', 'search', 'who', 'mine', 'clear'].map((id) =>
    boxOf(mounted.byId.get(`probe-${id}-chip`)),
  );
  for (const chip of chips) {
    expect(chip.x).toBeGreaterThanOrEqual(0);
    expect(chip.x + chip.w).toBeLessThanOrEqual(columns);
  }
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      const a = chips[i]!;
      const b = chips[j]!;
      const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
      const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlapX && overlapY).toBe(false);
    }
  }
};

const occurrences = (frame: string, needle: string): number => {
  let count = 0;
  let from = 0;
  while (true) {
    const at = frame.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
};

describe('filterBadgeStrip native layout', () => {
  for (const columns of [60, 80] as const) {
    it(`shows every short chip string at ${columns} columns without overlap`, async () => {
      const harness = await newHarness(columns);
      const mounted = mountTree(
        harness.renderer,
        harness.root,
        filterBadgeStrip('probe', shortBadges),
      );
      await harness.renderOnce();
      const frame = harness.captureCharFrame();
      for (const text of shortChipText) {
        expect(frame, `${columns}col missing ${text}`).toContain(text);
      }
      assertGeometry(mounted, columns);
    });
  }

  it('patches active to idle and back without a duplicate or stale shortcut', async () => {
    const harness = await newHarness(80);
    let mounted = mountTree(
      harness.renderer,
      harness.root,
      filterBadgeStrip('probe', shortBadges),
    );
    await harness.renderOnce();
    expect(occurrences(harness.captureCharFrame(), 'x closed: hidden')).toBe(1);
    expect(mounted.byId.get('probe-closed-key')?.visible).toBe(true);

    mounted = patchTree(
      harness.renderer,
      mounted,
      filterBadgeStrip('probe', idleBadges),
    );
    await harness.renderOnce();
    const idle = harness.captureCharFrame();
    expect(idle).toContain('x closed');
    expect(idle).not.toContain('closed: hidden');
    expect(idle).toContain('/ search');
    expect(idle).not.toContain('search: foo');
    expect(occurrences(idle, 'x closed')).toBe(1);
    expect(mounted.byId.get('probe-closed-key')?.visible).toBe(false);

    mounted = patchTree(
      harness.renderer,
      mounted,
      filterBadgeStrip('probe', shortBadges),
    );
    await harness.renderOnce();
    const active = harness.captureCharFrame();
    expect(occurrences(active, 'x closed: hidden')).toBe(1);
    expect(occurrences(active, 'm mine')).toBe(1);
    expect(mounted.byId.get('probe-closed-key')?.visible).toBe(true);
  });

  it('keeps the leading search shortcut for a multibyte value and an overlong value', async () => {
    const harness = await newHarness(80);
    const cafe = mountTree(
      harness.renderer,
      harness.root,
      filterBadgeStrip('probe', [
        { id: 'search', label: '/ search', value: 'search: café' },
        { id: 'clear', label: 'c clear' },
      ]),
    );
    await harness.renderOnce();
    expect(harness.captureCharFrame()).toContain('/ search: café');
    expect(cafe.byId.get('probe-search-key')?.visible).toBe(true);

    patchTree(
      harness.renderer,
      cafe,
      filterBadgeStrip('probe', [
        {
          id: 'search',
          label: '/ search',
          value: `search: ${'a'.repeat(120)}`,
        },
        { id: 'clear', label: 'c clear' },
      ]),
    );
    await harness.renderOnce();
    const long = harness.captureCharFrame();
    expect(long).toContain('/ ');
    expect(long.includes('search: a') || long.includes('/ search')).toBe(true);
  });
});
