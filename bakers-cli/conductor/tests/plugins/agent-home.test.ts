import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureHome,
  homeKey,
  homePath,
  type MarketplaceDeclaration,
} from '../../src/plugins/agent-home.js';

const ponytail: MarketplaceDeclaration = {
  url: 'https://github.com/DietrichGebert/ponytail.git',
  ref: 'v5.3.3',
  plugins: ['ponytail'],
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bakers-agent-home-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CACHE_HOME', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('homeKey', () => {
  it('is stable for equal declarations, whatever the key order', () => {
    expect(homeKey([ponytail])).toBe(
      homeKey([{ plugins: ['ponytail'], ref: 'v5.3.3', url: ponytail.url }]),
    );
    expect(homeKey([ponytail])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs when a ref, url or plugin differs', () => {
    const key = homeKey([ponytail]);
    expect(homeKey([{ ...ponytail, ref: 'v5.3.4' }])).not.toBe(key);
    expect(homeKey([{ ...ponytail, plugins: ['other'] }])).not.toBe(key);
    expect(homeKey([{ ...ponytail, url: 'git@x:y.git' }])).not.toBe(key);
  });
});

describe('homePath', () => {
  it('lives under ~/.cache/bakers/agent-homes/<harness>/<key>, never under ~/.bakers', () => {
    expect(homePath('claude', 'abc')).toBe(
      join(home, '.cache/bakers/agent-homes/claude/abc'),
    );
    expect(homePath('claude', 'abc')).not.toContain('.bakers/');
  });

  it('honours XDG_CACHE_HOME', () => {
    vi.stubEnv('XDG_CACHE_HOME', '/xdg');
    expect(homePath('codex', 'abc')).toBe('/xdg/bakers/agent-homes/codex/abc');
  });
});

describe('ensureHome', () => {
  it('builds a missing home once, then reuses it without building', async () => {
    const path = join(home, 'h');
    const build = vi.fn(async (dir: string) => {
      writeFileSync(join(dir, 'installed'), 'yes');
    });
    await expect(ensureHome(path, build)).resolves.toBe('built');
    await expect(ensureHome(path, build)).resolves.toBe('reused');
    expect(build).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(path, 'installed'), 'utf8')).toBe('yes');
  });

  it('builds once when two runs race for the same home', async () => {
    const path = join(home, 'h');
    let builds = 0;
    const build = async () => {
      builds++;
      await new Promise((r) => setTimeout(r, 50));
    };
    const outcomes = await Promise.all([
      ensureHome(path, build),
      ensureHome(path, build),
    ]);
    expect(builds).toBe(1);
    expect(outcomes.sort()).toEqual(['built', 'reused']);
  });

  it('removes a failed build and rethrows, so the next run builds again', async () => {
    const path = join(home, 'h');
    await expect(
      ensureHome(path, async (dir) => {
        writeFileSync(join(dir, 'half'), '');
        throw new Error('install failed');
      }),
    ).rejects.toThrow('install failed');
    expect(existsSync(path)).toBe(false);
    await expect(ensureHome(path, async () => {})).resolves.toBe('built');
  });

  it('recovers a lock left behind by a dead process', async () => {
    const path = join(home, 'h');
    writeFileSync(`${path}.lock`, '999999999:stale');
    await expect(ensureHome(path, async () => {})).resolves.toBe('built');
  });
});
