import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_ACTIVE,
  DEFAULT_BACKGROUND,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  INVERSE,
  textNode,
} from '../../src/lib/vnode.js';

describe('textNode selection (BB-375 D4)', () => {
  it('selected rows use FOREGROUND_ACTIVE fg + BACKGROUND_ACTIVE bg, never inverse', () => {
    const node = textNode({ id: 'row', content: 'hello', selected: true });
    const props = node.props as {
      fg?: unknown;
      bg?: unknown;
      attributes?: number;
    };
    expect(props.fg).toBe(FOREGROUND_ACTIVE);
    expect(props.bg).toBe(BACKGROUND_ACTIVE);
    expect((props.attributes ?? 0) & INVERSE).toBe(0);
  });

  it('unselected rows keep FOREGROUND without inverse', () => {
    const node = textNode({ id: 'row', content: 'hello' });
    const props = node.props as {
      fg?: unknown;
      bg?: unknown;
      attributes?: number;
    };
    expect(props.fg).toBe(FOREGROUND);
    expect(props.bg).toBe(DEFAULT_BACKGROUND);
    expect((props.attributes ?? 0) & INVERSE).toBe(0);
  });

  it('accepts explicit bg / backgroundColor overrides', () => {
    const viaBg = textNode({
      id: 'a',
      content: 'x',
      selected: true,
      bg: DEFAULT_BACKGROUND,
    });
    expect((viaBg.props as { bg?: unknown }).bg).toBe(DEFAULT_BACKGROUND);
    expect((viaBg.props as { fg?: unknown }).fg).toBe(FOREGROUND_ACTIVE);
    const viaAlias = textNode({
      id: 'b',
      content: 'x',
      backgroundColor: DEFAULT_BACKGROUND,
    });
    expect((viaAlias.props as { bg?: unknown }).bg).toBe(DEFAULT_BACKGROUND);
  });
});
