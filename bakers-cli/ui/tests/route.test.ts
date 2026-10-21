import { describe, expect, it } from 'vitest';
import {
  isTicketIdentifier,
  isUuid,
  normalizeRepoUrl,
  parseTarget,
  parseTicketIdentifierFromBranch,
  resolveHere,
  type UiInitialRoute,
} from '../src/route.js';

// BB-223 — the pure CLI seam of `bakers ui` deep links (spec Decisions 1, 3, 4,
// 6, 13). Everything here is offline: `parseTarget` is a pure argv function,
// `normalizeRepoUrl` is a pure string reduction, and `resolveHere`'s only two
// touchpoints — the current branch and the `origin` remote — are injected seams.

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** The route a successful `parseTarget` produced (unwrapping the discriminator). */
function route(inputs: Parameters<typeof parseTarget>[0]): UiInitialRoute {
  const parsed = parseTarget(inputs);
  if (parsed?.kind !== 'route') {
    throw new Error(`expected a route, got ${JSON.stringify(parsed)}`);
  }
  return parsed.route;
}

describe('parseTarget — target sources (AC-1)', () => {
  it('yields no target when nothing is supplied (the dashboard path, AC-4)', () => {
    expect(parseTarget({})).toBeUndefined();
  });

  it.each([
    ['BB-221', 'BB-221'],
    ['bb-221', 'BB-221'],
    ['Bb-221', 'BB-221'],
  ])('reads the bare identifier %s as a ticket, normalised to %s (Decision 4)', (input, expected) => {
    expect(route({ target: input })).toEqual({
      kind: 'ticket',
      by: 'identifier',
      value: expected,
      view: 'full',
    });
  });

  it('reads ticket:<identifier>', () => {
    expect(route({ target: 'ticket:BB-221' })).toEqual({
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-221',
      view: 'full',
    });
  });

  it('reads ticket:<uuid>', () => {
    expect(route({ target: `ticket:${UUID}` })).toEqual({
      kind: 'ticket',
      by: 'uuid',
      value: UUID,
      view: 'full',
    });
  });

  it('reads project:<name> verbatim (labels are case-sensitive, Decision 4)', () => {
    expect(route({ target: 'project:Bb' })).toEqual({
      kind: 'project',
      by: 'name',
      value: 'Bb',
    });
  });

  it('reads project:<uuid>', () => {
    expect(route({ target: `project:${UUID}` })).toEqual({
      kind: 'project',
      by: 'uuid',
      value: UUID,
    });
  });

  it('reads run:<uuid>', () => {
    expect(route({ target: `run:${UUID}` })).toEqual({
      kind: 'run',
      by: 'uuid',
      value: UUID,
      view: 'full',
    });
  });

  it('parses a name that collides with a prefix as the prefix form (Decision 1)', () => {
    // `project:ticket` is the project named "ticket", not a ticket target.
    expect(route({ target: 'project:ticket' })).toEqual({
      kind: 'project',
      by: 'name',
      value: 'ticket',
    });
  });

  it.each([
    [{ ticket: 'BB-221' }, { target: 'ticket:BB-221' }],
    [{ ticket: UUID }, { target: `ticket:${UUID}` }],
    [{ project: 'bakers' }, { target: 'project:bakers' }],
    [{ project: UUID }, { target: `project:${UUID}` }],
    [{ run: UUID }, { target: `run:${UUID}` }],
  ])('the flag form %j equals the prefixed positional %j', (flags, pos) => {
    expect(route(flags)).toEqual(route(pos));
  });
});

describe('parseTarget — origin issue references', () => {
  it.each([
    '#19',
    'bakers#19',
    'https://git.key-tec.de/bakers-build/bakers-build/-/issues/19',
  ])('reads %s as a ticket looked up by its origin, verbatim', (input) => {
    expect(route({ target: input })).toEqual({
      kind: 'ticket',
      by: 'origin',
      value: input,
      view: 'full',
    });
  });

  it('still reads an identifier as an identifier, not as an origin', () => {
    expect(route({ target: 'BB-295' })).toMatchObject({
      by: 'identifier',
    });
  });

  it('still rejects an unknown kind prefix that is not a URL', () => {
    expect(() => parseTarget({ target: 'ftp:thing' })).toThrow(
      /unknown target kind 'ftp'/,
    );
  });
});

