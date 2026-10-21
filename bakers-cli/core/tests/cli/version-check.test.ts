import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  declineUpdate,
  defaultUpdateCachePath,
  fetchLatestVersion,
  fetchUpdateNotice,
  resolveCliVersion,
  UPDATE_CHECK_TTL_MS,
  updateNotice,
} from '../../src/cli/version-check.js';

const now = new Date('2026-08-03T12:00:00.000Z');
const response = (version: unknown): typeof fetch =>
  vi.fn(
    async () => new Response(JSON.stringify({ version }), { status: 200 }),
  ) as typeof fetch;

describe('version discovery', () => {
  it('resolves the executing package version', () => {
    expect(resolveCliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('only reports a strictly newer valid semantic version', () => {
    expect(updateNotice('1.2.3', '1.3.0')).toContain('bakers update');
    expect(updateNotice('1.2.3', '1.3.0')).toContain('bakers config upgrade');
    expect(updateNotice('1.2.3', '1.2.3')).toBeNull();
    expect(updateNotice('2.0.0', '1.3.0')).toBeNull();
    expect(updateNotice('invalid', '1.3.0')).toBeNull();
  });

  it('fails silently for rejected and malformed registry responses', async () => {
    const rejected = vi.fn(async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await fetchLatestVersion(rejected, 10)).toBeNull();
    expect(await fetchLatestVersion(response(42), 10)).toBeNull();
  });
});

describe('default update-check cache path', () => {
  const original = process.env.BB_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.BB_HOME;
    else process.env.BB_HOME = original;
  });

  it('lands under an overridden BB_HOME, not the OS home', () => {
    process.env.BB_HOME = join(tmpdir(), 'bakers-home-update-check-probe');
    expect(defaultUpdateCachePath()).toBe(
      join(tmpdir(), 'bakers-home-update-check-probe', 'update-check.json'),
    );
  });

  it('falls back to ~/.bakers when BB_HOME is unset', () => {
    delete process.env.BB_HOME;
    expect(defaultUpdateCachePath()).toBe(
      join(homedir(), '.bakers', 'update-check.json'),
    );
  });
});

describe('daily cache', () => {
  it('reuses a fresh cached result without fetching', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bakers-update-'));
    const cachePath = join(dir, 'update-check.json');
    await writeFile(
      cachePath,
      JSON.stringify({ checkedAt: now.toISOString(), latestVersion: '9.0.0' }),
    );
    const fetchImpl = response('10.0.0');
    expect(
      await fetchUpdateNotice('1.0.0', {
        cachePath,
        now: () => now,
        fetchImpl,
      }),
    ).toContain('9.0.0');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['stale', new Date(now.getTime() - 24 * 60 * 60 * 1000)],
    ['future', new Date(now.getTime() + 1)],
  ])('refreshes a %s cache and atomically persists the result', async (_label, checkedAt) => {
    const dir = await mkdtemp(join(tmpdir(), 'bakers-update-'));
    const cachePath = join(dir, 'update-check.json');
    await writeFile(
      cachePath,
      JSON.stringify({
        checkedAt: checkedAt.toISOString(),
        latestVersion: '2.0.0',
      }),
    );
    const fetchImpl = response('3.0.0');
    expect(
      await fetchUpdateNotice('1.0.0', {
        cachePath,
        now: () => now,
        fetchImpl,
      }),
    ).toContain('3.0.0');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({
      checkedAt: now.toISOString(),
      latestVersion: '3.0.0',
    });
  });

  it('caches an offline attempt and remains silent inside the window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bakers-update-'));
    const cachePath = join(dir, 'update-check.json');
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(
      await fetchUpdateNotice('1.0.0', {
        cachePath,
        now: () => now,
        fetchImpl,
      }),
    ).toBeNull();
    expect(
      await fetchUpdateNotice('1.0.0', {
        cachePath,
        now: () => now,
        fetchImpl,
      }),
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('recovers silently from a corrupt cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bakers-update-'));
    const cachePath = join(dir, 'update-check.json');
    await writeFile(cachePath, '{');
    await expect(
      fetchUpdateNotice('1.0.0', {
        cachePath,
        now: () => now,
        fetchImpl: response('2.0.0'),
      }),
    ).resolves.toContain('2.0.0');
  });
});

