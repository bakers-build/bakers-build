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
  const addonDir = join(configDir, 'addons/hello');
  mkdirSync(addonDir, { recursive: true });
  writeFileSync(join(addonDir, 'package.json'), manifest);
  writeFileSync(
    join(addonDir, 'preset.js'),
    preset + (withMessage ? message : ''),
  );
  return discoverAddons(['./addons/hello'], 'conductor', [
    join(configDir, 'conductor.config.js'),
  ]);
}

it('loads the local guide package and validates calls to its tool', async () => {
  const found = await loadGuide();
  expect(found.addonTools).toHaveLength(1);
  const tools = await loadTools(found.addonTools);
  const binding = { worktreePath: dir };
  await expect(
    tools.call('hello_greet', { name: 'Ada' }, binding),
  ).resolves.toEqual({
    text: 'Hello, Ada!',
  });
  for (const args of [
    {},
    { name: 42 },
    { name: '' },
    { name: 'Ada', path: '/' },
  ]) {
    await expect(tools.call('hello_greet', args, binding)).rejects.toThrow(
      'invalid arguments',
    );
  }
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
  expect(validateRequestPayload(inbox.messages, 'greet', { name: 42 }).ok).toBe(
    false,
  );
  const remote = new FakeBbRemote({
    tickets: {
      't-1': { identifier: 'EXAMPLE-1', title: 'Hello', state: 'working' },
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
    messageId: `${inbox.name}.greet`,
    version: inbox.version,
    ticketUuid: 't-1',
    requestedBy: 'user-1',
    worktreePath: dir,
    payload: { name: 'Ada' },
  };
  await expect(runtime.handle(request)).resolves.toEqual({
    status: 'done',
    result: { markdown: 'Hello, Ada!' },
  });
  expect(call).toHaveBeenCalledWith(
    'hello_greet',
    { name: 'Ada' },
    { worktreePath: dir, ticket: await remote.getTicket('t-1') },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const invalid = await runtime.handle({ ...request, payload: { name: 42 } });
  expect(invalid.status).toBe('failed');
  expect(invalid.result.markdown).toContain('invalid arguments');
});
