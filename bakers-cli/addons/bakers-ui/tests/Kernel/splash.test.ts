import type { StyledText, VNode } from '@opentui/core';
import { describe, expect, it, vi } from 'vitest';
import { LOGO_WIDTH } from '../../src/Kernel/logo.js';
import {
  awaitSplash,
  SPLASH_FRAME_PAD_Y,
  SPLASH_TEXT,
  shouldSkipSplash,
  splashTree,
  splashWordmark,
} from '../../src/Kernel/splash.js';
import {
  BORDER,
  BORDER_EMPHASIS,
  BRAND_LINE,
  BRAND_SLICE,
  BRAND_TILE,
  DEFAULT_BACKGROUND,
  SPLASH_MS,
} from '../../src/lib/theme.js';
import { childrenOf, nodeById } from '../render-tree.js';

describe('splash (BB-375 D6)', () => {
  it('pins SPLASH_MS to 500', () => {
    expect(SPLASH_MS).toBe(500);
  });

  it('shows bakers.build, not bakers', () => {
    expect(SPLASH_TEXT).toBe('bakers.build');
  });

  it.each([
    [200, 'block'],
    [125, 'block'],
    [124, 'tiny'],
    [80, 'tiny'],
    [70, 'tiny'],
    [69, 'text'],
    [60, 'text'],
  ])('at %i columns uses the %s wordmark inside the terminal', (width, tier) => {
    const mark = splashWordmark(width);
    expect(mark.tier).toBe(tier);
    expect(mark.frameWidth).toBeLessThanOrEqual(width);
  });

  it.each([
    [200, 'block'],
    [80, 'tiny'],
  ])('at %i columns renders a BORDER frame with a %s ASCIIFont wordmark', (width, font) => {
    const tree = splashTree(width);
    const frame = nodeById(tree, 'splash-frame');
    expect(
      (frame?.props as { borderColor?: unknown } | undefined)?.borderColor,
    ).toBe(BORDER);
    expect((frame?.props as { border?: unknown } | undefined)?.border).toBe(
      true,
    );
    expect((frame?.props as { width?: number } | undefined)?.width).toBe(
      splashWordmark(width).frameWidth,
    );
    expect(
      (frame?.props as { paddingTop?: number } | undefined)?.paddingTop,
    ).toBe(SPLASH_FRAME_PAD_Y);
    expect(SPLASH_FRAME_PAD_Y).toBeGreaterThanOrEqual(2);
    const mark = nodeById(tree, 'splash-wordmark');
    const props = mark?.props as
      | {
          text?: string;
          font?: string;
          color?: unknown;
          backgroundColor?: unknown;
        }
      | undefined;
    expect(props?.text).toBe('bakers.build');
    expect(props?.font).toBe(font);
    expect(props?.color).toBe(BORDER_EMPHASIS);
    expect(props?.backgroundColor).toBe(DEFAULT_BACKGROUND);
    expect(
      (tree.props as { backgroundColor?: unknown } | undefined)
        ?.backgroundColor,
    ).toBe(DEFAULT_BACKGROUND);
  });

  it('falls back to plain bakers.build text on a narrow terminal', () => {
    const mark = nodeById(splashTree(60), 'splash-wordmark');
    const props = mark?.props as
      | { content?: string; font?: string; fg?: unknown }
      | undefined;
    expect(props?.content).toBe('bakers.build');
    expect(props?.font).toBeUndefined();
    expect(props?.fg).toBe(BORDER_EMPHASIS);
  });

  it('draws the bread-slice logo in the brand slots, not the braid', () => {
    const tree = splashTree(80);
    expect(nodeById(tree, 'splash-braid')).toBeUndefined();
    const logo = nodeById(tree, 'splash-logo');
    expect((logo?.props as { width?: number } | undefined)?.width).toBe(
      LOGO_WIDTH,
    );
    const rows = childrenOf(logo as VNode);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const brand = new Set([BRAND_TILE, BRAND_LINE, BRAND_SLICE]);
    const colours = new Set<unknown>();
    for (const row of rows) {
      const props = row.props as { id: string; content: StyledText };
      expect(props.id).toMatch(/^splash-logo-row-\d+$/);
      const chunks = props.content.chunks;
      expect(chunks.map((chunk) => chunk.text).join('')).toHaveLength(
        LOGO_WIDTH,
      );
      for (const chunk of chunks) {
        for (const colour of [chunk.fg, chunk.bg]) {
          if (colour === undefined) continue;
          expect(brand.has(colour as never)).toBe(true);
          colours.add(colour);
        }
      }
    }
    expect(colours).toEqual(brand);
  });

  it('splash-root is an absolute inset-0 overlay that centres its frame', () => {
    // Regression: the splash mounts into the SAME shell `createRegions` has
    // already filled with region-chrome/body/footer. A column child would take a
    // slice beside `region-body`'s `flexGrow` and land off-centre; it must be out
    // of the flow (absolute, inset 0, 100%×100%) so it fills the shell and its
    // own center alignment puts the frame in the true middle.
    const root = splashTree(80);
    const props = root.props as Record<string, unknown> | undefined;
    expect(props?.position).toBe('absolute');
    expect(props?.left).toBe(0);
    expect(props?.top).toBe(0);
    expect(props?.width).toBe('100%');
    expect(props?.height).toBe('100%');
    expect(props?.justifyContent).toBe('center');
    expect(props?.alignItems).toBe('center');
  });

  it('awaitSplash holds for the given ms via the injectable wait', async () => {
    const wait = vi.fn(async (_ms: number) => undefined);
    await awaitSplash(500, wait);
    expect(wait).toHaveBeenCalledWith(500);
  });

  it('skips splash by default when a renderer is injected (harness)', () => {
    expect(shouldSkipSplash({ renderer: {} as never })).toBe(true);
    expect(shouldSkipSplash({})).toBe(false);
    expect(shouldSkipSplash({ skipSplash: false, renderer: {} as never })).toBe(
      false,
    );
    expect(shouldSkipSplash({ skipSplash: true })).toBe(true);
  });
});
