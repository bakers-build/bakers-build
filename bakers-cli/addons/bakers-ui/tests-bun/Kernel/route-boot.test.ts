import { afterEach, describe, expect, it } from 'bun:test';
import type { RGBA } from '@opentui/core';
import { SEPARATOR_ROWS, TAB_BAR_ID } from '../../src/Kernel/chrome.js';
import { runTicketTui } from '../../src/Kernel/tui-kernel.js';
import { THEME_SLOTS } from '../../src/lib/theme.js';
import { displayWidth } from '../../src/lib/width.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
} from '../../src/types.js';
import {
  chromeRowCount,
  chromeRowOf,
  chromeShape,
} from '../../tests/chrome-rows.js';
import { topTabBar } from '../../tests/tab-bars.js';
import { includedProjects } from '../fixtures/included-projects.js';
// BB-326 — the TTY half of this file boots the OpenTUI test renderer through
// `tests-bun/tui-harness.ts`; the fake `FakeInput`/`FakeOutput` pair it used to
// import from `tests/Kernel/tui-harness.ts` is deleted with the swap. The one
// exception is the NON-TTY branch, which has no renderer at all — see
// `NonTtyOutput` below.
import { type BootedTui, bootTui, settle } from '../tui-harness.js';

// BB-223 AC-3/AC-4/AC-7 — the kernel BOOTS the resolved route instead of the
// dashboard. Non-TTY is the honest test surface here: spec Decision 11 makes the
// non-TTY branch follow the route too (so `bakers ui BB-223 | cat` cannot
// silently print the wrong thing), which is exactly what makes the whole
// deep-link boot exercisable without a terminal.

const TICKET = 'ffffffff-0000-0000-0000-000000000001';
const PROJECT = 'ffffffff-0000-0000-0000-000000000002';

const ticketDoc = {
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-223',
      title: 'bakers ui deep links',
      state: 'coding',
      derived_status: 'running',
      since_label: '3h',
      assignee_name: 'Christian Wiedemann',
      claim_machine: 'cw-framework',
      workflow: 'bb_work',
      description: 'The deep-link description body.',
    },
    relationships: { runs: { data: [{ id: 'r1' }, { id: 'r2' }] } },
  },
  // BB-255: ONE sideloaded run, so the `run:` route has something to render.
  // The comment on `ticketWithCommentsDoc` below still holds — no COMMENT include
  // here, which is what the BB-223 assertions depend on.
  included: [
    {
      id: 'r1',
      type: 'bb_run--bb_run',
      attributes: {
        drupal_internal__id: 901,
        state: 'running',
        state_at_start: 'coding',
        agent: 'claude',
        started_at: '2026-07-21T15:00:00+00:00',
        log_bytes: 42,
      },
      relationships: { ticket_id: { data: { id: TICKET } } },
    },
  ],
};

// BB-240 — a SECOND, comment-bearing ticket document. The shared `ticketDoc`
// above keeps `included: []` on purpose: the BB-223 assertions read it, and
// adding comments there would perturb them (spec R5).
const TICKET_WITH_COMMENTS = 'ffffffff-0000-0000-0000-000000000003';

// Ascending `created`, exactly the order the control plane sends
// (`CommentsItemList`: `created ASC, id ASC`). The TUI must invert it. Each body
// has TWO lines: line 1 is the collapsed header's preview, line 2 is visible
// only while the entry is expanded — so a caret and a body are separable.
const ticketWithCommentsDoc = {
  data: {
    id: TICKET_WITH_COMMENTS,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-240',
      title: 'comments newest first',
      state: 'coding',
      derived_status: 'running',
      description: 'The commented ticket description.',
    },
    relationships: { runs: { data: [] } },
  },
  included: [
    {
      id: 'cccccccc-0000-0000-0000-000000000001',
      type: 'bb_comment--bb_comment',
      attributes: {
        bb_comment_type: 'qualification',
        author_name: 'cw',
        created: '2026-07-20T10:00:00+00:00',
        drupal_internal__id: 1137,
        body: { value: 'OLDEST-PREVIEW\nOLDEST-BODY-DETAIL' },
      },
    },
    {
      id: 'cccccccc-0000-0000-0000-000000000002',
      type: 'bb_comment--bb_comment',
      attributes: {
        bb_comment_type: 'spec',
        author_name: 'cw',
        created: '2026-07-21T10:00:00+00:00',
        drupal_internal__id: 1138,
        body: { value: 'NEWEST-PREVIEW\nNEWEST-BODY-DETAIL' },
      },
    },
  ],
};

const conductorDoc = {
  data: [
    {
      id: 'c1',
      type: 'bb_conductor--bb_conductor',
      attributes: { status: 'running', last_seen: new Date().toISOString() },
      relationships: { project_id: { data: { id: PROJECT } } },
    },
  ],
  included: [
    {
      id: PROJECT,
      type: 'bb_project--bb_project',
      attributes: { name: 'bakers' },
    },
  ],
};

const ticketListDoc = {
  data: [
    {
      id: TICKET,
      type: 'bb_ticket--bb_ticket',
      attributes: {
        identifier: 'BB-223',
        title: 'bakers ui deep links',
        state: 'coding',
        derived_status: 'running',
      },
      relationships: { labels: { data: [] } },
    },
  ],
};

const projectListDoc = {
  data: [
    {
      id: PROJECT,
      type: 'bb_project--bb_project',
      attributes: { name: 'bakers', key: 'bakers.build' },
      relationships: { group_id: { data: null }, teams: { data: [] } },
    },
  ],
  included: [],
};

// BB-241 — the click tests need bigger worlds than the BB-223/240 fixtures
// above (≥3 tickets, several dashboard projects, agent rows, run rows, a
// scrollable ticket). They are NEW, SEPARATE documents swapped in per boot via
// `fakeServices(overrides)`: the shared `ticketDoc`/`ticketListDoc`/
// `conductorDoc` shapes stay byte-identical, because the BB-223 and BB-240
// assertions read them (the same reason BB-240 added a second document rather
// than growing the first).

/** Three tickets, each with its own detail document, for the click tests. */
const CLICK_TICKETS = [
  { id: 'ffffffff-0000-0000-0000-000000000301', identifier: 'BB-301' },
  { id: 'ffffffff-0000-0000-0000-000000000302', identifier: 'BB-302' },
  { id: 'ffffffff-0000-0000-0000-000000000303', identifier: 'BB-303' },
];

const listRow = (id: string, identifier: string) => ({
  id,
  type: 'bb_ticket--bb_ticket',
  attributes: {
    identifier,
    title: `${identifier} row`,
    state: 'coding',
    derived_status: 'running',
  },
  relationships: { labels: { data: [] } },
});

const clickTicketListDoc = {
  data: CLICK_TICKETS.map((t) => listRow(t.id, t.identifier)),
};

/** The detail document a clicked ticket row opens — one marker per ticket. */
const clickTicketDetailDoc = (identifier: string) => ({
  data: {
    id: identifier,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier,
      title: 'clicked open',
      state: 'coding',
      description: `DETAIL-OF-${identifier}`,
    },
    relationships: { runs: { data: [] } },
  },
  included: [],
});

/** 40 tickets — more rows than the 31-row body window, so the list scrolls. */
const longTicketListDoc = {
  data: Array.from({ length: 40 }, (_, i) =>
    listRow(
      `ffffffff-0000-0000-0000-0000000005${String(i).padStart(2, '0')}`,
      `BB-5${String(i).padStart(2, '0')}`,
    ),
  ),
};

const emptyTicketListDoc = { data: [] };

/** Three distinct dashboard projects (one live conductor each). */
const PICKED_PROJECTS = ['proj-one', 'proj-two', 'proj-three'];
const manyConductorsDoc = {
  data: PICKED_PROJECTS.map((_name, i) => ({
    id: `cond-${i}`,
    type: 'bb_conductor--bb_conductor',
    attributes: { status: 'running', last_seen: new Date().toISOString() },
    relationships: { project_id: { data: { id: `proj-${i}` } } },
  })),
  included: PICKED_PROJECTS.map((name, i) => ({
    id: `proj-${i}`,
    type: 'bb_project--bb_project',
    attributes: { name },
  })),
};

/** Three runs, distinguishable by their `#<drupalId>` RUN column. */
const runListDoc = {
  data: [901, 902, 903].map((drupalId, i) => ({
    id: `run-${i}`,
    type: 'bb_run--bb_run',
    attributes: {
      drupal_internal__id: drupalId,
      state: 'running',
      state_at_start: 'coding',
      agent: 'claude',
      started_at: new Date().toISOString(),
    },
    relationships: { ticket_id: { data: { id: CLICK_TICKETS[i]?.id ?? '' } } },
  })),
  included: CLICK_TICKETS.map((t) => ({
    id: t.id,
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier: t.identifier },
  })),
};

/** A ticket whose Overview tab is far longer than the body window. */
const TICKET_LONG = 'ffffffff-0000-0000-0000-000000000004';
const longTicketDoc = {
  data: {
    id: TICKET_LONG,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-241',
      title: 'a long scrollable detail',
      state: 'coding',
      derived_status: 'running',
      description: Array.from(
        { length: 45 },
        (_, i) => `DESCLINE-${String(i).padStart(2, '0')}`,
      ).join('\n'),
    },
    relationships: { runs: { data: [] } },
  },
  included: [],
};

/** Which world a boot reads — everything defaults to the BB-223 fixtures. */
interface ServiceOverrides {
  tickets?: unknown;
  conductors?: unknown;
  runs?: unknown;
  /**
   * The uuid `user/user` resolves the account to. Defaults to a fixed uuid,
   * because My work resolves the account on EVERY root boot — most tests
   * here must not fail resolving an account they never asked about. `null` simulates the one
   * case a test does ask about: the account genuinely not found.
   */
  currentUserId?: string | null;
  /**
   * BB-326 — a gate the TICKET DETAIL read waits on before it answers.
   *
   * Added for one test: `never draws the dashboard, not even as the loading
   * frame`. The fake output accumulated every byte, so that case could ask the
   * whole transcript whether a dashboard had EVER been drawn. `frame()` is the
   * current screen, so the only way to keep the loading-frame half is to make
   * the loading frame the current one — i.e. hold the read open and look while
   * it is in flight. Unset everywhere else, so no other fixture moves.
   */
  hold?: Promise<void>;
}

/** Routes every read the kernel can make, recording which ones it made. */
function fakeServices(
  overrides: ServiceOverrides = {},
): RendererServices & { paths: string[] } {
  const paths: string[] = [];
  const collection = (type: string): Collection => {
    const c: Collection = {
      where: () => c,
      whereIn: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () =>
        type === 'bb_project'
          ? includedProjects(overrides.conductors ?? conductorDoc)
          : [],
    };
    return c;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      paths.push(path);
      if (path === 'user/user') {
        if (overrides.currentUserId === null) return { data: [] };
        return { data: [{ id: overrides.currentUserId ?? 'u-current' }] };
      }
      if (path.startsWith('bb_conductor/'))
        return overrides.conductors ?? conductorDoc;
      if (path === 'bb_project/bb_project') return projectListDoc;
      if (path.startsWith('bb_run/')) return overrides.runs ?? { data: [] };
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET_WITH_COMMENTS}`))
        return ticketWithCommentsDoc;
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET_LONG}`))
        return longTicketDoc;
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) {
        if (overrides.hold) await overrides.hold;
        return ticketDoc;
      }
      const clicked = CLICK_TICKETS.find((t) =>
        path.startsWith(`bb_ticket/bb_ticket/${t.id}`),
      );
      if (clicked) return clickTicketDetailDoc(clicked.identifier);
      if (path === 'bb_ticket/bb_ticket')
        return overrides.tickets ?? ticketListDoc;
      return { data: [] };
    },
  };
  return {
    client,
    paths,
    baseUrl: 'https://bakers.example',
    currentUser: 'cw',
  };
}

/**
 * BB-326 — THE ONE FAKE STDOUT THAT SURVIVES THE HARNESS DELETION.
 *
 * `tests/Kernel/tui-harness.ts` and its `FakeInput`/`FakeOutput` go with the
 * swap, because every INTERACTIVE test now drives an OpenTUI renderer instead
 * of a stream of bytes. The NON-TTY branch is the exception the swap did not
 * touch: it has no renderer, it writes plain lines to `process.stdout`, and it
 * is selected by
 *
 *     options.renderer !== undefined || Boolean(input.isTTY && output.isTTY)
 *
 * — so injecting a renderer here would push these tests into the interactive
 * branch and destroy exactly what they test. It therefore still needs a stdout
 * to capture, and it is the ONLY thing in this file that does, which is why the
 * fake is local rather than shared.
 */
