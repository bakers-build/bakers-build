// BB-294 — the cursor block that was verbatim in four screens.
import { expect, it } from 'vitest';
import { ListCursor } from '../../src/lib/cursor.js';

it('j and the down arrow move down, clamped to the last row', () => {
  const cursor = new ListCursor();
  expect(cursor.handle('j', 3)).toBe(true);
  expect(cursor.index).toBe(1);
  expect(cursor.handle('down', 3)).toBe(true);
  expect(cursor.index).toBe(2);
  cursor.handle('j', 3);
  expect(cursor.index).toBe(2);
});

it('k and the up arrow move up, clamped to zero', () => {
  const cursor = new ListCursor();
  cursor.index = 2;
  expect(cursor.handle('k', 3)).toBe(true);
  expect(cursor.index).toBe(1);
  expect(cursor.handle('up', 3)).toBe(true);
  expect(cursor.index).toBe(0);
  cursor.handle('k', 3);
  expect(cursor.index).toBe(0);
});

it('g goes to the first row and G to the last', () => {
  const cursor = new ListCursor();
  cursor.index = 2;
  expect(cursor.handle('g', 5)).toBe(true);
  expect(cursor.index).toBe(0);
  expect(cursor.handle('G', 5)).toBe(true);
  expect(cursor.index).toBe(4);
});

it('claims nothing else, so the caller’s own keys still reach their branch', () => {
  const cursor = new ListCursor();
  for (const input of [
    'enter',
    '\n',
    'x',
    'e',
    '/',
    'escape',
    'right',
    'left',
    'q',
  ])
    expect(cursor.handle(input, 3)).toBe(false);
  expect(cursor.index).toBe(0);
});

// Today's arithmetic, preserved deliberately: `Math.min(0 + 1, -1)` is -1 on an
// empty page. Nothing observes it: an empty page publishes no `rowIds`, so the
// kernel has no node to scroll to and reads the index for nothing. (It used to
// be `present()` mapping it back through `selectedRow: rows.length ? … : -1`,
// which BB-340 Task 12 took off the contract.) AC 6 forbids changing it here.
it('reproduces the empty-page arithmetic rather than fixing it', () => {
  const cursor = new ListCursor();
  expect(cursor.handle('j', 0)).toBe(true);
  expect(cursor.index).toBe(-1);
  const other = new ListCursor();
  expect(other.handle('G', 0)).toBe(true);
  expect(other.index).toBe(0);
});

it('reset returns to the first row', () => {
  const cursor = new ListCursor();
  cursor.index = 4;
  cursor.reset();
  expect(cursor.index).toBe(0);
});
