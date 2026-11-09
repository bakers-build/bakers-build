import {
  h,
  type RGBA,
  StyledText,
  type TextChunk,
  TextRenderable,
  type VNode,
} from '@opentui/core';
import { BRAND_LINE, BRAND_SLICE, BRAND_TILE } from '../lib/theme.js';

// The bread-slice mark of docs/public/logo.svg as 14×14 pixels: butter tile (T),
// dark outline, pupils, mouth and crumb (L), white slice (S); `.` stays unpainted.
const PIXELS = [
  '.TTTTTTTTTTTT.',
  'TTTTTTTTTTTTLT',
  'TTTTLLLLLLTTLT',
  'TTTLSSSSSSLTTT',
  'TTLSSSSSSSSLTT',
  'TTLSSSSSSSSLTT',
  'TTLSSLSSLSSLTT',
  'TTLSSSSSSSSLTT',
  'TTLSSSLLSSSLTT',
  'TTLSSSSSSSSLTT',
  'TTLSSSSSSSSLTT',
  'TTLLLLLLLLLLTT',
  'TTTTTTTTTTTTTT',
  '.TTTTTTTTTTTT.',
];

const COLOUR: Record<string, RGBA | undefined> = {
  T: BRAND_TILE,
  L: BRAND_LINE,
  S: BRAND_SLICE,
};

export const LOGO_WIDTH = 14;

// Two pixel rows per cell: the upper half block takes the top pixel as fg and the bottom as bg.
const cell = (top?: RGBA, bottom?: RGBA): TextChunk => {
  if (top === undefined) {
    return bottom === undefined
      ? { __isChunk: true, text: ' ' }
      : { __isChunk: true, text: '▄', fg: bottom };
  }
  if (top === bottom) return { __isChunk: true, text: '█', fg: top };
  return bottom === undefined
    ? { __isChunk: true, text: '▀', fg: top }
    : { __isChunk: true, text: '▀', fg: top, bg: bottom };
};

export const logoTree = (): VNode[] =>
  Array.from({ length: PIXELS.length / 2 }, (_, row) => {
    const top = PIXELS[row * 2] as string;
    const bottom = PIXELS[row * 2 + 1] as string;
    return h(TextRenderable, {
      id: `splash-logo-row-${row}`,
      content: new StyledText(
        [...top].map((pixel, x) =>
          cell(COLOUR[pixel], COLOUR[bottom[x] as string]),
        ),
      ),
      selectable: false,
    });
  });