class NonTtyOutput {
  isTTY = false;
  rows = 40;
  columns = 120;
  chunks: string[] = [];
  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}

/** The non-TTY branch reads nothing off stdin but `isTTY`. */
const NON_TTY_INPUT = { isTTY: false };

const realStdin = process.stdin;
const realStdout = process.stdout;

function replaceNonTtyStreams(output: NonTtyOutput): void {
  Object.defineProperty(process, 'stdin', {
    value: NON_TTY_INPUT,
    configurable: true,
  });
  Object.defineProperty(process, 'stdout', {
    value: output,
    configurable: true,
  });
}

function restoreStreams(): void {
  Object.defineProperty(process, 'stdin', {
    value: realStdin,
    configurable: true,
  });
  Object.defineProperty(process, 'stdout', {
    value: realStdout,
    configurable: true,
  });
}

// Belt and braces: `bootNonTty` restores in its own `finally`, but a throw
// anywhere else in a case must not leave the next one writing into a fake.
afterEach(restoreStreams);

/** Boot the kernel in the NON-TTY branch and return everything it printed. */
async function bootNonTty(
  route?: ResolvedRoute,
  overrides: ServiceOverrides = {},
): Promise<{
  text: string;
  paths: string[];
  /** Everything written to stderr — where a failure must go (spec D13). */
  errText: string;
  /** `process.exitCode` after the run, so a script's view is measurable. */
  exitCode: number | string | null | undefined;
}> {
  const output = new NonTtyOutput();
  replaceNonTtyStreams(output);
  const errChunks: string[] = [];
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    errChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  const previousExitCode = process.exitCode;
  // BB-326 — `0`, not `undefined`, and it is not cosmetic. BUN IGNORES
  // `process.exitCode = undefined` and keeps whatever was there (Node resets
  // it; probed on both). Under vitest each test file is a worker, so a leaked
  // exit code never reached the runner. `bun test` is ONE process: the D13
  // cases below deliberately set `process.exitCode = 1`, and without a restore
  // that actually lands, the whole suite ends `0 fail` and exits 1 — a phantom
  // failure with nothing on screen to explain it.
  process.exitCode = 0;
  const services = fakeServices(overrides);
  let exitCode: number | string | null | undefined;
  try {
    await runTicketTui({}, {}, services, {
      ...(route ? { route } : {}),
    });
  } finally {
    exitCode = process.exitCode;
    // `?? 0` for the same reason as above: handing `undefined` back is a no-op
    // on Bun and would leave this test's own exit code set for the rest of the
    // run.
    process.exitCode = previousExitCode ?? 0;
    process.stderr.write = realStderrWrite;
    restoreStreams();
  }
  return {
    text: output.text,
    paths: services.paths,
    errText: errChunks.join(''),
    exitCode,
  };
}

// BB-256 spec D13 — the non-TTY branch FOLLOWS the TTY. Its rule was already
// "print the screen this invocation would have opened" (BB-223 Decision 11);
// this is that existing decision applied to a new default screen.
describe('kernel boot — no route prints My work', () => {
  it('prints the current user’s open tickets', async () => {
    const { text, paths, exitCode } = await bootNonTty(undefined, {
      currentUserId: 'u-cw',
    });

    expect(paths).toContain('user/user');
    expect(paths).toContain('bb_ticket/bb_ticket');
    expect(text).toContain('My work');
    expect(text).toContain('BB-223');
    expect(text).toContain('bakers ui deep links');
    expect(exitCode ?? 0).toBe(0);
  });

  it('prints the empty current-work state when the user has no open tickets', async () => {
    const { text, exitCode } = await bootNonTty(undefined, {
      tickets: { data: [] },
    });
    expect(text).toContain('No open tickets.');
    expect(exitCode ?? 0).toBe(0);
  });
});

describe('kernel boot — a ticket route (AC-3)', () => {
  it("prints the ticket's detail and never loads the dashboard", async () => {
    const { text, paths } = await bootNonTty({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
    });
    expect(text).toContain('The deep-link description body.');
    expect(paths.some((p) => p.startsWith('bb_conductor/'))).toBe(false);
    expect(paths.some((p) => p.includes(TICKET))).toBe(true);
  });

  it('prints the compact block for --view teaser (AC-7)', async () => {
    const { text } = await bootNonTty({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'teaser',
    });
    expect(text).toContain('BB-223 · bakers ui deep links');
    expect(text).toContain('Christian Wiedemann');
    // The compact block replaces the tabbed detail; no section flattening.
    expect(text).not.toContain('The deep-link description body.');
  });

  it('prints the board_card field set for --view board_card (AC-7)', async () => {
    const { text } = await bootNonTty({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'board_card',
    });
    expect(text).toContain('bb_work');
    expect(text).not.toContain('Christian Wiedemann');
  });
});

describe('kernel boot — a run route (AC-3, Decision 2)', () => {
  // BB-255 D7 re-authored this. BB-223 Decision 2 made `run:<uuid>` mean "the
  // owning ticket's detail with the Runs tab active", because there was no run
  // screen to land on; now there is, so the route lands ON THE RUN and the ticket
  // sits underneath it (one Esc away). The piped branch follows — leaving it on the
  // ticket would make `bakers ui run:<uuid>` mean two different things depending on
  // whether stdout is a terminal, which is the drift Decision 11 exists to prevent.
  //
  // What Decision 2 really guaranteed — the ticket IS read, and it is that run's
  // ticket — is still asserted, and is what makes the Esc landing possible.
  it("prints the run's own fields, having read its owning ticket", async () => {
    const { text, paths } = await bootNonTty({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
      tab: 'runs',
      runId: 'r1',
    });
    expect(paths.some((p) => p.includes(TICKET))).toBe(true);
    expect(text, 'the run, by its internal id').toContain('#901');
    expect(text, 'and its own captured log').toContain('Captured (42 bytes)');
    expect(text, 'the owning ticket is named on the run block').toContain(
      'BB-223',
    );
    expect(text, 'but the ticket body is not what was asked for').not.toContain(
      'The deep-link description body.',
    );
  });
});

describe('kernel boot — a project route (AC-3)', () => {
  // A project route lands on that project's current-work surface, and the
  // non-TTY branch follows it.
  it("prints that project's own screen, never the projects overview", async () => {
    const { text, paths } = await bootNonTty({
      screen: 'project',
      projectId: PROJECT,
      projectName: 'bakers',
    });
    expect(text).toContain('bakers · overview');
    expect(text).toContain('Current work');
    expect(paths.some((p) => p.startsWith('bb_conductor/'))).toBe(false);
  });
});

describe('kernel boot — a ticket route with a TTY (AC-3)', () => {
  it('never draws the dashboard, not even as the loading frame', async () => {
    // The loading frame is drawn BEFORE the ticket read resolves. If it still
    // said `screen === 'dashboard'` the user would watch an empty "bakers.build
    // projects / No projects." skeleton flash on every deep link — measured in
    // a real pty before this was fixed.
    //
    // BB-326 — RE-AIMED, NOT WEAKENED. The old form asked the whole write
    // transcript whether a dashboard had EVER appeared, which is the one thing
    // a current-screen `frame()` cannot answer. So the loading frame is made
    // the CURRENT frame instead: `hold` keeps the ticket read in flight while
    // the assertion runs, and the read is released afterwards to check the
    // loaded frame. That is a narrower window than "the whole transcript" — it
    // covers the loading frame and the loaded one, not every intermediate
    // repaint — but it is the frame the defect actually showed on, and it is
    // asserted directly rather than inferred from bytes.
    let release = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tui = await bootTty(
      { screen: 'ticket', ticketId: TICKET, view: 'full' },
      { hold },
    );

    // Positive first, so the two negatives below cannot pass on an empty or
    // not-yet-painted screen: the frame under examination really is the ticket
    // route's loading frame.
    expect(frameOf(tui), 'the loading frame IS painted').toContain(
      'Loading ticket…',
    );
    expect(
      frameOf(tui),
      'the LOADING frame is not the dashboard',
    ).not.toContain('bakers.build projects');
    expect(frameOf(tui)).not.toContain('No projects.');

    release();
    await settle();
    await tui.renderOnce();
    expect(frameOf(tui), 'and the loaded frame is the ticket').toContain(
      'BB-223',
    );

    await quit(tui);
  });
});

describe('kernel boot — a picker route (AC-8, Decision 14)', () => {
  const CANDIDATES = [
    { id: PROJECT, name: 'shop-de' },
    { id: 'ffffffff-0000-0000-0000-000000000009', name: 'shop-at' },
  ];

  it('non-TTY prints the candidates plus the direct-command hint, no dashboard', async () => {
    const { text, paths } = await bootNonTty({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: CANDIDATES,
    });
    expect(text).toContain('host/keytec/shop');
    expect(text).toContain('shop-de');
    expect(text).toContain('shop-at');
    expect(text).toContain('bakers ui project:<name>');
    expect(paths.some((p) => p.startsWith('bb_conductor/'))).toBe(false);
  });

  it('with a TTY it draws the picker instead of the dashboard', async () => {
    const tui = await bootTty({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: CANDIDATES,
    });
    expect(frameOf(tui)).toContain('shop-de');
    expect(frameOf(tui)).toContain('shop-at');
    expect(tui.services.paths.some((p) => p.startsWith('bb_conductor/'))).toBe(
      false,
    );

    await quit(tui);
  });

  it('Enter on the selected candidate opens that project', async () => {
    const tui = await bootTty({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: CANDIDATES,
    });

    await tui.press('j'); // select the second candidate
    await tui.press('\r');

    // The picked candidate takes the same path as a resolved project route.
    expect(tui.services.paths).toContain('bb_project/bb_project');
    expect(frameOf(tui)).toContain('bakers · overview');

    await quit(tui);
  });
});

describe('a deep-linked screen is not a dead end (Decision 7)', () => {
  it('Esc with an empty back history opens root My work', async () => {
    const tui = await bootTty({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
    });
    // Booted straight into the ticket, so nothing pushed a history frame and
    // no project params exist. Escape therefore converges on the safe root
    // landing rather than constructing an unscoped project screen.
    expect(frameOf(tui)).toContain('[Overview]');

    // A LONE Escape is the prefix of every CSI sequence, so OpenTUI's parser
    // holds it for its disambiguation window before deciding it stands alone —
    // which is what `press`'s 40 ms wait is sized for.
    await tui.press('\x1b');
    expect(frameOf(tui)).toContain('[My work]');
    expect(frameOf(tui)).toContain('My work');

    await quit(tui);
  });
});

// BB-240 — the Comments tab lists comments newest-first and opens with the
// newest one expanded. Driven through the REAL kernel: `runTicketTui` over the
// OpenTUI test renderer, real keystrokes through `mockInput`, and the CURRENT
// SCREEN read back out of the render buffer — the same layer a human sees.

/**
 * The frame indexes of the comment header rows — the only rows with a caret.
 *
 * BB-326 splits the old `caretRows` in two, because the highlight is no
 * longer IN the row: `styleVisibleLines`' `ANSI.inverse` is an attribute on the
 * cells now, and `captureSpans().lines` is indexed by frame row. So the text
 * assertions keep reading rows, and the selection assertions read the same
 * index out of the span capture ({@link caretRowIsSelected}).
 */
const caretRowIndexes = (tui: BootedTui): number[] =>
  rowsOf(tui).flatMap((row, index) =>
    row.includes('▾') || row.includes('▸') ? [index] : [],
  );

/** The comment header rows of the current frame — the only rows with a caret. */
const _caretRows = (tui: BootedTui): string[] => {
  const rows = rowsOf(tui);
  return caretRowIndexes(tui).map((index) => rows[index] ?? '');
};

/** Is the nth comment header the highlighted one? (R2 — the SELECTION.) */
const _caretRowIsSelected = (tui: BootedTui, nth: number): boolean => {
  const index = caretRowIndexes(tui)[nth];
  if (index === undefined) return false;
  return hasActiveSelection(tui.captureSpans().lines[index]);
};

