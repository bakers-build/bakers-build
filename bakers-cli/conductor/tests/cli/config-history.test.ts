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
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applyConfigPlan, planConfig } from '../../src/cli/config-plan.js';
import manifest from './fixtures/bb-448/manifest.json';

const workspace = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];
const fixture = (name: string, home: string) =>
  readFileSync(
    new URL(`./fixtures/bb-448/${name}`, import.meta.url),
    'utf8',
  ).replaceAll('process.env.HOME', JSON.stringify(home));
function world() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-history-'));
  roots.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(join(home, '.bakers'), { recursive: true });
  mkdirSync(join(cwd, '.bakers'), { recursive: true });
  const machine = join(home, '.bakers/machine.config.js');
  const connection = join(home, '.bakers/bakers.config.js');
  const local = join(home, '.bakers/conductor.config.local.js');
  writeFileSync(
    join(cwd, '.bakers/conductor.config.js'),
    "export default {project:'history',conductor_id:'worker',remote:{plugin:'@bakers-build/addon-remote-drupal'},executor:{plugin:'@bakers-build/addon-herdr'},agent:{plugin:'@bakers-build/addon-claude'},workspace:{plugin:'@bakers-build/addon-herdr',export:'herdrWorkspace'}};",
  );
  return {
    home,
    cwd,
    machine,
    connection,
    local,
    scope: 'all' as const,
    inputs: { workspaceId: workspace },
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('shipped configuration histories', () => {
  // Losing a shipped schema step, a credential, or an explicit missing-workspace
  // repair breaks these observable migration/second-run contracts.
  it.each(
    manifest.filter((row) => row.files.connection),
  )('$family reaches current with the historically absent workspace supplied', async (row) => {
    const w = world();
    writeFileSync(w.machine, fixture(row.files.machine, w.home));
    writeFileSync(w.connection, fixture(row.files.connection ?? '', w.home));
    const plan = planConfig(w);
    expect(plan.report.findings.filter((f) => f.severity === 'error')).toEqual(
      [],
    );
    expect(applyConfigPlan(plan).result).toBe('ok');
    const config = (await import(pathToFileURL(w.connection).href)).default;
    expect(config.schema_version).toBe(4);
    expect(config.site.base_url).toBe('https://historical.test');
    expect(config.workspace_id).toBe(workspace);
    expect(
      config.plugins.find(
        (p: { plugin: string }) => p.plugin === '@dropsh/plugin-oauth2',
      ).with,
    ).toMatchObject({
      id: 'bakers',
      scope: 'bb:session',
      client_id: 'historical-client',
      client_secret: 'historical-secret',
    });
    expect(planConfig(w).writes).toEqual([]);
  });
  it.each(
    manifest.filter((row) => row.family !== 'current'),
  )('$family refuses computed policy and leaves project credentials untouched', (row) => {
    const w = world();
    writeFileSync(w.machine, fixture(row.files.machine, w.home));
    writeFileSync(
      join(w.cwd, '.bakers/conductor.config.js'),
      fixture(row.files.engine, w.home).replaceAll(
        'process.env.HOME',
        JSON.stringify(w.home),
      ),
    );
    const projectConnection = join(w.cwd, '.bakers/bakers.config.js');
    if (row.files.connection)
      writeFileSync(projectConnection, fixture(row.files.connection, w.home));
    const projectConnectionBefore = row.files.connection
      ? readFileSync(projectConnection, 'utf8')
      : null;
    const enginePath = join(w.cwd, '.bakers/conductor.config.js');
    const machineBefore = readFileSync(w.machine, 'utf8');
    const engineBefore = readFileSync(enginePath, 'utf8');
    const plan = planConfig(w);
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'unknown_value',
        key: 'agent.with.model',
      }),
    );
    expect(applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.machine, 'utf8')).toBe(machineBefore);
    expect(readFileSync(enginePath, 'utf8')).toBe(engineBefore);
    expect(existsSync(projectConnection)).toBe(
      projectConnectionBefore !== null,
    );
    if (projectConnectionBefore !== null)
      expect(readFileSync(projectConnection, 'utf8')).toBe(
        projectConnectionBefore,
      );
  });
  it.each([
    'machine',
    'connection',
    'project',
  ] as const)('repairs an independently partial %s layer from explicit inputs', async (layer) => {
    const w = world();
    const inputs = {
      machineId: 'historical-host',
      userId: 'historical-user',
      baseUrl: 'https://historical.test',
      clientId: 'historical-client',
      secret: 'historical-secret',
      workspaceId: workspace,
    };
    const setup = planConfig({ ...w, inputs, project: 'history' });
    expect(applyConfigPlan(setup).result).toBe('ok');
    const selected =
      layer === 'machine'
        ? w.machine
        : layer === 'connection'
          ? w.connection
          : join(w.cwd, '.bakers/conductor.config.js');
    writeFileSync(selected, 'export default {};');
    const repaired = planConfig({ ...w, inputs, project: 'history' });
    expect(applyConfigPlan(repaired).result).toBe('ok');
    // The regenerated project layer imports machine.config.js through
    // process.env.BB_HOME at evaluation time (it carries no baked-in path),
    // so the fixture home must be in force for this import to see it.
    const originalBbHome = process.env.BB_HOME;
    process.env.BB_HOME = join(w.home, '.bakers');
    let config: unknown;
    try {
      config = (await import(pathToFileURL(selected).href)).default;
    } finally {
      if (originalBbHome === undefined) delete process.env.BB_HOME;
      else process.env.BB_HOME = originalBbHome;
    }
    expect(config).toMatchObject(
      layer === 'machine'
        ? { machine_id: 'historical-host' }
        : layer === 'connection'
          ? { workspace_id: workspace }
          : {
              bakers: { project: 'history' },
              conductor_id: 'historical-user-historical-host-history',
              remote: { plugin: '@bakers-build/addon-remote-drupal' },
            },
    );
    expect(planConfig({ ...w, inputs, project: 'history' }).writes).toEqual([]);
  });
  // The historical connection imports this retired sibling; migrating past it
  // unseen would silently switch server or account.
  it('refuses migration while a retired home-local override exists', () => {
    const w = world();
    writeFileSync(w.machine, fixture('connection-v3-machine.js.txt', w.home));
    writeFileSync(
      w.connection,
      fixture('connection-v3-connection.js.txt', w.home),
    );
    const before = readFileSync(w.connection, 'utf8');
    writeFileSync(
      w.local,
      `export default {base_url:'https://override.test',oauth:{client_id:'override-client',client_secret:'override-secret'}};`,
    );
    const plan = planConfig(w);
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'superseded_file',
        severity: 'error',
        path: w.local,
      }),
    );
    expect(JSON.stringify(plan.report)).not.toContain('override-secret');
    expect(applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.connection, 'utf8')).toBe(before);
    expect(existsSync(`${w.machine}.bakers.bak`)).toBe(false);
  });
  it('preserves an opaque project object while repairing explicitly empty engines', () => {
    const w = world();
    writeFileSync(w.machine, fixture('current-machine.js.txt', w.home));
    writeFileSync(w.connection, fixture('current-connection.js.txt', w.home));
    const engine = join(w.cwd, '.bakers/conductor.config.js');
    const original = 'const custom = loadCustom(); export default {...custom};';
    writeFileSync(engine, original);
    const plan = planConfig({ ...w, project: 'history' });
    applyConfigPlan(plan);
    expect(readFileSync(engine, 'utf8')).toContain('...custom');
  });
});
