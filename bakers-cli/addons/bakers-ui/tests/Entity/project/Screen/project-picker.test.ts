import { describe, expect, it, vi } from 'vitest';
import {
  ProjectPickerScreen,
  projectPickerInputContext,
} from '../../../../src/Entity/project/Screen/project-picker.js';
import { ContextBag } from '../../../../src/Routing/context.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { cellValues, idsOf } from '../../../render-tree.js';

// BB-340 Task 9 Step 4 — the project picker's two surfaces, and the one that
// must NOT move.
//
// F5: this is one of the three screens with their own `renderNonInteractive()`,
// a DELIBERATELY DIFFERENT output for a pipe rather than a rendering of the
// screen. It stays `string[]` and its bytes stay exactly what they were, so the
// rows below are pinned LINE FOR LINE against a capture taken from the built
// `dist/` BEFORE the first source change of this step. A snapshot taken afterwards would agree
// with whatever the change produced, which is the difference between a test and
// a confirmation.
//
// The interactive surface is the tree, and it is built from the SAME keyed rows,
// so the two pictures cannot disagree: the pipe prints `row.text` and the body
// keys `row.text` into a node per row.

const CANDIDATES = [
  { id: 'p1', name: 'shop-de' },
  { id: 'p2', name: 'shop-at' },
  { id: 'p3', name: 'shop-ch' },
];

const HINT = 'Run bakers ui project:<name> to choose directly.';

const context = (
  input?: { candidates: typeof CANDIDATES; repo: string },
  overrides: Partial<ScreenContext> = {},
): ScreenContext => ({
  sessionGeneration: 1,
  requestDraw: vi.fn(),
  isActive: () => true,
  ...(input
    ? {
        contexts: ContextBag.empty().set(projectPickerInputContext, input),
      }
    : {}),
  ...overrides,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const opened = async (
  input?: { candidates: typeof CANDIDATES; repo: string },
  keys: readonly string[] = [],
): Promise<{ screen: ProjectPickerScreen; ctx: ScreenContext }> => {
  const screen = new ProjectPickerScreen();
  const ctx = context(input);
  screen.enter(ctx);
  await tick(); // AsyncScreen load resolves from navigation context
  for (const key of keys) screen.handleInput(key, ctx);
  return { screen, ctx };
};

describe('the pipe output is byte-identical to the pre-conversion capture (F5)', () => {
  it('never entered — no repo, no candidates', async () => {
    const { screen } = await opened();
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim  — which one?',
      '',
      'No projects.',
      '',
      HINT,
    ]);
  });

  it('entered with an empty candidate list', async () => {
    const { screen } = await opened({
      candidates: [],
      repo: 'host/keytec/none',
    });
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim host/keytec/none — which one?',
      '',
      'No projects.',
      '',
      HINT,
    ]);
  });

  it('one candidate — marked, because the cursor is on it', async () => {
    const { screen } = await opened({
      candidates: [{ id: 'p1', name: 'shop-de' }],
      repo: 'host/keytec/one',
    });
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim host/keytec/one — which one?',
      '',
      '▸ shop-de',
      '',
      HINT,
    ]);
  });

  it('three candidates, on the first — the state the picker opens in', async () => {
    const { screen } = await opened({
      candidates: CANDIDATES,
      repo: 'host/keytec/shop',
    });
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim host/keytec/shop — which one?',
      '',
      '▸ shop-de',
      '  shop-at',
      '  shop-ch',
      '',
      HINT,
    ]);
  });

  it('three candidates, after j — and after down, which is the same move', async () => {
    const expected = [
      'Several bakers projects claim host/keytec/shop — which one?',
      '',
      '  shop-de',
      '▸ shop-at',
      '  shop-ch',
      '',
      HINT,
    ];
    const input = { candidates: CANDIDATES, repo: 'host/keytec/shop' };
    expect((await opened(input, ['j'])).screen.renderNonInteractive()).toEqual(
      expected,
    );
    expect(
      (
        await opened(input, ['down', 'down', 'up'])
      ).screen.renderNonInteractive(),
    ).toEqual(expected);
  });

  it('three candidates, on the last — and j past the end is clamped there', async () => {
    const expected = [
      'Several bakers projects claim host/keytec/shop — which one?',
      '',
      '  shop-de',
      '  shop-at',
      '▸ shop-ch',
      '',
      HINT,
    ];
    const input = { candidates: CANDIDATES, repo: 'host/keytec/shop' };
    expect(
      (await opened(input, ['j', 'j'])).screen.renderNonInteractive(),
    ).toEqual(expected);
    expect(
      (await opened(input, ['j', 'j', 'j', 'j'])).screen.renderNonInteractive(),
    ).toEqual(expected);
  });

  it('k past the start is clamped onto the first candidate', async () => {
    const { screen } = await opened(
      { candidates: CANDIDATES, repo: 'host/keytec/shop' },
      ['k', 'k'],
    );
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim host/keytec/shop — which one?',
      '',
      '▸ shop-de',
      '  shop-at',
      '  shop-ch',
      '',
      HINT,
    ]);
  });

  it('after reset() the picker prints the empty form again', async () => {
    const { screen } = await opened({
      candidates: CANDIDATES,
      repo: 'host/keytec/shop',
    });
    screen.reset();
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim  — which one?',
      '',
      'No projects.',
      '',
      HINT,
    ]);
  });

  it('a wide-character candidate and repo are passed through untouched', async () => {
    // Nothing on this path measures display columns, and this is what says so:
    // the CJK name and the accented repo reach the pipe as they were written.
    const { screen } = await opened({
      candidates: [{ id: 'p9', name: 'läden-日本' }],
      repo: 'hôst/käytec/shöp',
    });
    expect(screen.renderNonInteractive()).toEqual([
      'Several bakers projects claim hôst/käytec/shöp — which one?',
      '',
      '▸ läden-日本',
      '',
      HINT,
    ]);
  });
});

