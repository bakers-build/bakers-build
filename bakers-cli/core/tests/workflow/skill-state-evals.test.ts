import { describe, expect, it } from 'vitest';
import {
  loadFixture,
  loadProfile,
} from '../../../../tests/skill-eval/fixtures.mjs';

// Each state-eval profile accepts a valid output/trace and names the check a violation breaks.
type Row = { tool: string; arguments: unknown; result: unknown };
type Check = { id: string; met: boolean };
const ticket = '11111111-1111-4111-8111-111111111111';
const ok = (stdout: unknown = '{}') => ({
  exit_code: 0,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr: '',
});
/** One `bakers tools tool_api__<id> --data <json>` call with its result. */
const call = (id: string, args: unknown, stdout?: unknown): Row => ({
  tool: 'bakers',
  arguments: {
    argv: [
      'bakers',
      'tools',
      `tool_api__${id}`,
      '--data',
      JSON.stringify(args),
    ],
  },
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
  call(
    'bakers_comment_publish',
    { ticket, type, body },
    { id: '22222222-2222-4222-8222-000000000001', type },
  );
const transition = (state: string) =>
  call('bakers_ticket_transition', { ticket, state }, { state, links: [] });
const readTicket = (fields = {}) =>
  call('bakers_ticket_read', { ticket }, { id: ticket, ...fields });

async function judge(
  id: string | Record<string, any>,
  output: string,
  trace?: Row[],
  edit = (f: Record<string, any>) => f,
) {
  const fixture = edit(typeof id === 'string' ? await loadFixture(id) : id);
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
        transition('review'),
      ]),
    ).toEqual(['no-mutation', 'recipe-read', 'intake-read', 'intake-rendered']);
  });
  it('requires exactly one intake read', async () => {
    expect(
      await judge('frame-recipe-route', intake, [...route, intakeFile]),
    ).toEqual(['intake-read']);
  });
  it('checks that WORKFLOW.md routes to a skill only when it applies', async () => {
    const path = 'skills/bb-pingpong/SKILL.md';
    const skill = (read: unknown) => (f: Record<string, any>) => ({
      ...f,
      expect: { ...f.expect, skill: { path, read } },
    });
    const withRead = [...route, file(path)];
    expect(
      await judge('frame-recipe-route', intake, withRead, skill(true)),
    ).toEqual([]);
    expect(
      await judge('frame-recipe-route', intake, route, skill(true)),
    ).toEqual(['skill-read']);
    expect(
      await judge('frame-recipe-route', intake, withRead, skill(false)),
    ).toEqual(['skill-read']);
    await expect(
      judge('frame-recipe-route', intake, route, skill(undefined)),
    ).rejects.toThrow();
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

describe('ticket pingpong profile', () => {
  const fixture = (
    expect: Record<string, unknown>,
    simulation: Record<string, unknown> = {},
  ) => ({
    id: 'pingpong-probe',
    synthetic: true,
    profile: 'ticket-pingpong',
    execution: 'simulated-tools',
    skill: 'bb-pingpong',
    references: [],
    input: { task: 'Run the state.', ticket_uuid: ticket },
    expect,
    simulation: {
      ticket: {
        id: ticket,
        identifier: 'EVAL-61',
        labels: ['ticket:pingpong'],
      },
      ...simulation,
    },
    rubric: [{ id: 'probe', criterion: 'Probe.' }],
  });
  const update = (args: Record<string, unknown>) =>
    call(
      'bakers_ticket_update',
      { ticket, ...args },
      { labels: args.labels_add ?? [], frozen: Boolean(args.frozen) },
    );
  const answer =
    'Answer in a comment, then remove the label *Question* and unfreeze the ticket.';
  const question = comment(
    'comment',
    `# Question\n\nDoes the export include cancelled invoices?\n\n1. Yes (recommended)\n2. No\n\n${answer}`,
  );
  const asked = update({ labels_add: ['Question'], frozen: true });
  const problem = comment(
    'comment',
    '# Technical problem\n\nPlease contact keytec.\n',
  );
  const reported = update({ labels_add: ['technical problem'], frozen: true });
  const tunnel = 'https://eval-61-preview.example.invalid/invoices';
  const shown = comment(
    'comment',
    `# Question\n\nThe invoice list now has an Export CSV button. Try it at ${tunnel}.\n\n1. Accept (recommended)\n2. Ask for changes\n\n${answer}`,
  );
  const mergeArgv = ['glab', 'mr', 'merge', '61', '--squash'];
  const merged: Row = {
    tool: 'glab',
    arguments: { argv: mergeArgv },
    result: ok('Merged MR 61\n'),
  };
  const commands = {
    glab: [{ argv: mergeArgv, result: ok('Merged MR 61\n') }],
  };
  const verdict = (status: string) =>
    comment('review', `# Review\n\nStatus: **${status}**\n\nF1 ...`);
  const summary = comment('summary');
  const notOk = fixture({
    stop: 'transition',
    state: 'working',
    review_status: 'Not OK',
  });
  const back = [
    readTicket(),
    verdict('Not OK'),
    summary,
    transition('working'),
  ];

  it('accepts one user question with the label and the freeze', async () => {
    const q = fixture({ stop: 'question' });
    expect(await judge(q, 'Asked.', [readTicket(), question, asked])).toEqual(
      [],
    );
    expect(
      await judge(q, 'Asked.', [
        readTicket(),
        question,
        update({ labels_add: ['Question'] }),
      ]),
    ).toEqual(['pingpong-question']);
    // Without the answer line nobody knows to unfreeze the ticket, and the run never resumes.
    expect(
      await judge(q, 'Asked.', [
        readTicket(),
        comment(
          'comment',
          '# Question\n\nCancelled invoices too?\n\n1. Yes\n2. No',
        ),
        asked,
      ]),
    ).toEqual(['pingpong-question']);
  });
  it('technical problem never asks the user', async () => {
    const p = fixture({
      stop: 'technical-problem',
      cause: 'Cannot connect to the Docker daemon',
    });
    const handoff = comment(
      'comment',
      '`ddev start` failed:\n\n```\nCannot connect to the Docker daemon at unix:///var/run/docker.sock.\n```',
    );
    expect(
      await judge(p, 'Stopped.', [readTicket(), handoff, problem, reported]),
    ).toEqual([]);
    expect(
      await judge(p, 'Stopped.', [
        readTicket(),
        handoff,
        question,
        problem,
        reported,
      ]),
    ).toEqual(['pingpong-question']);
    expect(
      await judge(p, 'Stopped.', [
        readTicket(),
        handoff,
        problem,
        update({ labels_add: ['technical problem', 'Question'], frozen: true }),
      ]),
    ).toEqual(['pingpong-question']);
    expect(
      await judge(p, 'Stopped.', [
        readTicket(),
        handoff,
        comment('comment', '# Technical problem\n\nDocker is down.'),
        reported,
      ]),
    ).toEqual(['pingpong-technical-problem']);
    // The cause and output belong in the handoff; the user reads only the keytec note.
    expect(
      await judge(p, 'Stopped.', [
        readTicket(),
        handoff,
        comment(
          'comment',
          '# Technical problem\n\n`ddev start` failed: Docker is down.\n\nPlease contact keytec.',
        ),
        reported,
      ]),
    ).toEqual(['pingpong-technical-problem']);
    expect(
      await judge(p, 'Stopped.', [readTicket(), problem, reported]),
    ).toEqual(['pingpong-cause-recorded']);
    // Only the exact heading is the keytec note; a longer heading is an ordinary comment.
    expect(
      await judge(p, 'Stopped.', [
        readTicket(),
        comment(
          'comment',
          '# Technical problem details\n\n```\nCannot connect to the Docker daemon at unix:///var/run/docker.sock.\n```',
        ),
        problem,
        reported,
      ]),
    ).toEqual([]);
    // The error output itself, not just a note that something failed.
    expect(
      await judge(p, 'Stopped.', [
        readTicket(),
        comment('comment', 'Blocked: the environment does not start.'),
        problem,
        reported,
      ]),
    ).toEqual(['pingpong-cause-recorded']);
  });
  it('sends a Not OK verdict back to working', async () => {
    expect(await judge(notOk, 'Back.', back)).toEqual([]);
    expect(
      await judge(notOk, 'Done.', [...back.slice(0, 3), transition('done')]),
    ).toEqual(['pingpong-transition']);
  });
  it('merges an OK verdict once, then moves to done', async () => {
    const done = fixture(
      { stop: 'transition', state: 'done', review_status: 'OK' },
      { commands },
    );
    const passed = [readTicket(), verdict('OK'), summary];
    expect(
      await judge(done, 'Merged.', [...passed, merged, transition('done')]),
    ).toEqual([]);
    expect(await judge(done, 'Done.', [...passed, transition('done')])).toEqual(
      ['pingpong-merge'],
    );
    expect(
      await judge(done, 'Done.', [...passed, transition('done'), merged]),
    ).toEqual(['pingpong-merge']);
    expect(
      await judge(done, 'Merged.', [
        ...passed,
        merged,
        merged,
        transition('done'),
      ]),
    ).toEqual(['pingpong-merge']);
    expect(await judge(done, 'Merged.', [...passed, merged])).toEqual([
      'pingpong-transition',
    ]);
    // Merge's caller handoff may append its evidence as a second verdict with the same status.
    const addendum = [merged, verdict('OK'), summary, transition('done')];
    expect(await judge(done, 'Merged.', [...passed, ...addendum])).toEqual([]);
    expect(
      await judge(done, 'Merged.', [
        ...passed,
        merged,
        verdict('Not OK'),
        transition('done'),
      ]),
    ).toEqual(['pingpong-review-status']);
    // Any other run merges nothing; an undeclared command leaves the call surface too.
    expect(
      await judge(notOk, 'Back.', [
        ...back.slice(0, 3),
        merged,
        transition('working'),
      ]),
    ).toEqual(['validated-call-surface', 'pingpong-merge']);
  });
  it('puts the tunnel link in the acceptance question', async () => {
    const accept = fixture({ stop: 'question', link: tunnel });
    expect(await judge(accept, 'Asked.', [readTicket(), shown, asked])).toEqual(
      [],
    );
    expect(
      await judge(accept, 'Asked.', [readTicket(), question, asked]),
    ).toEqual(['pingpong-link']);
  });
  it('keeps technical details out of the acceptance question', async () => {
    const plain = fixture({
      stop: 'question',
      link: tunnel,
      hidden: ['f00dfee', 'pull/61'],
    });
    expect(await judge(plain, 'Asked.', [readTicket(), shown, asked])).toEqual(
      [],
    );
    const technical = comment(
      'comment',
      `# Question\n\nAll criteria pass at f00dfee. Try it at ${tunnel}.\n\n1. Accept (recommended)\n2. Ask for changes\n\n${answer}`,
    );
    expect(
      await judge(plain, 'Asked.', [readTicket(), technical, asked]),
    ).toEqual(['pingpong-plain']);
  });
  it('run ends after the decisive write', async () => {
    expect(await judge(notOk, 'Back.', [...back, summary])).toEqual([
      'pingpong-run-ends',
    ]);
    expect(
      await judge(fixture({ stop: 'question' }), 'Asked.', [
        readTicket(),
        question,
        asked,
        summary,
      ]),
    ).toEqual(['pingpong-run-ends']);
  });
  it('records a technical decision in the handoff', async () => {
    const decide = fixture({ stop: 'none', decision: 'writeCsv' });
    const decided =
      '## Decisions\n\n- Reuse `writeCsv`: it already serves two exports.';
    expect(await judge(decide, decided, [readTicket()])).toEqual([]);
    expect(await judge(decide, 'Reused the helper.', [readTicket()])).toEqual([
      'pingpong-decision',
    ]);
  });
  it('rejects an incomplete expectation', async () => {
    for (const e of [
      { stop: 'merge' },
      { stop: 'hold' },
      { stop: 'transition' },
      { stop: 'transition', state: 'plan' },
      { stop: 'none' },
      { stop: 'technical-problem' },
      { stop: 'transition', state: 'review', link: tunnel },
    ])
      await expect(judge(fixture(e), 'x', [readTicket()])).rejects.toThrow();
  });
  it('a third Not OK still goes back to working', async () => {
    // Two earlier Not OK verdicts: no loop limit, so no technical problem.
    expect(await judge('pingpong-review-third-not-ok', 'Back.', back)).toEqual(
      [],
    );
    expect(
      await judge('pingpong-review-third-not-ok', 'Stopped.', [
        ...back.slice(0, 3),
        problem,
        reported,
      ]),
    ).toEqual([
      'pingpong-technical-problem',
      'pingpong-no-stop',
      'pingpong-transition',
    ]);
  });
  it('a first GREEN pass asks for the acceptance', async () => {
    const handedOff = [readTicket(), comment('coding'), summary];
    expect(
      await judge('pingpong-working-acceptance', 'Asked.', [
        ...handedOff,
        shown,
        asked,
      ]),
    ).toEqual([]);
    expect(
      await judge('pingpong-working-acceptance', 'Moved.', [
        ...handedOff,
        transition('review'),
      ]),
    ).toEqual(['pingpong-question', 'pingpong-transition', 'pingpong-link']);
  });
  it('an accepted GREEN pass moves to review without asking', async () => {
    const handedOff = [readTicket(), comment('coding'), summary];
    expect(
      await judge('pingpong-working-accepted', 'Moved.', [
        ...handedOff,
        transition('review'),
      ]),
    ).toEqual([]);
    expect(
      await judge('pingpong-working-accepted', 'Asked.', [
        ...handedOff,
        shown,
        asked,
      ]),
    ).toEqual(['pingpong-question', 'pingpong-no-stop', 'pingpong-transition']);
  });
});

describe('classify profile', () => {
  const recipes = [
    file('skills/bb-recipe-probe/SKILL.md'),
    file('skills/bb-recipe-pair/SKILL.md'),
  ];
  const classify = (recipe: string, type = 'feature') =>
    call('bakers_ticket_classify', { ticket, recipe, type }, { recipe, type });
  const classifiedRead = (recipe: string, type = 'feature') =>
    readTicket({ recipe, type });
  it('accepts one classify call with readback', async () => {
    expect(
      await judge('qualify-classify-default', 'probe, feature', [
        readTicket(),
        ...recipes,
        classify('probe'),
        classifiedRead('probe'),
      ]),
    ).toEqual([]);
  });
  it('names a wrong recipe, a missing readback, a second call and a published comment', async () => {
    const wrong = [
      readTicket(),
      ...recipes,
      classify('bb-recipe-probe'),
      classifiedRead('bb-recipe-probe'),
    ];
    expect(await judge('qualify-classify-default', 'done', wrong)).toEqual([
      'classified',
    ]);
    expect(
      await judge('qualify-classify-default', 'done', [
        readTicket(),
        ...recipes,
        classify('probe', 'epic'),
        classifiedRead('probe', 'epic'),
      ]),
    ).toEqual(['classified']);
    expect(
      await judge('qualify-classify-default', 'done', [
        readTicket(),
        ...recipes,
        classify('probe'),
      ]),
    ).toEqual(['classified']);
    expect(
      await judge('qualify-classify-default', 'done', [
        readTicket(),
        ...recipes,
        classify('probe'),
        classify('probe'),
        classifiedRead('probe'),
      ]),
    ).toEqual(['classified']);
    expect(
      await judge('qualify-classify-default', 'done', [
        readTicket(),
        ...recipes,
        classify('probe'),
        classifiedRead('probe'),
        comment('qualification'),
      ]),
    ).toEqual(['nothing-else']);
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
        call(
          'bakers_ticket_classify',
          { ticket, recipe: 'probe' },
          { recipe: 'probe', type: null },
        ),
      ]),
    ).toEqual(['nothing-else', 'asks']);
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
        transition('working'),
      ]),
    ).toEqual([
      'comment-sequence',
      'no-transition',
      'summary-markers',
      'answers-used',
    ]);
  });
  it('requires classification before the handoff and one transition after it', async () => {
    const classify = call(
      'bakers_ticket_classify',
      { ticket, recipe: 'probe', type: 'chore' },
      { recipe: 'probe', type: 'chore' },
    );
    const done = [
      readTicket(),
      classify,
      readTicket({ recipe: 'probe', type: 'chore' }),
      comment('qualification'),
      comment('summary'),
      transition('plan'),
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
        readTicket({ recipe: 'probe', type: 'chore' }),
        transition('plan'),
        comment('summary'),
      ]),
    ).toEqual(['transition', 'classified']);
    expect(
      await judge(
        'qualification-run',
        'Routed to plan.',
        done.filter((row) => row !== classify),
      ),
    ).toEqual(['classified']);
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

