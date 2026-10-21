import { expect, it } from 'bun:test';
import {
  FIELDS,
  FIELDS_WITH_PROJECT,
} from '../../src/Entity/ticket/Form/create.js';
import type {
  ResolvedRoute,
  TuiAgentService,
  TuiOptions,
} from '../../src/types.js';
import {
  type FakeClientOptions,
  fakeClient,
  toResource,
} from '../../tests/test-support.js';
import { bootTui } from '../tui-harness.js';

// The template picker in the New-ticket popup, over the real kernel.

const PROJECT = 'dddddddd-0000-0000-0000-000000000001';
const PROJECT_B = 'dddddddd-0000-0000-0000-000000000002';
const TEMPLATE = 'eeeeeeee-0000-0000-0000-000000000001';
const ROUTE: ResolvedRoute = {
  screen: 'project',
  projectId: PROJECT,
  projectName: 'bakers',
};
const immediate = (fn: () => void): (() => void) => {
  fn();
  return () => {};
};

const doc = () => ({
  data: { id: 'ticket-1', attributes: { identifier: 'BB-9' } },
  meta: { created: true },
});

const base = (): FakeClientOptions => ({
  rows: {
    bb_ticket_template: [
      toResource({
        id: TEMPLATE,
        type: 'bb_ticket_template--bb_ticket_template',
        attributes: { name: 'Weekly review', enabled: true },
      }),
    ],
  },
  postDocument: doc(),
});

const plain = (frame: string): string =>
  frame
    .replace(/[│╭╮╰╯─]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const agents: TuiAgentService = {
  launch: async (o) => ({ id: 'a', group: o.group, label: o.label ?? '' }),
  list: async () => [],
  focus: async () => {},
  hide: async () => {},
  kill: async () => {},
};

async function open(over: Partial<TuiOptions>, options: FakeClientOptions) {
  const client = fakeClient(options);
  const tui = await bootTui({
    services: { client, baseUrl: 'https://x.test' },
    tui: { agents, project: 'bakers', cwd: '/repo', ...over },
  });
  await tui.press('n');
  const frame = () => plain(tui.frame());
  const down = async (from: string, to: string, ids = FIELDS) => {
    const n =
      ids.findIndex((f) => f.id === to) - ids.findIndex((f) => f.id === from);
    for (let i = 0; i < Math.abs(n); i++)
      await tui.press(n > 0 ? '\x1b[B' : '\x1b[A');
  };
  return { client, tui, frame, down };
}

const quit = async (d: Awaited<ReturnType<typeof open>>) => {
  await d.tui.press('\x1b');
  d.tui.mockInput.pressKey('q');
  await d.tui.running;
  await d.tui.stop();
};

it('opens with no template picked', async () => {
  const d = await open({ route: ROUTE }, base());
  expect(d.frame()).toContain('Template: < — none — >');
  await quit(d);
});

it('a picked template runs instead of the ordinary create: one POST, no create', async () => {
  const d = await open({ route: ROUTE }, base());
  await d.down('title', 'template');
  await d.tui.press('\x1b[C');
  expect(d.frame()).toContain('Template: < Weekly review >');
  await d.tui.press('\x04'); // Ctrl+D
  expect(d.client.creates).toEqual([]);
  expect(d.client.posts).toEqual([
    {
      path: `bb_ticket_template/bb_ticket_template/${TEMPLATE}/instantiate`,
      body: {
        data: {
          type: 'bb_ticket--bb_ticket',
          relationships: {
            project_id: {
              data: { type: 'bb_project--bb_project', id: PROJECT },
            },
          },
        },
      },
    },
  ]);
  await quit(d);
});

it('a server error is shown, the guard resets and a retry posts again', async () => {
  const d = await open(
    { route: ROUTE },
    {
      ...base(),
      postError: Object.assign(new Error('HTTP 422'), {
        status: 422,
        body: { errors: [{ detail: 'Template is invalid.' }] },
      }),
    },
  );
  await d.down('title', 'template');
  await d.tui.press('\x1b[C');
  await d.tui.press('\x04');
  expect(d.frame()).toContain('Template is invalid.');
  await d.tui.press('\x04');
  expect(d.client.posts).toHaveLength(2);
  await quit(d);
});

it('without a template the ordinary direct create is unchanged', async () => {
  const d = await open({ route: ROUTE }, base());
  for (const c of 'Plain') await d.tui.press(c);
  await d.tui.press('\x04');
  expect(d.client.creates).toHaveLength(1);
  expect(d.client.posts).toEqual([]);
  await quit(d);
});

it('changing the project resets the picked template', async () => {
  const d = await open(
    { route: undefined, project: undefined, debounce: immediate },
    {
      ...base(),
      documents: {
        'bb_project/bb_project': {
          data: [
            {
              id: PROJECT_B,
              type: 'bb_project--bb_project',
              attributes: { name: 'atlas' },
            },
          ],
        },
      },
    },
  );
  // Pick a project, then a template, then change the project again.
  for (const c of 'at') await d.tui.press(c);
  await d.tui.press('\r');
  await d.down('project', 'template', FIELDS_WITH_PROJECT);
  await d.tui.press('\x1b[C');
  expect(d.frame()).toContain('Template: < Weekly review >');
  await d.down('template', 'project', FIELDS_WITH_PROJECT);
  await d.tui.press('x'); // editing the query drops the pick
  expect(d.frame()).toContain('Template: < — none — >');
  await quit(d);
});
