import { describe, expect, it } from 'vitest';
import {
  BACKGROUND,
  BACKGROUND_ACTIVE,
  BORDER,
  BORDER_EMPHASIS,
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  FOREGROUND_HIGHLIGHT,
  SPLASH_MS,
  THEME_SLOTS,
} from '../../src/lib/theme.js';

describe('theme palette (BB-375)', () => {
  it('pins background / foreground / border slots; defaults stay terminal', () => {
    expect(THEME_SLOTS).toEqual({
      border: 245,
      brandTile: 221,
      brandLine: 235,
      brandSlice: 231,
      borderEmphasis: 231,
      background: 250,
      backgroundActive: 237,
      foreground: 245,
      foregroundHighlight: 231,
      foregroundActive: 15,
    });
    expect(BORDER.slot).toBe(245);
    expect(BORDER_EMPHASIS.slot).toBe(231);
    expect(BACKGROUND.slot).toBe(250);
    expect(BACKGROUND_ACTIVE.slot).toBe(237);
    expect(FOREGROUND.slot).toBe(245);
    expect(FOREGROUND_HIGHLIGHT.slot).toBe(231);
    expect(FOREGROUND_ACTIVE.slot).toBe(15);
    expect(DEFAULT_BACKGROUND.intent).toBe('default');
    expect(DEFAULT_FOREGROUND.intent).toBe('default');
    expect(SPLASH_MS).toBe(500);
  });

  it('keeps indexed fonts/fills only — no truecolor, no DEFAULT overwrite', () => {
    expect(FOREGROUND_ACTIVE.intent).toBe('indexed');
    expect(FOREGROUND_HIGHLIGHT.intent).toBe('indexed');
    expect(BACKGROUND_ACTIVE.intent).toBe('indexed');
    expect(DEFAULT_BACKGROUND.intent).toBe('default');
  });
});

describe('every painted colour is an indexed palette slot', () => {
  it('holds for the exported palette', async () => {
    const palette = await import('../../src/lib/theme.js');
    const slots = Object.entries(palette)
      .filter(([name]) => !name.startsWith('DEFAULT_'))
      .filter(([, value]) => value instanceof Object && 'intent' in value)
      .map(([name, value]) => [name, value] as const);
    expect(slots.length).toBeGreaterThanOrEqual(10);
    for (const [name, value] of slots)
      expect((value as { intent: string }).intent, name).toBe('indexed');
  });
});