describe('create-ticket profile on prior art', () => {
  const prior = '77777777-7777-4777-8777-777777777777';
  const search = (query: string, tickets: unknown[]) =>
    call('bakers_ticket_search', { query }, { tickets });
  const row = {
    identifier: 'EVAL-70',
    title: 'Document invoice export options',
    state: 'coding',
    type: null,
  };
  const trace = [
    search('invoice', [row]),
    search('invoices', []),
    search('ticket', [{ ...row, identifier: 'EVAL-90' }]),
  ];
  const read = call(
    'bakers_ticket_read',
    { ticket: 'EVAL-70' },
    {
      id: prior,
      identifier: 'EVAL-70',
      state: 'coding',
      description:
        '## Goal\n\nDocument invoice export configuration for operators.\n\n## Acceptance\n\n- AC-1: An operator can find the documented invoice export command and its required project option.\n\n## Out of scope\n\nNo code or runtime change.\n',
    },
  );
  it('reads the returned candidate in full', async () => {
    expect(
      await judge('create-ticket-prior-art', 'EVAL-70 is prior art.', [
        ...trace,
        read,
      ]),
    ).toEqual([]);
  });
  it('requires the read and the probe for an empty spelling', async () => {
    expect(
      await judge('create-ticket-prior-art', 'EVAL-70 is prior art.', trace),
    ).toEqual(['prior-art-read']);
    expect(
      await judge('create-ticket-prior-art', 'EVAL-70 is prior art.', [
        trace[0]!,
        trace[1]!,
        read,
      ]),
    ).toEqual(['prior-art-search']);
  });
});

