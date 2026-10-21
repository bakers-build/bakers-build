import { expect, it } from 'bun:test';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIELDS_WITH_PROJECT } from '../../src/Entity/ticket/Form/create.js';
import type {
  HostedAgent,
  RendererServices,
  ResolvedRoute,
  TuiAgentService,
  TuiOptions,
} from '../../src/types.js';
import {
  type FakeClientOptions,
  fakeClient,
  queryStringOf,
  resolveCollectionPath,
  toResource,
} from '../../tests/test-support.js';
import { bootTui, settle } from '../tui-harness.js';

// BB-309 — the popup's SECOND submit path, driven end to end through the real
// kernel over a real renderer.
//
// This harness IS the validator for this change, and the spec says so rather
// than leaving it implied (D10): `ddev bakers-test-e2e` is a Chromium suite and
// the surface here is a terminal cockpit, so a green browser run would be a
// false statement about the popup. What runs instead is the real kernel, the
// real router, the real form declaration and the real screen, with fakes only at
// the dropsh-client and agent-host seams — which is what makes "exactly one
// ticket was written and no agent was launched" an observation rather than a
// claim.
//
// A sibling of `create-form-keys.test.ts` rather than more of it: that file is
// one of the three BB-236 contract files and is already 600 lines.
//
// BB-326 — EVERY FRAME ASSERTION IN THIS FILE WAS RE-READ, NOT TRANSLATED.
// The fake harness accumulated every byte the kernel ever wrote and its
// `frame()` only re-split that transcript at the last clear-screen. Under the
// renderer `frame()` is the CURRENT SCREEN, which is what all of these meant.
// Two consequences worth naming, because they changed what the cases below
// assert: a value typed into a field is now read off that field's OWN value row
// (a bare `toContain('Direct')` over a frame can be answered by any occurrence
// of the word), and the two `not.toContain` cases finally deny the screen
// rather than a transcript that had simply not reached the popup yet.

const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const COND = 'bbbbbbbb-0000-0000-0000-000000000001';
const LABEL_A = 'cccccccc-0000-0000-0000-000000000001';
const LABEL_BUNDLE = 'bb_term/bb_labels';
const PROJECT = 'dddddddd-0000-0000-0000-000000000001';
const PROJECT_B = 'dddddddd-0000-0000-0000-000000000002';

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'bakers',
};

/**
 * The project-search debounce, run in IMMEDIATE mode (the BB-257 R2 pattern
 * `create-form-parent.test.ts` already uses) — so picking a project in the new
 * BB-664 field needs no real timer wait.
 */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

/** How many `↓` presses reach `id` with NO project in scope — the form that
 *  carries the extra Project field ahead of everything else (BB-664 AC-8). */
const downToNoProject = (id: string): number =>
  FIELDS_WITH_PROJECT.findIndex((f) => f.id === id);

const rows = () => ({
  user: [
    toResource({
      id: USER,
      type: 'user--user',
      attributes: { display_name: 'cw', name: 'cw' },
    }),
  ],
  bb_conductor: [
    toResource({
      id: COND,
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'cw-framework' },
    }),
  ],
  [LABEL_BUNDLE]: [
    toResource({
      id: LABEL_A,
      type: 'bb_term--bb_labels',
      attributes: { name: 'bug' },
    }),
  ],
});

interface Recorded {
  group: string;
  cwd: string;
  prompt: string;
  env: Record<string, string | undefined>;
  label?: string | undefined;
}

function fakeAgents(): { launches: Recorded[]; host: TuiAgentService } {
  const launches: Recorded[] = [];
  const host: TuiAgentService = {
    launch: async (o): Promise<HostedAgent> => {
      launches.push(o as Recorded);
      return {
        id: `agent-${launches.length}`,
        group: o.group,
        label: o.label ?? '',
      };
    },
    list: async () => [],
    focus: async () => {},
    hide: async () => {},
    kill: async () => {},
  };
  return { launches, host };
}

/**
 * The frame as TEXT: box-drawing gone, whitespace collapsed.
 *
 * BB-326: the ANSI strip that used to lead this pipeline is gone with the
 * fake output. The renderer paints cells, so the frame arrives as characters
 * and an escape in it would be a defect rather than something to filter out.
 */
