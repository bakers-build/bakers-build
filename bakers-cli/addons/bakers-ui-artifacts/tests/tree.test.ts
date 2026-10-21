import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { artifactRoots, artifactSections } from '../src/tree.js';

/**
 * ONE PATH THE FILESYSTEM REFUSES — everything else falls through to the real
 * `node:fs`, which is the whole point: the claim under test is that a single bad
 * file costs its own row and NOT the listing, and only a fall-through spy can
 * show the neighbours still reading their real bytes.
 *
 * WHY A SPY HERE AND A REAL FILESYSTEM BELOW. The two `chmod` cases further down
 * drive the same code against a real filesystem and a real `EACCES`, which is
 * the more honest reproduction — but root bypasses discretionary access checks,
 * so under uid 0 an unreadable file cannot be made to exist and those cases can
 * only skip. CI runs these suites on `node:22`, as root. These cases are
 * therefore the ones that GATE the behaviour in CI, and they use `ENOENT`
 * deliberately: it is the precise race `entriesOf`'s own comment names — a file
 * unlinked between the walk and the read — and it is the one errno no real
 * filesystem can be made to produce on demand from inside a synchronous walk,
 * because nothing of ours runs between `readdirSync` and the read.
 *
 * `vi.hoisted` because `vi.mock`'s factory is hoisted above this file's
 * bindings; the map has to exist before it runs.
 */
const denied = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  const refuse = (path: unknown, verb: string): void => {
    const code = denied.get(String(path));
    if (code === undefined) return;
    throw Object.assign(
      new Error(
        `${code}: no such file or directory, ${verb} '${String(path)}'`,
      ),
      { code },
    );
  };
  return {
    ...actual,
    statSync: ((path: string) => {
      refuse(path, 'stat');
      return actual.statSync(path);
    }) as typeof actual.statSync,
    readFileSync: ((path: string, options?: unknown) => {
      refuse(path, 'open');
      return actual.readFileSync(path, options as never);
    }) as typeof actual.readFileSync,
  };
});

beforeEach(() => denied.clear());

const fixture = (): string => {
  const root = join(tmpdir(), `bb-373-${process.pid}-${Math.random()}`);
  mkdirSync(join(root, 'assets-ai', 'BB-373', 'vitest'), { recursive: true });
  mkdirSync(join(root, 'assets-ai', 'BB-373', 'playwright', 'logs'), {
    recursive: true,
  });
  mkdirSync(join(root, 'assets-ai', 'BB-373', 'playwright', 'images'), {
    recursive: true,
  });
  writeFileSync(
    join(root, 'assets-ai', 'BB-373', 'vitest', 'store-green.txt'),
    'pnpm vitest run addons/bakers-ui/tests\n12 passed\n',
  );
  writeFileSync(
    join(root, 'assets-ai', 'BB-373', 'playwright', 'logs', 'walk.txt'),
    'pnpm playwright test walk.spec.ts\nok\n',
  );
  writeFileSync(
    join(root, 'assets-ai', 'BB-373', 'playwright', 'images', 'shot.png'),
    'not really a png',
  );
  return root;
};

const rootsOf = (root: string): string[] => artifactRoots(root, 'BB-373', '');

// The two roots, in order — the operator's checkout, then the ticket's worktree.
it('probes the checkout, then the worktree derived from the branch', () => {
  expect(artifactRoots('/repo', 'BB-373', 'feat/bb-373-x')).toEqual([
    '/repo/assets-ai/BB-373',
    '/repo/.bakers-worktrees/feat/bb-373-x/assets-ai/BB-373',
  ]);
});

it('omits the worktree root when the ticket carries no branch', () => {
  expect(artifactRoots('/repo', 'BB-373', '')).toEqual([
    '/repo/assets-ai/BB-373',
  ]);
});

// BB-371 D3 — the tool is the axis, and the first line is the command.
it('groups by tool directory and leads with the producing command', () => {
  const root = fixture();
  const sections = artifactSections(rootsOf(root), { headLines: 200 });

  expect(sections.map((s) => s.heading)).toEqual([
    'playwright/images/shot.png',
    'playwright/logs/walk.txt',
    'vitest/store-green.txt',
  ]);
  // The producing command is the entry's FIRST line, so the collapsed panel
  // reads as the list of commands this ticket ran.
  expect(sections[2]?.lines[0]).toBe('pnpm vitest run addons/bakers-ui/tests');
  expect(sections[1]?.lines[0]).toBe('pnpm playwright test walk.spec.ts');
  expect(sections[2]?.expandable).toBe(true);
});

// D9 — a binary is LISTED, never read: its size is the whole of what it says.
it('lists an image with its size and never reads it', () => {
  const root = fixture();
  const sections = artifactSections(rootsOf(root), { headLines: 200 });
  const image = sections.find((s) => s.heading.endsWith('shot.png'));

  expect(image?.expandable).toBeFalsy();
  expect(image?.lines).toEqual(['16 bytes']);
});

