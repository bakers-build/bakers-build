import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readAttempt,
  sha256,
} from '../../../../tests/skill-eval/artifacts.mjs';
import {
  calls,
  commonChecks,
} from '../../../../tests/skill-eval/call-utils.mjs';
import { runSimulator } from '../../../../tests/skill-eval/cli-contract.mjs';
import {
  loadFixture,
  loadProfile,
} from '../../../../tests/skill-eval/fixtures.mjs';
import { savedAttempt } from './skill-eval-helpers.js';

const root = new URL('../../../../tests/skill-eval/', import.meta.url);
const ticketId = '11111111-1111-4111-8111-111111111111';
const commentId = '22222222-2222-4222-8222-000000000001';
const argsFile = '/tmp/comment-args.json';
type Row = {
  tool: string;
  arguments: Record<string, any>;
  result: { stdout: unknown; exit_code: number; stderr: string };
};
const result = (stdout: unknown, exit_code = 0, stderr = '') => ({
  stdout:
    typeof stdout === 'string' || stdout === null
      ? stdout
      : `${JSON.stringify(stdout, null, 2)}\n`,
  exit_code,
  stderr,
});
const error = (code: string, details: Record<string, unknown> = {}) =>
  `${JSON.stringify({ error: { code, message: code, details } })}\n`;
const rejected = (exit: number, code: string, details = {}) =>
  result('', exit, error(code, details));
const lostResult = () => rejected(5, 'E_HTTP', { status: 0 });
const bakers = (
  argv: string[],
  stdout: unknown,
  exit_code = 0,
  stderr = '',
): Row => ({
  tool: 'bakers',
  arguments: { argv: ['bakers', ...argv] },
  result: result(stdout, exit_code, stderr),
});
/** `bakers tools tool_api__<id> --data <inline JSON>`. */
const call = (
  id: string,
  args: unknown,
  stdout: unknown,
  exit_code = 0,
  stderr = '',
) =>
  bakers(
    ['tools', `tool_api__${id}`, '--data', JSON.stringify(args)],
    stdout,
    exit_code,
    stderr,
  );
const fixtureData = async (id: string) => ({
  fixture: await loadFixture(id),
  profile: await loadProfile(await loadFixture(id)),
});
const failing = (checks: Array<{ id: string; met: boolean }>) =>
  checks.filter((c) => !c.met).map((c) => c.id);

/** Read the body, write the arguments file, publish from it with --data @file. */
async function commentCase() {
  const { fixture, profile } = await fixtureData('publish-comment-calls');
  const body = fixture.simulation.files[fixture.input.body_file];
  const trace: Row[] = [
    {
      tool: 'read_file',
      arguments: { path: fixture.input.body_file },
      result: result(body),
    },
    {
      tool: 'write_file',
      arguments: {
        path: argsFile,
        content: JSON.stringify({ ticket: ticketId, type: 'coding', body }),
      },
      result: result(''),
    },
    bakers(
      ['tools', 'tool_api__bakers_comment_publish', '--data', `@${argsFile}`],
      {
        id: commentId,
        type: 'coding',
      },
    ),
  ];
  return { fixture, profile, trace, body };
}

async function transitionCase(id = 'transition-ticket-calls') {
  const { fixture, profile } = await fixtureData(id);
  const { ticket } = fixture.simulation;
  const links = [...ticket.links, ...fixture.input.links];
  const state = fixture.input.destination ?? ticket.state;
  const trace = [
    call(
      'bakers_ticket_read',
      { ticket: ticketId },
      { id: ticketId, state: ticket.state, links: ticket.links },
    ),
    call(
      'bakers_ticket_transition',
      {
        ticket: ticketId,
        ...(fixture.input.destination
          ? { state: fixture.input.destination }
          : {}),
        links: fixture.input.links,
      },
      { state, links },
    ),
    call(
      'bakers_ticket_read',
      { ticket: ticketId },
      { id: ticketId, state, links },
    ),
  ];
  return { fixture, profile, trace };
}

