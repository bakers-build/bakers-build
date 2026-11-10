import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { homeBbDir } from '../../src/cli/bakers-dir.js';
import { homeBbDirInline } from '../../src/cli/import-config.js';

// BB-470: `bakers ui` re-execs under the Bun this addon pins
// (`bakers-cli/addons/bakers-ui/package.json`), and Bun caps any module
// specifier at a fixed size — `importConfig` (`../../src/cli/import-config.ts`)
// hands it a base64 `data:` URL, so a connection config over roughly 1.9 KB
// made `bakers ui` unstartable. Vitest itself runs under Node, where the
// resolver defect cannot reproduce, so every assertion here spawns the
// PINNED Bun binary as a real child process and asserts on its exit status —
// a normally-written test would be a false green (see `ui/tests/ui-pty.test.ts`
// for the same precedent).
function resolvePinnedBun(): string {
  const addonPackageJson = join(
    __dirname,
    '..',
    '..',
    'addons',
    'bakers-ui',
    'package.json',
  );
  const addonRequire = createRequire(addonPackageJson);
  const addonEntry = addonRequire.resolve('@bakers-build/addon-bakers-ui');
  const manifestPath = createRequire(addonEntry).resolve('bun/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: Record<string, string> | string;
  };
  const relative =
    typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.bun;
  if (!relative)
    throw new Error(`bun package manifest at ${manifestPath} has no bin`);
  return join(dirname(manifestPath), relative);
}

const bun = resolvePinnedBun();

const importConfigPath = join(
  __dirname,
  '..',
  '..',
  'src',
  'cli',
  'import-config.ts',
);

function runnerScript(configPath: string): string {
  return (
    `import { importConfig } from ${JSON.stringify(importConfigPath)};\n` +
    `const module = await importConfig(${JSON.stringify(configPath)});\n` +
    'console.log(JSON.stringify(module.default));\n'
  );
}

