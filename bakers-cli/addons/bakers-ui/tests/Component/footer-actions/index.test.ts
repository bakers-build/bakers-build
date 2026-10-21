import { describe, expect, it } from 'vitest';
import {
  actionItem,
  footerActions,
  footerKey,
  footerSep,
  parseFooterLadder,
  renderActionItem,
  withActionPipes,
} from '../../../src/Component/footer-actions/index.js';
import {
  BORDER,
  columnNode,
  FOREGROUND_ACTIVE,
  textNode,
} from '../../../src/lib/vnode.js';
import { nodeById, renderTree } from '../../render-tree.js';

describe('footer-actions (BB-375)', () => {
  it('footerSep is a box-drawing pipe on BORDER with no fill', () => {
    const sep = footerSep('probe-sep');
    expect((sep.props as { content?: string }).content).toBe(' │ ');
    expect((sep.props as { fg?: unknown }).fg).toBe(BORDER);
  });

  it('renderActionItem paints FOREGROUND_ACTIVE fg on the glyph and BORDER on the label', () => {
    const [key, sfx] = renderActionItem(actionItem('probe', 'e', 'edit'));
    expect((key?.props as { content?: string; fg?: unknown })?.content).toBe(
      'e',
    );
    expect((key?.props as { fg?: unknown })?.fg).toBe(FOREGROUND_ACTIVE);
    expect((sfx?.props as { content?: string; fg?: unknown })?.content).toBe(
      ':Edit',
    );
    expect((sfx?.props as { fg?: unknown })?.fg).toBe(BORDER);
  });

  it('parseFooterLadder turns legacy ladders into action-items', () => {
    expect(parseFooterLadder('n new · e edit · → next')).toEqual([
      actionItem('footer-action-0', 'n', 'new'),
      actionItem('footer-action-1', 'e', 'edit'),
      actionItem('footer-action-2', '→', 'next'),
    ]);
    expect(parseFooterLadder('Enter')).toEqual([
      actionItem('footer-action-0', 'Enter'),
    ]);
  });

  it('withActionPipes inserts │ between action-items and plain segments', () => {
    const chips = withActionPipes('probe-sep', [
      [textNode({ id: 'ver', content: 'bakers' })],
      actionItem('a', 'n', 'new'),
      footerKey('enter', 'Enter'),
      actionItem('b', 'e', 'edit'),
    ]);
    const tree = columnNode(
      'probe',
      textNode({ id: 'lead', content: '' }),
      ...chips,
    );
    expect(renderTree(tree).join('')).toBe('bakers │ n:New │ Enter │ e:Edit');
    expect(nodeById(tree, 'probe-sep-1')).toBeDefined();
    expect(nodeById(tree, 'probe-sep-2')).toBeDefined();
    expect(nodeById(tree, 'probe-sep-3')).toBeDefined();
  });

  it('footerActions is null for an empty list', () => {
    expect(footerActions('footer-actions', [], 40)).toBeNull();
  });

  it('footerActions builds lead + piped chips + pad with stable ids', () => {
    const row = footerActions(
      'footer-actions',
      [
        actionItem('tickets-new', 'n', 'new'),
        actionItem('tickets-edit', 'e', 'edit'),
      ],
      40,
    );
    expect(row).not.toBeNull();
    expect((row!.props as { id?: string }).id).toBe('footer-actions');
    expect(nodeById(row!, 'footer-actions-lead')).toBeDefined();
    expect(nodeById(row!, 'tickets-new-key')).toBeDefined();
    expect(
      (nodeById(row!, 'tickets-edit-sfx')?.props as { content?: string })
        ?.content,
    ).toBe(':Edit');
    expect(nodeById(row!, 'footer-actions-sep-1')).toBeDefined();
    expect(nodeById(row!, 'footer-actions-pad')).toBeDefined();
    expect(renderTree(row!).join('')).toBe(` n:New │ e:Edit${' '.repeat(40)}`);
    expect(
      (row!.props as { backgroundColor?: unknown }).backgroundColor,
    ).toBeUndefined();
  });
});
