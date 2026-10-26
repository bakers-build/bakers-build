import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as service from '../../src/cli/config-plan.js';

const roots: string[] = [];
const workspace = '11111111-1111-4111-8111-111111111111';

function connectionText() {
  return `// @bakers-schema-version 3\nexport default { schema_version: 3, site: { base_url: 'https://example.test' }, workspace_id: '${workspace}', plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { id: 'bakers', default: true, scope: 'bb:session', client_id: 'client', client_secret: 'private-value' } }] };\n`;
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-plan-ui-addons-'));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(join(home, '.bakers'), { recursive: true });
  mkdirSync(join(cwd, '.bakers'), { recursive: true });
  const machine = join(home, '.bakers/machine.config.js');
  const connection = join(home, '.bakers/bakers.config.js');
  const engine = join(cwd, '.bakers/conductor.config.js');
  writeFileSync(
    machine,
    "export default { machine_id: 'host', user_id: 'operator', max_parallel: 2 };\n",
  );
  writeFileSync(connection, connectionText());
  return { home, cwd, machine, connection, engine, scope: 'all' as const };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it('a UI-only addon does not make a conductor config opaque', () => {
  // A conductor config that names a UI addon and NO remote must still report
  // the missing remote as missing_required_key, not downgrade it to
  // unknown_value — the whitelist is what keeps that diagnosis sharp.
  const w = world();
  writeFileSync(
    w.engine,
    `export default {
  bakers: { project: 'demo' },
  conductor_id: 'my-worker',
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
  addons: ['@bakers-build/addon-bakers-ui-artifacts', '@bakers-build/addon-herdr'],
};\n`,
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  const remote = plan.report.findings.find((f) => f.key === 'remote');
  expect(remote?.code).toBe('missing_required_key');
});

it('one Orca addon entry fills both the executor and the workspace slot', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default {
  bakers: { project: 'demo' },
  conductor_id: 'my-worker',
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-orca'],
};\n`,
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  const slots = plan.report.findings.filter((f) =>
    ['remote', 'executor', 'workspace'].includes(f.key ?? ''),
  );
  expect(slots).toEqual([]);
});
