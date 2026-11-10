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
import type {
  AgentCandidate,
  ConductorFileConfig,
  ExecutorPlugin,
  SpawnRunInput,
} from '../../src/contract.js';
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
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadGuide(
  page = 'control-panel',
  name = 'worktree-check',
  options?: unknown,
) {
  const guide = readFileSync(
    new URL(`../../../../docs/addons/build/${page}.md`, import.meta.url),
    'utf8',
  );
  const blocks = [...guide.matchAll(/^```(json|js)\n([\s\S]*?)^```/gm)];
  const manifest = blocks.find(
    (b) => b[1] === 'json' && JSON.parse(b[2]).name,
  )?.[2];
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
  return discoverAddons(
    [{ use: `./addons/${name}`, with: options }],
    'conductor',
    [
      join(configDir, 'conductor.config.js'),
      fileURLToPath(new URL('../../../package.json', import.meta.url)),
    ],
  );
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

it('loads a new harness that passes the prompt and run identity to its own program', async () => {
  const found = await loadGuide('agent', 'my-agent');
  expect(found.agents).toMatchObject([
    {
      alias: 'my-agent',
      agent: { kind: 'agent', id: 'my-agent' },
    },
  ]);
  expect(found.agents).toHaveLength(1);
  const [{ agent: plugin }] = found.agents as AgentCandidate[];
  const agent = await plugin.createAgent({} as ConductorFileConfig);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'my-agent'), '#!/bin/sh\nprintf "%s\\0" "$@"\n', {
    mode: 0o700,
  });
  const prompt = "Keep 'quotes' and $(touch injected) literal\nSecond line";
  const output = execFileSync(
    'sh',
    ['-c', agent.launchCommand(prompt, { sessionId: 'run-1' })],
    {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    },
  );
  expect(output.split('\0')).toEqual([
    '--session',
    'run-1',
    '--prompt',
    prompt,
    '',
  ]);
  expect(agent.launchCommand('')).toBe('my-agent');
  expect(() =>
    agent.launchCommand('prompt', { sessionId: '../escape' }),
  ).toThrow('Invalid session ID');
});

it('collects only its own agent transcript and tolerates absent logs and metrics', async () => {
  const found = await loadGuide('agent', 'my-agent');
  const [{ agent: plugin }] = found.agents as AgentCandidate[];
  const agent = await plugin.createAgent({} as ConductorFileConfig);
  const logs = join(dir, '.my-agent');
  mkdirSync(logs);
  writeFileSync(join(logs, 'run-1.log'), 'First attempt');
  writeFileSync(join(logs, 'run-2.log'), 'Second attempt');
  writeFileSync(join(logs, 'foreign.log'), 'Another ticket');
  await expect(agent.getRunLog(dir, { sessionId: 'run-1' })).resolves.toBe(
    'First attempt',
  );
  await expect(
    agent.getRunLog(dir, {
      sessionId: 'run-1',
      attemptFamily: ['run-1', 'run-2', 'missing'],
    }),
  ).resolves.toBe('Second attempt');
  await expect(agent.getRunLog(dir, { sessionId: 'missing' })).resolves.toBe(
    '',
  );
  await expect(agent.getRunLog(dir)).resolves.toBe('');
  await expect(agent.getRunLog(dir, { sessionId: '../foreign' })).resolves.toBe(
    '',
  );
  for (const log of ['', 'unfinished log {']) {
    expect(agent.parseFootprint(log)).toEqual({
      tokens: 0,
      duration_s: 0,
      agent_turns: 0,
      tool_calls: 0,
      user_prompts: 0,
      user_prompt_words: 0,
      active_s: 0,
    });
  }
});

