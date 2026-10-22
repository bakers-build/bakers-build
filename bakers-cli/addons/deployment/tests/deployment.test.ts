import type { BbRemote } from '@bakers-build/conductor/contract';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  gatherBatch,
  parseIdentifiers,
  registerDeployment,
} from '../src/deployment.js';

vi.mock('@bakers-build/core', async (orig) => {
  const actual = await orig<typeof import('@bakers-build/core')>();
  return { ...actual, exec: vi.fn() };
});
const { exec } = await import('@bakers-build/core');

const LOG = [
  'a1 feat(BB-134): thing',
  'b2 fix: no identifier here',
  'c3 BB-135 and BB-134 again',
  'd4 chore(BB-999): unknown ticket',
].join('\n');

describe('parseIdentifiers', () => {
  it('dedups, preserves first-seen order, ignores lines without ids', () => {
    expect(parseIdentifiers(LOG)).toEqual(['BB-134', 'BB-135', 'BB-999']);
  });

  // BB-392 D1/AC-2: the parse must find the identifier the commit convention
  // prescribes on a project whose key is not bakers.build, or the ticket drops out of
  // the release batch with no error anywhere.
  it('finds an identifier whose project key is not bakers.build', () => {
    expect(parseIdentifiers('a1 fix(shop#7): thing\n\nref:SHOP-42')).toEqual([
      'SHOP-42',
    ]);
  });

  // Guards the fix must not break: the legacy `KEY-nnn:` subject form still
  // carries the whole merged history, and prose tokens shaped like an
  // identifier are not identifiers.
  it('still finds the legacy bare identifier and matches no prose token', () => {
    expect(parseIdentifiers('08db125 BB-375: TUI chrome')).toEqual(['BB-375']);
    expect(
      parseIdentifiers('body cites AC-1, UTF-8 and SHA-256 but no ticket'),
    ).toEqual([]);
  });

  // What pins the scope and subject anchors to the head of a line rather than
  // to any `Token:`. The two body shapes below — a bullet `- AC-2: …` and a
  // line `(AC-5): parent = …` — both occur in this repository's history, and
  // a loosened anchor admits `AC` from them. It has to be tested next to a
  // real `ref:` trailer: a delta whose keys are all phantom returns nothing
  // either way, so only a batch that legitimately has an identifier shows the
  // six extra ones a mid-line anchor would drag in beside it.
  it('admits no key from a mid-line `Token:` beside a real trailer', () => {
    expect(
      parseIdentifiers('a1 fix: x\n\n- AC-2: bullet\n(AC-5): line\n\nref:BB-1'),
    ).toEqual(['BB-1']);
  });
});

describe('gatherBatch', () => {
  it('resolves known ids, reports unresolved, never throws', async () => {
    const known: Record<string, { uuid: string; title: string }> = {
      'BB-134': { uuid: 'u134', title: 'A' },
      'BB-135': { uuid: 'u135', title: 'B' },
    };
    const res = await gatherBatch({
      sinceRef: 'main',
      toRef: 'release/x',
      gitLog: LOG,
      resolve: async (id) => known[id] ?? null,
    });
    expect(res.range).toBe('main..release/x');
    expect(res.resolved).toEqual([
      { identifier: 'BB-134', uuid: 'u134', title: 'A' },
      { identifier: 'BB-135', uuid: 'u135', title: 'B' },
    ]);
    expect(res.unresolved).toEqual(['BB-999']);
  });
});

describe('bakers deployment tickets (CLI wiring)', () => {
  it('drives exec -> gatherBatch -> resolve and prints the JSON result', async () => {
    vi.mocked(exec).mockResolvedValue(
      '\x1ea1 feat(BB-134): thing\n\x1eb2 chore(BB-999): unknown',
    );
    const remote = {
      resolveTicketByIdentifier: async (_project: string, id: string) =>
        id === 'BB-134' ? { uuid: 'u134', title: 'A' } : null,
    } as unknown as BbRemote;

    const program = new Command();
    program.exitOverride();
    registerDeployment(
      program,
      async () => remote,
      async () => 'bakers',
      () => '/repo',
    );

    const logs: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((m?: unknown) => void logs.push(String(m)));
    await program.parseAsync(
      ['deployment', 'tickets', '--since', 'main', '--to', 'origin/staging'],
      { from: 'user' },
    );
    spy.mockRestore();

    // wiring: the command shells out with the correct git range (incl. the %x1e
    // record separator) at the resolved cwd.
    expect(exec).toHaveBeenCalledWith(
      'git',
      ['log', '--format=%x1e%H %s%n%b', 'main..origin/staging'],
      { cwd: '/repo' },
    );
    const out = JSON.parse(logs[0]);
    expect(out.range).toBe('main..origin/staging');
    expect(out.resolved).toEqual([
      { identifier: 'BB-134', uuid: 'u134', title: 'A' },
    ]);
    expect(out.unresolved).toEqual(['BB-999']);
  });
});
