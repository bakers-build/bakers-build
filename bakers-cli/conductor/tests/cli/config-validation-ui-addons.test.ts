import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as configService from '../../src/cli/config-plan.js';
import { capabilities } from './preset-capabilities.js';

const service = {
  ...configService,
  planConfig: (options: Parameters<typeof configService.planConfig>[0] = {}) =>
    configService.planConfig({ capabilities, ...options }),
};

const roots: string[] = [];
const workspace = '11111111-1111-4111-8111-111111111111';

function connectionText() {
  return `// @bakers-schema-version 1\nexport default { schema_version: 1, site: { base_url: 'https://example.test' }, workspace_id: '${workspace}', plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { id: 'bakers', default: true, scope: 'bb:session', client_id: 'client', client_secret: 'private-value' } }] };\n`;
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-plan-ui-addons-'));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(join(home, '.bakers/connections'), { recursive: true });
  mkdirSync(join(cwd, '.bakers'), { recursive: true });
  const machine = join(home, '.bakers/machine.config.js');
  const connection = join(home, '.bakers/connections/default.js');
  const engine = join(cwd, '.bakers/project.config.js');
  writeFileSync(
    machine,
    "export default { machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'operator' };\n",
  );
  writeFileSync(connection, connectionText());
  return { home, cwd, machine, connection, engine, scope: 'all' as const };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it('a UI-only addon does not make a conductor config opaque', () => {
  // A project config that names a UI addon and NO worktree must still report
  // the missing worktree as missing_required_key, not downgrade it to
  // unknown_value — the whitelist is what keeps that diagnosis sharp.
  const w = world();
  writeFileSync(
    w.engine,
    `export default {
  project: { name: 'demo' },
  executor: { use: '@bakers-build/addon-herdr' },
  addons: ['@bakers-build/addon-bakers-ui-artifacts'],
};\n`,
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  const worktree = plan.report.findings.find((f) => f.key === 'worktree');
  expect(worktree?.code).toBe('missing_required_key');
});

it('one Orca addon entry fills both the executor and the workspace slot', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default {
  project: { name: 'demo' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-orca'],
};\n`,
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  const slots = plan.report.findings.filter((f) =>
    ['server', 'executor', 'worktree'].includes(f.key ?? ''),
  );
  expect(slots).toEqual([]);
});

it('resolves herdr-core and its nested workspace from preset-derived capabilities', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default { project: { name: 'demo' }, server: { use: '@bakers-build/addon-remote-drupal' }, addons: ['@bakers-build/addon-herdr-core'] };`,
  );
  const report = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  }).report;
  expect(
    report.findings.filter((f) =>
      ['executor', 'worktree'].includes(f.key ?? ''),
    ),
  ).toEqual([]);
  expect(report.slot_sources?.worktree).toBe(
    '@bakers-build/addon-workspace-git (via @bakers-build/addon-herdr-core)',
  );
});

it('keeps an unresolvable addon opaque when checking missing slots', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default { project: { name: 'demo' }, addons: ['@nope/missing'] };`,
  );
  const report = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  }).report;
  expect(
    report.findings
      .filter((f) => ['server', 'executor', 'worktree'].includes(f.key ?? ''))
      .map((f) => f.code),
  ).toEqual(['unknown_value', 'unknown_value']);
});
