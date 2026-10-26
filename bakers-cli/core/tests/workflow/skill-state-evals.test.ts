import { describe, expect, it } from 'vitest';
import {
  loadFixture,
  loadProfile,
} from '../../../../tests/skill-eval/fixtures.mjs';

// Each state-eval profile accepts a valid output/trace and names the check a violation breaks.
type Row = { tool: string; arguments: unknown; result: unknown };
type Check = { id: string; met: boolean };
const ticket = '11111111-1111-4111-8111-111111111111';
const target = `bb_ticket/bb_ticket/${ticket}`;
const ok = (stdout: unknown = '{}') => ({
  exit_code: 0,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr: '',
});
const bakers = (argv: string[], stdout?: unknown): Row => ({
  tool: 'bakers',
  arguments: { argv: ['bakers', 'dropsh', ...argv] },
  result: ok(stdout),
});
const file = (path: string, exit_code = 0): Row => ({
  tool: 'read_file',
  arguments: { path },
  result: exit_code
    ? { exit_code, stdout: '', stderr: 'No such file' }
    : ok('x'),
});
const comment = (type: string, body = `${type} body`) =>
  bakers([
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
    ticket,
  ]);
const readTicket = (relationships = {}) =>
  bakers(['read', target], { data: { id: ticket, relationships } });

async function judge(id: string, output: string, trace?: Row[]) {
  const fixture = await loadFixture(id);
  const profile = await loadProfile(fixture);
  const checks: Check[] = profile.checkOutput(fixture, output, {
    tool_trace: trace,
  });
  return checks.filter((c) => !c.met).map((c) => c.id);
}

describe('frame routing profile', () => {
  const intakeFile = file('skills/bb-workflow/references/intake.md');
  const route = [
    readTicket(),
    file('skills/bb-recipe-probe/SKILL.md'),
    intakeFile,
  ];
  const intake =
    '# Intake: working · EVAL-40 · target GREEN\n\n- work: probe-method\n- validate: probe-validate';
  it('accepts a read, a recipe read and one intake naming the general slots', async () => {
    expect(await judge('frame-recipe-route', intake, route)).toEqual([]);
  });
  it('names a mutation, a missed recipe and a missing intake', async () => {
    expect(
      await judge('frame-recipe-route', intake.replace('GREEN', 'done'), [
        readTicket(),
        bakers(['update', target, '--state', 'review']),
      ]),
    ).toEqual(['no-mutation', 'recipe-read', 'intake-read', 'intake-rendered']);
  });
  it('requires exactly one intake read', async () => {
    expect(
      await judge('frame-recipe-route', intake, [...route, intakeFile]),
    ).toEqual(['intake-read']);
  });
  it('requires the stop to name the missing recipe and substitute none', async () => {
    const stop = 'Stopped: bb-recipe-lean is not installed.';
    expect(await judge('frame-recipe-missing', stop, [readTicket()])).toEqual(
      [],
    );
    expect(
      await judge('frame-recipe-missing', 'Using probe-method instead.', [
        readTicket(),
        file('skills/bb-recipe-probe/SKILL.md'),
        intakeFile,
      ]),
    ).toEqual(['slot-markers', 'intake-read', 'stop-named']);
  });
});

