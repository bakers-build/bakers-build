// Real-CLI contract: the same literal argv runs through the checked-out bakers.build CLI
// (`bakers tools`, against a disposable loopback MCP fixture serving the shared bakers tool
// definitions) and through the skill tool simulator. A disagreement, a wrong payload or an escaped
// request fails a named check. No model, shell or tracker is involved.
import { readFileSync } from 'node:fs';
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
  raw: string;
  json?: { method?: string; params?: { name?: string; arguments?: any } };
  status?: number | string;
  tool?: string;
  authorization?: boolean;
  applied?: boolean;
};
type Endpoint = Awaited<ReturnType<typeof startEndpoint>> & {
  requests: Request[];
  unknown: Request[];
  calls: () => Request[];
};
type Simulation = Record<string, any>;

const ticketId = '11111111-1111-4111-8111-111111111111';
const T = ['bakers', 'tools'];
const MS = 120000;
const wire = (id: string) => `tool_api__${id}`;
const WRITES = [
  'bakers_ticket_create',
  'bakers_ticket_transition',
  'bakers_comment_publish',
  'bakers_metric_write',
  'bakers_time_propose',
  'bakers_run_cancel',
].map(wire);
const failing = (checks: { id: string; met: boolean }[]) =>
  checks.filter((c) => !c.met).map((c) => c.id);

