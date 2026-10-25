import type { VNode } from '@opentui/core';
import { describe, expect, it, vi } from 'vitest';
import { CreateTicketFormScreen } from '../../src/Entity/ticket/Screen/create-ticket-form.js';
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

describe('the New-ticket popup carries its insertion point as a node', () => {
  const boot = async () => {
    const api = fakeClient({
      rows: {
        'user--user': [
          toResource({
            id: 'u1',
            type: 'user--user',
            attributes: { name: 'Ada' },
          }),
        ],
        bb_conductor: [],
        'taxonomy_term/label': [],
      },
    });
    const screen = new CreateTicketFormScreen();
    const ctx = context({ services: { client: api, currentUser: 'Ada' } });
    screen.enter(ctx);
    await tick();
    return { screen, ctx };
  };

  /** The active field's insertion point, as the widget that owns it. */
  const inputOf = (body: VNode, field: string) => {
    const node = nodeById(body, `field-${field}-input`);
    expect(node?.type).toBe(FieldTextarea);
    return node?.props as {
      value?: string;
      caretOffset?: number;
      placeholder?: string | null;
      height?: number;
    };
  };

  // BB-664 AC-8: with no project in scope (as every case in this describe
  // block boots) the popup opens on the new Project field, one row ahead of
  // Title — every case below moves off it first, which is the one change
  // these cases make for that ticket; what each still proves is unchanged.
  const skipProjectField = (
    screen: { handleInput: (key: string, ctx: ScreenContext) => boolean },
    ctx: ScreenContext,
  ): void => {
    screen.handleInput('down', ctx);
  };

  it('puts the insertion point on the Title value block, over that block`s own text', async () => {
    const { screen, ctx } = await boot();
    skipProjectField(screen, ctx);
    typeText(screen, 'Fix it', ctx);
    const shown = screen.present(ctx);
    const props = inputOf(shown.body, 'title');
    expect(props.value).toBe('Fix it');
    // Six characters typed, so the insertion point trails all six.
    expect(props.caretOffset).toBe(6);
    // The block it sits in carries the four columns the value rows used to
    // spell as spaces — this is what the caret's `column` used to say.
    expect(
      (
        nodeById(shown.body, 'field-title-input-row')?.props as {
          paddingLeft?: number;
        }
      )?.paddingLeft,
    ).toBe(4);
    // The widget OWNS those rows now: emitting them as text as well would paint
    // the same characters twice, once under a live cursor.
    expect(renderTree(shown.body)).not.toContain('    Fix it');
    expect(shown.caret).toBeUndefined();
    expect(shown.lines).toBeUndefined();
  });

  it('follows the insertion point when ← moves it inside the value', async () => {
    const { screen, ctx } = await boot();
    skipProjectField(screen, ctx);
    typeText(screen, 'Fix it', ctx);
    screen.handleInput('left', ctx);
    screen.handleInput('left', ctx);
    expect(inputOf(screen.present(ctx).body, 'title').caretOffset).toBe(4);
  });

  it('moves to the Description block when ↓ makes it the active field', async () => {
    const { screen, ctx } = await boot();
    skipProjectField(screen, ctx);
    typeText(screen, 'Fix it', ctx);
    screen.handleInput('down', ctx);
    typeText(screen, 'why', ctx);
    const shown = screen.present(ctx);
    // The insertion point moved WITH the active field: the description holds it…
    const props = inputOf(shown.body, 'description');
    expect(props.value).toBe('why');
    expect(props.caretOffset).toBe(3);
    // …and the title, no longer active, is a row of text again.
    expect(nodeById(shown.body, 'field-title-input')).toBeUndefined();
    expect(renderTree(shown.body)).toContain('    Fix it');
  });

  it('lands on the SECOND wrapped row of a title longer than the popup', async () => {
    const { screen, ctx } = await boot();
    // 58 columns of body less the 4-column indent = 54 per row. This title is
    // longer, so it wraps, and the insertion point trails the last character —
    // which is on the second row.
    const long =
      'a title long enough to wrap inside the New ticket popup and then some';
    skipProjectField(screen, ctx);
    typeText(screen, long, ctx);
    const shown = screen.present(ctx);
    const props = inputOf(shown.body, 'title');
    // Two rows, and the block reserves exactly them.
    expect(props.height).toBe(2);
    expect(
      (
        nodeById(shown.body, 'field-title-input-row')?.props as {
          height?: number;
        }
      )?.height,
    ).toBe(2);
    // Hand-derived at the 54-column budget: `…the New ticket` is 49 columns and
    // adding ` popup` would make 55, so the break falls before `popup`.
    expect(props.value).toBe(
      'a title long enough to wrap inside the New ticket\npopup and then some',
    );
    // The break replaced exactly one space with the newline, so the wrapped text
    // is the same length as the value and the end-of-value offset is unmoved.
    expect(props.caretOffset).toBe(long.length);
  });

  it('carries NO insertion point while a non-text field is active', async () => {
    const { screen, ctx } = await boot();
    // Project → Title → Description → Parent. With no project PICKED the
    // Parent bag is ABSENT, so the autocomplete draws no query row at all —
    // and a cursor on `(no project context …)` would be one on a row nobody
    // can type into.
    screen.handleInput('down', ctx);
    screen.handleInput('down', ctx);
    screen.handleInput('down', ctx);
    const shown = screen.present(ctx);
    expect(nodeById(shown.body, 'field-title-input')).toBeUndefined();
    expect(nodeById(shown.body, 'field-description-input')).toBeUndefined();
    expect(nodeById(shown.body, 'field-parent-input')).toBeUndefined();
    expect(shown.caret).toBeUndefined();
  });

  it('carries NO insertion point while the popup is still loading', () => {
    const screen = new CreateTicketFormScreen();
    const ctx = context({
      services: { client: fakeClient({ rows: {} }), currentUser: 'Ada' },
    });
    screen.enter(ctx);
    const shown = screen.present(ctx);
    expect(nodeById(shown.body, 'field-title-input')).toBeUndefined();
    expect(shown.caret).toBeUndefined();
  });
});

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
