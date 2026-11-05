import { afterEach, describe, expect, it } from 'bun:test';
import { createTextAttributes, type RGBA } from '@opentui/core';
import { type ListTable, listTableTree } from '../../src/Entity/collection.js';
import {
  CONDUCTOR_TABLE,
  type ConductorListContext,
  type ConductorRow,
} from '../../src/Entity/conductor/Data/conductors.js';
import {
  PROJECT_TABLE,
  type ProjectRow,
} from '../../src/Entity/project/Data/projects.js';
import {
  TICKET_TABLE,
  type TicketRow,
} from '../../src/Entity/ticket/Data/tickets.js';
import { AGENT_TABLE } from '../../src/Entity/ticket/Screen/ticket-agents.js';
import { mountTree } from '../../src/Kernel/mount.js';
import { THEME_SLOTS } from '../../src/lib/theme.js';
import { columnNode, seamlessRowNode, textNode } from '../../src/lib/vnode.js';
import type { HostedAgent } from '../../src/types.js';
import { type BareHarness, createHarness } from '../tui-harness.js';

/**
 * BB-345 AC 3 and AC 4 — the header's EMPHASIS and the table's WIDTH, both on
 * a real renderer.
 *
 * AC 3 is asserted on CELLS, never on text. The finding this pins: the title
 * line carried 14 bold cells, the tab bar 48 and the selected row a continuous
 * highlight, while the table's header row carried NONE and read as one more
 * data row. Bold is invisible to `captureCharFrame`, to every vitest node suite
 * and to `verify-screen.mjs` — a test asserting "the header says IDENTIFIER"
 * passes with the defect present — so `captureSpans()` is the only harness that
 * can see it. Same reason `tests-bun/Kernel/chrome-cells.test.ts` exists.
 *
 * AC 4 is the other half and is asserted on the PAINTED FRAME, because the width
 * distribution is Yoga's answer and not this file's: `min`/`max`/`grow` are
 * declared on the column and executed by the layout engine, so the only place
 * the result exists is the buffer.
 */
const BOLD = createTextAttributes({ bold: true });

type SpanLine = {
  spans: { text: string; attributes: number; fg?: RGBA; bg?: RGBA }[];
};

/** BB-375 — selection is FOREGROUND_ACTIVE fg (slot 15 white), not inverse / wash. */
const isActiveSelection = (span: { fg?: RGBA }): boolean =>
  span.fg?.intent === 'indexed' &&
  span.fg.slot === THEME_SLOTS.foregroundActive;

const live: BareHarness[] = [];
afterEach(() => {
  for (const harness of live.splice(0)) harness.renderer.destroy();
});

/** The fixture, copied rather than imported: a fixture shared across test files
 *  couples two suites' failures together. */
const TICKET = {
  id: 't1',
  identifier: 'BB-1',
  title: 'TITLE-MARK',
  state: 'todo',
  priority: null,
  assigneeInitials: 'CW',
  derivedStatus: 'idle',
  parent: 'BB-175',
  conductor: 'x',
} as TicketRow;

const mount = async (
  columns: number,
  rows: TicketRow[],
  selectedIndex = -1,
): Promise<BareHarness> => {
  const harness = await createHarness({ columns, rows: 8 });
  live.push(harness);
  mountTree(
    harness.renderer,
    harness.root,
    listTableTree(TICKET_TABLE, rows, undefined, { selectedIndex }),
  );
  await harness.renderOnce();
  return harness;
};

const paintSpans = async (
  columns: number,
  rows: TicketRow[],
  selectedIndex = -1,
): Promise<SpanLine[]> =>
  (await mount(columns, rows, selectedIndex)).captureSpans()
    .lines as SpanLine[];

/**
 * The painted frame as rows, right edge trimmed.
 *
 * The render buffer is a GRID — every row is `width` cells wide whether or not
 * anything was written into it — and the assertions below are about where glyphs
 * ARE, so the padding is trimmed exactly as `tui-harness.ts` does for the kernel.
 */
const paintChars = async (
  columns: number,
  rows: TicketRow[],
  selectedIndex = -1,
): Promise<string[]> =>
  (await mount(columns, rows, selectedIndex))
    .captureCharFrame()
    .split('\n')
    .map((row) => row.replace(/\s+$/, ''));

/** Columns of this line painted with the bold attribute. */
const boldCells = (
  line: { spans: { text: string; attributes: number }[] } | undefined,
): number =>
  (line?.spans ?? [])
    .filter((span) => (span.attributes & BOLD) !== 0)
    .reduce((total, span) => total + span.text.length, 0);

describe('BB-345 AC 3 — the header row is distinguishable from a data row', () => {
  it('has bold cells where a data row has none', async () => {
    const lines = await paintSpans(120, [TICKET]);
    expect(boldCells(lines[0])).toBeGreaterThan(0);
    expect(boldCells(lines[1])).toBe(0);
  });
});

/**
 * How ONE attribute is distributed across a painted line.
 *
 * `fragments` is the number the operator's report is about: an attribute that
 * covers only the glyphs comes back in as many pieces as the row has non-empty
 * cells, with the blank remainder of each cell between them.
 */
interface AttributeRun {
  /** Columns this line paints at all. */
  readonly painted: number;
  /** Columns carrying the attribute. */
  readonly marked: number;
  /** Contiguous runs of it — 1 is a bar, 8 is what was reported. */
  readonly fragments: number;
  /** The column the first run starts at, or -1 when there is none. */
  readonly start: number;
}

const runOf = (
  line: SpanLine | undefined,
  isMarked: (span: SpanLine['spans'][number]) => boolean,
): AttributeRun => {
  let painted = 0;
  let marked = 0;
  let fragments = 0;
  let start = -1;
  let inRun = false;
  for (const span of line?.spans ?? []) {
    const on = isMarked(span);
    if (on) {
      if (!inRun) {
        fragments += 1;
        if (start < 0) start = painted;
      }
      marked += span.text.length;
    }
    inRun = on;
    painted += span.text.length;
  }
  return { painted, marked, fragments, start };
};

const boldMarked = (span: SpanLine['spans'][number]): boolean =>
  (span.attributes & BOLD) !== 0;