describe('classify profile', () => {
  const recipes = [
    file('skills/bb-recipe-probe/SKILL.md'),
    file('skills/bb-recipe-pair/SKILL.md'),
  ];
  const update = (recipe: string) =>
    bakers([
      'update',
      target,
      '--recipe_names',
      recipe,
      '--type_names',
      'feature',
    ]);
  const resolved = {
    recipe: { data: { id: 'r' } },
    ticket_type: { data: { id: 't' } },
  };
  it('accepts one default update with readback', async () => {
    expect(
      await judge('qualify-classify-default', 'probe, feature', [
        readTicket(),
        ...recipes,
        update('probe'),
        readTicket(resolved),
      ]),
    ).toEqual([]);
  });
  it('accepts the Markdown readback the frame prescribes', async () => {
    const markdown = bakers(
      ['--format', 'md', 'read', target],
      `id: ${ticket}\nrecipe: [bb_term--recipe/r]\nticket_type: [bb_term--type/t]\n`,
    );
    expect(
      await judge('qualify-classify-default', 'probe, feature', [
        readTicket(),
        ...recipes,
        update('probe'),
        markdown,
      ]),
    ).toEqual([]);
  });
  it('names a wrong recipe, a missing readback and a published comment', async () => {
    expect(
      await judge('qualify-classify-default', 'done', [
        readTicket(),
        ...recipes,
        update('bb-recipe-probe'),
        comment('qualification'),
      ]),
    ).toEqual(['nothing-else', 'single-update', 'readback']);
  });
  it('requires a question and no write when two recipes fit', async () => {
    const ask = 'Which recipe: bb-recipe-probe or bb-recipe-pair?';
    expect(
      await judge('qualify-classify-ambiguous', ask, [
        readTicket(),
        ...recipes,
      ]),
    ).toEqual([]);
    expect(
      await judge(
        'qualify-classify-ambiguous',
        'Which recipe: `probe` or `pair`?',
        [readTicket(), ...recipes],
      ),
    ).toEqual([]);
    expect(
      await judge('qualify-classify-ambiguous', 'Which recipe: `probe`?', [
        readTicket(),
        ...recipes,
      ]),
    ).toEqual(['asks']);
    expect(
      await judge('qualify-classify-ambiguous', 'Chose bb-recipe-probe.', [
        readTicket(),
        ...recipes,
        update('probe'),
      ]),
    ).toEqual(['no-write', 'asks']);
  });
});

describe('acceptance rewrite profile', () => {
  const ac1 =
    'As an operator, I want an Export CSV button on the invoice list, so that I can download the visible invoices.';
  const ac3 =
    'As an operator, I want the CSV to contain number, date, customer and total per invoice, so that accounting can import it.';
  const good = `- **AC-1** ${ac1}\n- **AC-2** As an operator, I want 500 invoices exported within 5 seconds, so that I do not wait.\n  Previous wording: "The export should be fast."\n- **AC-3** ${ac3}\n\nGate: 3 passed, 1 rewritten.`;
  it('accepts a rewrite with previous wording and tally', async () => {
    expect(await judge('qualify-acceptance-rewrite', good)).toEqual([]);
    expect(
      await judge(
        'qualify-acceptance-rewrite',
        good.replace(
          'Gate: 3 passed, 1 rewritten.',
          '- Passed: 3\n- Rewritten: 1',
        ),
      ),
    ).toEqual([]);
  });
  it('reads no criterion number as a count', async () => {
    const tally = 'Gate: 3 passed, 1 rewritten.';
    const named = good.replace(tally, 'AC-2 rewritten; AC-3 passed.');
    expect(await judge('qualify-acceptance-rewrite', named)).toEqual(['tally']);
    expect(
      await judge(
        'qualify-acceptance-rewrite',
        named.replace('AC-3 passed.', `AC-3 passed.\n\n${tally}`),
      ),
    ).toEqual([]);
  });
  it('names a lost previous wording, an edited passing criterion and a wrong tally', async () => {
    const bad = good
      .replace('  Previous wording: "The export should be fast."\n', '')
      .replace('visible invoices', 'shown invoices')
      .replace('1 rewritten', '0 rewritten');
    expect(await judge('qualify-acceptance-rewrite', bad)).toEqual([
      'previous-wording',
      'kept-verbatim',
      'tally',
    ]);
  });
});

