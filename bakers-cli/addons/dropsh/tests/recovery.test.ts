import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  firstWorkspace,
  secondWorkspace,
  workspaceFixture,
} from '../../../core/tests/fixtures/workspace-server.js';
import * as dropsh from '../src/index.js';

let f: Awaited<ReturnType<typeof workspaceFixture>>;
beforeEach(async () => {
  f = await workspaceFixture();
  await f.login();
});
afterEach(async () => {
  await f.close();
});
it('dispatches the exact bootstrap workspace search to the real bundle using configured OAuth', async () => {
  const before = readFileSync(f.config, 'utf8');
  let output = '';
  await dropsh.dispatchBbDropsh(
    { resolveBases: [] },
    ['--format', 'md', 'search', 'bb_workspace', '--config', f.config],
    { stateDir: f.stateDir, stdout: (s) => (output += s) },
  );
  expect(f.requests[1]).toBe(
    'GET /jsonapi/bb_workspace/bb_workspace Bearer fixture-token',
  );
  expect(output).toContain(firstWorkspace);
  expect(output).toContain(secondWorkspace);
  expect(readFileSync(f.config, 'utf8')).toBe(before);
});
it('registers commands from the configured plugin; late config wins over the environment', async () => {
  const wrong = join(f.root, 'wrong.mjs');
  writeFileSync(wrong, f.source(firstWorkspace));
  const old = process.env.DROPSH_CONFIG;
  process.env.DROPSH_CONFIG = wrong;
  writeFileSync(f.config, f.source(secondWorkspace));
  let output = '';
  const write = process.stdout.write;
  process.stdout.write = ((s: unknown) => {
    output += s;
    return true;
  }) as typeof write;
  try {
    await dropsh.dispatchBbDropsh(
      { resolveBases: [] },
      ['selected', '--config', f.config],
      { stateDir: f.stateDir },
    );
    expect(output).toBe(secondWorkspace);
    expect(readFileSync(wrong, 'utf8')).toContain(firstWorkspace);
  } finally {
    process.stdout.write = write;
    if (old === undefined) delete process.env.DROPSH_CONFIG;
    else process.env.DROPSH_CONFIG = old;
  }
});
// BB-495 AC7 / F8: `bakers dropsh` used to refuse a config that names no
// workspace — the same requirement `loadBbConfig` had already dropped one
// layer down, still enforced here by `loadReadyBbConnection`'s recovery
// flow. Three review rounds read AC7 as PASS because the delivered test
// exercised `loadBbConfig` directly rather than the command `bakers dropsh`
// actually calls. This asserts it at that boundary: the command itself.
it('runs against a config naming no workspace, writing nothing to it (AC7)', async () => {
  const before = readFileSync(f.config, 'utf8');
  expect(before).toContain('workspace_id:""');
  let output = '';
  await dropsh.dispatchBbDropsh(
    { resolveBases: [] },
    [
      '--format',
      'json',
      'search',
      'bb_workspace',
      '--bundle',
      'bb_workspace',
      '--config',
      f.config,
    ],
    { stateDir: f.stateDir, stdout: (s) => (output += s) },
  );
  expect(() => JSON.parse(output)).not.toThrow();
  expect(readFileSync(f.config, 'utf8')).toBe(before);
});
it('mounts a lazy wrapper that honors --config after subcommand arguments', async () => {
  writeFileSync(f.config, f.source(secondWorkspace));
  let output = '';
  const write = process.stdout.write;
  process.stdout.write = ((s: unknown) => {
    output += s;
    return true;
  }) as typeof write;
  try {
    const p = new Command();
    await dropsh.default.register(p, { resolveBases: [] });
    await p.parseAsync(['dropsh', 'selected', '--config', f.config], {
      from: 'user',
    });
    expect(output).toBe(secondWorkspace);
  } finally {
    process.stdout.write = write;
  }
});

it('sends authenticated requests through the configured workspace hooks', async () => {
  writeFileSync(f.config, f.source(secondWorkspace));
  let output = '';
  await dropsh.dispatchBbDropsh(
    { resolveBases: [] },
    [
      'search',
      'bb_workspace',
      '--bundle',
      'bb_workspace',
      '--config',
      f.config,
    ],
    { stateDir: f.stateDir, stdout: (s) => (output += s) },
  );
  expect(f.workspaces.at(-1)).toBe(secondWorkspace);
  expect(output).toContain(firstWorkspace);
});
it('keeps authentication status usable before workspace resolution with a late explicit config', async () => {
  let output = '';
  await dropsh.dispatchBbDropsh(
    { resolveBases: [] },
    ['auth', 'status', '--config', f.config],
    { stdout: (s) => (output += s) },
  );
  expect(output).toContain('not logged in');
  expect(f.requests).toHaveLength(1);
});
