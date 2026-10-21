import Ajv from 'ajv';
import {
  buildPayloadFromParameters,
  type HttpRequest,
  indexSchemaFields,
  type RequestContext,
} from 'dropsh/plugin';
import { describe, expect, it } from 'vitest';
import { nameRefsPlugin } from '../src/index.js';

const LABELS_TYPE = 'bb_term--bb_labels';
const ENVS_TYPE = 'bb_environment--bb_environment';
const PROJECT_TYPE = 'bb_project--bb_project';

/** A relationship declaration shaped like the live operation schema. */
const rel = (type: string) => ({
  properties: {
    data: { type: 'array', items: { properties: { type: { enum: [type] } } } },
  },
});

const schemaWith = (relationships: Record<string, unknown>) => ({
  properties: {
    data: {
      properties: {
        attributes: { properties: { title: { type: 'string' } } },
        relationships: { properties: relationships },
      },
    },
  },
});

const schemaWithLabels = () => schemaWith({ labels: rel(LABELS_TYPE) });
const schemaWithEnvironments = () =>
  schemaWith({ environments: rel(ENVS_TYPE) });
const schemaWithBoth = () =>
  schemaWith({ labels: rel(LABELS_TYPE), environments: rel(ENVS_TYPE) });

/** Same shape, neither relationship (e.g. bb_comment). */
const schemaWithNeither = () => ({
  properties: {
    data: {
      properties: {
        attributes: { properties: { body: { type: 'object' } } },
        relationships: { properties: { ticket_id: {} } },
      },
    },
  },
});

type Row = { id: string; name: string; scopeId?: string };

function collection(type: string, rows: Row[], next?: string) {
  return {
    data: rows.map((r) => ({
      type,
      id: r.id,
      attributes: { name: r.name },
      ...(r.scopeId === undefined
        ? {}
        : {
            relationships: {
              project_id: { data: { type: PROJECT_TYPE, id: r.scopeId } },
            },
          }),
    })),
    links: next ? { next: { href: next } } : {},
  };
}

/**
 * A fake http+auth context. `handler` maps a requested URL to a JSON:API
 * document; `urls` records every call so a test can assert how many round trips
 * a resolution actually cost.
 */
function contextFor(
  handler: (url: string) => unknown,
  operation = 'create',
  status = 200,
): { ctx: RequestContext; urls: string[] } {
  const urls: string[] = [];
  const http = {
    async send(req: HttpRequest) {
      urls.push(req.url);
      return {
        status,
        headers: {},
        body: JSON.stringify(handler(req.url)),
      };
    },
  };
  const auth = {
    async apply(req: HttpRequest) {
      return { ...req, headers: { ...req.headers, Authorization: 'Bearer t' } };
    },
  };
  const ctx = {
    http,
    auth,
    baseUrl: 'https://bakers.test',
    jsonapiPrefix: '/jsonapi',
    operation,
  } as unknown as RequestContext;
  return { ctx, urls };
}

/** Serves one vocabulary; anything else in the test is a programming error. */
const serve = (rows: Row[]) => (url: string) => {
  if (url.includes('bb_term')) return collection(LABELS_TYPE, rows);
  if (url.includes('bb_environment')) return collection(ENVS_TYPE, rows);
  throw new Error(`unexpected URL ${url}`);
};

const TICKET_URL = 'https://bakers.test/jsonapi/bb_ticket/bb_ticket';

const post = (payload: unknown): HttpRequest => ({
  method: 'POST',
  url: TICKET_URL,
  headers: { 'Content-Type': 'application/vnd.api+json' },
  body: JSON.stringify(payload),
});

const patch = (payload: unknown, id = 'ticket-1'): HttpRequest => ({
  method: 'PATCH',
  url: `${TICKET_URL}/${id}`,
  headers: { 'Content-Type': 'application/vnd.api+json' },
  body: JSON.stringify(payload),
});

const bodyOf = (req: HttpRequest) => JSON.parse(String(req.body));

/** Just enough shape to reach the attribute properties the schema tests assert on. */
type SchemaWithAttributes = {
  properties: {
    data: {
      properties: {
        attributes: { properties: Record<string, { type?: string }> };
      };
    };
  };
};

const extend = async (schema: unknown, ctx?: RequestContext) =>
  (await nameRefsPlugin().extendOperationSchema?.(
    'bb_ticket',
    'bb_ticket',
    'create',
    schema,
    (ctx ?? {}) as never,
  )) as SchemaWithAttributes;