describe('create-ticket profile on the readback', () => {
  const created = '33333333-3333-4333-8333-000000000001';
  const create = call(
    'bakers_ticket_create',
    {
      title: 'Document invoice export options',
      workflow: 'bb_work',
      project: '55555555-5555-4555-8555-555555555555',
    },
    { id: created, identifier: 'EVAL-101', state: 'qualification' },
  );
  const readback = (recipe: string) =>
    call(
      'bakers_ticket_read',
      { ticket: 'EVAL-101' },
      {
        id: created,
        title: 'Document invoice export options',
        description:
          '## Goal\n\nDocument invoice export configuration for operators.\n\n## Acceptance\n\n- AC-1: An operator can find the documented invoice export command and its required project option.\n\n## Out of scope\n\nNo code or runtime change.\n',
        state: 'qualification',
        type: 'feature',
        recipe,
      },
    );
  it('verifies text, state, recipe and type by identifier', async () => {
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

describe('recipe run profile', () => {
  const sha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const cmd = (argv: string[], stdout = '') => ({
    tool: argv[0],
    arguments: { argv },
    result: ok(stdout),
  });
  const merge = (mr: string, squash = 'false') =>
    cmd([
      'glab',
      'api',
      '-X',
      'PUT',
      `projects/:id/merge_requests/${mr}/merge`,
      '-F',
      `squash=${squash}`,
      '-F',
      'should_remove_source_branch=false',
    ]);
  it('accepts a plan comment with SHA, batch, version and release notes, stopping uncut', async () => {
    const plan = `Frozen ${sha}; batch EVAL-41, EVAL-42; version 0.2.0\n### Features\n### Bug Fixes`;
    expect(
      await judge('deploy-plan', 'Approve?', [
        readTicket(),
        cmd(['git', 'rev-parse', 'origin/develop'], sha),
        comment('plan', plan),
        comment('summary'),
      ]),
    ).toEqual([]);
    expect(
      await judge('deploy-plan', 'Done.', [
        readTicket(),
        cmd(['git', 'checkout', '-b', 'release/x']),
        comment('plan', 'Batch EVAL-41'),
        comment('summary'),
        transition('working'),
      ]),
    ).toEqual(['no-transition', 'plan-content', 'no-branch']);
  });
  it('blocks every merge on an unplayed gate', async () => {
    const summary = comment(
      'summary',
      'MR 51: gate not played; nothing merged.',
    );
    expect(
      await judge('deploy-working-gate-red', 'Blocked.', [
        readTicket(),
        summary,
      ]),
    ).toEqual([]);
    expect(
      await judge('deploy-working-gate-red', 'Merged.', [
        readTicket(),
        merge('51'),
        summary,
      ]),
    ).toEqual(['merges']);
  });
  it('merges once into main by merge commit, nothing back into develop', async () => {
    const summary = comment('summary', 'chore(release): 0.2.0 tagged v0.2.0');
    expect(
      await judge('deploy-working-release', 'Released.', [
        readTicket(),
        merge('51'),
        summary,
      ]),
    ).toEqual([]);
    expect(
      await judge('deploy-working-release', 'Released.', [
        readTicket(),
        merge('51'),
        merge('52'),
        summary,
      ]),
    ).toEqual(['merges']);
    expect(
      await judge('deploy-working-release', 'Released.', [
        readTicket(),
        file('skills/bb-workflow/references/merge.md'),
        merge('51', 'true'),
        summary,
      ]),
    ).toEqual(['merges', 'frame-merge-unused']);
  });
  it('wants one result per ticket, one searched regression and the missing persona', async () => {
    const search = (query: string) =>
      call(
        'bakers_ticket_search',
        { query },
        {
          tickets: [
            {
              identifier: 'EVAL-61',
              title: 'Guest totals',
              state: 'done',
              type: null,
            },
          ],
        },
      );
    const bug = call(
      'bakers_ticket_create',
      {
        title: 'Guest totals fail',
        workflow: 'bb_work',
        project: '55555555-5555-4555-8555-555555555555',
        type: 'bug',
      },
      {
        id: '33333333-3333-4333-8333-000000000001',
        identifier: 'EVAL-101',
        state: 'qualification',
      },
    );
    const good = [
      readTicket(),
      comment('result', 'EVAL-60: 3 passed'),
      comment(
        'result',
        'EVAL-61: guest totals failed\nsouth-auditor: missing, not run',
      ),
      search('totals'),
      search('total'),
      bug,
      comment('summary'),
    ];
    expect(await judge('verify-working', 'Stopped in working.', good)).toEqual(
      [],
    );
    expect(
      await judge(
        'verify-working',
        'Ran the audit path as admin: /user/reset/1/abc',
        [
          readTicket(),
          comment('result', 'EVAL-60 and EVAL-61'),
          bug,
          comment('summary'),
        ],
      ),
    ).toEqual(['per-ticket-results', 'regressions', 'missing-persona']);
  });
});

describe('origin map profile', () => {
  const workflow = file('WORKFLOW.md');
  const write = (label: string, remove: string) => ({
    tool: 'glab',
    arguments: {
      argv: [
        'glab',
        'issue',
        'update',
        'https://git.example.invalid/acme/shop/-/issues/7',
        '--label',
        label,
        '--unlabel',
        remove,
      ],
    },
    result: ok('updated'),
  });
  it('writes the table label and removes the rest of its family', async () => {
    expect(
      await judge('origin-map', 'in progress', [
        readTicket(),
        workflow,
        write('in progress', 'ready for review'),
      ]),
    ).toEqual([]);
    expect(
      await judge('origin-map', 'doing', [
        readTicket(),
        workflow,
        write('doing', 'review'),
      ]),
    ).toEqual(['label-write']);
  });
  it('writes nothing without a table', async () => {
    expect(
      await judge('origin-map-absent', 'No table.', [readTicket(), workflow]),
    ).toEqual([]);
    expect(
      await judge('origin-map-absent', 'doing', [
        readTicket(),
        workflow,
        write('in progress', 'ready for review'),
      ]),
    ).toEqual(['no-write']);
  });
});
