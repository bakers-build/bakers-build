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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// `bakers ui` re-execs under the Bun binary this addon pins, and Bun's
// `createRequire` can treat the isolated auto-install cache as a hit for a
// directory with no `node_modules`. Vitest itself runs under Node, where that
// hit never happens, so every assertion here spawns the pinned Bun and
// asserts on what `resolveModuleEslintStyle` returns inside that child.
function resolvePinnedBun(): string {
  const addonPackageJson = fileURLToPath(
    new URL('../../../addons/bakers-ui/package.json', import.meta.url),
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
const resolveModulePath = fileURLToPath(
  new URL('../../src/cli/resolve-module.ts', import.meta.url),
);
const hostPackageJson = new URL('../../../host/package.json', import.meta.url)
  .href;
const spec = '@bakers-build/addon-bakers-ui-artifacts/ui';

function runnerScript(emptyBase: string, hostBase: string, cacheDir: string) {
  return (
    `import { createRequire } from 'node:module';\n` +
    `import { pathToFileURL } from 'node:url';\n` +
    `import { resolveModuleEslintStyle } from ${JSON.stringify(resolveModulePath)};\n` +
    `const spec = ${JSON.stringify(spec)};\n` +
    `const emptyBase = ${JSON.stringify(emptyBase)};\n` +
    `const hostBase = ${JSON.stringify(hostBase)};\n` +
    `let bunRaw;\n` +
    `try { bunRaw = createRequire(emptyBase).resolve(spec); } catch (e) {\n` +
    `  bunRaw = { error: e instanceof Error ? e.message : String(e) };\n` +
    `}\n` +
    `const resolved = resolveModuleEslintStyle(spec, [emptyBase, hostBase]);\n` +
    `const hoisted = resolveModuleEslintStyle(spec, [hostBase, emptyBase]);\n` +
    `let importError = null;\n` +
    `if (typeof resolved === 'string') {\n` +
    `  try { await import(pathToFileURL(resolved).href); }\n` +
    `  catch (e) { importError = e instanceof Error ? e.message : String(e); }\n` +
    `}\n` +
    `console.log(JSON.stringify({\n` +
    `  bunRaw,\n` +
    `  resolved,\n` +
    `  hoisted,\n` +
    `  importError,\n` +
    `  cacheDir: ${JSON.stringify(cacheDir)},\n` +
    `}));\n`
  );
}

describe('resolveModuleEslintStyle under the pinned Bun', () => {
  const cleanups: string[] = [];
  function tmpDir(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    cleanups.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of cleanups.splice(0))
      rmSync(d, { recursive: true, force: true });
  });

  it('skips an isolated-cache hit on an empty first base and falls through to the host tree', () => {
    const emptyDir = tmpDir('bakers-resolve-empty-');
    mkdirSync(emptyDir, { recursive: true });
    const cacheDir = tmpDir('bakers-resolve-buncache-');
    const runnerDir = tmpDir('bakers-resolve-runner-');
    const emptyBase = pathToFileURL(`${emptyDir}/`).href;
    const runner = join(runnerDir, 'run.mjs');
    writeFileSync(runner, runnerScript(emptyBase, hostPackageJson, cacheDir));

    const result = spawnSync(bun, ['run', runner], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir },
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '');
    expect(typeof parsed.bunRaw).toBe('string');
    expect(parsed.bunRaw.replaceAll('\\', '/')).toContain(
      cacheDir.replaceAll('\\', '/'),
    );
    expect(typeof parsed.resolved).toBe('string');
    expect(parsed.resolved.replaceAll('\\', '/')).not.toContain(
      cacheDir.replaceAll('\\', '/'),
    );
    expect(parsed.resolved).toMatch(/bakers-ui-artifacts/);
    expect(parsed.importError).toBeNull();
    expect(parsed.hoisted).toMatch(/bakers-ui-artifacts/);
    expect(parsed.hoisted.replaceAll('\\', '/')).not.toContain(
      cacheDir.replaceAll('\\', '/'),
    );
  }, 60_000);
});
