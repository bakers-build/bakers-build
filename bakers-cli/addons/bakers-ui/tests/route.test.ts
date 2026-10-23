import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/route.js';
import type { Collection, DropshClient, Resource } from '../src/types.js';
import { toResource } from './test-support.js';

// BB-223 AC-3 (spec Decisions 5 + 6): the resolver turns the CLI's unresolved
// `UiInitialRoute` into the renderer's `ResolvedRoute`. It runs at the earliest
// point a JSON:API client exists and still strictly before the kernel takes the
// terminal, so EVERY failure here throws — nothing is drawn, no raw mode.

const TICKET = 'ffffffff-0000-0000-0000-000000000001';
const PROJECT = 'ffffffff-0000-0000-0000-000000000002';
const RUN = 'ffffffff-0000-0000-0000-000000000003';
const BASE = 'https://develop.dev.bakers.build';

/** A client whose `get`/`collection` are driven by explicit fixtures. */
function fakeClient(over: {
  get?: (path: string, params?: unknown) => Promise<unknown>;
  first?: Resource | null;
}): DropshClient & { calls: string[] } {
  const calls: string[] = [];
  const collection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => over.first ?? null,
      list: async () => [],
    };
    return c;
  };
  return {
    calls,
    collection,
    get: async (path: string, params?: unknown) => {
      calls.push(path);
      if (!over.get) throw new Error(`unexpected get(${path})`);
      return over.get(path, params);
    },
  };
}

describe('resolveRoute — ticket by uuid', () => {
  it('resolves to the ticket screen with the default full view', async () => {
    const client = fakeClient({
      get: async () => ({
        data: { id: TICKET, type: 'bb_ticket--bb_ticket' },
      }),
    });
    await expect(
      resolveRoute(client, {
        kind: 'ticket',
        by: 'uuid',
        value: TICKET,
        view: 'full',
      }),
    ).resolves.toEqual({ screen: 'ticket', ticketId: TICKET, view: 'full' });
  });

  it('carries the requested view through unchanged (AC-7)', async () => {
    const client = fakeClient({ get: async () => ({ data: { id: TICKET } }) });
    const resolved = await resolveRoute(client, {
      kind: 'ticket',
      by: 'uuid',
      value: TICKET,
      view: 'board_card',
    });
    expect(resolved).toMatchObject({ view: 'board_card' });
  });

  it('throws naming the uuid and the control plane when it does not exist', async () => {
    const client = fakeClient({ get: async () => ({ data: null }) });
    await expect(
      resolveRoute(
        client,
        { kind: 'ticket', by: 'uuid', value: TICKET },
        { baseUrl: BASE },
      ),
    ).rejects.toThrow(new RegExp(`${TICKET}[\\s\\S]*${BASE}`));
  });

  it('turns a rejecting read into a named error, not a raw HTTP failure', async () => {
    const client = fakeClient({
      get: async () => {
        throw new Error('404 Not Found');
      },
    });
    await expect(
      resolveRoute(client, { kind: 'ticket', by: 'uuid', value: TICKET }),
    ).rejects.toThrow(/no ticket/);
  });
});

