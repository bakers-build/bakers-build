import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const core = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('config types derived from the schemas', () => {
  it('are up to date with core/schema', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [join(core, 'scripts', 'schema-types.mjs'), '--check'],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it('mark a misspelled key in a typed config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-config-types-'));
    const types = join(core, 'src', 'config-types.generated.ts');
    writeFileSync(
      join(dir, 'config.ts'),
      `import type { ProjectConfig } from ${JSON.stringify(types.replace(/\.ts$/, '.js'))};
const ok: ProjectConfig = { project: { name: 'demo' }, lease_seconds: 300 };
// @ts-expect-error misspelled key
const typo: ProjectConfig = { project: { name: 'demo' }, lease_secnds: 300 };
export { ok, typo };
`,
    );
    const tsc = join(core, 'node_modules', 'typescript', 'bin', 'tsc');
    expect(() =>
      execFileSync(
        process.execPath,
        [
          tsc,
          '--noEmit',
          '--strict',
          '--module',
          'nodenext',
          '--moduleResolution',
          'nodenext',
          '--allowImportingTsExtensions',
          '--rewriteRelativeImportExtensions',
          join(dir, 'config.ts'),
        ],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  }, 60_000);
});
