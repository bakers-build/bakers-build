import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolRequest } from '@bakers-build/conductor/contract';
import { afterEach, expect, it, vi } from 'vitest';
import { tools as presetTools } from '../src/preset.js';
import { deploymentTools } from '../src/tools.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it('reports the release range, resolved tickets and unknown identifiers using the run project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deployment-tools-'));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.test',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.test',
      },
    }).trim();
  git('init', '-q', '-b', 'main');
  git('commit', '--allow-empty', '-qm', 'initial');
  const since = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'feat: example\n\nref:SHOP-42');
  git('commit', '--allow-empty', '-qm', 'fix: unknown\n\nref:SHOP-99');
  const resolve = vi.fn(async (_project: string, id: string) =>
    id === 'SHOP-42' ? { uuid: 'ticket-42', title: 'Example' } : null,
  );
  const req: ToolRequest = {
    worktreePath: root,
    ticket: { identifier: 'SHOP-100', projectId: 'project-id' },
    args: { since, to: 'HEAD' },
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    callTool: async () => {
      throw new Error('Unexpected tool');
    },
  };
  expect(presetTools.tools.deployment_tickets).toBeDefined();
  const tools = deploymentTools(async () => ({
    resolveTicketByIdentifier: resolve,
  }));
  expect(JSON.parse((await tools.deployment_tickets!(req)).text)).toEqual({
    range: `${since}..HEAD`,
    resolved: [{ identifier: 'SHOP-42', uuid: 'ticket-42', title: 'Example' }],
    unresolved: ['SHOP-99'],
  });
  expect(resolve.mock.calls).toEqual([
    ['project-id', 'SHOP-99'],
    ['project-id', 'SHOP-42'],
  ]);
  await expect(
    tools.deployment_tickets!({ ...req, ticket: undefined }),
  ).rejects.toThrow('project');
  await expect(
    tools.deployment_tickets!({ ...req, args: { since: '--all', to: 'HEAD' } }),
  ).rejects.toThrow('ref');

  const cancelled = new AbortController();
  cancelled.abort(new Error('Cancelled deployment lookup'));
  resolve.mockClear();
  await expect(
    tools.deployment_tickets!({ ...req, signal: cancelled.signal }),
  ).rejects.toThrow('Cancelled deployment lookup');
  expect(resolve).not.toHaveBeenCalled();

  const duringLookup = new AbortController();
  resolve.mockImplementation(async () => {
    duringLookup.abort(new Error('Cancelled during lookup'));
    return null;
  });
  await expect(
    tools.deployment_tickets!({ ...req, signal: duringLookup.signal }),
  ).rejects.toThrow('Cancelled during lookup');
  expect(resolve).toHaveBeenCalledTimes(1);

  const pending = new AbortController();
  const inFlight = deploymentTools(async (signal) => ({
    resolveTicketByIdentifier: () =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
        pending.abort(new Error('Cancelled in flight'));
      }),
  }));
  await expect(
    inFlight.deployment_tickets!({ ...req, signal: pending.signal }),
  ).rejects.toThrow('Cancelled in flight');
});
