import { expect, it } from 'bun:test';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResourceWriteBody,
  TuiOptions,
} from '../../src/types.js';
import { bootTui } from '../tui-harness.js';

// BB-233 — the edit popup, driven through the real kernel and a real
// renderer. This is where AC-1 (the key), AC-2/AC-3 (write → re-read → redraw),
// AC-5 (a rejection keeps the form and shows the server's words) and AC-6
// (Cancel writes nothing) are actually exercised: the pure model cannot prove
// any of them, because they are all properties of the key routing.
//
// BB-326 — EVERY `output.text` ASSERTION IN THIS FILE WAS RE-READ, NOT
// TRANSLATED. `text` was the whole transcript: every byte the kernel had ever
// written, popups included. So `expect(output.text).toContain('Edit ticket')`
// stayed true forever once the popup had been opened ONCE, and its negative
// twin `not.toContain(...)` only ever held before the first open. Under the
// renderer `frame()` is the CURRENT SCREEN, which is what all of these meant;
// each one below now says when it means it.

const TICKET = 'ffffffff-0000-0000-0000-000000000001';
const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_USER = 'aaaaaaaa-0000-0000-0000-000000000002';
const COND = 'bbbbbbbb-0000-0000-0000-000000000001';
const PROJECT = 'pppppppp-0000-0000-0000-000000000001';

const ticketDoc = (runState?: string, state = 'coding') => ({
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-233',
      title: 'bakers ui ticket-edit form',
      state,
      description: 'The description body.',
      ...(runState
        ? { derived_status: runState, claim_machine: 'cw-framework' }
        : {}),
    },
    relationships: {
      project_id: { data: { id: PROJECT } },
      assignee_user_id: { data: { id: USER } },
      conductor_id: { data: { id: COND } },
      runs: { data: runState ? [{ id: 'r1' }] : [] },
    },
  },
  included: [
    { id: USER, type: 'user--user', attributes: { display_name: 'cw' } },
    {
      id: COND,
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    },
    ...(runState
      ? [
          {
            id: 'r1',
            type: 'bb_run--bb_run',
            attributes: { state: runState },
          },
        ]
      : []),
  ],
});

interface Recorder {
  reads: string[];
  writes: { type: string; id: string; body: ResourceWriteBody }[];
  optionCollections: string[];
}

function res(
  id: string,
  attributes: Record<string, unknown>,
  projectId?: string,
) {
  return {
    id,
    type: 't',
    attr: (k: string) => attributes[k],
    rel: () => projectId ?? null,
    rels: () => [],
  };
}