describe('parseTarget — rejected forms (AC-1)', () => {
  it('rejects a bare UUID as ambiguous, naming the three prefixes', () => {
    expect(() => parseTarget({ target: UUID })).toThrow(
      /ambiguous[\s\S]*ticket:[\s\S]*project:[\s\S]*run:/,
    );
  });

  it('rejects a bare number (Decision 4)', () => {
    expect(() => parseTarget({ target: '221' })).toThrow(/'221'/);
    expect(() => parseTarget({ target: '221' })).toThrow(/BB-221/);
  });

  it('rejects an unknown kind prefix, naming the three kinds', () => {
    expect(() => parseTarget({ target: 'foo:bar' })).toThrow(
      /unknown target kind 'foo'[\s\S]*ticket:[\s\S]*project:[\s\S]*run:/,
    );
  });

  it.each([
    'ticket:',
    'project:',
    'run:',
  ])('rejects the empty value in %s', (input) => {
    expect(() => parseTarget({ target: input })).toThrow(/empty value/);
  });

  it('rejects a run target that is not a UUID', () => {
    expect(() => parseTarget({ run: 'BB-221' })).toThrow(/UUID/);
  });

  it('rejects a ticket target that is neither an identifier nor a UUID', () => {
    expect(() => parseTarget({ ticket: 'not a ticket' })).toThrow(
      /not a ticket identifier or UUID/,
    );
  });
});

describe('parseTarget — the conflict rule (AC-1)', () => {
  const sources: Array<[string, Parameters<typeof parseTarget>[0]]> = [
    ['the positional target', { target: 'BB-221' }],
    ['--ticket', { ticket: 'BB-221' }],
    ['--project', { project: 'bakers' }],
    ['--run', { run: UUID }],
    ['--here', { here: true }],
  ];

  // Every unordered pair of the five target sources.
  const pairs = sources.flatMap((a, i) =>
    sources.slice(i + 1).map((b) => [a, b] as const),
  );

  it('has ten distinct conflicting pairs to check', () => {
    expect(pairs).toHaveLength(10);
  });

  it.each(
    pairs.map(([a, b]) => [a[0], b[0], { ...a[1], ...b[1] }]),
  )('rejects %s combined with %s, naming both', (nameA, nameB, inputs) => {
    const run = () => parseTarget(inputs as Parameters<typeof parseTarget>[0]);
    expect(run).toThrow(nameA as string);
    expect(run).toThrow(nameB as string);
  });

  it('rejects all five at once, naming all five', () => {
    const all = {
      target: 'BB-221',
      ticket: 'BB-222',
      project: 'bakers',
      run: UUID,
      here: true,
    };
    for (const [name] of sources) {
      expect(() => parseTarget(all)).toThrow(name);
    }
  });

  it('accepts --here on its own as a target source needing resolution', () => {
    expect(parseTarget({ here: true })).toEqual({ kind: 'here', view: 'full' });
  });
});

describe('parseTarget — --view is a modifier, never a target source (AC-1, AC-7)', () => {
  it('--view alone yields no target (the dashboard path)', () => {
    expect(parseTarget({ view: 'teaser' })).toBeUndefined();
  });

  it('--view with a ticket target does not conflict', () => {
    expect(route({ target: 'BB-221', view: 'teaser' })).toEqual({
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-221',
      view: 'teaser',
    });
  });

  it.each(['full', 'teaser', 'board_card'])('accepts the mode %s', (mode) => {
    expect(route({ target: 'BB-221', view: mode }).view).toBe(mode);
  });

  it('defaults an absent --view to full', () => {
    expect(route({ target: 'BB-221' }).view).toBe('full');
  });

  it('rejects an unknown mode, listing the three known ones', () => {
    expect(() => parseTarget({ target: 'BB-221', view: 'banana' })).toThrow(
      /'banana'[\s\S]*full[\s\S]*teaser[\s\S]*board_card/,
    );
  });

  it('rejects --view with a project target (Decision 13)', () => {
    expect(() =>
      parseTarget({ target: 'project:bakers', view: 'teaser' }),
    ).toThrow(/--view applies to ticket targets only/);
  });

  it('rejects --view with a run target as contradictory (Decision 13)', () => {
    expect(() =>
      parseTarget({ target: `run:${UUID}`, view: 'teaser' }),
    ).toThrow(/run:/);
  });
});

