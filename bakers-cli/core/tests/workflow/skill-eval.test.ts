import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readAttempt,
  sha256,
  validateFixture,
} from '../../../../tests/skill-eval/artifacts.mjs';
import { checkOutput } from '../../../../tests/skill-eval/assertions.mjs';
import { savedAttempt } from './skill-eval-helpers.js';

const login =
  'https://preview.example.invalid/user/reset/73/1791072000/fixture-token-only/login?destination=/projects/alpha/members';
const fixture = { input: { manual_review: { login_url: login } } };
const coding = JSON.parse(
  readFileSync(
    new URL(
      '../../../../tests/skill-eval/fixtures/run-outtake-coding.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const good = `### 🎯 Outcome
EVAL-5: Member invitation authorization is fixed.

### ✅ Success
- AC-1 PASS — agent inspection as member uid:73 at e11ce05: no Invite control; direct invitation returned 403.

### 🧪 Manual review
Human review is pending. Use member uid:73 in the preview environment.

🔗 [Member uid:73 login, member role, preview](${login})

🔗 [Merge request](${coding.input.mr})

🔗 [Coding evidence](${coding.input.evidence})

Open /projects/alpha/members: Invite is absent. Open /projects/alpha/invite: expect 403.

### ➡️ Next action
Check both member paths and record the observation.
`;
const evalRoot = new URL('../../../../tests/skill-eval/', import.meta.url);
describe('outtake evaluation', () => {
  it('runs the existing Python isolation and stream regression suite', () => {
    const result = spawnSync(
      'python3',
      [
        '-B',
        '-m',
        'unittest',
        'discover',
        '-s',
        evalRoot.pathname,
        '-p',
        'test_*.py',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran [1-9]\d* tests/);
  });
  it('requires the issued login URL unchanged exactly once', () => {
    const verdict = (output: string) =>
      checkOutput(fixture, output).find(
        (c: { id: string }) => c.id === 'issued-login-url',
      )?.met;
    expect(verdict(`Member login: ${login}`)).toBe(true);
    expect(verdict('Member login missing')).toBe(false);
    expect(verdict(`${login} ${login}`)).toBe(false);
    expect(verdict(login.replace('73/', '1/'))).toBe(false);
    expect(verdict(`${login}&extra=1`)).toBe(false);
  });
  it('checks the current coding presentation and names each invalid behavior', () => {
    expect(
      checkOutput(coding, good).filter((c: { met: boolean }) => !c.met),
    ).toEqual([]);
    expect(
      checkOutput(
        coding,
        good.replace(
          'Human review is pending.',
          'Human review is pending.\n\n🔗 [Preview](https://preview.example.invalid)\n\n',
        ),
      ).find((c: { id: string }) => c.id === 'links')?.met,
    ).toBe(true);
    const mutations = [
      [
        'outtake-headings',
        good.replace('### 🧪 Manual review', '### Walkthrough'),
      ],
      ['outtake-headings', `${good}\n### 🎯 Outcome`],
      ['criterion-lines', good.replace('- AC-1 PASS', '- AC-1 FAIL')],
      ['criterion-lines', good.replace('at e11ce05', 'at the tested revision')],
      [
        'review-resources',
        good.replace(coding.input.mr, 'https://invented.invalid/mr'),
      ],
      [
        'review-resources',
        good.replace('/projects/alpha/invite: expect', '/wrong: expect'),
      ],
      ['review-actor', good.replaceAll('uid:73', 'uid:1')],
      ['links', good.replace('🔗 [Coding evidence]', '[Coding evidence]')],
      [
        'criterion-lines',
        good.replace('- AC-1 PASS', '- AC-1: denial checked\n- AC-1 PASS'),
      ],
      [
        'links',
        good.replace(
          '### ➡️ Next action',
          '🔗 [Local report](file:///tmp/report.md)\n\n### ➡️ Next action',
        ),
      ],
      [
        'links',
        good.replace(
          '### ➡️ Next action',
          '🔗 [Relative report](./report.md)\n\n### ➡️ Next action',
        ),
      ],
      ['next-action', `${good}\nAlso deploy it.`],
      [
        'next-action',
        good.replace(
          'Check both member paths and record the observation.',
          '- Check paths\n- Deploy',
        ),
      ],
      ['outtake-headings', `\`\`\`markdown\n${good}\n\`\`\``],
    ];
    for (const [id, output] of mutations) {
      expect(
        checkOutput(coding, output).find((c: { id: string }) => c.id === id)
          ?.met,
        id,
      ).toBe(false);
    }
  });
  it('accepts supplied resources independently of formatting and labeled standalone URLs', () => {
    const standalone = good.replace(
      /🔗 \[([^\]]+)\]\(([^)]+)\)/g,
      '🔗 $1\n\n$2',
    );
    expect(
      checkOutput(coding, standalone).every((c: { met: boolean }) => c.met),
    ).toBe(true);
    const raw = good.replace(/🔗 \[([^\]]+)\]\(([^)]+)\)/g, '$2');
    expect(
      checkOutput(coding, raw).find(
        (c: { id: string }) => c.id === 'review-resources',
      )?.met,
    ).toBe(true);
    expect(
      checkOutput(coding, raw).find((c: { id: string }) => c.id === 'links')
        ?.met,
    ).toBe(false);
  });
  it('rejects incomplete or unsupported fixtures before generation', async () => {
    await expect(validateFixture(coding)).resolves.toEqual(coding);
    for (const key of [
      'ticket',
      'state',
      'outcome',
      'gate',
      'evidence',
      'artifacts',
      'next_action',
      'acceptance_criteria',
      'checks',
      'results',
    ]) {
      const bad = structuredClone(coding);
      delete bad.input[key];
      await expect(validateFixture(bad), key).rejects.toThrow();
    }
    await expect(
      validateFixture({
        ...coding,
        skill: 'bb-workflow/references/qualification.md',
      }),
    ).rejects.toThrow();
    await expect(
      validateFixture({
        ...coding,
        input: { ...coding.input, state: 'review' },
      }),
    ).rejects.toThrow();
    const uncovered = structuredClone(coding);
    uncovered.input.checks[0].ac_ids = ['AC-2'];
    await expect(validateFixture(uncovered)).rejects.toThrow();
  });
  it('validates saved provenance and requires explicit attribution for mutated output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outtake-test-'));
    const path = join(dir, 'attempt.json');
    const attempt = savedAttempt(coding, good);
    try {
      await writeFile(path, JSON.stringify(attempt));
      expect((await readAttempt(path)).attempt.output).toBe(good);
      attempt.output = good.replace(login, '');
      await writeFile(path, JSON.stringify(attempt));
      await expect(readAttempt(path)).rejects.toThrow('corrupted');
      attempt.output_sha256 = sha256(attempt.output);
      await writeFile(path, JSON.stringify(attempt));
      await expect(readAttempt(path)).rejects.toThrow('negative_control');
      await writeFile(
        path,
        JSON.stringify({
          ...attempt,
          negative_control: {
            reason: 'Remove only the issued login URL',
            parent_output_sha256: attempt.generation.output_sha256,
          },
        }),
      );
      expect((await readAttempt(path)).attempt.output).not.toContain(login);
      await writeFile(path, '{}');
      await expect(readAttempt(path)).rejects.toThrow('completed generation');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('replays with real Promptfoo under a process/network guard and preserves the attempt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outtake-offline-'));
    try {
      const input = join(dir, 'attempt.json');
      const raw = JSON.stringify(savedAttempt(coding, good));
      await writeFile(input, raw);
      const invoke = (source: string, filename: string) => {
        const result = spawnSync(
          process.execPath,
          [
            '--require',
            new URL('offline-guard.cjs', evalRoot).pathname,
            new URL('run-outtake.mjs', evalRoot).pathname,
            'replay',
            '--input',
            source,
            '--output',
            join(dir, filename),
          ],
          { encoding: 'utf8', timeout: 60000 },
        );
        return result;
      };
      const first = invoke(input, 'first.json');
      expect(first.status, first.stderr).toBe(0);
      const second = invoke(input, 'second.json');
      expect(second.status, second.stderr).toBe(0);
      const read = async (name: string) =>
        JSON.parse(await readFile(join(dir, name), 'utf8'));
      expect((await read('first.json')).checks).toEqual(
        (await read('second.json')).checks,
      );
      expect(await readFile(input, 'utf8')).toBe(raw);
      const bad = savedAttempt(coding, good);
      bad.output = good.replace(login, '');
      bad.output_sha256 = sha256(bad.output);
      const invalid = join(dir, 'invalid.json');
      await writeFile(
        invalid,
        JSON.stringify({
          ...bad,
          negative_control: {
            reason: 'Missing login URL',
            parent_output_sha256: bad.generation.output_sha256,
          },
        }),
      );
      expect(invoke(invalid, 'invalid-result.json').status).toBe(1);
      expect(
        (await read('invalid-result.json')).checks.find(
          (c: { id: string }) => c.id === 'issued-login-url',
        ).met,
      ).toBe(false);
      expect(invoke(join(dir, 'missing.json'), 'error.json').status).toBe(2);
      expect((await read('error.json')).status).toBe('error');
      expect(invoke(input, 'first.json').status).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('shared skill profiles', () => {
  it('loads missing-account through the same fixture and assertion boundary', async () => {
    const { loadFixture, loadProfile } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const fixture = await loadFixture('missing-account');
    const profile = await loadProfile(fixture);
    const output = `The ${fixture.input.environment} environment is reachable. Auditor access is blocked: no matching account. uid:1 is an administrator and cannot substitute. No browser check ran. Supply a persisted auditor identity.`;
    expect(
      profile
        .checkOutput(fixture, output)
        .every((c: { met: boolean }) => c.met),
    ).toBe(true);
    expect(
      profile
        .checkOutput(fixture, output.replace(/auditor/gi, 'operator'))
        .find((c: { id: string }) => c.id === 'required-role').met,
    ).toBe(false);
    expect(
      profile
        .checkOutput(
          fixture,
          output +
            ' Login: https://billing-preview.example.invalid/user/reset/1/token',
        )
        .find((c: { id: string }) => c.id === 'no-invented-url').met,
    ).toBe(false);
    await expect(
      loadProfile({ ...fixture, profile: '../outside' }),
    ).rejects.toThrow();
  });
});

describe('virtual skill files', () => {
  it('serves a bundle skill to a tool fixture and refuses other paths', async () => {
    const { loadFixture } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const route = JSON.parse(
      await readFile(new URL('fixtures/frame-recipe-route.json', evalRoot), 'utf8'),
    );
    const dir = await mkdtemp(join(tmpdir(), 'virtual-skill-'));
    const load = async (paths: string[]) => {
      const path = join(dir, 'fixture.json');
      await writeFile(
        path,
        JSON.stringify({
          ...route,
          virtual_references: [...route.virtual_references, ...paths],
        }),
      );
      return loadFixture(path);
    };
    try {
      const fixture = await load(['bb-verdict/SKILL.md']);
      expect(fixture.simulation.files['skills/bb-verdict/SKILL.md']).toContain(
        'name: bb-verdict',
      );
      await expect(load(['../x.md'])).rejects.toThrow();
      await expect(load(['bb-x/notes.md'])).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('shared offline execution', () => {
  it('replays missing-account and a newly added profile without editing the runner', async () => {
    const { loadFixture } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const fixture = await loadFixture('missing-account');
    const dir = await mkdtemp(join(tmpdir(), 'skill-profiles-'));
    try {
      const output = `Auditor access blocked. ${fixture.input.environment} is reachable. No auditor account exists; uid:1 cannot substitute. No browser check ran. Provide an auditor account.`;
      const input = join(dir, 'attempt.json');
      await writeFile(input, JSON.stringify(savedAttempt(fixture, output)));
      const invoke = (runner: URL | string, source: string, name: string) =>
        spawnSync(
          process.execPath,
          [
            '--require',
            new URL('offline-guard.cjs', evalRoot).pathname,
            String(runner),
            'replay',
            '--input',
            source,
            '--output',
            join(dir, name),
          ],
          { encoding: 'utf8', timeout: 60000 },
        );
      const cli = new URL('run.mjs', evalRoot).pathname;
      const first = invoke(cli, input, 'first.json');
      expect(first.status, first.stderr).toBe(0);
      expect(invoke(cli, input, 'second.json').status).toBe(0);
      const read = async (name: string) =>
        JSON.parse(await readFile(join(dir, name), 'utf8'));
      expect((await read('first.json')).checks).toEqual(
        (await read('second.json')).checks,
      );
      const negative = savedAttempt(fixture, output);
      negative.output +=
        ' Login: https://billing-preview.example.invalid/user/reset/1/token';
      negative.output_sha256 = sha256(negative.output);
      await writeFile(
        join(dir, 'negative.json'),
        JSON.stringify({
          ...negative,
          negative_control: {
            reason: 'Invent an administrator login',
            parent_output_sha256: negative.generation.output_sha256,
          },
        }),
      );
      expect(
        invoke(cli, join(dir, 'negative.json'), 'negative-result.json').status,
      ).toBe(1);
      expect(
        (await read('negative-result.json')).checks.find(
          (c: { id: string }) => c.id === 'no-invented-url',
        ).met,
      ).toBe(false);
      for (const name of await readdir(evalRoot)) {
        if (
          name.endsWith('.mjs') ||
          name.endsWith('.json') ||
          ['profiles', 'fixtures'].includes(name)
        ) {
          await cp(new URL(name, evalRoot), join(dir, name), {
            recursive: true,
          });
        }
      }
      await symlink(
        new URL('node_modules', evalRoot).pathname,
        join(dir, 'node_modules'),
        'dir',
      );
      const runnerHash = sha256(await readFile(join(dir, 'run.mjs')));
      await writeFile(
        join(dir, 'profiles/probe.mjs'),
        `export function validate(f) { if (!f.input.marker) throw new Error('Missing marker'); }
export function checkOutput(f, output) { return [{ id: 'marker', met: output.includes(f.input.marker), reason: 'Preserve the supplied marker' }]; }`,
      );
      const probe = {
        ...fixture,
        id: 'probe',
        profile: 'probe',
        input: { marker: 'preserved-token' },
      };
      await writeFile(join(dir, 'fixtures/probe.json'), JSON.stringify(probe));
      await writeFile(
        join(dir, 'probe-attempt.json'),
        JSON.stringify(savedAttempt(probe, 'preserved-token')),
      );
      const third = invoke(
        join(dir, 'run.mjs'),
        join(dir, 'probe-attempt.json'),
        'probe-result.json',
      );
      expect(third.status, third.stderr).toBe(0);
      expect(
        (await read('probe-result.json')).checks.map(
          (c: { id: string }) => c.id,
        ),
      ).toEqual(['marker']);
      expect(sha256(await readFile(join(dir, 'run.mjs')))).toBe(runnerHash);
      const listed = spawnSync(
        process.execPath,
        [join(dir, 'run.mjs'), 'list'],
        { encoding: 'utf8' },
      );
      expect(listed.stdout).toContain('probe');
      await writeFile(
        join(dir, 'profiles/empty.mjs'),
        'export function validate() {} export function checkOutput() { return []; }',
      );
      await writeFile(
        join(dir, 'empty-attempt.json'),
        JSON.stringify(
          savedAttempt({ ...probe, profile: 'empty' }, 'preserved-token'),
        ),
      );
      expect(
        invoke(
          join(dir, 'run.mjs'),
          join(dir, 'empty-attempt.json'),
          'empty-result.json',
        ).status,
      ).toBe(2);
      expect((await read('empty-result.json')).error).toContain('nonempty');
      expect((await read('probe-result.json')).call_quality).toEqual({
        status: 'clean',
        diagnostics: [],
      });
      const diagnosed = async (
        name: string,
        diagnostics: string,
        trace?: Array<{ tool: string; arguments: unknown; result: unknown }>,
      ) => {
        await writeFile(
          join(dir, `profiles/${name}.mjs`),
          `export function validate() {}
export function checkOutput() { return [{ id: 'marker', met: true, reason: 'Fixture marker' }]; }
export function diagnose() { return ${diagnostics}; }`,
        );
        await writeFile(
          join(dir, `${name}-attempt.json`),
          JSON.stringify(
            savedAttempt({ ...probe, profile: name }, 'preserved-token', trace),
          ),
        );
        return invoke(
          join(dir, 'run.mjs'),
          join(dir, `${name}-attempt.json`),
          `${name}-result.json`,
        ).status;
      };
      expect(
        await diagnosed(
          'uncategorized',
          `[{ id: 'x', category: 'anything', severity: 'warning', reason: 'r', calls: [0] }]`,
        ),
      ).toBe(2);
      expect((await read('uncategorized-result.json')).error).toContain(
        'diagnostics',
      );
      expect(
        await diagnosed(
          'hidden-failure',
          `[{ id: 'x', category: 'expected-error', severity: 'failure', reason: 'r', calls: [0] }]`,
          [{ tool: 'bakers', arguments: {}, result: { exit_code: 2 } }],
        ),
      ).toBe(2);
      expect((await read('hidden-failure-result.json')).error).toContain(
        'failing named check',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
  it('loads daily time preparation cases for isolated evaluation', async () => {
    const { loadFixture } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    for (const id of ['prepare-time-daily', 'prepare-time-unattended']) {
      const fixture = await loadFixture(id);
      await expect(validateFixture(fixture)).resolves.toEqual(fixture);
    }
  });
  it('preserves compatibility preparation and excludes the semantic rubric from worker prompts', async () => {
    const { fixtureIds, loadFixture } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    for (const id of await fixtureIds())
      await expect(loadFixture(id)).resolves.toHaveProperty('id', id);
    const result = spawnSync(
      'python3',
      [
        '-B',
        new URL('run.py', evalRoot).pathname,
        '--fixture',
        'missing-account',
        '--prepare-only',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const path = result.stdout.match(/Artifacts: (.+)/)?.[1];
    expect(path).toBeTruthy();
    try {
      const record = JSON.parse(
        await readFile(
          join(path as string, 'missing-account/generation.json'),
          'utf8',
        ),
      );
      expect(record.status).toBe('prepared');
      expect(JSON.parse(record.prompt)).not.toHaveProperty('criteria');
      expect(record.prompt).not.toContain('no-substitution');
    } finally {
      if (path) await rm(path, { recursive: true, force: true });
    }
  });
  it('renders model output and judge quotes as inert text in shareable reports', async () => {
    const { renderReport } = await import(
      '../../../../tests/skill-eval/report.mjs'
    );
    const attack = '<script>fetch("https://evil.invalid")</script>';
    const html = renderReport([
      { name: attack, data: savedAttempt(coding, attack) },
      {
        name: 'judge',
        data: {
          status: 'failed',
          checks: [
            { id: 'rule', met: false, reason: 'Mismatch', quote: attack },
          ],
        },
      },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('FAIL');
  });
  it('reports correctness, call quality, original versus current verdicts and explicit effort gaps', async () => {
    const { renderReport } = await import(
      '../../../../tests/skill-eval/report.mjs'
    );
    const effort = {
      tool_calls: { total: 6, bakers: 5, read_file: 1, failed: 1 },
      recovery: { attempted: 1, verified: 1 },
      generation: {
        model_turns: { value: 7, unit: 'turns', source: 'worker' },
        elapsed_ms: {
          value: null,
          unit: 'ms',
          unavailable: 'Not recorded by this attempt',
        },
        cost_usd: { value: 0, unit: 'USD', source: 'worker' },
        usage: { value: null, unit: 'tokens', unavailable: 'Not recorded' },
      },
      evaluation: { model_calls: 0, elapsed_ms: 12 },
    };
    const result = (status: string, sources: Record<string, string>) => ({
      status,
      fixture: 'publish-comment-calls',
      attempt_sha256: 'a'.repeat(64),
      assertion_sources: sources,
      checks: [{ id: 'tool-results', met: status === 'passed', reason: 'r' }],
    });
    const html = renderReport([
      { name: 'original.json', data: result('failed', { 'x.mjs': '1' }) },
      {
        name: 'current.json',
        data: {
          ...result('passed', { 'x.mjs': '2' }),
          call_quality: {
            status: 'warning',
            diagnostics: [
              {
                id: 'call-recovery-3',
                category: 'call-recovery',
                severity: 'warning',
                reason: '<b>one rejected call</b>',
                calls: [3, 4, 5],
              },
            ],
          },
          effort,
        },
      },
    ]);
    const table = html.slice(
      html.indexOf('Verdicts by attempt'),
      html.indexOf('</table>', html.indexOf('Verdicts by attempt')),
    );
    expect(table).toContain('original.json');
    expect(table).toContain('current.json');
    expect(table).toMatch(/failed[\s\S]*passed/);
    expect(table).toContain('warning');
    expect(html).toContain('&lt;b&gt;one rejected call&lt;/b&gt;');
    expect(html).toContain('4, 5, 6');
    expect(html).toContain('unavailable: Not recorded by this attempt');
    expect(html).toContain('0 USD');
    expect(html).toContain('6 total · 5 bakers · 1 read_file · 1 failed');
    expect(html).toContain('1 attempted · 1 verified');
  });
});

describe('observed tool calls', () => {
  it('does not accept claimed publication without an actual confirmed create', async () => {
    const { loadFixture, loadProfile } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const fixture = await loadFixture('publish-comment-calls');
    const profile = await loadProfile(fixture);
    const checks = profile.checkOutput(
      fixture,
      'Published successfully: 22222222-2222-4222-8222-000000000001',
      { tool_trace: [] },
    );
    expect(
      checks.find((c: { id: string }) => c.id === 'actual-tool-calls').met,
    ).toBe(false);
    expect(
      checks.find((c: { id: string }) => c.id === 'comment-write').met,
    ).toBe(false);
    expect(
      checks.find((c: { id: string }) => c.id === 'comment-confirmed').met,
    ).toBe(false);
  });
});

describe('spec digest', () => {
  const outtake = (digest: string) => `### 🎯 Outcome
EVAL-7: the invoice CSV export is proposed; nothing is implemented.

### 📖 Spec digest
${digest}

### ✅ Success
**Agent inspection:** spec, plan and test comments are published.

### 🧪 Manual review
Read spec-example-7, plan-example-7 and test-example-7.

### ➡️ Next action
Approve spec, plan and test so the ticket moves to coding.
`;
  const digest = ({
    entities = 'New base field `exported_at` on the existing `invoice` entity.',
    architecture = '`InvoiceExportController` checks access; `InvoiceCsvWriter` builds the rows.',
    tests = 'Kernel `InvoiceCsvWriterTest` proves the exact rows because the format is the contract; functional `InvoiceExportAccessTest` proves the 403 because no new permission guards the route.',
  } = {}) =>
    `**Entities** — ${entities}\n\n**Architecture** — ${architecture}\n\n**Tests** — ${tests}`;
  const brief = digest({
    tests:
      'Kernel `InvoiceCsvWriterTest`; functional `InvoiceExportAccessTest`.',
  });

  async function judge(id: string, output: string) {
    const { loadFixture, loadProfile } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const fixture = await loadFixture(id);
    const checks = (await loadProfile(fixture)).checkOutput(fixture, output);
    return Object.fromEntries(
      checks.map((c: { id: string; met: boolean }) => [c.id, c.met]),
    );
  }
  const allMet = (checks: Record<string, boolean>) =>
    Object.values(checks).every(Boolean);

  it('accepts a digest at the depth each profile asks for', async () => {
    expect(await judge('spec-digest-technical', outtake(digest()))).toSatisfy(
      allMet,
    );
    expect(await judge('spec-digest-brief', outtake(brief))).toSatisfy(allMet);
    expect(await judge('spec-digest-no-profile', outtake(digest()))).toSatisfy(
      allMet,
    );
  });

  it('names each digest violation', async () => {
    const fails = async (id: string, output: string, check: string) =>
      expect((await judge(id, output))[check]).toBe(false);
    const skipped = digest({ entities: 'Skipped per your request.' });
    await fails('spec-digest-technical', outtake(skipped), 'digest-entities');
    const noEntities = digest().replace(/\*\*Entities\*\*[^*]*/, '');
    await fails('spec-digest-technical', outtake(noEntities), 'digest-parts');
    await fails(
      'spec-digest-technical',
      outtake(digest({ architecture: 'A controller and a writer service.' })),
      'digest-classes',
    );
    await fails(
      'spec-digest-technical',
      outtake(
        digest({ tests: 'Kernel `InvoiceCsvWriterTest` proves the rows.' }),
      ),
      'digest-tests',
    );
    await fails('spec-digest-technical', outtake(brief), 'depth-emphasis');
    const detailed = digest({
      architecture: `${'explained '.repeat(80)}\`InvoiceCsvWriter\`.`,
    });
    await fails('spec-digest-brief', outtake(detailed), 'depth-brief');
    await fails(
      'spec-digest-no-profile',
      outtake(digest({ entities: `${'word '.repeat(200)}` })),
      'digest-length',
    );
    await fails(
      'spec-digest-technical',
      outtake(
        digest({
          tests: `${digest().split('**Tests** — ')[1]} See Manual review below.`,
        }),
      ),
      'digest-self-contained',
    );
    const moved = outtake(brief)
      .replace('### 📖 Spec digest\n', '')
      .replace(
        '### 🧪 Manual review',
        `### 📖 Spec digest\n${brief}\n\n### 🧪 Manual review`,
      );
    await fails('spec-digest-brief', moved, 'digest-placement');
    for (const line of ['- AC-1: PASS', '- AC-1: denial checked\n']) {
      await fails(
        'spec-digest-brief',
        outtake(brief).replace(
          '**Agent inspection:**',
          `${line}\n**Agent inspection:**`,
        ),
        'no-passed-ac-list',
      );
    }
  });

  it('rejects a fixture whose expectation contradicts its profile', async () => {
    const { loadProfile } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const fixture = JSON.parse(
      await readFile(
        new URL('fixtures/spec-digest-brief.json', evalRoot),
        'utf8',
      ),
    );
    fixture.input.recipient_profile = '';
    await expect(loadProfile(fixture)).rejects.toThrow('neutral');
  });

  it('replays offline and fails a removed digest', async () => {
    const { loadFixture } = await import(
      '../../../../tests/skill-eval/fixtures.mjs'
    );
    const fixture = await loadFixture('spec-digest-technical');
    const dir = await mkdtemp(join(tmpdir(), 'spec-digest-'));
    try {
      const invoke = (source: string, name: string) =>
        spawnSync(
          process.execPath,
          [
            '--require',
            new URL('offline-guard.cjs', evalRoot).pathname,
            new URL('run.mjs', evalRoot).pathname,
            'replay',
            '--input',
            source,
            '--output',
            join(dir, name),
          ],
          { encoding: 'utf8', timeout: 60000 },
        );
      const attempt = savedAttempt(fixture, outtake(digest()));
      await writeFile(join(dir, 'attempt.json'), JSON.stringify(attempt));
      const good = invoke(join(dir, 'attempt.json'), 'good.json');
      expect(good.status, good.stderr).toBe(0);
      const negative = savedAttempt(fixture, outtake(digest()));
      negative.output = negative.output.replace(
        /### 📖 Spec digest[\s\S]*?(?=### ✅)/,
        '',
      );
      negative.output_sha256 = sha256(negative.output);
      await writeFile(
        join(dir, 'negative.json'),
        JSON.stringify({
          ...negative,
          negative_control: {
            reason: 'Remove the spec digest section',
            parent_output_sha256: negative.generation.output_sha256,
          },
        }),
      );
      expect(
        invoke(join(dir, 'negative.json'), 'negative-result.json').status,
      ).toBe(1);
      const result = JSON.parse(
        await readFile(join(dir, 'negative-result.json'), 'utf8'),
      );
      expect(
        result.checks.find((c: { id: string }) => c.id === 'digest-placement')
          .met,
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
