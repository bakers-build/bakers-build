import type {
  Collection,
  JsonApiClient,
  Resource,
  ResourceWriteBody,
} from 'dropsh/plugin';
import { HttpError } from 'dropsh/plugin';
import { describe, expect, it, vi } from 'vitest';
import {
  AmbiguousProjectNameError,
  ConductorTakeoverRequired,
  createRunLogFetcher,
  DrupalBbRemote,
  drupalRemote,
  RunLogSizeError,
} from '../src/index.js';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return {
    ...actual,
    resolveAuth: vi.fn(async () => ({ apply: async (r: unknown) => r })),
  };
});

const { fakeContextClient } = vi.hoisted(() => ({
  fakeContextClient: { __marker: 'fake-context-client' } as unknown,
}));

vi.mock('@bakers-build/core', async (orig) => {
  const actual = await orig<typeof import('@bakers-build/core')>();
  return {
    ...actual,
    createBbConnectionContext: vi.fn(async () => ({
      client: fakeContextClient,
      http: {
        send: vi.fn(async () => ({ status: 200, headers: {}, body: '' })),
      },
      auth: { apply: async (r: unknown) => r },
      baseUrl: 'https://develop.dev.bakers.build',
    })),
  };
});

function fakeResource(
  id: string,
  attributes: Record<string, unknown> = {},
  rels: Record<string, string | null> = {},
): Resource {
  return {
    id,
    type: 'fake',
    attr: <T = unknown>(key: string) => attributes[key] as T | undefined,
    rel: (key: string) => rels[key] ?? null,
    rels: () => [],
    raw: { id, type: 'fake', attributes },
  };
}

interface CollectionStub extends Collection {
  __listRows: Resource[];
  __firstRow: Resource | null;
  __count: number;
}

function fakeCollection(opts?: {
  list?: Resource[];
  first?: Resource | null;
  count?: number;
}): CollectionStub {
  const col = {
    __listRows: opts?.list ?? [],
    __firstRow: opts?.first ?? null,
    __count: opts?.count ?? 0,
    where: vi.fn(() => col),
    whereIn: vi.fn(() => col),
    notExists: vi.fn(() => col),
    fields: vi.fn(() => col),
    sort: vi.fn(() => col),
    page: vi.fn(() => col),
    list: vi.fn(async () => col.__listRows),
    first: vi.fn(async () => col.__firstRow),
    count: vi.fn(async () => col.__count),
  } as unknown as CollectionStub;
  return col;
}

function fakeClient(overrides: Partial<JsonApiClient> = {}): JsonApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    collection: vi.fn(() => fakeCollection()),
    resource: vi.fn(),
    create: vi.fn(async () => fakeResource('created')),
    update: vi.fn(async () => fakeResource('updated')),
    upsert: vi.fn(async () => fakeResource('upserted')),
    me: vi.fn(async () => 'user-uuid'),
    ...overrides,
  } as unknown as JsonApiClient;
}