describe('skill call contracts', () => {
  it('recognizes tools with connection selectors before and after the command', () => {
    const trace = calls({
      tool_trace: [
        {
          tool: 'bakers',
          arguments: {
            argv: [
              'bakers',
              '--connection',
              'work',
              'tools',
              '--auth-profile=worker',
              'tool_api__bakers_ticket_read',
              '--data',
              JSON.stringify({ ticket: ticketId }),
            ],
          },
          result: result({ id: ticketId }),
        },
      ],
    });
    expect(trace[0]).toMatchObject({
      mode: 'call',
      name: 'tool_api__bakers_ticket_read',
      args: { ticket: ticketId },
    });
    expect(failing(commonChecks(trace))).toEqual([]);
  });
  it('confirms a comment from its result and never repeats a timed-out publication', async () => {
    const { fixture, profile, trace } = await commentCase();
    const grade = (rows: unknown[], f = fixture) =>
      failing(profile.checkOutput(f, 'Success', { tool_trace: rows }));
    expect(grade(trace)).toEqual([]);
    const retired = structuredClone(trace);
    retired[2]!.arguments.argv = [
      'bakers',
      'dropsh',
      'tool',
      ...retired[2]!.arguments.argv.slice(2),
    ];
    expect(grade(retired)).toContain('validated-call-surface');
    const refused = structuredClone(trace);
    refused[2]!.result = rejected(1, 'E_TOOL');
    expect(grade(refused)).toEqual(
      expect.arrayContaining(['tool-results', 'comment-confirmed']),
    );
    // A skill still shelling out to JSON:API is outside the contract.
    const jsonapi = structuredClone(trace);
    jsonapi[2] = bakers(
      [
        'create',
        'bb_comment',
        '--bundle',
        'bb_comment',
        '--data',
        `@${argsFile}`,
      ],
      { data: { id: commentId } },
    );
    expect(grade(jsonapi)).toEqual(
      expect.arrayContaining(['validated-call-surface', 'comment-write']),
    );
    const trimmed = structuredClone(trace);
    trimmed[1]!.arguments.content = JSON.stringify({
      ticket: ticketId,
      type: 'coding',
      body: 'changed',
    });
    expect(grade(trimmed)).toContain('comment-write');
    const retyped = structuredClone(trace);
    retyped[1]!.arguments.content = retyped[1]!.arguments.content.replace(
      '"coding"',
      '"summary"',
    );
    expect(grade(retyped)).toContain('comment-write');
    expect(grade([...trace, trace[2]])).toContain('comment-write');
    const uncertain = await loadFixture('publish-comment-uncertain');
    const lost = structuredClone(trace);
    lost[2]!.result = lostResult();
    expect(grade(lost, uncertain)).toEqual([]);
    expect(grade([...lost, trace[2]], uncertain)).toContain(
      'uncertain-write-not-repeated',
    );
  });
  it('passes one call rejected before sending, a schema lookup and a successful retry with a call-quality warning', async () => {
    const { fixture, profile, trace, body } = await commentCase();
    const invalid = call(
      'bakers_comment_publish',
      { ticket: ticketId, body },
      '',
      4,
      error('E_VALIDATION'),
    );
    const schema = bakers(
      ['tools', 'tool_api__bakers_comment_publish', '--schema'],
      { name: 'x' },
    );
    const recovered = [...trace.slice(0, 2), invalid, schema, trace[2]];
    const grade = (rows: unknown[]) =>
      failing(profile.checkOutput(fixture, 'Published', { tool_trace: rows }));
    const diagnose = (rows: unknown[]) =>
      profile.diagnose(fixture, 'Published', { tool_trace: rows });
    expect(grade(recovered)).toEqual([]);
    expect(diagnose(recovered)).toEqual([
      expect.objectContaining({
        category: 'call-recovery',
        severity: 'warning',
        calls: [2, 3, 4],
      }),
    ]);
    expect(diagnose(trace)).toEqual([]);
    // Each row below names the rule a recovery may not absorb.
    const repeated = [...trace.slice(0, 2), invalid, invalid, trace[2]];
    expect(grade(repeated)).toContain('tool-results');
    expect(diagnose(repeated)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'call-recovery',
          severity: 'failure',
        }),
      ]),
    );
    expect(grade([...trace.slice(0, 2), invalid])).toContain('tool-results');
    const refusedAfter = structuredClone(recovered);
    refusedAfter[4]!.result = rejected(1, 'E_TOOL');
    expect(grade(refusedAfter)).toContain('tool-results');
  });
  it('fails a timed-out publication whose body lost one trailing newline', async () => {
    const { profile, trace } = await commentCase();
    const uncertain = await loadFixture('publish-comment-uncertain');
    const body = uncertain.simulation.files[uncertain.input.body_file];
    const lost = structuredClone(trace);
    lost[1]!.arguments.content = JSON.stringify({
      ticket: ticketId,
      type: 'coding',
      body: body.slice(0, -1),
    });
    lost[2]!.result = lostResult();
    const failed = failing(
      profile.checkOutput(uncertain, 'Unresolved', { tool_trace: lost }),
    );
    expect(failed).toContain('comment-write');
    expect(failed).not.toContain('uncertain-write-not-repeated');
    expect(
      profile.diagnose(uncertain, 'Unresolved', { tool_trace: lost }),
    ).toEqual([
      expect.objectContaining({
        category: 'uncertain-write',
        severity: 'info',
        calls: [2],
      }),
    ]);
  });
  it('checks added links, explicit state, links-only behavior and no alternate state after a refusal', async () => {
    const { fixture, profile, trace } = await transitionCase();
    const grade = (rows: unknown[]) =>
      failing(
        profile.checkOutput(fixture, 'Transitioned', { tool_trace: rows }),
      );
    expect(grade(trace)).toEqual([]);
    const omitted = structuredClone(trace);
    omitted[1] = call(
      'bakers_ticket_transition',
      { ticket: ticketId, state: 'review' },
      omitted[1]!.result.stdout,
    );
    expect(grade(omitted)).toContain('additive-links');
    expect(grade(trace.slice(0, -1))).toContain('transition-readback');
    const linksOnly = await transitionCase('transition-ticket-links-only');
    expect(
      failing(
        profile.checkOutput(linksOnly.fixture, 'Linked', {
          tool_trace: linksOnly.trace,
        }),
      ),
    ).toEqual([]);
    const withState = structuredClone(linksOnly.trace);
    withState[1] = call(
      'bakers_ticket_transition',
      {
        ticket: ticketId,
        state: 'review',
        links: linksOnly.fixture.input.links,
      },
      withState[1]!.result.stdout,
    );
    expect(
      failing(
        profile.checkOutput(linksOnly.fixture, 'Linked', {
          tool_trace: withState,
        }),
      ),
    ).toContain('single-authorized-update');
    const refusal = await loadFixture('transition-ticket-rejected');
    const blocked = structuredClone(trace.slice(0, 2));
    blocked[1]!.result = rejected(1, 'E_TOOL');
    expect(
      failing(profile.checkOutput(refusal, 'Refused', { tool_trace: blocked })),
    ).toEqual([]);
    expect(
      profile.diagnose(refusal, 'Refused', { tool_trace: blocked }),
    ).toEqual([
      expect.objectContaining({
        category: 'expected-error',
        severity: 'info',
        calls: [1],
      }),
    ]);
    expect(
      profile.diagnose(fixture, 'Transitioned', { tool_trace: trace }),
    ).toEqual([]);
    expect(
      failing(
        profile.checkOutput(refusal, 'Retried', {
          tool_trace: [
            ...blocked,
            call(
              'bakers_ticket_transition',
              { ticket: ticketId, state: 'done', links: refusal.input.links },
              trace[1]!.result.stdout,
            ),
          ],
        }),
      ),
    ).toContain('single-authorized-update');
  });
  it('replays a recovered call as passed with a warning, measured effort and unchanged attempt bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-call-quality-'));
    try {
      const { fixture, trace, body } = await commentCase();
      const recovered = [
        ...trace.slice(0, 2),
        call(
          'bakers_comment_publish',
          { ticket: ticketId, body },
          '',
          4,
          error('E_VALIDATION'),
        ),
        bakers(['tools', 'tool_api__bakers_comment_publish', '--schema'], {
          name: 'x',
        }),
        trace[2],
      ];
      const path = join(dir, 'attempt.json');
      const attempt = savedAttempt(fixture, 'Published', recovered);
      attempt.generation.worker.cost_usd = 0;
      await writeFile(path, JSON.stringify(attempt));
      const before = await readFile(path, 'utf8');
      const replay = async (name: string) => {
        const command = spawnSync(
          process.execPath,
          [
            '--require',
            new URL('offline-guard.cjs', root).pathname,
            new URL('run.mjs', root).pathname,
            'replay',
            '--input',
            path,
            '--output',
            join(dir, name),
          ],
          { encoding: 'utf8', timeout: 60000 },
        );
        expect(command.status, command.stderr).toBe(0);
        expect(command.stdout).toContain('1 call-quality warning');
        return JSON.parse(await readFile(join(dir, name), 'utf8'));
      };
      const first = await replay('first.json');
      const second = await replay('second.json');
      expect(await readFile(path, 'utf8')).toBe(before);
      expect(first.status).toBe('passed');
      expect(first.attempt_sha256).toBe(sha256(before));
      expect(first.call_quality).toEqual({
        status: 'warning',
        diagnostics: [
          expect.objectContaining({ severity: 'warning', calls: [2, 3, 4] }),
        ],
      });
      expect(second.call_quality).toEqual(first.call_quality);
      expect(second.checks).toEqual(first.checks);
      expect(first.effort.tool_calls).toEqual({
        total: 5,
        bakers: 3,
        read_file: 1,
        failed: 1,
      });
      expect(first.effort.recovery).toEqual({ attempted: 1, verified: 1 });
      expect(first.effort.generation.cost_usd).toEqual({
        value: 0,
        unit: 'USD',
        source: 'original generation worker',
      });
      expect(first.effort.generation.elapsed_ms).toEqual({
        value: null,
        unit: 'ms',
        unavailable: 'Not recorded by this attempt',
      });
      expect(first.effort.generation.model_turns.value).toBeNull();
      expect(first.effort.evaluation.model_calls).toBe(0);
      expect(first.effort.evaluation.elapsed_ms).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
  it.each([
    { name: 'publication', create: commentCase },
    { name: 'transition', create: transitionCase },
  ])('replays $name calls offline and rejects corrupt or unattributed trace changes', async ({
    create,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-call-replay-'));
    try {
      const specimen = await create();
      const path = join(dir, `${specimen.fixture.id}.json`);
      const attempt = savedAttempt(
        specimen.fixture,
        'Fixture response',
        specimen.trace,
      );
      await writeFile(path, JSON.stringify(attempt));
      const command = spawnSync(
        process.execPath,
        [
          '--require',
          new URL('offline-guard.cjs', root).pathname,
          new URL('run.mjs', root).pathname,
          'replay',
          '--input',
          path,
          '--output',
          `${path}.result.json`,
        ],
        { encoding: 'utf8', timeout: 60000 },
      );
      expect(command.status, command.stderr).toBe(0);
      expect(
        JSON.parse(await readFile(`${path}.result.json`, 'utf8')).model_calls,
      ).toBe(0);
      // The third call is mandatory in every case: the create, a prior-art search or the write.
      attempt.tool_trace?.splice(2, 1);
      await writeFile(path, JSON.stringify(attempt));
      await expect(readAttempt(path)).rejects.toThrow('corrupted');
      attempt.tool_trace_sha256 = sha256(JSON.stringify(attempt.tool_trace));
      await writeFile(path, JSON.stringify(attempt));
      await expect(readAttempt(path)).rejects.toThrow('negative_control');
      await writeFile(
        path,
        JSON.stringify({
          ...attempt,
          negative_control: {
            reason: 'Remove the third call',
            parent_tool_trace_sha256: attempt.generation.tool_trace_sha256,
          },
        }),
      );
      await expect(readAttempt(path)).resolves.toHaveProperty('attempt');
      const negative = spawnSync(
        process.execPath,
        [
          '--require',
          new URL('offline-guard.cjs', root).pathname,
          new URL('run.mjs', root).pathname,
          'replay',
          '--input',
          path,
          '--output',
          `${path}.negative.json`,
        ],
        { encoding: 'utf8', timeout: 60000 },
      );
      expect(negative.status, negative.stderr).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('recipe and type on ticket creation', () => {
  // The calls a created-and-qualified ticket makes, run through the simulator so the graded
  // results (stored terms, comments, routed state) are the simulator's, not hand-written.
  async function creationTrace(
    createArgs: Record<string, unknown>,
    destination = 'plan',
  ) {
    const { fixture, profile } = await fixtureData('create-ticket-calls');
    const qualification = [
      `- ${fixture.input.acceptance_criterion}`,
      ...[
        'test_as',
        'out_of_scope',
        'handoff_version',
        'provenance',
        'reproduction',
        'scenario_required',
      ].map((field) => `- ${field}: recorded`),
    ].join('\n');
    const created = 'EVAL-101';
    const steps: Array<[string, unknown]> = [
      ['bakers_ticket_search', { query: 'invoice' }],
      ['bakers_ticket_search', { query: 'invoices' }],
      ['bakers_ticket_search', { query: 'ticket' }],
      [
        'bakers_ticket_create',
        {
          title: fixture.input.title,
          workflow: 'bb_work',
          project: fixture.input.project_uuid,
          description: fixture.simulation.files[fixture.input.description_file],
          ...createArgs,
        },
      ],
      ['bakers_ticket_read', { ticket: created }],
      [
        'bakers_comment_publish',
        { ticket: created, type: 'qualification', body: qualification },
      ],
      [
        'bakers_comment_publish',
        { ticket: created, type: 'summary', body: 'Created and qualified.' },
      ],
      ['bakers_ticket_transition', { ticket: created, state: destination }],
      ['bakers_ticket_read', { ticket: created }],
    ];
    const argvs = steps.map(([id, args]) => [
      'bakers',
      'tools',
      `tool_api__${id}`,
      '--data',
      JSON.stringify(args),
    ]);
    const results = await runSimulator(
      fixture.simulation,
      argvs.map((argv) => ({ name: 'bakers', arguments: { argv } })),
    );
    const trace = argvs.map((argv, i) => ({
      tool: 'bakers',
      arguments: { argv },
      result: results[i],
    }));
    const grade = (rows: unknown[]) =>
      failing(profile.checkOutput(fixture, 'Created', { tool_trace: rows }));
    return { grade, trace };
  }
  const named = [
    'prior-art-search',
    'ticket-create',
    'ticket-readback',
    'qualification-and-summary',
    'single-initial-route',
  ];

  it('writes recipe and type by name, publishes before routing and routes to plan', async () => {
    const { grade, trace } = await creationTrace({
      recipe: 'matt',
      type: 'feature',
    });
    expect(grade(trace)).toEqual([]);
    expect(grade(trace.filter((_, i) => i !== 2))).toEqual([
      'prior-art-search',
    ]);
    // Routing before the summary is published fails the publication order.
    expect(grade([...trace.slice(0, 6), trace[7], trace[6], trace[8]])).toEqual(
      expect.arrayContaining(['qualification-and-summary']),
    );
  });

  it('rejects labels in place of the recipe and type', async () => {
    const { grade, trace } = await creationTrace({
      labels: 'work:docs,method:matt',
    });
    expect(grade(trace)).toEqual(
      expect.arrayContaining(['ticket-create', 'ticket-readback']),
    );
  });

  it('rejects routing to a retired state', async () => {
    const { grade, trace } = await creationTrace(
      { recipe: 'matt', type: 'feature' },
      'spec',
    );
    expect(grade(trace).filter((id) => named.includes(id))).toEqual([
      'single-initial-route',
    ]);
  });
});

describe('remote base call evidence', () => {
  it('rejects omitted Git operations, local refs, missing probe and early merge', async () => {
    const { fixture, profile } = await fixtureData(
      'merge-prior-art-base-negative',
    );
    const declared = fixture.simulation.commands;
    const row = (tool: string, c: { argv: string[]; result: unknown }) => ({
      tool,
      arguments: { argv: c.argv },
      result: c.result,
    });
    const trace = [
      ...declared.git.slice(0, 5).map((c: never) => row('git', c)),
      ...declared.glab.map((c: never) => row('glab', c)),
    ];
    const output = `merged; negative; origin/develop; ${'a'.repeat(40)}; invoice invoices; docs; probe Guide passed`;
    const grade = (rows: unknown[], text = output) =>
      failing(profile.checkOutput(fixture, text, { tool_trace: rows }));
    expect(grade(trace)).toEqual([]);
    expect(grade(trace.filter((_, i) => i !== 0))).toContain('base-sequence');
    expect(grade(trace.filter((_, i) => i !== 4))).toContain('base-probe');
    const local = structuredClone(trace);
    local[3].arguments.argv = [
      'git',
      'grep',
      '-nEi',
      'invoice|invoices',
      'develop',
      '--',
      'docs',
    ];
    expect(grade(local)).toContain('declared-commands');
    expect(
      grade([trace[5], ...trace.slice(0, 5), ...trace.slice(6)]),
    ).toContain('merge-order');
    expect(grade(trace, 'merged')).toContain('reported-evidence');
    // Target-advancement proof belongs to merge-mr's existing verification, not to this check.
    expect(
      grade(
        trace.filter(
          (c) =>
            !c.arguments.argv.includes(
              'projects/1/repository/branches/develop',
            ),
        ),
      ),
    ).toEqual([]);
  });
  it.each([
    'qualify',
    'merge',
  ])('requires %s to stop on a hit or error', async (checkpoint) => {
    for (const outcome of ['hit', 'error']) {
      const { fixture, profile } = await fixtureData(
        `${checkpoint}-prior-art-base-${outcome}`,
      );
      const rows = fixture.simulation.commands.git;
      const trace = (
        outcome === 'error'
          ? rows.slice(0, 1)
          : rows.filter((_: unknown, i: number) => i !== 4)
      ).map((c: { argv: string[]; result: unknown }) => ({
        tool: 'git',
        arguments: { argv: c.argv },
        result: c.result,
      }));
      const output = `${outcome === 'hit' ? 'prior_art_hit EVAL-70 delivered documentation done fixture-maintainer stop; decision needed' : 'error blocked'} origin/develop invoice invoices docs ${'a'.repeat(40)}`;
      const grade = (extra: unknown[] = []) =>
        failing(
          profile.checkOutput(fixture, output, {
            tool_trace: [...trace, ...extra],
          }),
        );
      if (checkpoint === 'qualify') expect(grade()).toContain('ticket-search');
      else if (outcome === 'hit') expect(grade()).toContain('candidate-read');
      else expect(grade()).toEqual([]);
      expect(
        grade([
          call(
            'bakers_comment_publish',
            { ticket: ticketId, type: 'comment', body: 'x' },
            { id: commentId, type: 'comment' },
          ),
        ]),
      ).toContain('stop-on-blocker');
    }
  });
});

describe('prior-art fixture integrity', () => {
  it.each([
    'qualify',
    'merge',
  ])('accepts complete %s hit evidence and rejects false negatives', async (checkpoint) => {
    const { fixture, profile } = await fixtureData(
      `${checkpoint}-prior-art-base-hit`,
    );
    const searches = [
      call('bakers_ticket_search', { query: 'invoice' }, { tickets: [] }),
      call('bakers_ticket_search', { query: 'invoices' }, { tickets: [] }),
      call(
        'bakers_ticket_search',
        { query: 'ticket' },
        {
          tickets: [
            {
              identifier: 'EVAL-90',
              title: 'Unrelated dashboard ticket',
              state: 'done',
              type: null,
            },
          ],
        },
      ),
    ];
    const trace = [
      ...(checkpoint === 'qualify' ? searches : []),
      ...fixture.simulation.commands.git
        .slice(0, 8)
        .filter((_: unknown, i: number) => i !== 4)
        .map((c: { argv: string[]; result: unknown }) => ({
          tool: 'git',
          arguments: { argv: c.argv },
          result: c.result,
        })),
      call(
        'bakers_ticket_read',
        { ticket: fixture.simulation.prior_art.identifier },
        fixture.simulation.prior_art,
      ),
    ];
    const output = `prior_art_hit EVAL-70 Delivered documentation done fixture-maintainer ${'b'.repeat(40)}. Decision needed. origin/develop invoice invoices docs ${'a'.repeat(40)}`;
    expect(
      failing(profile.checkOutput(fixture, output, { tool_trace: trace })),
    ).toEqual([]);
    expect(
      failing(
        profile.checkOutput(
          fixture,
          output.replace('prior_art_hit', 'negative'),
          { tool_trace: trace },
        ),
      ),
    ).toContain('reported-evidence');
    expect(
      failing(
        profile.checkOutput(fixture, output, {
          tool_trace: trace.slice(0, -1),
        }),
      ),
    ).toContain('candidate-read');
  });
  it('rejects incomplete fixtures and corrupt remote evidence before replay', async () => {
    const { fixture } = await fixtureData('merge-prior-art-base-negative');
    const missing = structuredClone(fixture);
    delete missing.input.base_branch;
    await expect(loadProfile(missing)).rejects.toThrow('base-check inputs');
    const unsafe = structuredClone(fixture);
    unsafe.simulation.commands.bash = [];
    await expect(loadProfile(unsafe)).rejects.toThrow('declared');
    const dir = await mkdtemp(join(tmpdir(), 'base-integrity-'));
    try {
      const row = fixture.simulation.commands.git[0];
      const attempt = savedAttempt(fixture, 'error blocked', [
        { tool: 'git', arguments: { argv: row.argv }, result: row.result },
      ]);
      attempt.tool_trace[0].result.stdout = 'forged';
      const path = join(dir, 'attempt.json');
      await writeFile(path, JSON.stringify(attempt));
      await expect(readAttempt(path)).rejects.toThrow(/hash|corrupted/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('prior-art candidate interpretation', () => {
  it.each([
    'self',
    'reverted',
  ])('requires inspection before dismissing a %s candidate', async (kind) => {
    const { fixture, profile } = await fixtureData(
      'merge-prior-art-base-negative',
    );
    fixture.simulation.candidate_kind = kind;
    const trace = fixture.simulation.commands.git
      .slice(0, 5)
      .map((c: { argv: string[]; result: unknown }) => ({
        tool: 'git',
        arguments: { argv: c.argv },
        result: c.result,
      }));
    const output = `negative ${kind} origin/develop ${'a'.repeat(40)} invoice invoices docs`;
    expect(
      failing(profile.checkOutput(fixture, output, { tool_trace: trace })),
    ).toContain('candidate-inspection');
  });
});

describe('failed-fetch reporting', () => {
  it('accepts an explicit error distinction and rejects a negative outcome after error', async () => {
    const { fixture, profile } = await fixtureData(
      'merge-prior-art-base-error',
    );
    const c = fixture.simulation.commands.git[0];
    const trace = [
      { tool: 'git', arguments: { argv: c.argv }, result: c.result },
    ];
    const report =
      'Outcome: error. Fetch failed, not a negative. origin/develop invoice invoices docs. blocked';
    expect(
      failing(profile.checkOutput(fixture, report, { tool_trace: trace })),
    ).toEqual([]);
    expect(
      failing(
        profile.checkOutput(
          fixture,
          report.replace('Outcome: error', 'Outcome: negative'),
          { tool_trace: trace },
        ),
      ),
    ).toContain('reported-evidence');
  });
});

// Calls run through the simulator, so the graded results are the simulator's.
async function simulatedTrace(id: string, steps: Array<[string, unknown]>) {
  const { fixture, profile } = await fixtureData(id);
  const argvs = steps.map(([tool, args]) => [
    'bakers',
    'tools',
    `tool_api__${tool}`,
    '--data',
    JSON.stringify(args),
  ]);
  const results = await runSimulator(
    fixture.simulation,
    argvs.map((argv) => ({ name: 'bakers', arguments: { argv } })),
  );
  const trace = argvs.map((argv, i) => ({
    tool: 'bakers',
    arguments: { argv },
    result: results[i],
  }));
  const grade = (output: string, rows: unknown[] = trace) =>
    failing(profile.checkOutput(fixture, output, { tool_trace: rows }));
  return { grade, trace };
}
describe('hand-over of a specified ticket', () => {
  const qualification = [
    '## Acceptance',
    '- **AC1:** As an operator, I want an Export CSV button.',
    '## Out of scope',
    '- PDF export',
    '| `handoff_version` | `1` |',
    '| `provenance` | title and description as read; approved by Mara Lind (U-MARA) |',
  ].join('\n');
  const steps = (
    changes: { classify?: object; spec?: string; body?: string } = {},
  ): Array<[string, unknown]> => [
    [
      'bakers_comment_publish',
      {
        ticket: 'EVAL-31',
        type: 'qualification',
        body: changes.body ?? qualification,
      },
    ],
    [
      'bakers_comment_publish',
      {
        ticket: 'EVAL-31',
        type: 'spec',
        body:
          changes.spec ??
          '## Acceptance criteria\n\nAC1\n\nApproved by Mara Lind (U-MARA).\n',
      },
    ],
    [
      'bakers_ticket_classify',
      {
        ticket: 'EVAL-31',
        type: 'feature',
        recipe: 'superpowers',
        ...changes.classify,
      },
    ],
    ['bakers_ticket_transition', { ticket: 'EVAL-31', state: 'working' }],
    [
      'bakers_ticket_update',
      {
        ticket: 'EVAL-31',
        labels_add: ['ticket:pingpong'],
        conductor: '44444444-4444-4444-8444-444444444444',
      },
    ],
  ];

  it('publishes qualification and spec, then classifies, moves to working and adds ticket:pingpong', async () => {
    const { grade, trace } = await simulatedTrace(
      'ticket-specify-handover',
      steps(),
    );
    expect(grade('Work on EVAL-31 starts.')).toEqual([]);
    expect(
      grade('Work on EVAL-31 starts.', [
        trace[0],
        trace[1],
        trace[3],
        trace[2],
        trace[4],
      ]),
    ).toContain('handover-order');
    const matt = await simulatedTrace(
      'ticket-specify-handover',
      steps({ classify: { recipe: 'matt' } }),
    );
    expect(matt.grade('Work on EVAL-31 starts.')).toContain(
      'handover-arguments',
    );
    const hashed = await simulatedTrace(
      'ticket-specify-handover',
      steps({ body: `${qualification}\n${'a'.repeat(64)}` }),
    );
    expect(hashed.grade('Work on EVAL-31 starts.')).toContain('handoff-fields');
    const unsigned = await simulatedTrace(
      'ticket-specify-handover',
      steps({ spec: '## Acceptance criteria\n\nAC1\n' }),
    );
    expect(unsigned.grade('Work on EVAL-31 starts.')).toContain('spec-content');
  });

  it("changes nothing on another person's approval, without any call", async () => {
    const { grade } = await simulatedTrace('ticket-specify-other-approval', []);
    expect(grade('Only Mara can approve.')).toEqual([]);
    const handed = await simulatedTrace(
      'ticket-specify-other-approval',
      steps(),
    );
    expect(handed.grade('Work starts.')).toContain('nothing-handed-over');
  });
});