/** Boot the comment-bearing ticket with a TTY, then Tab to the Comments tab. */
async function bootCommentsTab(): Promise<Tty> {
  const tui = await bootTty({
    screen: 'ticket',
    ticketId: TICKET_WITH_COMMENTS,
    view: 'full',
  });
  // A ticket route boots on Overview; History is two tabs away (Planning, then History).
  await tui.press('\t');
  await tui.press('\t');
  return tui;
}

const typeRowIndex = (tui: BootedTui, type: string): number =>
  rowsOf(tui).findIndex((row) => row.includes(type));

describe('BB-240 — comments newest first, newest expanded', () => {
  it('the Comments tab opens with the newest comment expanded and the older one collapsed', async () => {
    const tui = await bootCommentsTab();

    expect(frameOf(tui), 'the History tab is active').toContain('[History]');
    expect(frameOf(tui)).toContain('spec');
    expect(frameOf(tui)).toContain('qualification');
    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');
    expect(frameOf(tui)).not.toContain('OLDEST-BODY-DETAIL');

    await quit(tui);
  });

  it('selection starts on the newest comment', async () => {
    const tui = await bootCommentsTab();

    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');
    await tui.press('\r');
    expect(frameOf(tui), 'Enter acts on the newest entry').not.toContain(
      'NEWEST-BODY-DETAIL',
    );

    await quit(tui);
  });

  it('Enter collapses the default-expanded newest comment and Enter again re-expands it', async () => {
    const tui = await bootCommentsTab();

    await tui.press('\r');
    expect(frameOf(tui)).not.toContain('NEWEST-BODY-DETAIL');

    await tui.press('\r');
    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');

    await quit(tui);
  });

  it('Enter on an older comment expands it independently of the newest', async () => {
    const tui = await bootCommentsTab();

    await tui.press('j');
    await tui.press('\r');

    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');
    expect(frameOf(tui)).toContain('OLDEST-BODY-DETAIL');

    await quit(tui);
  });

  it('the non-TTY render lists comments newest first', async () => {
    // AC-8 — `detailLines` through its real caller (`tui-kernel.ts:147`), i.e.
    // what `bakers ui BB-240 | cat` prints.
    const { text } = await bootNonTty({
      screen: 'ticket',
      ticketId: TICKET_WITH_COMMENTS,
      view: 'full',
    });
    const newest = text.indexOf('NEWEST-PREVIEW');
    const oldest = text.indexOf('OLDEST-PREVIEW');
    expect(newest, 'the newest comment is printed').toBeGreaterThan(-1);
    expect(oldest, 'the oldest comment is printed').toBeGreaterThan(-1);
    expect(newest).toBeLessThan(oldest);
  });
});

// BB-241 — mouse support: SGR reporting, wheel scrolling and click-to-select,
// driven through the REAL kernel (spec fact 11).
//
// BB-326 — WHO PARSES THE REPORTS. They used to arrive on the same `data`
// listener that carried keys, and `lib/mouse.ts` split them off; that file is
// deleted. OpenTUI decodes the reports itself and hands the kernel a typed
// `MouseEvent`, so the gestures below go through `mockMouse` — which emits the
// very same SGR bytes into the renderer's stdin, i.e. still exactly the path a
// terminal drives, one layer lower.

/**
 * An SGR mouse report: `\x1b[<b;col;rowM` on press, `…m` on release.
 *
 * `mockMouse` covers every ordinary gesture; this is kept for the few cases
 * that must put a report and a KEY in the SAME chunk, which no mouse helper can
 * express (the quit-ladder block at the end of this file).
 */
const sgr = (button: number, col: number, row: number, press = true): string =>
  `\x1b[<${button};${col};${row}${press ? 'M' : 'm'}`;

/**
 * One PHYSICAL left click on a 1-based terminal row: press AND release, as a
 * real terminal sends them — so every click test also covers spec R2.
 *
 * COORDINATES. `row`/`col` stay the 1-BASED terminal coordinates the SGR report
 * carried; `mockMouse` takes 0-based BUFFER coordinates, so the shift happens
 * here and here only. BB-340 Task 11 left the kernel no matching `+ 1`: a
 * click lands on the node the renderer's own hit test finds, so what these cases
 * pin is that the node under a terminal row is the row's own.
 * A click landing one row off selects the NEIGHBOURING entry, which reads as an
 * ordinary assertion failure, so the mapping is proved rather than assumed: the
 * three-row sweep in `a click on a ticket row selects that ticket` pins each
 * terminal row to its own ticket, and would fail on any constant shift.
 */
const click = async (tui: BootedTui, row: number, col = 12): Promise<void> => {
  await tui.mockMouse.click(col - 1, row - 1);
  await settle();
  await tui.renderOnce();
};

/**
 * Reach a project-level tab from the project screen by KEY.
 *
 * BB-239 removed the `a` / `u` letter shortcuts, so `Tab` is the keyboard route
 * — one keystroke per step of the registry order, which BB-256 extended to
 * `overview → tickets → runs`. A project route LANDS on
 * `overview`.
 * The settle per step (inside `press`) is load-bearing, not decoration:
 * `handleKey` returns early while `loading` is true, so a second keystroke sent
 * before the first target has arrived is DROPPED, not queued, and the walk would
 * silently measure the wrong transition.
 */
const tabTo = async (tui: BootedTui, steps: number): Promise<void> => {
  for (let i = 0; i < steps; i += 1) await tui.press('\t');
};

/**
 * The SGR button number for a wheel-down notch.
 *
 * `WHEEL_UP`/`WHEEL_DOWN` are gone from the {@link wheel} helper — `scroll`
 * takes the DECODED direction — but the raw number is still needed by the one
 * test that hand-builds a report inside a larger chunk.
 */
const WHEEL_DOWN = 65;

/**
 * `times` wheel notches over the body.
 *
 * MEASURED CAVEAT — a batch is not N DISCRETE notches. Reports emitted
 * back-to-back without a pump between them are coalesced before they reach the
 * kernel: 5 in a row moved the viewport by one line, and 200 in a row by two.
 * A single notch (the default, and what `scrolls by one line and back` asserts)
 * is exact; anything that needs to travel a known distance must pump between
 * notches, and anything that needs to travel to the END uses
 * {@link scrollToEnd} rather than a large `times`.
 */
const wheel = async (
  tui: BootedTui,
  direction: 'up' | 'down',
  times = 1,
): Promise<void> => {
  // Buffer (0-based) row inside the body — BB-375's second separator pushed the
  // ticket body to index 8, so the old row 7 is chrome and the ScrollBox ignores it.
  const bodyY = Math.max(0, bodyBounds(rowsOf(tui)).first);
  for (let i = 0; i < times; i += 1)
    await tui.mockMouse.scroll(0, bodyY, direction);
  await settle();
  await tui.renderOnce();
};

/**
 * Wheel down until the viewport stops moving — i.e. it is at `maxOffset`.
 *
 * The vitest original spun 200 notches and took "far more than the body has
 * rows" to mean "at the bottom". With the coalescing above that number no
 * longer maps to a distance, so the END is found by OBSERVING it instead: keep
 * scrolling while the body still changes. That is the same destination, reached
 * by measurement rather than by a magic constant.
 */
const scrollToEnd = async (tui: BootedTui): Promise<void> => {
  let previous = '';
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = bodyRows(tui).join('\n');
    if (rows === previous) return;
    previous = rows;
    await wheel(tui, 'down', 5);
  }
  throw new Error('the viewport never stopped scrolling');
};

/**
 * The first body row, 1-based, on a screen that DRAWS a top-tab bar
 * (SEPARATOR_ROWS = 0 — body flush under the bar).
 *
 * Derived from {@link chromeShape} rather than a literal, so SEPARATOR_ROWS
 * changes move this with the composition. Ticket-detail cases use
 * {@link FIRST_BODY_ROW_TICKET} (one row taller for the state row).
 */
const FIRST_BODY_ROW = chromeRowCount(chromeShape(2, true)) + 1;

/**
 * Top border of `ticket-detail-frame` before the first content row
 * (BB-375 — detail body shares the list table FRAME language).
 */
/** Top border row of the framed panel before content (BB-375). */
const TICKET_DETAIL_FRAME_TOP = 1;

/**
 * The first CONTENT body row, 1-based, on the TICKET DETAIL screen: two box
 * frames, three box content rows (title, labels, state — BB-369 D1), the bar
 * row (SEPARATOR_ROWS = 0), then `ticket-detail-frame`'s top border.
 *
 * Derived from the shape rather than written down, for the reason the sibling
 * above records at length: a hand-written row number on this screen has rotted
 * once already.
 */
const _FIRST_BODY_ROW_TICKET =
  chromeRowCount(chromeShape(2, true)) + 1 + TICKET_DETAIL_FRAME_TOP;

/**
 * The drawn rows of the CURRENT screen — the blank tail dropped.
 *
 * BB-326 replaces `frame(output)`, which was the write transcript sliced at
 * its last clear-screen. Two things follow from the swap. The render buffer is
 * always the full terminal, so the frame ends in as many empty rows as the
 * composition left unused, and the assertions below index either from the TOP
 * (rows 4/5, the bar and the separator) or from the END (`at(-1)` is the status
 * bar) — so the tail is dropped rather than reasoned about at each site. And
 * nothing that has scrolled away can answer a `toContain` any more: the frame
 * is what is on screen when the question is asked.
 */
const rowsOf = (tui: BootedTui): string[] => {
  const rows = tui.rows();
  return rows.slice(0, rows.findLastIndex((row) => row !== '') + 1);
};

/** The drawn rows as one string — the old `frame(output)`, current-screen. */
const frameOf = (tui: BootedTui): string => rowsOf(tui).join('\n');

/**
 * The whole frame INCLUDING its styling, for the `toBe(before)` comparisons.
 *
 * The transcript carried the SGR escapes inline, so `frame(output)` equality
 * compared text AND styling. Plain characters would not: the selection
 * highlight is an attribute, so a click that moved the selection and repainted
 * would compare EQUAL as text — making every "this click is inert" assertion in
 * this file vacuous. `captureSpans()` carries the attributes, so the comparison
 * keeps the strength it had.
 */
const styledFrame = (tui: BootedTui): string =>
  JSON.stringify(tui.captureSpans());

const hasActiveSelection = (
  line:
    | { spans: { text: string; attributes: number; fg?: RGBA }[] }
    | undefined,
): boolean =>
  (line?.spans ?? []).some(
    (span) =>
      span.fg?.intent === 'indexed' &&
      span.fg.slot === THEME_SLOTS.foregroundActive,
  );

/** The rendered top tab bar — terminal row 5, i.e. index 4. */
const tabBarRow = (tui: BootedTui): string =>
  rowsOf(tui)[TOP_TAB_ROW - 1] ?? '';

/**
 * Where the body of the current frame begins and ends.
 *
 * BB-239 derives the boundary from the FRAME instead of from a fixed row: the
 * separator blanks are the only empty rows in the chrome (`fitLine` pads every
 * body row). BB-375 draws ONE of them, so this skips the whole blank run.
 *
 * The end excludes the pinned footer. Footer action/basics chips use FOREGROUND_ACTIVE fg
 * (BB-375); if they stayed inside the body window, {@link selectedRow} would
 * report `n:New │ e:Edit` instead of the highlighted table row.
 */
const bodyBounds = (rows: string[]): { first: number; end: number } => {
  // Body starts after the tab bar and SEPARATOR_ROWS blank(s).
  const bar = rows.findIndex(
    (row) =>
      row.includes('[') &&
      (row.includes('My work') ||
        row.includes('Tickets') ||
        row.includes('Projects') ||
        row.includes('Overview') ||
        row.includes('Conductors')),
  );
  let first =
    bar >= 0 ? bar + 1 + SEPARATOR_ROWS : chromeRowCount(chromeShape(2, true));
  // BB-375 — region-body ScrollBox frame is fixed; content starts under ╭.
  if ((rows[first] ?? '').includes('╭')) first += 1;
  // Kernel basics always name quit; walk up through actions above the status.
  let end = rows.length - 1;
  const basics = rows.findLastIndex(
    (row) => row.includes('q:quit') || row.includes('Esc:back'),
  );
  if (basics >= first) {
    let top = basics;
    if (top > first && (rows[top - 1] ?? '').trim() !== '') top -= 1; // actions
    end = top;
  }
  // Drop fixed ScrollBox bottom border.
  if (end > first && (rows[end - 1] ?? '').includes('╰')) end -= 1;
  return { first, end: Math.max(first, end) };
};

