import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { type DdevRun, ddevTools } from '../src/tools.js';

const image = 'node:24-bookworm-slim';
const available =
  spawnSync('docker', ['image', 'inspect', image], {
    stdio: 'ignore',
    timeout: 10_000,
  }).status === 0;
if (process.env.BAKERS_TEST_DDEV_PROTECTION_REQUIRED === '1' && !available)
  throw new Error(`Docker and cached ${image} are required`);

it.skipIf(!available)(
  'protects real container writes through generated guards and refuses a writable alias before pinned exec',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'ddev-protection-runtime-'));
    const name = `bb-protection-${randomUUID()}`;
    const volumeName = `${name}-external`;
    let volumeCreated = false;
    const base = join(root, 'compose.yaml');
    const guard = join(root, '.ddev/docker-compose.bakers-protection.yaml');
    const paths = ['.bakers', '.ddev', 'trusted'];
    for (const path of paths) {
      mkdirSync(join(root, path));
      writeFileSync(join(root, path, 'existing'), 'original');
    }
    writeFileSync(join(root, '.git'), 'gitdir: /host/admin\n');
    const config = {
      services: {
        web: {
          image,
          command: ['sleep', 'infinity'],
          labels: { 'com.ddev.site-name': name },
          volumes: [
            { type: 'bind', source: root, target: '/var/www/html' },
            {
              type: 'bind',
              source: join(root, 'trusted'),
              target: '/trusted-alias',
            },
          ],
        },
      },
    };
    writeFileSync(base, stringify(config));
    const compose = (args: string[], protectedMounts = true) => {
      const result = spawnSync(
        'docker',
        [
          'compose',
          '-p',
          name,
          '-f',
          base,
          ...(protectedMounts ? ['-f', guard] : []),
          ...args,
        ],
        { encoding: 'utf8', timeout: 30_000 },
      );
      if (result.error) throw result.error;
      return {
        exitCode: result.status ?? 124,
        output: `${result.stdout}${result.stderr}`,
      };
    };
    let running = false;
    let composeOverride: string | undefined;
    let starts = 0;
    // DDEV's registration writes outside the sandbox; only its CLI orchestration is adapted.
    const run: DdevRun = async (args) => {
      if (args[0] === 'describe')
        return {
          exitCode: 0,
          output: JSON.stringify({
            raw: {
              name,
              approot: root,
              status: running ? 'running' : 'stopped',
            },
          }),
        };
      if (args[0] === 'utility')
        return compose(
          [...(composeOverride ? ['-f', composeOverride] : []), 'config'],
          false,
        );
      if (args[0] === 'start' || args[0] === 'restart') {
        starts++;
        const result = compose(['up', '-d', '--no-build', '--pull', 'never']);
        running = result.exitCode === 0;
        return result;
      }
      throw new Error(`Unexpected DDEV call ${args.join(' ')}`);
    };
    const tools = ddevTools(run);
    const req = {
      worktreePath: root,
      protectedPaths: paths.map((path) => join(root, path)),
      args: {},
      signal: new AbortController().signal,
    };
    const exec = (command: string) =>
      tools.ddev_exec({ ...req, args: { command } });
    try {
      await tools.ddev_start(req);
      expect(readFileSync(guard, 'utf8')).toContain('/trusted-alias');
      for (const target of [
        ...paths.map((path) => `/var/www/html/${path}`),
        '/trusted-alias',
      ]) {
        for (const command of [
          `touch ${target}/new`,
          `echo changed > ${target}/existing`,
          `rm ${target}/existing`,
          `mv ${target}/existing ${target}/renamed`,
          `mv ${target} ${target}-renamed`,
        ])
          await expect(exec(command)).rejects.toThrow(/exit [1-9]/);
      }
      for (const command of [
        'echo changed > .git',
        'rm .git',
        'mv .git .git-renamed',
      ])
        await expect(exec(command)).rejects.toThrow(/exit [1-9]/);
      await expect(
        exec(
          'mkdir -p node_modules/demo && echo installed > node_modules/demo/index.js && echo lock > pnpm-lock.yaml && chmod -R a+rwX node_modules',
        ),
      ).resolves.toMatchObject({ text: 'exit 0\n' });
      expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe('lock\n');
      for (const path of paths)
        expect(readFileSync(join(root, path, 'existing'), 'utf8')).toBe(
          'original',
        );
      expect(readFileSync(join(root, '.git'), 'utf8')).toBe(
        'gitdir: /host/admin\n',
      );
      // Reapplying policy to an already running project preserves ordinary package output.
      await tools.ddev_start(req);
      await expect(exec('cat pnpm-lock.yaml')).resolves.toMatchObject({
        text: 'exit 0\nlock\n',
      });
      const startsBeforeRejection = starts;
      // Recreate with a writable alias while retaining the main mount's protection.
      const bypass = join(root, 'bypass.yaml');
      writeFileSync(
        bypass,
        stringify({
          services: {
            web: {
              volumes: [
                {
                  type: 'bind',
                  source: join(root, 'trusted'),
                  target: '/bypass',
                },
              ],
            },
          },
        }),
      );
      const result = compose([
        '-f',
        bypass,
        'up',
        '-d',
        '--force-recreate',
        '--no-build',
        '--pull',
        'never',
      ]);
      expect(result.exitCode, result.output).toBe(0);
      await expect(exec('touch command-executed')).rejects.toThrow(
        /writable alias/,
      );
      expect(() => readFileSync(join(root, 'command-executed'))).toThrow();
      // External volume declarations hide the driver's host bind from Compose.
      const created = spawnSync(
        'docker',
        [
          'volume',
          'create',
          '--driver',
          'local',
          '--opt',
          'type=none',
          '--opt',
          'o=bind',
          '--opt',
          `device=${join(root, 'trusted')}`,
          volumeName,
        ],
        { encoding: 'utf8', timeout: 10_000 },
      );
      expect(created.status, created.stderr).toBe(0);
      volumeCreated = true;
      const volumeBypass = join(root, 'volume-bypass.yaml');
      writeFileSync(
        volumeBypass,
        stringify({
          services: {
            web: {
              volumes: [
                {
                  type: 'volume',
                  source: 'external-bind',
                  target: '/volume-bypass',
                },
              ],
            },
          },
          volumes: { 'external-bind': { external: true, name: volumeName } },
        }),
      );
      composeOverride = volumeBypass;
      await expect(tools.ddev_start(req)).rejects.toThrow(
        /custom volume drivers and options/,
      );
      expect(starts).toBe(startsBeforeRejection);
      const recreated = compose([
        '-f',
        volumeBypass,
        'up',
        '-d',
        '--force-recreate',
        '--no-build',
        '--pull',
        'never',
      ]);
      expect(recreated.exitCode, recreated.output).toBe(0);
      await expect(
        exec('touch /volume-bypass/volume-command-executed'),
      ).rejects.toThrow(/DDEV protection/);
      expect(() =>
        readFileSync(join(root, 'trusted/volume-command-executed')),
      ).toThrow();
    } finally {
      const result = compose(['down', '--remove-orphans'], false);
      try {
        expect(result.exitCode, result.output).toBe(0);
      } finally {
        if (volumeCreated) {
          const removed = spawnSync('docker', ['volume', 'rm', volumeName], {
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(removed.status, removed.stderr).toBe(0);
        }
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  60_000,
);