describe('BB-345 — the row-wide attributes are ONE continuous bar', () => {
  // The operator's report: "nicht durchgängig sondern nur der Titel innerhalb
  // der Row ist aktiv". Measured on the tickets list at 120 columns before this
  // change, the selected row came back as 58 of 120 columns inverse in EIGHT
  // fragments — one per cell — and the TITLE cell only looked "active" because
  // it is the one cell whose text fills its own width.
  //
  // The cause was that `selected` is a TEXT attribute, so it covers the glyphs
  // and not the cell's unused columns, while the ` ` between two columns was
  // `rowNode`'s Yoga `gap` and carried no text to attribute at all. Both are
  // fixed by the same move: the row's cells touch, and each cell's content is
  // padded to its own DECLARED width — the separator is a blank column of the
  // cell that follows it, not a hole in the row.
  //
  // BB-375 — selection is FOREGROUND_ACTIVE fg across the bar (same continuity).
  // ASSERTED ON CELLS, because no text-level harness can see colour: a
  // frame full of the right characters is exactly what the defect produced.
  const selectedRun = async (columns: number): Promise<AttributeRun> =>
    runOf((await paintSpans(columns, [TICKET], 0))[1], isActiveSelection);

  for (const columns of [80, 120, 160]) {
    it(`the selected row is one FOREGROUND_ACTIVE fg run across ${columns} columns`, async () => {
      const run = await selectedRun(columns);
      expect(run.fragments).toBe(1);
      expect(run.start).toBe(0);
      expect(run.marked).toBe(run.painted);
      // …and the bar reaches the width the row was given, rather than stopping
      // where the last cell's glyphs happen to end.
      expect(run.painted).toBe(columns);
    });
  }

  it('the bold header row is one continuous run too', async () => {
    // A bonus of the same mechanism rather than a separate feature, and pinned
    // so it cannot be lost silently: the header's emphasis is the one thing
    // that distinguishes it from a data row (AC 3).
    const run = runOf((await paintSpans(120, [TICKET]))[0], boldMarked);
    expect(run.fragments).toBe(1);
    expect(run.start).toBe(0);
    expect(run.marked).toBe(run.painted);
    expect(run.painted).toBe(120);
  });

  it('a row that is NOT selected carries no FOREGROUND_ACTIVE fg at all', async () => {
    // The mutation this catches: padding every cell and then colouring the
    // padding unconditionally would paint the whole table selected.
    const lines = await paintSpans(120, [TICKET, { ...TICKET, id: 't2' }], 0);
    expect(runOf(lines[2], isActiveSelection).marked).toBe(0);
  });

  it('the characters the operator READS are unchanged by the padding', async () => {
    // Pinned separately from the bar so that a padding bug which changes what
    // is on screen fails differently from one that changes what is
    // highlighted. Trailing blanks are trimmed; everything inside the row is
    // the exact frame.
    const frame = await paintChars(120, [TICKET], 0);
    expect(frame[0]).toBe(
      'IDENTIFIER STATE         PRIO  WHO  BY   RUN          PARENT     COND           TITLE',
    );
    expect(frame[1]).toBe(
      'BB-1       todo          —     CW   —    idle         BB-175     x              TITLE-MARK',
    );
  });
});

/** The 1-based column a needle starts at, READ OFF the painted frame rather
 *  than computed — the layout is Yoga's answer and not this file's. */
const columnOf = (line: string, needle: string): number => line.indexOf(needle);