describe('resolveRoute — ticket by identifier', () => {
  const hit = (id: string, identifier: string) => ({
    id,
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier, title: `title of ${identifier}` },
  });

  it('resolves the single hit', async () => {
    const client = fakeClient({
      get: async () => ({ data: [hit(TICKET, 'BB-223')] }),
    });
    await expect(
      resolveRoute(client, {
        kind: 'ticket',
        by: 'identifier',
        value: 'BB-223',
        view: 'full',
      }),
    ).resolves.toEqual({ screen: 'ticket', ticketId: TICKET, view: 'full' });
  });

  it('queries the ticket collection, not a single resource', async () => {
    const client = fakeClient({
      get: async () => ({ data: [hit(TICKET, 'BB-223')] }),
    });
    await resolveRoute(client, {
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-223',
    });
    expect(client.calls).toEqual(['bb_ticket/bb_ticket']);
  });

  it('throws naming the identifier and the control plane on 0 hits', async () => {
    const client = fakeClient({ get: async () => ({ data: [] }) });
    await expect(
      resolveRoute(
        client,
        { kind: 'ticket', by: 'identifier', value: 'BB-999999' },
        { baseUrl: BASE },
      ),
    ).rejects.toThrow(new RegExp(`BB-999999[\\s\\S]*${BASE}`));
  });

  it('throws naming the candidates and asking for ticket:<uuid> on 2 hits', async () => {
    // Identifiers are unique PER PROJECT, so a cross-project collision is
    // possible; page[limit]=2 turns a silent wrong-ticket into a named
    // ambiguity (spec Decision 6).
    const client = fakeClient({
      get: async () => ({
        data: [hit(TICKET, 'BB-1'), hit(PROJECT, 'BB-1')],
      }),
    });
    const err = await resolveRoute(client, {
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-1',
    }).catch((e: unknown) => e as Error);
    expect(err.message).toContain(TICKET);
    expect(err.message).toContain(PROJECT);
    expect(err.message).toContain('ticket:<uuid>');
  });

  it('names the branch in the failure when the route came from --here', async () => {
    const client = fakeClient({ get: async () => ({ data: [] }) });
    await expect(
      resolveRoute(client, {
        kind: 'ticket',
        by: 'identifier',
        value: 'V2-2026',
        fromBranch: 'release/v2-2026',
      }),
    ).rejects.toThrow(/release\/v2-2026/);
  });
});

describe('resolveRoute — ticket by origin', () => {
  const hit = (id: string, identifier: string) => ({
    id,
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier, title: `title of ${identifier}` },
  });
  const origin = { kind: 'ticket', by: 'origin', value: '#19' } as const;
  const searchOf = (params: unknown): string =>
    decodeURIComponent(
      (params as { getQueryString(): string }).getQueryString(),
    );

  it('sends the reference verbatim as filter[search] and opens the single hit', async () => {
    let sent = '';
    const client = fakeClient({
      get: async (_path, params) => {
        sent = searchOf(params);
        return { data: [hit(TICKET, 'BB-295')] };
      },
    });
    await expect(resolveRoute(client, origin)).resolves.toEqual({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
    });
    expect(client.calls).toEqual(['bb_ticket/bb_ticket']);
    expect(sent).toContain('filter[search]=#19');
  });

  it('names every candidate when several tickets share the origin', async () => {
    const client = fakeClient({
      get: async () => ({
        data: [hit(TICKET, 'BB-298'), hit(PROJECT, 'BB-301')],
      }),
    });
    await expect(resolveRoute(client, origin)).rejects.toThrow(
      new RegExp(
        `origin of 2 tickets[\\s\\S]*ticket:${TICKET}[\\s\\S]*BB-298[\\s\\S]*ticket:${PROJECT}[\\s\\S]*BB-301`,
      ),
    );
  });

  it('says so when no ticket has the origin', async () => {
    const client = fakeClient({ get: async () => ({ data: [] }) });
    await expect(
      resolveRoute(client, origin, { baseUrl: BASE }),
    ).rejects.toThrow(new RegExp(`no ticket has the origin #19 on ${BASE}`));
  });

  it("passes the server's message on for an unknown or ambiguous alias", async () => {
    const client = fakeClient({
      // dropsh's real HttpError shape: `message` is the bare status, the
      // server's words are in `body.errors[].detail`.
      get: async () => {
        throw Object.assign(new Error('HTTP 400'), {
          status: 400,
          body: {
            errors: [
              {
                detail:
                  'No repository matches "foo". Known in your projects: bakers.',
              },
            ],
          },
        });
      },
    });
    await expect(
      resolveRoute(client, { ...origin, value: 'foo#1' }),
    ).rejects.toThrow(
      /foo#1: No repository matches "foo"\. Known in your projects: bakers\./,
    );
  });
});