describe('structured update result and decline', () => {
  async function seedCache(record: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bakers-update-'));
    const cachePath = join(dir, 'update-check.json');
    await writeFile(cachePath, JSON.stringify(record));
    return cachePath;
  }

  it('reuses a legacy cache without a declined marker', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
    const fetchImpl = response('10.0.0');
    await expect(
      checkForUpdate({ cachePath, now: () => now, fetchImpl }),
    ).resolves.toEqual({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists a decline against the original check without fetching', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
    const fetchImpl = response('10.0.0');
    const result = await checkForUpdate({
      cachePath,
      now: () => now,
      fetchImpl,
    });
    expect(await declineUpdate(result, { cachePath })).toBe(true);
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toMatchObject({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
      declined: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await fetchUpdateNotice('1.0.0', {
        cachePath,
        now: () => now,
        fetchImpl,
      }),
    ).toContain('9.0.0');
  });

  it('treats a UI-populated cache without a decline as undeclined', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
    const result = await checkForUpdate({
      cachePath,
      now: () => now,
      fetchImpl: response('10.0.0'),
    });
    expect(result.declined).toBeUndefined();
    expect(result.latestVersion).toBe('9.0.0');
  });

  it('refreshes and drops a decline at exact TTL expiry', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
      declined: true,
    });
    const fetchImpl = response('10.0.0');
    const expiry = new Date(now.getTime() + UPDATE_CHECK_TTL_MS);
    await expect(
      checkForUpdate({ cachePath, now: () => expiry, fetchImpl }),
    ).resolves.toEqual({
      checkedAt: expiry.toISOString(),
      latestVersion: '10.0.0',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({
      checkedAt: expiry.toISOString(),
      latestVersion: '10.0.0',
    });
  });

  it('refreshes a future-dated cache rather than suppressing forever', async () => {
    const cachePath = await seedCache({
      checkedAt: new Date(now.getTime() + 1).toISOString(),
      latestVersion: '9.0.0',
      declined: true,
    });
    const fetchImpl = response('10.0.0');
    await expect(
      checkForUpdate({ cachePath, now: () => now, fetchImpl }),
    ).resolves.toEqual({
      checkedAt: now.toISOString(),
      latestVersion: '10.0.0',
    });
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).not.toHaveProperty(
      'declined',
    );
  });

  it('treats an invalid declined marker as absent', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
      declined: 'yes',
    });
    await expect(
      checkForUpdate({
        cachePath,
        now: () => now,
        fetchImpl: response('10.0.0'),
      }),
    ).resolves.toEqual({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
  });

  it('refuses to persist a decline after the cache was replaced', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
    const stale = await checkForUpdate({
      cachePath,
      now: () => now,
      fetchImpl: response('10.0.0'),
    });
    await writeFile(
      cachePath,
      JSON.stringify({
        checkedAt: now.toISOString(),
        latestVersion: '11.0.0',
      }),
    );
    expect(await declineUpdate(stale, { cachePath })).toBe(false);
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({
      checkedAt: now.toISOString(),
      latestVersion: '11.0.0',
    });
  });

  it('returns false when a matching cache cannot be rewritten', async () => {
    const cachePath = await seedCache({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
    const result = {
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    };
    const writeFileImpl = vi.fn(async () => {
      throw new Error('EACCES');
    });
    expect(
      await declineUpdate(result, {
        cachePath,
        writeFileImpl,
      }),
    ).toBe(false);
    expect(writeFileImpl).toHaveBeenCalled();
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({
      checkedAt: now.toISOString(),
      latestVersion: '9.0.0',
    });
  });

  it('returns false when the cache is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bakers-update-'));
    expect(
      await declineUpdate(
        { checkedAt: now.toISOString(), latestVersion: '9.0.0' },
        { cachePath: join(dir, 'update-check.json') },
      ),
    ).toBe(false);
  });
});