/**
 * BB-375 — rounded filter chips above the tickets table (border top + label +
 * border bottom per chip row). Count/page live in chrome header meta.
 *
 * TWO chip rows, not one, since BB-416's `o owner` trigger joined
 * `/ search`, `s state`, `w who`, `m mine`, `p parent` and `closed: hidden` on
 * the first row: at the fixture's 120-column width that fills it, and
 * `c clear` wraps onto a row of its own — measured directly off the rendered
 * frame rather than assumed.
 */
const TICKETS_FILTER_ROWS = 6;
/**
 * Viewport ScrollBox top border on screen (BB-375). {@link bodyBounds} skips
 * it for content slices; click helpers still count the physical row.
 */
const TICKETS_TABLE_FRAME_TOP = 1;

/**
 * Runs screen renders a single chip (`x closed`); one chip row × three visual
 * lines = 3 rows. Reuses {@link TICKETS_TABLE_FRAME_TOP} for the frame border.
 *
 * Kept separate from {@link TICKETS_FILTER_ROWS} so the tickets chip wrap does
 * not shift the runs table header.
 */

/** 1-based terminal row of the tickets table header (`IDENTIFIER …`). */
const TICKETS_TABLE_HEADER_ROW =
  FIRST_BODY_ROW + TICKETS_FILTER_ROWS + TICKETS_TABLE_FRAME_TOP;

/** The body rows of the current frame — chrome above, the status bar below. */
const bodyRows = (tui: BootedTui): string[] => {
  const rows = rowsOf(tui);
  const { first, end } = bodyBounds(rows);
  return rows.slice(first, end);
};

/** The status bar: the last row of the frame. */
const statusBar = (tui: BootedTui): string => rowsOf(tui).at(-1) ?? '';

/**
 * The highlighted body row. Selection is FOREGROUND_ACTIVE fg (BB-375) — asserting
 * through it tests the SELECTION rather than the styling (spec R8).
 *
 * Read out of `captureSpans()`, whose `lines` are indexed by the same frame row
 * index `rows()` uses. Search stays inside the BODY so chrome FOREGROUND_ACTIVE (active
 * tab) and footer key chips do not match. Active filter badges also use
 * FOREGROUND_ACTIVE fg (BB-375 A′), so this takes the LAST FOREGROUND_ACTIVE run in the body — the
 * table row sits below the strip.
 */
const selectedRow = (tui: BootedTui): string => {
  const rows = rowsOf(tui);
  const { first, end } = bodyBounds(rows);
  const lines = tui.captureSpans().lines;
  let hit = '';
  for (let index = first; index < end; index += 1) {
    if (hasActiveSelection(lines[index])) hit = rows[index] ?? '';
  }
  return hit;
};

/** Frame top border + table header — the projects frame-only list. */
const LIST_TABLE_HEADER_ROW = FIRST_BODY_ROW + TICKETS_TABLE_FRAME_TOP;
/**
 * Runs: filter + frame top + header (count/page are header meta).
 *
 * The runs screen's own filter bar carries no `o owner` trigger — that one is
 * the TICKETS screen's alone (BB-416) — so it still fits its chips on ONE
 * row and keeps the three-row count {@link TICKETS_FILTER_ROWS} left behind.
 */
const RUNS_FILTER_ROWS = 3;
const RUNS_TABLE_HEADER_ROW =
  FIRST_BODY_ROW + RUNS_FILTER_ROWS + TICKETS_TABLE_FRAME_TOP;

interface Tty extends BootedTui {
  readonly services: RendererServices & { paths: string[] };
  /**
   * How many times the kernel has asked the renderer to paint.
   *
   * The replacement for `output.chunks.length`. The fake output counted WRITES,
   * so "nothing redrew" could be asserted directly; a cell renderer diffs and
   * has no write count, and comparing frames only proves the pixels match — a
   * redraw producing the same pixels would pass. `draw()` ends in
   * `renderer.requestRender()`, so counting that call is the same claim at the
   * kernel's own boundary. ONE draw is MANY requests (each row renderable it
   * replaces asks too), so only the difference between zero and non-zero is
   * meaningful — which is exactly what these assertions ask.
   */
  paints(): number;
}

/** Boot the kernel over the OpenTUI test renderer and let the first frame settle. */
async function bootTty(
  route?: ResolvedRoute,
  overrides: ServiceOverrides = {},
  columns?: number,
): Promise<Tty> {
  const services = fakeServices(overrides);
  const tui = await bootTui({
    services,
    tui: { ...(route ? { route } : {}) },
    // 120 was the fake output's default width, and the narrow-terminal cases
    // pass their own — so an explicit column count has to survive the swap.
    ...(columns === undefined ? {} : { columns }),
  });
  const renderer = tui.renderer as unknown as { requestRender: () => void };
  const requestRender = renderer.requestRender.bind(renderer);
  let painted = 0;
  renderer.requestRender = (): void => {
    painted += 1;
    requestRender();
  };
  return { ...tui, services, paints: () => painted };
}

/**
 * The New-ticket popup's active field value, read off its own value row.
 *
 * The caret `▸` marks the active label and the value is drawn on the row below
 * it, inside the popup's `│` borders. An empty text field renders the
 * placeholder `<empty>` (`Widget/text.ts`), so THAT is what an untouched field
 * reads as here — and reading it off this one row is what distinguishes it from
 * any other empty field's identical placeholder elsewhere in the frame.
 */
const activeFieldValue = (tui: BootedTui): string => {
  const rows = rowsOf(tui);
  const label = rows.findIndex((row) => /▸ \w+:/.test(row));
  if (label === -1) return '';
  return (rows[label + 1] ?? '').replace(/[│\s]/g, '');
};

/** Quit the way a user does, and wait for the kernel to wind itself up. */
async function quit(tui: BootedTui): Promise<void> {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

// BOTH landing screens are one Tab away from where these tests found them: no
// route lands on root My work rather than the projects overview, and a project
// route lands on that project's Overview rather than its ticket list (spec D12). The two helpers below carry that single Tab, so each
// test keeps measuring the screen it was written for instead of restating the
// navigation change two dozen times.

/** Boot with no route and land on the PROJECTS OVERVIEW (one Tab from root). */
async function bootProjects(
  overrides: ServiceOverrides = {},
  columns?: number,
): Promise<Tty> {
  const tty = await bootTty(undefined, overrides, columns);
  await tabTo(tty, 1);
  return tty;
}

/** Boot a project route and land on its TICKET LIST (one Tab from its Overview). */
async function bootProjectTickets(
  overrides: ServiceOverrides = {},
  columns?: number,
): Promise<Tty> {
  const tty = await bootTty(PROJECT_ROUTE, overrides, columns);
  await tabTo(tty, 1);
  return tty;
}

const PROJECT_ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'bakers',
};

const PICK_CANDIDATES = [
  { id: 'pick-id-1', name: 'pick-one' },
  { id: 'pick-id-2', name: 'pick-two' },
  { id: 'pick-id-3', name: 'pick-three' },
];

// BB-326 — THE MODE-SET BYTES ARE NO LONGER THE KERNEL'S, AND THIS BLOCK SAYS
// SO RATHER THAN PRETENDING OTHERWISE.
//
// All four cases here used to read raw bytes out of the write transcript:
// `?1000h`/`?1006h` on start, `?1000l`/`?1006l`/`?25h` on exit, and the absence
// of `?1002h`/`?1003h` throughout. `@opentui/core` now owns every one of them —
// it emits the enables from the kernel's `useMouse: true` and takes them back in
// `renderer.destroy()` — and under an INJECTED test renderer they are never
// written anywhere this suite can see. Asserting them here is not possible, so
// each case is re-aimed at the half that IS still the kernel's, with the loss
// named at the site. Nothing is dropped: what a case can no longer prove, it
// says.
describe('BB-241 — mouse reporting is enabled and disabled (AC-1, AC-2, AC-9)', () => {
  it('mouse input is wired and routed', async () => {
    // WHAT MOVED: the `?1000h`/`?1006h` bytes are `@opentui/core`'s, emitted
    // from the kernel's `useMouse: true`, and an injected test renderer writes
    // them nowhere observable — so the BYTE-LEVEL half of AC-1/AC-2 is no
    // longer asserted by this suite. What is still the kernel's, and is what
    // those bytes existed FOR, is that a decoded report reaches the row it
    // landed on and moves the selection. That is asserted directly.
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });

    await click(tui, TICKETS_TABLE_HEADER_ROW + 1 + 1);
    expect(selectedRow(tui), 'the clicked row is the selected one').toContain(
      'BB-302',
    );

    await quit(tui);
  });

  it('a wheel notch and a click are both handled (AC-9)', async () => {
    // AC-9 is about `?1002h`/`?1003h`: motion tracking is what breaks the
    // terminal's own text selection. WHOSE PROPERTY IT IS NOW: the kernel asks
    // for `useMouse: true` and nothing else, so whether those modes are set is
    // `@opentui/core`'s decision, not this kernel's — and this suite cannot
    // observe it through an injected renderer. THIS IS A REAL REDUCTION in what
    // the file proves; it is recorded rather than papered over.
    //
    // What remains, and is asserted, is that the two gestures the cockpit does
    // need — a notch and a click — are handled without motion reports, i.e. no
    // drag/move event is required for either to work.
    const tui = await bootProjectTickets({ tickets: longTicketListDoc });
    const firstRow = bodyRows(tui)[0];

    await wheel(tui, 'down');
    expect(bodyRows(tui)[0], 'the notch scrolled the window').not.toBe(
      firstRow,
    );

    await click(tui, TICKETS_TABLE_HEADER_ROW + 1);
    expect(selectedRow(tui), 'and the click selected a row').not.toBe('');
    expect(statusBar(tui)).not.toContain('Error:');

    await quit(tui);
  });

  it('quitting winds the kernel up', async () => {
    // The disable bytes are `renderer.destroy()`'s job now, and the kernel does
    // not destroy a renderer it did not make — so `?1006l`/`?1000l`/`?25h`, and
    // the reverse ORDER this case used to pin, are out of reach here. What is
    // still the kernel's is the ladder itself: `q` runs `finish()`, which is
    // what the disables used to hang off. `running` resolving IS that.
    const tui = await bootTty();

    tui.mockInput.pressKey('q');
    await tui.running;

    // …and `finish()` really tore the screen down rather than merely resolving:
    // every row renderable is removed, so nothing of the TUI is left painted.
    await tui.renderOnce();
    expect(frameOf(tui), 'the screen is given back').toBe('');

    await tui.stop();
  });

  it('Ctrl+C winds the kernel up too', async () => {
    // Same loss as above for the disable bytes. Ctrl+C additionally proves the
    // kernel's own `exitOnCtrlC: false` did not kill the process out from under
    // the ladder — the ladder ran and `finish()` resolved.
    //
    // NOTHING IS READ OFF THE RENDERER AFTERWARDS, and `stop()` is not called.
    // `tests-bun/tui-harness.ts` builds the test renderer with OpenTUI's own
    // default `exitOnCtrlC`, so the renderer destroys ITSELF on the next tick
    // after this key; touching it after that segfaults the process (measured).
    // The harness is not this file's to change.
    const tui = await bootTty();

    tui.mockInput.pressKey('\x03');
    // Raced rather than bare-awaited, so a ladder that never reaches `finish()`
    // fails with a statement instead of running out the case's timeout.
    const outcome = await Promise.race([
      tui.running.then(() => 'wound up' as const),
      new Promise<'still running'>((resolve) =>
        setTimeout(() => resolve('still running'), 1_000),
      ),
    ]);
    expect(outcome, 'the Ctrl+C ladder ran to finish()').toBe('wound up');
    await settle();
  });
});