describe('BB-345 AC 4 — the table uses the width it is given', () => {
  const wide = { ...TICKET, state: 'qualification', title: 'a title' };

  it('at 120 columns STATE shows `qualification` whole', async () => {
    // The finding: every column but the trailing one was a fixed budget with
    // `flexShrink: 0`, so the ENTIRE surplus went to the trailing column even
    // when its value did not need it, while STATE stayed 8 wide and cut the
    // longest member of the ticket workflow's state_flow to `qualific…`.
    const frame = await paintChars(120, [wide]);
    expect(frame[1]).toContain('qualification');
    expect(frame[1]).not.toContain('qualific…');
  });

  it('at 160 columns it is still whole', async () => {
    const frame = await paintChars(160, [wide]);
    expect(frame[1]).toContain('qualification');
  });

  it('STATE stays whole even when the TITLE is long', async () => {
    // The case a grown column could NOT have delivered, which is why STATE is
    // fixed at its vocabulary's width instead. A real ticket list's trailing
    // TITLE is long, and Yoga's default `flexBasis: auto` makes a cell's basis
    // its own CONTENT — so a 200-character title puts the row in a shrink
    // situation, where `flexGrow` is inert. Measured on this renderer: a
    // basis-8 STATE with `flexGrow: 1, maxWidth: 13` stayed at 8 at 80, 120 AND
    // 160 columns, i.e. cut while the row still had unused columns.
    const frame = await paintChars(160, [{ ...wide, title: 'x'.repeat(200) }]);
    expect(frame[1]).toContain('qualification');
    expect(frame[1]).not.toContain('qualific…');
  });

  it('at 80 columns nothing overflows, and STATE is still whole', async () => {
    const frame = await paintChars(80, [{ ...wide, title: 'x'.repeat(200) }]);
    for (const row of frame) expect(row.length).toBeLessThanOrEqual(80);
    // Every BUDGETED column is its vocabulary's width, so the only column a
    // narrow terminal takes from is the trailing one — which is the column that
    // is supposed to absorb it.
    expect(frame[1]).toContain('qualification');
  });

  it('a cut BUDGETED cell still says it was cut, at every width (AC 5)', async () => {
    // AC 5 is preservation at this base, and this is what preserves it. The
    // marker is `cellText`'s, not the renderer's: measured on a real renderer,
    // `truncate` alone cuts `qualification` at an 8-column budget to `qualific`
    // and appends NOTHING, which reads as a typo rather than as a truncation.
    // Asserted on the conductor column, whose 14 is a label width and not a
    // closed vocabulary, so it is the column a long value really does outgrow.
    for (const width of [80, 120, 160]) {
      const frame = await paintChars(width, [
        { ...TICKET, conductor: 'a-really-long-conductor-name-way-over-14' },
      ]);
      expect(frame[1]).toContain('a-really-long…');
    }
  });

  it('two growers SHARE the surplus, and a `max` caps one of them', async () => {
    // The `min`/`max`/`grow` mechanism itself, on a synthetic table rather than
    // on a shipped one. It is here because neither shipped list exercises it:
    // once every budgeted column is sized to its own vocabulary, the ticket and
    // run lists have exactly one grower each (their trailing column), where a
    // share is indistinguishable from the default. The lists that DO need it are
    // the projects and conductors lists, which this ticket's later tasks
    // configure — so the mechanism is pinned before they rely on it, which is
    // what spec R2 asks for.
    //
    // Two facts are asserted, both measured here rather than read off typings:
    // `width` is the flex BASIS (so `width` + `grow` = "at least this, then a
    // share"), and `max` stops the share where it would have overshot.
    const table = {
      noun: 'probe',
      emptyMessage: 'none',
      columns: [
        { key: 'a', label: 'A', width: 4, fields: [], get: () => '<A>' },
        {
          key: 'b',
          label: 'B',
          width: 6,
          min: 6,
          max: 9,
          grow: 1,
          fields: [],
          get: () => '<B>',
        },
        {
          key: 'c',
          label: 'C',
          width: 0,
          grow: 1,
          fields: [],
          get: () => `<C>${'x'.repeat(200)}`,
        },
      ],
    } as const satisfies ListTable<{ id: string }, void>;

    const at = async (columns: number): Promise<string> => {
      const harness = await createHarness({ columns, rows: 4 });
      live.push(harness);
      mountTree(
        harness.renderer,
        harness.root,
        listTableTree(table, [{ id: 'r1' }], undefined, { selectedIndex: -1 }),
      );
      await harness.renderOnce();
      return harness.captureCharFrame().split('\n')[1] ?? '';
    };

    // B's basis is 6; its own budget grows with the row and stops at `max: 9`.
    // Read as the distance from B's first glyph to C's, less the one-column gap.
    const widthOfB = (line: string): number =>
      line.indexOf('<C>') - line.indexOf('<B>') - 1;
    expect(widthOfB(await at(40))).toBe(9);
    expect(widthOfB(await at(120))).toBe(9);
    // And the floor holds where the row is too narrow to honour the share: `min`
    // is what stops B being squeezed past the point of saying anything.
    expect(widthOfB(await at(24))).toBeGreaterThanOrEqual(6);
  });

  it('the PROJECT column grows, and it is not the last column (AC 5)', async () => {
    // The operator's correction to Task 5, measured. Task 5 shipped PROJECT as a
    // fixed 24, and at 160 columns that cut an ordinary project name while the
    // trailing AGE held ~120 columns of whitespace — finding 3 of this very
    // ticket, reproduced on the projects list.
    //
    // Two claims, and the second is the one that could not be read off the
    // typings: a `width: 0` column takes the row's surplus, and it does so from
    // the FIRST position, with STATUS and AGE keeping their own budgets behind
    // it. `flexGrow` is a property of the cell rather than of its place in the
    // row, so the grower does not have to be the trailing column — which is what
    // lets the column ORDER stay the operator's while the width distribution
    // changes.
    const NAME = 'a-really-long-project-name-well-over-24-columns';
    const row = {
      id: 'p-1',
      project: NAME,
      projectName: NAME,
      projectSlug: NAME,
      derivedStatus: 'online',
      lastSeen: null,
      ageLabel: '5m ago',
    } as ProjectRow;

    const projectsAt = async (columns: number): Promise<string[]> => {
      const harness = await createHarness({ columns, rows: 6 });
      live.push(harness);
      mountTree(
        harness.renderer,
        harness.root,
        listTableTree(PROJECT_TABLE, [row], undefined, { selectedIndex: -1 }),
      );
      await harness.renderOnce();
      return harness
        .captureCharFrame()
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''));
    };

    for (const columns of [120, 160]) {
      const frame = await projectsAt(columns);
      // The name is whole — the cut a fixed 24 made at every width is gone.
      expect(frame[1]).toContain(NAME);
      // …and the two bounded columns are still behind it, in order.
      expect(frame[0]?.indexOf('STATUS')).toBeGreaterThan(
        frame[0]?.indexOf('PROJECT') ?? -1,
      );
      expect(frame[0]?.indexOf('AGE')).toBeGreaterThan(
        frame[0]?.indexOf('STATUS') ?? -1,
      );
      // The row REACHES the width it was given: what STATUS and AGE do not use
      // is PROJECT's, so the last glyph sits within a couple of columns of the
      // right edge instead of leaving a hundred behind. `8` is AGE's budget and
      // `5m ago` is six of it, which is the whole of the slack this asserts.
      expect((frame[1] ?? '').length).toBeGreaterThanOrEqual(columns - 2);
      expect((frame[1] ?? '').length).toBeLessThanOrEqual(columns);
    }

    // And at 80 the row still fits: the grower is the column a narrow terminal
    // takes from, which is the one that can give.
    const narrow = await projectsAt(80);
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('the columns do not move when the page`s data changes (spec D4)', async () => {
    // The rejected alternative, guarded: sizing a column from the widest cell of
    // the current page satisfies AC 4 for any content and buys it with columns
    // that shift under the operator every time the page changes — the property
    // BB-340 measured `TextTableRenderable` for and rejected it over.
    const short = await paintChars(120, [{ ...TICKET, conductor: 'x' }]);
    const long = await paintChars(120, [
      { ...TICKET, conductor: 'a-really-long-one' },
    ]);
    expect(columnOf(short[0] ?? '', 'TITLE')).toBe(
      columnOf(long[0] ?? '', 'TITLE'),
    );
    // And the header's own columns sit over the data row's, at both widths.
    expect(columnOf(short[0] ?? '', 'TITLE')).toBeGreaterThan(0);
  });
});

