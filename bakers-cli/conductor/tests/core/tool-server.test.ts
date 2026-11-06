import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startToolServer,
  type ToolServer,
} from '../../src/core/tool-server.js';
import { loadTools } from '../../src/plugins/tools.js';

async function registry() {
  return loadTools([
    {
      name: 'demo',
      version: '1.0.0',
      tools: {
        contract: 1,
        tools: {
          where: {
            description: 'Where am I',
            input: {
              type: 'object',
              properties: { note: { type: 'string' } },
            },
          },
          boom: { description: 'Fails' },
        },
        handlers: async () => ({
          where: async (req) => ({ text: req.worktreePath }),
          boom: async () => {
            throw new Error('it broke');
          },
        }),
      },
    },
  ]);
}

let server: ToolServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe('conductor tool server', () => {
  it("serves the addon tools bound to the run token's worktree", async () => {
    server = await startToolServer({ registry: await registry() });
    const token = server.issueRunToken({ worktreePath: '/work/bb-1' });
    const client = await connect(server.url, token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['where', 'boom']);
    const result = await client.callTool({ name: 'where', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '/work/bb-1' }]);
    await client.close();
  });

  it('refuses a worktree argument and reports handler errors as isError', async () => {
    server = await startToolServer({ registry: await registry() });
    const client = await connect(
      server.url,
      server.issueRunToken({ worktreePath: '/work/bb-1' }),
    );
    const wrong = await client.callTool({
      name: 'where',
      arguments: { worktree: '/work/other' },
    });
    expect(wrong.isError).toBe(true);
    const boom = await client.callTool({ name: 'boom', arguments: {} });
    expect(boom).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'it broke' }],
    });
    await client.close();
  });

  it('answers 401 for an unknown or revoked run token', async () => {
    server = await startToolServer({ registry: await registry() });
    const token = server.issueRunToken({ worktreePath: '/work/bb-1' });
    server.revokeRunToken(token);
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/unknown run token/);
  });

  it('lets only the operator token name a worktree, under the workspace root', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bb-tool-server-'));
    const endpointFile = join(home, 'conductors', 'c1.json');
    server = await startToolServer({
      registry: await registry(),
      endpointFile,
      workspaceRoot: '/work',
    });
    const endpoint = JSON.parse(readFileSync(endpointFile, 'utf8'));
    expect(endpoint).toMatchObject({
      url: server.url,
      workspaceRoot: '/work',
      pid: process.pid,
    });
    expect(statSync(endpointFile).mode & 0o777).toBe(0o600);

    const call = (token: string, worktree: string) =>
      fetch(`${endpoint.url}/call`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tool: 'where', args: {}, worktree }),
      });
    const ok = await call(endpoint.operatorToken, '/work/bb-2');
    expect(await ok.json()).toEqual({ text: '/work/bb-2' });
    const outside = await call(endpoint.operatorToken, '/etc');
    expect(outside.status).toBe(403);
    const asRun = await call(
      server.issueRunToken({ worktreePath: '/work/bb-1' }),
      '/work/bb-2',
    );
    expect(asRun.status).toBe(401);

    await server.stop();
    server = undefined;
    expect(() => statSync(endpointFile)).toThrow();
  });
});

const PROJECT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROJECT_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const WORKSPACE_A = 'cccccccc-0000-4000-8000-000000000003';

