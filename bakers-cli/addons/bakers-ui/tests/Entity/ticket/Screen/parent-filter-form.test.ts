import { describe, expect, it, vi } from 'vitest';
import { ParentFilterScreen } from '../../../../src/Entity/ticket/Screen/parent-filter-form.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import type { TuiOptions } from '../../../../src/types.js';
import { renderTree } from '../../../render-tree.js';
import { fakeClient } from '../../../test-support.js';

// BB-284 D4 — the parent-filter picker screen, driven directly the way
// `tests/Screen/form-screens.test.ts` drives the edit form. (The end-to-end
// `p` key wiring through the kernel is Task 4's; what is pinned HERE is the
// screen's own contract: what it reads, and what it hands back.)

const PROJECT = { id: 'proj-1', name: 'bakers', slug: 'bakers' };
const TICKETS = 'bb_ticket/bb_ticket';

const ticket = (id: string, identifier: string, title: string) => ({
  type: 'bb_ticket--bb_ticket',
  id,
  attributes: { identifier, title },
});

const doc = {
  [TICKETS]: {
    data: [
      ticket('t1', 'BB-236', 'a declared form kernel'),
      ticket('t2', 'BB-257', 'the New-ticket popup'),
      ticket('t3', 'BB-137', 'multiple conductors per repo'),
    ],
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** A debounce that fires synchronously — no test sleeps past a real timer. */
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

function context(overrides: Partial<ScreenContext> = {}): ScreenContext {
  return {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    options: { debounce: immediate } as TuiOptions,
    ...overrides,
  };
}

// BB-340 — the picker hands over a TREE, so its text is read back out of the
// nodes rather than off a `lines` surface it no longer has.
const frameOf = (screen: ParentFilterScreen, ctx: ScreenContext): string =>
  renderTree(screen.present(ctx).body).join('\n');

const queryOf = (params: unknown): string =>
  decodeURIComponent((params as { getQueryString(): string }).getQueryString());

async function open() {
  const client = fakeClient({ documents: doc });
  const back = vi.fn(() => true);
  const screen = new ParentFilterScreen();
  const ctx = context({
    services: { client } as ScreenContext['services'],
    project: PROJECT,
    back,
  });
  screen.enter(ctx);
  await tick();
  return { client, back, screen, ctx };
}

describe('ParentFilterScreen', () => {
  it('is a modal route under the project ticket list', () => {
    expect(ParentFilterScreen.route).toMatchObject({
      id: 'project.tickets.parent-filter',
      parent: 'project.tickets',
      presentation: 'modal',
    });
  });

  it('requires services and project context', async () => {
    const screen = new ParentFilterScreen();
    const ctx = context();
    screen.enter(ctx);
    await tick();
    expect(frameOf(screen, ctx)).toContain(
      'Parent filter requires services and project context',
    );
  });

  it('primes the candidate read with the empty query — project-scoped, NO parent filter (AC-4 + R2)', async () => {
    const { client, screen, ctx } = await open();
    expect(frameOf(screen, ctx)).toContain('BB-236 · a declared form kernel');
    // The picker's ONLY ticket read is the shared candidate read: the same
    // builder the ticket list uses, but with `parent: null` always — an active
    // parent filter must never narrow the picker to its own children (F7).
    expect(client.requests.map((r) => r.path)).toEqual([TICKETS]);
    const s = queryOf(client.requests[0]?.params);
    expect(s).toContain('project_id.id');
    expect(s).toContain(PROJECT.id);
    expect(s).not.toContain('filter[parent_id.id]');
  });

  it('typing re-queries the server with the typed fragment, still parent-less', async () => {
    const { client, screen, ctx } = await open();
    const before = client.requests.length;
    for (const char of 'BB-2') screen.handleInput(char, ctx);
    await tick();
    const sent = client.requests.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    const last = queryOf(sent[sent.length - 1]?.params);
    expect(last).toContain('CONTAINS');
    expect(last).toContain('BB-2');
    // Identifier-only: no title predicate, no OR group (BB-284 PM steer).
    expect(last).not.toContain('filter[title]');
    expect(last).not.toContain('filter[search][group]');
    expect(last).toContain(PROJECT.id);
    expect(last).not.toContain('filter[parent_id.id]');
    // …and the rendered suggestions narrowed to the two matches.
    const frame = frameOf(screen, ctx);
    expect(frame).toContain('BB-236 · a declared form kernel');
    expect(frame).toContain('BB-257 · the New-ticket popup');
    expect(frame).not.toContain('BB-137');
  });

  it('Enter on a pick backs with parent-filter-set carrying id + identifier (AC-2/AC-4)', async () => {
    const { back, screen, ctx } = await open();
    for (const char of 'BB-2') screen.handleInput(char, ctx);
    await tick();
    screen.handleInput('right', ctx); // → onto the second match
    screen.handleInput('enter', ctx); // Enter picks AND commits
    expect(back).toHaveBeenCalledWith({
      type: 'parent-filter-set',
      parent: { id: 't2', identifier: 'BB-257' },
    });
  });

  it('Enter with nothing pickable stays open — no result, no phantom id', async () => {
    const { back, screen, ctx } = await open();
    for (const char of 'zzzz') screen.handleInput(char, ctx);
    await tick();
    screen.handleInput('enter', ctx);
    expect(back).not.toHaveBeenCalled();
  });

  it('Esc backs with NO result — the criteria stay as they were', async () => {
    const { back, screen, ctx } = await open();
    screen.handleInput('escape', ctx);
    expect(back).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledWith();
  });

  it('Del on the clearable picker backs with parent-filter-set carrying null (BB-300 D2, AC-3)', async () => {
    const { back, screen, ctx } = await open();
    screen.handleInput('delete', ctx);
    expect(back).toHaveBeenCalledWith({
      type: 'parent-filter-set',
      parent: null,
    });
  });

  it('↑/↓ move the suggestion cursor in the one-field picker (BB-300 D3, AC-4)', async () => {
    const { screen, ctx } = await open();
    expect(frameOf(screen, ctx)).toContain('   ›BB-236');
    screen.handleInput('down', ctx);
    const frame = frameOf(screen, ctx);
    expect(frame).toContain('   ›BB-257 · the New-ticket popup');
    expect(frame).not.toContain('   ›BB-236');
    screen.handleInput('up', ctx);
    expect(frameOf(screen, ctx)).toContain('   ›BB-236');
  });

  it('Tab/Shift+Tab walk the suggestions HERE — this is the picker the docs name (BB-309)', async () => {
    // The screen passes a `KeyContext` carrying its field count
    // (`parent-filter-form.ts:128`), so `\t`/`\x1b[Z` take the same
    // `singleAutocomplete` branch `\x1b[B`/`\x1b[A` take. The sibling case in
    // `who-filter-form.test.ts` is the counterpart: that picker passes no
    // context, so there the two keys are field moves and do nothing. Both are
    // asserted because the documentation distinguishes them.
    const { screen, ctx } = await open();
    expect(frameOf(screen, ctx)).toContain('   ›BB-236');
    screen.handleInput('tab', ctx);
    const frame = frameOf(screen, ctx);
    expect(frame).toContain('   ›BB-257 · the New-ticket popup');
    expect(frame).not.toContain('   ›BB-236');
    screen.handleInput('shift+tab', ctx);
    expect(frameOf(screen, ctx)).toContain('   ›BB-236');
  });
});