describe('resolveRoute — project', () => {
  it('resolves a project by name to id + name', async () => {
    const client = fakeClient({
      first: toResource({
        id: PROJECT,
        type: 'bb_project--bb_project',
        attributes: { name: 'bakers' },
      }),
    });
    await expect(
      resolveRoute(client, { kind: 'project', by: 'name', value: 'bakers' }),
    ).resolves.toEqual({
      screen: 'project',
      projectId: PROJECT,
      projectName: 'bakers',
    });
  });

  it('throws naming an unknown project name', async () => {
    const client = fakeClient({ first: null });
    await expect(
      resolveRoute(client, { kind: 'project', by: 'name', value: 'nope' }),
    ).rejects.toThrow(/no project named 'nope'/);
  });

  it('resolves a project by uuid, carrying BOTH id and name', async () => {
    const client = fakeClient({
      get: async () => ({
        data: { id: PROJECT, attributes: { name: 'bakers' } },
      }),
    });
    await expect(
      resolveRoute(client, { kind: 'project', by: 'uuid', value: PROJECT }),
    ).resolves.toEqual({
      screen: 'project',
      projectId: PROJECT,
      projectName: 'bakers',
    });
  });

  it('throws naming an unknown project uuid', async () => {
    const client = fakeClient({ get: async () => ({ data: null }) });
    await expect(
      resolveRoute(client, { kind: 'project', by: 'uuid', value: PROJECT }),
    ).rejects.toThrow(new RegExp(`no project ${PROJECT}`));
  });
});

describe('resolveRoute — run (AC-3, Decision 2)', () => {
  it("resolves to the owning ticket's screen with the Runs tab active", async () => {
    const client = fakeClient({
      get: async () => ({
        data: {
          id: RUN,
          type: 'bb_run--bb_run',
          relationships: { ticket_id: { data: { id: TICKET } } },
        },
      }),
    });
    await expect(
      resolveRoute(client, { kind: 'run', by: 'uuid', value: RUN }),
    ).resolves.toEqual({
      screen: 'ticket',
      ticketId: TICKET,
      view: 'full',
      tab: 'runs',
      runId: RUN,
    });
  });

  it('throws naming an unknown run uuid', async () => {
    const client = fakeClient({ get: async () => ({ data: null }) });
    await expect(
      resolveRoute(client, { kind: 'run', by: 'uuid', value: RUN }),
    ).rejects.toThrow(new RegExp(`no run ${RUN}`));
  });

  it('throws when the run carries no ticket relationship', async () => {
    const client = fakeClient({
      get: async () => ({ data: { id: RUN, relationships: {} } }),
    });
    await expect(
      resolveRoute(client, { kind: 'run', by: 'uuid', value: RUN }),
    ).rejects.toThrow(new RegExp(`run ${RUN} has no ticket`));
  });
});