/** A stand-in for the site's `/mcp`: three tickets in two projects. */
function fakeSite(failLists = 0) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const projectOf: Record<string, string> = {
    'BB-1': PROJECT_A,
    'BB-2': PROJECT_A,
    'XX-9': PROJECT_B,
  };
  const keyOf: Record<string, string> = { BB: PROJECT_A, XX: PROJECT_B };
  const schema = (prop: string) => ({
    type: 'object',
    properties: { [prop]: { type: 'string' } },
  });
  return {
    calls,
    async list() {
      if (failLists-- > 0) throw new Error('site down');
      return [
        { name: 'tool_api__bakers_ticket_read', inputSchema: schema('ticket') },
        {
          name: 'tool_api__bakers_ticket_search',
          inputSchema: schema('query'),
        },
        {
          name: 'tool_api__bakers_ticket_update',
          inputSchema: schema('ticket'),
        },
        {
          name: 'tool_api__bakers_ticket_create',
          inputSchema: schema('title'),
        },
        {
          name: 'tool_api__bakers_label_list',
          inputSchema: schema('workspace'),
        },
        {
          name: 'tool_api__bakers_project_read',
          inputSchema: schema('project'),
        },
        {
          name: 'tool_api__bakers_project_create',
          inputSchema: schema('name'),
        },
      ];
    },
    async call(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const json = (v: unknown) => ({
        content: [{ type: 'text', text: JSON.stringify(v) }],
      });
      if (name === 'tool_api__bakers_ticket_read') {
        const project = projectOf[String(args.ticket)];
        if (!project) throw new Error(`Ticket ${args.ticket} does not exist.`);
        return json({ identifier: args.ticket, project });
      }
      if (name === 'tool_api__bakers_project_read') {
        const uuid = keyOf[String(args.project)] ?? args.project;
        return json({ uuid, key: 'K' });
      }
      return json({ ok: name, args });
    },
    async close() {},
  };
}

const runBinding = (projectId?: string) => ({
  worktreePath: '/work/bb-1',
  ticket: {
    uuid: 't-1',
    identifier: 'BB-1',
    ...(projectId ? { projectId, workspaceId: WORKSPACE_A } : {}),
  },
});

