import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticConfig } from '@bakers-build/core';
import { afterEach, describe, expect, it } from 'vitest';
import { applyConfigPlan, planConfig } from '../../src/cli/config-plan.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A complete tree at schema version 1, with old file names and old keys. */
function oldTree() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-upgrade-'));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(join(home, '.bakers'), { recursive: true });
  mkdirSync(join(cwd, '.bakers'), { recursive: true });
  const files = {
    machine: join(home, '.bakers/machine.config.js'),
    oldConnection: join(home, '.bakers/bakers.config.js'),
    connection: join(home, '.bakers/connections/default.js'),
    oldProject: join(cwd, '.bakers/conductor.config.js'),
    project: join(cwd, '.bakers/project.config.js'),
    oldVariant: join(cwd, '.bakers/review.conductor.config.js'),
    variant: join(cwd, '.bakers/project.review.config.js'),
    local: join(cwd, '.bakers/conductor.config.local.js'),
  };
  writeFileSync(
    files.machine,
    `// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'operator',
  addons: [{ name: '@bakers-build/addon-claude', alias: 'opus', options: { model: 'opus' } }],
  agents: { default_agent: 'opus' },
};
`,
  );
  writeFileSync(
    files.oldConnection,
    `// @bakers-schema-version 1
export default { schema_version: 1, site: { base_url: 'https://example.test' }, plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { id: 'bakers', default: true, scope: 'bb:session', client_id: 'client', client_secret: 'secret' } }] };
`,
  );
  const project = (extra: string) => `// @bakers-schema-version 1
const flag = process.env.FLAG;
export default {
  bakers: { project: 'demo', workspace: 'Engineering' },
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
  selectAgent: (candidates) => candidates[0],${extra}
};
`;
  writeFileSync(
    files.oldProject,
    project(`
  addons: [...(flag ? [{ name: '@bakers-build/addon-ports', options: {} }] : [])],`),
  );
  writeFileSync(files.oldVariant, project("\n  states: ['review'],"));
  writeFileSync(files.local, "export default { project: 'mine' };\n");
  return { home, cwd, files };
}

describe('bakers config upgrade: version 1 → 2', () => {
  it('a dry run lists every move and edit and writes nothing', () => {
    const t = oldTree();
    const before = readFileSync(t.files.oldProject, 'utf8');
    const plan = planConfig({
      operation: 'upgrade',
      scope: 'all',
      home: t.home,
      cwd: t.cwd,
      path: t.cwd,
    });
    const paths = plan.writes.map((w) => w.path).sort();
    expect(paths).toEqual(
      [
        t.files.machine,
        t.files.oldConnection,
        t.files.connection,
        t.files.oldProject,
        t.files.project,
        t.files.oldVariant,
        t.files.variant,
      ].sort(),
    );
    expect(plan.writes.find((w) => w.path === t.files.oldProject)?.after).toBe(
      null,
    );
    const project = plan.writes.find((w) => w.path === t.files.project);
    expect(project?.before).toBe(null);
    expect(project?.after).toContain(
      "project: { name: 'demo', workspace: 'Engineering' }",
    );
    for (const text of [
      "server: { use: '@bakers-build/addon-remote-drupal' }",
      "worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }",
      'select_agent:',
      '// @bakers-schema-version 2',
    ])
      expect(project?.after).toContain(text);
    const machine = plan.writes.find((w) => w.path === t.files.machine)?.after;
    expect(machine).toContain(
      "{ use: '@bakers-build/addon-claude', alias: 'opus', with: { model: 'opus' } }",
    );
    expect(staticConfig(machine as string)?.value.agents).toEqual({
      routes: { default: { '*': 'opus' } },
    });
    expect(machine).not.toContain('default_agent');
    // The computed addons value cannot be rewritten: it is named for hand editing.
    const manual = plan.report.findings.filter(
      (f) =>
        f.path === t.files.project &&
        f.key === 'addons' &&
        f.code === 'renamed_key',
    );
    expect(manual.map((f) => f.severity)).toEqual(['warning']);
    expect(manual[0]?.remediation).toMatch(/by hand/);
    // The retired local file stays; its literal project becomes a BAKERS_PROJECT hint.
    const local = plan.report.findings.find((f) => f.path === t.files.local);
    expect(local?.severity).toBe('warning');
    expect(local?.remediation).toContain("BAKERS_PROJECT='mine'");
    expect(readFileSync(t.files.oldProject, 'utf8')).toBe(before);
    expect(existsSync(t.files.project)).toBe(false);
  });

  it('applying leaves a tree that checks clean except the named hand edits', () => {
    const t = oldTree();
    const plan = planConfig({
      operation: 'upgrade',
      scope: 'all',
      home: t.home,
      cwd: t.cwd,
      path: t.cwd,
    });
    const applied = applyConfigPlan(plan);
    expect(applied.findings.filter((f) => f.severity === 'error')).toEqual([]);
    for (const gone of [
      t.files.oldConnection,
      t.files.oldProject,
      t.files.oldVariant,
    ])
      expect(existsSync(gone)).toBe(false);
    expect(existsSync(t.files.local)).toBe(true);
    rmSync(t.files.local);
    const check = planConfig({
      operation: 'check',
      scope: 'all',
      home: t.home,
      cwd: t.cwd,
      path: t.cwd,
    }).report;
    expect(
      check.findings
        .filter((f) => f.severity === 'error')
        .map((f) => `${f.code} ${f.key}`),
    ).toEqual([]);
    expect(
      check.findings.some(
        (f) => f.code === 'not_checked' && f.key === 'addons',
      ),
    ).toBe(true);
  });
});
