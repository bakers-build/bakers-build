import type { VNode } from '@opentui/core';
import { describe, expect, it, vi } from 'vitest';
import { WORKFLOW_OPTIONS } from '../../src/Entity/ticket/Form/create.js';
import { CreateTicketFormScreen } from '../../src/Entity/ticket/Screen/create-ticket-form.js';
import { EditAssignmentFormScreen } from '../../src/Entity/ticket/Screen/edit-assignment-form.js';
import type { ScreenContext } from '../../src/Screen/screen.js';
import type { TuiOptions } from '../../src/types.js';
import { FieldTextarea } from '../../src/Widget/textarea.js';
import { nodeById, renderTree } from '../render-tree.js';
import {
  type FakeClientOptions,
  fakeClient,
  toResource,
} from '../test-support.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  const value: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    ...overrides,
  };
  return value;
}

/** A canonical key NAME — everything else is text, typed one key per code point. */
const NAMED_KEY =
  /^(escape|up|down|left|right|tab|shift\+tab|enter|backspace|delete|space|pageup|pagedown|home|end|f\d+|(?:ctrl|alt|super|hyper|shift)\+[a-z0-9+]+)$/;

/**
 * BB-326 — one key per character, as a terminal delivers them. The old
 * printability probe (`key >= ' '`) accepted a whole string as text; the
 * canonical vocabulary does not, and neither does a keyboard. Returns whether
 * every character was claimed, preserving what the call sites asserted.
 */
const typeText = (
  screen: { handleInput: (key: string, ctx: ScreenContext) => boolean },
  text: string,
  ctx: ScreenContext,
): boolean =>
  NAMED_KEY.test(text)
    ? screen.handleInput(text, ctx)
    : [...text].every((character) => screen.handleInput(character, ctx));

describe('form screens own their complete interaction', () => {
  it('loads, initializes, edits and submits the new-ticket form', async () => {
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
        'taxonomy_term/bb_labels': [],
      },
    });
    const screen = new CreateTicketFormScreen();
    const ctx = context({
      services: { client: api, currentUser: 'Ada' },
    });

    screen.enter(ctx);
    expect(renderTree(screen.present(ctx).body)[0]).toBe(
      'Loading new-ticket form…',
    );
    await tick();
    expect(screen.options?.users[0]?.id).toBe('u1');
    // BB-664 AC-8: with no project in scope the popup opens on the new
    // Project field, one row ahead of Title — moved off it first; what this
    // case proves (typed text reaches the payload) is unchanged.
    expect(screen.handleInput('down', ctx)).toBe(true);
    expect(typeText(screen, 'Fix it', ctx)).toBe(true);
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    expect(screen.takeAction()).toMatchObject({
      type: 'back',
      result: {
        type: 'ticket-create-requested',
        // BB-309 D1 put Title first, so the popup's opening field — the one
        // this keystroke reaches — is now the title. The claim is unchanged:
        // what was typed reaches the payload the screen hands back.
        payload: { title: 'Fix it' },
      },
    });
  });

  it('loads current assignment, owns write errors, and retries submission', async () => {
    const read = fakeClient({
      rows: {
        'user--user': [
          toResource({
            id: 'u1',
            type: 'user--user',
            attributes: { name: 'Ada', drupal_internal__uid: 1 },
          }),
        ],
        bb_conductor: [],
      },
    });
    vi.spyOn(read, 'get').mockResolvedValue({
      data: {
        id: 't1',
        relationships: {
          assignee_user_id: { data: { id: 'u1' } },
          project_id: { data: { id: 'p1' } },
        },
      },
    });
    const write = {
      ...read,
      update: vi
        .fn()
        .mockRejectedValueOnce(new Error('forbidden'))
        .mockResolvedValueOnce({}),
    };
    const screen = new EditAssignmentFormScreen();
    const ctx = context({
      params: { ticketId: 't1' },
      services: { client: read, writeClient: write },
    });

    screen.enter(ctx);
    await tick();
    expect(screen.options?.users[0]?.id).toBe('u1');
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    await tick();
    // BB-340 Task 9 — the popup hands over a TREE, so the server's own
    // refusal is read back off the nodes it is drawn as rather than off an
    // array of rows. The claim is unchanged: what the write was refused with
    // reaches the screen the writer is looking at.
    expect(renderTree(screen.present(ctx).body)).toContain('forbidden');
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    await tick();
    expect(write.update).toHaveBeenCalledTimes(2);
    expect(screen.takeAction()).toEqual({
      type: 'back',
      result: {
        type: 'ticket-assignment-updated',
        ticketId: 't1',
        assigneeId: 'u1',
      },
    });
  });
});

