import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { homeBbDir } from './bakers-dir.js';

export const BB_PACKAGE = '@bakers-build/bakers';
export const REGISTRY_LATEST_URL =
  'https://registry.npmjs.org/@bakers-build/bakers/latest';
export const UNKNOWN_VERSION = '0.0.0';
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A module-level const would freeze the answer at import time, before a test
 * (or a container) sets BB_HOME — so this is a function, resolved through
 * the one place that decides where `.bakers` lives.
 */
export function defaultUpdateCachePath(): string {
  return join(homeBbDir(), 'update-check.json');
}

let cachedCliVersion: string | undefined;

export function resolveCliVersion(): string {
  if (cachedCliVersion) return cachedCliVersion;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 7; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { name?: string; version?: string };
      if (pkg.name === '@bakers-build/core') {
        cachedCliVersion = pkg.version ?? UNKNOWN_VERSION;
        return cachedCliVersion;
      }
    } catch {}
    dir = dirname(dir);
  }
  cachedCliVersion = UNKNOWN_VERSION;
  return cachedCliVersion;
}

export async function fetchLatestVersion(
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 1500,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fetchImpl(REGISTRY_LATEST_URL, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'X-Bakers-Client': `bakers/${resolveCliVersion()}`,
      },
    });
    if (!result.ok) return null;
    const body = (await result.json()) as { version?: unknown };
    return typeof body.version === 'string' && semver.valid(body.version)
      ? body.version
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function updateNotice(current: string, latest: string): string | null {
  if (
    current === UNKNOWN_VERSION ||
    !semver.valid(current) ||
    !semver.valid(latest) ||
    !semver.gt(latest, current)
  )
    return null;
  return `A new bakers version is available: ${current} → ${latest}\nRun \`bakers update\` to install it, then \`bakers config upgrade\` to migrate your config.`;
}

export interface UpdateCheckResult {
  checkedAt: string;
  latestVersion: string | null;
  declined?: boolean;
}
export interface UpdateCheckOptions {
  cachePath?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  writeFileImpl?: typeof writeFile;
}

function validRecord(value: unknown): UpdateCheckResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<UpdateCheckResult>;
  if (
    typeof record.checkedAt !== 'string' ||
    (record.latestVersion !== null && typeof record.latestVersion !== 'string')
  )
    return null;
  const time = Date.parse(record.checkedAt);
  if (!Number.isFinite(time)) return null;
  const parsed: UpdateCheckResult = {
    checkedAt: record.checkedAt,
    latestVersion: record.latestVersion ?? null,
  };
  if (record.declined === true) parsed.declined = true;
  return parsed;
}

async function persistRecord(
  cachePath: string,
  record: UpdateCheckResult,
  writeFileImpl: typeof writeFile = writeFile,
): Promise<boolean> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFileImpl(temporary, JSON.stringify(record), 'utf8');
    await rename(temporary, cachePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkForUpdate(
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckResult> {
  const cachePath = options.cachePath ?? defaultUpdateCachePath();
  const now = options.now?.() ?? new Date();
  const ttl = options.ttlMs ?? UPDATE_CHECK_TTL_MS;
  try {
    const record = validRecord(JSON.parse(await readFile(cachePath, 'utf8')));
    if (record) {
      const age = now.getTime() - Date.parse(record.checkedAt);
      if (age >= 0 && age < ttl) return record;
    }
  } catch {}
  const latestVersion = await fetchLatestVersion(
    options.fetchImpl,
    options.timeoutMs,
  );
  const result: UpdateCheckResult = {
    checkedAt: now.toISOString(),
    latestVersion,
  };
  await persistRecord(cachePath, result, options.writeFileImpl);
  return result;
}

export async function declineUpdate(
  result: UpdateCheckResult,
  options: UpdateCheckOptions = {},
): Promise<boolean> {
  const cachePath = options.cachePath ?? defaultUpdateCachePath();
  try {
    const record = validRecord(JSON.parse(await readFile(cachePath, 'utf8')));
    if (
      !record ||
      record.checkedAt !== result.checkedAt ||
      record.latestVersion !== result.latestVersion
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return persistRecord(
    cachePath,
    {
      checkedAt: result.checkedAt,
      latestVersion: result.latestVersion,
      declined: true,
    },
    options.writeFileImpl,
  );
}

export async function fetchUpdateNotice(
  current: string,
  options: UpdateCheckOptions = {},
): Promise<string | null> {
  const result = await checkForUpdate(options);
  return result.latestVersion
    ? updateNotice(current, result.latestVersion)
    : null;
}

export function printVersionLine(
  out: (line: string) => void = console.log,
): string {
  const version = resolveCliVersion();
  out(`bakers v${version}`);
  return version;
}