/** A read client + a distinct write client, both recording. */
function harness(
  opts: { runState?: string; writeError?: unknown; ticketState?: string } = {},
) {
  const rec: Recorder = { reads: [], writes: [], optionCollections: [] };

  const emptyCollection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () => [],
    };
    return c;
  };

  // BB-313 — the fake world REMEMBERS the write. The read client used to serve
  // one frozen document, so "reopen the popup after a successful cancel" was not
  // expressible at all: the second read handed back the pre-write state and the
  // popup would have looked right for the wrong reason. Cancelling is the one
  // write this popup makes that changes WHICH DECLARATION the ticket gets, so the
  // fake has to advance with it or it cannot witness that at all.
  let currentState = opts.ticketState;

  const read: DropshClient = {
    collection: () => emptyCollection(),
    get: async (path: string) => {
      rec.reads.push(path);
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`))
        return ticketDoc(opts.runState, currentState);
      return { data: [] };
    },
    update: async () => {
      throw new Error('the READ client must never be used for a write');
    },
  };

  const optionRows: Record<string, ReturnType<typeof res>[]> = {
    user: [
      res(USER, { display_name: 'cw', drupal_internal__uid: 1 }),
      res(OTHER_USER, { display_name: 'tm', drupal_internal__uid: 2 }),
    ],
    bb_conductor: [
      res(COND, { label: 'cw-framework', status: 'running' }, PROJECT),
    ],
  };

  const write: DropshClient = {
    collection: (type: string) => {
      rec.optionCollections.push(type);
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () => (optionRows[type] ?? []) as never,
      };
      return c;
    },
    get: async () => ({ data: [] }),
    update: async (type: string, id: string, body: ResourceWriteBody) => {
      rec.writes.push({ type, id, body });
      if (opts.writeError !== undefined) throw opts.writeError;
      const written = (body.attributes as Record<string, unknown> | undefined)
        ?.state;
      if (typeof written === 'string') currentState = written;
      return { data: { type, id } };
    },
  };

  const services: RendererServices = {
    client: read,
    baseUrl: 'https://x.test',
  };
  return { rec, services, write };
}

/**
 * A frame with its box-drawing removed and its whitespace collapsed — so an
 * assertion tests the TEXT the operator reads and not where the box happened to
 * wrap it. Needed for AC-5: a real 403 detail is longer than the popup is wide,
 * so it is wrapped across rows on purpose.
 *
 * BB-326: the ANSI strip that used to lead this pipeline is gone. The
 * renderer paints cells, so an escape reaching the frame would be a defect
 * rather than something to filter out.
 */
const plain = (frame: string): string =>
  frame
    .replace(/[│╭╮╰╯─▸]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Boot the ticket screen under a real renderer and return a driver. */
async function openTicket(
  h: ReturnType<typeof harness>,
  over: Partial<TuiOptions> = {},
) {
  const tui = await bootTui({
    services: h.services,
    tui: {
      route: { screen: 'ticket', ticketId: TICKET, view: 'full' },
      writeClient: h.write,
      ...over,
    },
  });
  const press = (key: string): Promise<void> => tui.press(key);
  /** What is on screen NOW — every assertion in this file wants this one. */
  const screen = (): string => tui.frame();
  // Teardown. An OPEN popup owns every key, `q` included — that is the AC-1
  // "inert while a popup is open" property, so the teardown has to close it
  // first rather than work around it. Esc is also the ONE key OpenTUI delivers
  // asynchronously (it is the prefix of every CSI sequence), which `press`
  // waits out.
  const quit = async (): Promise<void> => {
    await press('\x1b');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  };
  return { screen, press, quit };
}

// ---- AC-1 -------------------------------------------------------------------

it('AC-1: `e` opens the popup, prefilled from the ticket', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  // Nothing has opened it yet, and now that means "not on screen" rather than
  // "not yet in the transcript" — the two only agreed before the first open.
  expect(screen()).not.toContain('Edit ticket');
  // The key hint documents it before it is ever pressed.
  expect(screen()).toContain('e:Edit');

  await press('e');
  expect(screen()).toContain('Edit ticket');
  expect(screen()).toContain('< cw >');
  expect(screen()).toContain('< cw-framework (running) >');
  // BB-391: the popup no longer names a write profile. There is one identity,
  // so the row named nothing an operator could act on.
  expect(screen()).not.toContain('writes as:');
  await quit();
});

it('AC-1: the option lists load through the WRITE client', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  // Users + conductors prefer the write client; labels ride the read path and
  // may not appear here when the write client is used only for write-preferring
  // collections. The write-side bags are what this case pins.
  expect(h.rec.optionCollections.sort()).toEqual(
    expect.arrayContaining(['bb_conductor', 'user']),
  );
  await quit();
});

it('AC-1: `e` is inert under --view teaser (no interactive detail there)', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h, {
    route: { screen: 'ticket', ticketId: TICKET, view: 'teaser' },
  });
  await press('e');
  expect(screen()).not.toContain('Edit ticket');
  expect(h.rec.optionCollections).toEqual([]);
  await quit();
});

it('AC-1: while the popup is open `e` types nothing and opens nothing new', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  const after = h.rec.optionCollections.length;
  await press('e');
  expect(h.rec.optionCollections).toHaveLength(after);
  await quit();
});

// ---- AC-2 / AC-3 ------------------------------------------------------------

it('AC-2: Ctrl+S writes the changed assignee, then RE-READS through the read client', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  const readsBefore = h.rec.reads.length;

  await press('\x1b[C'); // → cycle the assignee
  await press('\x13'); // Ctrl+S

  expect(h.rec.writes).toHaveLength(1);
  expect(h.rec.writes[0]?.type).toBe('bb_ticket--bb_ticket');
  expect(h.rec.writes[0]?.id).toBe(TICKET);
  const rels = h.rec.writes[0]?.body.relationships as Record<string, unknown>;
  expect(rels.assignee_user_id).toEqual({
    data: { type: 'user--user', id: OTHER_USER },
  });
  // The re-read goes through the READ client — `pm` cannot see bb_run.
  expect(h.rec.reads.length).toBeGreaterThan(readsBefore);
  expect(h.rec.reads.at(-1)).toContain(TICKET);
  await quit();
});

it('AC-3: the conductor is written the same way, and the popup closes', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await press('\x1b[B'); // ↓ reviewers
  await press('\x1b[B'); // ↓ to the conductor row
  await press('\x1b[C'); // → cycle it (one option ⇒ lands on null)
  await press('\x13');

  const rels = h.rec.writes[0]?.body.relationships as Record<string, unknown>;
  expect(rels).toHaveProperty('conductor_id');
  // The popup closed: the frame on screen now is the ticket detail again.
  expect(screen()).not.toContain('[ Save ]');
  expect(screen()).toContain('[Overview]');
  // 'Assigned:' was a header row; now the assignee appears on the meta line.
  expect(screen()).toContain('coding');
  await quit();
});

it('AC-4: Del clears the active select and the PATCH carries data: null', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  await press('\x1b[3~'); // Del on the assignee row
  await press('\x13');
  const rels = h.rec.writes[0]?.body.relationships as Record<string, unknown>;
  expect(rels.assignee_user_id).toEqual({ data: null });
  await quit();
});

// ---- AC-5 -------------------------------------------------------------------

it('AC-5: a rejected write keeps the popup, its input, and shows the server text', async () => {
  const forbidden = Object.assign(new Error('HTTP 403'), {
    status: 403,
    body: {
      errors: [
        {
          title: 'Forbidden',
          detail:
            'The current user is not allowed to PATCH the selected field (conductor_id). Assigning a conductor requires the "assign bakers conductor" permission.',
        },
      ],
    },
  });
  const h = harness({ writeError: forbidden });
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await press('\x1b[C'); // change the assignee to tm
  const readsBefore = h.rec.reads.length;
  await press('\x13');

  const frame = plain(screen());
  // The popup is still open…
  expect(frame).toContain('[ Save ]');
  // …still holding what was entered…
  expect(frame).toContain('< tm >');
  // …showing the server's OWN words, IN FULL (the detail is longer than the
  // popup is wide, so it must be wrapped, never truncated — the actionable half
  // is at the END of the sentence)…
  expect(frame).toContain(
    'The current user is not allowed to PATCH the selected field (conductor_id). Assigning a conductor requires the "assign bakers conductor" permission.',
  );
  // …and never dropping to the useless `HttpError.message`.
  expect(frame).not.toContain('HTTP 403');
  // …and the ticket was NOT re-read (nothing changed).
  expect(h.rec.reads).toHaveLength(readsBefore);
  await quit();
});

// ---- AC-6 -------------------------------------------------------------------

it('AC-6: Esc closes the popup and performs NO write', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await press('\x1b[C'); // change something first
  await press('\x1b'); // Esc

  expect(h.rec.writes).toEqual([]);
  expect(screen()).not.toContain('[ Save ]');
  await quit();
});

it('AC-6: Esc while the popup is open does not also navigate back', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await press('\x1b');
  // Still on the ticket screen, not the dashboard. This assertion was VACUOUS
  // against the transcript — the ticket had been drawn at boot, so `BB-233`
  // was in it whatever Esc did next. Against the current screen it finally says
  // what it claims.
  expect(screen()).toContain('BB-233');
  expect(h.rec.writes).toEqual([]);
  await quit();
});

// ---- AC-8 -------------------------------------------------------------------

it('AC-8: the popup warns and names the live conductor on a claimed ticket', async () => {
  const h = harness({ runState: 'running' });
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  const frame = screen();
  expect(frame).toContain('cw-framework');
  expect(frame).toMatch(/does not stop that run/i);
  // …and it still lets the write through (never blocks — spec Decision 6).
  await press('\x13');
  expect(h.rec.writes).toHaveLength(1);
  await quit();
});

it('AC-8: no warning when no run is active', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  const frame = screen();
  expect(frame).not.toMatch(/does not stop that run/i);
  await quit();
});

// ---- the read/write split (spec Risk table) ---------------------------------

it('the write client is used ONLY for the PATCH and the two option lists', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  await press('\x13');
  // Every option query went to the write client…
  expect(h.rec.optionCollections.sort()).toEqual(['bb_conductor', 'user']);
  // …and every document read went to the read client (its `update` throws, so a
  // write through it would have failed loudly).
  expect(
    h.rec.reads.every(
      (p) => p.includes('bb_ticket') || p.includes('bakers/addons/ticket/'),
    ),
  ).toBe(true);
  expect(h.rec.writes).toHaveLength(1);
  await quit();
});

it('with no write client injected the write falls back to the read client', async () => {
  // Spec Decision 1: one failure path for "wrong scope" and "no scope" alike —
  // the server's own 403 is what the operator sees, never a silent no-op.
  //
  // BB-391: the popup no longer says which profile it writes as, because there
  // is one identity and nothing to choose. The fallback ITSELF is unchanged, and
  // it is the behaviour this case is really about.
  const h = harness();
  const { screen, press, quit } = await openTicket(h, {
    writeClient: undefined,
  });
  await press('e');
  expect(screen()).not.toContain('writes as:');
  await press('\x13');
  const frame = screen();
  expect(frame).toContain('must never be used for a write');
  expect(h.rec.writes).toEqual([]);
  await quit();
});

// The live regression: `session` is owner-gated on `bb_conductor`, so a
// conductor picked from the pm-backed option list arrives WITHOUT its include
// on the re-read. Measured on BB-1 as `Conductor:
// dea98c92-eab0-44f7-813e-5a4ee632cb22`.
it('AC-3: a conductor the READ profile cannot see still renders by name', async () => {
  const h = harness();
  // The re-read returns the relationship but no conductor include — exactly
  // what the access filter does.
  const read = h.services.client as DropshClient & {
    get: (p: string) => Promise<unknown>;
  };
  const original = read.get.bind(read);
  read.get = async (path: string) => {
    const doc = (await original(path)) as {
      included?: { type: string }[];
    };
    if (doc?.included) {
      doc.included = doc.included.filter(
        (r) => r.type !== 'bb_conductor--bb_conductor',
      );
    }
    return doc;
  };

  const { screen, press, quit } = await openTicket(h);
  // Conductor lives under collapsed Technical details on Overview.
  await press('G');
  await press('\r');
  // Before the popup ever opened there is no label source — the uuid is the
  // honest answer, and it is what the operator saw before this fix.
  // The uuid may word-wrap in the narrow sidebar so check its prefix.
  expect(plain(screen())).toContain(COND.slice(0, 14));

  await press('e');
  await press('\x13'); // submit, which closes the popup and re-reads

  // Now the popup's own option list supplies the label.
  const frame = plain(screen());
  expect(frame).toContain('conductor');
  expect(frame).toContain('cw-framework');
  expect(frame).not.toContain(COND);
  await quit();
});

// ---- BB-360 — Cancel ticket action (replaces BB-313 State select) -------

/** Move focus to Cancel ticket: Assignee·Reviewers·Conductor·Estimate·Spent·Parent·Labels·Save·Cancel */
const toCancelTicket = async (press: (key: string) => Promise<void>) => {
  for (let i = 0; i < 8; i += 1) await press('\x1b[B');
};

it('BB-360: Enter on Cancel ticket writes only state: cancelled', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  expect(plain(screen())).toContain('[ Cancel ticket ]');
  expect(plain(screen())).not.toContain('State:');

  await toCancelTicket(press);
  await press('\r'); // Enter activates the focused action row
  expect(h.rec.writes).toHaveLength(1);
  expect(h.rec.writes[0]?.body).toEqual({
    attributes: { state: 'cancelled' },
  });
  expect(h.rec.writes[0]?.body).not.toHaveProperty('relationships');
  await quit();
});

it('BB-360 D10: Ctrl+S from Cancel ticket row still Saves (never cancels)', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  await toCancelTicket(press);
  await press('\x13'); // Ctrl+S — ALWAYS Save, even on Cancel ticket
  expect(h.rec.writes).toHaveLength(1);
  const attributes = h.rec.writes[0]?.body.attributes as Record<
    string,
    unknown
  >;
  expect(attributes).not.toHaveProperty('state');
  expect(h.rec.writes[0]?.body).toHaveProperty('relationships');
  await quit();
});

