import type { DropSHPlugin, HttpRequest, RequestContext } from 'dropsh/plugin';
import { describe, expect, it } from 'vitest';
import bakersEssentials from '../src/index.js';
import { connectionPlugins } from '../src/preset.js';

const WS = '11111111-2222-3333-4444-555555555555';

// dropsh@0.5.6 flattens a plugins[] entry that resolves to an array
// (`composePlugins(a(), b())`) into separate plugin entries. So the aggregator
// factory returns the flat child list — each child stays a distinct, genuine
// plugin, indistinguishable from listing them separately. No hand-merged /
// presence-guarded composite hooks any more.
describe('bakersEssentials (composePlugins over the config-free dropsh essentials)', () => {
  const essentials = (): DropSHPlugin[] => bakersEssentials();

  it('returns a flat array of the config-free essential child plugins', () => {
    const plugins = essentials();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.map((p) => p.id)).toEqual([
      'markdown',
      'jsonapi-schema',
      'bakers-name-refs',
    ]);
  });

  it('includes the markdown child so the "md" renderer is present', () => {
    const rendererIds = essentials().flatMap((p) =>
      (p.renderers ?? []).map((r) => r.id),
    );
    expect(rendererIds).toContain('md');
  });

  it('includes the authoritative schema child (a child extends the schema)', () => {
    expect(essentials().some((p) => typeof p.extendSchema === 'function')).toBe(
      true,
    );
  });

  it('carries NO authProvider on any child (config-bound plugins stay explicit — AC-4)', () => {
    expect(essentials().every((p) => p.authProvider === undefined)).toBe(true);
  });

  it('carries the name-refs child, which DOES implement extendOperationSchema', () => {
    // dropsh tags a cached schema with `plugins.filter(p => p.extendOperationSchema)`
    // (`x-dropsh-operation-hook-plugins`), so this child's presence self-invalidates
    // stale caches — which is exactly what makes --label_names and
    // --environment_names appear without a manual `rm -rf .dropsh/cache`.
    const hooked = essentials().filter(
      (p) => typeof p.extendOperationSchema === 'function',
    );
    expect(hooked.map((p) => p.id)).toEqual(['bakers-name-refs']);
  });
});

// BB-495: the ambient-workspace filler moved to `bakers ui`. The dropsh
// request path carries authentication and nothing else — the caller names the
// workspace on the call — so essentials never contributes the plugin, whether
// or not a `workspace_id` is passed in.
describe('bakersEssentials — never contributes a workspace plugin (BB-495)', () => {
  it('never contributes a workspace plugin, whatever the globals say', () => {
    const withUuid = bakersEssentials({ workspace_id: WS });
    const without = bakersEssentials({});
    expect(withUuid).toHaveLength(without.length);
    expect(withUuid.map((p) => p.id)).not.toContain('bakers-workspace');
  });

  it('the ./preset path carries the same children as the default export', async () => {
    const viaPreset = (await connectionPlugins([], { workspace_id: WS })).map(
      (p) => p.id,
    );
    const viaDefault = bakersEssentials({ workspace_id: WS }).map((p) => p.id);
    expect(viaPreset).toEqual(viaDefault);
    expect(viaPreset).not.toContain('bakers-workspace');
  });
});

// BB-495 F4 / AC2: "the transport adds nothing" is a claim about the
// CONSTRUCTED REQUEST, not about which plugin ids are present — this drives
// every essential child's `alterRequest` the way dropsh's own
// `composeRequestHooks` would (the same pattern `addons/workspace/tests` uses
// to measure the plugin rather than a mock of dropsh), for both a create and a
// search, built with AND without a `workspace_id` global.
describe('bakersEssentials — the request path carries no ambient workspace (BB-495 AC2)', () => {
  function ctx(
    operation: RequestContext['operation'],
    entityType: string,
    bundle: string,
  ): RequestContext {
    return { operation, entityType, bundle } as unknown as RequestContext;
  }

  function createReq(entityType: string): HttpRequest {
    return {
      method: 'POST',
      url: `https://example.test/jsonapi/${entityType}/${entityType}`,
      headers: {
        Authorization: 'Bearer tok-abc',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: `${entityType}--${entityType}`,
          attributes: { name: 'work:code' },
        },
      }),
    };
  }

  function searchReq(entityType: string): HttpRequest {
    return {
      method: 'GET',
      url: `https://example.test/jsonapi/${entityType}/${entityType}?page%5Blimit%5D=10`,
      headers: { Authorization: 'Bearer tok-abc' },
    };
  }

  /** Folds a request through every child's alterRequest hook, in child order. */
  async function alterThroughEssentials(
    request: HttpRequest,
    context: RequestContext,
    globals: { workspace_id?: string },
  ): Promise<HttpRequest> {
    let out = request;
    for (const plugin of bakersEssentials(globals)) {
      if (plugin.alterRequest) out = await plugin.alterRequest(out, context);
    }
    return out;
  }

  it('a create is identical whether or not workspace_id is configured, and names no workspace', async () => {
    const request = createReq('bb_term');
    const context = ctx('create', 'bb_term', 'label');
    const withoutWorkspace = await alterThroughEssentials(request, context, {});
    const withWorkspace = await alterThroughEssentials(request, context, {
      workspace_id: WS,
    });
    expect(withWorkspace).toEqual(withoutWorkspace);
    const body = JSON.parse(String(withWorkspace.body));
    expect(body.data.relationships?.workspace_id).toBeUndefined();
    expect(withWorkspace.url).not.toContain('filter[bb_ambient_workspace]');
  });

  it('a search is identical whether or not workspace_id is configured, and carries no ambient filter', async () => {
    const request = searchReq('bb_ticket');
    const context = ctx('search', 'bb_ticket', 'bb_ticket');
    const withoutWorkspace = await alterThroughEssentials(request, context, {});
    const withWorkspace = await alterThroughEssentials(request, context, {
      workspace_id: WS,
    });
    expect(withWorkspace).toEqual(withoutWorkspace);
    expect(withWorkspace.url).not.toContain('filter[bb_ambient_workspace]');
    expect(withWorkspace.url).toBe(request.url);
  });

  it('a caller-supplied workspace_id survives untouched — the caller writes it, essentials does not', async () => {
    const withOwnWorkspace: HttpRequest = {
      ...createReq('bb_group'),
      body: JSON.stringify({
        data: {
          type: 'bb_group--bb_group',
          attributes: { label: 'x' },
          relationships: {
            workspace_id: {
              data: { type: 'bb_workspace--bb_workspace', id: WS },
            },
          },
        },
      }),
    };
    const context = ctx('create', 'bb_group', 'bb_group');
    const out = await alterThroughEssentials(withOwnWorkspace, context, {});
    expect(JSON.parse(String(out.body))).toEqual(
      JSON.parse(String(withOwnWorkspace.body)),
    );
  });
});