describe('nameRefsPlugin — extendOperationSchema', () => {
  it('adds label_names where the bundle declares a labels relationship', async () => {
    const attrs = (await extend(schemaWithLabels())).properties.data.properties
      .attributes.properties;
    expect(attrs.label_names.type).toBe('string');
    expect(attrs.environment_names).toBeUndefined();
  });

  it('adds environment_names where the bundle declares an environments relationship', async () => {
    const attrs = (await extend(schemaWithEnvironments())).properties.data
      .properties.attributes.properties;
    expect(attrs.environment_names.type).toBe('string');
    expect(attrs.label_names).toBeUndefined();
  });

  it('adds both when the bundle declares both, leaving real attributes intact', async () => {
    const attrs = (await extend(schemaWithBoth())).properties.data.properties
      .attributes.properties;
    expect(attrs.label_names.type).toBe('string');
    expect(attrs.environment_names.type).toBe('string');
    expect(attrs.title.type).toBe('string');
  });

  it('returns the very same object when no resolver matches', async () => {
    const input = schemaWithNeither();
    const out = await nameRefsPlugin().extendOperationSchema?.(
      'bb_comment',
      'bb_comment',
      'create',
      input,
      {} as never,
    );
    expect(out).toBe(input);
  });

  it('performs no network I/O (the extended schema is disk-cached)', async () => {
    const { ctx, urls } = contextFor(serve([]));
    await extend(schemaWithBoth(), ctx);
    expect(urls).toEqual([]);
  });
});

describe('nameRefsPlugin — alterRequest, labels (globally unique names)', () => {
  it('resolves one name into the relationship and strips the attribute', async () => {
    const { ctx } = contextFor(serve([{ id: 'uuid-code', name: 'work:code' }]));
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { title: 'T', label_names: 'work:code' },
        },
      }),
      ctx,
    );
    const doc = bodyOf(out as HttpRequest);
    expect(doc.data.attributes).toEqual({ title: 'T' });
    expect(doc.data.relationships.labels.data).toEqual([
      { type: LABELS_TYPE, id: 'uuid-code' },
    ]);
  });

  it('splits a comma-separated value and trims each name in one round trip', async () => {
    const { ctx, urls } = contextFor(
      serve([
        { id: 'uuid-code', name: 'work:code' },
        { id: 'uuid-grok', name: 'grok' },
      ]),
    );
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'work:code , grok,' },
        },
      }),
      ctx,
    );
    expect(
      bodyOf(out as HttpRequest).data.relationships.labels.data.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual(['uuid-code', 'uuid-grok']);
    expect(urls).toHaveLength(1);
  });

  it('drops data.attributes entirely when the synthetic field was the only one', async () => {
    const { ctx } = contextFor(serve([{ id: 'uuid-grok', name: 'grok' }]));
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'grok' },
        },
      }),
      ctx,
    );
    expect(bodyOf(out as HttpRequest).data).not.toHaveProperty('attributes');
  });

  it('unions with caller-supplied uuids and de-duplicates by id', async () => {
    const { ctx } = contextFor(serve([{ id: 'uuid-grok', name: 'grok' }]));
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'grok' },
          relationships: {
            labels: {
              data: [
                { type: LABELS_TYPE, id: 'uuid-existing' },
                { type: LABELS_TYPE, id: 'uuid-grok' },
              ],
            },
          },
        },
      }),
      ctx,
    );
    expect(bodyOf(out as HttpRequest).data.relationships.labels.data).toEqual([
      { type: LABELS_TYPE, id: 'uuid-existing' },
      { type: LABELS_TYPE, id: 'uuid-grok' },
    ]);
  });

  it('follows links.next instead of trusting page[limit]', async () => {
    let call = 0;
    const { ctx, urls } = contextFor(() => {
      call += 1;
      return call === 1
        ? collection(
            LABELS_TYPE,
            [{ id: 'uuid-code', name: 'work:code' }],
            'https://bakers.test/page2',
          )
        : collection(LABELS_TYPE, [{ id: 'uuid-grok', name: 'grok' }]);
    });
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'grok' },
        },
      }),
      ctx,
    );
    expect(urls[1]).toBe('https://bakers.test/page2');
    expect(bodyOf(out as HttpRequest).data.relationships.labels.data).toEqual([
      { type: LABELS_TYPE, id: 'uuid-grok' },
    ]);
  });

  it('throws naming the unknown name and the vocabulary it searched', async () => {
    const { ctx } = contextFor(serve([{ id: 'uuid-code', name: 'work:code' }]));
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { label_names: 'work:cod' },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(/work:cod.*bb_labels.*work:code/s);
  });

  it('passes a read straight through without touching a vocabulary', async () => {
    const { ctx, urls } = contextFor(serve([]), 'read');
    const req: HttpRequest = { method: 'GET', url: TICKET_URL };
    expect(await nameRefsPlugin().alterRequest?.(req, ctx)).toBe(req);
    expect(urls).toEqual([]);
  });

  it('passes a write that names nothing straight through', async () => {
    const { ctx, urls } = contextFor(serve([]));
    const req = post({
      data: { type: 'bb_ticket--bb_ticket', attributes: { title: 'T' } },
    });
    expect(await nameRefsPlugin().alterRequest?.(req, ctx)).toBe(req);
    expect(urls).toEqual([]);
  });
});