// ---- BB-309: what the direct-create path HANDS BACK ------------------------
//
// Driven against the screen rather than through the kernel harness of
// `tests/Kernel/create-form-direct.test.ts`, for one reason: the value under
// test is the RESULT the popup passes to `context.back(...)`, and the kernel
// routes that straight into the destination screen's `receiveResult` where no
// assertion can reach it. Here `back` is a spy, so the result is observable —
// which is what makes "the created ticket's id" an observation rather than a
// claim. Everything the kernel CAN see stays in that file.

const PROJECT = { id: 'p1', name: 'bakers', slug: 'bakers' };

async function directForm(
  clientOptions: FakeClientOptions = {},
  over: Partial<ScreenContext> = {},
) {
  const api = fakeClient(clientOptions);
  const results: unknown[] = [];
  const screen = new CreateTicketFormScreen();
  const ctx = context({
    project: PROJECT,
    services: { client: api },
    back: (result?: unknown) => {
      results.push(result);
      return true;
    },
    ...over,
  });
  screen.enter(ctx);
  await tick();
  return { api, screen, ctx, results };
}

describe('the direct-create path hands back what it created (BB-309)', () => {
  it('AC-2: the back result carries the id dropsh really returns', async () => {
    // dropsh's `create` returns `toResource(doc.data)` — a resource with a
    // TOP-LEVEL id. Reading `created.data.id` (the document shape) yielded the
    // empty string against the real client, so this field read as live while
    // being dead.
    const { screen, ctx, results } = await directForm({
      createdId: 'new-ticket-uuid',
    });
    expect(typeText(screen, 'Direct', ctx)).toBe(true);
    expect(screen.handleInput('ctrl+d', ctx)).toBe(true);
    await tick();

    expect(results).toEqual([
      { type: 'ticket-created-directly', ticketId: 'new-ticket-uuid' },
    ]);
  });

  it('D6: with no context.back the result leaves through the ACTION channel', async () => {
    // The fallback `EditAssignmentFormScreen` has had all along. Unreachable
    // through the kernel, which always supplies `back` — but the outcome a
    // missing fallback produces is a popup that stays open over a ticket that
    // WAS written, and pressing again writes a second one. AC-2 forbids exactly
    // that, so it is closed rather than reasoned about.
    const api = fakeClient({ createdId: 'new-ticket-uuid' });
    const screen = new CreateTicketFormScreen();
    const ctx = context({ project: PROJECT, services: { client: api } });
    screen.enter(ctx);
    await tick();

    expect(typeText(screen, 'Direct', ctx)).toBe(true);
    expect(screen.handleInput('ctrl+d', ctx)).toBe(true);
    await tick();

    expect(api.creates).toHaveLength(1);
    expect(screen.takeAction()).toEqual({
      type: 'back',
      result: { type: 'ticket-created-directly', ticketId: 'new-ticket-uuid' },
    });
  });

  it('D6: a refusal from the direct row does not survive into the agent path', async () => {
    // The two rows are two different answers to the same form. A message left
    // over from the row that POSTs would still be drawn while the agent row is
    // running, describing a rejection that has nothing to do with it.
    const { screen, ctx } = await directForm({
      createError: new Error('422 title: This value should not be null.'),
    });
    expect(typeText(screen, 'Direct', ctx)).toBe(true);
    expect(screen.handleInput('ctrl+d', ctx)).toBe(true);
    await tick();
    expect(renderTree(screen.present(ctx).body).join(' ')).toMatch(/422 title/);

    expect(screen.handleInput('ctrl+s', ctx)).toBe(true); // the agent row

    expect(renderTree(screen.present(ctx).body).join(' ')).not.toMatch(
      /422 title/,
    );
  });
});

// ---- BB-314: the popup opens on empty content ----------------------------
//
// The popup is a ROUTE. Every close goes through `Router.back()` → `navigate()`
// → `active.leave()`, and every open through `navigate()` → `enter()` (spec F5),
// so `leave(); enter(ctx)` is the reopen the operator performs — driven here
// directly, for the same reason the rest of this file drives the screen rather
// than the kernel.

/** A debounce that fires synchronously — no test sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

const PARENTS = {
  'bb_ticket/bb_ticket': {
    data: [
      {
        type: 'bb_ticket--bb_ticket',
        id: 't1',
        attributes: { identifier: 'BB-236', title: 'a declared form kernel' },
      },
    ],
  },
};

/**
 * A field row without the FORM's active/idle marker.
 *
 * `renderWidget` prefixes every field's first row with `▸ ` or `  `
 * (`render.ts`), so a label is never at column 0 — matching one has to step
 * over the marker rather than assume it away.
 */
