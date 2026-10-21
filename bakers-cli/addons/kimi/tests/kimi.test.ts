import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { describe, expect, it } from 'vitest';

const pluginRoot = new URL('..', import.meta.url);

async function loadKimiModule() {
  return import('../src/index.js');
}

describe('workspace package structure', () => {
  it('mirrors the expected agent plugin package layout', () => {
    const rootPath = pluginRoot.pathname;
    const pkg = JSON.parse(
      readFileSync(join(rootPath, 'package.json'), 'utf8'),
    ) as {
      name: string;
      exports: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    const tsconfig = JSON.parse(
      readFileSync(join(rootPath, 'tsconfig.json'), 'utf8'),
    ) as {
      extends: string;
    };

    expect(pkg.name).toBe('@bakers-build/addon-kimi');
    // BB-215: every addon now also ships the conventional ./preset subpath.
    expect(pkg.exports).toEqual({
      '.': './dist/src/index.js',
      './preset': './dist/src/preset.js',
    });
    // BB-224 (Finding 6, decision 12): a conductor-surface addon peer-depends
    // on BOTH the kernel and the surface-contract package that owns the agent
    // interfaces (`@bakers-build/conductor`) — the new layered-DAG ratchet.
    expect(pkg.peerDependencies).toEqual({
      '@bakers-build/conductor': 'workspace:^',
      '@bakers-build/core': 'workspace:^',
    });
    expect(tsconfig.extends).toBe('../../tsconfig.base.json');
    expect(existsSync(join(rootPath, 'src/index.ts'))).toBe(true);
    expect(existsSync(join(rootPath, 'tests/kimi.test.ts'))).toBe(true);
  });
});

describe('default export', () => {
  it('is the same factory reference as the named `kimiAgent` export', async () => {
    const mod = await loadKimiModule();
    expect(mod.default).toBe(mod.kimiAgent);
  });

  it('builds a kimi agent plugin descriptor', async () => {
    const { default: kimiAgent } = await loadKimiModule();
    expect(kimiAgent().kind).toBe('agent');
    expect(kimiAgent().id).toBe('kimi');
  });
});

describe('KimiAgent.launchCommand', () => {
  it('uses headless prompt mode with text output', async () => {
    const { KimiAgent } = await loadKimiModule();
    const command = new KimiAgent({}).launchCommand('do the thing');

    expect(command).toBe("kimi -p 'do the thing' --output-format text");
    expect(command).not.toContain('--auto');
    expect(command).not.toContain('-y');
  });

  it('includes the optional model before output format', async () => {
    const { KimiAgent } = await loadKimiModule();
    expect(new KimiAgent({ model: 'moonshot-v1' }).launchCommand('do it')).toBe(
      "kimi -p 'do it' --model 'moonshot-v1' --output-format text",
    );
  });

  it('returns bare kimi for an empty prompt', async () => {
    const { KimiAgent } = await loadKimiModule();
    expect(new KimiAgent({}).launchCommand('')).toBe('kimi');
  });

  it('POSIX-quotes a multi-line prompt for the sh-evaluated launch file', async () => {
    const { KimiAgent } = await loadKimiModule();
    const prompt = 'para one\n\npara two';
    const command = new KimiAgent({}).launchCommand(prompt);

    expect(command).toBe("kimi -p 'para one\n\npara two' --output-format text");
  });
});

function captureArgv(binary: string, command: string): string[] {
  const output = execFileSync(
    'bash',
    ['-c', `${binary}() { printf '%s\\0' "${binary}" "$@"; }; ${command}`],
    { encoding: 'utf8' },
  );
  return output.split('\0').slice(0, -1);
}

describe('KimiAgent args and unsupported effort', () => {
  it('appends args and quotes model without generating an effort flag', async () => {
    const { KimiAgent } = await loadKimiModule();
    const agent = new KimiAgent({
      model: 'moonshot-v1',
      effort: 'high',
      args: ['--foo', 'bar baz'],
    });
    expect(agent.launchWarnings).toEqual(['effort is unsupported and ignored']);
    expect(captureArgv('kimi', agent.launchCommand('task'))).toEqual([
      'kimi',
      '-p',
      'task',
      '--model',
      'moonshot-v1',
      '--output-format',
      'text',
      '--foo',
      'bar baz',
    ]);
  });

  it('adds no launchWarnings when effort is omitted', async () => {
    const { KimiAgent } = await loadKimiModule();
    expect(new KimiAgent({}).launchWarnings).toBeUndefined();
  });

  it('rejects reserved prompt and output-format flags including attached -p', async () => {
    const { KimiAgent } = await loadKimiModule();
    for (const flag of ['-p', '-pfoo', '--prompt', '--output-format']) {
      expect(() => new KimiAgent({ args: [flag] })).toThrow(/reserved flag/);
    }
  });
});

describe('KimiAgent run log and footprint', () => {
  it('returns an empty run log and empty footprint', async () => {
    const { KimiAgent } = await loadKimiModule();
    const agent = new KimiAgent({});

    await expect(agent.getRunLog('/tmp/worktree')).resolves.toBe('');
    expect(agent.parseFootprint('')).toEqual(emptyAgentFootprint());
  });
});