// bb_environment.name is unique PER PROJECT (BbEnvironmentUniquePerProject),
// so the same name legitimately exists in several projects and a bare index
// would silently pick one. Scoping is what makes the environments resolver
// correct rather than lucky.
describe('nameRefsPlugin — alterRequest, environments (names unique per project)', () => {
  const envs = [
    { id: 'env-bakers-staging', name: 'staging', scopeId: 'project-bakers' },
    { id: 'env-shop-staging', name: 'staging', scopeId: 'project-shop' },
    { id: 'env-bakers-prod', name: 'production', scopeId: 'project-bakers' },
  ];

  // A globally-unique name is NOT self-scoping. `production` exists once, but it
  // belongs to project-bakers; a write that names no project has not said the
  // environment it means, it has merely named the only one that happens to
  // exist. Attaching it would cross a project boundary on the strength of the
  // vocabulary being small today. So a scoped resolver always establishes a
  // scope, and a scope it cannot establish is a hard error.
  it('refuses even an unambiguous name when nothing can scope it', async () => {
    const { ctx } = contextFor(serve(envs));
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { environment_names: 'production' },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(/production.*no project_id.*narrow/s);
  });

  it('reads the entity to scope an UNAMBIGUOUS name too, and refuses it when it belongs elsewhere', async () => {
    const { ctx, urls } = contextFor((url) => {
      if (url.includes('bb_environment')) return collection(ENVS_TYPE, envs);
      if (url.startsWith(`${TICKET_URL}/ticket-1`)) {
        return {
          data: {
            type: 'bb_ticket--bb_ticket',
            id: 'ticket-1',
            relationships: {
              project_id: { data: { type: PROJECT_TYPE, id: 'project-shop' } },
            },
          },
        };
      }
      throw new Error(`unexpected URL ${url}`);
    }, 'update');
    await expect(
      nameRefsPlugin().alterRequest?.(
        patch({
          data: {
            type: 'bb_ticket--bb_ticket',
            id: 'ticket-1',
            attributes: { environment_names: 'production' },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(/production.*project-shop.*project-bakers/s);
    // The entity read is what caught it — it must happen for an unambiguous
    // name, not only for a contested one.
    expect(urls).toHaveLength(2);
  });

  it('narrows an ambiguous name by the project_id already on the write', async () => {
    const { ctx, urls } = contextFor(serve(envs));
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { environment_names: 'staging' },
          relationships: {
            project_id: { data: { type: PROJECT_TYPE, id: 'project-shop' } },
          },
        },
      }),
      ctx,
    );
    expect(
      bodyOf(out as HttpRequest).data.relationships.environments.data,
    ).toEqual([{ type: ENVS_TYPE, id: 'env-shop-staging' }]);
    expect(urls).toHaveLength(1);
  });

  it('reads the entity under update when the PATCH carries no project_id', async () => {
    const { ctx, urls } = contextFor((url) => {
      if (url.includes('bb_environment')) return collection(ENVS_TYPE, envs);
      if (url.startsWith(`${TICKET_URL}/ticket-1`)) {
        return {
          data: {
            type: 'bb_ticket--bb_ticket',
            id: 'ticket-1',
            relationships: {
              project_id: { data: { type: PROJECT_TYPE, id: 'project-bakers' } },
            },
          },
        };
      }
      throw new Error(`unexpected URL ${url}`);
    }, 'update');
    const out = await nameRefsPlugin().alterRequest?.(
      patch({
        data: {
          type: 'bb_ticket--bb_ticket',
          id: 'ticket-1',
          attributes: { environment_names: 'staging' },
        },
      }),
      ctx,
    );
    expect(
      bodyOf(out as HttpRequest).data.relationships.environments.data,
    ).toEqual([{ type: ENVS_TYPE, id: 'env-bakers-staging' }]);
    expect(urls).toHaveLength(2); // the vocabulary, then the entity
  });

  it('throws with every candidate when nothing can narrow the name', async () => {
    const { ctx } = contextFor(serve(envs));
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { environment_names: 'staging' },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(
      /staging.*ambiguous.*project-bakers.*project-shop.*environments/s,
    );
  });

  it('throws when the name exists, but not in this project, naming where it does', async () => {
    const { ctx } = contextFor(serve(envs));
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { environment_names: 'production' },
            relationships: {
              project_id: { data: { type: PROJECT_TYPE, id: 'project-shop' } },
            },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(/production.*project-shop.*project-bakers/s);
  });

  it('resolves both synthetic fields on one write, one round trip each', async () => {
    const { ctx, urls } = contextFor((url) => {
      if (url.includes('bb_term')) {
        return collection(LABELS_TYPE, [
          { id: 'uuid-code', name: 'work:code' },
        ]);
      }
      if (url.includes('bb_environment')) return collection(ENVS_TYPE, envs);
      throw new Error(`unexpected URL ${url}`);
    });
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: {
            title: 'T',
            label_names: 'work:code',
            environment_names: 'production',
          },
          relationships: {
            project_id: { data: { type: PROJECT_TYPE, id: 'project-bakers' } },
          },
        },
      }),
      ctx,
    );
    const doc = bodyOf(out as HttpRequest);
    expect(doc.data.attributes).toEqual({ title: 'T' });
    expect(doc.data.relationships.labels.data).toEqual([
      { type: LABELS_TYPE, id: 'uuid-code' },
    ]);
    expect(doc.data.relationships.environments.data).toEqual([
      { type: ENVS_TYPE, id: 'env-bakers-prod' },
    ]);
    expect(urls).toHaveLength(2);
  });
});