const plain = (frame: string): string =>
  frame
    .replace(/[│╭╮╰╯─]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What a `text` field currently HOLDS, read off its own value row.
 *
 * The `text` widget draws a `<label>:` row and the value on the row(s) beneath
 * it (`src/Widget/text.ts`), which is the only place the typed characters are
 * on screen. Asserting there rather than with a `toContain` over the whole
 * frame is the difference between "the title says Direct" and "the word Direct
 * appears somewhere" — and the latter is answerable by the ticket list behind
 * the popup, or by a stale error message quoting the value.
 */
const fieldValue = (rendered: string[], label: string): string => {
  const at = rendered.findIndex((row) => row.includes(`${label}:`));
  return at < 0 ? '' : (rendered[at + 1] ?? '').replace(/[│]/g, '').trim();
};

async function boot(
  over: Partial<TuiOptions> = {},
  clientOptions: FakeClientOptions = { rows: rows() },
) {
  const client = fakeClient(clientOptions);
  const agents = fakeAgents();
  const services: RendererServices = { client, baseUrl: 'https://x.test' };
  const tui = await bootTui({
    services,
    tui: {
      agents: agents.host,
      project: 'bakers',
      cwd: '/repo',
      ...over,
    },
  });
  const press = (key: string): Promise<void> => tui.press(key);
  const frame = (): string => plain(tui.frame());
  /**
   * Several keys in ONE synchronous turn, with no settle between them.
   *
   * `press` awaits a tick, which is exactly what an in-flight write needs to
   * finish — so it cannot express "a second keypress while the first POST is
   * still open", which is the only condition the `submitting` guard exists for.
   * `mockInput.pressKey` is the raw send that does not wait; the settle comes
   * once, after both keys are in.
   */
  const burst = async (...keys: string[]): Promise<void> => {
    for (const key of keys) tui.mockInput.pressKey(key);
    await settle();
    await tui.renderOnce();
  };
  const quit = async (): Promise<void> => {
    // Esc is the ONE key OpenTUI does not deliver synchronously — it is the
    // prefix of every CSI sequence, so the parser holds it for a disambiguation
    // window. `press` waits that window out; sending `q` before it elapsed
    // would type into a popup that is still open.
    await press('\x1b');
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  };
  return { agents, client, tui, press, burst, frame, quit };
}

/** Open the popup (`n`) — most cases below start here. */
async function openForm(
  over: Partial<TuiOptions> = {},
  clientOptions?: FakeClientOptions,
) {
  const d = await boot(over, clientOptions ?? { rows: rows() });
  await d.press('n');
  return d;
}

/**
 * Boot on the project's TICKET LIST, which is the screen behind the popup for
 * the AC-7 case. A deep-linked project lands on its Dashboard, so the list is
 * one Tab away — walked here rather than routed around, exactly as
 * `edit-form-from-list.test.ts` does it.
 */
async function openTicketsList() {
  const d = await boot({ route: PROJECT_ROUTE });
  await d.press('\t');
  return d;
}

/** Fill Title + Description, leaving every select at its preselected value. */
const fill = async (d: { press: (key: string) => Promise<void> }) => {
  for (const c of 'Direct') await d.press(c);
  await d.press('\x1b[B'); // → Description
  for (const c of 'Body') await d.press(c);
};

// ---- AC-1: two submit actions, both named ------------------------------------

it('AC-1: the popup names both actions and draws both rows', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  expect(d.frame()).toContain('[ Create with agent ]');
  expect(d.frame()).toContain('[ Create directly ]');
  expect(d.frame()).toContain('Ctrl+S agent');
  expect(d.frame()).toContain('Ctrl+D direct');
  await d.quit();
});