it('BB-360: an untouched Save still sends no state', async () => {
  const h = harness();
  const { press, quit } = await openTicket(h);
  await press('e');
  await press('\x13');
  const attributes = h.rec.writes[0]?.body.attributes as Record<
    string,
    unknown
  >;
  expect(attributes).not.toHaveProperty('state');
  const rels = h.rec.writes[0]?.body.relationships as Record<string, unknown>;
  expect(rels).toHaveProperty('labels');
  expect(rels).toHaveProperty('parent_id');
  await quit();
});

it('BB-360: a done ticket gets no Cancel ticket row, and Save stays reachable', async () => {
  const h = harness({ ticketState: 'done' });
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  const frame = plain(screen());
  expect(frame).toContain('Edit ticket');
  expect(frame).not.toContain('[ Cancel ticket ]');
  expect(frame).not.toContain('State:');
  // ↓ seven times lands on Save (Assignee·Reviewers·Conductor·Estimate·Spent·Parent·Labels·Save).
  for (let i = 0; i < 7; i += 1) await press('\x1b[B');
  await press('\x13');
  const attributes = h.rec.writes[0]?.body.attributes as Record<
    string,
    unknown
  >;
  expect(attributes).not.toHaveProperty('state');
  await quit();
});

// The popup is a REGISTERED screen, reused across opens, and `AsyncScreen.enter`
// re-loads only when the session or the context key changed — neither of which a
// second open of the SAME ticket changes. Drop on leave (BB-313) still applies
// so a second open is a fresh form, never a half-edited residual.