// BB-531: label names are unique only within (workspace_id, vid), not
// globally. Two rows carrying the same name in two workspaces, a ticket
// write naming project B (workspace B) -- the resolver MUST select the row
// in workspace B, never throw "ambiguous". The fix adds a workspace chain
// (project_id.group_id.workspace_id) on the payload side, with the target
// compared on its `workspace_id` field.
describe('nameRefsPlugin -- alterRequest, labels workspace-scoped (BB-531)', () => {
  const GROUP_TYPE = 'bb_group--bb_group';
  const WORKSPACE_TYPE = 'bb_workspace--bb_workspace';

  const labels = [
    { id: 'uuid-code-A', name: 'work:code', workspaceId: 'ws-a' },
    { id: 'uuid-code-B', name: 'work:code', workspaceId: 'ws-b' },
  ];

  const labelsCollection = () => ({
    data: labels.map((r) => ({
      type: LABELS_TYPE,
      id: r.id,
      attributes: { name: r.name },
      relationships: {
        workspace_id: {
          data: { type: WORKSPACE_TYPE, id: r.workspaceId },
        },
      },
    })),
    links: {},
  });

  /**
   * `?include=group_id.workspace_id` on a project returns the chain in one
   * round trip; the workspace uuid the resolver compares against is reached
   * via `included[*]` (the relationship node itself is nulled when included).
   */
  const projectWithChain = (groupId: string, workspaceId: string) => ({
    data: {
      type: PROJECT_TYPE,
      id: 'project-b',
      relationships: {
        group_id: { data: { type: GROUP_TYPE, id: groupId } },
      },
    },
    included: [
      {
        type: GROUP_TYPE,
        id: groupId,
        relationships: {
          workspace_id: { data: { type: WORKSPACE_TYPE, id: workspaceId } },
        },
      },
    ],
  });

  it('narrows by the workspace derived from project_id on a CREATE', async () => {
    const projectUrl =
      'https://bakers.test/jsonapi/bb_project/bb_project/project-b';
    const { ctx, urls } = contextFor((url) => {
      if (url.includes('bb_term/bb_labels')) return labelsCollection();
      if (url === projectUrl || url.startsWith(`${projectUrl}?`))
        return projectWithChain('group-b', 'ws-b');
      throw new Error(`unexpected URL ${url}`);
    });
    const out = await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'work:code' },
          relationships: {
            project_id: { data: { type: PROJECT_TYPE, id: 'project-b' } },
          },
        },
      }),
      ctx,
    );
    expect(bodyOf(out as HttpRequest).data.relationships.labels.data).toEqual([
      { type: LABELS_TYPE, id: 'uuid-code-B' },
    ]);
    expect(urls.length).toBeLessThanOrEqual(2);
  });

  it('narrows by the workspace derived from project_id on an UPDATE that omits project_id', async () => {
    const { ctx } = contextFor((url) => {
      if (url.includes('bb_term/bb_labels')) return labelsCollection();
      if (url.startsWith(`${TICKET_URL}/ticket-1`))
        return projectWithChain('group-b', 'ws-b');
      throw new Error(`unexpected URL ${url}`);
    }, 'update');
    const out = await nameRefsPlugin().alterRequest?.(
      patch({
        data: {
          type: 'bb_ticket--bb_ticket',
          id: 'ticket-1',
          attributes: { label_names: 'work:code' },
        },
      }),
      ctx,
    );
    expect(bodyOf(out as HttpRequest).data.relationships.labels.data).toEqual([
      { type: LABELS_TYPE, id: 'uuid-code-B' },
    ]);
  });

  it('throws naming the candidate workspaces when the write carries no project_id to chain from', async () => {
    const { ctx } = contextFor((url) => {
      if (url.includes('bb_term/bb_labels')) return labelsCollection();
      throw new Error(`unexpected URL ${url}`);
    });
    const promise = nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'work:code' },
        },
      }),
      ctx,
    );
    if (!promise) throw new Error('alterRequest returned undefined');
    await expect(promise).rejects.toThrow(/work:code.*ambiguous.*ws-a.*ws-b/s);
  });
});

