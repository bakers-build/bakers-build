import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildHostProgram,
  DEFAULT_COMMANDS,
  resolveCliVersion,
  resolveCommands,
  runHost,
  scanTarget,
} from '../src/host.js';

const names = DEFAULT_COMMANDS.map((c) => c.name);

describe('scanTarget — value-aware lazy pre-scan (AC-2)', () => {
  it('picks the first positional command name', () => {
    expect(scanTarget(['oven', 'once'], names)).toBe('oven');
    expect(scanTarget(['dropsh', 'read', 'x'], names)).toBe('dropsh');
    expect(scanTarget(['ui'], names)).toBe('ui');
  });
  it('skips the value of the global --conductor flag', () => {
    expect(scanTarget(['--conductor', 'shop', 'dropsh', 'read'], names)).toBe(
      'dropsh',
    );
  });
  it('maps `help <name>` to that command', () => {
    expect(scanTarget(['help', 'oven'], names)).toBe('oven');
  });
  it('returns undefined for --help, an unknown first positional, or bare', () => {
    expect(scanTarget(['--help'], names)).toBeUndefined();
    expect(scanTarget(['help'], names)).toBeUndefined();
    expect(scanTarget(['bogus'], names)).toBeUndefined();
    expect(scanTarget([], names)).toBeUndefined();
  });
});

describe('resolveCommands (registry + $BB_COMMANDS override, AC-2)', () => {
  const saved = process.env.BB_COMMANDS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BB_COMMANDS;
    else process.env.BB_COMMANDS = saved;
  });
  it('defaults to oven/ui/dropsh/deployment/agents/info/ports/track', () => {
    delete process.env.BB_COMMANDS;
    expect(resolveCommands().map((c) => c.name)).toEqual([
      'oven',
      'ui',
      'dropsh',
      'deployment',
      'agents',
      'info',
      'ports',
      'track',
    ]);
  });
  it('honours a $BB_COMMANDS JSON override', () => {
    process.env.BB_COMMANDS = JSON.stringify([
      { name: 'x', plugin: '/tmp/x.mjs' },
    ]);
    expect(resolveCommands().map((c) => c.name)).toEqual(['x']);
  });
});

describe('buildHostProgram — help completeness + version (AC-1/AC-2)', () => {
  const saved = process.env.BB_COMMANDS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BB_COMMANDS;
    else process.env.BB_COMMANDS = saved;
  });

  it('lists all command plugins in --help (describe-only stubs)', async () => {
    delete process.env.BB_COMMANDS;
    const program = await buildHostProgram(['--help']);
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain('oven');
    expect(cmds).not.toContain('conductor');
    expect(cmds).not.toContain('bake');
    expect(cmds).toContain('ui');
    expect(cmds).toContain('dropsh');
    expect(cmds).toContain('deployment');
    // Also the host's own commands.
    expect(cmds).toContain('version');
    expect(cmds).toContain('config');
    expect(cmds).toContain('update');
  });

  it('resolveCliVersion returns the meta package version', () => {
    expect(resolveCliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('lazy mount — only the matched command module is imported (AC-2)', () => {
  let tmp: string;
  const saved = process.env.BB_COMMANDS;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-host-'));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.BB_COMMANDS;
    else process.env.BB_COMMANDS = saved;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('imports only the invoked command plugin, not the others', async () => {
    // Two fixture command modules that append their name to a shared marker
    // file on import (import side effect = "this module was loaded").
    const marker = join(tmp, 'loaded.txt');
    const mk = (name: string) => {
      const p = join(tmp, `${name}.mjs`);
      writeFileSync(
        p,
        `import { appendFileSync } from 'node:fs';\n` +
          `appendFileSync(${JSON.stringify(marker)}, '${name}\\n');\n` +
          `export default { name: '${name}', describe: '${name} cmd', register(program) { program.command('${name}').action(() => {}); } };\n`,
      );
      return p;
    };
    const aPath = mk('alpha');
    const bPath = mk('beta');
    process.env.BB_COMMANDS = JSON.stringify([
      { name: 'alpha', plugin: aPath },
      { name: 'beta', plugin: bPath },
    ]);
    // Build the program targeting `alpha` — only alpha.mjs must be imported.
    await buildHostProgram(['alpha']);
    const { readFileSync, existsSync } = await import('node:fs');
    const loaded = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
    expect(loaded).toContain('alpha');
    expect(loaded).not.toContain('beta');
  });
});

describe('runHost — unknown command surfaces an error (AC-2)', () => {
  const savedCode = process.exitCode;
  const saved = process.env.BB_COMMANDS;
  afterEach(() => {
    process.exitCode = savedCode;
    if (saved === undefined) delete process.env.BB_COMMANDS;
    else process.env.BB_COMMANDS = saved;
  });
  it('sets a non-zero exit code for an unknown command', async () => {
    delete process.env.BB_COMMANDS;
    process.exitCode = 0;
    await runHost(['definitely-not-a-command']);
    expect(process.exitCode).not.toBe(0);
  });
});

// A `file://` fixture proves resolveModuleEslintStyle accepts URL bases (pnpm).
it('DEFAULT_COMMANDS names the split command packages', () => {
  expect(DEFAULT_COMMANDS.map((c) => c.plugin)).toEqual([
    '@bakers-build/conductor/commands/conductor',
    '@bakers-build/ui',
    '@bakers-build/addon-dropsh',
    '@bakers-build/addon-deployment',
    '@bakers-build/addon-agents',
    '@bakers-build/addon-info',
    '@bakers-build/addon-ports',
    '@bakers-build/addon-track',
  ]);
  // sanity: a file URL is a valid base
  expect(pathToFileURL(join(process.cwd(), 'x')).href).toMatch(/^file:/);
});