describe('DrupalBbRemote', () => {
  it('fetchActiveRuns maps rows to {runUuid,ticketUuid,ticketIdentifier,state}', async () => {
    const rows = [
      fakeResource(
        'run-1',
        { state: 'running', state_at_start: 'working' },
        { ticket_id: 'tic-1' },
      ),
      fakeResource(
        'run-2',
        { state: 'claimed', state_at_start: 'review' },
        { ticket_id: 'tic-2' },
      ),
    ];
    const col = fakeCollection({ list: rows });
    // resource is called by getRunTicketIdentifier: first for the run (to get
    // ticket_id), then for the ticket (to get the identifier).
    const resource = vi.fn(async (_type: string, id: string) => {
      if (id === 'run-1')
        return fakeResource(
          'run-1',
          { state_at_start: 'working' },
          { ticket_id: 'tic-1' },
        );
      if (id === 'run-2')
        return fakeResource(
          'run-2',
          { state_at_start: 'review' },
          { ticket_id: 'tic-2' },
        );
      if (id === 'tic-1')
        return fakeResource('tic-1', {
          identifier: 'BB-1',
          branch_name: 'bakers/bb-1',
        });
      if (id === 'tic-2')
        return fakeResource('tic-2', {
          identifier: 'BB-2',
          branch_name: 'bakers/bb-2',
        });
      return fakeResource(id);
    });
    const api = fakeClient({ collection: vi.fn(() => col), resource });
    const remote = new DrupalBbRemote(api);

    const active = await remote.fetchActiveRuns('cond-id');

    expect(api.collection).toHaveBeenCalledWith('bb_run');
    expect(col.where).toHaveBeenCalledWith(
      'conductor_id.conductor_id',
      '=',
      'cond-id',
    );
    expect(col.whereIn).toHaveBeenCalledWith('state', ['claimed', 'running']);
    expect(active).toEqual([
      {
        runUuid: 'run-1',
        ticketUuid: 'tic-1',
        ticketIdentifier: 'BB-1',
        branchName: 'bakers/bb-1',
        state: 'running',
        stateAtStart: 'working',
        worktreePath: '',
      },
      {
        runUuid: 'run-2',
        ticketUuid: 'tic-2',
        ticketIdentifier: 'BB-2',
        branchName: 'bakers/bb-2',
        state: 'claimed',
        stateAtStart: 'review',
        worktreePath: '',
      },
    ]);
  });

  it('activeRunCount returns the bounded count', async () => {
    const col = fakeCollection({ count: 3 });
    const api = fakeClient({ collection: vi.fn(() => col) });
    const remote = new DrupalBbRemote(api);
    expect(await remote.activeRunCount('cond-id')).toBe(3);
    expect(col.count).toHaveBeenCalled();
  });

  it('machineCapacity reads bb_machine by host_key (BB-353 D5)', async () => {
    const col = fakeCollection({
      first: fakeResource('machine-uuid', {
        max_parallel: 4,
        current_load: 3,
      }),
    });
    const collection = vi.fn(() => col);
    const remote = new DrupalBbRemote(fakeClient({ collection }));

    expect(await remote.machineCapacity('dev-box')).toEqual({
      maxParallel: 4,
      currentLoad: 3,
    });
    expect(collection).toHaveBeenCalledWith('bb_machine');
    expect(col.where).toHaveBeenCalledWith('host_key', '=', 'dev-box');
  });

  it('machineCapacity returns null when no machine matches host_key', async () => {
    const col = fakeCollection({ first: null });
    const remote = new DrupalBbRemote(
      fakeClient({ collection: vi.fn(() => col) }),
    );
    expect(await remote.machineCapacity('missing')).toBeNull();
  });

  it('machineCapacity returns null when the machine carries no budget', async () => {
    const col = fakeCollection({
      first: fakeResource('machine-uuid', { current_load: 1 }),
    });
    const remote = new DrupalBbRemote(
      fakeClient({ collection: vi.fn(() => col) }),
    );
    expect(await remote.machineCapacity('dev-box')).toBeNull();
  });

  it('listConductors maps maxParallel from linked machine, not conductor max_parallel (BB-353)', async () => {
    // Capacity lives on bb_machine; conductor.max_parallel was removed. A
    // stale/legacy conductor attribute must not be treated as SoT.
    const conductorRows = [
      fakeResource(
        'cond-uuid-1',
        {
          conductor_id: 'host-a-bakers',
          label: 'main',
          status: 'online',
          last_seen: 1_700_000_000,
          reported_load: 1,
          workspace_root: '/repo',
          lease_expires_at: 1_700_000_300,
          // Removed field — if present on the wire it must be ignored.
          max_parallel: 99,
        },
        { project_id: 'proj-uuid', machine: 'machine-uuid' },
      ),
      fakeResource(
        'cond-uuid-2',
        {
          conductor_id: 'host-a-shop',
          label: 'shop',
          status: 'offline',
          last_seen: 0,
          reported_load: 0,
          workspace_root: '/repo',
          lease_expires_at: 0,
        },
        // No machine relationship → capacity is 0, not invented from conductor.
        { project_id: 'proj-uuid' },
      ),
    ];
    const col = fakeCollection({ list: conductorRows });
    const resource = vi.fn(async (type: string, id: string) => {
      if (type === 'bb_project' && id === 'proj-uuid') {
        return fakeResource('proj-uuid', { name: 'bakers' });
      }
      if (type === 'bb_machine' && id === 'machine-uuid') {
        return fakeResource('machine-uuid', {
          max_parallel: 4,
          current_load: 1,
          host_key: 'host-a',
        });
      }
      return fakeResource(id);
    });
    const remote = new DrupalBbRemote(
      fakeClient({ collection: vi.fn(() => col), resource }),
    );

    const listed = await remote.listConductors();

    expect(listed).toHaveLength(2);
    expect(listed[0]?.maxParallel).toBe(4);
    expect(listed[0]?.maxParallel).not.toBe(99);
    expect(listed[1]?.maxParallel).toBe(0);
    expect(resource).toHaveBeenCalledWith('bb_machine', 'machine-uuid');
  });

  it('listConductors resolves hostKey from the related bb_machine, never from bb_conductor (BB-450 B7)', async () => {
    // bb_conductor carries no host_key field at all — filter[host_key]
    // against it is a server-side 400. The value lives on bb_machine, one
    // relationship hop away, same as max_parallel.
    const conductorRows = [
      fakeResource(
        'cond-uuid-1',
        {
          conductor_id: 'host-a-bakers',
          label: 'main',
          status: 'online',
          last_seen: 1_700_000_000,
        },
        { project_id: 'proj-uuid', machine: 'machine-uuid' },
      ),
      fakeResource(
        'cond-uuid-2',
        { conductor_id: 'no-machine', label: 'orphan', status: 'offline' },
        // No machine relationship → no hostKey, not invented.
        { project_id: 'proj-uuid' },
      ),
    ];
    const col = fakeCollection({ list: conductorRows });
    const resource = vi.fn(async (type: string, id: string) => {
      if (type === 'bb_project' && id === 'proj-uuid') {
        return fakeResource('proj-uuid', { name: 'bakers' });
      }
      if (type === 'bb_machine' && id === 'machine-uuid') {
        return fakeResource('machine-uuid', {
          max_parallel: 4,
          host_key: 'cw-framework',
        });
      }
      return fakeResource(id);
    });
    const remote = new DrupalBbRemote(
      fakeClient({ collection: vi.fn(() => col), resource }),
    );

    const listed = await remote.listConductors();

    expect(listed[0]?.hostKey).toBe('cw-framework');
    expect(listed[1]?.hostKey).toBeUndefined();
  });

  it('resolveTicketByIdentifier scopes by project uuid AND identifier, caches the project', async () => {
    const projectCol = fakeCollection({
      first: fakeResource('proj-1'),
      list: [fakeResource('proj-1')],
    });
    const ticketCol = fakeCollection({
      first: fakeResource('tic-134', { title: 'Do a thing' }),
    });
    const collection = vi.fn((type: string) =>
      type === 'bb_project' ? projectCol : ticketCol,
    );
    const remote = new DrupalBbRemote(fakeClient({ collection }));

    const hit = await remote.resolveTicketByIdentifier('bakers', 'BB-134');

    expect(hit).toEqual({ uuid: 'tic-134', title: 'Do a thing' });
    expect(projectCol.where).toHaveBeenCalledWith('name', '=', 'bakers');
    // the scoping contract: BOTH the identifier and the project uuid are filtered.
    expect(ticketCol.where).toHaveBeenCalledWith('identifier', '=', 'BB-134');
    expect(ticketCol.where).toHaveBeenCalledWith(
      'project_id.id',
      '=',
      'proj-1',
    );

    // a second lookup reuses the cached project uuid — no second bb_project fetch.
    await remote.resolveTicketByIdentifier('bakers', 'BB-135');
    const projectFetches = collection.mock.calls.filter(
      ([t]) => t === 'bb_project',
    ).length;
    expect(projectFetches).toBe(1);
  });

  it('resolveTicketByIdentifier returns null when the ticket is absent', async () => {
    const projectCol = fakeCollection({
      first: fakeResource('proj-1'),
      list: [fakeResource('proj-1')],
    });
    const ticketCol = fakeCollection({ first: null });
    const collection = vi.fn((type: string) =>
      type === 'bb_project' ? projectCol : ticketCol,
    );
    const remote = new DrupalBbRemote(fakeClient({ collection }));
    expect(
      await remote.resolveTicketByIdentifier('bakers', 'BB-999'),
    ).toBeNull();
  });

  // BB-472: bb_project.name carries no uniqueness constraint, so picking
  // the first row of a name match is an arbitrary pick with no error.
  it('resolveTicketByIdentifier throws AmbiguousProjectNameError when two projects share a name', async () => {
    const projectCol = fakeCollection({
      first: fakeResource('proj-1'),
      list: [fakeResource('proj-1'), fakeResource('proj-2')],
    });
    const ticketCol = fakeCollection({ first: null });
    const collection = vi.fn((type: string) =>
      type === 'bb_project' ? projectCol : ticketCol,
    );
    const remote = new DrupalBbRemote(fakeClient({ collection }));
    await expect(
      remote.resolveTicketByIdentifier('bakers', 'BB-999'),
    ).rejects.toBeInstanceOf(AmbiguousProjectNameError);
    await expect(
      remote.resolveTicketByIdentifier('bakers', 'BB-999'),
    ).rejects.toThrow(/project "bakers" is ambiguous.*2/i);
  });

  it('claimNext maps a claim response to a ClaimedRun', async () => {
    const api = fakeClient({
      post: vi.fn(async () => ({
        data: {
          id: 'run-9',
          attributes: { state_at_start: 'working', drupal_internal__id: 9 },
          relationships: { ticket_id: { data: { id: 'tic-9' } } },
        },
      })),
    });
    const remote = new DrupalBbRemote(api);

    const claimed = await remote.claimNext({
      leaseSeconds: 300,
      conductorId: 'c1',
    });

    expect(api.post).toHaveBeenCalledWith('bakers/claim-next', {
      data: {
        attributes: {
          lease_seconds: 300,
          conductor_id: 'c1',
          machine_id: 'c1',
        },
      },
    });
    expect(claimed).toEqual({
      runUuid: 'run-9',
      runId: 9,
      ticketUuid: 'tic-9',
      stateAtStart: 'working',
      handler: 'working',
    });
  });

  it('claimNext throws when drupal_internal__id is absent', async () => {
    const api = fakeClient({
      post: vi.fn(async () => ({
        data: {
          id: 'run-bad',
          attributes: { state_at_start: 'working' },
          relationships: { ticket_id: { data: { id: 'tic-bad' } } },
        },
      })),
    });
    const remote = new DrupalBbRemote(api);
    await expect(
      remote.claimNext({ leaseSeconds: 300, conductorId: 'c1' }),
    ).rejects.toThrow('claimNext: missing drupal_internal__id on run run-bad');
  });

  it('exposes the numeric run id from drupal_internal__id', async () => {
    const api = fakeClient({
      post: vi.fn(async () => ({
        data: {
          id: 'run-uuid-1',
          attributes: { state_at_start: 'working', drupal_internal__id: 12 },
          relationships: { ticket_id: { data: { id: 'ticket-uuid-1' } } },
        },
      })),
    });
    const remote = new DrupalBbRemote(api);
    const run = await remote.claimNext({
      leaseSeconds: 300,
      conductorId: 'c1',
    });
    expect(run).toMatchObject({ runId: 12 });
  });

  it('claimNext preserves authoritative capacity withholding', async () => {
    const remote = new DrupalBbRemote(
      fakeClient({
        post: vi.fn(async () => ({
          data: null,
          meta: {
            claim: {
              reason: 'machine_capacity',
              occupancy: 9,
              capacity: 9,
              retry_at: null,
            },
          },
        })),
      }),
    );
    expect(
      await remote.claimNext({ leaseSeconds: 300, conductorId: 'c1' }),
    ).toEqual({
      reason: 'machine_capacity',
      occupancy: 9,
      capacity: 9,
      retryAt: null,
    });
  });

  it.each([
    undefined,
    null,
    {},
    { data: null },
  ])('claimNext accepts legacy no-content response %j', async (response) => {
    const api = fakeClient({ post: vi.fn(async () => response) });
    const remote = new DrupalBbRemote(api);
    expect(
      await remote.claimNext({ leaseSeconds: 300, conductorId: 'c1' }),
    ).toBeNull();
  });

  it('rejects incomplete capacity metadata instead of reporting idle', async () => {
    const remote = new DrupalBbRemote(
      fakeClient({
        post: vi.fn(async () => ({
          data: null,
          meta: { claim: { reason: 'machine_capacity' } },
        })),
      }),
    );
    await expect(
      remote.claimNext({ leaseSeconds: 300, conductorId: 'c1' }),
    ).rejects.toThrow('claimNext: invalid machine capacity outcome');
  });

  it('getTicket maps fields + origin url in one request, no comment sideload (BB-112)', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-1',
        attributes: {
          identifier: 'GL-1',
          title: 'Title',
          state: 'working',
          branch_name: 'bakers/gl-1',
          origin: 'https://gitlab/issue/1',
        },
      },
    }));
    const api = fakeClient({ get });
    const remote = new DrupalBbRemote(api);
    const ticket = await remote.getTicket('tic-1');
    // The agent self-reads comments at run start; getTicket no longer sideloads
    // them, so the request carries no ?include=comments — but it DOES sideload
    // labels + environments for agent selection (BB-144), and BB-495's
    // project_id.group_id.workspace_id chain for the dispatch env.
    expect(get).toHaveBeenCalledWith(
      'bb_ticket/bb_ticket/tic-1?include=labels,environments,ticket_type,recipe,project_id.group_id.workspace_id',
    );
    expect(ticket).toEqual({
      uuid: 'tic-1',
      identifier: 'GL-1',
      title: 'Title',
      state: 'working',
      branchName: 'bakers/gl-1',
      issueUrl: 'https://gitlab/issue/1',
      labels: [],
      environments: [],
    });
    expect(ticket).not.toHaveProperty('comments');
  });

  it('getTicket sideloads labels + environments from included (BB-144)', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-7',
        attributes: { identifier: 'GL-7', title: 'Sel', state: 'working' },
        relationships: {
          labels: {
            data: [
              { type: 'bb_term--label', id: 'lbl-1' },
              { type: 'bb_term--label', id: 'lbl-2' },
            ],
          },
          environments: {
            data: [{ type: 'bb_environment--bb_environment', id: 'env-1' }],
          },
        },
      },
      included: [
        {
          type: 'bb_term--label',
          id: 'lbl-1',
          attributes: { name: 'infra' },
        },
        {
          type: 'bb_term--label',
          id: 'lbl-2',
          attributes: { name: 'urgent' },
        },
        {
          type: 'bb_environment--bb_environment',
          id: 'env-1',
          attributes: { name: 'dev2', tier: 'dev' },
        },
      ],
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-7');
    expect(ticket.labels).toEqual(['infra', 'urgent']);
    expect(ticket.environments).toEqual([{ name: 'dev2', tier: 'dev' }]);
  });

  it('getTicket sideloads the ticket type and recipe names, for agent selection', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-8',
        attributes: { identifier: 'GL-8', title: 'Typed', state: 'working' },
        relationships: {
          ticket_type: { data: { type: 'bb_term--type', id: 'typ-1' } },
          recipe: { data: { type: 'bb_term--recipe', id: 'rec-1' } },
        },
      },
      included: [
        { type: 'bb_term--type', id: 'typ-1', attributes: { name: 'feature' } },
        { type: 'bb_term--recipe', id: 'rec-1', attributes: { name: 'matt' } },
      ],
    }));
    const ticket = await new DrupalBbRemote(fakeClient({ get })).getTicket(
      'tic-8',
    );
    expect(ticket).toMatchObject({ type: 'feature', recipe: 'matt' });
  });

  // BB-495: the dotted include resolves project AND workspace in one request
  // — a bb_project belongs to a bb_group (the OG group), which belongs to
  // a bb_workspace.
  it('getTicket resolves project + workspace through the project_id.group_id.workspace_id chain', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-11',
        attributes: { identifier: 'GL-11', title: 'Chain', state: 'working' },
        relationships: {
          project_id: {
            data: { type: 'bb_project--bb_project', id: 'proj-1' },
          },
        },
      },
      included: [
        {
          type: 'bb_project--bb_project',
          id: 'proj-1',
          attributes: { name: 'Demo Project' },
          relationships: {
            group_id: { data: { type: 'bb_group--bb_group', id: 'grp-1' } },
          },
        },
        {
          type: 'bb_group--bb_group',
          id: 'grp-1',
          relationships: {
            workspace_id: {
              data: { type: 'bb_workspace--bb_workspace', id: 'ws-1' },
            },
          },
        },
        {
          type: 'bb_workspace--bb_workspace',
          id: 'ws-1',
          attributes: { name: 'Acme' },
        },
      ],
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-11');
    expect(ticket.projectId).toBe('proj-1');
    expect(ticket.projectName).toBe('Demo Project');
    expect(ticket.workspaceId).toBe('ws-1');
    expect(ticket.workspaceName).toBe('Acme');
  });

  it('getTicket omits project/workspace fields entirely when the relationship is absent', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-12',
        attributes: {
          identifier: 'GL-12',
          title: 'No project',
          state: 'working',
        },
      },
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-12');
    expect(ticket).not.toHaveProperty('projectId');
    expect(ticket).not.toHaveProperty('projectName');
    expect(ticket).not.toHaveProperty('workspaceId');
    expect(ticket).not.toHaveProperty('workspaceName');
  });

  it('getTicket yields empty labels/environments when relationships are absent', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-8',
        attributes: { identifier: 'GL-8', title: 'Bare', state: 'todo' },
      },
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-8');
    expect(ticket.labels).toEqual([]);
    expect(ticket.environments).toEqual([]);
  });

  it('getTicket maps base_branch → baseBranch', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-3',
        attributes: {
          identifier: 'P-2',
          title: 'X',
          state: 'working',
          branch_name: 'feat/p-2-x',
          base_branch: 'feat/p-1-parent',
        },
      },
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-3');
    expect(ticket.baseBranch).toBe('feat/p-1-parent');
  });

  it('getTicket maps effective_env_vars → effectiveEnvVars', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-9',
        attributes: {
          identifier: 'P-9',
          title: 'Env',
          state: 'working',
          effective_env_vars: 'A=1\nB=2',
        },
      },
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-9');
    expect(ticket.effectiveEnvVars).toBe('A=1\nB=2');
  });

  it('getTicket omits effectiveEnvVars when unset or empty', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-10',
        attributes: {
          identifier: 'P-10',
          title: 'NoEnv',
          state: 'todo',
          effective_env_vars: '',
        },
      },
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-10');
    expect(ticket.effectiveEnvVars).toBeUndefined();
  });

  it('getTicket omits baseBranch when base_branch is unset', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-4',
        attributes: { identifier: 'GL-4', title: 'No base', state: 'todo' },
      },
    }));
    const remote = new DrupalBbRemote(fakeClient({ get }));
    const ticket = await remote.getTicket('tic-4');
    expect(ticket.baseBranch).toBeUndefined();
  });

  it('getTicket returns empty branchName when unset', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'tic-2',
        attributes: { identifier: 'GL-2', title: 'No branch', state: 'todo' },
      },
    }));
    const api = fakeClient({ get });
    const remote = new DrupalBbRemote(api);
    const ticket = await remote.getTicket('tic-2');
    expect(ticket.branchName).toBe('');
    expect(ticket).not.toHaveProperty('comments');
  });

  it('getReachableWorkspaces lists bb_workspace uuids (BB-495)', async () => {
    const col = fakeCollection({
      list: [fakeResource('ws-1'), fakeResource('ws-2')],
    });
    const api = fakeClient({ collection: vi.fn(() => col) });
    const remote = new DrupalBbRemote(api);
    const ids = await remote.getReachableWorkspaces();
    expect(api.collection).toHaveBeenCalledWith('bb_workspace');
    expect(col.page).toHaveBeenCalledWith(200);
    expect(ids).toEqual(['ws-1', 'ws-2']);
  });

  it('getRunTicketBranchName resolves run→ticket→branch_name', async () => {
    const resource = vi.fn(async (_type: string, id: string) => {
      if (id === 'run-5')
        return fakeResource('run-5', {}, { ticket_id: 'tic-5' });
      if (id === 'tic-5')
        return fakeResource('tic-5', { branch_name: 'bakers/feature-x' });
      return fakeResource(id);
    });
    const api = fakeClient({ resource });
    const remote = new DrupalBbRemote(api);
    const branch = await remote.getRunTicketBranchName('run-5');
    expect(branch).toBe('bakers/feature-x');
  });

  it('getRunTicketBranchName returns empty string when run has no ticket', async () => {
    const resource = vi.fn(async (_type: string, id: string) => {
      if (id === 'run-6') return fakeResource('run-6', {}, {});
      return fakeResource(id);
    });
    const api = fakeClient({ resource });
    const remote = new DrupalBbRemote(api);
    const branch = await remote.getRunTicketBranchName('run-6');
    expect(branch).toBe('');
  });

  it('registerConductor POSTs full registration to bakers/heartbeat and returns data.id', async () => {
    const post = vi.fn(async () => ({
      data: { id: 'drupal-uuid', attributes: { status: 'online' } },
    }));
    const upsert = vi.fn(async () => fakeResource('upserted'));
    const api = fakeClient({ post, upsert });
    const remote = new DrupalBbRemote(api);

    const uuid = await remote.registerConductor({
      id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30-bakers-conductor',
      host_key: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
      machine_label: 'cw-laptop',
      project: 'bakers',
      states: ['todo'],
      workspace: '/checkout',
      label: 'cw-laptop · bakers',
    });

    expect(uuid).toBe('drupal-uuid');
    expect(upsert).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('bakers/heartbeat');
    const body = post.mock.calls[0]?.[1] as {
      data: { attributes: Record<string, unknown> };
    };
    expect(body.data.attributes).toMatchObject({
      conductor_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30-bakers-conductor',
      host_key: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
      machine_label: 'cw-laptop',
      project: 'bakers',
      states: ['todo'],
      workspace_root: '/checkout',
      label: 'cw-laptop · bakers',
    });
    expect(body.data.attributes).not.toHaveProperty('current_load');
    // The run budget is a backend setting; registration never sends it.
    expect(body.data.attributes).not.toHaveProperty('max_parallel');
  });

  const takeoverReg = {
    id: 'framework-bakers-conductor',
    host_key: 'framework',
    project: 'bakers',
    states: [],
    workspace: '/checkout',
    label: 'lbl',
  };

  it.each([
    undefined,
    null,
    'ssh://user@host:22',
  ])('transports connection_url %s with exact presence', async (connection_url) => {
    const post = vi.fn(async () => ({ data: { id: 'uuid' } }));
    const remote = new DrupalBbRemote(fakeClient({ post }));
    await remote.registerConductor({
      ...takeoverReg,
      ...(connection_url !== undefined ? { connection_url } : {}),
    });
    const body = post.mock.calls[0]?.[1] as {
      data: { attributes: Record<string, unknown> };
    };
    expect(Object.hasOwn(body.data.attributes, 'connection_url')).toBe(
      connection_url !== undefined,
    );
    expect(body.data.attributes.connection_url).toBe(connection_url);
  });

  it('registerConductor turns a takeover 409 into the offered conductors', async () => {
    const detail = 'Take over "cw-framework", or start a new conductor.';
    const post = vi.fn(async () => {
      throw new HttpError(409, 'HTTP 409', {
        errors: [
          {
            status: '409',
            detail,
            meta: {
              candidates: [
                {
                  uuid: '1cdd3fcb-2156-4e3c-877d-52665142268c',
                  label: 'cw-framework',
                  conductor_id: 'cw-framework',
                  last_seen: 1762214400,
                },
              ],
            },
          },
        ],
      });
    });
    const remote = new DrupalBbRemote(fakeClient({ post }));

    const refused = remote.registerConductor(takeoverReg);

    await expect(refused).rejects.toBeInstanceOf(ConductorTakeoverRequired);
    await expect(refused).rejects.toMatchObject({
      message: detail,
      adoptable: ['1cdd3fcb-2156-4e3c-877d-52665142268c'],
    });
  });

  it('registerConductor passes on a 409 that offers no conductors', async () => {
    const post = vi.fn(async () => {
      throw new HttpError(409, 'HTTP 409', {
        errors: [{ status: '409', detail: 'belongs to another user' }],
      });
    });
    const remote = new DrupalBbRemote(fakeClient({ post }));

    const refused = remote.registerConductor(takeoverReg);

    await expect(refused).rejects.toBeInstanceOf(HttpError);
    await expect(refused).rejects.not.toBeInstanceOf(ConductorTakeoverRequired);
  });

  it('registerConductor forwards the takeover decision', async () => {
    const post = vi.fn(async () => ({
      data: { id: 'drupal-uuid', attributes: { status: 'online' } },
    }));
    const remote = new DrupalBbRemote(fakeClient({ post }));
    const reg = {
      id: 'framework-bakers-conductor',
      host_key: 'framework',
      project: 'bakers',
      states: [],
      workspace: '/checkout',
      label: 'lbl',
    };

    await remote.registerConductor({ ...reg, adopt: 'old-uuid' });
    await remote.registerConductor({ ...reg, create_new: true });

    const attrs = (n: number) =>
      (post.mock.calls[n]?.[1] as { data?: { attributes?: object } })?.data
        ?.attributes;
    expect(attrs(0)).toMatchObject({ adopt: 'old-uuid' });
    expect(attrs(0)).not.toHaveProperty('create_new');
    expect(attrs(1)).toMatchObject({ create_new: true });
  });

  it('registerConductor fails when the heartbeat document omits data.id', async () => {
    const post = vi.fn(async () => ({
      data: { attributes: { status: 'online' } },
    }));
    const remote = new DrupalBbRemote(fakeClient({ post }));

    await expect(
      remote.registerConductor({
        id: 'machine-1',
        project: 'bakers',
        states: ['todo'],
        workspace: '/checkout',
        label: 'lbl',
      }),
    ).rejects.toThrow(/data\.id/);
  });

  it('heartbeat POSTs the registration to bakers/heartbeat and returns the status', async () => {
    const post = vi.fn(async () => ({
      data: { attributes: { status: 'offline' } },
    }));
    const api = fakeClient({ post });
    const remote = new DrupalBbRemote(api);

    const status = await remote.heartbeat(
      {
        id: 'machine-1',
        project: 'bakers',
        states: ['todo'],
        workspace: '/checkout',
        label: 'lbl',
      },
      2,
      300,
    );

    expect(status).toBe('offline');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('bakers/heartbeat');
    const body = post.mock.calls[0]?.[1] as {
      data: { attributes: Record<string, unknown> };
    };
    expect(body.data.attributes).toMatchObject({
      conductor_id: 'machine-1',
      project: 'bakers',
      current_load: 2,
      lease_seconds: 300,
    });
  });

  it('heartbeat defaults to online when the response omits a status', async () => {
    const post = vi.fn(async () => ({ data: { attributes: {} } }));
    const remote = new DrupalBbRemote(fakeClient({ post }));

    const status = await remote.heartbeat(
      {
        id: 'm',
        project: 'bakers',
        states: [],
        workspace: '/c',
        label: 'l',
      },
      0,
    );

    expect(status).toBe('online');
  });

  it('setConductorStatus POSTs the entity-bound offline operation, never a status PATCH', async () => {
    const col = fakeCollection({ first: fakeResource('drupal-uuid') });
    const post = vi.fn(async () => ({
      data: { id: 'drupal-uuid', attributes: { status: 'offline' } },
    }));
    const update = vi.fn(async () => fakeResource('x'));
    const api = fakeClient({ collection: vi.fn(() => col), post, update });
    const remote = new DrupalBbRemote(api);

    await remote.setConductorStatus('machine-1', 'offline');

    expect(col.where).toHaveBeenCalledWith('conductor_id', '=', 'machine-1');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('bb_conductor/drupal-uuid/offline');
    expect(update).not.toHaveBeenCalled();
  });

  it('setConductorStatus rejects unsupported status values', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const post = vi.fn(async () => ({}));
    const remote = new DrupalBbRemote(fakeClient({ post, update }));

    await expect(
      // @ts-expect-error runtime still rejects values the type forbids
      remote.setConductorStatus('machine-1', 'online'),
    ).rejects.toThrow(/unsupported status/i);
    expect(post).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('markRunning patches state=running + heartbeat', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const api = fakeClient({ update });
    const remote = new DrupalBbRemote(api);
    await remote.markRunning('run-1');
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(update.mock.calls[0]?.[0]).toBe('bb_run');
    expect(body.attributes).toHaveProperty('state', 'running');
    expect(body.attributes).toHaveProperty('heartbeat');
    expect(body.attributes).not.toHaveProperty('claim_expires_at');
  });

  it('markRunning patches worktree_path when provided', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const api = fakeClient({ update });
    const remote = new DrupalBbRemote(api);
    await remote.markRunning('run-1', { worktree_path: '/abs/worktree' });
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(body.attributes).toHaveProperty('worktree_path', '/abs/worktree');
  });

  it('markRunning patches agent when provided (BB-144)', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const remote = new DrupalBbRemote(fakeClient({ update }));
    await remote.markRunning('run-1', {
      worktree_path: '/abs/worktree',
      agent: 'claude',
    });
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(body.attributes).toHaveProperty('agent', 'claude');
  });

  it('markRunning patches started_at when provided (BB-473 round 4) — re-stamped every dispatch, including a re-dispatch, as an attempt boundary for transcript selection', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const remote = new DrupalBbRemote(fakeClient({ update }));
    await remote.markRunning('run-1', {
      worktree_path: '/abs/worktree',
      agent: 'claude',
      startedAt: '2026-09-15T21:00:00.000Z',
    });
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    // BB-473 review round 4, Critical 1: `bb_run.started_at` is a Drupal
    // `timestamp` field, whose normalizer accepts epoch seconds, ISO 8601 or
    // RFC 3339 — never a fractional-second string. Sent as whole seconds,
    // matching `heartbeat`/`closed_date`.
    expect(body.attributes).toHaveProperty('started_at', 1789506000);
  });

  it('markRunning sends started_at unchanged when already given as epoch seconds', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const remote = new DrupalBbRemote(fakeClient({ update }));
    await remote.markRunning('run-1', {
      worktree_path: '/abs/worktree',
      agent: 'claude',
      startedAt: 1789506000,
    });
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(body.attributes).toHaveProperty('started_at', 1789506000);
  });

  it('markRunning omits started_at when not provided (unchanged behaviour)', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const remote = new DrupalBbRemote(fakeClient({ update }));
    await remote.markRunning('run-1', { worktree_path: '/abs/worktree' });
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(body.attributes).not.toHaveProperty('started_at');
  });

  it('markFailed patches state=failed + error_log + closed (BB-149)', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const api = fakeClient({ update });
    const remote = new DrupalBbRemote(api);
    await remote.markFailed('run-1', 'startRun boom');
    expect(update.mock.calls[0]?.[0]).toBe('bb_run');
    expect(update.mock.calls[0]?.[1]).toBe('run-1');
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(body.attributes).toHaveProperty('state', 'failed');
    expect(body.attributes).toHaveProperty('error_log', 'startRun boom');
    expect(body.attributes).toHaveProperty('closed', true);
    expect(body.attributes).toHaveProperty('closed_date');
  });

  const CLOSE_METRICS = {
    tokens: 12,
    duration_s: 3,
    agent_turns: 1,
    tool_calls: 2,
    user_prompts: 1,
    user_prompt_words: 4,
    harness: 'claude',
  };

  it('finalizeRun omits the log after a recognized size rejection', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new RunLogSizeError('oversize'))
      .mockResolvedValueOnce(fakeResource('run-1'));
    const remote = new DrupalBbRemote(fakeClient({ update }));
    await remote.finalizeRun('run-1', 'HUGE TRANSCRIPT', CLOSE_METRICS);
    expect(update).toHaveBeenCalledTimes(2);
    const original = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(original.attributes).toMatchObject({
      closed: true,
      log: 'HUGE TRANSCRIPT',
      ...CLOSE_METRICS,
    });
    const fallback = update.mock.calls[1]?.[2] as ResourceWriteBody;
    expect(fallback.attributes).toMatchObject({
      closed: true,
      log_upload_omitted: true,
      closed_date: original.attributes?.closed_date,
      ...CLOSE_METRICS,
    });
    expect(fallback.attributes).not.toHaveProperty('log');
    expect(fallback.attributes).not.toHaveProperty('error_log');
  });

  it('finalizeRun never omits on timeout, 403, 415 or disk-related 500', async () => {
    const errors = [
      new HttpError(0, 'Network failure after 1 attempts'),
      new HttpError(403, 'HTTP 403'),
      new HttpError(415, 'HTTP 415'),
      new HttpError(500, 'No space left on device'),
    ];
    for (const err of errors) {
      const update = vi.fn(async () => {
        throw err;
      });
      const resource = vi.fn();
      const remote = new DrupalBbRemote(fakeClient({ update, resource }));
      await expect(
        remote.finalizeRun('run-1', 'TRANSCRIPT', CLOSE_METRICS),
      ).rejects.toBe(err);
      expect(update).toHaveBeenCalledTimes(1);
      expect(resource).not.toHaveBeenCalled();
    }
  });

  it('reconciles a lost fallback by reading closed status and does not write again', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new RunLogSizeError('oversize'))
      .mockRejectedValueOnce(
        new HttpError(0, 'Network failure after 1 attempts'),
      );
    const resource = vi.fn(async () => fakeResource('run-1', { closed: true }));
    const remote = new DrupalBbRemote(fakeClient({ update, resource }));
    await remote.finalizeRun('run-1', 'HUGE TRANSCRIPT', CLOSE_METRICS);
    expect(update).toHaveBeenCalledTimes(2);
    expect(resource).toHaveBeenCalledWith('bb_run', 'run-1');
    const fallback = update.mock.calls[1]?.[2] as ResourceWriteBody;
    expect(fallback.attributes).toMatchObject({
      closed: true,
      log_upload_omitted: true,
    });
    expect(fallback.attributes).not.toHaveProperty('log');
  });

  it('does not PATCH again when a lost fallback left the run unclosed', async () => {
    const lost = new HttpError(0, 'Network failure after 1 attempts');
    const update = vi
      .fn()
      .mockRejectedValueOnce(new RunLogSizeError('oversize'))
      .mockRejectedValueOnce(lost);
    const resource = vi.fn(async () =>
      fakeResource('run-1', { closed: false }),
    );
    const remote = new DrupalBbRemote(fakeClient({ update, resource }));
    await expect(
      remote.finalizeRun('run-1', 'HUGE TRANSCRIPT', CLOSE_METRICS),
    ).rejects.toBe(lost);
    expect(update).toHaveBeenCalledTimes(2);
    expect(resource).toHaveBeenCalledTimes(1);
  });

  it('fetchFinalizableRuns maps the agent id from the run doc (BB-144); reads started_at ONLY as a transcript-selection lower bound (BB-473), never for duration_s (BB-151)', async () => {
    const col = fakeCollection({
      list: [
        fakeResource('run-1', {
          worktree_path: '/wt/1',
          agent: 'codex',
          drupal_internal__id: 7,
          started_at: '2026-09-15T10:00:00+00:00',
        }),
      ],
    });
    const remote = new DrupalBbRemote(fakeClient({ collection: () => col }));
    const runs = await remote.fetchFinalizableRuns('machine-1');
    // duration_s is STILL derived from the agent transcript at finalize
    // (BB-151) — started_at is read back only so agents with no
    // session-id mechanism (codex, opencode) can discard a transcript older
    // than the run's own start (BB-473). It DOES request
    // drupal_internal__id — the `#<runId>` tab-label token for the run-scoped
    // tab-close (BB-183).
    expect(col.fields).toHaveBeenCalledWith([
      'worktree_path',
      'agent',
      'drupal_internal__id',
      'started_at',
      'state_at_start',
      'ticket_id',
      'run_log_storage_allowed',
    ]);
    expect(runs[0]).toMatchObject({
      runUuid: 'run-1',
      runId: 7,
      worktreePath: '/wt/1',
      agent: 'codex',
      startedAt: '2026-09-15T10:00:00+00:00',
    });
  });

  it('fetchFinalizableRuns allows a transcript upload only for a boolean true policy', async () => {
    const col = fakeCollection({
      list: [
        fakeResource('run-yes', { run_log_storage_allowed: true }),
        fakeResource('run-no', { run_log_storage_allowed: false }),
        fakeResource('run-string', { run_log_storage_allowed: 'true' }),
        fakeResource('run-old-server', {}),
      ],
    });
    const remote = new DrupalBbRemote(
      fakeClient({
        collection: vi
          .fn()
          .mockReturnValueOnce(col)
          .mockReturnValueOnce(fakeCollection()),
      }),
    );
    const runs = await remote.fetchFinalizableRuns('machine-1');
    expect(runs.map((r) => [r.runUuid, r.runLogStorageAllowed])).toEqual([
      ['run-yes', true],
      ['run-no', false],
      ['run-string', false],
      ['run-old-server', false],
    ]);
  });

  it('fetchFinalizableRuns projects the run ticket and its start state for after_run', async () => {
    const col = fakeCollection({
      list: [
        fakeResource(
          'run-1',
          { drupal_internal__id: 7, state_at_start: 'working' },
          { ticket_id: 'tic-1' },
        ),
      ],
    });
    const remote = new DrupalBbRemote(fakeClient({ collection: () => col }));
    const [run] = await remote.fetchFinalizableRuns('machine-1');
    expect(run).toMatchObject({ ticketUuid: 'tic-1', stateAtStart: 'working' });
  });

  it('fetchFinalizableRuns asks for both done and cancelled runs and keeps each state', async () => {
    const done = fakeCollection({ list: [fakeResource('run-d', {})] });
    const cancelled = fakeCollection({ list: [fakeResource('run-c', {})] });
    const collection = vi
      .fn()
      .mockReturnValueOnce(done)
      .mockReturnValueOnce(cancelled);
    const remote = new DrupalBbRemote(fakeClient({ collection }));

    const runs = await remote.fetchFinalizableRuns('machine-1');

    expect(done.where).toHaveBeenCalledWith('state', '=', 'done');
    expect(cancelled.where).toHaveBeenCalledWith('state', '=', 'cancelled');
    expect(runs.map((r) => [r.runUuid, r.state])).toEqual([
      ['run-d', 'done'],
      ['run-c', 'cancelled'],
    ]);
  });

  it('fetchUncleanedTickets merges cleaned_up=0 and cleaned_up-never-written, de-dupes, resolves the latest run worktree', async () => {
    // Query 1 (closed=1, cleaned_up=0) and query 2 (closed=1, cleaned_up not
    // written) overlap on t-1; the merge de-dupes by uuid.
    const row = fakeResource('t-1', {
      branch_name: 'bakers/bb-1',
      state: 'done',
      base_branch: 'develop',
      links: [
        { uri: 'https://git.example/x', title: 'Docs' },
        { uri: 'https://git.example/x/-/merge_requests/1', title: 'MR' },
      ],
    });
    const uncleanedCol = fakeCollection({ list: [row] });
    const neverWrittenCol = fakeCollection({ list: [row] });
    const runCol = fakeCollection({
      list: [
        fakeResource('r-2', {
          worktree_path: '/wt/t-1',
          drupal_internal__id: 2,
        }),
        fakeResource('r-1', { worktree_path: '/old', drupal_internal__id: 1 }),
      ],
    });
    const collection = vi
      .fn()
      .mockReturnValueOnce(uncleanedCol)
      .mockReturnValueOnce(neverWrittenCol)
      .mockReturnValue(runCol);
    const api = fakeClient({ collection });
    const remote = new DrupalBbRemote(api);

    const tickets = await remote.fetchUncleanedTickets('machine-1');

    expect(collection).toHaveBeenNthCalledWith(1, 'bb_ticket');
    expect(collection).toHaveBeenNthCalledWith(2, 'bb_ticket');
    // Since BB-451 the server closes every terminal ticket on its own save,
    // so this asks one question — closed but not cleaned up — with no
    // workflow-state reasoning left in it. `cleaned_up` is nullable and
    // `NULL = 0` matches nothing in SQL, so the NULL twin (query 2) is a
    // second query rather than a looser operator (BB-364 D1). Both gate on
    // this conductor (BB-121): the work list holds only tickets assigned to
    // the reaping conductor.
    expect(uncleanedCol.where).toHaveBeenCalledWith('closed', '=', '1');
    expect(uncleanedCol.where).toHaveBeenCalledWith('cleaned_up', '=', '0');
    expect(uncleanedCol.where).toHaveBeenCalledWith(
      'conductor_id.conductor_id',
      '=',
      'machine-1',
    );
    expect(neverWrittenCol.where).toHaveBeenCalledWith('closed', '=', '1');
    expect(neverWrittenCol.notExists).toHaveBeenCalledWith('cleaned_up');
    expect(neverWrittenCol.where).toHaveBeenCalledWith(
      'conductor_id.conductor_id',
      '=',
      'machine-1',
    );
    // latest run (highest drupal_internal__id, sorted -) supplies the worktree.
    expect(runCol.sort).toHaveBeenCalledWith('-drupal_internal__id');
    expect(tickets).toEqual([
      {
        ticketUuid: 't-1',
        branchName: 'bakers/bb-1',
        state: 'done',
        baseBranch: 'develop',
        hasMr: true,
        worktreePath: '/wt/t-1',
        // BB-293: the uuid of the SAME run the path came from — resolved by
        // the query that already resolves the path, at no extra round-trip. It
        // is the record the reaper writes its teardown note to.
        runUuid: 'r-2',
      },
    ]);
  });

  it('fetchUncleanedTickets finds the merge request by its URI, whatever the link title', async () => {
    const ticketCol = fakeCollection({
      list: [
        fakeResource('t-1', {
          links: [
            {
              uri: 'https://git.example/x/-/merge_requests/7',
              title: 'Merge request',
            },
          ],
        }),
        fakeResource('t-2', {
          links: [{ uri: 'https://git.example/x/-/tree/main', title: 'MR' }],
        }),
      ],
    });
    const collection = vi
      .fn()
      .mockReturnValueOnce(ticketCol)
      .mockReturnValueOnce(fakeCollection())
      .mockReturnValue(fakeCollection());
    const remote = new DrupalBbRemote(fakeClient({ collection }));

    const tickets = await remote.fetchUncleanedTickets('machine-1');

    expect(tickets.map((t) => [t.ticketUuid, t.hasMr])).toEqual([
      ['t-1', true],
      ['t-2', false],
    ]);
  });

  it('fetchUncleanedTickets yields worktreePath="" when no run has one', async () => {
    const ticketCol = fakeCollection({
      list: [fakeResource('t-1', { branch_name: 'bakers/bb-1' })],
    });
    const runCol = fakeCollection({
      list: [fakeResource('r-1', { drupal_internal__id: 1 })],
    });
    const collection = vi
      .fn()
      .mockReturnValueOnce(ticketCol)
      .mockReturnValueOnce(fakeCollection())
      .mockReturnValue(runCol);
    const api = fakeClient({ collection });
    const remote = new DrupalBbRemote(api);

    const tickets = await remote.fetchUncleanedTickets('machine-1');

    expect(tickets).toEqual([
      {
        ticketUuid: 't-1',
        branchName: 'bakers/bb-1',
        state: '',
        baseBranch: '',
        hasMr: false,
        // No run carries a path, so neither dimension resolves and there is no
        // run to note anything on (BB-293).
        worktreePath: '',
        runUuid: '',
      },
    ]);
  });

  it('fetchUncleanedTickets asks the second query for a NEVER-WRITTEN cleaned_up, not a looser cleaned_up=0', async () => {
    // BB-364 D1, absorbed by BB-451 D6: `cleaned_up` is nullable and
    // `NULL = 0` matches nothing in SQL, so a row whose flag was never written
    // is invisible to a `cleaned_up=0` query alone — the second query's whole
    // reason to exist is reaching that row.
    const uncleanedCol = fakeCollection();
    const neverWrittenCol = fakeCollection();
    const collection = vi
      .fn()
      .mockReturnValueOnce(uncleanedCol)
      .mockReturnValueOnce(neverWrittenCol)
      .mockReturnValue(fakeCollection());
    const api = fakeClient({ collection });
    const remote = new DrupalBbRemote(api);

    await remote.fetchUncleanedTickets('machine-1');

    expect(uncleanedCol.notExists).not.toHaveBeenCalled();
    expect(neverWrittenCol.where).not.toHaveBeenCalledWith(
      'cleaned_up',
      '=',
      '0',
    );
    expect(neverWrittenCol.notExists).toHaveBeenCalledWith('cleaned_up');
  });

  it('fetchUncleanedTickets keeps both queries scoped to the conductor', async () => {
    // Both arms must carry the BB-121 per-conductor scoping: another
    // conductor's closed ticket is none of this reaper's business.
    const uncleanedCol = fakeCollection();
    const neverWrittenCol = fakeCollection();
    const collection = vi
      .fn()
      .mockReturnValueOnce(uncleanedCol)
      .mockReturnValueOnce(neverWrittenCol)
      .mockReturnValue(fakeCollection());
    const api = fakeClient({ collection });
    const remote = new DrupalBbRemote(api);

    await remote.fetchUncleanedTickets('machine-1');

    for (const col of [uncleanedCol, neverWrittenCol]) {
      expect(col.where).toHaveBeenCalledWith(
        'conductor_id.conductor_id',
        '=',
        'machine-1',
      );
      expect(col.where).toHaveBeenCalledWith('closed', '=', '1');
    }
  });

  it('fetchUncleanedTickets still issues exactly two collection queries', async () => {
    const collection = vi.fn(() => fakeCollection());
    const api = fakeClient({ collection });
    const remote = new DrupalBbRemote(api);

    await remote.fetchUncleanedTickets('machine-1');

    expect(collection).toHaveBeenCalledTimes(2);
  });

  /**
   * The api double for an `appendRunNote` existence check: a collection whose
   * `first()` yields a bare run row (`null` = no row at all — the run cannot
   * be read). BB-556: the transcript itself no longer comes from this
   * query — the JSON:API `log` attribute is always empty after `preSave()`
   * moves it to a file — so the double only needs to prove the run exists;
   * the actual content comes from the injected `fetchRunLog` fourth
   * constructor argument.
   */
  function runLogClient(
    exists: boolean,
    update = vi.fn(async () => fakeResource('x')),
    policy: Record<string, unknown> = { run_log_storage_allowed: true },
  ) {
    const col = fakeCollection({
      first: exists ? fakeResource('run-9', policy) : null,
    });
    const collection = vi.fn(() => col);
    return {
      col,
      collection,
      update,
      api: fakeClient({ collection, update }),
    };
  }

  it('appendRunNote appends one line to the run log, keeping what is there', async () => {
    // BB-293: how the reaper records what it found on the run RECORD, not
    // only in this machine's process log. Read-modify-write via the log
    // download route (BB-556) rather than the (always-empty) JSON:API
    // attribute.
    const { api, update } = runLogClient(true);
    const fetchRunLog = vi.fn(async () => 'existing transcript');
    const remote = new DrupalBbRemote(api, undefined, undefined, fetchRunLog);

    await remote.appendRunNote('run-9', 'worktree already absent at /repo/wt');

    expect(fetchRunLog).toHaveBeenCalledWith('run-9');
    const body = update.mock.calls.at(-1)?.[2] as ResourceWriteBody;
    expect(update.mock.calls.at(-1)?.[0]).toBe('bb_run');
    expect(update.mock.calls.at(-1)?.[1]).toBe('run-9');
    expect(body.attributes).toHaveProperty(
      'log',
      'existing transcript\nworktree already absent at /repo/wt',
    );
    // It must not touch the lifecycle fields — the run is already closed.
    expect(body.attributes).not.toHaveProperty('closed');
    expect(body.attributes).not.toHaveProperty('state');
  });

  it('appendRunNote checks run existence through a sparse fieldset (id alone)', async () => {
    // BB-293 review, finding 2, carried forward: a note append has no
    // business pulling the run's relationships and its other attributes for
    // what is now just an existence check.
    const { api, col, collection } = runLogClient(true);
    const remote = new DrupalBbRemote(
      api,
      undefined,
      undefined,
      async () => 'existing transcript',
    );

    await remote.appendRunNote('run-9', 'worktree already absent at /repo/wt');

    expect(collection).toHaveBeenCalledWith('bb_run');
    expect(col.where).toHaveBeenCalledWith('id', '=', 'run-9');
    expect(col.fields).toHaveBeenCalledWith(['id', 'run_log_storage_allowed']);
  });

  it.each([
    ['denies storage', { run_log_storage_allowed: false }],
    ['sends no policy', {}],
  ])('appendRunNote neither reads nor rewrites the transcript when the server %s', async (_label, policy) => {
    const update = vi.fn(async () => fakeResource('x'));
    const { api } = runLogClient(true, update, policy);
    const fetchRunLog = vi.fn(async () => 'existing transcript');
    const remote = new DrupalBbRemote(api, undefined, undefined, fetchRunLog);

    await remote.appendRunNote('run-9', 'worktree already absent at /repo/wt');

    expect(fetchRunLog).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('appendRunNote throws rather than replacing the transcript when the run cannot be read', async () => {
    // The hazard the sparse read introduces: `first()` resolves to null instead
    // of throwing a 404. Treating that as "no existing log" would PATCH the note
    // over the whole transcript — the opposite of what the note is for. The
    // reaper catches this, warns, and still flags the ticket cleaned.
    const { api, update } = runLogClient(false);
    const remote = new DrupalBbRemote(api);

    await expect(
      remote.appendRunNote('run-9', 'worktree already absent at /repo/wt'),
    ).rejects.toThrow(/run-9/);
    expect(update).not.toHaveBeenCalled();
  });

  it('appendRunNote writes nothing when the run uuid is empty', async () => {
    // A ticket with no run has nothing to note anything on; a write keyed on ''
    // would 404 (or worse, patch the collection).
    const update = vi.fn(async () => fakeResource('x'));
    const collection = vi.fn(() => fakeCollection());
    const remote = new DrupalBbRemote(fakeClient({ update, collection }));

    await remote.appendRunNote('', 'nothing to record');

    expect(update).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
  });

  it('appendRunNote preserves the real transcript when the server-side log attribute reads empty', async () => {
    // The exact regression this finding named: `preSave()` always clears
    // `log` after moving its payload to a file, so a JSON:API read of the
    // attribute is empty/null EVEN THOUGH a real transcript exists and is
    // reachable through the download route. Trusting the attribute would
    // silently replace the transcript with just this note. `fetchRunLog`
    // stands in for that route fetch and returns the real content.
    const { api, update } = runLogClient(true);
    const fetchRunLog = vi.fn(async () => 'the real, large transcript');
    const remote = new DrupalBbRemote(api, undefined, undefined, fetchRunLog);

    await remote.appendRunNote('run-9', 'worktree already absent at /repo/wt');

    const body = update.mock.calls.at(-1)?.[2] as ResourceWriteBody;
    expect(body.attributes).toHaveProperty(
      'log',
      'the real, large transcript\nworktree already absent at /repo/wt',
    );
  });

  it('appendRunNote writes the note alone when there is no transcript yet (fetchRunLog returns empty, e.g. a 204)', async () => {
    const { api, update } = runLogClient(true);
    const remote = new DrupalBbRemote(
      api,
      undefined,
      undefined,
      async () => '',
    );

    await remote.appendRunNote('run-9', 'worktree already absent at /repo/wt');

    const body = update.mock.calls.at(-1)?.[2] as ResourceWriteBody;
    expect(body.attributes).toHaveProperty(
      'log',
      'worktree already absent at /repo/wt',
    );
  });

  it('appendRunNote rejects without PATCHing when the download route 404s (CR2)', async () => {
    // CR2: a plain 404 means the route didn't resolve at all (bad path, wrong
    // workspace routing — exactly what CR1 caused) and must never be read as
    // "no transcript". Only createRunLogFetcher's real 204 handling maps to
    // '', so a 404 must propagate as a rejection all the way through
    // appendRunNote(), which must issue no PATCH rather than silently
    // overwrite a transcript it could not actually read.
    const { api, update } = runLogClient(true);
    const send = vi.fn(async () => {
      throw new HttpError(404, 'Not Found', undefined);
    });
    const auth = { apply: async (r: unknown) => r };
    const fetchRunLog = createRunLogFetcher(
      { send } as any,
      auth as any,
      'https://example.test/',
    );
    const remote = new DrupalBbRemote(api, undefined, undefined, fetchRunLog);

    await expect(
      remote.appendRunNote('run-9', 'worktree already absent at /repo/wt'),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('createRunLogFetcher returns empty only for a 204, not a 404', async () => {
    const auth = { apply: async (r: unknown) => r };
    const send204 = vi.fn(async () => ({ status: 204, headers: {}, body: '' }));
    const fetcher204 = createRunLogFetcher(
      { send: send204 } as any,
      auth as any,
      'https://example.test/',
    );
    await expect(fetcher204('run-uuid-1')).resolves.toBe('');

    const send404 = vi.fn(async () => {
      throw new HttpError(404, 'Not Found', undefined);
    });
    const fetcher404 = createRunLogFetcher(
      { send: send404 } as any,
      auth as any,
      'https://example.test/',
    );
    await expect(fetcher404('run-uuid-1')).rejects.toThrow(HttpError);
  });

  it('replaceTicketMetrics replaces only its namespace and patches metrics alone', async () => {
    const get = vi.fn(async () => ({
      data: {
        attributes: {
          metrics: [
            {
              name: 'job_rating.score',
              value: '4.0000',
              unit: null,
              recorded: 1,
            },
            {
              name: 'mr_changes.score',
              value: '9.0000',
              unit: 'lines',
              recorded: 1,
            },
          ],
        },
      },
    }));
    const update = vi.fn(async () => fakeResource('x'));
    const remote = new DrupalBbRemote(fakeClient({ get, update }));
    const fresh = {
      name: 'mr_changes.score',
      value: '71.0000',
      unit: 'lines',
      recorded: 2,
    };

    await remote.replaceTicketMetrics('t-1', 'mr_changes.', [fresh]);

    expect(update).toHaveBeenCalledWith('bb_ticket', 't-1', {
      attributes: {
        metrics: [
          {
            name: 'job_rating.score',
            value: '4.0000',
            unit: null,
            recorded: 1,
          },
          fresh,
        ],
      },
    });
  });

  it('markTicketCleanedUp patches cleaned_up only — not state/closed (decoupled from lifecycle)', async () => {
    const update = vi.fn(async () => fakeResource('x'));
    const api = fakeClient({ update });
    const remote = new DrupalBbRemote(api);
    await remote.markTicketCleanedUp('t-1');
    const body = update.mock.calls[0]?.[2] as ResourceWriteBody;
    expect(update.mock.calls[0]?.[0]).toBe('bb_ticket');
    expect(update.mock.calls[0]?.[1]).toBe('t-1');
    expect(body.attributes).toHaveProperty('cleaned_up', true);
    expect(body.attributes).not.toHaveProperty('state');
    expect(body.attributes).not.toHaveProperty('closed');
  });
});

describe('drupalRemote.createRemote', () => {
  // BB-472: auth resolution now happens inside
  // @bakers-build/core's createBbConnectionContext (mocked above), which this
  // package delegates to instead of resolving auth itself. Its own
  // dropsh-resolveAuth behavior is covered by @bakers-build/core's tests.
  it('builds its client via createBbConnectionContext, passing the config site and plugins through', async () => {
    const { createBbConnectionContext } = await import('@bakers-build/core');
    const config = {
      site: {
        base_url: 'https://develop.dev.bakers.build',
        jsonapi_prefix: '/jsonapi',
      },
      plugins: [{ id: 'p', authProvider: { id: 'p' } }],
    } as any;
    const remote = await drupalRemote().createRemote(config);
    expect(remote).toBeDefined();
    expect(createBbConnectionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        site: config.site,
        plugins: config.plugins,
      }),
      expect.objectContaining({
        http: expect.anything(),
      }),
    );
  });

  // BB-472: createRemote used to build its own JSON:API client with no
  // alterRequest at all, so a configured `@bakers-build/addon-workspace` plugin was
  // inert for the conductor. It must instead run the SAME connection plugin
  // chain the rest of the CLI runs, via @bakers-build/core's
  // createBbConnectionContext.
  it('runs the connection plugin chain (e.g. the workspace filter) on requests the remote issues', async () => {
    const { createBbConnectionContext } = await import('@bakers-build/core');
    const seen: string[] = [];
    const alteringPlugin = {
      id: 'test-marker',
      requiredModules: [],
      alterRequest: async (req: any) => {
        seen.push(req.url as string);
        const url = new URL(req.url);
        url.searchParams.set('marker', 'applied');
        return { ...req, url: url.toString() };
      },
    };
    const config = {
      site: {
        base_url: 'https://develop.dev.bakers.build',
        jsonapi_prefix: '/jsonapi',
      },
      plugins: [alteringPlugin],
    } as any;

    const remote = await drupalRemote().createRemote(config);
    expect(remote).toBeInstanceOf(DrupalBbRemote);
    expect(createBbConnectionContext).toHaveBeenCalledWith(
      expect.objectContaining({ site: config.site, plugins: config.plugins }),
      expect.objectContaining({
        http: expect.anything(),
      }),
    );
    // The client createBbConnectionContext produced (the fake below) is the
    // one the remote wraps, proving the remote does not assemble its own.
    const api = (remote as unknown as { api: unknown }).api;
    expect(api).toBe(fakeContextClient);
  });

  it("serves the site's /mcp tools with the conductor's own auth profile", async () => {
    const { createServer } = await import('node:http');
    const seen: Array<{ url?: string; authorization?: string }> = [];
    const stub = createServer((req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization });
      res.writeHead(503).end();
    });
    await new Promise<void>((done) => stub.listen(0, '127.0.0.1', done));
    const { port } = stub.address() as { port: number };
    const { createBbConnectionContext } = await import('@bakers-build/core');
    vi.mocked(createBbConnectionContext).mockResolvedValueOnce({
      client: fakeContextClient,
      http: { send: vi.fn() },
      auth: {
        apply: async (r: any) => ({
          ...r,
          headers: {
            ...r.headers,
            authorization: 'Bearer conductor-site-token',
          },
        }),
      },
      baseUrl: `http://127.0.0.1:${port}`,
    } as any);
    const remote = await drupalRemote().createRemote({
      site: { base_url: 'https://x', jsonapi_prefix: '/jsonapi' },
      plugins: [],
    } as any);
    try {
      await expect(remote.siteTools?.list()).rejects.toThrow();
      expect(seen[0]).toEqual({
        url: '/mcp',
        authorization: 'Bearer conductor-site-token',
      });
    } finally {
      await remote.siteTools?.close();
      stub.close();
    }
  });

  it('wires a real fetchRunLog built from the connection context http/auth/baseUrl', async () => {
    const config = {
      site: {
        base_url: 'https://develop.dev.bakers.build',
        jsonapi_prefix: '/jsonapi',
      },
      plugins: [],
    } as any;

    const remote = await drupalRemote().createRemote(config);

    const fetchRunLog = (remote as unknown as { fetchRunLog: unknown })
      .fetchRunLog;
    expect(typeof fetchRunLog).toBe('function');
  });

  it('createRunLogFetcher addresses the workspace-free API route, not the workspace-prefixed one', async () => {
    // Review finding C2: the workspace-prefixed route 404s for a client with
    // no resolved slug, which appendRunNote() silently read as "no
    // transcript" and replaced the real one with the note. Pinning the exact
    // URL here is what would have caught that before it shipped.
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: 'x' }));
    const auth = { apply: async (r: unknown) => r };
    const fetchRunLog = createRunLogFetcher(
      { send } as any,
      auth as any,
      'https://example.test/',
    );

    await fetchRunLog('run-uuid-1');

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://example.test/_bakers-api/run/run-uuid-1/log/log',
      }),
    );
  });

  it('createRunLogFetcher advertises gzip before auth is applied', async () => {
    const send = vi.fn(async () => ({ status: 200, headers: {}, body: 'x' }));
    const apply = vi.fn(async (request: any) => ({
      ...request,
      headers: { ...request.headers, Authorization: 'Bearer x' },
    }));
    const fetchRunLog = createRunLogFetcher(
      { send } as any,
      { apply } as any,
      'https://example.test/',
    );

    await fetchRunLog('run-uuid-1');

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://example.test/_bakers-api/run/run-uuid-1/log/log',
        headers: expect.objectContaining({ 'Accept-Encoding': 'gzip' }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Encoding': 'gzip',
          Authorization: 'Bearer x',
        }),
      }),
    );
  });

  it('createRunLogFetcher returns the response body without gunziping it again', async () => {
    const send = vi.fn(async () => ({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      body: 'already decoded by fetch',
    }));
    const fetchRunLog = createRunLogFetcher(
      { send } as any,
      { apply: async (r: unknown) => r } as any,
      'https://example.test/',
    );

    await expect(fetchRunLog('run-uuid-1')).resolves.toBe(
      'already decoded by fetch',
    );
  });
});