describe('parseTicketIdentifierFromBranch (AC-2, Finding 3)', () => {
  it.each([
    ['feat/bb-222-conductor-cli-te', 'BB-222'],
    ['feat/bb-223-bakers-ui-deep-lin', 'BB-223'],
    ['bakers/BB-12-x', 'BB-12'],
    ['feat/bb-99-fix-404-page', 'BB-99'],
    ['BB-7', 'BB-7'],
    ['fix_bb-8_thing', 'BB-8'],
  ])('reads %s as %s', (branch, expected) => {
    expect(parseTicketIdentifierFromBranch(branch)).toBe(expected);
  });

  it.each([
    'main',
    'develop',
    'feature/bakers-dashboard-billing',
    '',
  ])('reads no identifier out of %s', (branch) => {
    expect(parseTicketIdentifierFromBranch(branch)).toBeNull();
  });

  it('over-matches release/v2-2026 as V2-2026 — a pinned, accepted risk', () => {
    // spec § Risks: the parse is deliberately convention-agnostic, so a
    // version-shaped token can look like an identifier. It fails later at
    // resolution with a named error rather than opening a wrong ticket.
    expect(parseTicketIdentifierFromBranch('release/v2-2026')).toBe('V2-2026');
  });
});

// BB-223 revision 4, spec Decision 3: the `--here` project rung matches the
// cwd's git remote against `bb_project.repository.url`. Git and that field
// disagree on form — MEASURED here: `git remote get-url origin` yields
// `git@git.key-tec.de:bakers-build/bakers-build.git` while the stored value is
// `ssh://git@git.key-tec.de/bakers-build/bakers-build.git`. Normalisation has to bridge
// exactly that pair, which is why it is a table and not an afterthought.
describe('normalizeRepoUrl (AC-2, Decision 3)', () => {
  const CANONICAL = 'host/bakers-build/bakers-build';

  it.each([
    ['git@host:bakers-build/bakers-build.git', CANONICAL],
    ['ssh://git@host/bakers-build/bakers-build.git', CANONICAL],
    ['ssh://git@host:2222/bakers-build/bakers-build.git', CANONICAL],
    ['https://host/bakers-build/bakers-build.git', CANONICAL],
    ['https://user@host/bakers-build/bakers-build', CANONICAL],
    ['https://host/bakers-build/bakers-build/', CANONICAL],
    ['HTTPS://Host/bakers-build/bakers-build.GIT', CANONICAL],
    ['git@host:/bakers-build/bakers-build.git', CANONICAL],
  ])('normalises %s to %s', (raw, expected) => {
    expect(normalizeRepoUrl(raw)).toBe(expected);
  });

  it('bridges the measured real-world pair', () => {
    expect(normalizeRepoUrl('git@git.key-tec.de:bakers-build/bakers-build.git')).toBe(
      normalizeRepoUrl('ssh://git@git.key-tec.de/bakers-build/bakers-build.git'),
    );
  });

  it('does not collapse two different repos on the same host', () => {
    expect(normalizeRepoUrl('git@host:bakers-build/bakers-build.git')).not.toBe(
      normalizeRepoUrl('git@host:keytec/shop.git'),
    );
  });

  it.each([
    ['', 'the empty string'],
    ['   ', 'blank'],
    ['nonsense', 'no host/path separator at all'],
    ['/repos/bakers', 'a bare local path'],
    ['https://host', 'a host with no path'],
    ['git@host:', 'a scp form with no path'],
  ])('yields undefined for %j (%s)', (raw) => {
    expect(normalizeRepoUrl(raw)).toBeUndefined();
  });

  it('yields undefined for an absent value', () => {
    expect(normalizeRepoUrl(undefined)).toBeUndefined();
  });
});