describe('the interactive surface is a tree keyed on the candidates (D1/R4)', () => {
  it('keys each candidate row on the project, never on its position', async () => {
    const { screen, ctx } = await opened({
      candidates: CANDIDATES,
      repo: 'host/keytec/shop',
    });
    const ids = idsOf(screen.present(ctx).body);
    // BB-345 R3 — THE SPELLING CHANGED ON PURPOSE, and this assertion moved
    // with it rather than being relaxed. The picker used to key its rows
    // `project-picker-candidate-<id>` by hand while `projectPickerRowIds`
    // re-derived the same string, which is the drift `rowNodeId` exists to
    // prevent: the two could disagree and the only symptom would be a click
    // that resolves to nothing. Both are now `rowNodeId(table.noun, row.id)` —
    // one expression, read off one configuration.
    for (const candidate of CANDIDATES)
      expect(ids).toContain(`project-picker-row-${candidate.id}`);
    expect(ids.some((id) => id.startsWith('project-picker-candidate-'))).toBe(
      false,
    );
    // A positional key patches one project's name onto another's node after a
    // reorder, with nothing on screen to say so.
    expect(ids.some((id) => /^project-picker-row-\d+$/.test(id))).toBe(false);
    expect(new Set(ids).size, 'and no id is declared twice').toBe(ids.length);
    // …and the click targets are exactly those rows, in selection order.
    expect(screen.present(ctx).rowIds).toEqual([
      'project-picker-row-p1',
      'project-picker-row-p2',
      'project-picker-row-p3',
    ]);
  });

  it('declares no header row — it is a question, not a record set', async () => {
    // BB-345 D6/D8, and the one list that opts out. The operator confirmed it
    // against the direction that every other table gets a header: this list's
    // single column has an EMPTY label, so a header would paint an empty bold
    // bar above a question. The rows are choices, not records.
    const { screen, ctx } = await opened({
      candidates: CANDIDATES,
      repo: 'host/keytec/shop',
    });
    const ids = idsOf(screen.present(ctx).body);
    expect(ids.some((id) => id.startsWith('project-picker-header'))).toBe(
      false,
    );
    // The two heading rows are the SCREEN's, composed around the table — they
    // are not rows of the list, which is why they carry no candidate and no
    // entry in `rowIds`.
    // Sliced off the picker's OWN ids: the presentation wraps every body in the
    // kernel's `region-body-window`, which is not this screen's to state.
    // BB-375 — heading lives in chrome meta; body frame is region-body.
    expect(ids.some((id) => id.includes('project-picker-frame'))).toBe(false);
    expect(ids.some((id) => id.startsWith('project-picker-row-'))).toBe(true);
  });

  it('keeps exactly one marker when the selection is out of range', async () => {
    // Carried over from the deleted component's own case: the marker is what
    // says "selected" to the pipe, which has no attributes, so losing it would
    // leave a piped picker with no answer to "which one is chosen?". The
    // clamping lives in the screen now, because the screen owns the index.
    const { screen, ctx } = await opened({
      candidates: CANDIDATES,
      repo: 'host/keytec/shop',
    });
    for (const index of [-5, 99]) {
      screen.selectedIndex = index;
      const marked = cellValues(screen.present(ctx).body).filter((row) =>
        row.trimStart().startsWith('▸'),
      );
      expect(marked, `selection ${index}`).toHaveLength(1);
    }
  });

  it('follows a reordered candidate list by the project, not by the row', async () => {
    const reversed = [...CANDIDATES].reverse();
    const { screen, ctx } = await opened({
      candidates: reversed,
      repo: 'host/keytec/shop',
    });
    const body = screen.present(ctx).body;
    const rows = cellValues(body);
    expect(rows.join('\n')).toMatch(/▸ shop-ch/);
    expect(rows.join('\n')).toMatch(/shop-at/);
    expect(rows.join('\n')).toMatch(/shop-de/);
    expect(screen.present(ctx).meta ?? '').toContain('host/keytec/shop');
    const ids = idsOf(body);
    expect(ids.indexOf('project-picker-row-p3')).toBeLessThan(
      ids.indexOf('project-picker-row-p1'),
    );
  });

  it('shows the same rows the pipe prints, minus the pipe`s own hint', async () => {
    // One keyed source, two shapes: the body is the rows keyed into nodes and
    // the pipe is the rows plus the direct-command hint the screen adds. So the
    // two pictures cannot drift apart while both exist.
    const { screen, ctx } = await opened(
      { candidates: CANDIDATES, repo: 'host/keytec/shop' },
      ['j'],
    );
    // Pipe still has heading + blank; body is table rows only.
    const pipeRows = screen.renderNonInteractive().slice(2, -2); // drop heading, blank, trailing blank+hint
    expect(cellValues(screen.present(ctx).body)).toEqual(pipeRows);
  });

  it('renders the empty state as a node of its own', async () => {
    const { screen, ctx } = await opened({
      candidates: [],
      repo: 'host/keytec/none',
    });
    expect(idsOf(screen.present(ctx).body)).toContain('project-picker-empty');
    expect(cellValues(screen.present(ctx).body)).toContain('No projects.');
  });

  it('keeps the selected row two rows below the top, where the heading ends', async () => {
    // The claim is unchanged; the way it is stated is not. It used to be
    // `ScreenPresentation.selectedRow`, the absolute row the kernel scrolled to,
    // which every screen computed by counting its own heading rows. Task 12 took
    // that number off the contract: the presentation names the selected row's
    // NODE and the kernel asks the layout where it sits. So the heading and the
    // blank under it are counted HERE, over the tree's own rows — which is the
    // same two rows, read from the thing that draws them.
    const { screen, ctx } = await opened(
      { candidates: CANDIDATES, repo: 'host/keytec/shop' },
      ['j'],
    );
    //
    // BB-345 — TWO EDITS, AND NEITHER LOOSENS THE CLAIM. The row id is
    // `rowNodeId`'s now (R3), and the tree gained the table's own wrapper node
    // between the heading and the first candidate. So "two rows below the top"
    // is counted over the rows that are DRAWN rather than over every id in the
    // tree: a wrapper is not a row, and counting ids would silently absorb one
    // that was. Stated on the drawn rows, the assertion is the stricter of the
    // two — it fails if a heading row goes missing, which an id count would
    // have compensated for.
    const shown = screen.present(ctx);
    const drawn = cellValues(shown.body);
    const selected = shown.rowIds?.[shown.selectedIndex];
    expect(selected, 'the second candidate is the selected row').toBe(
      `project-picker-row-${CANDIDATES[1]?.id}`,
    );
    expect(drawn.some((row) => row.trimStart().startsWith('▸'))).toBe(true);
    expect(shown.selectable).toBe(3);
    expect(shown.selectedIndex).toBe(1);
  });

  it('hands over a tree and no row surface at all (A1)', async () => {
    const { screen, ctx } = await opened({
      candidates: CANDIDATES,
      repo: 'host/keytec/shop',
    });
    expect(screen.present(ctx).lines).toBeUndefined();
  });
});