function installClientCli() {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'my-client'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.CLIENT_TEST_DIR;
const file = (name) => path.join(root, name);
const body = JSON.parse(fs.readFileSync(0, 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(file('requests.jsonl'), JSON.stringify({ args, body }) + '\\n');
if (fs.existsSync(file('fail-client'))) {
  process.stderr.write(JSON.stringify(body));
  process.exit(1);
}
const sessions = fs.existsSync(file('sessions.json'))
  ? JSON.parse(fs.readFileSync(file('sessions.json'), 'utf8')) : {};
const key = JSON.stringify([body.branch, body.runId]);
if (args[0] === 'start') sessions[key] = body;
else if (args[0] === 'close') delete sessions[key];
else process.exit(2);
fs.writeFileSync(file('sessions.json'), JSON.stringify(sessions));
`,
    { mode: 0o755 },
  );
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  vi.stubEnv('CLIENT_TEST_DIR', dir);
}

it('starts runs through the new client CLI and cleans up one session after reconnecting', async () => {
  installClientCli();
  const found = await loadGuide('client', 'my-client');
  expect(found.executors).toMatchObject([
    { kind: 'executor', id: 'my-client' },
  ]);
  expect(found.executors).toHaveLength(1);
  expect(found.workspaces).toEqual([]);
  expect(found.agents).toEqual([]);
  const [plugin] = found.executors as ExecutorPlugin[];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const config = {} as ConductorFileConfig;
  const executor = await plugin.createExecutor(config, { logger });
  const input: SpawnRunInput = {
    ticket: {
      uuid: 'ticket-1',
      identifier: 'EXAMPLE-1',
      title: 'Example',
      branchName: 'feat/example',
      state: 'working',
    },
    run: { uuid: 'run-1', id: 7, handler: 'my-agent' },
    workspacePath: dir,
    instructions: null,
    command: "my-agent --prompt 'quotes; $(touch unexpected)'",
    env: { BAKERS_CONDUCTOR_TOKEN: 'run-secret' },
  };
  expect(executor.capabilities()).toEqual({ persistent: true });
  const first = await executor.startRun(input);
  const second = await executor.startRun({
    ...input,
    run: { ...input.run, id: 8 },
  });
  expect(first.sessionRef).toEqual(expect.any(String));
  expect(first.sessionRef).not.toBe(second.sessionRef);
  const requests = readFileSync(join(dir, 'requests.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(requests[0]).toEqual({
    args: ['start', '--json-stdin'],
    body: {
      branch: 'feat/example',
      runId: 7,
      cwd: dir,
      command: input.command,
      env: input.env,
    },
  });
  const sessions = () =>
    Object.values(JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')));
  expect(sessions()).toHaveLength(2);
  const restarted = await plugin.createExecutor(config, { logger });
  await restarted.stopRun(input.ticket.branchName);
  expect(sessions()).toHaveLength(2);
  await restarted.cleanupRun(input.ticket.branchName, 7);
  expect(sessions()).toEqual([expect.objectContaining({ runId: 8 })]);
  await restarted.cleanupRun(input.ticket.branchName, 7);
  expect(sessions()).toHaveLength(1);
  expect(logger.warn).not.toHaveBeenCalled();
  expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('First line\n');
});

it('reports client start and cleanup failures without exposing client output', async () => {
  installClientCli();
  const found = await loadGuide('client', 'my-client');
  const [plugin] = found.executors as ExecutorPlugin[];
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const executor = await plugin.createExecutor({} as ConductorFileConfig, {
    logger,
  });
  const input: SpawnRunInput = {
    ticket: {
      uuid: 'ticket-1',
      identifier: 'EXAMPLE-1',
      title: 'Example',
      branchName: 'feat/example',
      state: 'working',
    },
    run: { uuid: 'run-1', id: 7, handler: 'my-agent' },
    workspacePath: dir,
    instructions: null,
    command: 'my-agent --prompt private-prompt',
    env: { SECRET: 'private-run-token' },
  };
  writeFileSync(join(dir, 'fail-client'), '');
  await expect(executor.startRun(input)).rejects.toEqual(
    new Error('my-client start failed'),
  );
  await expect(
    executor.startRun({ ...input, command: undefined }),
  ).rejects.toThrow('An agent command is required');
  await expect(executor.cleanupRun('feat/example', 7)).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledOnce();
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-');
  unlinkSync(join(dir, 'bin', 'my-client'));
  await expect(executor.startRun(input)).rejects.toEqual(
    new Error('my-client start failed'),
  );
});
