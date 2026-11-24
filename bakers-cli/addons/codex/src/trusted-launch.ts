// Runs `codex` in a private CODEX_HOME whose `rules/` adds this launch's
// sandbox.trusted_commands to the operator's own rules; see docs/addons/codex.md.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, constants as osConstants } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

async function main(): Promise<void> {
  const [rules, executable, ...args] = process.argv.slice(2);
  if (!rules || executable !== 'codex')
    throw new Error('Invalid trusted Codex invocation');
  const { stdout } = await promisify(execFile)('codex', ['--version'], {
    timeout: 15000,
  });
  const [, major, minor, patch] = /(\d+)\.(\d+)\.(\d+)/.exec(stdout) ?? [];
  if (
    Number(major) * 1e6 + Number(minor) * 1e3 + Number(patch) < 166_000 ||
    !major
  )
    throw new Error(
      `Codex 0.166.0 or newer is required, found ${stdout.trim()}`,
    );
  const source = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  let config = '';
  try {
    config = await readFile(join(source, 'config.toml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // A keyring login is keyed by the home's path, so the private home would lose it.
  if (/^\s*cli_auth_credentials_store\s*=\s*["'](keyring|auto)/m.test(config))
    throw new Error(
      'a file-backed login is required: set cli_auth_credentials_store = "file" and log in again',
    );
  // Transcripts land in the operator's home, where the conductor reads them.
  await mkdir(join(source, 'sessions'), { recursive: true });
  // A sibling keeps `../` paths in config.toml resolving as before.
  const home = `${source}.bakers-${randomUUID()}`;
  await mkdir(join(home, 'rules'), { recursive: true, mode: 0o700 });
  try {
    // shortcut: entries Codex creates later stay in the private home and are
    // removed with it; link them ahead if one must persist.
    for (const name of await readdir(source))
      if (name !== 'rules') await symlink(join(source, name), join(home, name));
    // Codex skips linked .rules files, so the operator's rules are copied.
    const inherited = await readdir(join(source, 'rules')).catch(() => []);
    for (const name of inherited)
      await cp(join(source, 'rules', name), join(home, 'rules', name), {
        recursive: true,
        dereference: true,
      });
    await writeFile(
      join(home, 'rules', 'bakers-trusted-commands.rules'),
      rules,
      {
        flag: 'wx',
      },
    );
    const child = spawn('codex', args, {
      stdio: 'inherit',
      env: { ...process.env, CODEX_HOME: home },
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
      process.exitCode = await new Promise<number>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) =>
          resolveExit(code ?? (signal ? 128 + osConstants.signals[signal] : 1)),
        );
      });
    } finally {
      for (const { signal, forward } of handlers) process.off(signal, forward);
    }
  } finally {
    // Removes the links, never their targets.
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(
    `Cannot run Codex with sandbox.trusted_commands: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