it('AC-1: neither key hint is CLIPPED at the popup`s real width', async () => {
  // The popup is a centred overlay at most 62 columns wide — `innerWidth =
  // Math.min(60, width - 8)`, so 60 is a CAP and a narrow terminal gets fewer,
  // which only makes the clipping this case guards likelier. `fitLine` truncates
  // a row that does not fit with an ellipsis. A status line naming both actions
  // on ONE row was 81 columns and lost `Ctrl+D direct` entirely — the hint would
  // have been true only in a test, which is why this case reads the rendered
  // ROWS rather than the string the screen returns.
  //
  // BB-326: the rows used to be recovered by splitting the transcript on the
  // cursor-position escapes the fake output collected. The renderer paints a
  // grid, so a row IS a row — `tui.rows()` is that same split, made by the thing
  // that did the wrapping.
  const d = await openForm({ route: PROJECT_ROUTE });
  // BB-375 — actions() → formatActionLadder in modal status (two rows).
  const hintRows = d.tui.rows().filter((r) => /Ctrl\+|Esc cancel/.test(r));
  expect(hintRows.length).toBeGreaterThan(0);
  for (const row of hintRows) expect(row).not.toContain('…');
  const hint = hintRows.join(' ');
  expect(hint).toContain('Ctrl+S agent');
  expect(hint).toContain('Ctrl+D direct');
  expect(hint).toContain('Esc cancel');
  await d.quit();
});

// ---- AC-2 / AC-3 / AC-4 / AC-5: what the direct create writes ----------------

it('AC-2/AC-3/AC-4: Ctrl+D creates exactly one ticket and launches no agent', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  await d.press('\x04'); // Ctrl+D

  expect(d.agents.launches).toEqual([]);
  expect(d.client.creates).toHaveLength(1);
  const created = d.client.creates[0];
  expect(created?.type).toBe('bb_ticket--bb_ticket');
  expect(created?.body.attributes).toMatchObject({
    title: 'Direct',
    description: { value: 'Body', format: 'bb_rich' },
    workflow: 'bb_feature',
  });
  expect(created?.body.relationships).toMatchObject({
    project_id: { data: { type: 'bb_project--bb_project', id: PROJECT } },
    assignee_user_id: { data: { type: 'user--user', id: USER } },
    conductor_id: {
      data: { type: 'bb_conductor--bb_conductor', id: COND },
    },
  });
  await d.quit();
});

it('AC-5: no state is written and no comment is published', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  await d.press('\x04');

  expect(d.client.creates[0]?.body.attributes).not.toHaveProperty('state');
  // The only write of the whole interaction is the one ticket: no comment, no
  // handoff, no second resource of any kind.
  expect(d.client.creates).toHaveLength(1);
  expect(d.client.writes).toEqual([]);
  await d.quit();
});

/**
 * The temp specs in `tmpdir()` whose content mentions `needle`.
 *
 * Matched on CONTENT, not on the file list: the suite runs its files in
 * parallel workers and the agent path of a sibling case writes into the same
 * directory, so a before/after diff of the whole listing would fail on someone
 * else's file. A per-case needle sees only this case's writes.
 */
const specsMentioning = (needle: string): string[] =>
  readdirSync(tmpdir())
    .filter((name) => /^bakers-new-ticket-.*\.json$/.test(name))
    .filter((name) => {
      try {
        return readFileSync(join(tmpdir(), name), 'utf8').includes(needle);
      } catch {
        // Raced against another worker's own cleanup — not this case's file.
        return false;
      }
    });

it('AC-3: the temp spec belongs to the AGENT path — a direct create writes none', async () => {
  // The spec file is how the agent RECEIVES the form; a direct create has no
  // agent, so it has nothing to hand over. Prose said so and nothing checked it.
  const needle = `Zd${Date.now().toString(36)}`;
  const d = await openForm({ route: PROJECT_ROUTE });
  for (const c of needle) await d.press(c); // the Title field
  await d.press('\x04');

  expect(d.client.creates).toHaveLength(1);
  expect(specsMentioning(needle)).toEqual([]);

  // The control, so the assertion above cannot pass by looking in the wrong
  // place: the SAME text down the agent row does leave a spec behind.
  await d.press('n');
  for (const c of needle) await d.press(c);
  await d.press('\x13');

  const written = specsMentioning(needle);
  expect(written).toHaveLength(1);
  for (const name of written) rmSync(join(tmpdir(), name), { force: true });
  await d.quit();
});