describe('resolveHere — the ladder (AC-2, Decision 3)', () => {
  const base = {
    cwd: '/repos/bakers/.bakers-worktrees/feat/bb-223-x',
    readBranch: async () => 'feat/bb-223-bakers-ui-deep-lin',
    readRemoteUrl: async () => 'git@git.key-tec.de:bakers-build/bakers-build.git',
  };

  it('rung 1: a branch carrying an identifier yields that ticket, with fromBranch', async () => {
    await expect(resolveHere({ ...base, view: 'full' })).resolves.toEqual({
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-223',
      view: 'full',
      fromBranch: 'feat/bb-223-bakers-ui-deep-lin',
    });
  });

  it("rung 1 carries the caller's --view through", async () => {
    const r = await resolveHere({ ...base, view: 'teaser' });
    expect(r.view).toBe('teaser');
  });

  it('rung 1 never reads the remote — the branch alone decides', async () => {
    let asked = false;
    await resolveHere({
      ...base,
      readRemoteUrl: async () => {
        asked = true;
        return '';
      },
    });
    expect(asked).toBe(false);
  });

  it("rung 2: no identifier yields the repo target, by:'repo', normalised", async () => {
    await expect(
      resolveHere({ ...base, readBranch: async () => 'develop' }),
    ).resolves.toEqual({
      kind: 'project',
      by: 'repo',
      value: 'git.key-tec.de/bakers-build/bakers-build',
      fromBranch: 'develop',
    });
  });

  it('rung 2 works on a detached HEAD (no branch at all)', async () => {
    await expect(
      resolveHere({ ...base, readBranch: async () => '' }),
    ).resolves.toEqual({
      kind: 'project',
      by: 'repo',
      value: 'git.key-tec.de/bakers-build/bakers-build',
    });
  });

  it('rung 2 needs no .bakers/ at all — the truth lives on the control plane', async () => {
    await expect(
      resolveHere({
        ...base,
        cwd: '/a/fresh/clone',
        readBranch: async () => 'main',
        readRemoteUrl: async () => 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git',
      }),
    ).resolves.toMatchObject({
      by: 'repo',
      value: 'git.key-tec.de/bakers-build/bakers-build',
    });
  });

  it('a throwing readBranch still lands on rung 2', async () => {
    await expect(
      resolveHere({
        ...base,
        readBranch: async () => {
          throw new Error('not a git repo');
        },
      }),
    ).resolves.toMatchObject({ kind: 'project', by: 'repo' });
  });

  it('rung 3: no git remote at all fails, naming the cwd and the way out', async () => {
    const err = await resolveHere({
      ...base,
      cwd: '/tmp/scratch',
      readBranch: async () => 'main',
      readRemoteUrl: async () => '',
    }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('/tmp/scratch');
    expect(err.message).toContain('git remote');
    expect(err.message).toContain('bakers ui project:<name>');
  });

  it('rung 3: a remote that will not normalise fails the same way', async () => {
    const err = await resolveHere({
      ...base,
      cwd: '/tmp/scratch',
      readBranch: async () => 'main',
      readRemoteUrl: async () => 'nonsense',
    }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('/tmp/scratch');
    expect(err.message).toContain('git remote');
    expect(err.message).toContain('nonsense');
  });

  it('rung 3: a throwing readRemoteUrl fails, it does not crash', async () => {
    const err = await resolveHere({
      ...base,
      cwd: '/tmp/scratch',
      readBranch: async () => 'main',
      readRemoteUrl: async () => {
        throw new Error('fatal: not a git repository');
      },
    }).catch((e: unknown) => e as Error);
    expect(err.message).toContain('/tmp/scratch');
    expect(err.message).toContain('git remote');
  });
});

describe('shape predicates', () => {
  it.each([UUID, UUID2, UUID.toUpperCase()])('%s is a UUID', (v) => {
    expect(isUuid(v)).toBe(true);
  });

  it.each(['BB-221', '221', '', 'not-a-uuid'])('%s is not a UUID', (v) => {
    expect(isUuid(v)).toBe(false);
  });

  it.each(['BB-221', 'bb-1', 'A1-9'])('%s is an identifier', (v) => {
    expect(isTicketIdentifier(v)).toBe(true);
  });

  it.each([
    '221',
    'bakers.build',
    'bakers.build-',
    '-1',
    UUID,
    'BB-1-2',
  ])('%s is not an identifier', (v) => {
    expect(isTicketIdentifier(v)).toBe(false);
  });
});
