// Real-CLI contract: the same literal argv runs through the checked-out bakers.build CLI (against a
// disposable loopback JSON:API fixture) and through the skill tool simulator. A disagreement, a
// wrong payload or an escaped request fails a named check. No model, shell or tracker is involved.
import { createServer } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  check,
  cliError,
  payload,
} from '../../../../tests/skill-eval/call-utils.mjs';
import {
  cliIdentity,
  contractEnvironment,
  contractFixture,
  endpointSeed,
  launcher,
  runCli,
  runSimulator,
  startEndpoint,
} from '../../../../tests/skill-eval/cli-contract.mjs';
import { loadFixture } from '../../../../tests/skill-eval/fixtures.mjs';

type Result = { exit_code: number | string; stdout: string; stderr: string };
type Request = {
  method: string;
  path: string;
  query: [string, string][];
  raw: string;
  json?: { data?: Record<string, any> };
  status?: number | string;
};
type Endpoint = Awaited<ReturnType<typeof startEndpoint>> & {
  requests: Request[];
  unknown: Request[];
};
type Simulation = Record<string, any>;

const ticketId = '11111111-1111-4111-8111-111111111111';
const ticket = `bb_ticket/bb_ticket/${ticketId}`;
const firstComment = '22222222-2222-4222-8222-000000000001';
const newTicket = '33333333-3333-4333-8333-333333333333';
const G = ['bakers', 'dropsh'];
const T = 120000;
const failing = (checks: { id: string; met: boolean }[]) =>
  checks.filter((c) => !c.met).map((c) => c.id);
/** Raw observations stay visible: a failed expectation prints both legs' stdout/stderr per step. */
const observed = (steps: string[][], real: Result[], sim: Result[]) =>
  JSON.stringify(
    steps.map((argv, i) => ({
      step: i,
      argv: argv.slice(2),
      cli: real[i],
      simulator: sim[i],
    })),
    null,
    1,
  );

/** Run the argv sequence on both legs: one endpoint per case, one simulator session per case. */
async function pair(
  simulation: Simulation,
  steps: string[][],
  faults: Record<string, unknown> = {},
) {
  const endpoint = (await startEndpoint(
    endpointSeed(simulation, faults),
  )) as Endpoint;
  try {
    const real: Result[] = [];
    for (const argv of steps)
      real.push(
        await runCli(argv, {
          origin: endpoint.origin,
          files: simulation.files ?? {},
        }),
      );
    const sim = (await runSimulator(
      simulation,
      steps.map((argv) => ({ name: 'bakers', arguments: { argv } })),
    )) as Result[];
    return { real, sim, endpoint };
  } finally {
    await endpoint.close();
  }
}

// Normalization allowlist: JSON object key order only. Text values, IDs, relationship
// cardinality, absent fields and failure classes are compared as observed.
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
        )
      : v;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const json = (r: Result) => payload({ result: r });
const error = (r: Result) => cliError({ result: r });
const commanderText = (r: Result) => (error(r) ? undefined : r.stderr);

/** Named agreement checks between one real CLI result and the simulator's result for the same argv. */
export function agreement(step: string, real: Result, sim: Result) {
  const ok = real.exit_code === 0;
  const realJson = json(real);
  return [
    check(
      `${step}:exit-code`,
      real.exit_code === sim.exit_code,
      `exit ${real.exit_code} (CLI) vs ${sim.exit_code} (simulator)`,
    ),
    check(
      `${step}:success-output`,
      !ok ||
        (realJson === undefined
          ? real.stdout === sim.stdout
          : same(realJson, json(sim))),
      'Successful stdout agrees: JSON documents by value, other formats exactly',
    ),
    check(
      `${step}:error-class`,
      ok ||
        (error(real)
          ? error(real)?.code === error(sim)?.code &&
            error(real)?.details?.status === error(sim)?.details?.status
          : commanderText(real) === commanderText(sim)),
      'Failures agree on the bakers.build error code and HTTP status, or on the exact parser message',
    ),
  ];
}
const agreeAll = (real: Result[], sim: Result[], label = 'step') =>
  real.flatMap((r, i) => agreement(`${label}-${i}`, r, sim[i] as Result));
const mutations = (endpoint: Endpoint) =>
  endpoint.requests.filter((r) =>
    ['POST', 'PATCH', 'DELETE'].includes(r.method),
  );
const schemaUsed = (endpoint: Endpoint, key: string) =>
  endpoint.requests.some(
    (r) => r.path === `/jsonapi/${key}/resource/schema` && r.status === 200,
  );
