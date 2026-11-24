// BB-375 D6 — timed interactive splash before the first usable chrome frame.
// Non-TTY / pipe never enters this path. Injected-renderer harnesses skip by
// default (`shouldSkipSplash`) so the bun suite does not pay SPLASH_MS.
//
// OpenTUI cannot change the terminal typeface. The “bakers.build” wordmark uses
// the largest ASCIIFont that keeps the BORDER box inside the terminal, and plain
// text below that, so the splash never wraps or clips from 39 columns up.

import {
  ASCIIFontRenderable,
  BoxRenderable,
  h,
  measureText,
  TextRenderable,
  type VNode,
} from '@opentui/core';
import {
  BORDER,
  BORDER_EMPHASIS,
  DEFAULT_BACKGROUND,
  SPLASH_MS,
} from '../lib/theme.js';
import type { TuiOptions } from '../types.js';
import { LOGO_WIDTH, logoTree } from './logo.js';

export { SPLASH_MS };

/** Splash wordmark text (ASCIIFont has no emoji glyphs). */
export const SPLASH_TEXT = 'bakers.build';
/** Vertical padding inside the splash frame. */
export const SPLASH_FRAME_PAD_Y = 2;
/** Horizontal padding inside the splash frame. */
export const SPLASH_FRAME_PAD_X = 4;

/** Logo, gap 3, horizontal padding and the two border columns around the mark. */
const frameWidthFor = (markWidth: number): number =>
  markWidth + LOGO_WIDTH + 3 + SPLASH_FRAME_PAD_X * 2 + 2;

export interface SplashWordmark {
  tier: 'block' | 'tiny' | 'text';
  frameWidth: number;
}

// Largest first; `tiny` is half blocks like the logo.
const FONT_TIERS: SplashWordmark[] = (['block', 'tiny'] as const).map(
  (font) => ({
    tier: font,
    frameWidth: frameWidthFor(measureText({ text: SPLASH_TEXT, font }).width),
  }),
);

/** The largest wordmark whose frame fits `width` columns; plain text otherwise. */
export const splashWordmark = (width: number): SplashWordmark =>
  FONT_TIERS.find((tier) => tier.frameWidth <= width) ?? {
    tier: 'text',
    frameWidth: frameWidthFor(SPLASH_TEXT.length),
  };

const wordmarkTree = (tier: SplashWordmark['tier']): VNode =>
  tier === 'text'
    ? h(TextRenderable, {
        id: 'splash-wordmark',
        content: SPLASH_TEXT,
        fg: BORDER_EMPHASIS,
        bg: DEFAULT_BACKGROUND,
        selectable: false,
      })
    : h(ASCIIFontRenderable, {
        id: 'splash-wordmark',
        text: SPLASH_TEXT,
        font: tier,
        color: BORDER_EMPHASIS,
        backgroundColor: DEFAULT_BACKGROUND,
        selectable: false,
      });

/**
 * Centered BORDER box with the bakers.build wordmark sized for `width` columns —
 * modal-like, not a wash. The terminal typeface is unchanged.
 *
 * shortcut: the tier is picked once at mount, a resize during the 500 ms hold is
 * not followed; re-pick on resize if the splash is ever held longer.
 *
 * `position: 'absolute'` is load-bearing: the splash is mounted into the SAME
 * `shell` that `createRegions` has already filled with `region-chrome`,
 * `region-body` (`flexGrow: 1`) and `region-footer`. A column child would take a
 * SLICE of the terminal beside the body's grow and land off-centre; out of the
 * flow it fills the whole shell (`inset 0`, `100%` × `100%`) and its own
 * `justifyContent`/`alignItems: center` place the frame in the true middle —
 * the same treatment `region-modal` gets (`regions.ts`).
 */
export const splashTree = (width: number): VNode => {
  const mark = splashWordmark(width);
  return h(
    BoxRenderable,
    {
      id: 'splash-root',
      position: 'absolute',
      left: 0,
      top: 0,
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: DEFAULT_BACKGROUND,
    },
    h(
      BoxRenderable,
      {
        id: 'splash-frame',
        border: true,
        borderStyle: 'rounded',
        borderColor: BORDER,
        backgroundColor: DEFAULT_BACKGROUND,
        width: mark.frameWidth,
        paddingLeft: SPLASH_FRAME_PAD_X,
        paddingRight: SPLASH_FRAME_PAD_X,
        paddingTop: SPLASH_FRAME_PAD_Y,
        paddingBottom: SPLASH_FRAME_PAD_Y,
        flexDirection: 'row',
        gap: 3,
        justifyContent: 'center',
        alignItems: 'center',
      },
      h(
        BoxRenderable,
        {
          id: 'splash-logo',
          width: LOGO_WIDTH,
          flexShrink: 0,
          flexDirection: 'column',
        },
        ...logoTree(),
      ),
      wordmarkTree(mark.tier),
    ),
  );
};

export type SplashWait = (ms: number) => Promise<void>;

const defaultWait: SplashWait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Hold for `ms` (injectable clock for tests). Failures must not block boot. */
export const awaitSplash = async (
  ms: number = SPLASH_MS,
  wait: SplashWait = defaultWait,
): Promise<void> => {
  try {
    await wait(ms);
  } catch {
    // Best-effort: timer failure must not block the main UI.
  }
};

/**
 * Skip splash when a CliRenderer is injected (harness) unless the caller sets
 * `skipSplash: false`. Production TTY (no injected renderer) shows splash.
 */
export const shouldSkipSplash = (
  options: Pick<TuiOptions, 'renderer' | 'skipSplash'>,
): boolean => options.skipSplash ?? options.renderer !== undefined;