const stripMark = (row: string): string => row.replace(/^[▸ ] /, '');

/** The row a single-row field renders, found by its label. */
const rowFor = (rows: string[], label: string): string =>
  rows.find((row) => stripMark(row).startsWith(label)) ?? '';
/** The body row a text field renders beneath its `<label>:` row. */
const bodyOf = (rows: string[], label: string): string => {
  // Explicitly -1, never `rows[0]`: a label that is not on screen must read as
  // "no body row", not as whatever happens to be the popup's first line.
  const head = rows.findIndex((row) => stripMark(row).startsWith(`${label}:`));
  return head < 0 ? '' : (rows[head + 1] ?? '');
};

/** Load the popup with a parent bag and every option list filled. */
async function popup() {
  const api = fakeClient({
    documents: PARENTS,
    rows: {
      'user--user': [
        toResource({
          id: 'u1',
          type: 'user--user',
          attributes: { name: 'cw' },
        }),
        toResource({
          id: 'u2',
          type: 'user--user',
          attributes: { name: 'agent' },
        }),
      ],
      'bb_conductor/bb_conductor': [
        toResource({
          id: 'c1',
          type: 'bb_conductor--bb_conductor',
          attributes: { label: 'cw-framework' },
        }),
      ],
      'bb_term/bb_labels': [
        toResource({
          id: 'l1',
          type: 'bb_term--bb_labels',
          attributes: { name: 'bug' },
        }),
        toResource({
          id: 'l2',
          type: 'bb_term--bb_labels',
          attributes: { name: 'ui' },
        }),
      ],
    },
    createdId: 'new-ticket-uuid',
  });
  const screen = new CreateTicketFormScreen();
  const ctx = context({
    project: PROJECT,
    services: { client: api },
    options: { debounce: immediate } as TuiOptions,
    back: () => true,
  });
  screen.enter(ctx);
  await tick();
  return { api, screen, ctx };
}

/**
 * Fill the whole form with NON-default values.
 *
 * Every choice here differs from what a fresh form derives, which is what makes
 * "remembered" an observation rather than a coincidence: the assignee is the
 * second user (not `ownFirst`'s), the conductor is CLEARED (not the
 * preselection), a label is ticked, a parent is picked, and the workflow is the
 * second one.
 */
function fill(screen: CreateTicketFormScreen, ctx: ScreenContext): void {
  // BB-326 — a named key is one press; a word is one press PER CHARACTER,
  // which is what a terminal delivers. `handleInput` no longer accepts a whole
  // string as text, and neither does a keyboard.
  const key = (k: string) => expect(typeText(screen, k, ctx)).toBe(true);
  key('Fix it'); //                       title
  key('down');
  key('and quickly'); //                  description
  key('down');
  key('BB-236'); //                     parent: type the query…
  key('enter'); //                           …and pick the one match
  key('down');
  key('right'); //                       assignee: cycle u1 → u2
  key('down');
  key('down'); //                        reviewers: leave empty
  key('backspace'); //                         conductor: clear (it is `clearable`)
  key('down');
  key('right'); //                       labels: cursor onto `ui`
  key(' '); //                            …and tick it
  key('down');
  key('right'); //                       workflow: cycle to the second option
}

/** What every reopen must show, whatever closed the popup. */
function expectReopened(screen: CreateTicketFormScreen, ctx: ScreenContext) {
  expectReopenedFrame(screen.present(ctx).body);
}

/**
 * The same claims, against one frame's TREE (BB-340 Task 9).
 *
 * Title is the popup's active field, so its value block is the `FieldTextarea`
 * that drives the terminal cursor rather than a row of text: "cleared" is that
 * widget's own `value` being empty with `<empty>` standing in as its
 * placeholder. Description is not active, so it still says `<empty>` in text —
 * the two halves of the same claim, each read where it now lives.
 */
