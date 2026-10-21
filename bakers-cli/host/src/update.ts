import { spawn } from 'node:child_process';
import { BB_PACKAGE } from '@bakers-build/core';
import type { Command } from 'commander';

export type SpawnUpdate = (cmd: string, args: string[]) => Promise<number>;
export type SpawnCapture = (
  cmd: string,
  args: string[],
) => Promise<{ code: number; stdout: string }>;
export interface UpdateOptions {
  out?: (line: string) => void;
}

const spawnUpdate: SpawnUpdate = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
const capture: SpawnCapture = (cmd, args) =>
  new Promise((resolve) => {
    let stdout = '';
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('error', () => resolve({ code: 1, stdout }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });

async function installedVersion(run: SpawnCapture): Promise<string | null> {
  try {
    const result = await run('npm', [
      'ls',
      '-g',
      BB_PACKAGE,
      '--json',
      '--depth',
      '0',
    ]);
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as {
      dependencies?: Record<string, { version?: unknown }>;
    };
    const version = parsed.dependencies?.[BB_PACKAGE]?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

export async function runUpdate(
  run: SpawnUpdate = spawnUpdate,
  query: SpawnCapture = capture,
  options: UpdateOptions = {},
) {
  const before = await installedVersion(query);
  if ((await run('npm', ['install', '-g', `${BB_PACKAGE}@latest`])) !== 0)
    return { ok: false, before, after: before };
  const after = await installedVersion(query);
  if (after === null) return { ok: false, before, after };
  (options.out ?? console.log)(`${before ?? 'unknown'} → ${after}`);
  return { ok: true, before, after };
}

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('install the latest bakers CLI')
    .action(async () => {
      const result = await runUpdate();
      if (!result.ok) process.exitCode = 1;
    });
}
