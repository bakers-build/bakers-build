import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WRAPPER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'claude-trust.mjs',
);
const WORKTREE = '/home/coder/projects/X/.bakers-worktrees/feat/x-1-a';
const homes = [];

after(() => {
  for (const dir of homes) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh HOME, with `~/.claude.json` holding `content` unless undefined. */
function home(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-trust-'));
  homes.push(dir);
  if (content !== undefined) {
    fs.writeFileSync(path.join(dir, '.claude.json'), content);
  }
  return dir;
}

/** Runs the wrapper as `node claude-trust.mjs <path> node -e <code>`. */
function trust(dir, worktree = WORKTREE, code = '') {
  return spawnSync(
    process.execPath,
    [WRAPPER, worktree, process.execPath, '-e', code],
    { env: { ...process.env, HOME: dir }, encoding: 'utf8' },
  );
}

const config = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));

test('trusts exactly the given worktree and keeps every other key', () => {
  const dir = home(
    JSON.stringify({
      numStartups: 3,
      projects: {
        '/home/coder/projects': { hasTrustDialogAccepted: true },
        [WORKTREE]: { allowedTools: ['Bash'] },
      },
    }),
  );
  const result = trust(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(config(dir), {
    numStartups: 3,
    projects: {
      '/home/coder/projects': { hasTrustDialogAccepted: true },
      [WORKTREE]: { allowedTools: ['Bash'], hasTrustDialogAccepted: true },
    },
  });
});

test('creates the file when it is missing', () => {
  const dir = home(undefined);
  assert.equal(trust(dir).status, 0);
  assert.deepEqual(config(dir), {
    projects: { [WORKTREE]: { hasTrustDialogAccepted: true } },
  });
});

test('keeps the file mode', () => {
  const dir = home('{}');
  fs.chmodSync(path.join(dir, '.claude.json'), 0o600);
  trust(dir);
  assert.equal(fs.statSync(path.join(dir, '.claude.json')).mode & 0o777, 0o600);
});

test('writes nothing when the worktree is already trusted', () => {
  const text = `{ "projects": { "${WORKTREE}": { "hasTrustDialogAccepted": true } } }`;
  const dir = home(text);
  const file = path.join(dir, '.claude.json');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(file, past, past);
  // Compare against the stored mtime: filesystems round `past` differently.
  const before = fs.statSync(file).mtimeMs;
  trust(dir);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.equal(fs.statSync(file).mtimeMs, before);
});

test('leaves an unparsable file untouched, warns and still runs the command', () => {
  const dir = home('{ not json');
  const result = trust(dir, WORKTREE, 'process.stdout.write("ran")');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ran');
  assert.match(result.stderr, /claude-trust: /);
  assert.equal(
    fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'),
    '{ not json',
  );
});

test("passes the command's exit code through", () => {
  assert.equal(trust(home('{}'), WORKTREE, 'process.exit(7)').status, 7);
});

test('refuses a relative path and trusts nothing', () => {
  const dir = home('{}');
  const result = trust(dir, 'projects/x');
  assert.equal(result.status, 0);
  assert.match(result.stderr, /claude-trust: /);
  assert.deepEqual(config(dir), {});
});

test('writes into $CLAUDE_CONFIG_DIR/.claude.json when the run has an agent home', () => {
  const user = home('{"projects":{}}');
  const agentHome = home('{"hasCompletedOnboarding":true}');
  const result = spawnSync(
    process.execPath,
    [WRAPPER, WORKTREE, process.execPath, '-e', ''],
    {
      env: { ...process.env, HOME: user, CLAUDE_CONFIG_DIR: agentHome },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(config(agentHome), {
    hasCompletedOnboarding: true,
    projects: { [WORKTREE]: { hasTrustDialogAccepted: true } },
  });
  assert.deepEqual(config(user), { projects: {} });
});

test('concurrent runs sharing one agent home keep every trusted worktree', async () => {
  const agentHome = home('{}');
  const { spawn } = await import('node:child_process');
  const worktrees = Array.from({ length: 8 }, (_, i) => `/srv/ws/T-${i}`);
  await Promise.all(
    worktrees.map(
      (worktree) =>
        new Promise((resolve) =>
          spawn(process.execPath, [WRAPPER, worktree, process.execPath, '-e', ''], {
            env: { ...process.env, CLAUDE_CONFIG_DIR: agentHome },
          }).on('exit', resolve),
        ),
    ),
  );
  assert.deepEqual(
    Object.keys(config(agentHome).projects).sort(),
    worktrees.sort(),
  );
});