// The unit tests above start from a payload that already carries
// `attributes.label_names`. Nothing proved that a `--label_names work:code` on
// the command line ARRIVES there, nor that the extended schema still validates
// once `additionalProperties: false` sees a property the server never declared.
// Both are answerable in-process, with no network, from dropsh's own
// `buildPayloadFromParameters` / `indexSchemaFields` — which is what the CLI
// itself calls.
describe('nameRefsPlugin — the seam from flag to payload (dropsh, in-process)', () => {
  /** An operation schema shaped like the real one: closed attributes. */
  const closedSchema = () => ({
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          type: { const: 'bb_ticket--bb_ticket' },
          attributes: {
            type: 'object',
            additionalProperties: false,
            properties: { title: { type: 'string' } },
          },
          relationships: {
            type: 'object',
            properties: { labels: rel(LABELS_TYPE) },
          },
        },
      },
    },
  });

  it('exposes label_names as a settable ATTRIBUTE in dropsh’s own field index', async () => {
    const index = indexSchemaFields(await extend(closedSchema()));
    expect(index.fields.get('label_names')?.kind).toBe('attribute');
    expect(index.fields.get('environment_names')).toBeUndefined(); // not declared
  });

  it('lands --label_names work:code at attributes.label_names', async () => {
    const payload = buildPayloadFromParameters({
      schema: await extend(closedSchema()),
      parameters: [
        { path: 'title', value: 'T', form: 'flag', hasValue: true },
        {
          path: 'label_names',
          value: 'work:code',
          form: 'flag',
          hasValue: true,
        },
      ],
      operation: 'create',
    }) as { data: { attributes: Record<string, unknown> } };
    expect(payload.data.attributes.label_names).toBe('work:code');
  });

  it('the EXTENDED schema accepts that payload despite additionalProperties: false', async () => {
    const extended = await extend(closedSchema());
    const ajv = new Ajv({ strict: false });
    const payload = buildPayloadFromParameters({
      schema: extended,
      parameters: [
        { path: 'title', value: 'T', form: 'flag', hasValue: true },
        {
          path: 'label_names',
          value: 'work:code',
          form: 'flag',
          hasValue: true,
        },
      ],
      operation: 'create',
    });
    expect(ajv.validate(extended as object, payload)).toBe(true);
    // ...and the UNEXTENDED schema is what would have rejected it, so the
    // assertion above is about the extension and not about a lax validator.
    expect(ajv.validate(closedSchema() as object, payload)).toBe(false);
  });
});