function expectReopenedFrame(body: VNode) {
  const rows = renderTree(body);

  // Cleared — the whole point of the ticket.
  const title = nodeById(body, 'field-title-input');
  expect(title?.type).toBe(FieldTextarea);
  const titleProps = title?.props as { value?: string; placeholder?: string };
  expect(titleProps.value).toBe('');
  expect(titleProps.placeholder).toBe('<empty>');
  expect(bodyOf(rows, 'Description')).toContain('<empty>');
  expect(rows.join('\n')).not.toContain('Fix it');
  expect(rows.join('\n')).not.toContain('and quickly');

  // Remembered.
  expect(rowFor(rows, 'Parent')).toContain('BB-236');
  expect(rowFor(rows, 'Assignee')).toContain('agent');
  expect(rowFor(rows, 'Conductor')).toContain('— none —');
  expect(rows.join('\n')).toContain('[x] ui');

  // Re-defaulted: the workflow is back on the FIRST option (D5).
  expect(rowFor(rows, 'Workflow')).toContain(
    `< ${WORKFLOW_OPTIONS[0]?.label} >`,
  );
}

describe('BB-314: the New ticket popup opens on empty content', () => {
  it('AC-1/2/5–9: reopening after a direct submit clears content, keeps routing', async () => {
    const { api, screen, ctx } = await popup();
    fill(screen, ctx);

    expect(screen.handleInput('ctrl+d', ctx)).toBe(true); // Ctrl+D — direct create
    await tick();
    expect(api.creates).toHaveLength(1);

    screen.leave();
    screen.enter(ctx);

    expectReopened(screen, ctx);
  });

  it('AC-3/4: reopening after Esc clears content too', async () => {
    const { api, screen, ctx } = await popup();
    fill(screen, ctx);

    expect(screen.handleInput('escape', ctx)).toBe(true); // Esc — abandon
    expect(screen.takeAction()).toEqual({ type: 'back' });
    expect(api.creates).toHaveLength(0);

    screen.leave();
    screen.enter(ctx);

    expectReopened(screen, ctx);
  });

  // The two cases above call `render()` THEMSELVES after `enter()` returns —
  // a render the kernel never performs. The live PTY walk showed what that
  // misses: the reopened popup still showed the typed title until an unrelated
  // keystroke forced a repaint, because `AsyncScreen.enter`'s `ready` branch
  // calls `requestDraw()` — which the kernel services SYNCHRONOUSLY — before
  // this screen's override has replaced the form. So the observation has to be
  // the frame the kernel was ASKED to paint, which is what rendering inside the
  // spy captures.
  it('AC-1/3: the LAST frame the reopen asks for is already the empty one', async () => {
    const { screen, ctx } = await popup();
    fill(screen, ctx);
    expect(screen.handleInput('escape', ctx)).toBe(true); // Esc — abandon

    const drawn: VNode[] = [];
    const drawCtx: ScreenContext = {
      ...ctx,
      requestDraw: () => {
        drawn.push(screen.present(drawCtx).body);
      },
    };

    screen.leave();
    screen.enter(drawCtx);

    // A guard, not the claim: a reopen that painted nothing at all would leave
    // the stale frame standing just as surely.
    expect(drawn.length).toBeGreaterThan(0);
    // The claim — asserted on the LAST frame, never on a count: what the
    // operator is left looking at is the final paint of the navigation.
    const last = drawn.at(-1);
    expect(last).toBeDefined();
    if (last) expectReopenedFrame(last);
  });
});

describe("a closed ticket's edit popup", () => {
  it('is read-only: no Save, no value changes, and Ctrl+S writes nothing', async () => {
    const read = fakeClient({
      rows: {
        'user--user': [
          toResource({
            id: 'u1',
            type: 'user--user',
            attributes: { name: 'Ada' },
          }),
        ],
        bb_conductor: [],
      },
    });
    vi.spyOn(read, 'get').mockResolvedValue({
      data: { id: 't1', attributes: { state: 'done', closed: true } },
    });
    const write = { ...read, update: vi.fn().mockResolvedValue({}) };
    const screen = new EditAssignmentFormScreen();
    const ctx = context({
      params: { ticketId: 't1' },
      services: { client: read, writeClient: write },
    });

    screen.enter(ctx);
    await tick();
    const lines = renderTree(screen.present(ctx).body).join('\n');
    expect(screen.handleInput('right', ctx)).toBe(true); // Assignee → Ada
    expect(renderTree(screen.present(ctx).body).join('\n')).toBe(lines);
    expect(lines).not.toContain('←→');
    expect(lines).not.toContain('[ Save ]');
    expect(lines).not.toContain('[ Cancel ticket ]');
    expect(screen.handleInput('ctrl+s', ctx)).toBe(true);
    await tick();
    expect(write.update).not.toHaveBeenCalled();
    expect(renderTree(screen.present(ctx).body).join('\n')).toContain(
      'closed and read-only',
    );
  });
});
