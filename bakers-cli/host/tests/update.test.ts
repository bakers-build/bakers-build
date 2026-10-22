import { describe, expect, it } from 'vitest';
import { runUpdate } from '../src/update.js';

describe('runUpdate', () => {
  it('installs @latest without confirmation when standard I/O is non-interactive', async () => {
    const installs: string[][] = [];
    const versions = ['1.0.0', '1.1.0'];
    const output: string[] = [];
    const result = await runUpdate(
      async (_cmd, args) => {
        installs.push(args);
        return 0;
      },
      async () => ({
        code: 0,
        stdout: JSON.stringify({
          dependencies: {
            '@bakers-build/bakers': { version: versions.shift() },
          },
        }),
      }),
      {
        out: (line) => output.push(line),
      },
    );
    expect(installs).toEqual([
      ['install', '-g', '@bakers-build/bakers@latest'],
    ]);
    expect(output).toEqual(['1.0.0 → 1.1.0']);
    expect(result).toEqual({ ok: true, before: '1.0.0', after: '1.1.0' });
  });

  it('does not query after a failed install', async () => {
    let queries = 0;
    const result = await runUpdate(
      async () => 1,
      async () => {
        queries++;
        return { code: 0, stdout: '{"dependencies":{}}' };
      },
      {
        out: () => {},
      },
    );
    expect(queries).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('reports the observed versions only after querying the installed package again', async () => {
    const order: string[] = [];
    const versions = ['1.0.0', '1.1.0'];
    await runUpdate(
      async () => {
        order.push('install');
        return 0;
      },
      async () => ({
        code: 0,
        stdout: JSON.stringify({
          dependencies: {
            '@bakers-build/bakers': { version: versions.shift() },
          },
        }),
      }),
      {
        out: (line) => order.push(`show:${line}`),
      },
    );
    expect(order).toEqual(['install', 'show:1.0.0 → 1.1.0']);
  });

  it('queries npm global state before and after a successful install', async () => {
    const queries: Array<{ cmd: string; args: string[] }> = [];
    const result = await runUpdate(
      async () => 0,
      async (cmd, args) => {
        queries.push({ cmd, args });
        return {
          code: 0,
          stdout: JSON.stringify({
            dependencies: { '@bakers-build/bakers': { version: '1.0.0' } },
          }),
        };
      },
      {
        out: () => {},
      },
    );
    expect(result.ok).toBe(true);
    expect(queries).toEqual([
      {
        cmd: 'npm',
        args: ['ls', '-g', '@bakers-build/bakers', '--json', '--depth', '0'],
      },
      {
        cmd: 'npm',
        args: ['ls', '-g', '@bakers-build/bakers', '--json', '--depth', '0'],
      },
    ]);
  });
});
