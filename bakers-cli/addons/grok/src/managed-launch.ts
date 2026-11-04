import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { homedir, constants as osConstants } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const marker = '# bakers.build managed Grok profile';

async function main(): Promise<void> {
  const [requestedHome, encoded, executable, ...args] = process.argv.slice(2);
  if (!requestedHome || !encoded || executable !== 'grok')
    throw new Error('Invalid managed Grok invocation');
  const home = await realpath(requestedHome);
  if (
    home !== resolve(requestedHome) ||
    (process.env.GROK_HOME && resolve(process.env.GROK_HOME) !== home)
  ) {
    throw new Error(
      'Managed Grok profiles require the default, non-symlinked Grok home for session attribution',
    );
  }
  for (const policy of [
    '/etc/grok/requirements.toml',
    join(home, 'requirements.toml'),
  ]) {
    try {
      if (!(await readFile(policy, 'utf8')).trim()) continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(
      `Cannot select a managed profile while ${policy} may pin another sandbox; preserve that policy and resolve the conflict first`,
    );
  }
  const paths: unknown = JSON.parse(encoded);
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some(
      (path) =>
        typeof path !== 'string' ||
        (!isAbsolute(path) && !path.startsWith('~/')) ||
        path.trim() !== path ||
        /[?*[]/.test(path) ||
        [...path].some((c) => c.charCodeAt(0) < 32),
    )
  ) {
    throw new Error(
      'sandbox.allow_write requires literal absolute or ~/ directory paths',
    );
  }
  const grants: string[] = [];
  for (const path of paths as string[]) {
    const expanded = path.startsWith('~/')
      ? join(homedir(), path.slice(2))
      : path;
    const canonical = await realpath(expanded);
    if (!(await lstat(canonical)).isDirectory())
      throw new Error(`sandbox.allow_write is not a directory: ${path}`);
    if (/[?*[]/.test(canonical) || canonical.trim() !== canonical)
      throw new Error(
        `Grok cannot grant the resolved literal directory: ${canonical}`,
      );
    grants.push(canonical);
  }
  const { stdout } = await promisify(execFile)('grok', ['--version'], {
    timeout: 15000,
  });
  const version = /^grok (\d+)\.(\d+)\.(\d+)\b/.exec(stdout);
  if (
    !version ||
    Number(version[1]) < 1 ||
    (Number(version[1]) === 1 &&
      Number(version[2]) === 0 &&
      Number(version[3]) < 70)
  ) {
    throw new Error(
      'Managed profiles require Grok 1.0.70 or newer with native profile write protection',
    );
  }
  const flag = args.indexOf('--sandbox');
  if (flag < 0 || args[flag + 1] !== 'bakers-managed')
    throw new Error('Missing managed sandbox selection');
  const name = `bakers_${randomUUID().replaceAll('-', '_')}`;
  args[flag + 1] = name;
  const lockPath = join(home, '.bakers-profile.lock');
  // shortcut: one managed run per Grok home; use transactional profile updates when parallel runs are required.
  const lock = await open(lockPath, 'wx', 0o600).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
      throw new Error(
        `Managed Grok profile busy: ${lockPath}. Wait for its run; after a crash inspect the recorded PID and profile before removing the lock`,
      );
    },
  );
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, profile: name }));
    const profilePath = join(home, 'sandbox.toml');
    const profile = await open(
      profilePath,
      constants.O_RDWR |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const identity = await profile.stat();
      if (!identity.isFile() || identity.nlink !== 1)
        throw new Error(
          'sandbox.toml must be a regular file without hard links',
        );
      const original = await profile.readFile();
      if (original.includes(marker))
        throw new Error(
          'sandbox.toml contains an unfinished Bakers profile; recover that run before starting another',
        );
      const block = Buffer.from(
        `\n${marker} ${name}\n[profiles.${name}]\nextends = "workspace"\nread_write = ${JSON.stringify(grants)}\n`,
      );
      await profile.writeFile(block);
      await profile.sync();
      try {
        const child = spawn('grok', args, {
          stdio: 'inherit',
          env: { ...process.env, GROK_HOME: home },
        });
        const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(
          (signal) => {
            const forward = () => {
              child.kill(signal);
            };
            process.on(signal, forward);
            return { signal, forward };
          },
        );
        try {
          process.exitCode = await new Promise<number>(
            (resolveExit, reject) => {
              child.once('error', reject);
              child.once('exit', (code, signal) =>
                resolveExit(
                  code ?? (signal ? 128 + osConstants.signals[signal] : 1),
                ),
              );
            },
          );
        } finally {
          for (const { signal, forward } of handlers)
            process.off(signal, forward);
        }
      } finally {
        const current = await lstat(profilePath);
        const expected = Buffer.concat([original, block]);
        const actual = Buffer.alloc(expected.length + 1);
        const { bytesRead } = await profile.read(actual, 0, actual.length, 0);
        if (
          current.ino !== identity.ino ||
          current.dev !== identity.dev ||
          bytesRead !== expected.length ||
          !actual.subarray(0, bytesRead).equals(expected)
        ) {
          console.error(
            `sandbox.toml changed during the run; preserved it unchanged. Inspect and remove only profile ${name}`,
          );
          process.exitCode = 1;
        } else {
          // Only remove our appended bytes; never rewrite the operator's original configuration.
          await profile.truncate(original.length);
          await profile.sync();
        }
      }
    } finally {
      await profile.close();
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error: unknown) => {
  console.error(
    `Cannot run Grok with sandbox.allow_write: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
