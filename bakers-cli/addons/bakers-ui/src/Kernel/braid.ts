import { h, TextRenderable, type VNode } from '@opentui/core';
import { BRAND_CLASP, BRAND_STRAND } from '../lib/theme.js';

export const BRAID_WIDTH = 3;

/** Original line-art braid; no pixel shading. */
export const braidTree = (): VNode[] =>
  ['╲ ╱', ' ╳ ', '╱ ╲', ' ╳ ', '═╪═', ' ╵ '].map((content, row) =>
    h(TextRenderable, {
      id: `splash-braid-row-${row}`,
      content,
      fg: row === 4 ? BRAND_CLASP : BRAND_STRAND,
      selectable: false,
    }),
  );