describe('state outtake profile', () => {
  const lead =
    'https://eval-40.example.invalid/user/reset/41/1791072000/lead-token/login';
  const guest =
    'https://eval-40.example.invalid/user/reset/42/1791072000/guest-token/login';
  const mr = 'https://git.example.invalid/team/app/-/merge_requests/40';
  const working = `### 🎯 Outcome
EVAL-40: CSV export built.

### ✅ Success
- AC-1 PASS · test/invoices.test.ts · \`npm test -- test/invoices.test.ts\` · f00dfee
- AC-2 PASS · test/export.test.ts · \`npm test -- test/export.test.ts\` · f00dfee

### 🧪 Manual review
🔗 [north-lead login](${lead})

🔗 [north-guest login](${guest})

🔗 [Merge request](${mr})

1111111 → f00dfee

Probe-working: 2
Probe-coverage: 87%

### ➡️ Next action
Confirm the summary and MR?
`;
  it('rejects a fixture whose expectations need a missing handoff', async () => {
    const fixture = await loadFixture('working-outtake');
    const profile = await loadProfile(fixture);
    delete fixture.input.handoff;
    expect(() => profile.validate(fixture)).toThrow(/handoff/);
  });
  it('accepts per-criterion lines, issued logins, the MR and the slot lines', async () => {
    expect(await judge('working-outtake', working)).toEqual([]);
  });
  it('names a missing revision, a repeated login and a slot line after Next action', async () => {
    const bad = working
      .replace('· f00dfee\n- AC-2', '· at the tested revision\n- AC-2')
      .replace('🔗 [Merge request]', `${lead}\n\n🔗 [Merge request]`)
      .replace('Probe-working: 2\n', '')
      .concat('Probe-working: 2\n');
    expect(await judge('working-outtake', bad)).toEqual(
      expect.arrayContaining([
        'criterion-lines',
        'issued-logins',
        'slot-markers',
      ]),
    );
  });
  it('requires every criterion and the fit question at qualification', async () => {
    const out = `### 🎯 Outcome
EVAL-41 qualified.

### 📋 Acceptance
- AC-1 button
- AC-2 five seconds
- AC-3 columns
- AC-4 validate rows

### 🧪 Manual review
Check that the criteria describe the ask.

### ➡️ Next action
Do these criteria fit?
`;
    expect(await judge('qualify-outtake', out)).toEqual([]);
    expect(
      await judge(
        'qualify-outtake',
        out
          .replace('- AC-4 validate rows\n', '- AC-5 extra\n')
          .replace('fit?', 'fit.'),
      ),
    ).toEqual(['all-criteria', 'asks-fit']);
  });
  it('shows an unrecorded value as not recorded and keeps a missing persona', async () => {
    const out = working
      .replace(`🔗 [north-guest login](${guest})`, 'north-guest: missing')
      .replace('Probe-coverage: 87%', 'Probe-coverage: not recorded');
    expect(await judge('outtake-extension-unrecorded', out)).toEqual([]);
    expect(await judge('outtake-extension-unrecorded', working)).toEqual(
      expect.arrayContaining(['missing-persona', 'not-recorded']),
    );
  });
});

describe('state run profile', () => {
  const plan = [
    readTicket(),
    comment('spec', 'Dates are ISO 8601; the delimiter is a semicolon.'),
    comment('plan'),
    comment('test'),
    comment('summary', 'Probe-plan: 2'),
  ];
  it('accepts the comment sequence, the slot line and a stop at the approval', async () => {
    expect(await judge('plan-feature-run', 'Approve?', plan)).toEqual([]);
  });
  it('names a reordered sequence, a transition and a missing slot line', async () => {
    expect(
      await judge('plan-feature-run', 'Done.', [
        readTicket(),
        comment('plan'),
        comment('spec'),
        comment('test'),
        comment('summary'),
        bakers(['update', target, '--state', 'working']),
      ]),
    ).toEqual([
      'comment-sequence',
      'no-transition',
      'summary-markers',
      'answers-used',
    ]);
  });
  it('requires classification before the handoff and one transition after it', async () => {
    const classify = bakers([
      'update',
      target,
      '--recipe_names',
      'probe',
      '--type_names',
      'chore',
    ]);
    const done = [
      readTicket(),
      classify,
      comment('qualification'),
      comment('summary'),
      bakers(['update', target, '--state', 'plan']),
      readTicket(),
    ];
    expect(await judge('qualification-run', 'Routed to plan.', done)).toEqual(
      [],
    );
    expect(
      await judge('qualification-run', 'Routed to plan.', [
        readTicket(),
        comment('qualification'),
        classify,
        bakers(['update', target, '--state', 'plan']),
        comment('summary'),
      ]),
    ).toEqual(['transition', 'classified']);
  });
});

