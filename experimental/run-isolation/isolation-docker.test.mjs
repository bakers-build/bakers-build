// Throwaway self-check of the spike's launch rewrite: node --test experimental/run-isolation/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import isolationDocker, { wrapRun } from './isolation-docker.mjs';

const input = {
  ticket: { uuid: 't', identifier: 'BB-1', title: 'x', branchName: 'b', state: 'plan' },
  run: { uuid: 'r-uuid', id: 7, handler: 'claude' },
  workspacePath: '/w/tree',
  instructions: null,
  command: "claude 'it''s'",
  env: { BB_CONDUCTOR_TOKEN: 'secret-token', BB_STATE: 'plan' },
};
const where = { gitCommonDir: '/w/main/.git', runHome: '/h/run-r-uuid', hostHome: '/home/op' };

// The argv a real shell makes of the command, as docker would receive it.
const argv = (command) =>
  execFileSync('sh', ['-c', `set -- ${command}; printf '%s\\0' "$@"`], {
    encoding: 'utf8',
  })
    .split('\0')
    .slice(0, -1);

test('wraps the agent command in one docker run per run', () => {
  const out = wrapRun(input, { image: 'img', mounts: ['/opt/bakers-cli'] }, where);
  const a = argv(out.command);
  assert.deepEqual(a.slice(0, 9), [
    'docker', 'run', '--rm', '-it', '--name', 'bb-run-7', '--network', 'host', '--user',
  ]);
  assert.deepEqual(a.slice(-4), ['img', 'sh', '-c', "claude 'it''s'"]);
  const vols = a.flatMap((x, i) => (a[i - 1] === '-v' ? [x] : []));
  assert.deepEqual(vols, [
    '/w/tree:/w/tree',
    '/w/main/.git:/w/main/.git',
    '/opt/bakers-cli:/opt/bakers-cli:ro',
    '/h/run-r-uuid:/home/run',
    // The transcript lands where the conductor reads it on the host.
    '/home/op/.claude/projects/-w-tree:/home/run/.claude/projects/-w-tree',
  ]);
  assert.equal(a[a.indexOf('-w') + 1], '/w/tree');
});

test('secrets travel by name, never in argv', () => {
  const out = wrapRun(input, { image: 'img' }, where);
  assert.doesNotMatch(out.command, /secret-token/);
  assert.match(out.command, / -e BB_CONDUCTOR_TOKEN -e BB_STATE /);
  assert.equal(out.env.BB_CONDUCTOR_TOKEN, 'secret-token');
});

test('mounts nothing else from the operator home and not the docker socket', () => {
  const out = wrapRun(input, { image: 'img' }, where);
  assert.doesNotMatch(out.command, /\.ssh|\.bakers|docker\.sock/);
  assert.doesNotMatch(out.command, / -v \/home\/op:/);
});

test('every method but startRun delegates to the inner executor', async () => {
  const calls = [];
  const inner = {
    id: 'herdr',
    capabilities: () => ({ persistent: true }),
    stopRun: async (b) => calls.push(['stopRun', b]),
    cleanupRun: async (b, id) => calls.push(['cleanupRun', b, id]),
    startRun: async (i) => {
      calls.push(['startRun', i.command.slice(0, 10)]);
      return { sessionRef: 'b' };
    },
  };
  const plugin = isolationDocker({
    image: 'img',
    loadInner: async () => inner,
    docker: async (args) => calls.push(['docker', ...args]),
    where: () => where,
  });
  const ex = await plugin.createExecutor({}, { logger: console });
  assert.deepEqual(ex.capabilities(), { persistent: true });
  await ex.startRun(input);
  await ex.cleanupRun('b', 7);
  assert.deepEqual(calls, [
    ['startRun', 'docker run'],
    ['cleanupRun', 'b', 7],
    ['docker', 'rm', '-f', 'bb-run-7'],
  ]);
});
