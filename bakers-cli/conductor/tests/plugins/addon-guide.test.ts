import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeBbRemote } from '@bakers-build/addon-fake';
import { discoverAddons } from '@bakers-build/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InboxRuntime } from '../../src/core/inbox-runtime.js';
import {
  loadInbox,
  validateRequestPayload,
} from '../../src/plugins/message.js';
import { loadTools } from '../../src/plugins/tools.js';

const guide = readFileSync(
  new URL('../../../../docs/addons/build/first-addon.md', import.meta.url),
  'utf8',
);
const blocks = [...guide.matchAll(/^```(json|js)\n([\s\S]*?)^```/gm)];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bakers-addon-guide-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'notes.md'), 'First line\n');
  execFileSync('git', ['add', 'notes.md'], { cwd: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function loadGuide(withMessage = false) {
  const manifest = blocks.find((b) => b[1] === 'json')?.[2];
  const preset = blocks.find((b) => b[1] === 'js')?.[2];
  const message = blocks.find((b) =>
    b[2].startsWith('export const inbox'),
  )?.[2];
  if (!manifest || !preset || !message)
    throw new Error('guide example is incomplete');
  const configDir = join(dir, '.bakers');
  const addonDir = join(configDir, 'addons/patch-check');
  mkdirSync(addonDir, { recursive: true });
  writeFileSync(join(addonDir, 'package.json'), manifest);
  writeFileSync(
    join(addonDir, 'preset.js'),
    preset + (withMessage ? message : ''),
  );
  return discoverAddons(['./addons/patch-check'], 'conductor', [
    join(configDir, 'conductor.config.js'),
  ]);
}

it('loads the local guide package and validates calls to its tool', async () => {
  const found = await loadGuide();
  expect(found.addonTools).toHaveLength(1);
  const tools = await loadTools(found.addonTools);
  const binding = { worktreePath: dir };
  await expect(
    tools.call('patch_check', { scope: 'unstaged' }, binding),
  ).resolves.toEqual({
    text: 'No whitespace errors or conflict markers in unstaged changes.',
  });
  for (const args of [
    {},
    { scope: 42 },
    { scope: 'all' },
    { scope: 'unstaged', path: '/' },
  ]) {
    await expect(tools.call('patch_check', args, binding)).rejects.toThrow(
      'invalid arguments',
    );
  }
});

it.each([
  {
    name: 'whitespace errors',
    content: 'First line\nTrailing space \n',
    finding: 'notes.md:2: trailing whitespace.',
  },
  {
    name: 'conflict markers',
    content: 'First line\n<<<<<<< ours\n',
    finding: 'notes.md:2: leftover conflict marker',
  },
])('reports $name only in the selected changes', async ({
  content,
  finding,
}) => {
  const found = await loadGuide();
  const tools = await loadTools(found.addonTools);
  const binding = { worktreePath: dir };
  writeFileSync(join(dir, 'untracked.md'), content);
  await expect(
    tools.call('patch_check', { scope: 'unstaged' }, binding),
  ).resolves.toEqual({
    text: 'No whitespace errors or conflict markers in unstaged changes.',
  });

  writeFileSync(join(dir, 'notes.md'), content);
  await expect(
    tools.call('patch_check', { scope: 'staged' }, binding),
  ).resolves.toEqual({
    text: 'No whitespace errors or conflict markers in staged changes.',
  });
  await expect(
    tools.call('patch_check', { scope: 'unstaged' }, binding),
  ).rejects.toThrow(finding);
  expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe(content);

  execFileSync('git', ['add', 'notes.md'], { cwd: dir });
  await expect(
    tools.call('patch_check', { scope: 'staged' }, binding),
  ).rejects.toThrow(finding);
  await expect(
    tools.call('patch_check', { scope: 'unstaged' }, binding),
  ).resolves.toEqual({
    text: 'No whitespace errors or conflict markers in unstaged changes.',
  });
});

it('honours cancellation of the guide tool', async () => {
  const found = await loadGuide();
  const tools = await loadTools(found.addonTools);
  const abort = new AbortController();
  abort.abort();
  await expect(
    tools.call(
      'patch_check',
      { scope: 'unstaged' },
      { worktreePath: dir },
      {
        signal: abort.signal,
      },
    ),
  ).rejects.toThrow(/aborted/i);
});

it('binds the guide message to the same tool and ticket/worktree context', async () => {
  const found = await loadGuide(true);
  const tools = await loadTools(found.addonTools);
  const call = vi.spyOn(tools, 'call');
  const inbox = await loadInbox(
    found.addonInbox[0],
    undefined,
    new Set(tools.list().map((tool) => tool.name)),
  );
  expect(
    validateRequestPayload(inbox.messages, 'check', { scope: 42 }).ok,
  ).toBe(false);
  const remote = new FakeBbRemote({
    tickets: {
      't-1': {
        identifier: 'EXAMPLE-1',
        title: 'Check patch',
        state: 'working',
      },
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
    messageId: `${inbox.name}.check`,
    version: inbox.version,
    ticketUuid: 't-1',
    requestedBy: 'user-1',
    worktreePath: dir,
    payload: { scope: 'unstaged' },
  };
  await expect(runtime.handle(request)).resolves.toEqual({
    status: 'done',
    result: {
      markdown: 'No whitespace errors or conflict markers in unstaged changes.',
    },
  });
  expect(call).toHaveBeenCalledWith(
    'patch_check',
    { scope: 'unstaged' },
    { worktreePath: dir, ticket: await remote.getTicket('t-1') },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const invalid = await runtime.handle({ ...request, payload: { scope: 42 } });
  expect(invalid.status).toBe('failed');
  expect(invalid.result.markdown).toContain('invalid arguments');

  writeFileSync(join(dir, 'notes.md'), 'First line\nTrailing space \n');
  const failed = await runtime.handle(request);
  expect(failed.status).toBe('failed');
  expect(failed.result.markdown).toContain('notes.md:2: trailing whitespace.');
});
