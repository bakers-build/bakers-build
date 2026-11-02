import { describe, expect, it, vi } from 'vitest';
import { type AskApi, askQuestion } from '../src/ticket-ask.js';

const TICKET = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const GROUP = '99999999-9999-4999-8999-999999999999';
const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const OTHER_WORKSPACE = '44444444-4444-4444-8444-444444444444';
const EXISTING_LABEL = '55555555-5555-4555-8555-555555555555';

interface Row {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: unknown }>;
}

/** An in-memory bakers.build site: the tool calls and the JSON:API resources the command uses. */
function fakeSite(
  options: { questionTerm?: 'here' | 'elsewhere' | 'none'; failPatch?: boolean } = {},
) {
  const rows = new Map<string, Row>();
  const put = (row: Row) => rows.set(`${row.type}/${row.id}`, row);
  put({
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: { identifier: 'DEMO-7', frozen: false },
    relationships: {
      project_id: { data: { type: 'bb_project--bb_project', id: PROJECT } },
      labels: {
        data: [{ type: 'bb_term--label', id: EXISTING_LABEL }],
      },
    },
  });
  put({
    id: PROJECT,
    type: 'bb_project--bb_project',
    attributes: {},
    relationships: {
      group_id: { data: { type: 'bb_group--bb_group', id: GROUP } },
    },
  });
  put({
    id: GROUP,
    type: 'bb_group--bb_group',
    attributes: {},
    relationships: {
      workspace_id: {
        data: { type: 'bb_workspace--bb_workspace', id: WORKSPACE },
      },
    },
  });
  const term = (id: string, name: string, workspace: string) =>
    put({
      id,
      type: 'bb_term--label',
      attributes: { name },
      relationships: {
        workspace_id: {
          data: { type: 'bb_workspace--bb_workspace', id: workspace },
        },
      },
    });
  term(EXISTING_LABEL, 'Backend', WORKSPACE);
  if (options.questionTerm === 'here')
    term('66666666-6666-4666-8666-666666666666', 'Question', WORKSPACE);
  if (options.questionTerm === 'elsewhere')
    term('77777777-7777-4777-8777-777777777777', 'Question', OTHER_WORKSPACE);

  const comments: { ticket: string; type: string; body: string }[] = [];
  let created = 0;
  const rel = (row: Row, key: string) => row.relationships[key]?.data;
  const api: AskApi = {
    tool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'bakers_ticket_read')
        return { id: TICKET, identifier: 'DEMO-7' };
      if (name === 'bakers_comment_publish') {
        comments.push(args as (typeof comments)[number]);
        return { id: `comment-${comments.length}`, type: args.type };
      }
      throw new Error(`unexpected tool ${name}`);
    }),
    async read(type, id) {
      const row = rows.get(`${type}/${id}`);
      if (!row) throw new Error(`404 ${type}/${id}`);
      return structuredClone(row);
    },
    async findLabel(name, workspace) {
      for (const row of rows.values()) {
        const ws = rel(row, 'workspace_id') as { id: string } | undefined;
        if (
          row.type === 'bb_term--label' &&
          row.attributes.name === name &&
          ws?.id === workspace
        )
          return row.id;
      }
      return null;
    },
    async createLabel(name, workspace) {
      created++;
      const id = `88888888-8888-4888-8888-88888888888${created}`;
      term(id, name, workspace);
      return id;
    },
    async patchTicket(id, body) {
      if (options.failPatch) throw new Error('403 Forbidden');
      const row = rows.get(`bb_ticket--bb_ticket/${id}`) as Row;
      Object.assign(row.attributes, body.attributes);
      Object.assign(row.relationships, body.relationships);
    },
  };
  return {
    api,
    comments,
    rows,
    labelsOf: () =>
      (
        rel(rows.get(`bb_ticket--bb_ticket/${TICKET}`) as Row, 'labels') as {
          id: string;
        }[]
      ).map((l) => l.id),
    frozen: () =>
      (rows.get(`bb_ticket--bb_ticket/${TICKET}`) as Row).attributes.frozen,
    termsNamedQuestion: () =>
      [...rows.values()].filter(
        (r) => r.type === 'bb_term--label' && r.attributes.name === 'Question',
      ),
  };
}

const BODY = '# Question\n\nWhich storage?\n\n1. Redis (recommended)\n2. Files\n';

describe('bakers ticket ask', () => {
  it('publishes the question as one comment, labels the ticket Question and freezes it', async () => {
    const site = fakeSite({ questionTerm: 'here' });
    const result = await askQuestion(site.api, 'DEMO-7', BODY);

    expect(site.comments).toEqual([
      { ticket: TICKET, type: 'comment', body: BODY },
    ]);
    expect(site.labelsOf()).toEqual([
      EXISTING_LABEL,
      '66666666-6666-4666-8666-666666666666',
    ]);
    expect(site.frozen()).toBe(true);
    expect(result).toEqual({
      ticket: TICKET,
      comment: 'comment-1',
      label: {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'Question',
        created: false,
      },
      frozen: true,
    });
  });

  it('creates the Question label in the ticket workspace when that workspace has none', async () => {
    const site = fakeSite({ questionTerm: 'elsewhere' });
    const result = await askQuestion(site.api, 'DEMO-7', BODY);

    const mine = site
      .termsNamedQuestion()
      .filter(
        (t) =>
          (t.relationships.workspace_id?.data as { id: string }).id ===
          WORKSPACE,
      );
    expect(mine).toHaveLength(1);
    expect(result.label).toEqual({
      id: mine[0]?.id,
      name: 'Question',
      created: true,
    });
    expect(site.labelsOf()).toContain(mine[0]?.id);
  });

  it('keeps an already set Question label once', async () => {
    const site = fakeSite({ questionTerm: 'here' });
    await askQuestion(site.api, 'DEMO-7', BODY);
    await site.api.patchTicket(TICKET, { attributes: { frozen: false } });
    await askQuestion(site.api, 'DEMO-7', BODY);

    expect(site.labelsOf()).toEqual([
      EXISTING_LABEL,
      '66666666-6666-4666-8666-666666666666',
    ]);
  });

  it('refuses an empty question without writing anything', async () => {
    const site = fakeSite({ questionTerm: 'here' });
    await expect(askQuestion(site.api, 'DEMO-7', ' \n')).rejects.toThrow(
      /empty/,
    );
    expect(site.comments).toEqual([]);
    expect(site.frozen()).toBe(false);
  });

  it('names the steps already done when a later step fails and publishes only once', async () => {
    const site = fakeSite({ questionTerm: 'none', failPatch: true });
    const error = await askQuestion(site.api, 'DEMO-7', BODY).catch(
      (e: unknown) => e as Error & { done?: string[] },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/403 Forbidden/);
    expect(error.message).toMatch(/comment-1/);
    expect(error.done).toEqual(['comment', 'label']);
    expect(site.comments).toHaveLength(1);
    expect(site.frozen()).toBe(false);
  });
});
