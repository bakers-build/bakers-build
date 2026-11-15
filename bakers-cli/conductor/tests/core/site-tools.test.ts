import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_TOOLS, siteToolProxy } from '../../src/core/site-tools.js';
import type { SiteToolClient } from '../../src/plugins/remote.js';

const toolsMd = new URL(
  '../../../../.claude/skills/bakers-build/skills/bb-workflow/references/tools.md',
  import.meta.url,
);

describe('site tool allowlist', () => {
  it('serves every ticket tool the skills call in a run', () => {
    const references = new URL('./', toolsMd);
    const operations = readdirSync(references, { recursive: true })
      .filter((path) => path.endsWith('.md'))
      .map((path) => readFileSync(new URL(path, references), 'utf8'))
      .join('\n');
    const named = new Set(operations.match(/bakers_[a-z][a-z_]+/g));
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter((t) => !SITE_TOOLS.includes(t))).toEqual([]);
  });

  it('loads a tool that is not listed yet before falling back to the CLI', () => {
    const transport = readFileSync(toolsMd, 'utf8');
    const load = transport.indexOf('tool search');
    const cli = transport.indexOf('bakers tools <tool>');
    expect(load).toBeGreaterThanOrEqual(0);
    expect(cli).toBeGreaterThan(load);
    expect(transport).toContain('Conductor denial: load/retry MCP');
    expect(transport).toContain('that command alone was denied');
    expect(transport).toContain('Prefer listed MCP');
    expect(transport).toContain('Only if not loadable');
  });
});

describe('bakers_user_read in a run', () => {
  const binding = {
    worktreePath: '/w',
    ticket: { uuid: 't1', projectId: 'p1' },
  } as never;
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    list: async () => [],
    call: async (_name: string, args: Record<string, unknown>) => {
      sent.push(args);
      return { content: [] };
    },
  } as unknown as SiteToolClient;

  it('names the run conductor unless a user is given', async () => {
    sent.length = 0;
    const proxy = siteToolProxy(client, undefined, 'c-1');
    await proxy.call('bakers_user_read', {}, binding);
    await proxy.call('bakers_user_read', { user: 'a@b.c' }, binding);
    expect(sent).toEqual([{ conductor: 'c-1' }, { user: 'a@b.c' }]);
  });

  it('leaves the call unchanged without a conductor id', async () => {
    sent.length = 0;
    await siteToolProxy(client).call('bakers_user_read', {}, binding);
    expect(sent).toEqual([{}]);
  });
});