describe('BB-345 AC 5 — a free-text column grows on the conductors list too', () => {
  // The operator's rule, applied consistently: FREE-TEXT COLUMNS GROW. Task 6
  // shipped `NAME` as the list's only grower and named `PROJECT` an accepted
  // residual — a project name is free text and its 14 columns are a label width
  // rather than a bound, so an ordinary name was cut while the row still had
  // surplus. Measured before this change at 160 columns: 15 columns unused at
  // the right edge with `PROJECT` cutting.
  //
  // `MACHINE` and `WORKSPACE` stay fixed and are NOT a second application of the
  // rule: both are elided from the LEFT to keep their distinguishing tail, which
  // needs a declared width to cut against, and a grower hands the cut to the
  // renderer's right-hand clip — head kept, tail lost. `MARKS` stays a real
  // budget: measured, `width: 0, grow: 0` collapses it to zero columns and the
  // mark disappears.
  const CONDUCTOR = {
    id: 'c-1',
    label: 'cw-framework',
    machineId: 'user-uuid-0000-1111-machine-bakers',
    status: 'online',
    projectId: 'p-1',
    workspaceRoot: '/home/cw/projects/bakers/.bakers',
    lastSeen: 1_000_000,
    leaseExpiresAt: 1_000_300,
    currentLoad: 0,
    maxParallel: 4,
    lastPid: 4242,
    conductorName: 'conductor',
    hostKey: 'cw-dev-box',
    machineLabel: 'cw-laptop-workstation-bakers',
    derivedStatus: 'online',
    isLocal: true,
  } as ConductorRow;

  /** A real project name, longer than the 14 columns PROJECT used to have. */
  const PROJECT_NAME = 'keytec-bakers-platform';

  const CTX: ConductorListContext = {
    nowSeconds: 1_000_010,
    busyIds: new Set<string>(),
    projectNames: new Map([['p-1', PROJECT_NAME]]),
  };

  const conductorsAt = async (columns: number): Promise<string[]> => {
    const harness = await createHarness({ columns, rows: 6 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(CONDUCTOR_TABLE, [CONDUCTOR], CTX, { selectedIndex: -1 }),
    );
    await harness.renderOnce();
    return harness
      .captureCharFrame()
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''));
  };

  it('shows an ordinary project name WHOLE once the row HAS a surplus', async () => {
    // 160 columns, which is where this list first has one to share. Before this
    // change the same frame read `keytec-bakers…` with 15 columns unused at the
    // right edge.
    const frame = await conductorsAt(160);
    expect(frame[1]).toContain(PROJECT_NAME);
    expect(frame[1]).not.toContain('keytec-bakers…');
    // And NAME took its own larger share rather than being squeezed by it: its
    // value starts at column 0 and MACHINE's begins well past its `min: 20`.
    expect(frame[0]?.indexOf('MACHINE')).toBeGreaterThan(20);
  });

  it('the row USES the surplus rather than leaving it at the right edge', async () => {
    // "Unused columns" is what AC 5 is about: a column may only be cut once the
    // row has none left. Read as the distance from the last glyph to the right
    // edge, with a value in MARKS — the last column — so that the reading is
    // about the LAYOUT and not about an empty trailing cell.
    const frame = await marked(160);
    expect((frame[1] ?? '').length).toBe(158);
    // The residual is MARKS' own: `elsewhere` is 9 of a budget that must hold
    // `… elsewhere`, so two columns of a CLOSED vocabulary stay unused. They
    // cannot be closed by growing anything — a column that could use them is
    // exactly what MARKS is not.
    expect(160 - (frame[1] ?? '').length).toBe(2);
  });

  /** The nine labels, in the order the columns declare them. */
  const HEADER_LABELS = [
    'NAME',
    'MACHINE',
    'PROJECT',
    'STATUS',
    'AGE',
    'WORKSPACE',
    'PID',
    'MARKS',
    'LOAD',
  ];

  it('fits the cockpit`s own 120 columns, MARKS and its mark included', async () => {
    // THE MEASURED DEFECT, and the reason WORKSPACE went from 30 to 24. The row
    // wanted 126 columns — NAME's floor 20, then MACHINE 20, PROJECT 14, STATUS
    // 9, AGE 8, WORKSPACE 30, PID 7, MARKS 11, plus the seven separators — while
    // `bakers ui`'s default terminal is 120. So the LAST column was cut by the
    // terminal at the cockpit's own default width: captured on a real pty at
    // 120, the header ended `PID     MAR`.
    //
    // That capture is of the SCREEN, which indents the table by two columns; a
    // bare table keeps the five glyphs of `MARKS` by exactly one column, so the
    // label alone is not what this harness can see the defect through. What it
    // CAN see is the same six missing columns from the other side: the mark
    // itself. `elsewhere` is nine of MARKS' eleven and came out `elsew`.
    //
    // Both are asserted, because the two failures are different mutations: a
    // header label cut is a labelling defect, a cut mark is an information one.
    const frame = await conductorsAt(120);
    const header = frame[0] ?? '';
    let previous = -1;
    for (const label of HEADER_LABELS) {
      expect(header).toContain(label);
      // In the declared order, so no label can be satisfied by another column.
      const at = header.indexOf(label);
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
    // The mark a non-local conductor carries is whole — the six columns the
    // terminal was taking are exactly the ones it was short of.
    const remote = await marked(120);
    expect(remote[1]).toContain('elsewhere');

    // …and the row is EXACTLY 120 wide with NOTHING clipped: `LOAD` (BB-450
    // AC-7) is now the trailing column, its cell the last six columns (its own
    // 5 plus the separator it owns), so its label starts at 115 and the
    // right-trimmed header ends at 119. A header ending at 120 is the defect —
    // that is a cell cut mid-budget by the terminal, not a row that fits. The
    // one column after `LOAD` is the closed vocabulary's own slack, not the
    // layout's to reclaim.
    expect(header.length).toBe(119);

    for (const line of [...frame, ...remote])
      expect(line.length).toBeLessThanOrEqual(120);
  });

  it('at and below its natural width every budget is exactly its declared one', async () => {
    // The six budgeted columns plus PROJECT's basis need 100 columns between
    // them, and NAME's floor is 20, so this list has NO surplus below 120 and
    // overflows below it. What must hold is that nothing is painted past the
    // terminal, and that a row with nothing to share leaves every basis alone.
    for (const columns of [80, 120]) {
      const frame = await conductorsAt(columns);
      for (const line of frame)
        expect(line.length).toBeLessThanOrEqual(columns);
      // …and PROJECT keeps precisely the 14 columns it had before this ticket:
      // its `width` is a BASIS, so a row with nothing to share leaves it there.
      expect(frame[1]).toContain('keytec-bakers-');
    }
  });

  /** The same frame for a conductor of ANOTHER machine, so MARKS carries a
   *  value and the row's right edge is the layout's rather than an empty cell's. */
  const marked = async (columns: number): Promise<string[]> => {
    const harness = await createHarness({ columns, rows: 6 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(CONDUCTOR_TABLE, [{ ...CONDUCTOR, isLocal: false }], CTX, {
        selectedIndex: -1,
      }),
    );
    await harness.renderOnce();
    return harness
      .captureCharFrame()
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''));
  };

  it('MARKS keeps a real budget, so a non-local row still says so', async () => {
    // The mutation this catches: making MARKS a `width: 0` grower with no share
    // collapses it to zero columns and drops the mark silently.
    expect((await marked(160))[1]).toContain('elsewhere');
  });

  /** The same frame for one conductor with the workspace path handed in — the
   *  column under test is the one whose budget this ticket spent. */
  const withWorkspace = async (workspaceRoot: string): Promise<string> => {
    const harness = await createHarness({ columns: 160, rows: 6 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(CONDUCTOR_TABLE, [{ ...CONDUCTOR, workspaceRoot }], CTX, {
        selectedIndex: -1,
      }),
    );
    await harness.renderOnce();
    return harness.captureCharFrame().split('\n')[1] ?? '';
  };

  it('WORKSPACE still keeps its TAIL, which is why it does not grow', async () => {
    // BB-345 — THIS EXPECTATION MOVED, and the move is the change itself:
    // WORKSPACE went 30 → 24. BB-450 AC-7 moved it again, 24 → 18, to pay for
    // the new `LOAD` column the same way — six columns that keep the row inside
    // the cockpit's default 120. The shared fixture's `/home/cw/projects/bakers/.bakers`
    // is 32 columns, so what was painted whole at 30 is now elided — which
    // DEMONSTRATES the claim rather than costing it, and the assertion is
    // strengthened rather than relaxed: it is now made from both sides of the
    // budget, and the surviving tail is named exactly instead of by containment.
    //
    // Within the budget, untouched and no marker.
    expect(await withWorkspace('/srv/bb/.bakers')).toContain(
      ' /srv/bb/.bakers ',
    );
    // Past it, the HEAD goes and the tail stays — the whole reason this column
    // keeps a declared width instead of growing.
    const trimmed = await withWorkspace('/home/cw/projects/bakers/.bakers');
    expect(trimmed).toContain('…ts/bakers/.bakers');
    expect(trimmed).not.toContain('/home/cw/projects');
    // …and the same for a path far past it: `feat/x/.bakers` is what tells two
    // worktrees of one checkout apart, and it survives.
    expect(
      await withWorkspace(
        '/home/cw/projects/bakers/.bakers-worktrees/feat/x/.bakers',
      ),
    ).toContain('…es/feat/x/.bakers');
  });
});