describe('BB-241 — the wheel scrolls the viewport (AC-3)', () => {
  it('wheel-down scrolls the body by one line and wheel-up scrolls back', async () => {
    const tui = await bootTty(
      {
        screen: 'ticket',
        ticketId: TICKET_LONG,
        view: 'full',
      },
      {},
      80,
    );
    // Description starts expanded so the long fixture overflows immediately.
    const before = bodyRows(tui);
    // BB-375 — bodyRows is content inside the fixed viewport frame.
    expect(
      before.slice(0, 2).join('\n'),
      'the Overview tab starts on its first section',
    ).toContain('Description');
    expect(
      before.join('\n'),
      'and the expanded body overflows the window',
    ).toContain('DESCLINE-00');

    await wheel(tui, 'down');
    expect(bodyRows(tui)[0], 'advanced by exactly one line').toBe(before[1]);

    await wheel(tui, 'up');
    expect(bodyRows(tui)[0], 'and back').toBe(before[0]);

    await quit(tui);
  });

  it('wheel-up at the top and wheel-down at the bottom are clamped', async () => {
    const tui = await bootTty(
      {
        screen: 'ticket',
        ticketId: TICKET_LONG,
        view: 'full',
      },
      {},
      80,
    );
    const top = bodyRows(tui);

    // At offset 0 no notch can move the viewport up, however many arrive.
    await wheel(tui, 'up', 20);
    expect(bodyRows(tui), 'clamped at offset 0').toEqual(top);

    await scrollToEnd(tui);
    const bottom = bodyRows(tui);
    expect(bottom[0], 'it did scroll').not.toBe(top[0]);

    await wheel(tui, 'down', 5);
    expect(bodyRows(tui), 'clamped at maxOffset').toEqual(bottom);
    expect(statusBar(tui)).not.toContain('Error:');

    await quit(tui);
  });

  it('the wheel scrolls on a list screen without moving the selection', async () => {
    const tui = await bootProjectTickets({ tickets: longTicketListDoc });
    expect(bodyRows(tui).some((r) => r.includes('IDENTIFIER'))).toBe(true);
    expect(selectedRow(tui)).toContain('BB-500');

    await wheel(tui, 'down');
    expect(bodyRows(tui)[0], 'the window moved').not.toContain('IDENTIFIER');
    expect(selectedRow(tui), 'the selection did not').toContain('BB-500');

    await quit(tui);
  });
});

describe('BB-241 — a left click selects the row it landed on (AC-4)', () => {
  it('a click on a ticket row selects that ticket — the header row is not off by one', async () => {
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    // Descending: the boot selects ticket 0, and a click on the ALREADY-selected
    // row activates instead of selecting (that is AC-5's own test).
    //
    // BB-326: this sweep is also what PROVES the 1-based → 0-based shift in
    // `click`. Three distinct terminal rows are pinned to three distinct
    // tickets, so a mapping that is off by one in either direction fails here
    // — and the fix is the helper, never the expected row.
    for (const n of [2, 1, 0]) {
      const row = TICKETS_TABLE_HEADER_ROW + 1 + n;
      await click(tui, row);
      expect(selectedRow(tui), `terminal row ${row} is ticket ${n}`).toContain(
        CLICK_TICKETS[n]?.identifier ?? '',
      );
    }

    await quit(tui);
  });

  it('a click selects the right entry on the projects overview', async () => {
    // BB-345 D6 — THE `+ 1` IS NEW, AND IT IS THE HEADER ROW.
    //
    // This case used to be named "(no header row)" and mapped project n to
    // `FIRST_BODY_ROW + n`, because the projects overview was the one list drawn
    // without one. It has one now (an operator decision), so it maps exactly as
    // the ticket case above it does — which is the point of the change rather
    // than a concession to it: two lists, one renderer, one offset.
    //
    // The assertion is NOT weakened. It still pins three distinct terminal rows
    // to three distinct projects in descending order, so a click map that is off
    // by one in EITHER direction still fails here; only the row the header
    // occupies has moved, and if the header were absent this expectation would
    // fail just as loudly as the old one does now.
    const tui = await bootProjects({ conductors: manyConductorsDoc });
    for (const n of [2, 1, 0]) {
      // BB-375 A′ — frame top + header before data rows.
      const row = LIST_TABLE_HEADER_ROW + 1 + n;
      await click(tui, row);
      expect(selectedRow(tui), `row ${row}`).toContain(
        PICKED_PROJECTS[n] ?? '',
      );
    }

    await quit(tui);
  });

  it('a click selects the right entry on project-runs', async () => {
    const runsTui = await bootTty(PROJECT_ROUTE, {
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    await tabTo(runsTui, 2);
    expect(frameOf(runsTui)).toContain('RUN');
    await click(runsTui, RUNS_TABLE_HEADER_ROW + 1 + 2);
    expect(selectedRow(runsTui)).toContain('#903');

    await quit(runsTui);
  });

  it('a click selects the right candidate in the project picker (two heading rows)', async () => {
    const tui = await bootTty({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: PICK_CANDIDATES,
    });
    // Modal box content: heading/gap then candidates (no list-table header).
    // pick-one is FIRST_BODY_ROW + 1; pick-two is the next row.
    await click(tui, FIRST_BODY_ROW + 2);
    expect(selectedRow(tui)).toContain('pick-two');

    await quit(tui);
  });

  it('a click on a comment header selects that comment; a click on its body is inert', async () => {
    const tui = await bootCommentsTab();
    const oldest = typeRowIndex(tui, 'qualification');
    expect(oldest).toBeGreaterThan(-1);
    await click(tui, oldest + 1);
    expect(frameOf(tui)).toContain('OLDEST-BODY-DETAIL');
    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');

    const before = styledFrame(tui);
    const body = rowsOf(tui).findIndex((row) =>
      row.includes('NEWEST-BODY-DETAIL'),
    );
    expect(body).toBeGreaterThan(-1);
    await click(tui, body + 1);
    expect(styledFrame(tui), 'a body row selects nothing').toBe(before);

    await quit(tui);
  });
});

describe('BB-241 — a click on the selected row activates it (AC-5, R2)', () => {
  it('a click on the already-selected row opens it', async () => {
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    const row = TICKETS_TABLE_HEADER_ROW + 1 + 1; // ticket index 1

    await click(tui, row);
    expect(selectedRow(tui)).toContain('BB-302');

    await click(tui, row);
    expect(frameOf(tui), 'the clicked ticket opened').toContain(
      'DETAIL-OF-BB-302',
    );
    const byClick = styledFrame(tui);

    // AC-5 literally: "the same action Enter performs". Go back and press \r on
    // the same selection — the frame must be identical, styling included (the
    // transcript carried the escapes inline, so this comparison always covered
    // them).
    await tui.press('\x1b');
    await tui.press('\r');
    expect(styledFrame(tui), 'identical to the Enter path').toBe(byClick);

    await quit(tui);
  });

  it('one click fires the action exactly once', async () => {
    const tui = await bootCommentsTab();
    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');
    const newest = typeRowIndex(tui, 'spec');
    expect(newest).toBeGreaterThan(-1);
    await click(tui, newest + 1);
    expect(frameOf(tui)).not.toContain('NEWEST-BODY-DETAIL');

    await quit(tui);
  });
});

describe('BB-241 — non-rows are inert (AC-6)', () => {
  it('a click on chrome is inert', async () => {
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    const before = styledFrame(tui);
    const painted = tui.paints();
    const statusRow = rowsOf(tui).length; // 1-based last drawn row

    // 1 the top frame · 2 the title row · 4 the bottom frame · status bar.
    //
    // Rows 3 and 5 are NOT in this list. Row 5 is the tab bar, which Amendment
    // A's D12 made live, so it carries a control and is not inert chrome.
    // Row 3 is the header box's second content row (meta) — inert, but left out
    // of the loop for the BB-346 history below.
    //
    // BB-375 — SEPARATOR_ROWS = 0, so there is no blank chrome row under the
    // bar; row 6 is the filter-badge strip (live), not inert chrome.
    //
    // That inertness is MEASURED, not asserted in prose: a probe recorded
    // three legs: the
    // widened loop passing, the same loop FAILING once `chrome-header-1` is given
    // an `onMouse` (so a bare pass is not a pass by insensitivity), and the
    // shipped loop still passing under that same mutation (so the failure is
    // attributable to row 3 and to nothing else). Widening the loop for real
    // changes what this case asserts and is deliberately deferred to the next
    // kernel change; what this case asserts is that the rows it NAMES carry
    // nothing.
    for (const row of [1, 2, 4, statusRow]) await click(tui, row);

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints(), 'nothing redrew').toBe(painted);
    expect(statusBar(tui)).not.toContain('Error:');
    expect(selectedRow(tui)).toContain('BB-301');

    await quit(tui);
  });

  it('a click below the last entry is inert', async () => {
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, 30); // far below the last rendered body row

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints()).toBe(painted);
    expect(statusBar(tui)).not.toContain('Error:');

    await quit(tui);
  });

  it('a click on an empty list is inert', async () => {
    const tui = await bootProjectTickets({ tickets: emptyTicketListDoc });
    expect(frameOf(tui)).toContain('No tickets.');
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, TICKETS_TABLE_HEADER_ROW); // empty-table message under the filter

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints()).toBe(painted);
    expect(statusBar(tui)).not.toContain('Error:');

    await quit(tui);
  });
});

describe('BB-241 — a popup keeps owning input (AC-7)', () => {
  /** Project Overview → Tickets, then `p` opens the parent-filter popup. */
  const openPicker = async (): Promise<Tty> => {
    const tui = await bootTty(PROJECT_ROUTE, { tickets: clickTicketListDoc });
    await tui.press('\t');
    await tui.press('p');
    expect(frameOf(tui), 'the popup is open').toContain('Filter by parent');
    expect(activeFieldValue(tui), 'the query starts empty').toBe('search:');
    return tui;
  };

  it('the popup swallows mouse reports', async () => {
    const tui = await openPicker();
    const before = styledFrame(tui);
    const painted = tui.paints();

    await wheel(tui, 'down');
    await click(tui, FIRST_BODY_ROW + 1 + 2);

    expect(styledFrame(tui), 'nothing behind the popup moved').toBe(before);
    expect(tui.paints(), 'no redraw at all').toBe(painted);
    expect(activeFieldValue(tui), 'and nothing was typed into it').toBe(
      'search:',
    );

    // Esc first: while the popup is open it owns `q` too (it would be typed).
    await tui.press('\x1b');
    await quit(tui);
  });

  it('a truncated report never types into the popup query', async () => {
    // BB-326 — holding a partial CSI sequence is OpenTUI's parser's job; the
    // guarantee is that a torn mouse report is never typed into a form.
    const tui = await openPicker();
    const before = styledFrame(tui);
    const painted = tui.paints();

    // The report straddles a chunk boundary — a tokenizer that does not hold the
    // `\x1b[<` tail lands the second chunk (`M`) in the query as text.
    tui.mockInput.pressKey('\x1b[<0;12;9');
    await settle();
    await tui.renderOnce();
    tui.mockInput.pressKey('M');
    await settle();
    await tui.renderOnce();

    expect(activeFieldValue(tui), 'nothing was typed into the query').toBe(
      'search:',
    );
    expect(styledFrame(tui), 'the popup never redrew').toBe(before);
    expect(tui.paints(), 'not one paint request either').toBe(painted);

    // Esc first: while the popup is open it owns `q` too (it would be typed).
    await tui.press('\x1b');
    await quit(tui);
  });
});