describe('persona login profile', () => {
  const link =
    'https://eval-42.ddev.site/user/reset/41/1791072000/lead-token/login';
  const good = `- north-lead (lead, eval-42): 🔗 [login](${link})\n- south-auditor: **missing** — no account, never replaced by an administrator.`;
  it('accepts the issued link once and the missing persona', async () => {
    expect(await judge('persona-login', good)).toEqual([]);
  });
  it('names an admin login, a second link and an unreported missing persona', async () => {
    const bad = `${good.replace('**missing**', 'skipped')}\n\n\`ddev drush uli --uid 1\` → https://eval-42.ddev.site/user/reset/1/179/admin/login`;
    expect(await judge('persona-login', bad)).toEqual([
      'issued-link',
      'missing-persona',
      'no-admin-login',
    ]);
  });
});

describe('create-ticket profile on Markdown searches', () => {
  const search = (filter: string, stdout: string) =>
    bakers(
      [
        '--format',
        'md',
        'search',
        'bb_ticket',
        '--bundle',
        'bb_ticket',
        '--filter',
        filter,
      ],
      stdout,
    );
  const hit =
    'type: bb_ticket--bb_ticket\nid: 77777777-7777-4777-8777-777777777777\nstate: coding\ndescription: |\n  ## Goal\n\n  Document invoice export configuration for operators.\n\n  ## Acceptance\n\n  - AC-1: An operator can find the documented invoice export command and its required project option.\n\n  ## Out of scope\n\n  No code or runtime change.\n';
  const trace = [
    search('title:CONTAINS:invoice', hit),
    search('description.value:CONTAINS:invoice', hit),
    search('title:CONTAINS:invoices', '_(no results)_\n'),
    search('description.value:CONTAINS:invoices', '_(no results)_\n'),
  ];
  it('reads the candidate from a Markdown search result', async () => {
    expect(
      await judge('create-ticket-prior-art', 'EVAL-70 is prior art.', trace),
    ).not.toContain('prior-art-read');
  });
  it('still requires the candidate in the result', async () => {
    const empty = trace.map((row, i) =>
      i < 2
        ? search(
            i ? 'description.value:CONTAINS:invoice' : 'title:CONTAINS:invoice',
            '_(no results)_\n',
          )
        : row,
    );
    expect(await judge('create-ticket-prior-art', 'none', empty)).toContain(
      'prior-art-read',
    );
  });
});

describe('create-ticket profile on the Markdown readback', () => {
  const created = '33333333-3333-4333-8333-333333333333';
  const project = '55555555-5555-4555-8555-555555555555';
  const create = bakers(['create', 'bb_ticket', '--bundle', 'bb_ticket'], {
    data: { id: created },
  });
  const readback = (recipe: string) =>
    bakers(
      [
        '--format',
        'md',
        'read',
        `bb_ticket/bb_ticket/${created}`,
        '--include',
        'comments,labels,ticket_type,recipe',
      ],
      `type: bb_ticket--bb_ticket\nid: ${created}\ntitle: Document invoice export options\ndescription: |\n  ## Goal\n\n  Document invoice export configuration for operators.\n\n  ## Acceptance\n\n  - AC-1: An operator can find the documented invoice export command and its required project option.\n\n  ## Out of scope\n\n  No code or runtime change.\nstate: qualification\nproject_id: [bb_project--bb_project/${project}]\nticket_type: [bb_term--type/t1]\nrecipe: [bb_term--recipe/r1]\n\n## Included\n\ntype: bb_term--type\nid: t1\nname: feature\n\n---\n\ntype: bb_term--recipe\nid: r1\nname: ${recipe}\n`,
    );
  it('verifies text, project, state, recipe and type from Markdown', async () => {
    expect(
      await judge('create-ticket-calls', 'done', [create, readback('matt')]),
    ).not.toContain('ticket-readback');
  });
  it('names a readback whose recipe differs', async () => {
    expect(
      await judge('create-ticket-calls', 'done', [create, readback('lean')]),
    ).toContain('ticket-readback');
  });
});
