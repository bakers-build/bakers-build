// BB-375 — semantic cockpit tokens: background / foreground / border.
// Roles only — never colour names (no “cyan”, “green”, …). Indexed slots;
// never truecolor. Terminal defaults stay escape hatches — never overwrite
// them to a slot.

import { RGBA } from '@opentui/core';

export const THEME_SLOTS = {
  /** Frame / chrome outline — same wire as {@link FOREGROUND} (no cyan). */
  border: 245,
  /** Copper braid and turquoise clasp, reserved for the brand mark. */
  brandStrand: 173,
  brandClasp: 73,
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
  /** Comparison series A — violet (wire `38;5;141`). */
  seriesA: 141,
  /** Comparison series B — mint (wire `38;5;79`). */
  seriesB: 79,
  /** Comparison series C — orange (wire `38;5;214`). */
  seriesC: 214,
  /** Comparison series D — blue (wire `38;5;75`). */
  seriesD: 75,
  /** Comparison series E — pink (wire `38;5;169`). */
  seriesE: 169,
  /** Comparison series F — yellow-green (wire `38;5;185`). */
  seriesF: 185,
} as const;

/** Interactive splash hold before the first usable chrome frame. */
export const SPLASH_MS = 500;

export const BRAND_STRAND: RGBA = RGBA.fromIndex(THEME_SLOTS.brandStrand);
export const BRAND_CLASP: RGBA = RGBA.fromIndex(THEME_SLOTS.brandClasp);

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
export const SERIES_A: RGBA = RGBA.fromIndex(THEME_SLOTS.seriesA);
export const SERIES_B: RGBA = RGBA.fromIndex(THEME_SLOTS.seriesB);
export const SERIES_C: RGBA = RGBA.fromIndex(THEME_SLOTS.seriesC);
export const SERIES_D: RGBA = RGBA.fromIndex(THEME_SLOTS.seriesD);
export const SERIES_E: RGBA = RGBA.fromIndex(THEME_SLOTS.seriesE);
export const SERIES_F: RGBA = RGBA.fromIndex(THEME_SLOTS.seriesF);

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
