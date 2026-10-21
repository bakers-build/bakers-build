import { describe, expect, it, vi } from 'vitest';
import { ParentFilterScreen } from '../../src/Entity/ticket/Screen/parent-filter-form.js';
import { WhoFilterScreen } from '../../src/Entity/ticket/Screen/who-filter-form.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TuiOptions } from '../../src/types.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { nodeById, renderTree } from '../render-tree.js';
import { fakeClient } from '../test-support.js';

// BB-326 (widget-fit F2) — the SCREEN half of the filter query row's terminal
// cursor, and BB-340 Task 9c, which made it a renderable.
//
// Both filter screens are MODAL (`readonly modal = true`, `presentation:
// 'modal'`), exactly like the New-ticket popup, and the caret they published
// used to travel a chain of translations to reach a cell: the widget rebased its
// row onto the fields' rows, the screen rebased THAT onto the `flatMap`ped
// surface, `Kernel/caret-rebase.ts` rebased it onto the composed box, and
// `Kernel/caret-slot.ts` placed a renderable over it absolutely — all four of
// which Task 9 Step 5 deleted. Both pickers
// hand over a TREE now, so there is no row surface for a row to index and no
// `ScreenPresentation.caret` at all: the insertion point is a `FieldTextarea`
// node in the tree, laid out where the widget put it, driving the cursor itself
// (spec D3).
//
// What is asserted here is therefore the same property one layer down. The
// widget's `value` is the query row's own text and its `caretOffset` the offset
// into it; its block carries the four columns the row used to spell as spaces;
// and the text surface does not carry those characters a SECOND time, which is
// what made the old double paint safe and what makes this one unnecessary.
//
// The break this catches is unchanged: a note, an error row or a reordered field
// moving the query row without moving the insertion point with it — invisible to
// every test that only reads text.

const PROJECT = { id: 'proj-1', name: 'bakers', slug: 'bakers' };
const TICKETS = 'bb_ticket/bb_ticket';
const USERS = 'user/user';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** A debounce that fires synchronously — no test sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

const context = (overrides: Partial<ScreenContext> = {}): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  options: { debounce: immediate } as TuiOptions,
  ...overrides,
});

describe('the parent picker carries its query insertion point', () => {
  const open = async () => {
    const client = fakeClient({
      documents: {
        [TICKETS]: {
          data: [
            {
              type: 'bb_ticket--bb_ticket',
              id: 't1',
              attributes: { identifier: 'BB-236', title: 'a form kernel' },
            },
          ],
        },
      },
    });
    const screen = new ParentFilterScreen();
    const ctx = context({
      services: { client } as ScreenContext['services'],
      project: PROJECT,
    });
    screen.enter(ctx);
    await tick();
    return { screen, ctx };
  };

  it('puts the insertion point on the query row, over that row`s own text', async () => {
    const { screen, ctx } = await open();
    for (const ch of 'BB-2') screen.handleInput(ch, ctx);
    const shown = screen.present(ctx);

    const input = nodeById(shown.body, 'field-parent-input');
    expect(input?.type).toBe(FieldTextarea);
    const props = input?.props as { value?: string; caretOffset?: number };
    expect(props.value).toBe('search: BB-2');
    expect(props.caretOffset).toBe('search: BB-2'.length);
    expect(
      (
        nodeById(shown.body, 'field-parent-input-row')?.props as {
          paddingLeft?: number;
        }
      )?.paddingLeft,
    ).toBe(4);

    const text = renderTree(shown.body).join('\n');
    expect(text).not.toContain('search: BB-2');
    // And the insertion point is still not a character.
    expect(text).not.toContain('▌');
    expect(shown.caret).toBeUndefined();
    expect(shown.lines).toBeUndefined();
  });

  it('carries the insertion point before a single character is typed', async () => {
    // The picker opens on its one field, so the cursor belongs there from the
    // first frame — this is where the operator starts typing.
    const { screen, ctx } = await open();
    const shown = screen.present(ctx);
    const props = nodeById(shown.body, 'field-parent-input')?.props as
      | { value?: string }
      | undefined;
    expect(props?.value).toBe('search: ');
  });

  it('carries NO insertion point while the picker is still loading', () => {
    const screen = new ParentFilterScreen();
    const ctx = context({
      services: {
        client: fakeClient({ rows: {} }),
      } as ScreenContext['services'],
      project: PROJECT,
    });
    screen.enter(ctx);
    const shown = screen.present(ctx);
    // Loading is still three lines of text (`AsyncScreen`'s `Surface` covers the
    // READY state alone), so what must hold is that nothing in it drives a
    // terminal cursor — a cursor blinking over `Loading parents…` would be one
    // on a row nobody can type into.
    expect(nodeById(shown.body, 'field-parent-input')).toBeUndefined();
    expect(shown.caret).toBeUndefined();
  });
});

describe('the who picker carries its query insertion point too', () => {
  const open = async () => {
    const client = fakeClient({
      documents: {
        [USERS]: {
          data: [
            {
              type: 'user--user',
              id: 'u1',
              attributes: { display_name: 'cw', name: 'cw' },
            },
          ],
        },
      },
    });
    const screen = new WhoFilterScreen();
    const ctx = context({
      services: { client } as ScreenContext['services'],
      project: PROJECT,
    });
    screen.enter(ctx);
    await tick();
    return { screen, ctx };
  };

  // BB-340 Task 9c — THE SAME CLAIM, ONE LAYER DOWN.
  //
  // The who picker hands over a tree, so there is no `lines` for a caret's row
  // to index and no `ScreenPresentation.caret` to publish: the insertion point
  // is a `FieldTextarea` NODE that drives the terminal cursor itself (spec D3).
  // What the caret's row/column/text asserted — the cursor sits on the query
  // row, at the query's own indent, over exactly the characters that row shows —
  // is asserted here as the widget's own props and position instead. The break
  // it catches is unchanged: a note, an error row or a reordered field moving
  // the query row without moving the insertion point with it.
  it('puts the insertion point on the query row — the same kind, the same rule', async () => {
    const { screen, ctx } = await open();
    for (const ch of 'cw') screen.handleInput(ch, ctx);
    const shown = screen.present(ctx);

    const input = nodeById(shown.body, 'field-who-input');
    expect(input?.type).toBe(FieldTextarea);
    const props = input?.props as { value?: string; caretOffset?: number };
    expect(props.value).toBe('search: cw');
    expect(props.caretOffset).toBe('search: cw'.length);
    // The four columns the widget's rows carry as spaces, as the block's own
    // Yoga budget — this is what the caret's `column` used to say.
    expect(
      (
        nodeById(shown.body, 'field-who-input-row')?.props as {
          paddingLeft?: number;
        }
      )?.paddingLeft,
    ).toBe(4);

    const text = renderTree(shown.body).join('\n');
    // The widget OWNS those rows now: emitting them as text as well would paint
    // the same characters twice, once under a live cursor.
    expect(text).not.toContain('search: cw');
    // And the insertion point is still not a character.
    expect(text).not.toContain('▌');
    // The two coordinates that indexed a row surface are gone with it.
    expect(shown.caret).toBeUndefined();
    expect(shown.lines).toBeUndefined();
  });
});
