import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planConfig } from '../../src/cli/config-plan.js';
import { loadConductorConfig } from '../../src/config.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function project(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'bakers-check-'));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(join(home, '.bakers'), { recursive: true });
  mkdirSync(join(cwd, '.bakers'), { recursive: true });
  const path = join(cwd, '.bakers/project.config.js');
  writeFileSync(path, source);
  // A project check also checks the machine and connection it depends on.
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    "// @bakers-schema-version 1\nexport default { schema_version: 1, machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'operator' };\n",
  );
  mkdirSync(join(home, '.bakers/connections'));
  writeFileSync(
    join(home, '.bakers/connections/default.js'),
    "// @bakers-schema-version 1\nexport default { schema_version: 1, site: { base_url: 'https://example.test' }, plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { id: 'bakers', default: true, scope: 'bb:session', client_id: 'client', client_secret: 'secret' } }] };\n",
  );
  const check = () =>
    planConfig({ operation: 'check', scope: 'project', home, cwd, path: cwd })
      .report;
  return { path, check };
}

// The committed config the ticket found passing, in today's names.
const SAMPLE = `// @bakers-schema-version 1
export default {
  schema_version: 1,
  project: { name: 'demo', workspace: 'Engineering' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
  poll_intervall_ms: 'fast',
  lease_seconds: -5,
  staets: ['working'],
  hooks: { after_craete: 'true' },
  permissions: { mode: 'sandbx' },
};
`;

describe('bakers config check --scope project, offline', () => {
  it('reports every wrong field of the sample with file and key', () => {
    const t = project(SAMPLE);
    const report = t.check();
    const errors = report.findings.filter((f) => f.severity === 'error');
    expect(errors.map((f) => `${f.code} ${f.key}`).sort()).toEqual([
      'invalid_value lease_seconds',
      'invalid_value permissions.mode',
      'unknown_key hooks.after_craete',
      'unknown_key poll_intervall_ms',
      'unknown_key staets',
    ]);
    for (const finding of errors) expect(finding.path).toBe(t.path);
    expect(report.result).toBe('blocked');
  });

  it('reports a computed value as not checked and still passes', () => {
    const t = project(`export default {
  project: { name: 'demo' },
  prompt: \`Work {identifier} \${process.env.EXTRA ?? ''}\`,
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
  lease_seconds: Number(process.env.LEASE ?? 300),
};
`);
    const report = t.check();
    expect(
      report.findings
        .filter((f) => f.code === 'not_checked')
        .map((f) => f.key)
        .sort(),
    ).toEqual(['lease_seconds', 'prompt']);
    expect(report.result).toBe('ok');
  });

  it('refuses a computed project identity, which the loader cannot read', () => {
    const t = project(`export default {
  project: { name: process.env.NAME ?? 'demo' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
`);
    const report = t.check();
    expect(
      report.findings
        .filter((f) => f.severity === 'error')
        .map((f) => `${f.code} ${f.key}`),
    ).toEqual(['invalid_value project.name']);
  });

  it('the loader rejects exactly the keys the check reports', async () => {
    const t = project(SAMPLE.replace('// @bakers-schema-version 1\n', ''));
    const error = await loadConductorConfig(t.path).then(
      () => undefined,
      (e: Error) => e.message,
    );
    for (const key of [
      'lease_seconds',
      'permissions.mode',
      'hooks.after_craete',
      'poll_intervall_ms',
      'staets',
    ])
      expect(error).toContain(key);
  });
});
