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
  loadFixture,
  loadProfile,
} from '../../../../tests/skill-eval/fixtures.mjs';
import { savedAttempt } from './skill-eval-helpers.js';

const root = new URL('../../../../tests/skill-eval/', import.meta.url);
const ticketId = '11111111-1111-4111-8111-111111111111';
const commentId = '22222222-2222-4222-8222-000000000001';
const newTicketId = '33333333-3333-4333-8333-333333333333';
const result = (stdout: unknown, exit_code = 0, stderr = '') => ({
  stdout,
  exit_code,
  stderr,
});
const bakers = (
  argv: string[],
  stdout: unknown,
  exit_code = 0,
  stderr = '',
) => ({
  tool: 'bakers',
  arguments: { argv: ['bakers', 'dropsh', ...argv] },
  result: result(stdout, exit_code, stderr),
});
const read = (target: string, stdout: unknown) =>
  bakers(['read', target], stdout);
const fixtureData = async (id: string) => ({
  fixture: await loadFixture(id),
  profile: await loadProfile(await loadFixture(id)),
});
const failing = (checks: Array<{ id: string; met: boolean }>) =>
  checks.filter((c) => !c.met).map((c) => c.id);

async function commentCase() {
  const { fixture, profile } = await fixtureData('publish-comment-calls');
  const body = fixture.simulation.files[fixture.input.body_file];
  const stored = {
    data: {
      type: 'bb_comment--bb_comment',
      id: commentId,
      attributes: {
        body: { value: body, format: 'bb_rich' },
        bb_comment_type: 'coding',
      },
      relationships: { ticket_id: { data: { id: ticketId } } },
    },
  };
  const trace = [
    {
      tool: 'read_file',
      arguments: { path: fixture.input.body_file },
      result: result(body),
    },
    bakers(['create', 'bb_comment', '--bundle', 'bb_comment', '--fields'], {
      writable_fields: ['body.value'],
    }),
    bakers(
      [
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
      stored,
    ),
    read(`bb_comment/bb_comment/${commentId}`, stored),
  ];
  return { fixture, profile, trace };
}

async function transitionCase(id = 'transition-ticket-calls') {
  const { fixture, profile } = await fixtureData(id);
  const target = `bb_ticket/bb_ticket/${ticketId}`;
  const links = [...fixture.simulation.ticket.links, ...fixture.input.links];
  const stored = {
    data: {
      id: ticketId,
      attributes: { state: fixture.input.destination ?? 'coding', links },
    },
  };
  const write = bakers(
    [
      'update',
      target,
      ...(fixture.input.destination
        ? ['--state', fixture.input.destination]
        : []),
      '--json',
      `links=${JSON.stringify(links)}`,
    ],
    stored,
  );
  const trace = [
    read(target, {
      data: { id: ticketId, attributes: fixture.simulation.ticket },
    }),
    bakers(['update', target, '--fields'], {
      writable_fields: ['state', 'links'],
    }),
    write,
    read(target, stored),
  ];
  return { fixture, profile, trace };
}

async function createCase() {
  const { fixture, profile } = await fixtureData('create-ticket-calls');
  const description = fixture.simulation.files[fixture.input.description_file];
  const target = `bb_ticket/bb_ticket/${newTicketId}`;
  const initial = {
    data: {
      id: newTicketId,
      attributes: {
        title: fixture.input.title,
        description: { value: description, format: 'bb_rich' },
        project_id: fixture.input.project_uuid,
        state: 'qualification',
      },
    },
  };
  const trace = [
    ...['invoice', 'invoices'].flatMap((term) =>
      ['title', 'description.value'].map((field) =>
        bakers(
          [
            'search',
            'bb_ticket',
            '--bundle',
            'bb_ticket',
            '--filter',
            `${field}:CONTAINS:${term}`,
          ],
          { data: [] },
        ),
      ),
    ),
    bakers(
      [
        'search',
        'bb_ticket',
        '--bundle',
        'bb_ticket',
        '--filter',
        'title:CONTAINS:ticket',
      ],
      { data: [{ id: 'known-positive' }] },
    ),
    bakers(['create', 'bb_ticket', '--bundle', 'bb_ticket', '--fields'], {
      writable_fields: ['title'],
    }),
    bakers(
      [
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
      ],
      initial,
    ),
    read(target, initial),
  ];
  for (const type of ['qualification', 'summary']) {
    const body =
      type === 'qualification'
        ? `# Qualification\n${fixture.input.acceptance_criterion}\nreview_actors: not_required\nout_of_scope: no code changes\nhandoff_version: 1\nprovenance: fixture\nreproduction: not_required\nscenario_required: false`
        : '# Summary\nCreated and qualified; ready for spec.';
    const id =
      type === 'qualification'
        ? commentId
        : '22222222-2222-4222-8222-000000000002';
    const stored = {
      data: {
        type: 'bb_comment--bb_comment',
        id,
        attributes: {
          body: { value: body, format: 'bb_rich' },
          bb_comment_type: type,
        },
        relationships: { ticket_id: { data: { id: newTicketId } } },
      },
    };
    trace.push(
      bakers(
        [
          'create',
          'bb_comment',
          '--bundle',
          'bb_comment',
          `--body.value=${body}`,
          '--body.format',
          'bb_rich',
          '--bb_comment_type',
          type,
          '--ticket_id',
          newTicketId,
        ],
        stored,
      ),
      read(`bb_comment/bb_comment/${id}`, stored),
    );
  }
  trace.push(
    bakers(['update', target, '--fields'], { writable_fields: ['state'] }),
    bakers(['update', target, '--state', 'spec'], {
      data: { id: newTicketId, attributes: { state: 'spec' } },
    }),
    read(target, { data: { id: newTicketId, attributes: { state: 'spec' } } }),
  );
  return { fixture, profile, trace };
}

describe('skill call contracts', () => {
  it('confirms a comment from its create response and never repeats a timed-out create', async () => {
    const { fixture, profile, trace } = await commentCase();
    const grade = (rows: unknown[], f = fixture) =>
      failing(profile.checkOutput(f, 'Success', { tool_trace: rows }));
    const created = trace.slice(0, 3);
    expect(grade(created)).toEqual([]);
    expect(grade(trace)).toEqual([]);
    const rejected = structuredClone(created);
    rejected[2].result = result(null, 2, 'HTTP 500: backend failure');
    expect(grade(rejected)).toEqual(
      expect.arrayContaining(['tool-results', 'comment-confirmed']),
    );
    const changed = structuredClone(created);
    changed[2].arguments = {
      argv: [
        ...(created[2].arguments as { argv: string[] }).argv,
        '--no-validate',
      ],
    };
    expect(grade(changed)).toContain('validated-call-surface');
    const trimmed = structuredClone(created);
    (trimmed[2].arguments as { argv: string[] }).argv[6] =
      '--body.value=changed';
    expect(grade(trimmed)).toContain('comment-write');
    expect(grade([...created, created[2]])).toContain('comment-write');
    const uncertain = await loadFixture('publish-comment-uncertain');
    const lost = structuredClone(created);
    lost[2].result = result(null, 124, 'ETIMEDOUT: outcome unknown');
    expect(grade(lost, uncertain)).toEqual([]);
    expect(grade([...lost, created[2]], uncertain)).toContain(
      'uncertain-write-not-repeated',
    );
  });
  it('passes one rejected read followed by help and exact readback with a call-quality warning', async () => {
    const { fixture, profile, trace } = await commentCase();
    const malformed = bakers(
      ['read', 'bb_comment', '--id', commentId],
      null,
      2,
      'E_VALIDATION: unknown options id',
    );
    const help = bakers(['--help'], 'Usage: bakers dropsh ...');
    const recovered = [...trace.slice(0, 3), malformed, help, trace[3]];
    const grade = (rows: unknown[], f = fixture) =>
      failing(profile.checkOutput(f, 'Published', { tool_trace: rows }));
    const diagnose = (rows: unknown[], f = fixture) =>
      profile.diagnose(f, 'Published', { tool_trace: rows });
    expect(grade(recovered)).toEqual([]);
    expect(diagnose(recovered)).toEqual([
      expect.objectContaining({
        category: 'read-recovery',
        severity: 'warning',
        calls: [3, 4, 5],
      }),
    ]);
    expect(diagnose(trace)).toEqual([]);

    // Each row below names the external rule a recovery may not absorb.
    const repeated = [
      ...recovered.slice(0, 4),
      malformed,
      ...recovered.slice(4),
    ];
    expect(grade(repeated)).toContain('tool-results');
    expect(diagnose(repeated)).toEqual([
      expect.objectContaining({
        category: 'read-recovery',
        severity: 'failure',
      }),
    ]);
    expect(grade(recovered.slice(0, -1))).toContain('tool-results');
    const otherRecord = structuredClone(recovered);
    otherRecord[3].arguments.argv[5] = '22222222-2222-4222-8222-000000000009';
    expect(grade(otherRecord)).toContain('tool-results');
    const unknownVerb = structuredClone(recovered);
    unknownVerb[3].arguments.argv[2] = 'fetch';
    unknownVerb[3].result.stderr = 'Expected action and entity target';
    expect(grade(unknownVerb)).toContain('tool-results');
    const bypass = structuredClone(recovered);
    bypass[3].arguments.argv.push('--no-validate');
    expect(grade(bypass)).toContain('validated-call-surface');
    const backend = structuredClone(recovered);
    backend[3].result.stderr = 'HTTP 500: backend failure';
    expect(grade(backend)).toContain('tool-results');
    const beforeCreate = [
      ...trace.slice(0, 2),
      malformed,
      trace[2],
      help,
      trace[3],
    ];
    expect(grade(beforeCreate)).toContain('tool-results');
    const wrongBody = structuredClone(recovered);
    wrongBody[5].result.stdout.data.attributes.body.value = 'changed';
    expect(grade(wrongBody)).toContain('tool-results');
    const correction = bakers(
      ['update', `bb_comment/bb_comment/${commentId}`, '--body.value=x'],
      {},
    );
    const afterWrite = [...recovered.slice(0, 5), correction, recovered[5]];
    expect(grade(afterWrite)).toContain('tool-results');
  });
  it('fails a timed-out publication whose create lost one trailing newline', async () => {
    const { profile, trace } = await commentCase();
    const uncertain = await loadFixture('publish-comment-uncertain');
    const body = uncertain.simulation.files[uncertain.input.body_file];
    const lost = structuredClone(trace.slice(0, 3));
    lost[2].arguments.argv[6] = `--body.value=${body.slice(0, -1)}`;
    lost[2].result = result(null, 124, 'ETIMEDOUT: outcome unknown');
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
  it('requires prior-art calls and confirmed comments before initial routing', async () => {
    const { fixture, profile, trace } = await createCase();
    const grade = (rows: unknown[]) =>
      failing(
        profile.checkOutput(fixture, 'Created and routed', {
          tool_trace: rows,
        }),
      );
    expect(grade(trace)).toEqual([]);
    expect(grade(trace.filter((_, i) => i !== 0))).toContain(
      'prior-art-search',
    );
    const failedQualification = structuredClone(trace);
    failedQualification[8].result = result(null, 2, 'E_VALIDATION: rejected');
    expect(grade(failedQualification)).toContain('qualification-and-summary');
    const wrong = structuredClone(trace);
    wrong[6].arguments.argv.push('--base_branch', 'develop');
    expect(grade(wrong)).toContain('ticket-create');
    // qualify-ticket records the boundary as an "Out of scope" section or an out_of_scope field.
    const rewrite = (from: RegExp, to: string) => {
      const changed = structuredClone(trace);
      for (const i of [8, 9]) {
        const row = changed[i] as {
          arguments: { argv: string[] };
          result: {
            stdout: { data: { attributes: { body: { value: string } } } };
          };
        };
        const body = row.result.stdout.data.attributes.body;
        body.value = body.value.replace(from, to);
        if (i === 8)
          row.arguments.argv = row.arguments.argv.map((token) =>
            token.startsWith('--body.value=')
              ? `--body.value=${body.value}`
              : token,
          );
      }
      return changed;
    };
    expect(grade(rewrite(/out_of_scope: /, '## Out of scope\n\n'))).toEqual([]);
    expect(
      grade(
        rewrite(
          /review_actors: (.*)\n([\s\S]*)reproduction: (.*)\nscenario_required: (.*)$/,
          '### Review actors\n\n$1\n$2### Reproduction\n\n$3\n\n### Scenario required\n\n$4',
        ),
      ),
    ).toEqual([]);
    expect(
      grade(rewrite(/scenario_required: false/, 'scenario: false')),
    ).toContain('qualification-and-summary');
    expect(grade(rewrite(/out_of_scope: no code changes\n/, ''))).toContain(
      'qualification-and-summary',
    );
    const hit = await loadFixture('create-ticket-prior-art');
    const searched = trace.slice(0, 4).map((row) => ({
      ...row,
      result: result({ data: [hit.simulation.prior_art] }),
    }));
    searched.push(
      read(`bb_ticket/bb_ticket/${hit.simulation.prior_art.id}`, {
        data: hit.simulation.prior_art,
      }),
    );
    expect(
      failing(
        profile.checkOutput(hit, 'Prior art blocks creation', {
          tool_trace: searched,
        }),
      ),
    ).toEqual([]);
    const completeSearch = searched.slice(0, 4).map((row) => ({
      ...row,
      result: result({
        data: [
          {
            id: hit.simulation.prior_art.id,
            attributes: hit.simulation.prior_art,
          },
        ],
      }),
    }));
    expect(
      failing(
        profile.checkOutput(hit, 'Hit inspected from full search result', {
          tool_trace: completeSearch,
        }),
      ),
    ).toEqual([]);
    expect(
      failing(
        profile.checkOutput(hit, 'Inspected', {
          tool_trace: searched.slice(0, 4).map((row) => ({
            ...row,
            result: result({ data: [{ id: hit.simulation.prior_art.id }] }),
          })),
        }),
      ),
    ).toContain('prior-art-read');
    expect(
      failing(
        profile.checkOutput(hit, 'Created', {
          tool_trace: [...searched, trace[6]],
        }),
      ),
    ).toContain('prior-art-stop');
  });
  it('routes only after both creation handoffs are confirmed by their create responses', async () => {
    const { fixture, profile, trace } = await createCase();
    const grade = (rows: unknown[]) =>
      failing(profile.checkOutput(fixture, 'Routed', { tool_trace: rows }));
    const noReads = trace.filter((_, i) => i !== 9 && i !== 11);
    expect(grade(noReads)).toEqual([]);
    // The workspace lookup that method-context names is a supported read-only call.
    const info = {
      tool: 'bakers',
      arguments: { argv: ['bakers', 'info'] },
      result: result({ workspace_id: fixture.input.workspace_uuid }),
    };
    expect(grade([...noReads.slice(0, 9), info, ...noReads.slice(9)])).toEqual(
      [],
    );
    const summaryFailed = structuredClone(noReads);
    summaryFailed[9].result = result(null, 2, 'HTTP 500: backend failure');
    expect(grade(summaryFailed)).toContain('qualification-and-summary');
    const summaryAfterRouting = [
      ...noReads.slice(0, 9),
      ...noReads.slice(10, 12),
      noReads[9],
      noReads[12],
    ];
    expect(grade(summaryAfterRouting)).toContain('qualification-and-summary');

    // An optional readback stays possible; a recovered read is a call-quality warning.
    const malformed = bakers(
      ['show', 'bb_comment', commentId],
      null,
      2,
      'Expected action and entity target',
    );
    const recovered = [...trace.slice(0, 9), malformed, ...trace.slice(9)];
    expect(grade(recovered)).toEqual([]);
    expect(
      profile.diagnose(fixture, 'Routed', { tool_trace: recovered }),
    ).toEqual([
      expect.objectContaining({ severity: 'warning', calls: [9, 10] }),
    ]);
    const afterRouting = [
      ...trace.slice(0, 9),
      malformed,
      ...trace.slice(10, 15),
      trace[9],
    ];
    expect(grade(afterRouting)).toContain('tool-results');
  });
  it('checks additive links, explicit state, links-only behavior and no alternate state after 422', async () => {
    const { fixture, profile, trace } = await transitionCase();
    const grade = (rows: unknown[]) =>
      failing(
        profile.checkOutput(fixture, 'Transitioned', { tool_trace: rows }),
      );
    expect(grade(trace)).toEqual([]);
    const omitted = structuredClone(trace);
    omitted[2].arguments.argv[7] = 'links=[]';
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
    linksOnly.trace[2].arguments.argv.push('--state', 'review');
    expect(
      failing(
        profile.checkOutput(linksOnly.fixture, 'Linked', {
          tool_trace: linksOnly.trace,
        }),
      ),
    ).toContain('single-authorized-update');
    const rejected = await loadFixture('transition-ticket-rejected');
    const blocked = structuredClone(trace.slice(0, 3));
    blocked[2].result = result(null, 2, 'HTTP 422: rejected');
    expect(
      failing(
        profile.checkOutput(rejected, 'Rejected', { tool_trace: blocked }),
      ),
    ).toEqual([]);
    expect(
      profile.diagnose(rejected, 'Rejected', { tool_trace: blocked }),
    ).toEqual([
      expect.objectContaining({
        category: 'expected-error',
        severity: 'info',
        calls: [2],
      }),
    ]);
    expect(
      profile.diagnose(fixture, 'Transitioned', { tool_trace: trace }),
    ).toEqual([]);
    expect(
      failing(
        profile.checkOutput(rejected, 'Retried', {
          tool_trace: [...blocked, trace[2]],
        }),
      ),
    ).toContain('single-authorized-update');
  });
  it('replays a recovered read as passed with a warning, measured effort and unchanged attempt bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-call-quality-'));
    try {
      const { fixture, trace } = await commentCase();
      const recovered = [
        ...trace.slice(0, 3),
        bakers(
          ['read', 'bb_comment', '--id', commentId],
          null,
          2,
          'E_VALIDATION: unknown options id',
        ),
        bakers(['--help'], 'Usage'),
        trace[3],
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
          expect.objectContaining({ severity: 'warning', calls: [3, 4, 5] }),
        ],
      });
      expect(second.call_quality).toEqual(first.call_quality);
      expect(second.checks).toEqual(first.checks);
      expect(first.effort.tool_calls).toEqual({
        total: 6,
        bakers: 5,
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
    { name: 'creation', create: createCase },
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
          bakers(
            [
              'create',
              'bb_comment',
              '--bundle',
              'bb_comment',
              '--body.value=x',
            ],
            {},
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
    const searches = ['invoice', 'invoices'].flatMap((term) =>
      ['title', 'description.value'].map((field) =>
        bakers(
          [
            'search',
            'bb_ticket',
            '--bundle',
            'bb_ticket',
            '--filter',
            `${field}:CONTAINS:${term}`,
          ],
          { data: [] },
        ),
      ),
    );
    searches.push(
      bakers(
        [
          'search',
          'bb_ticket',
          '--bundle',
          'bb_ticket',
          '--filter',
          'title:CONTAINS:ticket',
        ],
        { data: [{ id: 'known' }] },
      ),
    );
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
      read(`bb_ticket/bb_ticket/${fixture.simulation.prior_art.id}`, {
        data: fixture.simulation.prior_art,
      }),
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
    const missing = structuredClone(fixture);
    delete missing.simulation.prior_art.assignee;
    expect(
      failing(
        profile.checkOutput(
          missing,
          output
            .replace('fixture-maintainer', 'assignee unresolved')
            .replace('Decision needed', 'The caller stops and asks'),
          { tool_trace: trace },
        ),
      ),
    ).toEqual([]);
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
