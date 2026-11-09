import { describe, expect, it, vi } from 'vitest';
import { EditAssignmentFormScreen } from '../../src/Entity/ticket/Screen/edit-assignment-form.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { nodeById, renderTree } from '../render-tree.js';
import { fakeClient, toResource } from '../test-support.js';

// BB-326 — the popup half of the terminal caret; BB-340 Task 9 — the same
// claim, one layer down.
//
// A screen with an active `text` field used to PUBLISH where its insertion
// point was, as a row index into its own `lines`. Both popups hand over a tree
// now, so the insertion point is a `FieldTextarea` NODE inside it, laid out
// where the widget put it and driving the terminal cursor itself (spec D3).
// There is no row surface for a row to index and no `ScreenPresentation.caret`
// at all.
//
// What was asserted before — the caret names the VALUE row, carries that row's
// characters verbatim, and trails what was typed — is asserted here as the
// widget's own `value`, `caretOffset` and its block's `paddingLeft`/`height`.
// The break it catches is unchanged: shifting the field rows (a new note, a
// reordered declaration) without shifting the insertion point with them, which
// is invisible to every test that only reads text.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const context = (overrides: Partial<ScreenContext> = {}): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  ...overrides,
});

/** A canonical key NAME — everything else is text, typed one key per code point. */
const NAMED_KEY =
  /^(escape|up|down|left|right|tab|shift\+tab|enter|backspace|delete|space|pageup|pagedown|home|end|f\d+|(?:ctrl|alt|super|hyper|shift)\+[a-z0-9+]+)$/;

/**
 * BB-326 — type a word the way a terminal delivers one: ONE key per
 * character. These tests used to hand `handleInput` the whole string, which
 * only worked because the old printability probe was `key >= ' '` and so
 * accepted any multi-character string as text. Under the canonical vocabulary a
 * key is one code point (or a name), and nothing in production ever delivers
 * more — the kernel has no paste path. Typing character by character is what a
 * real keyboard does.
 */
const typeText = (
  screen: { handleInput: (key: string, ctx: ScreenContext) => boolean },
  text: string,
  ctx: ScreenContext,
): void => {
  if (NAMED_KEY.test(text)) {
    screen.handleInput(text, ctx);
    return;
  }
  for (const character of text) screen.handleInput(character, ctx);
};

describe('the Edit-ticket popup carries its insertion point as a node', () => {
  // BB-340 Task 9 — THE SAME CLAIM, ONE LAYER DOWN.
  //
  // This popup hands over a tree, so there is no `lines` for a caret's row to
  // index and no `ScreenPresentation.caret` to publish: the insertion point is a
  // `FieldTextarea` NODE that drives the terminal cursor itself (spec D3). What
  // the caret's row/text/offset asserted — the cursor sits on the Estimate
  // VALUE row, over exactly the characters that row shows, trailing what was
  // typed — is asserted here as the widget's own props and position instead.
  // The break it catches is unchanged: shifting the field rows (a new note, a
  // reordered declaration) without shifting the insertion point with them.
  it('points at the Estimate value block — the same kind, the same rule', async () => {
    const api = fakeClient({
      rows: {
        'user--user': [
          toResource({
            id: 'u1',
            type: 'user--user',
            attributes: { name: 'Ada', drupal_internal__uid: 1 },
          }),
        ],
        bb_conductor: [],
        bb_ticket: [
          toResource({
            id: 't1',
            type: 'bb_ticket--bb_ticket',
            attributes: { identifier: 'BB-1', title: 'T' },
          }),
        ],
      },
    });
    const screen = new EditAssignmentFormScreen();
    const ctx = context({
      services: { client: api },
      params: { ticketId: 't1' },
    });
    screen.enter(ctx);
    await tick();
    await tick();
    // Assignee → Reviewers → Conductor → Estimate (the popup's first `text` field).
    screen.handleInput('down', ctx);
    screen.handleInput('down', ctx);
    screen.handleInput('down', ctx);
    typeText(screen, '2h', ctx);
    const shown = screen.present(ctx);

    const input = nodeById(shown.body, 'field-estimate-input');
    expect(input?.type).toBe(FieldTextarea);
    const props = input?.props as { value?: string; caretOffset?: number };
    expect(props.value).toBe('2h');
    expect(props.caretOffset).toBe(2);
    // The four columns the value rows carry as spaces, as the block's own Yoga
    // budget — this is what the caret's `column` used to say.
    expect(
      (
        nodeById(shown.body, 'field-estimate-input-row')?.props as {
          paddingLeft?: number;
        }
      )?.paddingLeft,
    ).toBe(4);

    const text = renderTree(shown.body);
    // The widget OWNS those rows now: emitting them as text as well would paint
    // the same characters twice, once under a live cursor.
    expect(text).not.toContain('    2h');
    // The two coordinates that indexed a row surface are gone with it.
    expect(shown.caret).toBeUndefined();
    expect(shown.lines).toBeUndefined();
  });

  it('carries NO insertion point while a non-text field is active', async () => {
    const api = fakeClient({
      rows: {
        'user--user': [],
        bb_conductor: [],
        bb_ticket: [
          toResource({
            id: 't1',
            type: 'bb_ticket--bb_ticket',
            attributes: { identifier: 'BB-1', title: 'T' },
          }),
        ],
      },
    });
    const screen = new EditAssignmentFormScreen();
    const ctx = context({
      services: { client: api },
      params: { ticketId: 't1' },
    });
    screen.enter(ctx);
    await tick();
    await tick();
    // The popup opens on Assignee, a `select`: a ring has no insertion point,
    // so a cursor there would be one on a row nobody can type into.
    const shown = screen.present(ctx);
    expect(nodeById(shown.body, 'field-estimate-input')).toBeUndefined();
    expect(shown.caret).toBeUndefined();
  });
});
