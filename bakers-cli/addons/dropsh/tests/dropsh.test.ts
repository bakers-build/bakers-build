import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BbCommandHost } from '@bakers-build/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import dropshCommandPlugin, { dropshConfigHint } from '../src/index.js';

const host: BbCommandHost = { resolveBases: [import.meta.url] };
const here = dirname(fileURLToPath(import.meta.url));

describe('@bakers-build/addon-dropsh command plugin', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DROPSH_CONFIG;
    delete process.env.DROPSH_CONFIG;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DROPSH_CONFIG;
    else process.env.DROPSH_CONFIG = saved;
  });

  it('declares name + describe (AC-2 stub metadata)', () => {
    expect(dropshCommandPlugin.name).toBe('dropsh');
    expect(dropshCommandPlugin.describe).toMatch(/dropsh/i);
  });

  it('mounts a `dropsh` subcommand on the host program (built from the connection)', async () => {
    const program = new Command();
    await dropshCommandPlugin.register(program, host);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('dropsh');
  });

  it('registration leaves connection resolution to dispatch', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bakers-dropsh-'));
    try {
      const d = join(tmp, '.bakers');
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, 'bakers.config.js'),
        `export default { site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
      );
      const origCwd = process.cwd();
      process.chdir(tmp);
      try {
        const program = new Command();
        await dropshCommandPlugin.register(program, host);
        expect(process.env.DROPSH_CONFIG).toBeUndefined();
      } finally {
        process.chdir(origCwd);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('dropshConfigHint names the connection sources', () => {
    const hint = dropshConfigHint('/x/bakers.config.js');
    expect(hint).toMatch(/bakers\.config\.js/);
    expect(hint).toMatch(/--config/);
  });
});

// AC-2 (no eager engine): the dropsh command package must not statically import
// `@bakers-build/conductor`, `loadConductorConfig`, or any engine plugin — a
// `bakers dropsh read` builds ONLY dropsh auth plugins.
describe('@bakers-build/addon-dropsh imports no engine (AC-2)', () => {
  it('src imports no conductor engine or engine plugin', () => {
    const src = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8');
    // Only real import/from statements count — prose in comments does not.
    const imports = src
      .split('\n')
      .filter((l) => /\bfrom\s+['"]/.test(l) || /\bimport\s*\(/.test(l))
      .join('\n');
    expect(imports).not.toMatch(/@bakers-ai\/conductor/);
    expect(imports).not.toMatch(/loadConductorConfig/);
    expect(imports).not.toMatch(/@bakers-ai\/addon-herdr/);
  });

  it('peer-depends on exactly @bakers-build/core, with no @bakers-build/* runtime deps', () => {
    const pkg = JSON.parse(
      readFileSync(join(here, '..', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(['@bakers-build/core']);
    const bakersDeps = Object.keys(pkg.dependencies ?? {}).filter((n) =>
      n.startsWith('@bakers-build/'),
    );
    expect(bakersDeps).toEqual([]);
  });
});
