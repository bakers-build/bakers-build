import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  ddevProtectedPaths,
  ddevProtectionCompose,
} from '../src/protection.js';
import { type DdevRun, ddevTools } from '../src/tools.js';

const roots: string[] = [];
it('refuses a host Git directory with a writable hardlink alias', () => {
  const root = project();
  rmSync(join(root, '.git'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git/config'), 'trusted');
  linkSync(join(root, '.git/config'), join(root, 'config-alias'));
  expect(() =>
    ddevProtectedPaths(root, [join(root, '.bakers'), join(root, '.ddev')]),
  ).toThrow(/hardlink/);
});
it('requires agent-side DDEV control protection before serving protected tools', () => {
  const root = project();
  expect(() => ddevProtectedPaths(root, [join(root, '.bakers')])).toThrow(
    /\.ddev.*runtime.read_only/,
  );
});
it.each([
  ['privileged: true', 'privileges'],
  ['cap_add: [SYS_ADMIN]', 'privileges'],
  ['pid: host', 'privileges'],
  ['devices: [/dev/sda]', 'unsupported'],
  ['volumes_from: [other]', 'unsupported'],
  ['volumes: [{type: bind, source: /tmp, target: /parent}]', 'outside'],
  [
    'volumes: [{type: volume, source: project, target: /var/www/html}]',
    'direct project bind',
  ],
])('refuses unsafe launch configuration before starting containers: %s', (setting, reason) => {
  const root = project();
  expect(() =>
    ddevProtectionCompose(
      `services:\n  web:\n    ${setting}\n`,
      [join(root, '.bakers')],
      root,
    ),
  ).toThrow(new RegExp(reason));
});
it('rejects bind-backed named volumes before provisioning can start containers', () => {
  const root = project();
  expect(() =>
    ddevProtectionCompose(
      `services:\n  web:\n    volumes: [{type: bind, source: ${root}, target: /var/www/html}]\nvolumes:\n  hidden:\n    driver_opts: {type: none, o: bind, device: ${root}}\n`,
      [join(root, '.bakers')],
      root,
    ),
  ).toThrow(/volume driver/i);
});
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function project() {
  const root = mkdtempSync(join(tmpdir(), 'ddev-protection-'));
  roots.push(root);
  mkdirSync(join(root, '.bakers'));
  mkdirSync(join(root, '.ddev'));
  writeFileSync(join(root, '.git'), 'gitdir: /host/private-admin\n');
  return root;
}

it('refuses an arbitrary command when the actual DDEV project mount exposes protected files writable', async () => {
  const root = project();
  const executed: string[][] = [];
  const run: DdevRun = async (args) => {
    executed.push(args);
    return {
      exitCode: 0,
      output:
        args[0] === 'describe'
          ? JSON.stringify({
              raw: { name: 'guard-test', approot: root, status: 'running' },
            })
          : 'ran',
    };
  };
  const docker: DdevRun = async (args) => ({
    exitCode: 0,
    output:
      args[0] === 'ps'
        ? 'web-id\n'
        : JSON.stringify([
            {
              Id: 'web-id',
              State: { Running: true },
              Config: {
                Labels: {
                  'com.ddev.site-name': 'guard-test',
                  'com.docker.compose.service': 'web',
                },
              },
              HostConfig: {},
              Mounts: [
                {
                  Type: 'bind',
                  Source: root,
                  Destination: '/var/www/html',
                  RW: true,
                },
              ],
            },
          ]),
  });
  const tools = ddevTools(run, docker);
  await expect(
    tools.ddev_exec({
      worktreePath: root,
      protectedPaths: [join(root, '.bakers'), join(root, '.ddev')],
      args: { command: 'echo malicious > .bakers/project.config.js' },
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/protec|read.only/i);
  expect(executed.some((args) => args[0] === 'exec')).toBe(false);
});