it('BB-360: Esc closes without writing; reopen is a fresh form', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await press('\x1b[C'); // cycle assignee
  await press('\x1b'); // Esc — nothing is written
  expect(h.rec.writes).toEqual([]);

  await press('e');
  // Fresh form: the cycled assignee did not stick.
  expect(plain(screen())).toContain('< cw >');
  await press('\x13');
  expect(h.rec.writes).toHaveLength(1);
  const attributes = h.rec.writes[0]?.body.attributes as Record<
    string,
    unknown
  >;
  expect(attributes).not.toHaveProperty('state');
  await quit();
});

it('BB-360: after a successful cancel the reopened popup is the terminal one', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await toCancelTicket(press);
  await press('\r'); // cancel
  expect(h.rec.writes).toHaveLength(1);

  await press('e');
  const frame = plain(screen());
  expect(frame).toContain('Edit ticket');
  expect(frame).not.toContain('[ Cancel ticket ]');
  expect(frame).not.toContain('State:');

  await press('\x13');
  expect(h.rec.writes).toHaveLength(2);
  expect(h.rec.writes[1]?.body.attributes).not.toHaveProperty('state');
  await quit();
});

it('BB-360: a rejected cancel keeps the popup and shows the server words', async () => {
  const detail =
    'state: The transition from coding to cancelled is not allowed.';
  const h = harness({
    writeError: Object.assign(new Error('HTTP 422'), {
      status: 422,
      body: { errors: [{ title: 'Unprocessable Entity', detail }] },
    }),
  });
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  await toCancelTicket(press);
  await press('\r');
  expect(plain(screen())).toContain(detail);
  expect(plain(screen())).toContain('Edit ticket');
  await quit();
});

it('BB-360: chrome says Esc close, not Esc cancel', async () => {
  const h = harness();
  const { screen, press, quit } = await openTicket(h);
  await press('e');
  // BB-375 — modal status ladder from actions() → "Esc close".
  expect(plain(screen())).toMatch(/Esc close/);
  expect(plain(screen())).not.toMatch(/Esc cancel/i);
  await quit();
});