describe('BB-345 (re-entry) — the AGENTS list is the sixth configuration', () => {
  // The surface the review returned the ticket over. `Agent/Component/agent-list`
  // was a hand-written per-entity renderer with a fixed `LABEL_WIDTH = 32`, a
  // `width: 0` second column, no `bold` anywhere and a `selected` sitting on each
  // cell's CONTENT — so all three of this ticket's findings were live on the
  // Ticket-Agents tab while the other five surfaces had them fixed. It is a
  // `ListTable` configuration now, and the three claims are asserted here on the
  // real renderer because none of them is visible to a text-level harness.
  const AGENT: HostedAgent = {
    id: 'p1',
    group: 'keytec-bakers-platform',
    // 45 columns — an ordinary agent label (they are built from the ticket's own
    // title by `shortName`), and longer than the 32 the old renderer fixed the
    // column at. A fixed 32 cut this every time; a grower shows it whole.
    label: 'BB-345 render every list through one tab',
  };

  const agentsAt = async (
    columns: number,
    selectedIndex = -1,
    rows: HostedAgent[] = [AGENT],
  ): Promise<BareHarness> => {
    const harness = await createHarness({ columns, rows: 6 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(AGENT_TABLE, rows, undefined, { selectedIndex }),
    );
    await harness.renderOnce();
    return harness;
  };

  const agentChars = async (
    columns: number,
    rows: HostedAgent[] = [AGENT],
  ): Promise<string[]> =>
    (await agentsAt(columns, -1, rows))
      .captureCharFrame()
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''));

  it('has bold header cells where its data row has none (finding 2)', async () => {
    const lines = (await agentsAt(120)).captureSpans().lines as {
      spans: { text: string; attributes: number }[];
    }[];
    expect(boldCells(lines[0])).toBeGreaterThan(0);
    expect(boldCells(lines[1])).toBe(0);
  });

  for (const columns of [80, 120, 160]) {
    it(`the selected agent row is ONE FOREGROUND_ACTIVE fg run across ${columns} columns`, async () => {
      // Finding 1 on this tab: `selected` was a text attribute on each cell's
      // content and the cells were not filled, so the highlight came back as one
      // fragment per cell with a hole between them. BB-375: FOREGROUND_ACTIVE fg.
      const lines = (await agentsAt(columns, 0)).captureSpans()
        .lines as SpanLine[];
      const run = runOf(lines[1], isActiveSelection);
      expect(run.fragments).toBe(1);
      expect(run.start).toBe(0);
      expect(run.marked).toBe(run.painted);
      expect(run.painted).toBe(columns);
    });

    it(`AGENT grows rather than cutting at 32, at ${columns} columns (finding 3)`, async () => {
      const frame = await agentChars(columns);
      // The label is whole and unmarked — the old fixed 32 cut it to
      // `BB-345 render every list thro…` at every width, including 160.
      expect(frame[1]).toContain(AGENT.label);
      expect(frame[1]).not.toContain('…');
      // The project slug behind it is whole too.
      expect(frame[1]).toContain(AGENT.group);
      // Nothing is painted past the right edge.
      for (const line of frame)
        expect(line.length).toBeLessThanOrEqual(columns);
      // …and the columns are in the declared order.
      expect(frame[0]?.indexOf('PROJECT')).toBeGreaterThan(
        frame[0]?.indexOf('AGENT') ?? -1,
      );
    });
  }

  it('the columns do not move when the page`s data changes (spec D4)', async () => {
    // The same guard the ticket list carries: a width read off the widest cell
    // of the current page would satisfy AC 4 and shift the columns under the
    // operator on every refresh.
    const short = await agentChars(120, [{ ...AGENT, label: 'x' }]);
    const long = await agentChars(120, [AGENT]);
    expect(short[0]?.indexOf('PROJECT')).toBe(long[0]?.indexOf('PROJECT'));
    expect(short[0]?.indexOf('PROJECT')).toBeGreaterThan(0);
  });
});

