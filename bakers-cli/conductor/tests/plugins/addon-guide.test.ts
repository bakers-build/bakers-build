import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeBbRemote } from '@bakers-build/addon-fake';
import { discoverAddons } from '@bakers-build/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InboxRuntime } from '../../src/core/inbox-runtime.js';
import { loadInbox } from '../../src/plugins/message.js';
import { loadTools } from '../../src/plugins/tools.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bakers-addon-guide-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'notes.md'), 'First line\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function loadGuide(
  page = 'control-panel',
  name = 'worktree-check',
  section?: string,
) {
  let guide = readFileSync(
    new URL(`../../../../docs/addons/build/${page}.md`, import.meta.url),
    'utf8',
  );
  if (section)
    guide = guide.split(`## ${section}\n`)[1]?.split('\n## ')[0] ?? '';
  const blocks = [...guide.matchAll(/^```(json|js)\n([\s\S]*?)^```/gm)];
  const manifest = blocks.find((b) => b[1] === 'json')?.[2];
  const preset = blocks.find((b) => b[1] === 'js')?.[2];
  if (!manifest || !preset) throw new Error('guide example is incomplete');
  const configDir = join(dir, '.bakers');
  const addonDir = join(configDir, 'addons', name);
  mkdirSync(addonDir, { recursive: true });
  writeFileSync(join(addonDir, 'package.json'), manifest);
  writeFileSync(join(addonDir, 'preset.js'), preset);
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Example',
      '-c',
      'user.email=example@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'Fixture',
    ],
    { cwd: dir },
  );
  return discoverAddons([`./addons/${name}`], 'conductor', [
    join(configDir, 'conductor.config.js'),
    fileURLToPath(new URL('../../../package.json', import.meta.url)),
  ]);
}

it('reports a clean worktree and rejects arguments to the dirty-check tool', async () => {
  const found = await loadGuide();
  const tools = await loadTools(found.addonTools);
  writeFileSync(join(dir, 'ignored.txt'), 'Ignored content\n');
  await expect(
    tools.call('git_is_dirty', {}, { worktreePath: dir }),
  ).resolves.toEqual({
    text: 'Clean: no uncommitted changes.',
  });
  await expect(
    tools.call('git_is_dirty', { path: '/' }, { worktreePath: dir }),
  ).rejects.toThrow('invalid arguments');
});

it.each([
  'unstaged',
  'staged',
  'untracked',
  'deleted',
])('reports %s changes as dirty without modifying the patch', async (kind) => {
  const found = await loadGuide();
  if (kind === 'deleted') unlinkSync(join(dir, 'notes.md'));
  else
    writeFileSync(
      join(dir, kind === 'untracked' ? 'new.md' : 'notes.md'),
      'Changed\n',
    );
  if (kind === 'staged') execFileSync('git', ['add', 'notes.md'], { cwd: dir });
  const status = () =>
    execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: dir,
      encoding: 'utf8',
    });
  const before = status();
  const tools = await loadTools(found.addonTools);
  await expect(
    tools.call('git_is_dirty', {}, { worktreePath: dir }),
  ).resolves.toEqual({
    text: 'Dirty: uncommitted changes are present.',
  });
  expect(status()).toBe(before);
});

it('honours cancellation of the dirty-check tool', async () => {
  const found = await loadGuide();
  const tools = await loadTools(found.addonTools);
  const abort = new AbortController();
  abort.abort();
  await expect(
    tools.call(
      'git_is_dirty',
      {},
      { worktreePath: dir },
      { signal: abort.signal },
    ),
  ).rejects.toThrow(/aborted/i);
});

it('runs the ticket button in its bound worktree and distinguishes dirty from failure', async () => {
  const found = await loadGuide();
  const tools = await loadTools(found.addonTools);
  const call = vi.spyOn(tools, 'call');
  const inbox = await loadInbox(
    found.addonInbox[0],
    undefined,
    new Set(tools.list().map((tool) => tool.name)),
  );
  expect(inbox.messages.is_dirty).toEqual({
    label: 'Is dirty?',
    access: 'view',
  });
  const remote = new FakeBbRemote({
    tickets: {
      't-1': { identifier: 'EXAMPLE-1', title: 'Is dirty?', state: 'working' },
    },
  });
  const runtime = new InboxRuntime(
    [inbox],
    remote,
    console,
    async () => ({}),
    tools,
  );
  const request = {
    id: 'req-1',
    messageId: `${inbox.name}.is_dirty`,
    version: inbox.version,
    ticketUuid: 't-1',
    requestedBy: 'user-1',
    worktreePath: dir,
    payload: {},
  };
  await expect(runtime.handle(request)).resolves.toEqual({
    status: 'done',
    result: { markdown: 'Clean: no uncommitted changes.' },
  });
  expect(call).toHaveBeenCalledWith(
    'git_is_dirty',
    {},
    { worktreePath: dir, ticket: await remote.getTicket('t-1') },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  writeFileSync(join(dir, 'new.md'), 'New\n');
  await expect(runtime.handle(request)).resolves.toEqual({
    status: 'done',
    result: { markdown: 'Dirty: uncommitted changes are present.' },
  });
  const invalid = await runtime.handle({ ...request, payload: { path: '/' } });
  expect(invalid.status).toBe('failed');
  expect(invalid.result.markdown).toContain('invalid arguments');
  const missing = await runtime.handle({
    ...request,
    worktreePath: join(dir, 'missing'),
  });
  expect(missing.status).toBe('failed');
  expect(missing.result.markdown).toContain('no worktree');
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  const failed = await runtime.handle(request);
  expect(failed.status).toBe('failed');
  expect(failed.result.markdown).toContain('not a git repository');
});

it('loads the agent example as one named Claude candidate', async () => {
  const found = await loadGuide('first-addon', 'review-agent', 'Add an agent');
  expect(found.agents).toMatchObject([
    {
      alias: 'review',
      model: 'sonnet',
      agent: { kind: 'agent', id: 'claude' },
    },
  ]);
  expect(found.agents).toHaveLength(1);
});

it('loads the client example as a herdr-core executor with a Git workspace', async () => {
  const found = await loadGuide(
    'first-addon',
    'project-client',
    'Add a client',
  );
  expect(found.executors).toMatchObject([
    { kind: 'executor', id: 'herdr-core' },
  ]);
  expect(found.workspaces).toMatchObject([{ kind: 'workspace', id: 'git' }]);
  expect(found.executors).toHaveLength(1);
  expect(found.workspaces).toHaveLength(1);
  expect(found.agents).toEqual([]);
  expect(found.remotes).toEqual([]);
});
