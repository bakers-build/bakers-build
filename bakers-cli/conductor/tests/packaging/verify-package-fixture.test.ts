import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { applyConfigPlan, planConfig } from '../../src/cli/config-plan.js';

// A generator that emits disagreeing markers or still imports machine credentials
// breaks the same public planner/template path used by verify-package.mjs.
it('generates a current connection with credentials and workspace independent of machine context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bakers-package-template-'));
  try {
    const connectionPath = join(root, 'connection.config.js');
    const plan = planConfig({
      scope: 'connection',
      home: root,
      cwd: root,
      connectionPath,
      inputs: {
        baseUrl: 'https://package.test',
        clientId: 'package-client',
        secret: 'package-secret',
        workspaceId: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(applyConfigPlan(plan).result).toBe('ok');
    const config = (await import(pathToFileURL(connectionPath).href)).default;
    expect(config).toMatchObject({
      schema_version: 2,
      site: { base_url: 'https://package.test' },
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(config.plugins[1].with).toMatchObject({
      client_id: 'package-client',
      client_secret: 'package-secret',
      scope: 'bb:session',
    });
    const checked = planConfig({
      scope: 'connection',
      operation: 'check',
      home: root,
      cwd: root,
      connectionPath,
    });
    expect(checked.report.result).toBe('ok');
    expect(readFileSync(connectionPath, 'utf8')).not.toContain(
      'machine.config.js',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
