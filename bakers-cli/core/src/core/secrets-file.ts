// The machine's secrets file: `KEY=value` lines a conductor reads at start
// and hands to a run only for names an agent declares. Parsed, never sourced.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homeBbDir } from '../cli/bakers-dir.js';

export type Secrets = Readonly<Record<string, string>>;

/** `~/.bakers/.bakers.env`, beside `machine.config.js`; `BAKERS_HOME` applies. */
export function secretsFilePath(home?: string): string {
  return join(homeBbDir(home), '.bakers.env');
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Throws naming each bad line by number, never its text: it may hold a value. */
export function parseSecretsFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const match = LINE.exec(line);
    if (!match) {
      bad.push(index + 1);
      return;
    }
    const raw = (match[2] as string).trim();
    const quoted =
      raw.length >= 2 &&
      (raw[0] === "'" || raw[0] === '"') &&
      raw.endsWith(raw[0] as string);
    values[match[1] as string] = quoted ? raw.slice(1, -1) : raw;
  });
  if (bad.length)
    throw new Error(
      bad.map((n) => `line ${n}: expected KEY=value`).join('; '),
    );
  return values;
}

/** The file's values; `{}` when it does not exist. Refuses a file others can read. */
export function loadSecretsFile(path = secretsFilePath()): Record<string, string> {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  if (mode & 0o077)
    throw new Error(
      `${path} is readable by group or others; not loaded. Fix it with: chmod 600 ${path}`,
    );
  try {
    return parseSecretsFile(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`);
  }
}

/** The declared `names` a run gets: a non-empty shell value wins over the file. */
export function pickSecrets(
  names: readonly string[],
  file: Secrets,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = env[name] || file[name];
    if (value) picked[name] = value;
  }
  return picked;
}