describe('BB-345 (re-entry) — a `width: 0` column HONOURS its `max`', () => {
  // The latent trap the review found in a brand-new API, and the one behaviour
  // change of this round outside the agents list. `tableRow` computes a grower's
  // ellipsis against `column.max`, so a `width: 0, max: N` column MARKED its cut
  // at N — while `textNode`'s `width === 0` branch spread only `minWidth`, so the
  // cap itself was never handed to Yoga and the cell grew straight past it. The
  // marked cut and the applied cap disagreed. No shipped column declares the
  // pair today, which is exactly why it is pinned before one does.
  const probe = (max?: number) =>
    ({
      noun: 'capped',
      emptyMessage: 'none',
      columns: [
        {
          key: 'a',
          label: 'A',
          width: 0,
          ...(max === undefined ? {} : { max }),
          fields: [],
          get: () => 'a'.repeat(60),
        },
        { key: 'b', label: 'B', width: 6, fields: [], get: () => '<B>' },
      ],
    }) as ListTable<{ id: string }, void>;

  const lineAt = async (
    columns: number,
    table: ListTable<{ id: string }, void>,
  ): Promise<string> => {
    const harness = await createHarness({ columns, rows: 4 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(table, [{ id: 'r1' }], undefined, { selectedIndex: -1 }),
    );
    await harness.renderOnce();
    return harness.captureCharFrame().split('\n')[1] ?? '';
  };

  it('resolves to at most `max` columns AND marks the cut it made', async () => {
    // Read off the painted frame: B's cell begins one column after A's ends, so
    // where B starts IS A's resolved width plus its separator. Without the cap A
    // took the whole surplus and B started at column 35 of a 40-column row.
    const line = await lineAt(40, probe(9));
    expect(line.indexOf('<B>')).toBe(10);
    // …and the value says it was cut, which is the half that already worked.
    expect(line).toContain(`${'a'.repeat(8)}…`);
  });

  it('and without a `max` the same column still takes the surplus', async () => {
    // The control: the cap is what changed, not the trailing column's nature. A
    // takes 33 of the 40 columns — B's cell is its own 6 plus the separator it
    // owns — so B's glyphs start at 34.
    const line = await lineAt(40, probe());
    expect(line.indexOf('<B>')).toBe(34);
  });
});

describe('BB-345 (re-entry) — a SHRINKABLE budgeted column still paints', () => {
  // The OTHER half of the `width` x `min`/`max`/`grow` matrix, and the same class
  // of trap as the dropped `maxWidth` above — found by re-reading the two files
  // against each other rather than by a failing screen.
  //
  // A `min` sets `flexShrink: 1`, so a `{ width, min }` column with no `grow`
  // can resolve BELOW its declared width. `cellFill` nonetheless pads it to that
  // full declared width, because the pad is what the row's highlight rides on.
  // Those two facts together mean the content OVERFLOWS the resolved cell — and
  // before this fix such a cell carried `truncate: true` and no `wrapMode`, so
  // the renderer WORD-WRAPPED the overflow and `height: 1` drew the first
  // wrapped line only. `Entity/collection.ts` records the measured outcome: a
  // 14-column cell holding ` qualification` plus surplus blanks "broke after the
  // leading space and painted BLANK" — the value gone entirely, not merely cut.
  //
  // Worse than the `max` case, then: that one painted too WIDE, this one paints
  // NOTHING. No shipped column declares the pair — `CONDUCTOR_TABLE.name` is the
  // tree's only `min` and it also grows — so this is pinned before one does.
  const squeezed = {
    noun: 'squeezed',
    emptyMessage: 'none',
    columns: [
      // Two fixed columns wide enough that the row cannot fit, so Yoga MUST take
      // columns off whichever cell allows it.
      // A fixed column with no `min`, so `flexShrink: 0` — Yoga cannot take
      // columns off it, and every column of the overflow must come off Z.
      {
        key: 'x',
        label: 'X',
        width: 20,
        fields: [],
        get: () => 'x'.repeat(20),
      },
      // The shrinkable one. Its value carries a SPACE on purpose: the default
      // wrap breaks at a word boundary, and a leading separator followed by a
      // word longer than the resolved cell is exactly the shape that paints
      // blank — the break falls after the separator and the first wrapped line
      // is one blank column.
      {
        key: 'z',
        label: 'Z',
        width: 24,
        min: 6,
        fields: [],
        get: () => 'qualification x',
      },
    ],
  } as ListTable<{ id: string }, void>;

  // THE GEOMETRY IS THE TEST, so it is derived here rather than tuned until it
  // passed. A first attempt used two 20-column fixed cells at a 40-column
  // terminal and proved nothing: Z was pushed off the right edge entirely, so
  // the frame was blank where the cell should be for a reason that has nothing
  // to do with wrapping. The case has to leave the cell ON SCREEN and SHRUNK.
  //
  //   X's cell     = 20            (first column, no separator)
  //   Z's cell     = 24 + 1 = 25   (its own separator column)
  //   row's basis  = 45 at a 30-column terminal, so free space is -15
  //   Z is the only shrinkable item, and its floor is 6 + 1 = 7
  //   => Z resolves to 25 - 15 = 10, above its floor, and occupies columns 21-30
  //
  // `cellFill` pads Z's content to its DECLARED 25 columns, so 15 of them
  // overflow a cell that resolved to 10. Z's value is 15 columns and its cell
  // budget is 24, so `cellText` marks nothing — the whole value is there to be
  // painted, and whether any of it reaches the screen is decided entirely by how
  // the overflow is cut. ` qualification` is 14 columns against a resolved 10,
  // so a word wrap breaks after the leading separator and paints NOTHING; a hard
  // clip paints ` qualifica`.
  it('paints its value when the row is squeezed past its budget', async () => {
    const harness = await createHarness({ columns: 30, rows: 4 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(squeezed, [{ id: 'r1' }], undefined, { selectedIndex: -1 }),
    );
    await harness.renderOnce();
    const line = harness.captureCharFrame().split('\n')[1] ?? '';
    // The assertion that fails without the fix: the shrunk cell paints its value
    // rather than one blank column.
    expect(line).toContain('qualific');
    // And the column before it is untouched — the squeeze came out of the cell
    // that declared a floor, which is what `min` is for.
    expect(line).toContain('x'.repeat(20));
    // Nothing is painted past the terminal's own edge.
    expect(line.replace(/\s+$/, '').length).toBeLessThanOrEqual(30);
  });
});

describe('BB-345 (pass 3) — a `max` BELOW the width caps the cell AND the cut', () => {
  // The third latent trap of the A5/A7 family, and the last cell of the
  // `width` x `min`/`max`/`grow` matrix nothing pinned. Found the same way the
  // other two were: by reading `tableRow` and `textNode` against each other,
  // not off a broken screen.
  //
  // A `{ width: N, max: M }` column with `M < N` and no `min`/`grow` was BOTH
  // halves of the two traps above at once:
  //
  //  - A7's half. Yoga's `maxWidth` clamps regardless of `flexShrink: 0`, so
  //    the cell resolves to `M` while `cellFill` pads its content to `N`. The
  //    cell was not `flexible` — the predicate read `grow > 0 || min !== undefined`
  //    and a cap is neither — so it kept `truncate: true` with NO `wrapMode`,
  //    the pad overflowed, the renderer word-wrapped it and `height: 1` drew
  //    the first wrapped line only. With the value's first break falling after
  //    the leading separator, the cell painted BLANK.
  //  - A5's half, on the opposite branch. `tableRow` computed a non-grower's
  //    `cut` from `column.width`, so the ellipsis was marked at `N` while the
  //    applied cap was `M`: marked cut and applied cap disagreed silently, and
  //    a value between `M` and `N` columns long was not marked as cut at all.
  //
  // The fix makes the two files agree at the source instead of widening the
  // predicate alone: `tableRow` derives the width a non-growing column REALLY
  // declares — `max(min ?? 0, min(width, max ?? width))` — and hands that one
  // number to BOTH the fill and the cut. `flexible` is widened too, for the
  // sake of `textNode`'s callers outside `tableRow`, but on its own it would
  // have fixed the blank cell and left the ellipsis marked in the wrong place.
  //
  // Latent today: no shipped column declares a `max` at all (`rg 'max:' src/`
  // finds only a `stats-panel` function parameter and `tableRow`'s own
  // pass-through), so this is pinned before one does.
  const capped = (max: number) =>
    ({
      noun: 'capped',
      emptyMessage: 'none',
      columns: [
        // A fixed column with no bounds, so `flexShrink: 0` and nothing about it
        // can move: it anchors the frame the assertions below read positions off.
        {
          key: 'x',
          label: 'X',
          width: 8,
          fields: [],
          get: () => 'x'.repeat(8),
        },
        // The capped one. Its value is 13 columns — longer than the cap, SHORTER
        // than the declared width — which is what makes the marked-cut half
        // visible: cut against 14 it is not marked at all, cut against 6 it is.
        // It is one unbroken word, so the default word wrap's only break point
        // is after the leading separator, which is the shape that paints blank.
        {
          key: 'c',
          label: 'C',
          width: 14,
          max,
          fields: [],
          get: () => 'qualification',
        },
        // A third column, so the frame states C's RESOLVED width as a position
        // rather than leaving it to be reasoned about.
        { key: 't', label: 'T', width: 5, fields: [], get: () => '<T>' },
      ],
    }) as ListTable<{ id: string }, void>;

  // THE GEOMETRY IS THE TEST, so it is derived rather than tuned until it passed
  // — the A7 block above records what a probe whose cell was pushed off the
  // right edge proves (nothing: it is blank either way). At 40 columns nothing
  // is squeezed and no column grows, so the CAP is the only thing that can
  // narrow C, and every position below is an arithmetic consequence of it:
  //
  //   X's cell  = 8              (first column, no separator)  -> 0..7
  //   C's cell  = min(14, M) + 1 (its own separator column)
  //   T's cell  = 5 + 1 = 6
  //   row basis = 8 + 15 + 6 = 29 at 40 columns, so free space is +11 and
  //   no item shrinks; C is clamped by `maxWidth` alone.
  //
  // With M = 6: C resolves to 7 -> 8..14, T's glyphs at 16.
  // With M = 20 (above the basis): C resolves to 15 -> 8..22, T's glyphs at 24.
  const lineAt = async (
    table: ListTable<{ id: string }, void>,
  ): Promise<string> => {
    const harness = await createHarness({ columns: 40, rows: 4 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(table, [{ id: 'r1' }], undefined, { selectedIndex: -1 }),
    );
    await harness.renderOnce();
    return harness.captureCharFrame().split('\n')[1] ?? '';
  };

  it('paints its value, cut at the CAP rather than at the declared width', async () => {
    const line = await lineAt(capped(6));
    // The assertion that fails without the fix, and it fails BLANK: the whole
    // 15-column fill overflowed a 7-column cell and the wrap kept the leading
    // separator only.
    expect(line).toContain('quali…');
    // Where it starts — one column into C's cell, after the separator C owns.
    expect(line.indexOf('quali…')).toBe(9);
    // The marked cut is at the cap, not at the basis, and it is the first
    // assertion above that catches a fix which gets this wrong. MEASURED with
    // `flexible` widened and `tableRow` NOT clamped (d0-red.txt RUN 2a): the
    // cell hard-clips and the frame reads `xxxxxxxx qualif <T>` — the value
    // survives, but the cut is UNMARKED in a cell whose code believes it marked
    // one at 14. This line is the guard for the opposite mistake, a fix that
    // stopped applying the cap at all: then the cell would be 15 wide and paint
    // the whole word.
    expect(line).not.toContain('qualification');
  });

  it('resolves to the cap, which is the half that already worked', async () => {
    // The control, and a real measurement rather than a reading of the typings:
    // it is the only thing here that says Yoga's `maxWidth` clamps a cell whose
    // `flexShrink` is 0. T's glyphs land at 16 because C took 7 of the 40
    // columns; uncapped it would have taken 15 and T would start at 24.
    expect((await lineAt(capped(6))).indexOf('<T>')).toBe(16);
  });

  it('a cap ABOVE the declared width changes nothing', async () => {
    // The other control: the fix clamps the fill and the cut to
    // `min(width, max)`, so for a cap the basis never reaches it is a no-op —
    // C keeps its 15 columns and its value is not marked as cut.
    const line = await lineAt(capped(20));
    expect(line).toContain('qualification');
    expect(line.indexOf('qualification')).toBe(9);
    expect(line.indexOf('<T>')).toBe(24);
  });
});

describe('BB-345 (pass 3) — a `min` ABOVE the width is filled to the floor', () => {
  // The cosmetic sibling of the trap above, and the same disagreement between
  // the two files read from the other side: a `{ width: 5, min: 20 }` column
  // resolves to its FLOOR — `minWidth` wins over the basis — while `cellFill`
  // padded it to the declared 5, so the row's highlight ended 15 columns before
  // the cell did. Cosmetic rather than a lost value, because such a cell is
  // already `flexible` and so already carries `wrapMode: 'none'`: it cannot
  // wrap, it merely leaves columns unpainted.
  //
  // It is the same one-line fix — `tableRow` filling to the width the column
  // really declares — which is why it is pinned here rather than deferred.
  const floored = {
    noun: 'floored',
    emptyMessage: 'none',
    columns: [
      { key: 'x', label: 'X', width: 8, fields: [], get: () => 'x'.repeat(8) },
      // Its value is 2 columns, far inside every bound, so nothing here is
      // about cutting: what is measured is how far the FILL reaches.
      { key: 'f', label: 'F', width: 5, min: 20, fields: [], get: () => 'mm' },
    ],
  } as ListTable<{ id: string }, void>;

  // GEOMETRY, derived:
  //
  //   X's cell   = 8                       -> 0..7
  //   F's basis  = 5 + 1 = 6, floored by `minWidth` = 20 + 1 = 21
  //   row total  = 8 + 21 = 29 at 40 columns, so free space is +11: F does not
  //   shrink (there is surplus) and does not grow (`flexGrow` is 0), and 21 is
  //   what it resolves to.
  //
  // A selected row is what makes the fill's reach readable at all — the pad is
  // blanks, and only FOREGROUND_ACTIVE fg says which columns carry them (BB-375).
  // Padded to the declared 5 the bar marks 8 + 6 = 14 columns; padded to the
  // floor it marks 8 + 21 = 29. That the bar CAN reach 29 is itself the
  // measurement that F resolved to 21: `wrapMode: 'none'` would hard-clip the
  // fill at the cell's own edge, so a cell that resolved to 6 could not paint
  // 21 FOREGROUND_ACTIVE columns however long the pad were made.
  it('the highlight reaches the cell`s own edge rather than its basis', async () => {
    const harness = await createHarness({ columns: 40, rows: 4 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      listTableTree(floored, [{ id: 'r1' }], undefined, { selectedIndex: 0 }),
    );
    await harness.renderOnce();
    const lines = harness.captureSpans().lines as SpanLine[];
    const run = runOf(lines[1], isActiveSelection);
    expect(run.fragments).toBe(1);
    expect(run.start).toBe(0);
    expect(run.marked).toBe(29);
    // …and the glyphs did not move: a longer fill must not shift the value it
    // pads. Index 9 is one column into F's cell, after the separator it owns.
    const line = harness.captureCharFrame().split('\n')[1] ?? '';
    expect(line.indexOf('mm')).toBe(9);
  });
});

describe('BB-345 (pass 3) — `textNode` is safe for a caller that is not `tableRow`', () => {
  // The SECOND half of the same fix, pinned separately because the two halves
  // are pinned by different measurements — and measuring that is what says which
  // half does what.
  //
  // MEASURED: with `tableRow`'s
  // clamp in place and `flexible` reverted, the two probes above are 36/36 GREEN.
  // The clamp alone carries every cell the table builds, so nothing in the list
  // surface can discriminate the widened predicate. That is not a reason to drop
  // it: `textNode` is exported, and its OTHER callers hand their props over
  // directly — `cellsRow` here in `lib/vnode.ts`, the chrome, `section-list`,
  // `Widget/render`, five screens. None of them passes a `max` today (`rg 'max:'`
  // over every one of them finds nothing), so the trap is unreachable through
  // them; the moment one does pass a cap below its width, it is the node itself
  // that has to be safe, and no configuration-level test can say whether it is.
  //
  // So this probe calls `textNode` directly, which is also the only honest way to
  // pin a defence for a caller that does not exist yet.
  //
  // GEOMETRY, derived:
  //
  //   A: width 10, max 5   -> `maxWidth` clamps the basis, A resolves to 5
  //   B: width 6           -> the cells touch (`seamlessRowNode`), so B is 5..10
  //   A's content is 11 columns, so 6 of them overflow a 5-column cell.
  //
  // `ab cdefghij` has exactly one word boundary, and it is INSIDE the resolved
  // cell: a word wrap breaks there and paints `ab`, leaving columns 2..4 blank; a
  // hard clip paints `ab cd`. Three columns of a five-column cell is the whole
  // difference, and it is the same defect the two probes above measure at their
  // own scale.
  it('a `max` below the width hard-clips rather than word-wrapping', async () => {
    const harness = await createHarness({ columns: 20, rows: 3 });
    live.push(harness);
    mountTree(
      harness.renderer,
      harness.root,
      columnNode(
        'direct',
        seamlessRowNode(
          'direct-row',
          textNode({
            id: 'direct-a',
            content: 'ab cdefghij',
            width: 10,
            max: 5,
          }),
          textNode({ id: 'direct-b', content: '<B>', width: 6 }),
        ),
      ),
    );
    await harness.renderOnce();
    const line = harness.captureCharFrame().split('\n')[0] ?? '';
    // The assertion that fails without the widened predicate, and it fails with
    // three blank columns where the value should be: `ab   <B>`.
    expect(line.slice(0, 8)).toBe('ab cd<B>');
  });
});