it('AC-2: a second Ctrl+D while the first POST is open writes nothing more', async () => {
  // Both keypresses land in ONE synchronous turn, which is the only moment the
  // `submitting` guard is load-bearing: `submitDirect` sets it before it awaits.
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  await d.burst('\x04', '\x04');

  expect(d.client.creates).toHaveLength(1);
  await d.quit();
});

it('AC-8: the guard RESETS on a rejection, so a retry is possible', async () => {
  // The other half of the same guard, and the reason it resets in `finally`: a
  // guard that latched would leave the operator with a popup that has stopped
  // responding to the key it names.
  const d = await openForm(
    { route: PROJECT_ROUTE },
    { rows: rows(), createError: new Error('502 Bad Gateway') },
  );
  await fill(d);
  await d.press('\x04');
  expect(d.client.creates).toHaveLength(1);

  await d.press('\x04');

  expect(d.client.creates).toHaveLength(2);
  await d.quit();
});

// ---- AC-6 / D7: the agent path, and which key means which action -------------

it('AC-6: Ctrl+S from a non-action field is unchanged and creates nothing', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  await d.press('\x13'); // Ctrl+S, standing on Description

  expect(d.client.creates).toEqual([]);
  expect(d.agents.launches).toHaveLength(1);
  const launch = d.agents.launches[0];
  const specPath = launch?.env.BB_NEW_TICKET_INPUT as string;
  expect(specPath).toMatch(/bakers-new-ticket-.*\.json$/);
  expect(JSON.parse(readFileSync(specPath, 'utf8'))).toMatchObject({
    project: 'bakers',
    is_new: true,
    title: 'Direct',
    description: 'Body',
  });
  await d.quit();
});

it('D7: Ctrl+S standing ON the direct row fires the direct row, not the agent', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  // Description → parent → assignee → reviewers → conductor → labels →
  // workflow → template → agent → direct. Standing on the cheap action, the
  // save key must not launch an agent.
  for (let i = 0; i < 9; i += 1) await d.press('\x1b[B');
  await d.press('\x13');

  expect(d.agents.launches).toEqual([]);
  expect(d.client.creates).toHaveLength(1);
  await d.quit();
});

it('D7: Enter on the agent row hands it to the agent', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  for (let i = 0; i < 8; i += 1) await d.press('\x1b[B');
  await d.press('\r');

  expect(d.agents.launches).toHaveLength(1);
  expect(d.client.creates).toEqual([]);
  await d.quit();
});

it('D7: Enter on the direct row writes the ticket itself', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await fill(d);
  for (let i = 0; i < 9; i += 1) await d.press('\x1b[B');
  await d.press('\r');

  expect(d.agents.launches).toEqual([]);
  expect(d.client.creates).toHaveLength(1);
  await d.quit();
});

// ---- AC-8 / D8: the two refusals --------------------------------------------

it('AC-8: a rejected create is reported, the typed text survives, nothing partial', async () => {
  const d = await openForm(
    { route: PROJECT_ROUTE },
    {
      rows: rows(),
      createError: new Error('422 title: This value should not be null.'),
    },
  );
  await fill(d);
  await d.press('\x04');

  // The popup is still open, with the text still in it. Both values are read
  // off their own field rows: the transcript version of this assertion was
  // answered by the characters ECHOED as they were typed, so it held whether or
  // not the rejection had preserved anything.
  expect(d.frame()).toContain('[ Create directly ]');
  const rendered = d.tui.rows();
  expect(fieldValue(rendered, 'Title')).toBe('Direct');
  expect(fieldValue(rendered, 'Description')).toBe('Body');
  expect(d.frame()).toMatch(/422 title/);
  // Exactly one attempt, and no second one.
  expect(d.client.creates).toHaveLength(1);
  await d.quit();
});

it('D6: a stale server error is cleared the moment a field changes', async () => {
  // The message is drawn ABOVE the form, so a rejection that outlives the edit
  // it complained about describes a form that no longer exists — the operator
  // fixes the title and is still told the title is wrong.
  const d = await openForm(
    { route: PROJECT_ROUTE },
    {
      rows: rows(),
      createError: new Error('422 title: This value should not be null.'),
    },
  );
  await fill(d);
  await d.press('\x04');
  expect(d.frame()).toMatch(/422 title/);

  await d.press('!'); // one more character into the Description

  expect(d.frame()).not.toMatch(/422 title/);
  await d.quit();
});

