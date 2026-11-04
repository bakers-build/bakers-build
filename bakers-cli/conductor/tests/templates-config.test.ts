import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// BB-215: the shipped templates moved to the Storybook-style addon form. These
// assert that every addon spec named in BOTH template surfaces RESOLVES to a real
// module (the class of bug the old plugins[] test guarded — a renamed/missing
// package makes every `bakers …` in a generated project throw). Resolution uses the
// META package base (@bakers-build/bakers), the production-faithful location where a
// global install keeps every addon. This checks resolvability only — it does NOT
// construct the plugins, so it stays independent of the developer's local
// `conductor.config.local.js` credentials (which the templates read via loadLocal).
const CONDUCTOR_URL = new URL(
  '../../templates/conductor.config.js',
  import.meta.url,
);
const CONNECTION_URL = new URL(
  '../../templates/bakers.config.js',
  import.meta.url,
);
const require = createRequire(
  new URL('../../host/package.json', import.meta.url),
);

/** Extract each addon entry's package spec (a bare string or `{ use }`/`{ name }`). */
function specsOf(addons: unknown[]): string[] {
  return addons.map((a) => {
    if (typeof a === 'string') return a;
    const o = a as { use?: string; name?: string };
    const spec = o.use ?? o.name;
    if (typeof spec !== 'string') {
      throw new Error(`addon entry names no package: ${JSON.stringify(a)}`);
    }
    return spec;
  });
}

describe('templates — every addon spec resolves (BB-215 addon form)', () => {
  it('templates/conductor.config.js addons[] all resolve', async () => {
    const config = (await import(CONDUCTOR_URL.href)).default as {
      addons: unknown[];
    };
    expect(Array.isArray(config.addons)).toBe(true);
    for (const spec of specsOf(config.addons)) {
      expect(() => require.resolve(spec), spec).not.toThrow();
    }
  });

  it('templates/bakers.config.js addons[] all resolve', async () => {
    const config = (await import(CONNECTION_URL.href)).default as {
      addons: unknown[];
    };
    expect(Array.isArray(config.addons)).toBe(true);
    for (const spec of specsOf(config.addons)) {
      expect(() => require.resolve(spec), spec).not.toThrow();
    }
    // essentials is always present (auth entries are local-config gated).
    expect(specsOf(config.addons)).toContain('@bakers-build/addon-essentials');
  });

  it('templates carry no conductor or machine identity', async () => {
    for (const name of ['conductor.config.js', 'conductor.config.local.js']) {
      const url = new URL(`../../templates/${name}`, import.meta.url);
      const config = (await import(url.href)).default as Record<
        string,
        unknown
      >;
      for (const key of ['conductor_id', 'machine_id', 'label'])
        expect(config, `${name} ${key}`).not.toHaveProperty(key);
      expect(readFileSync(url, 'utf8')).not.toContain('loadMachine');
    }
  });
});
