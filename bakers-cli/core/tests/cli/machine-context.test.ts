import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  machineContextPath,
  readMachineContext,
  resolveMachineContextPath,
} from '../../src/cli/machine-context.js';

const UUID = '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30';

const fakeHome = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (load) => ({
  ...(await load<typeof import('node:os')>()),
  homedir: () => fakeHome.value,
}));

describe('machine-context (BB-201: ~/.bakers/machine.config.js)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-mc-'));
    fakeHome.value = tmp;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('canonical path is ~/.bakers/machine.config.js', () => {
    expect(
      machineContextPath().endsWith(join('.bakers', 'machine.config.js')),
    ).toBe(true);
  });

  it('resolveMachineContextPath honours an explicit path verbatim', () => {
    expect(resolveMachineContextPath('/x/y.js')).toBe('/x/y.js');
  });

  it('readMachineContext imports a context module default export', async () => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(
      p,
      `export default { machine_id: '0B6F3C1E-9A2D-4E57-8C41-2F7D9E5A1B30', label: 'cw-laptop', max_parallel: 2 };\n`,
    );
    const ctx = await readMachineContext(p);
    expect(ctx.machine_id).toBe('0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30');
    expect(ctx.label).toBe('cw-laptop');
    expect(ctx.max_parallel).toBe(2);
  });

  it('readMachineContext preserves a literal tunnel boolean', async () => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(
      p,
      `export default { machine_id: '${UUID}', label: 'cw-laptop', max_parallel: 2, tunnel: true };\n`,
    );
    const ctx = await readMachineContext(p);
    expect(ctx.tunnel).toBe(true);
  });

  it('readMachineContext preserves an optional nested agent policy', async () => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(
      p,
      `export default {
        machine_id: '${UUID}',
        label: 'cw-laptop',
        agents: {
          catalog: [{ harness: '@bakers-build/addon-pi', alias: 'k3-pi', with: { model: 'kimi-coding/k3' } }],
          enabled: ['opus', 'k3-pi'],
          disabled: ['codex'],
          default_agent: 'opus',
          routes: { default: { '*': 'opus', coding: 'k3-pi' }, fast: { '*': 'opus' } },
        },
      };\n`,
    );

    const ctx = await readMachineContext(p);

    expect(ctx.agents).toEqual({
      catalog: [
        {
          harness: '@bakers-build/addon-pi',
          alias: 'k3-pi',
          with: { model: 'kimi-coding/k3' },
        },
      ],
      enabled: ['opus', 'k3-pi'],
      disabled: ['codex'],
      default_agent: 'opus',
      routes: {
        default: { '*': 'opus', coding: 'k3-pi' },
        fast: { '*': 'opus' },
      },
    });
  });

  it('readMachineContext preserves the BB-676 named-tunnel ports block', async () => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(
      p,
      `export default {
        machine_id: '${UUID}',
        label: 'cw-laptop',
        ports: {
          accountId: 'acc-1',
          tunnelId: 'tun-1',
          zoneId: 'zone-1',
          zone: 'preview.example',
          apiToken: 'secret-xyz',
        },
      };\n`,
    );
    const ctx = await readMachineContext(p);
    expect(ctx.ports).toEqual({
      accountId: 'acc-1',
      tunnelId: 'tun-1',
      zoneId: 'zone-1',
      zone: 'preview.example',
      apiToken: 'secret-xyz',
    });
  });

  it.each([
    ['a non-UUID machine_id', `machine_id: 'cw-laptop'`],
    ['a user_id key', `machine_id: '${UUID}', user_id: 'cw'`],
    ['schema_version 3', `schema_version: 3, machine_id: '${UUID}'`],
  ])('readMachineContext rejects %s naming bakers init', async (_, body) => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(p, `export default { ${body} };\n`);
    await expect(readMachineContext(p)).rejects.toThrow(/bakers init/);
  });

  it('readMachineContext rejects a schema header other than 1', async () => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(
      p,
      `// @bakers-schema-version 3\nexport default { machine_id: '${UUID}' };\n`,
    );
    await expect(readMachineContext(p)).rejects.toThrow(/bakers init/);
  });

  it('readMachineContext accepts schema version 1', async () => {
    const p = join(tmp, 'machine.config.js');
    writeFileSync(
      p,
      `// @bakers-schema-version 1\nexport default { schema_version: 1, machine_id: '${UUID}', label: 'l' };\n`,
    );
    expect((await readMachineContext(p)).label).toBe('l');
  });

  it('readMachineContext returns {} for an absent path', async () => {
    expect(await readMachineContext(join(tmp, 'nope.js'))).toEqual({});
  });
  it('never reads a historical credential file when the canonical machine is absent', async () => {
    const legacy = join(tmp, '.config/conductor/conductor.config.machine.js');
    mkdirSync(join(tmp, '.config/conductor'), { recursive: true });
    writeFileSync(
      legacy,
      "export default {machine_id:'historical',base_url:'https://old.test'};",
    );
    expect(resolveMachineContextPath()).toBe(
      join(tmp, '.bakers/machine.config.js'),
    );
    expect(await readMachineContext()).toEqual({});
  });
});