it('D8: with no project in scope the popup offers a Project field — refuses until one is picked, then carries it through both submit paths and re-scopes the Conductor bag', async () => {
  // BB-664 AC-8 — replaces the old refusal-only form. `route: undefined` is
  // the Dashboard; `project: undefined` ALSO clears the harness's own
  // `tui.project` default ('bakers') — without it this case would be testing the
  // ambient fallback, not a genuine absence of scope (the mislabelling this
  // case corrects: the old version of this test left `tui.project: 'bakers'`
  // standing, so the agent row it claimed to exercise with "no project in
  // scope" was actually carried by that very fallback).
  const d = await openForm(
    { route: undefined, project: undefined, debounce: immediate },
    {
      rows: rows(),
      documents: {
        'bb_project/bb_project': {
          data: [
            {
              id: PROJECT_B,
              type: 'bb_project--bb_project',
              attributes: { name: 'atlas' },
            },
          ],
        },
      },
    },
  );

  // The popup opens on the new Project field, ahead of Title — and with none
  // picked, the Conductor ring offers nothing (the same precondition the
  // server enforces: no project, no conductor assignment).
  expect(d.frame()).toContain('▸ Project:');
  expect(d.frame()).toContain('Conductor: < — none — >');

  // Refusal without a pick, for BOTH rows (AC-8's "still a precondition").
  await d.press('\x1b[B'); // off Project, onto Title
  await fill(d);
  await d.press('\x04');
  expect(d.client.creates).toEqual([]);
  expect(d.frame()).toMatch(/no project selected/i);
  await d.press('\x13');
  expect(d.agents.launches).toEqual([]);
  expect(d.frame()).toMatch(/no project selected/i);

  // Back up to the Project field and pick one (active field is Description,
  // after `fill`).
  for (let i = 0; i < downToNoProject('description'); i++)
    await d.press('\x1b[A');
  await d.press('a');
  await d.press('t'); // 2 characters clears the AC-3 gate
  await d.press('\r'); // Enter picks the suggestion under the cursor

  // The pick re-scoped the Conductor bag: it was empty, and the field itself
  // CLEARED (BB-664 AC-8: a conductor from no project is stale under any
  // project), but the ring now offers the project's own conductor.
  expect(d.frame()).toContain('Conductor: < — none — >');
  for (
    let i = 0;
    i < downToNoProject('conductor') - downToNoProject('project');
    i++
  )
    await d.press('\x1b[B');
  await d.press('\x1b[C'); // → cycles onto the newly scoped candidate
  expect(d.frame()).toContain('Conductor: < cw-framework >');

  // The direct path carries the picked project's uuid.
  for (
    let i = 0;
    i < downToNoProject('direct') - downToNoProject('conductor');
    i++
  )
    await d.press('\x1b[B');
  await d.press('\r');
  expect(d.client.creates).toHaveLength(1);
  expect(d.client.creates[0]?.body.relationships?.project_id).toEqual({
    data: { type: 'bb_project--bb_project', id: PROJECT_B },
  });
  await d.quit();
});

it('D8: the agent row carries the SAME picked project into its spec', async () => {
  const d = await openForm(
    { route: undefined, project: undefined, debounce: immediate },
    {
      rows: rows(),
      documents: {
        'bb_project/bb_project': {
          data: [
            {
              id: PROJECT_B,
              type: 'bb_project--bb_project',
              attributes: { name: 'atlas' },
            },
          ],
        },
      },
    },
  );
  await d.press('a');
  await d.press('t');
  await d.press('\r'); // pick

  for (let i = 0; i < downToNoProject('title'); i++) await d.press('\x1b[B');
  await fill(d);
  for (
    let i = 0;
    i < downToNoProject('submit') - downToNoProject('description');
    i++
  )
    await d.press('\x1b[B');
  await d.press('\r');

  expect(d.agents.launches).toHaveLength(1);
  const specPath = d.agents.launches[0]?.env.BB_NEW_TICKET_INPUT as string;
  expect(JSON.parse(readFileSync(specPath, 'utf8'))).toMatchObject({
    project: 'atlas',
  });
  await d.quit();
});