describe('BB-241 — keyboard navigation is unchanged on every list screen (AC-8, R7)', () => {
  it('projects: j/k/g/G move the selection and Enter opens the project', async () => {
    const tui = await bootProjects({ conductors: manyConductorsDoc });
    expect(selectedRow(tui)).toContain('proj-one');

    await tui.press('j');
    expect(selectedRow(tui)).toContain('proj-two');
    await tui.press('G');
    expect(selectedRow(tui)).toContain('proj-three');
    await tui.press('k');
    expect(selectedRow(tui)).toContain('proj-two');
    await tui.press('g');
    expect(selectedRow(tui)).toContain('proj-one');

    await tui.press('\r');
    // Opening a project lands on its OVERVIEW.
    expect(frameOf(tui)).toContain('bakers · overview');

    await quit(tui);
  });

  it('project: j/k/g/G move the selection and Enter opens the ticket', async () => {
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    expect(selectedRow(tui)).toContain('BB-301');

    await tui.press('j');
    expect(selectedRow(tui)).toContain('BB-302');
    await tui.press('G');
    expect(selectedRow(tui)).toContain('BB-303');
    await tui.press('k');
    expect(selectedRow(tui)).toContain('BB-302');
    await tui.press('g');
    expect(selectedRow(tui)).toContain('BB-301');

    await tui.press('\r');
    expect(frameOf(tui)).toContain('DETAIL-OF-BB-301');

    await quit(tui);
  });

  it('project-runs: j/k/g/G move the selection and Enter opens the ticket', async () => {
    const tui = await bootProjectTickets({
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    await tabTo(tui, 1);
    expect(selectedRow(tui)).toContain('#901');

    await tui.press('j');
    expect(selectedRow(tui)).toContain('#902');
    await tui.press('G');
    expect(selectedRow(tui)).toContain('#903');
    await tui.press('g');
    expect(selectedRow(tui)).toContain('#901');

    await tui.press('\r');
    // Enter on a run opens its ticket on the RUNS tab (BB-192 AC-3), so the
    // Overview description is not on screen — the title bar is the evidence.
    expect(frameOf(tui)).toContain('BB-301 · clicked open');
    expect(frameOf(tui)).toContain('[Runs]');

    await quit(tui);
  });

  it('project-picker: j/k move the selection and Enter opens the candidate', async () => {
    const tui = await bootTty({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: PICK_CANDIDATES,
    });
    expect(selectedRow(tui)).toContain('pick-one');

    await tui.press('j');
    expect(selectedRow(tui)).toContain('pick-two');
    await tui.press('k');
    expect(selectedRow(tui)).toContain('pick-one');

    await tui.press('j');
    await tui.press('\r');
    // BB-256 D12: the picked candidate lands on that project's OVERVIEW.
    expect(frameOf(tui)).toContain('bakers · overview');

    await quit(tui);
  });

  it('Comments tab: the arrow keys move the selection and Enter toggles', async () => {
    const tui = await bootCommentsTab();
    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');
    expect(frameOf(tui)).not.toContain('OLDEST-BODY-DETAIL');

    await tui.press('\x1b[B');
    await tui.press('\r');
    expect(frameOf(tui)).toContain('OLDEST-BODY-DETAIL');
    expect(frameOf(tui)).toContain('NEWEST-BODY-DETAIL');

    await tui.press('\x1b[A');
    await tui.press('\r');
    expect(frameOf(tui)).not.toContain('NEWEST-BODY-DETAIL');
    expect(frameOf(tui)).toContain('OLDEST-BODY-DETAIL');

    await quit(tui);
  });

  it('Esc still goes back immediately', async () => {
    // On the project's TICKET LIST, one Tab in — so Esc has a frame to pop back
    // to (the project Overview) and the conductor collection is never read.
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    expect(frameOf(tui), 'on the ticket list').toContain('bakers · tickets');

    // A bare ESC with no second keystroke: spec D3 never holds it, and OpenTUI's
    // parser resolves the standalone Escape after its own disambiguation window
    // — which is what `press`'s wait is sized for.
    await tui.press('\x1b');
    expect(frameOf(tui), 'back happened on that one key').toContain(
      'bakers · overview',
    );

    await quit(tui);
  });
});

// BB-241 Amendment A (spec D12) — the tab bars are clickable. The columns
// below are computed by hand from the bars' own composition, deliberately NOT
// from the component that publishes the bar's pieces (`topTabParts`, and the
// `topTabSpans`/`detailTabSpans` column maps it replaced in BB-340 Task 11).
// Those are pinned against the rendered bar in their own component tests, so
// hardcoding here keeps this an INDEPENDENT check rather than a tautology.
//
//   row 5: ' ' + topTabBar(active) ⇒ in-bar offset = col - 2
//          the project bar is '[Overview]'(10) '  ' ' Tickets '(9) '  '
//          ' Runs '(6) ⇒ Overview cols 2..11 · Tickets cols 14..22 ·
//          Runs cols 25..30;
//          and the root bar is '[My work]'(9) '  ' ' Projects '(10) ⇒
//          Projects cols 13..22.
//   ticket level (BB-346): the same COMPOSITION, with
//          '[Overview]'(10) '  ' ' Comments '(10) '  ' ' Related '(9) '  ' ' Runs '(6)
//          ⇒ Overview 2..11 · Comments 14..23 · Related 26..34 · Runs 37..42
//          — but since BB-369 D1 put a state row in the box, one row LOWER
//          (row 6, see `TICKET_BAR_ROW`). The columns are unaffected: a header
//          row moves rows, not columns.
/** 1-based tab row on a two-content-row bar screen (gap above tabs, BB-375). */
const TOP_TAB_ROW = chromeRowOf(chromeShape(2, true), TAB_BAR_ID);
// BB-346 — the ticket screen's bar is the CHROME's bar row, like every other
// level's. It was the header box's third content row (terminal row 4), which is
// why this file used to carry a second row constant and a second column
// arithmetic.
//
// BB-369 D1 — the box has THREE content rows again (title, labels, state), so
// it closes at row 5, the bar is at row 6 and the separator at row 7: one row
// lower than every other bar screen's. The bar's COLUMNS are untouched by that —
// a header row moves rows, not columns — so the `COL_DETAIL_*` arithmetic below
// still reads as written. Every row here is found by the bar's own node id in the
// composed chrome rather than counted off the frames, which is why the shape is
// the only line that had to change: `chromeRowOf` is 1-based, like the terminal
// rows `click()` takes.
const TICKET_SHAPE = chromeShape(2, true);
const TICKET_BAR_ROW = chromeRowOf(TICKET_SHAPE, TAB_BAR_ID);
/** First body row (1-based) — framed top under the bar (SEPARATOR_ROWS = 0). */
const TICKET_BODY_ROW = chromeRowCount(TICKET_SHAPE) + 1;
// The project bar: Overview(1) Tickets(20) Runs(40) Conductors(50).
// Overview: cols 2–11 · Tickets: cols 14–22 · Runs: cols 25–30 ·
// Conductors: cols 33–44.
const COL_TOP_OVERVIEW = 6; // Overview column (first tab)
const COL_TOP_TICKETS = 18; // Tickets column
const COL_TOP_RUNS = 27; // Runs column
/** The root bar's second tab sits where the project bar's `Tickets` does. */
const COL_TOP_PROJECTS = 18;
/** Root bar: My work 2–10 · Projects 13–22 · Conductors 25–36. */
const COL_ROOT_MY_WORK = 6;
const COL_ROOT_CONDUCTORS = 30;
// BB-346 — the ticket bar's own columns. ` Comments ` is unchanged at 14..23
// (the old detail bar started one column further right and joined with one space
// instead of two, which cancelled exactly); ` Runs ` moved from 35..40 to 37..42.
// BB-516 removed Relationships, shrinking the bar to 44 columns; ` Runs ` is
// now at 39..44.
const COL_DETAIL_PLANNING = 18;
const COL_DETAIL_HISTORY = 30;
const COL_DETAIL_RUNS = 39;
/** The ticket bar is 41 columns wide (` Runs ` ends at column 41), so this is its last one. */
const COL_DETAIL_RUNS_LAST = 41;
/**
 * Past the last label on EITHER bar — the bar's own empty space. The root bar
 * is ~47 columns wide and the ticket bar is 41 after BB-516 removed the
 * Relationships tab; 60 is safely past both.
 */
const COL_BAR_EMPTY = 60;
/**
 * Past the last label on the PROJECT bar specifically, kept well clear of
 * `[Conductors]` (columns 33..44) should the bar grow again; the ticket-level
 * bar keeps using {@link COL_BAR_EMPTY}.
 */
const COL_PROJECT_BAR_EMPTY = 90;

describe('BB-241 — the top tab bar is clickable (AC-11)', () => {
  it('a click on a top tab switches to it', async () => {
    const tui = await bootTty(PROJECT_ROUTE, {
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });

    await click(tui, TOP_TAB_ROW, COL_TOP_RUNS);
    expect(frameOf(tui), 'the run table renders').toContain('#901');
    expect(frameOf(tui)).toContain('[Runs]');

    await click(tui, TOP_TAB_ROW, COL_TOP_TICKETS);
    expect(frameOf(tui), 'the ticket table renders').toContain(
      CLICK_TICKETS[0]?.identifier ?? '',
    );
    expect(frameOf(tui)).toContain('[Tickets]');

    await quit(tui);
  });

  // BB-239 re-authors the KEY half: the key that reaches Runs is `Tab`,
  // not `a` (AC-7 removed the letter shortcuts). What the test asserts is unchanged
  // and is exactly what matters — click and key converge on ONE code path, so they
  // cannot drift into two answers.
  it('a click on a top tab reaches the same state its key does', async () => {
    const clicked = await bootProjectTickets({
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    await click(clicked, TOP_TAB_ROW, COL_TOP_RUNS);
    // Styled, so the convergence covers the SELECTION as well as the text —
    // exactly what the transcript's inline escapes used to cover.
    const byClick = styledFrame(clicked);
    await quit(clicked);

    const keyed = await bootProjectTickets({
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    await tabTo(keyed, 1);
    expect(styledFrame(keyed), 'the click and `Tab` converge').toBe(byClick);

    await quit(keyed);
  });

  it('a click on the active top tab changes nothing', async () => {
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, TOP_TAB_ROW, COL_TOP_TICKETS);

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints(), 'not even a redraw').toBe(painted);

    await quit(tui);
  });

  it("a click on the top tab bar's empty space is inert", async () => {
    const tui = await bootTty(PROJECT_ROUTE, { tickets: clickTicketListDoc });
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, TOP_TAB_ROW, COL_PROJECT_BAR_EMPTY);

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints()).toBe(painted);
    expect(statusBar(tui)).not.toContain('Error:');

    await quit(tui);
  });
});

describe('BB-241 — the ticket bar is clickable (AC-12)', () => {
  it('a click on a ticket section activates it', async () => {
    const tui = await bootTty({
      screen: 'ticket',
      ticketId: TICKET_WITH_COMMENTS,
      view: 'full',
    });
    expect(frameOf(tui), 'a ticket route boots on Overview').toContain(
      '[Overview]',
    );

    await click(tui, TICKET_BAR_ROW, COL_DETAIL_HISTORY);
    expect(frameOf(tui)).toContain('[History]');
    expect(frameOf(tui)).toContain('NEWEST-PREVIEW');

    await click(tui, TICKET_BAR_ROW, COL_DETAIL_RUNS);
    expect(frameOf(tui)).toContain('[Runs]');

    await quit(tui);
  });

  it('a click on a ticket section reaches the same state Tab does', async () => {
    const clicked = await bootTty({
      screen: 'ticket',
      ticketId: TICKET_WITH_COMMENTS,
      view: 'full',
    });
    await click(clicked, TICKET_BAR_ROW, COL_DETAIL_HISTORY);
    const byClick = styledFrame(clicked);
    await quit(clicked);

    // `\t` from Overview lands on Comments too, and also resets offset and the
    // comment selection — the frame is the whole of that state.
    const keyed = await bootCommentsTab();
    expect(styledFrame(keyed), 'the click and `Tab` converge').toBe(byClick);

    await quit(keyed);
  });

  it("a click on the ticket bar's empty space is inert", async () => {
    const tui = await bootTty({
      screen: 'ticket',
      ticketId: TICKET_WITH_COMMENTS,
      view: 'full',
    });
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, TICKET_BAR_ROW, COL_BAR_EMPTY);

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints()).toBe(painted);

    await quit(tui);
  });

  it('the ticket bar is not clickable in a compact view', async () => {
    // AC-7 of BB-223: a non-`full` view has no tab bar at all —
    // `TicketDetailScreen.topTab()` returns null unless the view is `full`, so
    // the chrome composes no bar row. The click below is aimed at
    // `TICKET_BAR_ROW` anyway, which is the point: those are the coordinates
    // that DO switch a section in the `full` view, and here they must hit
    // nothing.
    //
    // WHY ROW `TICKET_BAR_ROW` HITS NOTHING HERE, restated because BB-369 D1
    // changed the reason and left the old one passing. That constant is 6 now (it
    // was 5), and the compact box grew the state row with it: its FOUR content rows
    // are title, labels, state and `view: <mode>`, so it spans terminal rows 1–6
    // and row 6 is its bottom BORDER — measured, not counted off the spec. In the
    // `full` view the box has three content rows, closes at row 5, and the chrome
    // draws the bar on row 6. So the same coordinates land on a border here and on
    // the bar there, which is a sharper accident than the old one: the two views
    // agree on the row NUMBER and disagree about what is drawn on it.
    const tui = await bootTty({
      screen: 'ticket',
      ticketId: TICKET_WITH_COMMENTS,
      view: 'teaser',
    });
    expect(frameOf(tui)).not.toContain('[Overview]');
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, TICKET_BAR_ROW, COL_DETAIL_PLANNING);

    expect(styledFrame(tui)).toBe(before);
    expect(tui.paints()).toBe(painted);

    await quit(tui);
  });
});

// ---------------------------------------------------------------------------
// BB-241 Amendment B — what the review's second pass found: a tab CLICK could
// reach three states its key binding cannot, and a frame could be painted after
// the terminal was already restored.
// ---------------------------------------------------------------------------