/** Tool calls as argv: each call's arguments go to a runner-owned JSON file, passed as --data @file. */
function script() {
  const files: Record<string, string> = {};
  const call = (id: string, args: unknown) => {
    const path = `/contract/args-${Object.keys(files).length}.json`;
    files[path] = JSON.stringify(args);
    return [...T, wire(id), '--data', `@${path}`];
  };
  return { files, call };
}

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
  base: Simulation,
  steps: string[][],
  files: Record<string, string> = {},
  faults: Record<string, unknown> = {},
) {
  const simulation = { ...base, files: { ...base.files, ...files } };
  const endpoint = (await startEndpoint(
    endpointSeed(simulation, faults),
  )) as Endpoint;
  try {
    const real: Result[] = [];
    for (const argv of steps)
      real.push(
        await runCli(argv, {
          origin: endpoint.origin,
          files: simulation.files,
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

// Normalization allowlist: JSON object key order only. Text values, IDs, absent fields and
// failure classes are compared as observed.
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
      'Successful stdout agrees: JSON results by value, other text exactly',
    ),
    check(
      `${step}:error-class`,
      ok ||
        (error(real)
          ? error(real)?.code === error(sim)?.code &&
            error(real)?.details?.status === error(sim)?.details?.status
          : commanderText(real) === commanderText(sim)),
      'Failures agree on the error code and HTTP status, or on the exact parser message',
    ),
  ];
}
const agreeAll = (real: Result[], sim: Result[], label = 'step') =>
  real.flatMap((r, i) => agreement(`${label}-${i}`, r, sim[i] as Result));
/** Named surface checks of one call: the tool exists and its arguments match its schema. */
export const surface = (step: string, r: Result) => [
  check(
    `${step}:tool-known`,
    !(r.exit_code === 4 && /^unknown tool /.test(error(r)?.message ?? '')),
    'The called tool is one the shared fixture serves',
  ),
  check(
    `${step}:arguments-valid`,
    !(
      r.exit_code === 4 &&
      /^payload does not match schema/.test(error(r)?.message ?? '')
    ),
    'The arguments satisfy the tool input schema',
  ),
];
/** The tools/call requests that reached the endpoint, optionally of one tool. */
const sent = (endpoint: Endpoint, id?: string) =>
  endpoint.calls().filter((r) => !id || r.tool === wire(id));
const mutations = (endpoint: Endpoint) =>
  endpoint.calls().filter((r) => WRITES.includes(r.tool as string));
const boundary = (endpoint: Endpoint) => [
  check(
    'known-routes',
    endpoint.unknown.length === 0,
    'Every CLI request hit the modeled MCP route and methods; no JSON:API request',
  ),
  check(
    'fixture-credential-only',
    endpoint.requests.every((r) => r.authorization),
    'Only the disposable fixture credential was sent',
  ),
];

let identity: ReturnType<typeof cliIdentity>;
beforeAll(() => {
  identity = cliIdentity();
  // The tested implementation, recorded with every run.
  console.info(JSON.stringify({ cli_contract_identity: identity }));
});

describe('skill CLI contract: real repository CLI vs simulator', () => {
  it(
    'public tools alias preserves discovery, JSON files, validation and uncertain writes',
    async () => {
      const base = (await loadFixture('publish-comment-uncertain')).simulation;
      const endpoint = await startEndpoint(
        endpointSeed(base, { lostResponse: 'applied' }),
      );
      const body = "# Exact Markdown\n\n`literal` — 'quoted'\n\n";
      const files = {
        '/alias.json': JSON.stringify({
          ticket: ticketId,
          type: 'coding',
          body,
        }),
      };
      const options = { origin: endpoint.origin, files };
      try {
        for (const args of [
          [],
          [wire('bakers_ticket_read'), '--schema'],
          [
            wire('bakers_ticket_read'),
            '--data',
            JSON.stringify({ ticket: ticketId }),
          ],
        ]) {
          const alias = await runCli(['bakers', 'tools', ...args], options);
          const legacy = await runCli([...T, ...args], options);
          expect(alias).toEqual(legacy);
          expect(alias.exit_code).toBe(0);
        }
        const invalid = await runCli(
          ['bakers', 'tools', wire('bakers_comment_publish'), '--data', '{}'],
          options,
        );
        expect(invalid.exit_code).toBe(4);
        const result = await runCli(
          [
            'bakers',
            'tools',
            wire('bakers_comment_publish'),
            '--data',
            '@/alias.json',
          ],
          options,
        );
        expect(result.exit_code).toBe(5);
        expect(
          endpoint
            .calls()
            .filter((r: Request) => r.tool === wire('bakers_comment_publish')),
        ).toHaveLength(1);
        const readback = await runCli(
          [
            'bakers',
            'tools',
            wire('bakers_ticket_read'),
            '--data',
            JSON.stringify({ ticket: ticketId }),
          ],
          options,
        );
        expect(json(readback).comments.at(-1).body).toBe(body);
        expect(endpoint.unknown).toEqual([]);
      } finally {
        await endpoint.close();
      }
    },
    MS,
  );

  it('cli-identity: resolves and records the checked-out launcher, never another installation', () => {
    expect(identity.files.launcher.path).toBe(launcher);
    expect(identity.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(identity.packages.dropsh.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(identity.packages['@dropsh/plugin-tool'].version).toMatch(
      /^\d+\.\d+\.\d+/,
    );
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
    'help-list-schema: advertised syntax exists in the CLI; the tool list and every schema agree exactly',
    async () => {
      const simulation = (await loadFixture('transition-ticket-calls'))
        .simulation;
      const names = contractFixture.tools.map((t: { name: string }) => t.name);
      const steps = [
        ['bakers', '--help'],
        [...T, '--help'],
        T,
        ...names.map((name: string) => [...T, name, '--schema']),
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
        ...agreeAll(real.slice(2), sim.slice(2), 'listing'),
        check(
          'root-commands',
          real[0]!.exit_code === 0 &&
            [...commands(sim[0]!.stdout)].every((c) =>
              commands(real[0]!.stdout).has(c),
            ),
          'Every command the simulator advertises exists in the CLI',
        ),
        check(
          'tool-options',
          real[1]!.exit_code === 0 &&
            [...options(sim[1]!.stdout)].every((o) =>
              options(real[1]!.stdout).has(o),
            ),
          'Every tool option the simulator advertises exists in the CLI',
        ),
        check(
          'all-tools-listed',
          same(
            json(real[2]!)?.map((t: { name: string }) => t.name),
            names,
          ) && names.every((n: string) => n.startsWith('tool_api__bakers_')),
          'The CLI lists exactly the shared tools, under their tool_api__ wire names',
        ),
        check(
          'schemas-served',
          names.every((name: string, i: number) =>
            same(
              json(real[3 + i]!)?.inputSchema,
              contractFixture.tools[i].inputSchema,
            ),
          ),
          'Each --schema shows the shared input schema',
        ),
        check(
          'read-only',
          mutations(endpoint).length === 0,
          'Discovery calls no tool',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'read-and-search: reads by identifier or UUID; two spellings and the probe distinguish hit from empty',
    async () => {
      const hit = (await loadFixture('create-ticket-prior-art')).simulation;
      const { files, call } = script();
      const search = (query: string, project?: string) =>
        call('bakers_ticket_search', {
          query,
          ...(project ? { project } : {}),
        });
      const steps = [
        call('bakers_ticket_read', { ticket: hit.prior_art.identifier }),
        call('bakers_ticket_read', { ticket: hit.prior_art.id }),
        search('invoice'),
        search('invoices'),
        search('ticket'),
        search('INVOICE', contractFixture.project),
        search('invoice', '99999999-9999-4999-8999-999999999999'),
        call('bakers_ticket_read', { ticket: 'EVAL-404' }),
      ];
      const { real, sim, endpoint } = await pair(hit, steps, files);
      const rows = (r: Result) =>
        (json(r)?.tickets ?? []).map(
          (t: { identifier: string }) => t.identifier,
        );
      const checks = [
        ...agreeAll(real, sim),
        check(
          'read-shape',
          same(json(real[0]!), json(real[1]!)) &&
            json(real[0]!)?.id === hit.prior_art.id &&
            json(real[0]!)?.description === hit.prior_art.description &&
            same(json(real[0]!)?.links, hit.prior_art.links) &&
            Array.isArray(json(real[0]!)?.comments),
          'Identifier and UUID read the same ticket with Markdown description, links and comments',
        ),
        check(
          'positive-hit',
          same(rows(real[2]!), [hit.prior_art.identifier]) &&
            same(rows(real[5]!), [hit.prior_art.identifier]),
          'One spelling finds the candidate, case-insensitively, within the project',
        ),
        check(
          'empty-and-probe',
          rows(real[3]!).length === 0 &&
            rows(real[4]!).includes(contractFixture.probe_ticket.identifier),
          'An empty spelling is distinguishable and the known-positive probe returns a row',
        ),
        check(
          'refusals',
          [6, 7].every(
            (i) =>
              real[i]!.exit_code === 1 && error(real[i]!)?.code === 'E_TOOL',
          ),
          'An unknown project or ticket is a tool refusal (exit 1), not an empty result',
        ),
        check(
          'read-only',
          mutations(endpoint).length === 0,
          'Reads and searches call no write tool',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'comment-payload: exact Markdown bytes and the type reach the wire; the result UUID is the confirmation',
    async () => {
      const simulation = (await loadFixture('publish-comment-calls'))
        .simulation;
      // Leading dashes, both quote types, Unicode, backticks, dollar signs, embedded and trailing newlines.
      const body = `${simulation.files['/fixture/comment.md']}'single' and "double" — ✓ \`$(id)\`\n\n`;
      const { files, call } = script();
      const steps = [
        call('bakers_comment_publish', {
          ticket: ticketId,
          type: 'coding',
          body,
        }),
        call('bakers_ticket_read', { ticket: ticketId }),
        call('bakers_comment_publish', {
          ticket: ticketId,
          type: 'coding',
          body: ' \n\t',
        }),
        call('bakers_comment_publish', { ticket: ticketId, body }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const [publish] = sent(endpoint, 'bakers_comment_publish');
      const stored = json(real[1]!)?.comments ?? [];
      const checks = [
        ...agreeAll(real, sim),
        check(
          'raw-body',
          publish?.raw.includes(JSON.stringify(body)) === true,
          'The request bytes carry the exact JSON-encoded Markdown',
        ),
        check(
          'arguments-exact',
          same(publish?.json?.params?.arguments, {
            ticket: ticketId,
            type: 'coding',
            body,
          }),
          'Ticket, comment type and body arrive exactly, including the trailing newlines',
        ),
        check(
          'confirmed-by-result',
          /^[0-9a-f-]{36}$/.test(json(real[0]!)?.id) &&
            json(real[0]!)?.type === 'coding',
          'The publication result returns the new UUID and the stored type',
        ),
        check(
          'readback-identity',
          stored.length === 1 &&
            stored[0].id === json(real[0]!)?.id &&
            stored[0].body === body &&
            stored[0].type === 'coding',
          'The ticket read lists the same UUID with the exact body and type',
        ),
        check(
          'rejected-before-sending',
          [2, 3].every((i) => real[i]!.exit_code === 4) &&
            sent(endpoint, 'bakers_comment_publish').length === 1,
          'A blank body or a missing type is rejected by the schema before any call',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'create-ticket: prior art, create confirmed by its UUID, qualification and summary before routing',
    async () => {
      const fixture = await loadFixture('create-ticket-calls');
      const { input } = fixture;
      const description = fixture.simulation.files[input.description_file];
      const { files, call } = script();
      const create = {
        title: input.title,
        workflow: input.workflow,
        project: input.project_uuid,
        description,
        type: input.ticket_type,
        recipe: input.recipe,
      };
      const steps = [
        call('bakers_ticket_search', { query: 'invoice' }),
        call('bakers_ticket_search', { query: 'invoices' }),
        call('bakers_ticket_search', { query: 'ticket' }),
        call('bakers_ticket_create', create),
        call('bakers_ticket_read', { ticket: 'EVAL-101' }),
        call('bakers_comment_publish', {
          ticket: 'EVAL-101',
          type: 'qualification',
          body: '- test_as: no login needed\n',
        }),
        call('bakers_comment_publish', {
          ticket: 'EVAL-101',
          type: 'summary',
          body: 'Created and qualified.\n',
        }),
        call('bakers_ticket_transition', { ticket: 'EVAL-101', state: 'plan' }),
        call('bakers_ticket_read', { ticket: 'EVAL-101' }),
        call('bakers_ticket_create', {
          ...create,
          project: contractFixture.project_key,
          type: 'epic',
        }),
        call('bakers_ticket_read', { ticket: 'EVAL-102' }),
        call('bakers_ticket_create', { ...create, labels: 'work:docs' }),
      ];
      const { real, sim, endpoint } = await pair(
        fixture.simulation,
        steps,
        files,
      );
      const order = endpoint.calls().map((r) => r.tool);
      const created = json(real[3]!);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'empty-and-probe',
          (json(real[0]!)?.tickets ?? []).length === 0 &&
            (json(real[1]!)?.tickets ?? []).length === 0 &&
            (json(real[2]!)?.tickets ?? []).length > 0,
          'Two empty spellings, proven by the probe',
        ),
        check(
          'create-confirmed',
          /^[0-9a-f-]{36}$/.test(created?.id) &&
            created?.identifier === 'EVAL-101' &&
            created?.state === 'qualification' &&
            same(
              sent(endpoint, 'bakers_ticket_create')[0]?.json?.params
                ?.arguments,
              create,
            ),
          'The create sends the exact arguments and its result names the UUID, identifier and initial state',
        ),
        check(
          'create-readback',
          json(real[4]!)?.id === created?.id &&
            json(real[4]!)?.description === description &&
            json(real[4]!)?.recipe === input.recipe &&
            json(real[4]!)?.type === input.ticket_type,
          'Readback shows the exact description and the recipe and type by name',
        ),
        check(
          'publish-before-route',
          order.indexOf(wire('bakers_ticket_transition')) >
            order.lastIndexOf(wire('bakers_comment_publish')) &&
            json(real[8]!)?.state === 'plan' &&
            same(
              json(real[8]!)?.comments?.map((c: { type: string }) => c.type),
              ['qualification', 'summary'],
            ),
          'Qualification and summary are published, then the ticket routes to plan',
        ),
        check(
          'unknown-term-created',
          json(real[9]!)?.identifier === 'EVAL-102' &&
            json(real[10]!)?.type === 'epic',
          'A type the workspace lacks is created for a caller who may; the project key resolves like the UUID',
        ),
        check(
          'no-label-argument',
          real[11]!.exit_code === 4,
          'Create takes no labels; work:* or method:* cannot ride along',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'transition-shapes: links-only keeps state and links; state, combined and invalid writes',
    async () => {
      const fixture = await loadFixture('transition-ticket-calls');
      const simulation = fixture.simulation;
      const existing = simulation.ticket.links;
      const { files, call } = script();
      const steps = [
        call('bakers_ticket_transition', {
          ticket: ticketId,
          links: fixture.input.links,
        }),
        call('bakers_ticket_read', { ticket: ticketId }),
        call('bakers_ticket_transition', {
          ticket: 'EVAL-20',
          state: 'review',
        }),
        call('bakers_ticket_transition', {
          ticket: ticketId,
          state: 'coding',
          links: [
            ...fixture.input.links,
            { uri: 'https://x.example.invalid/new' },
          ],
        }),
        call('bakers_ticket_transition', {
          ticket: ticketId,
          links: [{ title: 'no uri' }],
        }),
        call('bakers_ticket_transition', { ticket: ticketId }),
        call('bakers_ticket_read', { ticket: ticketId }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const [linksOnly] = sent(endpoint, 'bakers_ticket_transition');
      const all = [...existing, ...fixture.input.links];
      const checks = [
        ...agreeAll(real, sim),
        check(
          'links-only-shape',
          same(linksOnly?.json?.params?.arguments, {
            ticket: ticketId,
            links: fixture.input.links,
          }),
          'A links-only write sends no state, only the links to add',
        ),
        check(
          'links-only-keeps-state',
          json(real[0]!)?.state === 'coding' &&
            same(json(real[0]!)?.links, all) &&
            json(real[1]!)?.state === 'coding' &&
            same(json(real[1]!)?.links, all),
          'The result and readback keep the old state and every existing link',
        ),
        check(
          'state-write',
          json(real[2]!)?.state === 'review' &&
            same(json(real[2]!)?.links, all),
          'A state-only write moves the state and keeps the links',
        ),
        check(
          'repeated-uri-merged',
          same(json(real[3]!)?.links, [
            ...all,
            { uri: 'https://x.example.invalid/new', title: '' },
          ]),
          'A repeated uri is not duplicated; a new one is appended',
        ),
        check(
          'invalid-not-sent',
          real[4]!.exit_code === 4 &&
            real[5]!.exit_code === 1 &&
            error(real[5]!)?.code === 'E_TOOL' &&
            json(real[6]!)?.state === 'coding' &&
            sent(endpoint, 'bakers_ticket_transition').length === 4,
          'A link without uri is rejected before sending; neither state nor links is a refusal; nothing changes',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'refused-transition: a refusal is exit 1 and leaves the state',
    async () => {
      const simulation = (await loadFixture('transition-ticket-rejected'))
        .simulation;
      const { files, call } = script();
      const steps = [
        call('bakers_ticket_transition', { ticket: ticketId, state: 'review' }),
        call('bakers_ticket_read', { ticket: ticketId }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'definite-refusal',
          real[0]!.exit_code === 1 &&
            error(real[0]!)?.code === 'E_TOOL' &&
            /cannot move from coding to review/.test(error(real[0]!)?.message),
          'The tool refusal is E_TOOL, exit 1, naming the refused move',
        ),
        check(
          'state-unchanged',
          json(real[1]!)?.state === 'coding' &&
            json(sim[1]!)?.state === 'coding',
          'Independent readback shows the old state on both legs',
        ),
        check(
          'single-write',
          sent(endpoint, 'bakers_ticket_transition').length === 1,
          'One refused transition, no retry with another state',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'classify: one call sets recipe and type by name, a missing term is created, an empty call is refused',
    async () => {
      const simulation = (await loadFixture('qualify-classify-default'))
        .simulation;
      const { files, call } = script();
      const steps = [
        call('bakers_ticket_classify', {
          ticket: ticketId,
          recipe: 'probe',
          type: 'feature',
        }),
        call('bakers_ticket_read', { ticket: ticketId }),
        call('bakers_ticket_classify', {
          ticket: simulation.ticket.identifier,
          type: 'epic',
        }),
        call('bakers_ticket_classify', { ticket: ticketId }),
        call('bakers_ticket_classify', {
          ticket: ticketId,
          recipe: 'probe',
          labels: 'x',
        }),
        call('bakers_ticket_read', { ticket: ticketId }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'classify-arguments',
          same(
            sent(endpoint, 'bakers_ticket_classify')[0]?.json?.params
              ?.arguments,
            {
              ticket: ticketId,
              recipe: 'probe',
              type: 'feature',
            },
          ) && same(json(real[0]!), { recipe: 'probe', type: 'feature' }),
          'The call sends both names and its result returns the saved names',
        ),
        check(
          'classify-readback',
          json(real[1]!)?.recipe === 'probe' &&
            json(real[1]!)?.type === 'feature',
          'Readback shows the recipe and type by name',
        ),
        check(
          'type-only-keeps-recipe',
          same(json(real[2]!), { recipe: 'probe', type: 'epic' }) &&
            json(real[5]!)?.type === 'epic',
          'A type-only call creates the missing term and keeps the recipe',
        ),
        check(
          'empty-and-invalid',
          real[3]!.exit_code === 1 &&
            /Give a recipe or a type/.test(error(real[3]!)?.message) &&
            real[4]!.exit_code === 4,
          'Neither name is a refusal; an unknown argument never leaves the client',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'update-labels: labels are added and removed by name, absent names ignored, one name in both lists refused',
    async () => {
      const simulation = (await loadFixture('qualify-classify-default'))
        .simulation;
      const { files, call } = script();
      const steps = [
        call('bakers_ticket_update', {
          ticket: ticketId,
          labels_add: ['keep', 'Question', 'other'],
          frozen: true,
        }),
        call('bakers_ticket_update', {
          ticket: ticketId,
          labels_remove: ['Question', 'never-created'],
          frozen: false,
        }),
        call('bakers_ticket_read', { ticket: ticketId }),
        call('bakers_ticket_update', {
          ticket: ticketId,
          labels_add: ['x'],
          labels_remove: ['x'],
        }),
        call('bakers_ticket_update', { ticket: ticketId }),
        call('bakers_ticket_read', { ticket: ticketId }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'remove-arguments',
          same(
            sent(endpoint, 'bakers_ticket_update')[1]?.json?.params?.arguments,
            {
              ticket: ticketId,
              labels_remove: ['Question', 'never-created'],
              frozen: false,
            },
          ),
          'The call sends the names to remove and the freeze flag as given',
        ),
        check(
          'remove-keeps-others',
          same(json(real[0]!)?.labels, ['keep', 'Question', 'other']) &&
            same(json(real[1]!)?.labels, ['keep', 'other']) &&
            json(real[1]!)?.frozen === false &&
            same(json(real[2]!)?.labels, ['keep', 'other']),
          'Removal drops only the named labels, ignores absent ones and keeps the order; readback agrees',
        ),
        check(
          'refusals',
          real[3]!.exit_code === 1 &&
            error(real[3]!)?.message === 'Label x is both added and removed.' &&
            real[4]!.exit_code === 1 &&
            error(real[4]!)?.message ===
              'Give a title, a description, a conductor, labels to add or remove, or frozen.' &&
            same(json(real[5]!)?.labels, ['keep', 'other']),
          'A name in both lists and an empty call are refused; nothing changes',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'metric-write: replaces only its namespace, keeps other rows, returns a unit-less row and adds the label once',
    async () => {
      const simulation = (await loadFixture('transition-ticket-calls'))
        .simulation;
      const { files, call } = script();
      // Rows come from the measurements README's row template, so the skill's format is what is sent.
      const template = readFileSync(
        new URL(
          '../../../../.claude/skills/bakers-build/skills/bb-verdict/measurements/README.md',
          import.meta.url,
        ),
        'utf8',
      ).match(/```json\n(.*)\n```/)![1]!;
      const row = (name: string, value: number, unit: string | null) =>
        JSON.parse(
          template
            .replace('<id>.<value_name>', name)
            .replace('<number>', String(value))
            .replace('<unit|null>', JSON.stringify(unit)),
        );
      const rows = (score: number) => [
        row('review_quality.score', score, 'ratio'),
        row('review_quality.findings', 2, null),
      ];
      const steps = [
        call('bakers_metric_write', {
          ticket: ticketId,
          name: 'cycle',
          rows: [{ name: 'cycle.hours', value: 3, unit: 'hours' }],
        }),
        call('bakers_metric_write', {
          ticket: ticketId,
          name: 'review_quality',
          rows: rows(0.5),
          label: 'retro',
        }),
        call('bakers_metric_write', {
          ticket: ticketId,
          name: 'review_quality',
          rows: rows(0.75),
          label: 'retro',
        }),
        call('bakers_metric_write', {
          ticket: ticketId,
          name: 'review_quality',
          rows: [{ name: 'other.score', value: 1, unit: 'ratio' }],
        }),
        call('bakers_metric_write', {
          ticket: ticketId,
          name: 'Bad-Name',
          rows: rows(1),
        }),
        call('bakers_ticket_read', { ticket: ticketId }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'namespace-replaced',
          same(json(real[2]!)?.metrics, [
            { name: 'cycle.hours', value: 3, unit: 'hours' },
            { name: 'review_quality.score', value: 0.75, unit: 'ratio' },
            { name: 'review_quality.findings', value: 2, unit: null },
          ]),
          'The second write replaces its own rows and keeps the other namespace',
        ),
        check(
          'label-once',
          same(json(real[5]!)?.labels, ['retro']),
          'The label is added once',
        ),
        check(
          'invalid-rows',
          real[3]!.exit_code === 1 && real[4]!.exit_code === 4,
          'A row outside the namespace is refused; a malformed name never leaves the client',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  it(
    'time-and-worklogs: a proposal stores one worklog per entry; a failing entry stores nothing',
    async () => {
      const simulation = (await loadFixture('transition-ticket-calls'))
        .simulation;
      const { files, call } = script();
      const entry = (
        key: string,
        duration_seconds: number,
        work_date = '2026-10-26',
      ) => ({
        source_system: 'git',
        source_key: key,
        source_version: '1',
        work_date,
        description: `Work ${key}`,
        duration_seconds,
      });
      const steps = [
        call('bakers_time_propose', {
          entries: [entry('a', 3600), entry('b', 30)],
        }),
        call('bakers_time_propose', {
          entries: [entry('a', 3600), entry('b', 1800, '2026-10-27')],
          project: contractFixture.project,
        }),
        call('bakers_worklog_list', { from: '2026-10-26', to: '2026-10-26' }),
        call('bakers_worklog_list', {
          from: '2026-10-26',
          to: '2026-10-27',
          limit: 1,
        }),
        call('bakers_worklog_list', { from: '2026-10-27', to: '2026-10-26' }),
        call('bakers_time_propose', { entries: [] }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      const proposal = json(real[1]!);
      const checks = [
        ...agreeAll(real, sim),
        check(
          'failing-entry-stores-nothing',
          real[0]!.exit_code === 1 &&
            /Entry 2 \(b\)/.test(error(real[0]!)?.message),
          'A failing entry is refused by position and source_key',
        ),
        check(
          'proposal',
          /^[0-9a-f-]{36}$/.test(proposal?.submission) &&
            proposal?.worklogs?.length === 2 &&
            same(
              json(real[2]!)?.data?.map((w: { id: string }) => w.id),
              [proposal?.worklogs?.[0]],
            ),
          'One submission, one worklog per entry in order, listed in its date range',
        ),
        check(
          'paging',
          json(real[3]!)?.data?.length === 1 &&
            json(real[3]!)?.next_offset === 1,
          'A page names the next offset',
        ),
        check(
          'invalid-range-and-empty',
          real[4]!.exit_code === 1 && real[5]!.exit_code === 4,
          'A reversed range is refused; no entries never leaves the client',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
  );

  const lost = async (mode: 'applied' | 'unapplied') => {
    const base = (await loadFixture('publish-comment-uncertain')).simulation;
    const body = base.files['/fixture/comment.md'];
    const { files, call } = script();
    const steps = [
      call('bakers_comment_publish', {
        ticket: ticketId,
        type: 'coding',
        body,
      }),
      call('bakers_ticket_read', { ticket: ticketId }),
    ];
    const result = await pair(
      { ...base, uncertain_comment: mode },
      steps,
      files,
      { lostResponse: mode },
    );
    return { ...result, body, steps };
  };
  const uncertainty = (r: Result) =>
    r.exit_code === 5 &&
    error(r)?.code === 'E_HTTP' &&
    error(r)?.details?.status === 0;

  it(
    'lost-response-applied: one write, uncertain to the client, reconciled by a read',
    async () => {
      const { real, sim, endpoint, body, steps } = await lost('applied');
      const comments = (r: Result) => json(r)?.comments ?? [];
      const checks = [
        ...agreeAll(real, sim),
        check(
          'client-uncertain',
          uncertainty(real[0]!) && uncertainty(sim[0]!),
          'A lost response is E_HTTP with status 0, exit 5, not a refusal',
        ),
        check(
          'one-submission-per-write',
          sent(endpoint, 'bakers_comment_publish').length === 1,
          'One publication sends one tools/call; the CLI never retries',
        ),
        check(
          'unique-reconciliation',
          comments(real[1]!).length === 1 &&
            comments(real[1]!)[0]?.body === body,
          'A later read finds exactly the one stored comment with the exact body',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
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
          sent(endpoint, 'bakers_comment_publish').every(
            (r) => r.applied === false,
          ),
          'The endpoint applied nothing; that knowledge stays on the endpoint side',
        ),
        check(
          'empty-reconciliation',
          (json(real[1]!)?.comments ?? []).length === 0 &&
            (json(sim[1]!)?.comments ?? []).length === 0,
          'Reconciliation is empty on both legs; it does not become a definite rejection',
        ),
        ...boundary(endpoint),
      ];
      expect(failing(checks), observed(steps, real, sim)).toEqual([]);
    },
    MS,
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
        const read = [
          ...T,
          wire('bakers_ticket_read'),
          '--data',
          JSON.stringify({ ticket: ticketId }),
        ];
        const redirected = (await startEndpoint(
          endpointSeed(simulation, { redirect: `${sentinelOrigin}/escape` }),
        )) as Endpoint;
        const redirect = await runCli(read, { origin: redirected.origin });
        await redirected.close();
        const endpoint = (await startEndpoint(
          endpointSeed(simulation),
        )) as Endpoint;
        const inherited = await runCli(read, { origin: endpoint.origin });
        // A skill that still shells out to JSON:API leaves the MCP route.
        const jsonapi = await runCli(
          ['bakers', 'dropsh', 'read', `bb_ticket/bb_ticket/${ticketId}`],
          { origin: endpoint.origin },
        );
        await endpoint.close();
        const environment = contractEnvironment('/root', endpoint.origin);
        const checks = [
          check(
            'redirect-blocked',
            redirect.exit_code !== 0 && sentinelHits === 0,
            'A redirect to another origin never reaches it',
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
              json(inherited)?.id === ticketId &&
              !/sentinel/.test(inherited.stderr),
            'Inherited selectors, credentials and runtime injection have no effect',
          ),
        ];
        expect(
          failing(checks),
          JSON.stringify({ redirect, inherited }),
        ).toEqual([]);
        // Negative control: a JSON:API request is an unmodeled route and fails the boundary check.
        expect(jsonapi.exit_code).not.toBe(0);
        expect(failing(boundary(endpoint))).toEqual(['known-routes']);
      } finally {
        process.env = saved;
        await new Promise<void>((done) => sentinel.close(() => done()));
      }
    },
    MS,
  );

  it(
    'drift-negative-controls: an unknown tool, an invalid payload and a disagreement each fail their own check',
    async () => {
      const simulation = (await loadFixture('transition-ticket-calls'))
        .simulation;
      const { files, call } = script();
      const steps = [
        call('bakers_ticket_read', { ticket: ticketId }),
        // A tool the server does not list.
        [
          ...T,
          'bakers_ticket_frobnicate',
          '--data',
          JSON.stringify({ ticket: ticketId }),
        ],
        call('bakers_ticket_read', { ticket: ticketId, extra: true }),
      ];
      const { real, sim, endpoint } = await pair(simulation, steps, files);
      expect(failing(agreeAll(real, sim)), observed(steps, real, sim)).toEqual(
        [],
      );
      expect(failing(real.flatMap((r, i) => surface(`step-${i}`, r)))).toEqual([
        'step-1:tool-known',
        'step-2:arguments-valid',
      ]);
      expect(sent(endpoint)).toHaveLength(1);

      const ok = (stdout: unknown): Result => ({
        exit_code: 0,
        stdout: `${JSON.stringify(stdout, null, 2)}\n`,
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
      const comment = (body: string, type = 'coding') => ({
        comments: [{ id: '22222222-2222-4222-8222-000000000001', type, body }],
      });
      const realResult = ok(comment('text\n'));
      const ids = (simResult: Result, cliResult = realResult) =>
        failing(agreement('x', cliResult, simResult));
      expect(ids(ok(comment('text\n')))).toEqual([]);
      expect(ids(ok(comment('text')))).toEqual(['x:success-output']);
      expect(ids(ok(comment('text\n', 'summary')))).toEqual([
        'x:success-output',
      ]);
      expect(
        ids(
          ok({ state: 'review', links: [] }),
          ok({ state: 'review', links: [{ uri: 'u', title: '' }] }),
        ),
      ).toEqual(['x:success-output']);
      expect(
        ids(ok(comment('text\n')), fail('E_VALIDATION', undefined, 4)),
      ).toEqual(['x:exit-code', 'x:error-class']);
      expect(
        ids(fail('E_TOOL', undefined, 1), fail('E_VALIDATION', undefined, 1)),
      ).toEqual(['x:error-class']);
      expect(ids(fail('E_HTTP', 0, 5), fail('E_HTTP', 404, 5))).toEqual([
        'x:error-class',
      ]);
      expect(
        ids(
          { exit_code: 1, stdout: '', stderr: "error: unknown option '--a'\n" },
          { exit_code: 1, stdout: '', stderr: "error: unknown option '--b'\n" },
        ),
      ).toEqual(['x:error-class']);
    },
    MS,
  );

  it(
    'stable-repeat-and-replay: repeated runs agree and simulator traces grade like CLI calls',
    async () => {
      const fixture = await loadFixture('publish-comment-calls');
      const body = fixture.simulation.files['/fixture/comment.md'];
      const { files, call } = script();
      const steps = [
        call('bakers_ticket_read', { ticket: ticketId }),
        call('bakers_comment_publish', {
          ticket: ticketId,
          type: 'coding',
          body,
        }),
      ];
      const verdicts = async () => {
        const { real, sim, endpoint } = await pair(
          fixture.simulation,
          steps,
          files,
        );
        return {
          checks: [...agreeAll(real, sim), ...boundary(endpoint)].map((c) => [
            c.id,
            c.met,
          ]),
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
      // The simulator's output satisfies the same publication profile as a model trace would,
      // with the arguments file written through the simulator's write_file.
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
        ...Object.entries(files).map(([path, content]) => ({
          tool: 'write_file',
          arguments: { path, content },
          result: { exit_code: 0, stdout: '', stderr: '' },
        })),
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
    MS,
  );
});