describe('nameRefsPlugin — the failure modes a live vocabulary can produce', () => {
  it('names the status when the vocabulary fetch is not 2xx, instead of parsing the error body', async () => {
    const { ctx } = contextFor(
      () => ({ errors: [{ status: '403' }] }),
      'create',
      403,
    );
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { label_names: 'work:code' },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(/403.*bb_term\/bb_labels/s);
  });

  it('names token expiry as a cause, because the plugin cannot renew one', async () => {
    const { ctx } = contextFor(() => ({}), 'create', 401);
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { label_names: 'work:code' },
          },
        }),
        ctx,
      ),
    ).rejects.toThrow(/401.*expired/s);
  });

  it('stops at MAX_PAGES and reports the ceiling dropsh actually reaches', async () => {
    // Every page offers a next link, so the walk can never terminate.
    const { ctx, urls } = contextFor(() =>
      collection(
        LABELS_TYPE,
        [{ id: 'u', name: 'n' }],
        'https://bakers.test/next',
      ),
    );
    await expect(
      nameRefsPlugin().alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { label_names: 'work:code' },
          },
        }),
        ctx,
      ),
      // 10 pages x Drupal's OffsetPage::SIZE_MAX of 50 = 500 rows, NOT 10 x 200.
    ).rejects.toThrow(/10 pages.*50.*500/s);
    expect(urls).toHaveLength(10);
  });

  it('caps the known-names list in the unknown-name error', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `uuid-${i}`,
      name: `label-${String(i).padStart(2, '0')}`,
    }));
    const { ctx } = contextFor(serve(many));
    const err = await nameRefsPlugin()
      .alterRequest?.(
        post({
          data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { label_names: 'nope' },
          },
        }),
        ctx,
      )
      .catch((e: unknown) => e as Error);
    const message = (err as Error).message;
    expect(message).toMatch(/nope/);
    expect(message).toMatch(/label-00/);
    expect(message).toMatch(/40/); // the total is stated
    expect(message).not.toMatch(/label-39/); // ...but not every name is listed
  });

  it('does not invent a relationship the bundle does not declare', async () => {
    // bb_comment declares neither `labels` nor `environments`, so
    // extendOperationSchema offers no synthetic field for it. A `label_names`
    // that reaches the write anyway (a hand-built body, --no-validate) must not
    // be turned into a `labels` relationship that cannot exist.
    const plugin = nameRefsPlugin();
    await plugin.extendOperationSchema?.(
      'bb_comment',
      'bb_comment',
      'create',
      schemaWithNeither(),
      {} as never,
    );
    const { ctx, urls } = contextFor(
      serve([{ id: 'uuid-code', name: 'work:code' }]),
    );
    await expect(
      plugin.alterRequest?.(
        post({
          data: {
            type: 'bb_comment--bb_comment',
            attributes: { label_names: 'work:code' },
          },
        }),
        { ...ctx, entityType: 'bb_comment', bundle: 'bb_comment' } as never,
      ),
    ).rejects.toThrow(/bb_comment.*labels/s);
    expect(urls).toEqual([]); // refused before spending a round trip
  });
});

describe('nameRefsPlugin — the JSON:API prefix is normalised', () => {
  it('inserts the missing leading slash instead of concatenating host and prefix', async () => {
    const { ctx, urls } = contextFor(
      serve([{ id: 'uuid-code', name: 'work:code' }]),
    );
    await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'work:code' },
        },
      }),
      { ...ctx, jsonapiPrefix: 'jsonapi' } as never,
    );
    expect(urls[0]).toMatch(
      /^https:\/\/bakers\.test\/jsonapi\/bb_term\/bb_labels\?/,
    );
  });

  it('does not double the slash when the prefix has a trailing one', async () => {
    const { ctx, urls } = contextFor(
      serve([{ id: 'uuid-code', name: 'work:code' }]),
    );
    await nameRefsPlugin().alterRequest?.(
      post({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { label_names: 'work:code' },
        },
      }),
      { ...ctx, jsonapiPrefix: '/jsonapi/' } as never,
    );
    expect(urls[0]).toMatch(
      /^https:\/\/bakers\.test\/jsonapi\/bb_term\/bb_labels\?/,
    );
  });
});