describe('a tab click cannot strand the TUI in search mode (AC-11)', () => {
  it('clicking a top tab leaves search-input mode, exactly as Enter does', async () => {
    // `handleMouse` reset `searchMode` only on the BODY path, and the tab
    // branches return before it. `gotoTopTab` never reset it either — so after
    // clicking a tab out of search mode the flag stayed true on a screen that
    // does not render the `search: …` prompt, and `handleKey`'s `if (searchMode)`
    // then swallowed EVERY printable key into the hidden ticket filter. Only
    // Enter/Esc recovered, and nothing on screen said why. The state is
    // unreachable from the keyboard (`a`/`t`/`u`/Tab are all swallowed while
    // typing), so the click invented it.
    //
    // BB-239 re-authors the RECOVERY PROBE only. AC-7 removed the letter
    // shortcuts, so the probe is `Tab`, which wraps `runs → conductors →
    // overview → tickets`. Same question — does the keyboard still work after
    // the click — asked with a key that exists.
    //
    // BB-256: on the project's TICKET LIST, which is where `/` is bound — a
    // project route lands on Overview, where it is not.
    const tui = await bootProjectTickets({
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });

    await tui.press('/');
    await tui.press('a');
    await tui.press('b');
    expect(frameOf(tui), 'search mode is on and shows its prompt').toContain(
      'search: ab',
    );

    await click(tui, TOP_TAB_ROW, COL_TOP_RUNS);
    expect(frameOf(tui), 'the run table renders').toContain('#901');

    // Three `Tab`s wrap Runs → Conductors → Overview → Tickets. If search mode
    // survived the click they are typed into the filter instead and nothing
    // moves.
    await tabTo(tui, 3);
    expect(frameOf(tui), 'the keyboard still works after the click').toContain(
      '[Tickets]',
    );
    // The `ab` search explicitly replaced Tickets with an empty ready result.
    // Ordinary tab re-entry reuses that ready resource rather than silently
    // reverting to the earlier unfiltered rows.
    expect(frameOf(tui)).toContain('No tickets');
    expect(frameOf(tui)).not.toContain(CLICK_TICKETS[0]?.identifier ?? '');

    await quit(tui);
  });

  it('clicking the ALREADY-FOREGROUND_ACTIVE tab while searching changes nothing', async () => {
    // The reset must sit AFTER `gotoTopTab`'s early return: clearing it before
    // would end search mode on a click that does not redraw, leaving a stale
    // frame that still shows `search: ab` while the flag is false. AC-11 also
    // requires the active-tab click to change nothing at all.
    //
    // BB-256: on the project's TICKET LIST, which is both where `/` is bound
    // and the tab whose already-active click is under test.
    const tui = await bootProjectTickets({ tickets: clickTicketListDoc });
    await tui.press('/');
    await tui.press('a');
    const before = styledFrame(tui);
    const painted = tui.paints();

    await click(tui, TOP_TAB_ROW, COL_TOP_TICKETS);

    expect(styledFrame(tui), 'no redraw, so no stale frame').toBe(before);
    expect(tui.paints()).toBe(painted);
    // And search mode is genuinely still on: the next printable key types.
    await tui.press('b');
    expect(frameOf(tui)).toContain('search: ab');

    // Esc first: search mode swallows `q` too, so the kernel would never quit.
    await tui.press('\x1b');
    await quit(tui);
  });
});

/** Open the ticket detail the way a user does: from a project's ticket table, so
 *  the project context the Runs tab needs really exists. Booting
 *  a bare `ticket` route leaves `currentProjectId` unset, and then the tab is
 *  inert for a reason that has nothing to do with the predicate under test. */
async function bootTicketDetailFromProject(
  overrides: ServiceOverrides = {},
): Promise<Tty> {
  // A project route lands on its Overview, where Enter selects nothing — one
  // Tab first, to the ticket list Enter actually opens from.
  const tty = await bootProjectTickets({
    tickets: clickTicketListDoc,
    ...overrides,
  });
  await tty.press('\r');
  return tty;
}

// BB-239 AC-14 — re-authored from BB-241's "a top-tab click reaches no state
// its key refuses". That block existed because the ticket screen DREW the flat
// PROJECT bar while `u` refused Runs there, so the click reached a state the key
// could not, and `topTabAllowed` was the ad-hoc predicate that closed the gap.
//
// BB-239 closed it by suppressing the row — it drew no top-level bar at all,
// so there was no bar to click and no predicate to over- or
// under-refuse. BB-346 closes it the other way, and this is the model today: the
// ticket screen HAS a bar, of its own `ticket` level, and every column of it
// reaches a SECTION of the open ticket — never another level's destination. There
// is still no predicate, because there is still nothing for one to refuse.
//
// Both tests are re-authored to that model rather than deleted — the property they
// guarded (a click reaches exactly what the keyboard reaches, and nothing else) is
// what is asserted below, on both sides of the boundary.
describe('the ticket detail screen’s bar row reaches ITS OWN tabs only (AC-14)', () => {
  // BB-346 — AC-14 SAID "no clickable top-tab row"; the ticket screen HAS one
  // now, and what AC-14 was protecting is the half that did not change.
  //
  // BB-239's defect was that a click where the PROJECT bar draws `Ticket-Agents`
  // opened a screen the ticket detail does not belong to. Suppressing the row was
  // one way to prevent that; giving the screen its own level is the other, and it
  // is the one the operator asked for. So the claim becomes: a click on that row
  // reaches a SECTION of this ticket and never another level's destination — and
  // the body row below it does not act as another level's bar either.
  it('a click on the body row under the bar is inert for tabs, and the bar reaches no other level', async () => {
    const clicked = await bootTicketDetailFromProject({ runs: runListDoc });
    expect(frameOf(clicked), 'the ticket detail is open').toContain(
      'DETAIL-OF-BB-301',
    );
    expect(
      rowsOf(clicked)[TICKET_BODY_ROW - 1],
      'the body under the bar is the frame top',
    ).toContain('╭');
    // BB-369 D1 — `TICKET_BAR_ROW`, not `TOP_TAB_ROW`. The state row pushed
    // this screen's bar to terminal row 6 while every other level's stays on 5,
    // so the two constants are no longer the same number and a ticket-screen
    // assertion has to name the ticket's.
    expect(
      rowsOf(clicked)[TICKET_BAR_ROW - 1],
      'and row 6 is this screen’s own bar',
    ).toContain('[Overview]');

    // THE BODY ROW: inert for tab switches at every column a project tab would
    // occupy (frame top is not a tab target).
    const before = styledFrame(clicked);
    const painted = clicked.paints();
    for (const col of [
      COL_TOP_OVERVIEW,
      COL_TOP_TICKETS,
      COL_TOP_RUNS,
      COL_BAR_EMPTY,
    ]) {
      await click(clicked, TICKET_BODY_ROW, col);
      expect(styledFrame(clicked), `body column ${col}`).toBe(before);
    }
    expect(clicked.paints(), 'not even a redraw').toBe(painted);

    // THE BAR ROW: every one of those columns, plus the bar's empty space. Some
    // of them land on a section of this ticket and switch it — that is the
    // feature. None of them may leave the ticket, which is what AC-14 is for.
    for (const col of [
      COL_TOP_OVERVIEW,
      COL_TOP_TICKETS,
      COL_TOP_RUNS,
      COL_BAR_EMPTY,
    ]) {
      await click(clicked, TICKET_BAR_ROW, col);
      expect(
        frameOf(clicked),
        `bar column ${col} stayed on the ticket`,
      ).toContain('BB-301');
      expect(
        frameOf(clicked),
        `bar column ${col} opened no project run table`,
      ).not.toContain('#901');
    }

    await quit(clicked);

    // And the keyboard agrees, as it always had to: `u` changes nothing either —
    // now because it is gone everywhere (AC-7), not because of a screen guard.
    const keyed = await bootTicketDetailFromProject({ runs: runListDoc });
    const keyedBefore = styledFrame(keyed);
    await keyed.press('u');
    expect(styledFrame(keyed), '`u` navigates nowhere').toBe(keyedBefore);

    await quit(keyed);
  });

  // BB-241's counterpart asserted that a bar click DOES open Ticket-Agents from
  // the ticket screen (its `a` had no screen guard). Under the level model that is
  // exactly what must no longer happen; what survives — and is re-asserted here —
  // is that the ticket screen's OWN bar, the `ticket` level's sections in the
  // chrome's bar row (BB-346; they used to be drawn inside the header box),
  // stays clickable, so the screen did not lose mouse navigation, it lost only the
  // bar that was not its own.
  it('its own bar is still clickable, and it is not another level’s', async () => {
    const tui = await bootTicketDetailFromProject({ runs: runListDoc });
    // Aimed at `TICKET_BAR_ROW`: since BB-369 D1 the ticket's bar is a row below
    // every other level's, so the click reaches the ticket's Runs section and
    // never another level.
    await click(tui, TICKET_BAR_ROW, COL_DETAIL_RUNS);
    expect(frameOf(tui), 'no project run table from here').not.toContain(
      '#901',
    );
    expect(frameOf(tui), 'a section of this ticket instead').toContain(
      '[Runs]',
    );

    await click(tui, TICKET_BAR_ROW, COL_DETAIL_PLANNING);
    expect(frameOf(tui), 'the bar switched section').toContain('[Planning]');
    // BB-346: the chrome DOES draw a bar row here now, and it carries the
    // `ticket` level's sections — so what must hold is that no chrome row carries
    // another LEVEL's tab, which is why this is asserted bar-scoped on a label
    // only the project bar has rather than as "the bar row is empty". The slice
    // stops at the separator, so it covers the bar row itself.
    for (const row of rowsOf(tui).slice(0, TICKET_BODY_ROW - 1)) {
      expect(row, 'no chrome row renders a top-level bar').not.toContain(
        'Conductors',
      );
    }

    await quit(tui);
  });
});

// BB-239 AC-13 — the bar is hit-tested at the level the screen belongs to. This
// is the assertion BB-241 could not make: its `topTabSpans(currentTopTab())`
// published the project bar's three spans on EVERY screen, so on the dashboard a
// click at the `Ticket-Agents` column opened a tab that screen does not draw —
// verbatim the defect this ticket removes, arriving through the mouse.
describe('a bar click acts at the current level (AC-13)', () => {
  it('a click on a root screen reaches no project tab', async () => {
    const tui = await bootTty(undefined, { runs: runListDoc });
    // The root landing is My work. It carries only root tabs, never project tabs.
    expect(tabBarRow(tui), 'My work carries the ROOT bar').toContain(
      '[My work]',
    );
    expect(tabBarRow(tui)).toContain('Projects');
    expect(tabBarRow(tui)).not.toContain('Teams');
    expect(tabBarRow(tui)).not.toContain('Users');
    expect(tabBarRow(tui)).not.toContain('Tickets');
    const before = styledFrame(tui);
    const painted = tui.paints();

    // Columns past the root bar must stay inert (not resolve to a project tab).
    // COL_TOP_RUNS (27) sits INSIDE the root bar (on Conductors); only
    // past-the-bar empties remain safe for this sweep.
    for (const col of [COL_BAR_EMPTY]) {
      await click(tui, TOP_TAB_ROW, col);
      expect(styledFrame(tui), `column ${col}`).toBe(before);
    }
    // …and the one column that IS the FOREGROUND_ACTIVE span: `My work`, so a
    // no-op through the very early return that makes an active-tab click inert.
    await click(tui, TOP_TAB_ROW, COL_ROOT_MY_WORK);
    expect(styledFrame(tui), 'clicking [My work] itself').toBe(before);
    expect(tui.paints(), 'not one redraw in two clicks').toBe(painted);

    // A root Conductors click remains a ROOT tab, never a project one.
    await click(tui, TOP_TAB_ROW, COL_ROOT_CONDUCTORS);
    expect(tabBarRow(tui), 'the root bar, still').toContain('[Conductors]');
    expect(tabBarRow(tui)).not.toContain('Tickets');

    // The root bar's OTHER tab is live, which is what makes the sweep above a
    // real result rather than a bar that refuses every click.
    await click(tui, TOP_TAB_ROW, COL_TOP_PROJECTS);
    expect(styledFrame(tui), 'clicking Projects DOES navigate').not.toBe(
      before,
    );
    expect(frameOf(tui)).toContain('bakers.build projects');

    await quit(tui);
  });
});

