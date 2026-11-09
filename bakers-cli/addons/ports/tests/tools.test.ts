import type { ToolRequest } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';
import type { ClaimedService } from '../src/claims.js';
import type { TunnelDesiredRecord } from '../src/core.js';
import { type PortsToolDeps, portsTools } from '../src/tools.js';

function service(
  overrides: Partial<ClaimedService> & { key: string },
): ClaimedService {
  return {
    claim: 'container',
    status: 'healthy',
    local: `https://${overrides.key}.site.test`,
    rawPorts: [],
    rules: [{ key: overrides.key, service: 'https://127.0.0.1:443' }],
    ...overrides,
  };
}

const transport = {
  id: 'test-transport',
  identity: 'test-transport',
  zone: 'example.test',
  validateData: () => {},
  reconcile: async (records: readonly TunnelDesiredRecord[]) => ({
    records,
    ok: true,
  }),
};

function fixture(services: ClaimedService[]) {
  const calls: string[] = [];
  let records: TunnelDesiredRecord[] = [];
  const deps: PortsToolDeps = {
    loadTransport: async () => ({ ok: true, transport }),
    discover: async (worktree, ticket) => {
      calls.push(`discover:${worktree}:${ticket}`);
      return { services, unclaimed: [], diagnostics: [] };
    },
    readRecords: async () => records,
    bringUp: async (rule, ctx) => {
      calls.push(`up:${ctx.worktree}:${rule.key}`);
      const hostname = `${ctx.ticket.toLowerCase()}-${rule.key}.example.test`;
      records = [
        ...records.filter((r) => r.key !== rule.key),
        {
          worktree: ctx.worktree,
          ticket: ctx.ticket,
          key: rule.key,
          hostname,
          url: `https://${hostname}`,
          service: rule.service,
          desired: 'present',
          applied: 'applied',
        },
      ];
      return { ok: true, message: `shared at https://${hostname}` };
    },
    takeDown: async (worktree, key) => {
      calls.push(`down:${worktree}:${key}`);
      records = records.filter((r) => key !== undefined && r.key !== key);
      return { ok: true, message: 'stopped 1 tunnel(s)' };
    },
    reap: async () => ({ ok: true, removedRecords: 0, message: 'nothing' }),
    branch: () => 'feat/bb-7-some-work',
    home: () => '/home/.bakers',
  };
  return { tools: portsTools(deps), calls };
}

function request(args: Record<string, unknown>, ticket?: string): ToolRequest {
  return {
    worktreePath: '/nonexistent/wt',
    ...(ticket ? { ticket: { identifier: ticket } } : {}),
    args,
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    callTool: async () => ({ text: '' }),
  };
}

describe('ports tools', () => {
  it("ports_up shares a claimed service of the run's worktree and returns its URL", async () => {
    const { tools, calls } = fixture([service({ key: 'web' })]);
    const result = await tools.ports_up!(request({ service: 'web' }, 'BB-7'));
    expect(result.text).toContain('https://bb-7-web.example.test');
    expect(calls).toContain('up:/nonexistent/wt:web');
  });

  it('ports_up refuses an unclaimed service, a URL or an IP and lists the claimed keys', async () => {
    const { tools, calls } = fixture([
      service({ key: 'web' }),
      service({ key: 'mailpit' }),
    ]);
    for (const target of ['other', 'http://10.0.0.5:8080', '10.0.0.5']) {
      await expect(
        tools.ports_up!(request({ service: target }, 'BB-7')),
      ).rejects.toThrow(/no claimed service .*Known services: web, mailpit/);
    }
    expect(calls.filter((c) => c.startsWith('up:'))).toEqual([]);
  });

  it('takes the ticket from the branch when the binding has none', async () => {
    const { tools, calls } = fixture([service({ key: 'web' })]);
    await tools.ports_up!(request({ service: 'web' }));
    expect(calls).toContain('discover:/nonexistent/wt:BB-7');
  });

  it('ports_status answers JSON rows; ports_down stops the key', async () => {
    const { tools, calls } = fixture([service({ key: 'web' })]);
    await tools.ports_up!(request({ service: 'web' }, 'BB-7'));
    const status = JSON.parse((await tools.ports_status!(request({}))).text);
    expect(status).toEqual([
      {
        service: 'web',
        status: 'applied',
        local: 'https://127.0.0.1:443',
        url: 'https://bb-7-web.example.test',
      },
    ]);
    await tools.ports_down!(request({ service: 'web' }));
    expect(calls).toContain('down:/nonexistent/wt:web');
  });

  it('fails naming the cause when the transport cannot load', async () => {
    const { tools } = fixture([]);
    const broken = portsTools({
      ...({} as PortsToolDeps),
      loadTransport: async () => ({ ok: false, message: 'no ports entry' }),
    });
    expect(tools.ports_up).toBeDefined();
    await expect(
      broken.ports_up!(request({ service: 'web' }, 'BB-7')),
    ).rejects.toThrow('no ports entry');
  });
});