it('D8: a slow conductor read for an earlier-picked project cannot overwrite a later pick`s candidates', async () => {
  // The guard in `rescopeConductor` (create-ticket-form.ts): after
  // `await source.load('')` resolves, it compares the form's CURRENT picked
  // project against the projectId the load was for, and discards a mismatch.
  // Reproduced here by gating project A's conductor read open while B is
  // picked and resolves first — exactly the race the guard exists for.
  const CONDA = 'bbbbbbbb-0000-0000-0000-000000000002';
  const PROJECT_A = 'dddddddd-0000-0000-0000-000000000003';
  let releaseA = () => {};
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const condA = toResource({
    id: CONDA,
    type: 'bb_conductor--bb_conductor',
    attributes: { label: 'alpha-cond' },
  });
  const condB = toResource({
    id: COND,
    type: 'bb_conductor--bb_conductor',
    attributes: { label: 'cw-framework' },
  });
  const base = fakeClient({
    rows: rows(),
    documents: {
      'bb_project/bb_project': {
        data: [
          {
            id: PROJECT_A,
            type: 'bb_project--bb_project',
            attributes: { name: 'apex' },
          },
          {
            id: PROJECT_B,
            type: 'bb_project--bb_project',
            attributes: { name: 'atlas' },
          },
        ],
      },
    },
  });
  const client = {
    ...base,
    collection: (type: string) => {
      if (resolveCollectionPath(type) !== 'bb_conductor/bb_conductor') {
        return base.collection(type);
      }
      let filtered: unknown;
      const c = {
        where: (path: string, _op: string, value: unknown) => {
          if (path === 'project_id.id') filtered = value;
          return c;
        },
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () => {
          if (filtered === PROJECT_A) {
            await gateA;
            return [condA];
          }
          if (filtered === PROJECT_B) return [condB];
          return [];
        },
      };
      return c;
    },
  };
  const agents = fakeAgents();
  const tui = await bootTui({
    services: { client, baseUrl: 'https://x.test' },
    tui: {
      agents: agents.host,
      cwd: '/repo',
      route: undefined,
      project: undefined,
      debounce: immediate,
    },
  });
  const press = (key: string): Promise<void> => tui.press(key);
  const frame = (): string => plain(tui.frame());
  await press('n');

  // Pick project A — its conductor read starts and stays pending (gated).
  await press('a');
  await press('p');
  await press('\r');
  expect(frame()).toContain('Project: apex');

  // Clear it and pick project B instead — its conductor read resolves right
  // away, ahead of A's. The field is not `clearable`, so Backspace edits the
  // still-standing "ap" query text rather than wiping the pick in one key —
  // both characters have to go before "at" types cleanly.
  await press('\x7f');
  await press('\x7f');
  await press('a');
  await press('t');
  await press('\r');
  expect(frame()).toContain('Project: atlas');

  // Now let A's stale read land. The guard must discard it.
  releaseA();
  await settle();
  await tui.renderOnce();

  for (
    let i = 0;
    i < downToNoProject('conductor') - downToNoProject('project');
    i++
  )
    await press('\x1b[B');
  await press('\x1b[C');
  // Only B's conductor is on offer — A's late answer never replaced the bag.
  expect(frame()).toContain('Conductor: < cw-framework >');
  expect(frame()).not.toContain('alpha-cond');

  await press('\x1b');
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
});

it('D8: a picked project scopes Parent too, and editing the pick drops the conductor', async () => {
  const d = await openForm(
    { route: undefined, project: undefined, debounce: immediate },
    {
      rows: rows(),
      documents: {
        'bb_project/bb_project': {
          data: [
            {
              id: PROJECT_B,
              type: 'bb_project--bb_project',
              attributes: { name: 'atlas' },
            },
          ],
        },
      },
    },
  );
  const NO_PARENT_SOURCE = 'open a project to pick a parent';
  expect(d.frame()).toContain(NO_PARENT_SOURCE);

  await d.press('a');
  await d.press('t');
  await d.press('\r');
  // Parent now searches the picked project instead of declaring no context.
  expect(d.frame()).not.toContain(NO_PARENT_SOURCE);

  const toConductor = downToNoProject('conductor') - downToNoProject('project');
  for (let i = 0; i < toConductor; i++) await d.press('\x1b[B');
  await d.press('\x1b[C');
  expect(d.frame()).toContain('Conductor: < cw-framework >');

  // Typing into the Project field drops the pick, and the conductor with it.
  for (let i = 0; i < toConductor; i++) await d.press('\x1b[A');
  await d.press('x');
  expect(d.frame()).toContain('Conductor: < — none — >');
  expect(d.frame()).toContain(NO_PARENT_SOURCE);
  await d.quit();
});

