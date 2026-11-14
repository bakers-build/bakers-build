import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { prepareClaudeRun } from '../src/run.js';

let root: string;
let source: string;
let homePath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-claude-run-'));
  source = join(root, 'agent');
  homePath = join(root, 'private');
  mkdirSync(join(source, 'plugins'), { recursive: true });
  mkdirSync(homePath);
  writeFileSync(join(source, 'settings.json'), '{"enabled":true}');
  writeFileSync(join(source, '.claude.json'), '{"primaryApiKey":"old-key"}');
  writeFileSync(join(source, '.credentials.json'), '{"token":"login"}', {
    mode: 0o600,
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('prepares a private home and exposes only plugins and this worktree transcript', () => {
  const out = prepareClaudeRun(
    { homePath, workspacePath: '/w/tree', env: {} },
    source,
    {},
  );
  const config = join(homePath, '.claude');
  expect(out.env.CLAUDE_CONFIG_DIR).toBe(config);
  expect(out.readPaths).toEqual([join(source, 'plugins')]);
  expect(out.writePaths).toEqual([join(source, 'projects/-w-tree')]);
  expect(realpathSync(join(config, 'plugins'))).toBe(join(source, 'plugins'));
  expect(realpathSync(join(config, 'projects/-w-tree'))).toBe(
    out.writePaths[0],
  );
  expect(
    JSON.parse(readFileSync(join(config, '.claude.json'), 'utf8')),
  ).toEqual({ hasCompletedOnboarding: true });
  expect(
    JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8')),
  ).toEqual({ enabled: true, skipDangerousModePermissionPrompt: true });
});

it('mounts the shared host login instead of a private copy when no run credential is supplied', () => {
  const host = join(root, 'host.json');
  writeFileSync(host, '{"token":"login"}', { mode: 0o600 });
  rmSync(join(source, '.credentials.json'));
  symlinkSync(host, join(source, '.credentials.json'));
  const out = prepareClaudeRun(
    { homePath, workspacePath: '/w/tree', env: {} },
    source,
    {},
  );
  const login = join(homePath, '.claude/.credentials.json');
  expect(readFileSync(login, 'utf8')).toBe('');
  expect(out.bindPaths).toEqual([
    { source: realpathSync(host), target: login },
  ]);
});

it('uses explicit run credentials without copying the host login or OAuth token', () => {
  const out = prepareClaudeRun(
    {
      homePath,
      workspacePath: '/w/tree',
      env: { ANTHROPIC_API_KEY: 'placeholder' },
    },
    source,
    { CLAUDE_CODE_OAUTH_TOKEN: 'host-secret' },
  );
  expect(out.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(existsSync(join(homePath, '.claude/.credentials.json'))).toBe(false);
  const state = JSON.parse(
    readFileSync(join(homePath, '.claude/.claude.json'), 'utf8'),
  );
  expect(state.customApiKeyResponses.approved).toEqual(['placeholder']);
});

it('forwards the host model credential through the run env', () => {
  const out = prepareClaudeRun(
    { homePath, workspacePath: '/w/tree', env: {} },
    source,
    { CLAUDE_CODE_OAUTH_TOKEN: 'selected-token' },
  );
  expect(out.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('selected-token');
  expect(existsSync(join(homePath, '.claude/.credentials.json'))).toBe(false);
});
