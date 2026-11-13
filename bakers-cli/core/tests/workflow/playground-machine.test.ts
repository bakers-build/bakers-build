import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('removes sandbox settings only in the playground machine configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'playground-machine-'));
  try {
    const scripts = join(root, '.bakers/scripts');
    const sourceHome = join(root, 'real-machine');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(sourceHome);
    const script = join(scripts, 'conductor-e2e.sh');
    writeFileSync(
      script,
      readFileSync(
        new URL(
          '../../../../.bakers/scripts/conductor-e2e.sh',
          import.meta.url,
        ),
      ),
    );
    const machine = {
      machine_id: 'fixture-machine',
      permissions: { mode: 'system' },
      addons: [
        { use: 'claude', with: { model: 'opus', sandbox: { network: false } } },
      ],
      agents: {
        catalog: [{ alias: 'worker', with: { sandbox: {}, model: 'other' } }],
      },
    };
    const original = `export default ${JSON.stringify(machine)};`;
    const source = join(sourceHome, 'machine.config.js');
    writeFileSync(source, original);
    execFileSync('bash', [script, 'teardown'], {
      env: { ...process.env, BAKERS_HOME: sourceHome },
    });
    const testHome = join(root, 'workspaces/.bakers-playground-home');
    // A child conductor inherits this home; it must not replace it with a self-import.
    execFileSync('bash', [script, 'teardown'], {
      env: { ...process.env, BAKERS_HOME: testHome },
    });
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'const {default: m} = await import(process.argv[1]); console.log(JSON.stringify(m));',
          join(testHome, 'machine.config.js'),
        ],
        { encoding: 'utf8' },
      ),
    );
    expect(result).toEqual({
      machine_id: 'fixture-machine',
      permissions: { mode: 'system' },
      addons: [{ use: 'claude', with: { model: 'opus' } }],
      agents: { catalog: [{ alias: 'worker', with: { model: 'other' } }] },
    });
    expect(readFileSync(source, 'utf8')).toBe(original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