it('D1: an EMPTY title is refused here, not by the server a round trip later', async () => {
  // `bb_ticket.title` is `setRequired(TRUE)`, so an empty title is a 422 that
  // the operator waits for. The precondition is checked the same way the missing
  // project is: a message in the popup, nothing written, the typed text left
  // standing.
  const d = await openForm({ route: PROJECT_ROUTE });
  await d.press('\x1b[B'); // → Description, leaving Title empty
  for (const c of 'Body') await d.press(c);
  await d.press('\x04');

  expect(d.client.creates).toEqual([]);
  expect(d.agents.launches).toEqual([]);
  expect(d.frame()).toMatch(/title is required/i);
  // The description survived the refusal — asserted on the Description field's
  // own value row, and the Title's row is checked too: `<empty>` is what the
  // widget draws for a field holding nothing, so this also states that the
  // refusal did not quietly fill the title in.
  const rendered = d.tui.rows();
  expect(fieldValue(rendered, 'Description')).toBe('Body');
  expect(fieldValue(rendered, 'Title')).toBe('<empty>');
  expect(d.frame()).toContain('[ Create directly ]');
  await d.quit();
});

it('D1: a title of nothing but blanks is refused too', async () => {
  const d = await openForm({ route: PROJECT_ROUTE });
  await d.press(' ');
  await d.press(' ');
  await d.press('\x04');

  expect(d.client.creates).toEqual([]);
  expect(d.frame()).toMatch(/title is required/i);
  await d.quit();
});

it('D1: the agent row does NOT require a title — it writes no ticket', async () => {
  // The refusal belongs to the path that POSTs. The agent resolves and writes
  // the ticket itself, so nothing here may narrow what it accepts (AC-6).
  const d = await openForm({ route: PROJECT_ROUTE });
  await d.press('\x1b[B');
  for (const c of 'Body') await d.press(c);
  await d.press('\x13');

  expect(d.agents.launches).toHaveLength(1);
  await d.quit();
});

// ---- AC-7: the list refreshes ------------------------------------------------

/**
 * How many times the TICKET LIST was read.
 *
 * Counting every `bb_ticket/bb_ticket` request would be a false positive:
 * opening the popup reads that same collection for the PARENT candidates, so
 * the count rises whether or not the list ever reloaded. The list query is the
 * one that sideloads (`include=parent_id,conductor_id`); the parent query
 * builds with `includes: false` precisely because a sparse fieldset strips
 * those relationships. That is the discriminator used here.
 */
const listReads = (requests: { path: string; params: unknown }[]): number =>
  requests.filter(
    (r) =>
      r.path.startsWith('bb_ticket/bb_ticket') &&
      queryStringOf(r.params).includes('include='),
  ).length;

it('AC-7: a direct create returns to the list and reloads it', async () => {
  const d = await openTicketsList();
  await d.press('n');
  await fill(d);
  // The popup is on screen right now, which is what makes the denial further
  // down a statement about the close rather than about a string that was never
  // drawn (BB-326: against the transcript the negative could only ever be
  // read as "…and it has scrolled away", which is not the same claim).
  expect(d.frame()).toContain('[ Create directly ]');
  // Measured with the popup already OPEN and filled, so no read the popup makes
  // for itself can be mistaken for the reload this case is about.
  const before = listReads(d.client.requests);

  await d.press('\x04');

  // The popup is gone…
  expect(d.frame()).not.toContain('[ Create directly ]');
  // …and the list re-read the collection rather than showing a stale page.
  expect(listReads(d.client.requests)).toBeGreaterThan(before);
  await d.quit();
});
