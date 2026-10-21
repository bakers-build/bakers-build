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
  SERIES_A,
  SERIES_B,
  SERIES_C,
  SERIES_D,
  SERIES_E,
  SERIES_F,
  SPLASH_MS,
  THEME_SLOTS,
} from '../../src/lib/theme.js';

describe('theme palette (BB-375)', () => {
  it('pins background / foreground / border slots; defaults stay terminal', () => {
    expect(THEME_SLOTS).toEqual({
      border: 245,
      brandStrand: 173,
      brandClasp: 73,
      borderEmphasis: 231,
      background: 250,
      backgroundActive: 237,
      foreground: 245,
      foregroundHighlight: 231,
      foregroundActive: 15,
      seriesA: 141,
      seriesB: 79,
      seriesC: 214,
      seriesD: 75,
      seriesE: 169,
      seriesF: 185,
    });
    expect(BORDER.slot).toBe(245);
    expect(BORDER_EMPHASIS.slot).toBe(231);
    expect(BACKGROUND.slot).toBe(250);
    expect(BACKGROUND_ACTIVE.slot).toBe(237);
    expect(FOREGROUND.slot).toBe(245);
    expect(FOREGROUND_HIGHLIGHT.slot).toBe(231);
    expect(FOREGROUND_ACTIVE.slot).toBe(15);
    expect(SERIES_A.slot).toBe(141);
    expect(SERIES_B.slot).toBe(79);
    expect(SERIES_C.slot).toBe(214);
    expect(SERIES_D.slot).toBe(75);
    expect(SERIES_E.slot).toBe(169);
    expect(SERIES_F.slot).toBe(185);
    const seriesSlots = [
      SERIES_A.slot,
      SERIES_B.slot,
      SERIES_C.slot,
      SERIES_D.slot,
      SERIES_E.slot,
      SERIES_F.slot,
    ];
    expect(new Set(seriesSlots).size).toBe(6);
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
  it('holds for the exported palette and the heat-map ramp', async () => {
    const palette = await import('../../src/lib/theme.js');
    const { HEAT_SCALE } = await import(
      '../../src/Component/heat-map/index.js'
    );
    const slots = [
      ...Object.entries(palette)
        .filter(([name]) => !name.startsWith('DEFAULT_'))
        .filter(([, value]) => value instanceof Object && 'intent' in value)
        .map(([name, value]) => [name, value] as const),
      ...HEAT_SCALE.map(
        (value, index) => [`HEAT_SCALE[${index}]`, value] as const,
      ),
    ];
    expect(slots.length).toBeGreaterThan(10);
    for (const [name, value] of slots)
      expect((value as { intent: string }).intent, name).toBe('indexed');
  });
});
