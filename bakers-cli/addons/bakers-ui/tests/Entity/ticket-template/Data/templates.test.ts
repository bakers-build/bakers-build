import { expect, it } from 'vitest';
import {
  listTemplatesForProject,
  runTemplate,
  TEMPLATE_RUN_PATH,
} from '../../../../src/Entity/ticket-template/Data/templates.js';
import { fakeClient, toResource } from '../../../test-support.js';

const tpl = (id: string, attrs: Record<string, unknown>) =>
  toResource({
    id,
    type: 'bb_ticket_template--bb_ticket_template',
    attributes: attrs,
  });

it('lists the enabled templates of one project as labelled rows', async () => {
  const client = fakeClient({
    rows: {
      'bb_ticket_template/bb_ticket_template': [
        tpl('t1', { name: 'Weekly review', enabled: true }),
        tpl('t2', { name: 'Off', enabled: false }),
        tpl('t3', { name: '' }),
      ],
    },
  });
  const out = await listTemplatesForProject(client, 'p1');
  expect(out.rows).toEqual([
    { id: 't1', label: 'Weekly review' },
    { id: 't3', label: 't3' },
  ]);
  expect(client.filters).toEqual([['project_id.id', '=', 'p1']]);
});

it('lists project and workspace templates, each once', async () => {
  const client = fakeClient({
    rows: {
      'bb_ticket_template/bb_ticket_template': [
        tpl('t1', { name: 'Weekly review', enabled: true }),
      ],
    },
  });
  const out = await listTemplatesForProject(client, 'p1', 'w1');
  expect(out.rows).toEqual([{ id: 't1', label: 'Weekly review' }]);
  expect(client.filters).toContainEqual(['project_id.id', '=', 'p1']);
  expect(client.filters).toContainEqual(['workspace_id.id', '=', 'w1']);
});

it('a failing read is an outcome with an error, not a throw', async () => {
  const client = fakeClient({
    failingCollections: ['bb_ticket_template/bb_ticket_template'],
  });
  const out = await listTemplatesForProject(client, 'p1');
  expect(out.rows).toEqual([]);
  expect(out.error).toMatch(/no bb_ticket_template/);
});

const doc = () => ({
  data: { id: 'tk1', attributes: { identifier: 'BB-9' } },
  meta: { created: true },
});

const projectBody = (projectId: string) => ({
  data: {
    type: 'bb_ticket--bb_ticket',
    relationships: {
      project_id: {
        data: { type: 'bb_project--bb_project', id: projectId },
      },
    },
  },
});

it('runTemplate sends the current project in exactly one POST', async () => {
  const client = fakeClient({ postDocument: doc() });
  const out = await runTemplate(client, 't1', 'p1');
  expect(out).toEqual({ ticketId: 'tk1', identifier: 'BB-9' });
  expect(client.posts).toEqual([
    { path: TEMPLATE_RUN_PATH('t1'), body: projectBody('p1') },
  ]);
});

it('does not retry a failed POST and lets the error through', async () => {
  const boom = new Error('boom');
  const client = fakeClient({ postError: boom });
  await expect(runTemplate(client, 't1', 'p1')).rejects.toBe(boom);
  expect(client.posts).toHaveLength(1);
});

it('an answer without a ticket is an error', async () => {
  const client = fakeClient({ postDocument: { data: null } });
  await expect(runTemplate(client, 't1', 'p1')).rejects.toThrow(/ticket/);
});
