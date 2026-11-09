// BB-375 D6 — timed interactive splash before the first usable chrome frame.
// Non-TTY / pipe never enters this path. Injected-renderer harnesses skip by
// default (`shouldSkipSplash`) so the bun suite does not pay SPLASH_MS.
//
// OpenTUI cannot change the terminal typeface. Splash “bakers” uses ASCIIFont
// (multi-line block letters) so the mark reads large inside a BORDER box.

import {
  ASCIIFontRenderable,
  BoxRenderable,
  h,
  measureText,
  type VNode,
} from '@opentui/core';
import {
  BORDER,
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
  SPLASH_MS,
} from '../lib/theme.js';
import type { TuiOptions } from '../types.js';
import { LOGO_WIDTH, logoTree } from './logo.js';

export { SPLASH_MS };

/** OpenTUI ASCIIFont name for the splash wordmark. */
export const SPLASH_FONT = 'block' as const;
/** Splash wordmark text (ASCIIFont has no emoji glyphs). */
export const SPLASH_TEXT = 'bakers';
/** Vertical padding inside the splash frame. */
export const SPLASH_FRAME_PAD_Y = 2;
/** Horizontal padding inside the splash frame. */
export const SPLASH_FRAME_PAD_X = 4;

const splashMarkSize = measureText({ text: SPLASH_TEXT, font: SPLASH_FONT });

/** Outer frame width: mark + horizontal pad + border columns. */
export const SPLASH_FRAME_WIDTH =
  splashMarkSize.width + LOGO_WIDTH + 3 + SPLASH_FRAME_PAD_X * 2 + 2;

/**
 * Centered BORDER box with an ASCIIFont bakers mark — modal-like, not a wash.
 * Font is OpenTUI block letters; the terminal typeface is unchanged.
 *
 * `position: 'absolute'` is load-bearing: the splash is mounted into the SAME
 * `shell` that `createRegions` has already filled with `region-chrome`,
 * `region-body` (`flexGrow: 1`) and `region-footer`. A column child would take a
 * SLICE of the terminal beside the body's grow and land off-centre; out of the
 * flow it fills the whole shell (`inset 0`, `100%` × `100%`) and its own
 * `justifyContent`/`alignItems: center` place the frame in the true middle —
 * the same treatment `region-modal` gets (`regions.ts`).
 */
export const splashTree = (): VNode =>
  h(
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
        width: SPLASH_FRAME_WIDTH,
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
      h(ASCIIFontRenderable, {
        id: 'splash-bakers',
        text: SPLASH_TEXT,
        font: SPLASH_FONT,
        color: DEFAULT_FOREGROUND,
        backgroundColor: DEFAULT_BACKGROUND,
        selectable: false,
      }),
    ),
  );

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