describe('importConfig under the pinned Bun (BB-470)', () => {
  let tmp: string;
  const cleanups: string[] = [];
  function tmpDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'bakers-import-config-'));
    cleanups.push(d);
    return d;
  }

  function cleanup() {
    for (const d of cleanups.splice(0))
      rmSync(d, { recursive: true, force: true });
  }

  it('loads a connection config well above the old ~1.9 KB ceiling', () => {
    tmp = tmpDir();
    const configPath = join(tmp, 'bakers.config.js');
    // BB-470 AC-1: at least the 8877 B `e0c3fd62` size. Padded well past it
    // with a block comment so the padding cannot change what the config means.
    const padding = '/*'.concat('x'.repeat(9000), '*/');
    writeFileSync(
      configPath,
      `${padding}\nexport default { site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' }, workspace_id: 'w', plugins: [] };\n`,
    );
    const runner = join(tmp, 'run.mjs');
    writeFileSync(runner, runnerScript(configPath));

    const result = spawnSync(bun, ['run', runner], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
      workspace_id: 'w',
      plugins: [],
    });
    cleanup();
  });

  it('preserves semantics for a local import and a computed HOME import (AC-3)', () => {
    tmp = tmpDir();
    const home = tmpDir();
    const bakersHome = join(home, '.bakers');
    mkdirSync(bakersHome, { recursive: true });
    writeFileSync(
      join(bakersHome, 'machine.config.js'),
      `export const machineValue = 'from-machine';\n` +
        `export function leafUrl() { return import.meta.url; }\n`,
    );
    const configPath = join(tmp, 'bakers.config.js');
    writeFileSync(
      configPath,
      `const { machineValue, leafUrl } = await import(\`\${process.env.HOME}/.bakers/machine.config.js\`);\n` +
        `export default { site: { base_url: 'https://x.test' }, workspace_id: machineValue, plugins: [], leaf: leafUrl() };\n`,
    );
    const runner = join(tmp, 'run.mjs');
    writeFileSync(runner, runnerScript(configPath));

    const result = spawnSync(bun, ['run', runner], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.workspace_id).toBe('from-machine');
    expect(parsed.leaf).toBe(
      pathToFileURL(join(bakersHome, 'machine.config.js')).href,
    );
    cleanup();
  });

  // Review finding: the renderer moved to a BAKERS_HOME-aware computed
  // import, and the recogniser above kept matching only the old
  // `${process.env.HOME}/.bakers/…` shape — the new shape fell to the generic
  // computed-import branch and lost recursive refresh (measured STALE).
  it('preserves semantics for a computed BAKERS_HOME import (AC-3)', () => {
    tmp = tmpDir();
    const bakersHome = tmpDir();
    writeFileSync(
      join(bakersHome, 'machine.config.js'),
      `export const machineValue = 'from-machine';\n` +
        `export function leafUrl() { return import.meta.url; }\n`,
    );
    const configPath = join(tmp, 'bakers.config.js');
    writeFileSync(
      configPath,
      `const { machineValue, leafUrl } = await import(\`\${process.env.BAKERS_HOME ?? \`\${process.env.HOME}/.bakers\`}/machine.config.js\`);\n` +
        `export default { site: { base_url: 'https://x.test' }, workspace_id: machineValue, plugins: [], leaf: leafUrl() };\n`,
    );
    const runner = join(tmp, 'run.mjs');
    writeFileSync(runner, runnerScript(configPath));

    const result = spawnSync(bun, ['run', runner], {
      encoding: 'utf8',
      env: { ...process.env, BAKERS_HOME: bakersHome },
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.workspace_id).toBe('from-machine');
    expect(parsed.leaf).toBe(
      pathToFileURL(join(bakersHome, 'machine.config.js')).href,
    );
    cleanup();
  });

  // AC-4 for the BAKERS_HOME-computed import specifically: a re-import within
  // one process must see an edited machine.config.js, which is the exact
  // contract the review finding measured broken.
  it('reloads a changed BAKERS_HOME import within one process (AC-4)', () => {
    tmp = tmpDir();
    const bakersHome = tmpDir();
    const leaf = join(bakersHome, 'machine.config.js');
    writeFileSync(leaf, `export const value = 'first';\n`);
    const configPath = join(tmp, 'bakers.config.js');
    writeFileSync(
      configPath,
      `const { value } = await import(\`\${process.env.BAKERS_HOME ?? \`\${process.env.HOME}/.bakers\`}/machine.config.js\`);\n` +
        `export default { site: { base_url: 'https://x.test' }, workspace_id: value, plugins: [] };\n`,
    );
    const runner = join(tmp, 'run.mjs');
    writeFileSync(runner, freshnessRunnerScript(configPath, leaf));

    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      env: { ...process.env, BAKERS_HOME: bakersHome },
    });

    expect(result.status).toBe(0);
    const [first, second] = result.stdout.trim().split('\n');
    expect(JSON.parse(first).workspace_id).toBe('first');
    expect(JSON.parse(second).workspace_id).toBe('second');
    cleanup();
  });

  // Review finding, second pass: widening the recogniser to an alternation
  // must not leave the OLD `${process.env.HOME}/.bakers/…` shape stale — the
  // same single-process reload contract the BAKERS_HOME shape is held to above.
  it('reloads a changed HOME import within one process (AC-4)', () => {
    tmp = tmpDir();
    const home = tmpDir();
    const bakersHome = join(home, '.bakers');
    mkdirSync(bakersHome, { recursive: true });
    const leaf = join(bakersHome, 'machine.config.js');
    writeFileSync(leaf, `export const value = 'first';\n`);
    const configPath = join(tmp, 'bakers.config.js');
    writeFileSync(
      configPath,
      `const { value } = await import(\`\${process.env.HOME}/.bakers/machine.config.js\`);\n` +
        `export default { site: { base_url: 'https://x.test' }, workspace_id: value, plugins: [] };\n`,
    );
    const runner = join(tmp, 'run.mjs');
    writeFileSync(runner, freshnessRunnerScript(configPath, leaf));

    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });

    expect(result.status).toBe(0);
    const [first, second] = result.stdout.trim().split('\n');
    expect(JSON.parse(first).workspace_id).toBe('first');
    expect(JSON.parse(second).workspace_id).toBe('second');
    cleanup();
  });

  // AC-4 requires the reload to happen inside a SINGLE process: two separate
  // `spawnSync` calls share no module cache, so a two-process test passes for
  // any implementation whatsoever, including the `file://`-based one
  // `diagnose` measured as STALE (review finding on BB-470). The runner
  // script below performs both `importConfig` calls itself, rewriting the
  // leaf between them, so freshness is proven within one process.
  function freshnessRunnerScript(configPath: string, leafPath: string): string {
    return (
      `import { writeFileSync } from 'node:fs';\n` +
      `import { importConfig } from ${JSON.stringify(importConfigPath)};\n` +
      `const first = await importConfig(${JSON.stringify(configPath)});\n` +
      `console.log(JSON.stringify(first.default));\n` +
      `writeFileSync(${JSON.stringify(leafPath)}, "export const value = 'second';\\n");\n` +
      `const second = await importConfig(${JSON.stringify(configPath)});\n` +
      `console.log(JSON.stringify(second.default));\n`
    );
  }

  function assertFreshness(runtime: string, args: string[]) {
    tmp = tmpDir();
    const leaf = join(tmp, 'leaf.js');
    writeFileSync(leaf, `export const value = 'first';\n`);
    const configPath = join(tmp, 'bakers.config.js');
    writeFileSync(
      configPath,
      `import { value } from './leaf.js';\n` +
        `export default { site: { base_url: 'https://x.test' }, workspace_id: value, plugins: [] };\n`,
    );
    const runner = join(tmp, 'run.mjs');
    writeFileSync(runner, freshnessRunnerScript(configPath, leaf));

    const result = spawnSync(runtime, [...args, runner], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const [first, second] = result.stdout.trim().split('\n');
    expect(JSON.parse(first).workspace_id).toBe('first');
    expect(JSON.parse(second).workspace_id).toBe('second');
    cleanup();
  }

  it('reloads a changed local import within one process, under Bun (AC-4)', () => {
    assertFreshness(bun, ['run']);
  });

  it('reloads a changed local import within one process, under Node (AC-4)', () => {
    assertFreshness(process.execPath, []);
  });
});

// homeBbDirInline() re-spells homeBbDir()'s no-home branch for this file's
// raw-entry-point constraint. Nothing else asserts the two agree; this pins
// that they do, under both an overridden and a default BAKERS_HOME.
describe('homeBbDirInline parity with homeBbDir', () => {
  const original = process.env.BAKERS_HOME;

  afterEach(() => {
    if (original === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = original;
  });

  it('agrees with homeBbDir() under an overridden BAKERS_HOME', () => {
    process.env.BAKERS_HOME = join(tmpdir(), 'bakers-inline-parity');
    expect(homeBbDirInline()).toBe(homeBbDir());
  });

  it('agrees with homeBbDir() under the default (no BAKERS_HOME)', () => {
    delete process.env.BAKERS_HOME;
    expect(homeBbDirInline()).toBe(homeBbDir());
  });
});
