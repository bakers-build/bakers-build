// BB-375 — semantic cockpit tokens: background / foreground / border.
// Roles only — never colour names (no “cyan”, “green”, …). Indexed slots;
// never truecolor. Terminal defaults stay escape hatches — never overwrite
// them to a slot.

import { RGBA } from '@opentui/core';

export const THEME_SLOTS = {
  /** Frame / chrome outline — same wire as {@link FOREGROUND} (no cyan). */
  border: 245,
  /** Bread-slice logo: butter tile, dark line, white slice — reserved for the brand mark. */
  brandTile: 221,
  brandLine: 235,
  brandSlice: 231,
  /** Stronger outline / brand mark — same wire as {@link FOREGROUND_HIGHLIGHT}. */
  borderEmphasis: 231,
  /** Reserved surface fill (wire `48;5;250`) — unused by chrome; body is framed, unfilled. */
  background: 250,
  /** Selected / active surface wash (wire `48;5;237`). */
  backgroundActive: 237,
  /** Primary text (wire `38;5;245`). */
  foreground: 245,
  /** Emphasized text — titles (wire `38;5;231`). */
  foregroundHighlight: 231,
  /** Selected / active control text — full white (wire `38;5;15`). */
  foregroundActive: 15,
} as const;

/** Interactive splash hold before the first usable chrome frame. */
export const SPLASH_MS = 500;

export const BRAND_TILE: RGBA = RGBA.fromIndex(THEME_SLOTS.brandTile);
export const BRAND_LINE: RGBA = RGBA.fromIndex(THEME_SLOTS.brandLine);
export const BRAND_SLICE: RGBA = RGBA.fromIndex(THEME_SLOTS.brandSlice);

export const BORDER: RGBA = RGBA.fromIndex(THEME_SLOTS.border);
export const BORDER_EMPHASIS: RGBA = RGBA.fromIndex(THEME_SLOTS.borderEmphasis);
export const BACKGROUND: RGBA = RGBA.fromIndex(THEME_SLOTS.background);
export const BACKGROUND_ACTIVE: RGBA = RGBA.fromIndex(
  THEME_SLOTS.backgroundActive,
);
export const FOREGROUND: RGBA = RGBA.fromIndex(THEME_SLOTS.foreground);
export const FOREGROUND_HIGHLIGHT: RGBA = RGBA.fromIndex(
  THEME_SLOTS.foregroundHighlight,
);
export const FOREGROUND_ACTIVE: RGBA = RGBA.fromIndex(
  THEME_SLOTS.foregroundActive,
);

/**
 * Terminal theme background (`ESC[49m`) — header/modal when we do not paint
 * {@link BACKGROUND}. Do **not** reassign to a slot.
 */
export const DEFAULT_BACKGROUND: RGBA = RGBA.defaultBackground();

/**
 * Terminal theme foreground (`ESC[39m`) — escape hatch only.
 * Ordinary cockpit text uses {@link FOREGROUND}.
 */
export const DEFAULT_FOREGROUND: RGBA = RGBA.defaultForeground();
