/**
 * A project's agent plugins: the `marketplaces` declaration of its committed
 * conductor config, and the per-harness agent home they are installed into.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** One Git marketplace at a branch or tag, and the plugins to install from it. */
export interface MarketplaceDeclaration {
  url: string;
  ref: string;
  plugins: string[];
}

// Both harnesses fetch only remote Git sources (no file://, no local path).
const GIT_URL = /^(?:https?:\/\/|ssh:\/\/|git@[^:\s]+:)\S+$/;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** Validate the `marketplaces` key of a project conductor config. */
export function validateMarketplaces(value: unknown): MarketplaceDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('marketplaces must be an array');
  return value.map((entry: unknown, index) => {
    const at = `marketplaces[${index}]`;
    const raw = (entry ?? {}) as Record<string, unknown>;
    if (!nonEmpty(raw.url) || !GIT_URL.test(raw.url))
      throw new Error(`${at}.url must be a remote Git URL (https, ssh or git@)`);
    if (!nonEmpty(raw.ref))
      throw new Error(`${at}.ref must name a branch or tag`);
    if (
      !Array.isArray(raw.plugins) ||
      raw.plugins.length === 0 ||
      !raw.plugins.every(nonEmpty)
    )
      throw new Error(`${at}.plugins must be a non-empty list of plugin names`);
    return {
      url: raw.url,
      ref: raw.ref,
      plugins: raw.plugins as string[],
    };
  });
}

/** The first 16 hex chars of the sha256 of the normalized declaration. */
export function homeKey(marketplaces: MarketplaceDeclaration[]): string {
  const canonical = marketplaces.map(({ url, ref, plugins }) => ({
    url,
    ref,
    plugins,
  }));
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 16);
}

/** `~/.cache/bakers/agent-homes/<harness>/<key>`, outside the sandbox-hidden `~/.bakers`. */
export function homePath(harness: string, key: string): string {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(cache, 'bakers', 'agent-homes', harness, key);
}

const READY = '.bakers-ready';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Take `<home>.lock`; a lock whose owner process is gone is taken over. */
async function lock(path: string): Promise<() => void> {
  const file = `${path}.lock`;
  const owner = `${process.pid}:${Math.random()}`;
  for (;;) {
    try {
      writeFileSync(file, owner, { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    let held = '';
    try {
      held = readFileSync(file, 'utf8');
    } catch {}
    // shortcut: two waiters reaping the same stale lock at once can both win; upgrade to an fcntl lock if that is ever seen.
    const pid = Number.parseInt(held, 10);
    if (Number.isInteger(pid) && !alive(pid)) rmSync(file, { force: true });
    else await sleep(100);
  }
}

/**
 * Make `path` a complete agent home: `reused` when a previous build finished,
 * else `build(path)` runs under the lock and the home is `built`. A failed
 * build leaves no home behind.
 */
export async function ensureHome(
  path: string,
  build: (path: string) => Promise<void>,
): Promise<'built' | 'reused'> {
  if (existsSync(join(path, READY))) return 'reused';
  mkdirSync(join(path, '..'), { recursive: true });
  const release = await lock(path);
  try {
    if (existsSync(join(path, READY))) return 'reused';
    rmSync(path, { recursive: true, force: true });
    mkdirSync(path);
    try {
      await build(path);
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      throw error;
    }
    writeFileSync(join(path, READY), new Date().toISOString());
    return 'built';
  } finally {
    release();
  }
}
