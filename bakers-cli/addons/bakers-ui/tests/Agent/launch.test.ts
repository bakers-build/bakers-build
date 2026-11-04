import { expect, it } from 'vitest';
import { buildCreateLaunch, shortName } from '../../src/Agent/launch.js';
import type { CreateFormPayload } from '../../src/Entity/ticket/Form/create.js';

// BB-236 AC-8: `shortName` builds the agent-list `label` that `buildCreateLaunch`
// takes, so it belongs to the module that builds the launch intent. The two
// assertions below moved verbatim from `tests/Service/create-form.test.ts`, restated
// over the payload `shortName` actually takes.
const payload = (over: Partial<CreateFormPayload> = {}): CreateFormPayload => ({
  // BB-309 D1: the payload gained a title. Empty by default, so every case
  // above keeps exercising the description fallback it was written for.
  title: '',
  description: '',
  workflow: { id: 'bb_work', label: 'work' },
  assignee: null,
  conductor: null,
  labels: [],
  reviewers: [],
  ...over,
});

it('shortName uses the first description line, else the workflow', () => {
  expect(shortName(payload({ description: 'Add login\nmore' }))).toBe(
    'Add login',
  );
  expect(shortName(payload())).toBe('New work');
});

it('shortName skips blank leading lines and caps a long first line', () => {
  expect(shortName(payload({ description: '\n  \nReal title\n' }))).toBe(
    'Real title',
  );
  const long = 'x'.repeat(60);
  const capped = shortName(payload({ description: long }));
  expect(capped).toHaveLength(40);
  expect(capped.endsWith('…')).toBe(true);
});

it('shortName falls back to "New ticket" with no workflow at all', () => {
  expect(shortName(payload({ workflow: null }))).toBe('New ticket');
});

it('create launch points at bb-create-ticket and carries no BB_ID', () => {
  const req = buildCreateLaunch({ project: 'bakers', cwd: '/repo' });
  expect(req.prompt).toMatch(/bb-create-ticket/);
  expect(req.prompt).toMatch(/\$BB_NEW_TICKET_INPUT/);
  expect(req.prompt).toMatch(/Do not start work on the new ticket\./);
  expect(req.env.BB_ID).toBeUndefined();
  expect(req.env.BB_PROJECT).toBe('bakers');
  expect(req.group).toBe('bakers');
  expect(req.cwd).toBe('/repo');
  expect(req.isNew).toBe(true);
});

it('threads the spec path + workflow into the env', () => {
  const req = buildCreateLaunch({
    project: 'bakers',
    cwd: '/repo',
    specPath: '/tmp/new.json',
    workflow: 'bb_work',
    label: 'New work',
  });
  expect(req.env.BB_NEW_TICKET_INPUT).toBe('/tmp/new.json');
  expect(req.env.BB_WORKFLOW).toBe('bb_work');
  expect(req.label).toBe('New work');
});

it('createPrompt overrides the built-in default create prompt', () => {
  const req = buildCreateLaunch({
    project: 'bakers',
    cwd: '/repo',
    createPrompt: 'CUSTOM: make a ticket',
  });
  expect(req.prompt).toBe('CUSTOM: make a ticket');
  expect(req.prompt).not.toMatch(/bb-create-ticket/);
});

it('a blank createPrompt falls back to the default', () => {
  const req = buildCreateLaunch({
    project: 'bakers',
    cwd: '/repo',
    createPrompt: '   ',
  });
  expect(req.prompt).toMatch(/bb-create-ticket/);
});

// ---- BB-309 D9 ------------------------------------------------------------
//
// APPENDED. The tab label is what the operator NAMED the ticket, not the first
// line of its body. This is the launch intent's `label` and nothing else — AC-6
// pins `prompt` and `env` as they are.

it('BB-309 D9: shortName prefers the title, then the description', () => {
  expect(shortName(payload({ title: 'Add login', description: 'body' }))).toBe(
    'Add login',
  );
  expect(shortName(payload({ title: '   ', description: 'Fallback' }))).toBe(
    'Fallback',
  );
  const long = 'x'.repeat(60);
  expect(shortName(payload({ title: long })).length).toBe(40);
});

it('BB-309 D9: the title changes the LABEL and nothing else', () => {
  const launch = buildCreateLaunch({
    project: 'bakers',
    cwd: '/repo',
    label: shortName(payload({ title: 'T' })),
  });
  expect(launch.label).toBe('T');
  // prompt and env are what AC-6 pins; neither knows about the title.
  expect(launch.prompt).toContain('bb-create-ticket');
  expect(launch.env.BB_ID).toBeUndefined();
  expect(JSON.stringify(launch.env)).not.toContain('"T"');
});