// AC-11 — A CUT BAR OFFERS NOTHING THE USER CANNOT SEE. The defect this guards
// against was concrete: a bar was written as one string through `fitLine`, cut to
// `budget - 1` columns plus `…`, while the span map published beside it still
// described the FULL layout — so a click on the `…` activated whichever tab the
// invisible span claimed was there.
//
// WHAT MAKES IT HOLD TODAY IS STRUCTURAL, and no longer a clamp. BB-340 Task 11
// deleted the span maps with the string bars: each bar is a ROW OF NODES, one per
// tab, and a column that is not rendered belongs to no node and so cannot be hit.
// `fitLineKeptWidth` and `columnToSpan` — the clamp and the lookup this comment
// used to credit — went with them. The invariant is the same; only its mechanism
// changed, and it now holds for every level for one reason instead of per bar.
//
// MEASURED, per level, each width INCLUDING the bar's leading space, against
// `renderScreen`'s width floor of 40 (`const width = Math.max(40, output.columns)`)
// — every narrower terminal renders AS 40, so 40 is also the narrowest case there
// is:
//
//   root     36 columns (My work · Projects · Conductors) → never cut; the
//            Members tab of a workspace lead does not change that verdict here.
//   project  48 columns → cut at the floor, which is what BB-256 changed by
//            putting `Dashboard` first: the bar was 35 columns and could not
//            truncate at any terminal size, and this comment said so, adding that
//            the safety was "an incidental consequence of that floor rather than a
//            property of the bar: raise the bar's labels or lower the floor and it
//            is a live defect again". Raising the labels made it a live case.
//   ticket   42 columns (BB-346) → cut at exactly the two reachable widths 40
//            and 41. Those are the same two numbers this paragraph carried when
//            the ticket screen drew its own 38-column bar inside the header box
//            against a `width - 4` budget — and they are the same two numbers for
//            an entirely different reason: the sections are a CHROME bar row now,
//            so what cuts them is the terminal edge, not a box's inner width.
//            Restating the old sentence would have kept a right answer with a
//            wrong derivation; the widths 41 and 40 are read off the two ticket
//            cases below, which is where they are asserted.
describe('a truncated tab bar publishes no span the user cannot see (AC-11)', () => {
  it('the PROJECT bar exceeds the width floor; the ROOT bar fits', () => {
    // The project bar can truncate at the 40-column floor; the click cases below
    // guard the cut. The root bar (My work · Projects · Conductors) fits.
    expect(
      displayWidth(` ${topTabBar('root', 'my-work')}`),
      'the root bar fits within the floor',
    ).toBeLessThanOrEqual(40);
    expect(
      displayWidth(` ${topTabBar('project', 'overview')}`),
      'the project bar is still wider than the floor — it can be cut',
    ).toBeGreaterThan(40);
  });

  it('the top bar: a tab past the cut is inert on the narrowest terminal', async () => {
    // Width 20 renders at the floor of 40, where the 48-column project bar loses
    // ` Runs ` entirely. Its span map still describes the FULL layout, so without
    // the clamp a click at the Runs column would open a tab the user cannot see.
    //
    // BB-326 — THE `…` IS NOT ASSERTABLE AT THIS WIDTH ANY MORE, and the
    // reason is the harness getting MORE honest, not less. The fake output was
    // a byte sink: the kernel wrote 40 columns into a "20-column" terminal and
    // every one of them was recorded, so the ellipsis at column 40 was readable.
    // A real 20-column grid keeps 20 cells, so the cut mark itself is off
    // screen. The precondition this case needs — ` Runs ` is not on screen —
    // is asserted, and is if anything more emphatically true; the bar's
    // truncation as such is measured by the first case of this describe, which
    // compares the composed bar's width against the floor directly.
    const tui = await bootTty(
      PROJECT_ROUTE,
      { tickets: clickTicketListDoc, runs: runListDoc },
      20,
    );
    expect(tabBarRow(tui), '` Runs ` is not on screen').not.toContain(' Runs ');
    const before = styledFrame(tui);

    await click(tui, TOP_TAB_ROW, COL_TOP_RUNS);
    expect(styledFrame(tui), 'the invisible tab is inert').toBe(before);
    expect(frameOf(tui), 'the run table did NOT open').not.toContain('#901');

    await quit(tui);
  });

  it('the top bar: a VISIBLE tab on the narrowest terminal still works', async () => {
    // The clamp must not make the whole bar inert — only the columns past the
    // cut. Tickets (cols 14–22) remains visible at the width floor.
    const tui = await bootTty(
      PROJECT_ROUTE,
      { tickets: clickTicketListDoc, runs: runListDoc },
      20,
    );

    await click(tui, TOP_TAB_ROW, COL_TOP_TICKETS);
    expect(frameOf(tui), 'the tickets view opened').toContain(
      'bakers · tickets',
    );
    // The 20-cell grid cuts the label itself; its opening bracket is on screen.
    expect(tabBarRow(tui), 'and the bar marks it active').toContain('[Ticket');

    await quit(tui);
  });

  // BB-346 — THE TICKET BAR'S CUT IS THE TERMINAL'S NOW, NOT A BOX'S.
  //
  // These cases used to click the header BOX's inner edge. The box composed its
  // own row (`'│ ' + fitLine(bar, width - 4) + ' │'`, with `fitLine` spending the
  // last column on `…`), then became a real `BoxRenderable` that clipped the row
  // at its border with no ellipsis — so "past the cut" meant the box's padding.
  // The sections are a CHROME bar row now, drawn exactly like the root and project
  // bars, so the only thing that cuts them is the terminal edge, and the columns
  // past it are not in the buffer at all.
  //
  // AC-11's invariant is unchanged and holds for the same structural reason it
  // holds for the other two levels: a column that is not rendered is not part of
  // any node, so it cannot be hit. What changed is the arithmetic, and it is
  // MEASURED rather than restated — the ticket bar is 41 columns (' Overview '(10)
  // '   ' ' Planning '(10) '   ' '[History]'(9) '   ' ' Runs '(6) — note the
  // first ` ` is the bar's own leading blank, 1+10+3+10+3+9+3+5=44, minus
  // the leading space shared with the Overview label gives the 41-char string),
  // with ` Runs ` at terminal columns 36..41.
  it('the ticket bar: the column past the terminal edge is inert, the one before it is not', async () => {
    // Width 40 cuts the trailing space of ` Runs `; column 41 is off-screen.
    const tui = await bootTty(
      { screen: 'ticket', ticketId: TICKET, view: 'full' },
      {},
      40,
    );
    expect(
      rowsOf(tui)[TICKET_BAR_ROW - 1],
      'the bar is cut, and says nothing about it',
    ).not.toContain('…');

    await click(tui, TICKET_BAR_ROW, 41);
    expect(frameOf(tui), 'the cut column is inert').toContain('[Overview]');

    await click(tui, TICKET_BAR_ROW, 40);
    expect(
      frameOf(tui),
      'the last DRAWN column still opens the tab under it',
    ).toContain('[Run'); // bar is cut at col 40, so only `[Run` of `[Runs]` is visible

    await quit(tui);
  });

  it('the ticket bar: at the width floor the cut columns are still inert', async () => {
    // Width 35 cuts the bar before Runs; columns 36+ are off screen.
    const tui = await bootTty(
      { screen: 'ticket', ticketId: TICKET, view: 'full' },
      {},
      35,
    );
    await click(tui, TICKET_BAR_ROW, 36);
    await click(tui, TICKET_BAR_ROW, COL_DETAIL_RUNS_LAST);
    expect(frameOf(tui)).toContain('[Overview]');

    await quit(tui);
  });

  it('the ticket bar: a VISIBLE tab on a narrow terminal still works', async () => {
    // The cut must not make the whole bar inert — only the columns past it. At
    // width 40, ` Planning ` (terminal columns 14..23) is fully rendered.
    const tui = await bootTty(
      { screen: 'ticket', ticketId: TICKET, view: 'full' },
      {},
      40,
    );
    await click(tui, TICKET_BAR_ROW, COL_DETAIL_PLANNING);
    expect(frameOf(tui)).toContain('[Planning]');

    await quit(tui);
  });

  it('the ticket bar: a VISIBLE tab on a wide terminal still works', async () => {
    const tui = await bootTty({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
    });
    await click(tui, TICKET_BAR_ROW, COL_DETAIL_RUNS);
    expect(frameOf(tui)).toContain('[Runs]');

    await quit(tui);
  });
});

// BB-326 — WHAT "THE RESTORE" IS NOW, AND WHAT IS ASSERTED INSTEAD.
//
// These three cases used to pin the write transcript's LAST BYTES:
// `\x1b[?25h\x1b[2J\x1b[H`, with nothing after them. Both halves of that are
// gone. The cursor-and-clear sequence is `renderer.destroy()`'s, and the kernel
// destroys only a renderer it MADE — an injected one belongs to its test — so
// those bytes are never written here. And there is no transcript to look at the
// end of.
//
// What the cases were really about survives whole: after `finish()` the kernel
// must handle nothing more, so nothing can paint a TUI frame into the shell the
// user has just been given back. `finish()` unhooks `keypress`, clears
// `root.onMouse` and destroys every row renderable, which leaves the screen
// BLANK — so a frame painted by a token that rode in behind the quit key would
// be plainly visible, and the further tokens reaching the kernel at all would
// show up as a read the fake client records. Both are asserted.
describe('no frame is painted after the terminal was restored (AC-14)', () => {
  it('a chunk carrying `q` and a further key draws nothing after the restore', async () => {
    // The multi-token dispatch made this reachable: one chunk can carry `q` AND
    // another token, so the key/mouse handlers — and their `draw()` — ran after
    // `finish()` had already restored the terminal. That paints a TUI frame into
    // the user's shell.
    //
    // `q` plus a bare key is ONE key token (`'qj'` !== `'q'`, so it never
    // quits); it takes a mouse report between them to split the chunk into
    // several tokens — which is exactly what a wheel spin during a quit does.
    // The report is aimed at the project bar's `Runs` tab, so a token that DID
    // reach the kernel would read the run collection and be caught below;
    // `mockMouse` cannot express this, because the whole point is one chunk.
    const tui = await bootTty(PROJECT_ROUTE, {
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    const reads = tui.services.paths.length;

    tui.mockInput.pressKey(`q${sgr(0, COL_TOP_RUNS, TOP_TAB_ROW, true)}j`);
    await tui.running;
    await settle();
    await tui.renderOnce();

    expect(frameOf(tui), 'the screen stays given back').toBe('');
    expect(tui.services.paths.length, 'no token behind `q` was handled').toBe(
      reads,
    );

    await tui.stop();
  });

  it('a chunk carrying `q` and a mouse report draws nothing after the restore', async () => {
    const tui = await bootTty(PROJECT_ROUTE, {
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    const reads = tui.services.paths.length;

    tui.mockInput.pressKey(`q${sgr(WHEEL_DOWN, 1, 8, true)}`);
    await tui.running;
    await settle();
    await tui.renderOnce();

    // THE BLANK FRAME IS THE LOAD-BEARING LEG HERE. Unlike the tab click in the
    // case above, a wheel notch asks for no data — it only scrolls and draws —
    // so the read count below cannot tell a handled notch from an ignored one.
    // A notch handled after `finish()` would repaint, and a repaint is exactly
    // what the empty screen rules out.
    expect(frameOf(tui)).toBe('');
    expect(tui.services.paths.length, 'corroboration, not proof').toBe(reads);

    await tui.stop();
  });

  it('Ctrl+C followed by more input draws nothing after the restore', async () => {
    // The renderer half of the assertion is NOT available on this one: the test
    // renderer is built with OpenTUI's default `exitOnCtrlC`, so it destroys
    // itself a tick after this chunk and reading a frame off it afterwards
    // segfaults the process (measured). The service reads are the surviving
    // evidence, and they carry the same claim — no token behind `\x03` was
    // handled — while `running` resolving proves the ladder ran to `finish()`.
    const tui = await bootTty(PROJECT_ROUTE, {
      tickets: clickTicketListDoc,
      runs: runListDoc,
    });
    const reads = tui.services.paths.length;

    tui.mockInput.pressKey(`\x03${sgr(0, COL_TOP_RUNS, TOP_TAB_ROW, true)}j`);
    await tui.running;
    await settle();

    expect(tui.services.paths.length).toBe(reads);
  });
});