// R3 — the cap is a viewport budget, and what it withheld is stated rather
// than silently dropped.
it('caps an entry at headLines and says how many it withheld', () => {
  const root = join(tmpdir(), `bb-373-cap-${process.pid}-${Math.random()}`);
  mkdirSync(join(root, 'assets-ai', 'BB-373', 'shell'), { recursive: true });
  writeFileSync(
    join(root, 'assets-ai', 'BB-373', 'shell', 'long.txt'),
    ['pnpm build', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join(
      '\n',
    ),
  );

  const [section] = artifactSections(rootsOf(root), { headLines: 5 });

  expect(section?.lines).toHaveLength(6);
  expect(section?.lines[0]).toBe('pnpm build');
  expect(section?.lines[5]).toBe('… 16 more lines');
});

it('is empty when neither root exists', () => {
  expect(
    artifactSections(['/nope/assets-ai/BB-373'], { headLines: 200 }),
  ).toEqual([]);
});

// A capture the run unlinked between the walk and the read — the race
// `entriesOf` names, on the calls that actually touch bytes. `head` stats before
// it opens, so this is the `statSync` inside it that throws.
it('lists a vanished text artifact as its own row and keeps the rest', () => {
  const root = fixture();
  const gone = join(root, 'assets-ai', 'BB-373', 'vitest', 'store-green.txt');
  denied.set(gone, 'ENOENT');

  const sections = artifactSections(rootsOf(root), { headLines: 200 });

  // Every artifact is still listed — one vanished file is not the listing.
  expect(sections.map((s) => s.heading)).toEqual([
    'playwright/images/shot.png',
    'playwright/logs/walk.txt',
    'vitest/store-green.txt',
  ]);
  const broken = sections.find((s) => s.heading === 'vitest/store-green.txt');
  // Not expandable: there is nothing behind the caret to show.
  expect(broken?.expandable).toBeFalsy();
  expect(broken?.lines.join(' ')).toContain('ENOENT');
  // And the neighbours render their real bytes, contents intact.
  expect(
    sections.find((s) => s.heading === 'playwright/logs/walk.txt')?.lines,
  ).toEqual(['pnpm playwright test walk.spec.ts', 'ok']);
  expect(
    sections.find((s) => s.heading === 'playwright/images/shot.png')?.lines,
  ).toEqual(['16 bytes']);
});

// The binary branch stats instead of reading, and that `statSync` was unguarded
// too — the same race, one code path over.
it('lists a vanished binary as its own row and keeps the rest', () => {
  const root = fixture();
  const gone = join(
    root,
    'assets-ai',
    'BB-373',
    'playwright',
    'images',
    'shot.png',
  );
  denied.set(gone, 'ENOENT');

  const sections = artifactSections(rootsOf(root), { headLines: 200 });

  expect(sections.map((s) => s.heading)).toEqual([
    'playwright/images/shot.png',
    'playwright/logs/walk.txt',
    'vitest/store-green.txt',
  ]);
  const image = sections.find((s) => s.heading.endsWith('shot.png'));
  expect(image?.expandable).toBeFalsy();
  expect(image?.lines.join(' ')).toContain('ENOENT');
  expect(
    sections.find((s) => s.heading === 'vitest/store-green.txt')?.lines,
  ).toEqual(['pnpm vitest run addons/bakers-ui/tests', '12 passed']);
});

/**
 * A FILE THAT CANNOT BE READ COSTS ITS OWN ROW, NEVER THE LISTING.
 *
 * This runs on the DRAW path, over a tree a run is writing into — the exact
 * situation the panel exists for. `entriesOf` already says so for a vanished
 * DIRECTORY; the two cases below are the same statement for the calls that
 * actually touch files, and they are driven against a real filesystem rather
 * than a mocked `fs`: the point is that the errno an operator will meet
 * (`EACCES` on a root-owned log, `ENOENT` on a file unlinked between the walk
 * and the read) degrades to a row instead of a stack trace.
 *
 * SKIPPED FOR ROOT, and honestly so: root bypasses discretionary access checks,
 * so for uid 0 an unreadable file cannot be made to exist at all.
 */
const asRoot = process.getuid?.() === 0;

it.skipIf(asRoot)(
  'lists an unreadable text artifact as its own row and keeps the rest',
  () => {
    const root = fixture();
    chmodSync(
      join(root, 'assets-ai', 'BB-373', 'vitest', 'store-green.txt'),
      0o000,
    );

    const sections = artifactSections(rootsOf(root), { headLines: 200 });

    // Every artifact is still listed — one unreadable file is not the listing.
    expect(sections.map((s) => s.heading)).toEqual([
      'playwright/images/shot.png',
      'playwright/logs/walk.txt',
      'vitest/store-green.txt',
    ]);
    const broken = sections.find((s) => s.heading === 'vitest/store-green.txt');
    // Not expandable: there is nothing behind the caret to show.
    expect(broken?.expandable).toBeFalsy();
    expect(broken?.lines.join(' ')).toContain('EACCES');
    // And the neighbours are untouched, contents and all.
    expect(
      sections.find((s) => s.heading === 'playwright/logs/walk.txt')?.lines[0],
    ).toBe('pnpm playwright test walk.spec.ts');
  },
);

// The binary branch stats instead of reading, and that `statSync` is unguarded
// too: a directory that lost its search bit lists its entries but refuses every
// stat inside it.
it.skipIf(asRoot)('lists a binary whose size cannot be stat`d', () => {
  const root = fixture();
  chmodSync(join(root, 'assets-ai', 'BB-373', 'playwright', 'images'), 0o600);

  const sections = artifactSections(rootsOf(root), { headLines: 200 });

  const image = sections.find((s) => s.heading.endsWith('shot.png'));
  expect(image?.expandable).toBeFalsy();
  expect(image?.lines.join(' ')).toContain('EACCES');
  expect(
    sections.find((s) => s.heading === 'vitest/store-green.txt')?.lines[0],
  ).toBe('pnpm vitest run addons/bakers-ui/tests');
});

// D9 — the FIRST root that exists wins, so a checkout that has its own tree is
// never shadowed by the worktree's.
it('reads the first root that exists, in order', () => {
  const root = fixture();
  const sections = artifactSections(
    ['/nope/assets-ai/BB-373', ...rootsOf(root)],
    { headLines: 200 },
  );
  expect(sections.map((s) => s.heading)).toContain('vitest/store-green.txt');
});
