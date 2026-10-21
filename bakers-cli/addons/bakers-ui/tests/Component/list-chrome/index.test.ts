import { describe, expect, it } from 'vitest';
import { filterBadgeStrip } from '../../../src/Component/list-chrome/index.js';
import {
  BORDER,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
} from '../../../src/lib/vnode.js';
import { nodeById, renderTree } from '../../render-tree.js';

describe('filterBadgeStrip (BB-375)', () => {
  it('each badge is a rounded chip; active FOREGROUND_ACTIVE, idle FOREGROUND', () => {
    const strip = filterBadgeStrip('probe-filter', [
      { id: 'closed', label: 'x closed', value: 'closed: hidden' },
      { id: 'search', label: '/ search' },
    ]);
    expect((strip.props as { border?: unknown }).border).toBeFalsy();
    expect((strip.props as { backgroundColor?: unknown }).backgroundColor).toBe(
      DEFAULT_BACKGROUND,
    );
    expect((strip.props as { paddingLeft?: number }).paddingLeft).toBe(1);
    expect((strip.props as { paddingRight?: number }).paddingRight).toBe(1);

    const activeChip = nodeById(strip, 'probe-filter-closed-chip');
    const idleChip = nodeById(strip, 'probe-filter-search-chip');
    expect((activeChip?.props as { border?: unknown })?.border).toBe(true);
    expect((activeChip?.props as { borderStyle?: unknown })?.borderStyle).toBe(
      'rounded',
    );
    expect((activeChip?.props as { borderColor?: unknown })?.borderColor).toBe(
      BORDER,
    );
    expect(
      (activeChip?.props as { backgroundColor?: unknown })?.backgroundColor,
    ).toBe(DEFAULT_BACKGROUND);
    expect(
      (idleChip?.props as { backgroundColor?: unknown })?.backgroundColor,
    ).toBe(DEFAULT_BACKGROUND);
    expect((activeChip?.props as { paddingLeft?: number })?.paddingLeft).toBe(
      2,
    );
    expect((activeChip?.props as { paddingRight?: number })?.paddingRight).toBe(
      2,
    );

    const active = nodeById(strip, 'probe-filter-closed');
    const idle = nodeById(strip, 'probe-filter-search');
    expect((active?.props as { fg?: unknown })?.fg).toBe(FOREGROUND_ACTIVE);
    expect((idle?.props as { bg?: unknown })?.bg).toBe(DEFAULT_BACKGROUND);
    expect((idle?.props as { fg?: unknown })?.fg).toBe(FOREGROUND);
    expect((active?.props as { content?: string })?.content).toBe(
      'closed: hidden',
    );
    expect(renderTree(activeChip!).join('')).toBe('x closed: hidden');
    expect(nodeById(strip, 'probe-filter-closed-key')?.props).toMatchObject({
      content: 'x ',
      fg: FOREGROUND,
      bg: DEFAULT_BACKGROUND,
    });
    expect((idle?.props as { content?: string })?.content).toBe('/ search');
  });

  it('keeps the shortcut visible on an active chip, including a value of just the idle name', () => {
    const strip = filterBadgeStrip('probe', [
      { id: 'closed', label: 'x closed', value: 'closed: hidden' },
      { id: 'mine', label: 'm mine', value: 'mine' },
      { id: 'search', label: '/ search', value: '' },
    ]);
    expect(renderTree(nodeById(strip, 'probe-closed-chip')!).join('')).toBe(
      'x closed: hidden',
    );
    expect(renderTree(nodeById(strip, 'probe-mine-chip')!).join('')).toBe(
      'm mine',
    );
    expect(renderTree(nodeById(strip, 'probe-search-chip')!).join('')).toBe(
      '/ search',
    );
    expect(nodeById(strip, 'probe-search-key')).toBeUndefined();
    expect(nodeById(strip, 'probe-closed-key')?.props).toMatchObject({
      fg: FOREGROUND,
      bg: DEFAULT_BACKGROUND,
    });
    expect(nodeById(strip, 'probe-closed')?.props).toMatchObject({
      fg: FOREGROUND_ACTIVE,
    });
  });
});