describe('site tools on the bakers server', () => {
  it("lists the addon tools plus the allowlisted site tools under their plain name, with the site's schema", async () => {
    server = await startToolServer({
      registry: await registry(),
      siteTools: fakeSite(),
    });
    const client = await connect(
      server.url,
      server.issueRunToken(runBinding(PROJECT_A)),
    );
    expect(client.getServerVersion()?.name).toBe('bakers');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'where',
      'boom',
      'bakers_ticket_read',
      'bakers_ticket_search',
      'bakers_ticket_update',
      'bakers_ticket_create',
      'bakers_label_list',
      'bakers_project_read',
    ]);
    expect(
      tools.find((t) => t.name === 'bakers_ticket_read')?.inputSchema,
    ).toEqual({ type: 'object', properties: { ticket: { type: 'string' } } });
    await client.close();
  });

  it('serves the addon tools alone while the site is down, and the site tools once it answers', async () => {
    const warnings: string[] = [];
    const quiet = () => {};
    server = await startToolServer({
      registry: await registry(),
      siteTools: fakeSite(1),
      logger: {
        debug: quiet,
        info: quiet,
        error: quiet,
        warn: (_obj: object, msg?: string) => warnings.push(msg ?? ''),
      },
    });
    const client = await connect(
      server.url,
      server.issueRunToken(runBinding(PROJECT_A)),
    );
    const down = await client.listTools();
    expect(down.tools.map((t) => t.name)).toEqual(['where', 'boom']);
    expect(warnings).toEqual([
      'site tools unreachable; serving addon tools only',
    ]);
    const up = await client.listTools();
    expect(up.tools.map((t) => t.name)).toContain('bakers_ticket_read');
    await client.close();
  });

  it("refuses every argument outside the run ticket's project and sends that call nowhere", async () => {
    const site = fakeSite();
    server = await startToolServer({
      registry: await registry(),
      siteTools: site,
    });
    const client = await connect(
      server.url,
      server.issueRunToken(runBinding(PROJECT_A)),
    );
    const refused = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      return (result.content as Array<{ text: string }>)[0]?.text;
    };
    expect(await refused('bakers_ticket_read', { ticket: 'XX-9' })).toBe(
      `bakers_ticket_read: ticket XX-9 belongs to project ${PROJECT_B}, this run may only touch project ${PROJECT_A}`,
    );
    expect(
      await refused('bakers_ticket_search', { query: 'x', project: 'XX' }),
    ).toBe(
      `bakers_ticket_search: project XX belongs to project ${PROJECT_B}, this run may only touch project ${PROJECT_A}`,
    );
    expect(
      await refused('bakers_ticket_create', {
        title: 't',
        project: PROJECT_A,
        parent: 'XX-9',
      }),
    ).toMatch(/^bakers_ticket_create: parent XX-9 belongs to project/);
    expect(
      await refused('bakers_ticket_update', {
        ticket: 'BB-2',
        referenced_tickets_add: ['BB-1', 'XX-9'],
      }),
    ).toMatch(/^bakers_ticket_update: referenced_tickets_add XX-9 belongs/);
    expect(
      await refused('bakers_label_list', { workspace: 'other-workspace' }),
    ).toBe(
      `bakers_label_list: workspace other-workspace is not the workspace ${WORKSPACE_A} of project ${PROJECT_A}`,
    );
    // an empty project reads as "every project" on the site
    expect(await refused('bakers_project_read', { project: '' })).toBe(
      `bakers_project_read: an empty project would mean every project; this run may only touch project ${PROJECT_A}`,
    );
    expect(await refused('bakers_ticket_read', { ticket: 'NOPE-1' })).toMatch(
      /Ticket NOPE-1 does not exist/,
    );
    expect(
      site.calls.filter(
        (c) =>
          c.name !== 'tool_api__bakers_ticket_read' &&
          c.name !== 'tool_api__bakers_project_read',
      ),
    ).toEqual([]);
    await client.close();

    const unbound = await connect(
      server.url,
      server.issueRunToken(runBinding()),
    );
    const result = await unbound.callTool({
      name: 'bakers_ticket_read',
      arguments: { ticket: 'BB-1' },
    });
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          text: "bakers_ticket_read: this run's ticket has no project, so it may call no site tool",
        },
      ],
    });
    await unbound.close();
  });

  it("fills in the run's project and workspace and forwards own-project calls once, returning the site's result", async () => {
    const site = fakeSite();
    server = await startToolServer({
      registry: await registry(),
      siteTools: site,
    });
    const client = await connect(
      server.url,
      server.issueRunToken(runBinding(PROJECT_A)),
    );
    const search = await client.callTool({
      name: 'bakers_ticket_search',
      arguments: { query: 'x' },
    });
    expect(search.isError).toBeFalsy();
    await client.callTool({ name: 'bakers_label_list', arguments: {} });
    await client.callTool({
      name: 'bakers_ticket_search',
      arguments: { query: 'y', project: '' },
    });
    await client.callTool({
      name: 'bakers_label_list',
      arguments: { workspace: '' },
    });
    const read = await client.callTool({
      name: 'bakers_ticket_read',
      arguments: { ticket: 'BB-1' },
    });
    expect(read.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ identifier: 'BB-1', project: PROJECT_A }),
      },
    ]);
    await client.callTool({
      name: 'bakers_project_read',
      arguments: { project: 'BB' },
    });
    expect(site.calls).toEqual([
      {
        name: 'tool_api__bakers_ticket_search',
        args: { query: 'x', project: PROJECT_A },
      },
      {
        name: 'tool_api__bakers_label_list',
        args: { workspace: WORKSPACE_A },
      },
      {
        name: 'tool_api__bakers_ticket_search',
        args: { query: 'y', project: PROJECT_A },
      },
      {
        name: 'tool_api__bakers_label_list',
        args: { workspace: WORKSPACE_A },
      },
      { name: 'tool_api__bakers_ticket_read', args: { ticket: 'BB-1' } },
      // the key is resolved once, then the call itself goes out
      { name: 'tool_api__bakers_project_read', args: { project: 'BB' } },
      { name: 'tool_api__bakers_project_read', args: { project: 'BB' } },
    ]);
    await client.close();
  });
});