// BB-223 revision 4, spec Decision 3 + Decision 14 — the `by:'repo'` row: the
// `--here` project rung. The match is CLIENT-SIDE by necessity, not by taste:
// `filter[repository]=…` answers HTTP 400 (measured), because `repository` is a
// JSON field on the entity, not a relationship JSON:API can filter inside.
describe('resolveRoute — project by repo (AC-2, AC-8)', () => {
  const REPO = 'git.key-tec.de/bakers-build/bakers-build';
  const PROJECT_B = 'ffffffff-0000-0000-0000-000000000004';

  /** A `bb_project` collection row with the repository attribute set verbatim. */
  const project = (id: string, name: string, repository: unknown) => ({
    id,
    type: 'bb_project--bb_project',
    attributes: { name, repository },
  });

  /** A client serving one fixed `bb_project` collection document. */
  function projectsClient(rows: unknown[]): DropshClient & { calls: string[] } {
    return fakeClient({
      get: async (path: string) => {
        if (path !== 'bb_project/bb_project') {
          throw new Error(`unexpected get(${path})`);
        }
        return { data: rows };
      },
    });
  }

  it('resolves the single project whose repository claims the repo', async () => {
    const client = projectsClient([
      project(PROJECT, 'bakers', {
        url: 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git',
      }),
      project(PROJECT_B, 'shop', {
        url: 'git@git.key-tec.de:keytec/shop.git',
      }),
    ]);
    await expect(
      resolveRoute(client, { kind: 'project', by: 'repo', value: REPO }),
    ).resolves.toEqual({
      screen: 'project',
      projectId: PROJECT,
      projectName: 'bakers',
    });
  });

  it('matches an ssh:// stored URL against a git@host: remote — the measured pairing', async () => {
    // `git remote get-url origin` here yields `git@git.key-tec.de:bakers-build/bakers-build.git`
    // and the project stores `ssh://git@git.key-tec.de/bakers-build/bakers-build.git`. If
    // normalisation did not bridge exactly this pair, `--here` would never work
    // in this very repo.
    const client = projectsClient([
      project(PROJECT, 'bakers', {
        url: 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git',
      }),
    ]);
    await expect(
      resolveRoute(client, {
        kind: 'project',
        by: 'repo',
        value: 'git.key-tec.de/bakers-build/bakers-build',
      }),
    ).resolves.toMatchObject({ screen: 'project', projectName: 'bakers' });
  });

  it('reads a repository attribute serialized as a JSON string too', async () => {
    const client = projectsClient([
      project(
        PROJECT,
        'bakers',
        JSON.stringify({
          url: 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git',
        }),
      ),
    ]);
    await expect(
      resolveRoute(client, { kind: 'project', by: 'repo', value: REPO }),
    ).resolves.toMatchObject({ projectId: PROJECT });
  });

  it('throws on ZERO matches, naming the repo and listing the known projects', async () => {
    const client = projectsClient([
      project(PROJECT, 'bakers', {
        url: 'git@host:bakers-build/bakers-build.git',
      }),
      project(PROJECT_B, 'shop', { url: 'git@host:keytec/shop.git' }),
    ]);
    const err = await resolveRoute(
      client,
      {
        kind: 'project',
        by: 'repo',
        value: 'git.key-tec.de/keytec/neues-ding',
      },
      { baseUrl: BASE },
    ).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('git.key-tec.de/keytec/neues-ding');
    expect(err.message).toContain('bakers');
    expect(err.message).toContain('shop');
  });

  it('resolves TWO OR MORE matches to a picker, which is NOT a failure (AC-8)', async () => {
    const client = projectsClient([
      project(PROJECT, 'shop-de', { url: 'git@host:keytec/shop.git' }),
      project(PROJECT_B, 'shop-at', {
        url: 'ssh://git@host/keytec/shop.git',
      }),
    ]);
    await expect(
      resolveRoute(client, {
        kind: 'project',
        by: 'repo',
        value: 'host/keytec/shop',
      }),
    ).resolves.toEqual({
      screen: 'project-picker',
      repo: 'host/keytec/shop',
      candidates: [
        { id: PROJECT, name: 'shop-de' },
        { id: PROJECT_B, name: 'shop-at' },
      ],
    });
  });

  it('skips a project whose repository is empty, null or malformed instead of dying', async () => {
    const client = projectsClient([
      project('p-empty', 'empty', []),
      project('p-null', 'nullish', null),
      project('p-bad', 'malformed', '{not json'),
      project('p-shapeless', 'shapeless', [{ nope: 1 }, 'not-an-object']),
      project(PROJECT, 'bakers', {
        url: 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git',
      }),
    ]);
    await expect(
      resolveRoute(client, { kind: 'project', by: 'repo', value: REPO }),
    ).resolves.toMatchObject({ screen: 'project', projectId: PROJECT });
  });

  it('never sends filter[repository] — that answers HTTP 400 (measured)', async () => {
    let query = '';
    const client = fakeClient({
      get: async (path: string, params?: unknown) => {
        const p = params as { getQueryString?: () => string } | undefined;
        query = p?.getQueryString?.() ?? '';
        if (path !== 'bb_project/bb_project') {
          throw new Error(`unexpected get(${path})`);
        }
        return {
          data: [
            project(PROJECT, 'bakers', {
              url: 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git',
            }),
          ],
        };
      },
    });
    await resolveRoute(client, { kind: 'project', by: 'repo', value: REPO });
    // A sparse fieldset naming `repository` is fine (and is what keeps the
    // payload small); a FILTER on it is what the server rejects with 400.
    expect(query).not.toContain('filter');
    expect(decodeURIComponent(query)).not.toContain('filter[repository]');
  });
});