const boundary = (endpoint: Endpoint, results: Result[]) => [
  check(
    'known-routes',
    endpoint.unknown.length === 0,
    'Every CLI request hit a modeled fixture route',
  ),
  check(
    'fixture-credential-only',
    endpoint.requests.every((r) => (r as any).authorization),
    'Only the disposable fixture credential was sent',
  ),
  check(
    'no-schema-fallback',
    results.every(
      (r) =>
        !/falling back to the heuristic schema|no schema plugin/.test(r.stderr),
    ),
    'Validation used the authoritative fixture schema',
  ),
];

let identity: ReturnType<typeof cliIdentity>;
beforeAll(() => {
  identity = cliIdentity();
  // The tested implementation, recorded with every run.
  console.info(JSON.stringify({ cli_contract_identity: identity }));
});

describe('skill CLI contract: real repository CLI vs simulator', () => {
  it('cli-identity: resolves and records the checked-out launcher, never another installation', () => {
    expect(identity.files.launcher.path).toBe(launcher);
    expect(identity.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(identity.packages.dropsh.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(identity.files)).toEqual([
      'launcher',
      'host',
      'addon_dropsh',
      'addon_essentials',
      'addon_name_refs',
      'addon_auth_basic',
    ]);
    expect(() => cliIdentity('/usr/bin/env')).toThrow(/outside/);
    expect(() => cliIdentity(`${launcher}-missing`)).toThrow(
      /missing build artifact/,
    );
  });

  it(
    'help-and-fields: advertised syntax exists in the CLI and field listings agree exactly',
    async () => {
      const simulation = (await loadFixture('transition-ticket-calls'))
        .simulation;
      const steps = [
        [...G, '--help'],
        ...['read', 'search', 'create', 'update'].map((a) => [
          ...G,
          a,
          '--help',
        ]),
        [...G, 'create', 'bb_comment', '--bundle', 'bb_comment', '--fields'],
        [...G, 'create', 'bb_ticket', '--bundle', 'bb_ticket', '--fields'],
        [...G, 'update', ticket, '--fields'],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps);
      const options = (text: string) => new Set(text.match(/--[a-z][\w-]*/g));
      const commands = (text: string) =>
        new Set(
          text
            .split('Commands:')[1]
            ?.match(/^ {2}(\w[\w-]*)/gm)
            ?.map((c) => c.trim()),
        );
      const checks = [
        ...real.map((r, i) =>
          check(
            `help-${i}:exit-code`,
            r.exit_code === 0 && sim[i]?.exit_code === 0,
            'Help and discovery succeed on both legs',
          ),
        ),
        check(
          'root-commands',
          [...commands(sim[0]!.stdout)].every((c) =>
            commands(real[0]!.stdout).has(c),
          ),
          'Every command the simulator advertises exists in the CLI',
        ),
        ...[1, 2, 3, 4].map((i) =>
          check(
            `action-options-${i}`,
            [...options(sim[i]!.stdout)].every(
              (o) => options(real[i]!.stdout).has(o) || o.startsWith('--<'),
            ),
            'Every option the simulator advertises for an action exists in the CLI',
          ),
        ),
        ...[5, 6, 7].map((i) =>
          check(
            `fields-${i}`,
            real[i]!.stdout === sim[i]!.stdout,
            'Field parameters, types, required markers and relationship targets agree exactly',
          ),
        ),
        check(
          'schema-route-used',
          schemaUsed(endpoint, 'bb_comment/bb_comment') &&
            schemaUsed(endpoint, 'bb_ticket/bb_ticket'),
          'Field discovery read the authoritative schema route',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks)).toEqual([]);
      expect(real[6]!.stdout).toContain('--label_names <value>');
      expect(real[6]!.stdout).toContain('--json links=<json>');
      // Negative control: without the schema route the CLI silently infers fields; the check fails.
      const missing = await pair(simulation, [steps[5] as string[]], {
        noSchema: true,
      });
      expect(
        failing([
          check(
            'schema-route-used',
            schemaUsed(missing.endpoint, 'bb_comment/bb_comment'),
            '',
          ),
          ...boundary(missing.endpoint, missing.real),
        ]),
      ).toEqual(['schema-route-used', 'no-schema-fallback']);
      expect(missing.real[0]!.stdout).not.toBe(missing.sim[0]!.stdout);
    },
    T,
  );

  it(
    'read-search-and-format: reads, searches and the selected format agree',
    async () => {
      const hit = (await loadFixture('create-ticket-prior-art')).simulation;
      const search = (...filters: string[]) => [
        ...G,
        'search',
        'bb_ticket',
        '--bundle',
        'bb_ticket',
        ...filters.flatMap((f) => ['--filter', f]),
      ];
      const steps = [
        [...G, 'read', `bb_ticket/bb_ticket/${hit.prior_art.id}`],
        [
          ...G,
          '--format',
          'md',
          'read',
          `bb_ticket/bb_ticket/${hit.prior_art.id}`,
        ],
        [
          ...G,
          'read',
          `bb_ticket/bb_ticket/${hit.prior_art.id}`,
          '--format',
          'md',
        ],
        search('title:CONTAINS:invoice'),
        search('description.value:CONTAINS:invoices'),
        search('title:CONTAINS:ticket'),
        [
          ...G,
          'search',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--filter',
          'title:CONTAINS:invoice',
          'state:coding',
        ],
        [
          ...G,
          '--format',
          'md',
          ...search('title:CONTAINS:nothing-matches').slice(2),
        ],
        [
          ...G,
          'search',
          'bb_term',
          '--bundle',
          'bb_labels',
          '--filter',
          'name:work:docs',
        ],
        [
          ...G,
          '--format',
          'json',
          'search',
          'bb_term',
          '--bundle',
          'bb_labels',
        ],
        search('identifier:EVAL-70'),
        search('identifier:CONTAINS:EVAL-70'),
      ];
      const { real, sim, endpoint } = await pair(hit, steps);
      const rows = (r: Result) =>
        (json(r)?.data ?? []).map((d: { id: string }) => d.id);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'candidate-identifier',
          same(rows(real[10]!), [hit.prior_art.id]) &&
            same(rows(real[11]!), [hit.prior_art.id]),
          'Trailer identifiers resolve through scalar exact and contains filters',
        ),
        check(
          'md-is-markdown',
          json(real[1]!) === undefined &&
            real[1]!.stdout.startsWith('type: bb_ticket--bb_ticket\n') &&
            real[1]!.stdout === real[2]!.stdout,
          'The md format renders text, wherever --format appears',
        ),
        check(
          'positive-hit',
          same(rows(real[3]!), [hit.prior_art.id]) &&
            same(rows(real[6]!), [hit.prior_art.id]),
          'Domain spelling and the variadic filter form find the prior-art candidate',
        ),
        check(
          'empty-and-probe',
          rows(real[4]!).length === 0 &&
            same(rows(real[5]!), [contractFixture.probe_ticket.id]),
          'An empty query is distinguishable and the known-positive probe matches',
        ),
        check(
          'label-target',
          same(rows(real[8]!), [contractFixture.terms[0].id]) &&
            rows(real[9]!).length === 3,
          'Labels are the bb_term entity with bundle bb_labels',
        ),
        check(
          'search-query',
          endpoint.requests.some(
            (r) =>
              r.path === '/jsonapi/bb_ticket/bb_ticket' &&
              same(
                r.query.filter(([k]) => k.startsWith('filter')),
                [
                  ['filter[title][value]', 'invoice'],
                  ['filter[title][operator]', 'CONTAINS'],
                  ['filter[state]', 'coding'],
                ],
              ),
          ),
          'Filters reach the query as JSON:API filter parameters',
        ),
        check(
          'read-only',
          mutations(endpoint).length === 0,
          'Reads and searches send no mutation',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'comment-payload-and-readback: exact Markdown and identifiers reach the wire and read back',
    async () => {
      const simulation = (await loadFixture('publish-comment-calls'))
        .simulation;
      // Leading dashes, both quote types, Unicode, backticks, dollar signs, embedded and trailing newlines.
      const body = `${simulation.files['/fixture/comment.md']}'single' and "double" — ✓ \`$(id)\`\n\n`;
      const corrected = `${body}Correction: ünïcode.\n`;
      const steps = [
        [...G, 'create', 'bb_comment', '--bundle', 'bb_comment', '--fields'],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          `--body.value=${body}`,
          '--body.format',
          'bb_rich',
          '--bb_comment_type',
          'coding',
          '--ticket_id',
          ticketId,
        ],
        [...G, 'read', `bb_comment/bb_comment/${firstComment}`],
        [...G, 'read', ticket, '--include', 'comments'],
        [
          ...G,
          '--format',
          'md',
          'read',
          `bb_comment/bb_comment/${firstComment}`,
        ],
        [
          ...G,
          'update',
          `bb_comment/bb_comment/${firstComment}`,
          `--body.value=${corrected}`,
          '--body.format',
          'bb_rich',
        ],
        [...G, 'read', `bb_comment/bb_comment/${firstComment}`],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps);
      const [create, patch] = mutations(endpoint);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'raw-body',
          create?.raw.includes(JSON.stringify(body)) === true,
          'The request bytes carry the exact JSON-encoded Markdown',
        ),
        check(
          'body-exact',
          create?.json?.data?.attributes?.body?.value === body &&
            create?.json?.data?.attributes?.body?.format === 'bb_rich' &&
            create?.json?.data?.attributes?.bb_comment_type === 'coding',
          'Text, format and type are exact, including the trailing newlines',
        ),
        check(
          'ticket-linkage',
          same(create?.json?.data?.relationships, {
            ticket_id: {
              data: { type: 'bb_ticket--bb_ticket', id: ticketId },
            },
          }),
          'The ticket is a single relationship, not an attribute',
        ),
        check(
          'readback-identity',
          json(real[1]!)?.data?.id === firstComment &&
            json(real[2]!)?.data?.id === firstComment &&
            json(real[2]!)?.data?.attributes?.body?.value === body,
          'The create response and an independent read name the same UUID and text',
        ),
        check(
          'included-comment',
          json(real[3]!)?.included?.[0]?.attributes?.body?.value === body,
          'The ticket read includes the stored comment',
        ),
        check(
          'md-drops-trailing-newline',
          !real[4]!.stdout.includes(`${body.trimEnd()}\n\n`),
          'Markdown output cannot prove trailing newlines; exact readback needs JSON',
        ),
        check(
          'correction-scope',
          mutations(endpoint).length === 2 &&
            patch?.method === 'PATCH' &&
            patch.path === `/jsonapi/bb_comment/bb_comment/${firstComment}` &&
            same(patch.json?.data?.attributes, {
              body: { value: corrected, format: 'bb_rich' },
            }),
          'The correction patches only that comment',
        ),
        check(
          'corrected-readback',
          json(real[6]!)?.data?.attributes?.body?.value === corrected &&
            json(real[6]!)?.data?.attributes?.body?.format === 'bb_rich',
          'PATCH replaces the whole body field, so the correction restates its format',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'data-file-payload: a runner-owned data file sends the same exact payload; mixed or denied input is rejected',
    async () => {
      const base = (await loadFixture('publish-comment-calls')).simulation;
      const body = base.files['/fixture/comment.md'];
      const document = {
        data: {
          type: 'bb_comment--bb_comment',
          attributes: {
            body: { value: body, format: 'bb_rich' },
            bb_comment_type: 'coding',
          },
          relationships: {
            ticket_id: {
              data: { type: 'bb_ticket--bb_ticket', id: ticketId },
            },
          },
        },
      };
      const simulation = {
        ...base,
        files: {
          ...base.files,
          '/fixture/comment.json': JSON.stringify(document),
        },
      };
      const steps = [
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          '--data',
          '@/fixture/comment.json',
        ],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          '--data',
          '@/fixture/comment.json',
          '--bb_comment_type',
          'coding',
        ],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          '--data',
          '@/fixture/../../bakers-contract-not-listed.json',
        ],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          `--body.value=${body}`,
          '--body.format',
          'bb_rich',
          '--bb_comment_type',
          'coding',
          '--ticket_id',
          ticketId,
        ],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps);
      const [fromFile, fromFields] = mutations(endpoint);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'file-equals-fields',
          mutations(endpoint).length === 2 &&
            same(fromFile?.json, document) &&
            same(fromFile?.json, fromFields?.json),
          'The data file and field parameters serialize the same exact document',
        ),
        check(
          'mixed-rejected',
          error(real[1]!)?.code === 'E_VALIDATION',
          '--data and field parameters cannot be combined',
        ),
        check(
          'unlisted-file-denied',
          error(real[2]!)?.code === 'E_VALIDATION' &&
            error(sim[2]!)?.code === 'E_VALIDATION',
          'An unlisted or traversing virtual path is not read',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'ticket-payload-and-labels: label names become relationship linkage and never leak as attributes',
    async () => {
      const fixture = await loadFixture('create-ticket-calls');
      const simulation = fixture.simulation;
      const description = simulation.files[fixture.input.description_file];
      const steps = [
        [
          ...G,
          'create',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          `--title=${fixture.input.title}`,
          '--workflow',
          'bb_feature',
          `--description.value=${description}`,
          '--description.format',
          'bb_rich',
          '--project_id',
          fixture.input.project_uuid,
          '--label_names',
          'work:docs,method:matt',
          '--parent_id',
          contractFixture.probe_ticket.id,
        ],
        [...G, 'read', `bb_ticket/bb_ticket/${newTicket}`],
        [
          ...G,
          'create',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--title=Second',
          '--workflow',
          'bb_feature',
          '--project_id',
          fixture.input.project_uuid,
          '--label_names',
          'work:unknown',
        ],
        [
          ...G,
          'create',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--title=Third',
          '--workflow',
          'not_a_workflow',
          '--project_id',
          fixture.input.project_uuid,
        ],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps);
      const [create] = mutations(endpoint);
      const [docs, matt] = contractFixture.terms;
      const linkage = {
        project_id: {
          data: {
            type: 'bb_project--bb_project',
            id: fixture.input.project_uuid,
          },
        },
        labels: {
          data: [
            { type: 'bb_term--bb_labels', id: docs.id },
            { type: 'bb_term--bb_labels', id: matt.id },
          ],
        },
        parent_id: {
          data: {
            type: 'bb_ticket--bb_ticket',
            id: contractFixture.probe_ticket.id,
          },
        },
      };
      const checks = [
        ...agreeAll(real, sim),
        check(
          'ticket-attributes',
          same(create?.json?.data?.attributes, {
            title: fixture.input.title,
            workflow: 'bb_feature',
            description: { value: description, format: 'bb_rich' },
          }),
          'Title, workflow and rich description serialize exactly; no name-only field leaks',
        ),
        check(
          'ticket-relationships',
          same(create?.json?.data?.relationships, linkage),
          'Project, parent and resolved labels are relationships with exact type, UUID and cardinality',
        ),
        check(
          'ticket-readback',
          json(real[0]!)?.data?.id === newTicket &&
            json(real[0]!)?.data?.attributes?.state === 'qualification' &&
            same(json(real[1]!)?.data?.relationships?.labels, linkage.labels) &&
            json(real[1]!)?.data?.attributes?.description?.value ===
              description,
          'The create response names the new ticket in its initial state; independent readback preserves its identifiers',
        ),
        check(
          'local-rejections-send-nothing',
          mutations(endpoint).length === 1,
          'An unknown label or an invalid enum value is rejected before any POST',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'transition-update-shapes: state-only, links-only and combined updates send exactly the supplied fields',
    async () => {
      const fixture = await loadFixture('transition-ticket-calls');
      const simulation = fixture.simulation;
      const links = [...simulation.ticket.links, ...fixture.input.links];
      const linksArg = `links=${JSON.stringify(links)}`;
      const steps = [
        [...G, 'update', ticket, '--json', linksArg],
        [...G, 'read', ticket],
        [...G, 'update', ticket, '--state', 'review'],
        [...G, 'update', ticket, '--state', 'coding', '--json', linksArg],
        [
          ...G,
          'update',
          ticket,
          '--state',
          'done',
          '--json',
          'links={not json',
        ],
        [
          ...G,
          'update',
          ticket,
          '--state',
          'done',
          '--json',
          'links=[{"uri":"not a uri","title":"x"}]',
        ],
        [...G, 'read', ticket],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps);
      const [linksOnly, stateOnly, combined] = mutations(endpoint);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'links-only-shape',
          same(linksOnly?.json?.data, {
            type: 'bb_ticket--bb_ticket',
            id: ticketId,
            attributes: { links },
          }),
          'A links-only update omits state and carries the complete additive link array',
        ),
        check(
          'links-only-readback',
          json(real[1]!)?.data?.attributes?.state === 'coding' &&
            same(json(real[1]!)?.data?.attributes?.links, links),
          'Readback keeps the old state and every link',
        ),
        check(
          'state-only-shape',
          same(stateOnly?.json?.data?.attributes, { state: 'review' }),
          'A state-only update carries only state',
        ),
        check(
          'combined-shape',
          same(combined?.json?.data?.attributes, { state: 'coding', links }),
          'A combined update carries exactly state and links',
        ),
        check(
          'invalid-links-no-mutation',
          mutations(endpoint).length === 3 &&
            json(real[6]!)?.data?.attributes?.state === 'coding' &&
            json(sim[6]!)?.data?.attributes?.state === 'coding',
          'Malformed or invalid links fail without a partial state change on either leg',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'malformed-and-unknown: rejections agree in class and send no mutation',
    async () => {
      const simulation = (await loadFixture('transition-ticket-calls'))
        .simulation;
      const steps = [
        [...G, 'read', `bb_ticket/${ticketId}`],
        [...G, 'read', `bb_ticket/bb_ticket/${ticketId}/extra`],
        [...G, 'read', `x/bb_ticket/bb_ticket/${ticketId}`],
        [...G, 'read', `bb_ticket/bb_comment/${ticketId}`],
        [...G, 'read', 'bb_ticket/bb_ticket/NOT A UUID'],
        [...G, 'read', ticket, 'extra-positional'],
        [...G, 'read'],
        [...G, 'get', ticket],
        [...G, 'read', ticket, '--invented-flag', 'yes'],
        [
          ...G,
          'search',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--invented-flag',
        ],
        [
          ...G,
          'search',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--filter',
          'title',
        ],
        [
          ...G,
          'search',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--filter',
          'description:CONTAINS:x',
        ],
        [...G, 'create', 'bb_comment', '--body.value', 'x'],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          '--body.value',
          'x',
          '--bb_comment_type',
          'coding',
          '--ticket_id',
          ticketId,
          '--invented',
          'y',
        ],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          '--body.value',
          '--leading dash needs equals',
          '--bb_comment_type',
          'coding',
          '--ticket_id',
          ticketId,
        ],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          '--body.value',
          'x',
          '--bb_comment_type',
          'coding',
          '--ticket_id',
          'not-a-uuid',
        ],
        [...G, 'update', 'bb_ticket/bb_ticket/XYZ', '--state', 'review'],
        [...G, 'update', ticket, '--state'],
        [...G, 'update', ticket],
        [...G, '--format', 'yaml', 'read', ticket],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'rejected',
          real.every((r, i) => [5].includes(i) || r.exit_code !== 0),
          'Every malformed input except an ignored extra positional is rejected',
        ),
        check(
          'malformed-read-not-accepted',
          real[1]!.exit_code !== 0 &&
            real[2]!.exit_code !== 0 &&
            real[3]!.exit_code !== 0,
          'A matching final UUID segment does not make a malformed read succeed',
        ),
        check(
          'no-mutation',
          mutations(endpoint).length === 0,
          'Local validation may read schema but sends no mutation',
        ),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'missing-read-and-422: definite failures stay failures without mutation',
    async () => {
      const simulation = (await loadFixture('transition-ticket-rejected'))
        .simulation;
      const steps = [
        [
          ...G,
          'read',
          'bb_ticket/bb_ticket/99999999-9999-4999-8999-999999999999',
        ],
        [...G, 'update', ticket, '--state', 'review'],
        [...G, 'read', ticket],
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, {
        reject422: 'supplied transition rejected; current state unchanged',
      });
      const checks = [
        ...agreeAll(real, sim),
        check(
          'missing-read',
          real[0]!.exit_code === 5 &&
            error(real[0]!)?.code === 'E_HTTP' &&
            error(real[0]!)?.details?.status === 404,
          'A missing entity is E_HTTP 404, exit 5',
        ),
        check(
          'definite-422',
          real[1]!.exit_code === 5 &&
            error(real[1]!)?.code === 'E_HTTP' &&
            error(real[1]!)?.details?.status === 422 &&
            /rejected/.test(JSON.stringify(error(real[1]!)?.details?.body)),
          'A server 422 is E_HTTP, exit 5, details.status 422 with its detail',
        ),
        check(
          'state-unchanged',
          json(real[2]!)?.data?.attributes?.state === 'coding' &&
            json(sim[2]!)?.data?.attributes?.state === 'coding',
          'Independent readback shows the old state on both legs',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  const lost = async (mode: 'applied' | 'unapplied') => {
    const base = (await loadFixture('publish-comment-uncertain')).simulation;
    const simulation = { ...base, uncertain_comment: mode };
    const body = base.files['/fixture/comment.md'];
    const steps = [
      [
        ...G,
        'create',
        'bb_comment',
        '--bundle',
        'bb_comment',
        `--body.value=${body}`,
        '--body.format',
        'bb_rich',
        '--bb_comment_type',
        'coding',
        '--ticket_id',
        ticketId,
      ],
      [
        ...G,
        'search',
        'bb_comment',
        '--bundle',
        'bb_comment',
        '--filter',
        `ticket_id:${ticketId}`,
      ],
    ];
    const result = await pair(simulation, steps, { lostResponse: mode });
    return { ...result, body, steps };
  };
  const uncertainty = (r: Result) =>
    r.exit_code === 5 &&
    error(r)?.code === 'E_HTTP' &&
    error(r)?.details?.status === 0;

  it(
    'lost-response-applied: one write, uncertain to the client, reconciled by a unique search',
    async () => {
      const { real, sim, endpoint, body, steps } = await lost('applied');
      const submissions = mutations(endpoint);
      const rows = (r: Result) => json(r)?.data ?? [];
      const checks = [
        ...agreeAll(real, sim),
        check(
          'client-uncertain',
          uncertainty(real[0]!) && uncertainty(sim[0]!),
          'A lost response is E_HTTP with status 0, not a definite rejection',
        ),
        check(
          'one-submission-per-write',
          submissions.length === 1,
          `One create sends one POST; the CLI sent ${submissions.length}, each applied by the endpoint`,
        ),
        check(
          'unique-reconciliation',
          rows(real[1]!).length === 1 &&
            rows(real[1]!)[0]?.attributes?.body?.value === body,
          'A later search finds exactly the one stored comment with the exact body',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'lost-response-unapplied: the same client uncertainty, and an empty reconciliation proves nothing more',
    async () => {
      const { real, sim, endpoint, steps } = await lost('unapplied');
      const checks = [
        ...agreeAll(real, sim),
        check(
          'client-uncertain',
          uncertainty(real[0]!) && uncertainty(sim[0]!),
          'The client sees the same uncertainty whether or not the write applied',
        ),
        check(
          'endpoint-unapplied',
          mutations(endpoint).every((r) => (r as any).applied === false) &&
            Object.keys(endpoint.state.comments).length === 0,
          'The endpoint applied nothing; that knowledge stays on the endpoint side',
        ),
        check(
          'empty-reconciliation',
          (json(real[1]!)?.data ?? []).length === 0 &&
            (json(sim[1]!)?.data ?? []).length === 0,
          'Reconciliation is empty on both legs; it does not become a definite rejection',
        ),
        ...boundary(endpoint, real),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    T,
  );

  it(
    'confinement: only the fixture origin, with an allowlisted environment and no inherited selectors',
    async () => {
      let sentinelHits = 0;
      const sentinel = createServer((_q, res) => {
        sentinelHits += 1;
        res.end('{}');
      });
      await new Promise<void>((done) => sentinel.listen(0, '127.0.0.1', done));
      const sentinelOrigin = `http://127.0.0.1:${(sentinel.address() as { port: number }).port}`;
      const saved = { ...process.env };
      Object.assign(process.env, {
        DROPSH_CONFIG: '/sentinel/dropsh.config.js',
        BB_CONFIG: '/sentinel/bakers.config.js',
        BB_CONNECTION: 'sentinel',
        DROPSH_AUTH_PROFILE: 'sentinel',
        NODE_OPTIONS: '--require /sentinel/inject.cjs',
        BB_CONSUMER_SECRET_CW: 'sentinel-secret',
      });
      try {
        const simulation = (await loadFixture('transition-ticket-calls'))
          .simulation;
        const redirected = (await startEndpoint(
          endpointSeed(simulation, { redirect: `${sentinelOrigin}/escape` }),
        )) as Endpoint;
        const redirect = await runCli([...G, 'read', ticket], {
          origin: redirected.origin,
        });
        await redirected.close();
        const endpoint = (await startEndpoint(
          endpointSeed(simulation),
        )) as Endpoint;
        const inherited = await runCli([...G, 'read', ticket], {
          origin: endpoint.origin,
        });
        const unknownRoute = await runCli(
          [...G, 'search', 'bb_widget', '--bundle', 'bb_widget'],
          { origin: endpoint.origin },
        );
        await endpoint.close();
        const environment = contractEnvironment('/root', endpoint.origin);
        const checks = [
          check(
            'redirect-blocked',
            redirect.exit_code === 98 &&
              /ORIGIN_BOUNDARY/.test(redirect.stderr) &&
              sentinelHits === 0,
            'A redirect to another origin is refused before connecting',
          ),
          check(
            'environment-allowlist',
            same(Object.keys(environment).sort(), [
              'BB_CONTRACT_ALLOWED_ORIGIN',
              'HOME',
              'LANG',
              'NO_COLOR',
              'TMPDIR',
            ]),
            'The CLI receives only allowlisted variables',
          ),
          check(
            'inherited-selectors-ignored',
            inherited.exit_code === 0 &&
              json(inherited)?.data?.id === ticketId &&
              !/sentinel/.test(inherited.stderr),
            'Inherited selectors, credentials and runtime injection have no effect',
          ),
        ];
        expect(failing(checks)).toEqual([]);
        // Negative control: an unmodeled route is recorded and fails the boundary check.
        expect(unknownRoute.exit_code).toBe(5);
        expect(failing(boundary(endpoint, [unknownRoute]))).toEqual([
          'known-routes',
        ]);
      } finally {
        process.env = saved;
        await new Promise<void>((done) => sentinel.close(() => done()));
      }
    },
    T,
  );

  it('drift-negative-controls: each deliberate disagreement fails its own named check', () => {
    const ok = (stdout: unknown): Result => ({
      exit_code: 0,
      stdout: `${JSON.stringify(stdout)}\n`,
      stderr: '',
    });
    const fail = (
      code: string,
      status: number | undefined,
      exit: number,
    ): Result => ({
      exit_code: exit,
      stdout: '',
      stderr: `${JSON.stringify({ error: { code, message: 'm', details: status === undefined ? {} : { status } } })}\n`,
    });
    const comment = (value: string, id = ticketId, many = false) => ({
      data: {
        type: 'bb_comment--bb_comment',
        id: firstComment,
        attributes: { body: { value, format: 'bb_rich' } },
        relationships: {
          ticket_id: {
            data: many
              ? [{ type: 'bb_ticket--bb_ticket', id }]
              : { type: 'bb_ticket--bb_ticket', id },
          },
        },
      },
    });
    const real = ok(comment('text\n'));
    const ids = (sim: Result, cliResult = real) =>
      failing(agreement('x', cliResult, sim));
    expect(ids(ok(comment('text\n')))).toEqual([]);
    expect(ids(ok(comment('text')))).toEqual(['x:success-output']);
    expect(
      ids(ok(comment('text\n', '99999999-9999-4999-8999-999999999999'))),
    ).toEqual(['x:success-output']);
    expect(ids(ok(comment('text\n', ticketId, true)))).toEqual([
      'x:success-output',
    ]);
    expect(
      ids(
        ok({ data: { ...comment('t').data, attributes: { state: 'review' } } }),
        ok({ data: { ...comment('t').data, attributes: {} } }),
      ),
    ).toEqual(['x:success-output']);
    expect(
      ids(ok(comment('text\n')), fail('E_VALIDATION', undefined, 4)),
    ).toEqual(['x:exit-code', 'x:error-class']);
    expect(
      ids(fail('E_VALIDATION', undefined, 5), fail('E_HTTP', 422, 5)),
    ).toEqual(['x:error-class']);
    expect(ids(fail('E_HTTP', 404, 5), fail('E_HTTP', 422, 5))).toEqual([
      'x:error-class',
    ]);
    expect(
      ids(
        { exit_code: 1, stdout: '', stderr: "error: unknown option '--a'\n" },
        { exit_code: 1, stdout: '', stderr: "error: unknown option '--b'\n" },
      ),
    ).toEqual(['x:error-class']);
  });

  it(
    'stable-repeat-and-replay: repeated runs agree and simulator traces grade like CLI calls',
    async () => {
      const fixture = await loadFixture('publish-comment-calls');
      const body = fixture.simulation.files['/fixture/comment.md'];
      const steps = [
        [...G, 'create', 'bb_comment', '--bundle', 'bb_comment', '--fields'],
        [
          ...G,
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          `--body.value=${body}`,
          '--body.format',
          'bb_rich',
          '--bb_comment_type',
          'coding',
          '--ticket_id',
          ticketId,
        ],
        [...G, 'read', `bb_comment/bb_comment/${firstComment}`],
      ];
      const verdicts = async () => {
        const { real, sim, endpoint } = await pair(fixture.simulation, steps);
        return {
          checks: [...agreeAll(real, sim), ...boundary(endpoint, real)].map(
            (c) => [c.id, c.met],
          ),
          real,
          sim,
        };
      };
      const first = await verdicts();
      const second = await verdicts();
      expect(second.checks).toEqual(first.checks);
      expect(second.real).toEqual(first.real);
      expect(
        failing(
          first.checks.map(([id, met]) => ({
            id: id as string,
            met: met as boolean,
          })),
        ),
      ).toEqual([]);
      // The simulator's text output satisfies the same publication profile as a model trace would.
      const { loadProfile } = await import(
        '../../../../tests/skill-eval/fixtures.mjs'
      );
      const profile = await loadProfile(fixture);
      const trace = [
        {
          tool: 'read_file',
          arguments: { path: fixture.input.body_file },
          result: { exit_code: 0, stdout: body, stderr: '' },
        },
        ...steps.map((argv, i) => ({
          tool: 'bakers',
          arguments: { argv },
          result: first.sim[i],
        })),
      ];
      expect(
        failing(
          profile.checkOutput(fixture, 'Published', { tool_trace: trace }),
        ),
      ).toEqual([]);
    },
    T,
  );
});
