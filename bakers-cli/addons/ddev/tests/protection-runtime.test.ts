import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';

const image = 'node:24-bookworm-slim';
const available =
  spawnSync('docker', ['image', 'inspect', image], {
    stdio: 'ignore',
    timeout: 10_000,
  }).status === 0;
if (process.env.BAKERS_TEST_DDEV_PROTECTION_REQUIRED === '1' && !available)
  throw new Error(`Docker and cached ${image} required`);

it.skipIf(!available)(
  'the project Compose config protects host controls while package outputs and host writes work',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'ddev-protection-'));
    const name = `bb-protection-${randomUUID()}`;
    const run = (args: string[]) => {
      const result = spawnSync('docker', args, {
        encoding: 'utf8',
        timeout: 30_000,
      });
      if (result.error) throw result.error;
      return {
        code: result.status,
        output: `${result.stdout}${result.stderr}`,
      };
    };
    const composeArgs = [
      'compose',
      '-p',
      name,
      '-f',
      join(root, '.ddev/base.yaml'),
      '-f',
      join(root, '.ddev/docker-compose.protection.yaml'),
    ];
    const command = (service: string, script: string) =>
      run([...composeArgs, 'exec', '-T', service, 'bash', '-c', script]);
    for (const folder of ['.bakers', '.ddev/db_snapshots'])
      mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(
      join(root, '.bakers/provision.sh'),
      '#!/bin/bash\necho ready\n',
    );
    writeFileSync(join(root, '.ddev/existing'), 'original');
    writeFileSync(join(root, '.git'), 'gitdir: /host/admin\n');
    copyFileSync(
      fileURLToPath(
        new URL(
          '../../../../.ddev/docker-compose.protection.yaml',
          import.meta.url,
        ),
      ),
      join(root, '.ddev/docker-compose.protection.yaml'),
    );
    writeFileSync(
      join(root, '.ddev/base.yaml'),
      stringify({
        services: {
          web: {
            image,
            command: ['sleep', 'infinity'],
            volumes: [
              { type: 'bind', source: root, target: '/var/www/html' },
              {
                type: 'bind',
                source: join(root, '.ddev'),
                target: '/mnt/ddev_config',
              },
            ],
            working_dir: '/var/www/html',
          },
          db: {
            image,
            command: ['sleep', 'infinity'],
            volumes: [
              {
                type: 'bind',
                source: join(root, '.ddev'),
                target: '/mnt/ddev_config',
              },
              {
                type: 'bind',
                source: join(root, '.ddev/db_snapshots'),
                target: '/mnt/snapshots',
              },
            ],
          },
        },
      }),
    );
    try {
      const started = run([
        ...composeArgs,
        'up',
        '-d',
        '--no-build',
        '--pull',
        'never',
      ]);
      expect(started.code, started.output).toBe(0);
      for (const path of [
        '/var/www/html/.bakers',
        '/var/www/html/.ddev',
        '/mnt/ddev_config',
      ]) {
        for (const script of [
          `touch ${path}/new`,
          `mv ${path} ${path}-renamed`,
        ])
          expect(command('web', script).code, script).not.toBe(0);
      }
      for (const script of [
        'echo changed >> .bakers/provision.sh',
        'rm .bakers/provision.sh',
        'mv .bakers/provision.sh .bakers/renamed',
        'echo changed >> .git',
        'rm .git',
        'mv .git .git-renamed',
      ])
        expect(command('web', script).code, script).not.toBe(0);
      for (const path of ['/mnt/ddev_config', '/mnt/snapshots'])
        expect(command('db', `touch ${path}/new`).code, path).not.toBe(0);
      const install = command(
        'web',
        'mkdir -p node_modules/demo && echo installed > node_modules/demo/index.js && echo lock > pnpm-lock.yaml && chmod -R a+rwX node_modules',
      );
      expect(install.code, install.output).toBe(0);
      expect(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe('lock\n');
      writeFileSync(
        join(root, '.bakers/provision.sh'),
        '#!/bin/bash\necho updated\n',
      );
      const invoked = command('web', 'bash .bakers/provision.sh');
      expect(invoked.code, invoked.output).toBe(0);
      expect(invoked.output).toBe('updated\n');
      expect(readFileSync(join(root, '.ddev/existing'), 'utf8')).toBe(
        'original',
      );
      expect(readFileSync(join(root, '.git'), 'utf8')).toBe(
        'gitdir: /host/admin\n',
      );
    } finally {
      try {
        const stopped = run([...composeArgs, 'down', '--remove-orphans']);
        expect(stopped.code, stopped.output).toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  60_000,
);
