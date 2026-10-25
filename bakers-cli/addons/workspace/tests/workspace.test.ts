// BB-351: the ambient workspace is CONTEXT, not a field the caller types. These
// tests drive `alterRequest` directly with a synthetic RequestContext — the same
// shape dropsh 0.6.0's `composeRequestHooks` builds — so they measure the plugin,
// not a mock of dropsh.
import type { HttpRequest, RequestContext } from 'dropsh/plugin';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ENTITY_TYPES,
  WORKSPACE_READ_SCOPE_PATHS,
  workspacePlugin,
} from '../src/index.js';
import { connectionPlugins } from '../src/preset.js';

const WS = '11111111-2222-3333-4444-555555555555';
const OTHER_WS = '99999999-8888-7777-6666-555555555555';

/** The synthetic RequestContext dropsh's composeRequestHooks would hand us. */
function ctx(
  operation: RequestContext['operation'],
  entityType?: string,
  bundle?: string,
): RequestContext {
  return {
    operation,
    ...(entityType !== undefined ? { entityType } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
    // PluginContext members the hook never reads; typed away rather than faked.
  } as unknown as RequestContext;
}

function req(
  body?: string,
  method: HttpRequest['method'] = 'POST',
): HttpRequest {
  return {
    method,
    url: 'https://example.test/jsonapi/bb_group/bb_group',
    headers: {
      Authorization: 'Bearer tok-abc',
      'Content-Type': 'application/vnd.api+json',
    },
    ...(body !== undefined ? { body } : {}),
  };
}

/** A JSON:API create document with no workspace_id relationship. */
function createBody(type: string, relationships?: Record<string, unknown>) {
  return JSON.stringify({
    data: {
      type: `${type}--${type}`,
      attributes: { label: 'x' },
      ...(relationships ? { relationships } : {}),
    },
  });
}

const plugin = () => workspacePlugin({ workspace_id: WS });
const alter = (p: ReturnType<typeof workspacePlugin>) => {
  const hook = p.alterRequest;
  if (!hook) throw new Error('plugin declares no alterRequest hook');
  return hook.bind(p);
};

describe('workspacePlugin — identity', () => {
  it('is a dropsh plugin with a stable namespaced id and requiredModules', () => {
    const p = plugin();
    expect(p.id).toBe('bakers-workspace');
    expect(Array.isArray(p.requiredModules)).toBe(true);
    expect(typeof p.alterRequest).toBe('function');
  });
});

describe('workspacePlugin — injection', () => {
  it('injects workspace_id into a bb_group create', async () => {
    const out = await alter(plugin())(
      req(createBody('bb_group')),
      ctx('create', 'bb_group', 'bb_group'),
    );
    const doc = JSON.parse(out.body as string);
    expect(doc.data.relationships.workspace_id).toEqual({
      data: { type: 'bb_workspace--bb_workspace', id: WS },
    });
  });

  it('injects workspace_id into a bb_team create', async () => {
    const out = await alter(plugin())(
      req(createBody('bb_team')),
      ctx('create', 'bb_team', 'bb_team'),
    );
    const doc = JSON.parse(out.body as string);
    expect(doc.data.relationships.workspace_id.data.id).toBe(WS);
  });

  it('preserves attributes and any sibling relationship', async () => {
    const out = await alter(plugin())(
      req(
        createBody('bb_group', {
          parent_id: { data: { type: 'bb_group--bb_group', id: 'p1' } },
        }),
      ),
      ctx('create', 'bb_group', 'bb_group'),
    );
    const doc = JSON.parse(out.body as string);
    expect(doc.data.attributes.label).toBe('x');
    expect(doc.data.relationships.parent_id.data.id).toBe('p1');
    expect(doc.data.relationships.workspace_id.data.id).toBe(WS);
  });
});

describe('workspacePlugin — the types it deliberately leaves alone', () => {
  it('leaves a bb_project create unchanged (its anchor is group_id)', async () => {
    const body = createBody('bb_project');
    const out = await alter(plugin())(
      req(body),
      ctx('create', 'bb_project', 'bb_project'),
    );
    expect(out.body).toBe(body);
  });

  it('leaves a bb_ticket create unchanged (its anchor is project_id)', async () => {
    const body = createBody('bb_ticket');
    const out = await alter(plugin())(
      req(body),
      ctx('create', 'bb_ticket', 'bb_ticket'),
    );
    expect(out.body).toBe(body);
  });

  it('leaves an update unchanged — re-binding a row to another workspace is a real decision', async () => {
    const body = createBody('bb_group');
    const out = await alter(plugin())(
      req(body, 'PATCH'),
      ctx('update', 'bb_group', 'bb_group'),
    );
    expect(out.body).toBe(body);
  });

  it('leaves a read unchanged, byte-identical', async () => {
    const body = createBody('bb_group');
    const out = await alter(plugin())(
      req(body, 'GET'),
      ctx('read', 'bb_group', 'bb_group'),
    );
    expect(out.body).toBe(body);
    expect(out).toEqual(req(body, 'GET'));
  });

  it('leaves a search unchanged, byte-identical', async () => {
    const body = createBody('bb_group');
    const out = await alter(plugin())(
      req(body, 'GET'),
      ctx('search', 'bb_group', 'bb_group'),
    );
    expect(out.body).toBe(body);
  });

  it('leaves a binary (upload) body unchanged', async () => {
    const bin = new Uint8Array([1, 2, 3]);
    const r: HttpRequest = { ...req(), body: bin };
    const out = await alter(plugin())(r, ctx('upload', 'bb_group', 'bb_group'));
    expect(out.body).toBe(bin);
  });
});

describe('workspacePlugin — explicit always wins', () => {
  it('leaves a create that already names workspace_id untouched', async () => {
    const body = createBody('bb_group', {
      workspace_id: {
        data: { type: 'bb_workspace--bb_workspace', id: OTHER_WS },
      },
    });
    const out = await alter(plugin())(
      req(body),
      ctx('create', 'bb_group', 'bb_group'),
    );
    expect(out.body).toBe(body);
    expect(
      JSON.parse(out.body as string).data.relationships.workspace_id.data.id,
    ).toBe(OTHER_WS);
  });
});

describe('workspacePlugin — loud failures', () => {
  it('throws a named error naming the entity type when no workspace is configured', async () => {
    const p = workspacePlugin({});
    await expect(
      alter(p)(
        req(createBody('bb_group')),
        ctx('create', 'bb_group', 'bb_group'),
      ),
    ).rejects.toMatchObject({ name: 'WorkspaceConfigError' });
    await expect(
      alter(p)(
        req(createBody('bb_group')),
        ctx('create', 'bb_group', 'bb_group'),
      ),
    ).rejects.toThrow(/bb_group/);
  });

  it('throws a named error on a malformed JSON body rather than half-parsing it', async () => {
    await expect(
      alter(plugin())(req('{not json'), ctx('create', 'bb_group', 'bb_group')),
    ).rejects.toMatchObject({ name: 'WorkspacePayloadError' });
  });
});

describe('workspacePlugin — headers are never touched', () => {
  it('carries Authorization and the JSON:API content-type through verbatim', async () => {
    const r = req(createBody('bb_group'));
    const out = await alter(plugin())(r, ctx('create', 'bb_group', 'bb_group'));
    expect(out.headers).toEqual(r.headers);
    expect(out.headers?.Authorization).toBe('Bearer tok-abc');
    expect(out.headers?.['Content-Type']).toBe('application/vnd.api+json');
    expect(out.method).toBe('POST');
    expect(out.url).toBe(r.url);
  });
});

describe('workspacePlugin — the configurable workspace-field type set', () => {
  it('honours an explicit entity_types list', async () => {
    const p = workspacePlugin({
      workspace_id: WS,
      entity_types: ['bb_project'],
    });
    const injected = await alter(p)(
      req(createBody('bb_project')),
      ctx('create', 'bb_project', 'bb_project'),
    );
    expect(
      JSON.parse(injected.body as string).data.relationships.workspace_id,
    ).toBeDefined();
    const body = createBody('bb_group');
    const skipped = await alter(p)(
      req(body),
      ctx('create', 'bb_group', 'bb_group'),
    );
    expect(skipped.body).toBe(body);
  });
});

describe('preset — connectionPlugins', () => {
  it('contributes nothing when no workspace is configured', async () => {
    expect(await connectionPlugins([], {})).toEqual([]);
    expect(await connectionPlugins([], { workspace_id: '   ' })).toEqual([]);
    expect(await connectionPlugins([], undefined as never)).toEqual([]);
  });

  it('contributes exactly one plugin when a workspace is configured', async () => {
    const out = await connectionPlugins([], { workspace_id: WS });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('bakers-workspace');
  });
});

// BB-339: bb_term became workspace-scoped, so its create needs the same
// ambient fill. Asserted on the exported set AND through the hook, because the
// set is what documents the intent and the hook is what dropsh actually calls.
describe('workspacePlugin — bb_term (BB-339)', () => {
  it('lists bb_term in the default filled set', () => {
    expect(DEFAULT_WORKSPACE_ENTITY_TYPES).toContain('bb_term');
  });

  it('injects workspace_id into a bb_term create', async () => {
    const out = await alter(plugin())(
      req(createBody('bb_term')),
      ctx('create', 'bb_term', 'label'),
    );
    const doc = JSON.parse(out.body as string);
    expect(doc.data.relationships.workspace_id).toEqual({
      data: { type: 'bb_workspace--bb_workspace', id: WS },
    });
  });

  it('leaves a bb_term UPDATE alone', async () => {
    const body = createBody('bb_term');
    const out = await alter(plugin())(
      req(body, 'PATCH'),
      ctx('update', 'bb_term', 'label'),
    );
    expect(out.body).toBe(body);
  });
});

function getReq(url: string): HttpRequest {
  return { method: 'GET', url, headers: { Authorization: 'Bearer tok-abc' } };
}

describe('read scoping', () => {
  it('narrows a known collection to the configured workspace', async () => {
    const plugin = workspacePlugin({ workspace_id: WS });
    const out = await plugin.alterRequest?.(
      getReq('https://example.test/jsonapi/bb_team/bb_team'),
      ctx('search', 'bb_team'),
    );
    const params = new URL(out!.url).searchParams;
    expect(params.get('filter[bb_ambient_workspace][condition][path]')).toBe(
      'workspace_id.id',
    );
    expect(params.get('filter[bb_ambient_workspace][condition][value]')).toBe(
      WS,
    );
  });

  it('reaches the workspace through the parent chain for a ticket', async () => {
    const plugin = workspacePlugin({ workspace_id: WS });
    const out = await plugin.alterRequest?.(
      getReq('https://example.test/jsonapi/bb_ticket/bb_ticket'),
      ctx('search', 'bb_ticket'),
    );
    expect(
      new URL(out!.url).searchParams.get(
        'filter[bb_ambient_workspace][condition][path]',
      ),
    ).toBe('project_id.group_id.workspace_id.id');
  });

  it('template reads are scoped by project OR workspace', async () => {
    const plugin = workspacePlugin({ workspace_id: WS });
    const out = await plugin.alterRequest?.(
      getReq(
        'https://example.test/jsonapi/bb_ticket_template/bb_ticket_template?filter[enabled]=1',
      ),
      ctx('search', 'bb_ticket_template'),
    );
    const params = new URL(out!.url).searchParams;
    expect(params.get('filter[bb_ambient_workspace][group][conjunction]')).toBe(
      'OR',
    );
    expect(params.get('filter[bb_ambient_workspace_0][condition][path]')).toBe(
      'project_id.group_id.workspace_id.id',
    );
    expect(params.get('filter[bb_ambient_workspace_1][condition][path]')).toBe(
      'workspace_id.id',
    );
    for (const i of [0, 1]) {
      expect(
        params.get(`filter[bb_ambient_workspace_${i}][condition][value]`),
      ).toBe(WS);
      expect(
        params.get(`filter[bb_ambient_workspace_${i}][condition][memberOf]`),
      ).toBe('bb_ambient_workspace');
    }
    expect(params.get('filter[enabled]')).toBe('1');
  });

  it('preserves a caller filter instead of replacing it', async () => {
    const plugin = workspacePlugin({ workspace_id: WS });
    const out = await plugin.alterRequest?.(
      getReq('https://example.test/jsonapi/bb_team/bb_team?filter[name]=crew'),
      ctx('search', 'bb_team'),
    );
    expect(new URL(out!.url).searchParams.get('filter[name]')).toBe('crew');
  });

  it('leaves an individual resource read untouched', async () => {
    const plugin = workspacePlugin({ workspace_id: WS });
    const url = `https://example.test/jsonapi/bb_team/bb_team/${OTHER_WS}`;
    const out = await plugin.alterRequest?.(
      getReq(url),
      ctx('read', 'bb_team'),
    );
    expect(out!.url).toBe(url);
  });

  it('leaves an unknown entity type untouched', async () => {
    const plugin = workspacePlugin({ workspace_id: WS });
    const url = 'https://example.test/jsonapi/user/user';
    const out = await plugin.alterRequest?.(getReq(url), ctx('search', 'user'));
    expect(out!.url).toBe(url);
  });

  it('does not narrow bb_machine by workspace: capacity is account-owned', async () => {
    // A machine belongs to the registering account, not a workspace. The
    // conductor tick's machineCapacity() collection search must not send
    // filter[workspace_id] — the field is gone, and JSON:API would 400.
    const plugin = workspacePlugin({ workspace_id: WS });
    const url = 'https://example.test/jsonapi/bb_machine/bb_machine';
    const out = await plugin.alterRequest?.(
      getReq(url),
      ctx('search', 'bb_machine'),
    );
    expect(out!.url).toBe(url);
    expect(WORKSPACE_READ_SCOPE_PATHS.bb_machine).toBeUndefined();
  });

  it('leaves a bb_workspace search untouched, so every reachable workspace stays discoverable', async () => {
    // A bb_workspace collection search is how discoverBbWorkspaces() lists
    // what an identity can switch to (BB-472). Narrowing it to the already
    // configured workspace's own id would make every other reachable
    // workspace invisible to the switcher -- confirmed live against a
    // recipe-test world where an identity with two memberships otherwise saw
    // only the one already configured.
    const plugin = workspacePlugin({ workspace_id: WS });
    const url = 'https://example.test/jsonapi/bb_workspace/bb_workspace';
    const out = await plugin.alterRequest?.(
      getReq(url),
      ctx('search', 'bb_workspace'),
    );
    expect(out!.url).toBe(url);
  });

  it('leaves a search untouched when no workspace is configured', async () => {
    const plugin = workspacePlugin({});
    const url = 'https://example.test/jsonapi/bb_team/bb_team';
    const out = await plugin.alterRequest?.(
      getReq(url),
      ctx('search', 'bb_team'),
    );
    expect(out!.url).toBe(url);
  });
});
