import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as configService from '../../src/cli/config-plan.js';
import { capabilities } from './preset-capabilities.js';

const service = {
  ...configService,
  planConfig: (options: Parameters<typeof configService.planConfig>[0] = {}) =>
    configService.planConfig({ capabilities, ...options }),
};

import { ConfigSourceEditor } from '../../src/cli/config-source-edit.js';
import {
  renderCommittedConfig,
  renderHostMachine,
} from '../../src/cli/config-templates.js';
import {
  bakersProjectOwner,
  readBbProjectSelection,
  writeBbWorkspaceSelection,
} from '../../src/cli/project-context.js';
import { loadConductorConfig } from '../../src/config.js';

it('reads the project identity without reading the worktree plugin', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default {
    project: { name: 'demo', workspace: 'Engineering' },
    worktree: { use: '@bakers-build/addon-herdr' }
  };\n`,
  );
  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'Engineering',
  });
});

it('writes only the nested workspace in the selected project variant file', async () => {
  const w = world();
  const variant = join(dirname(w.engine), 'project.night.config.js');
  const original = `export default { project: { name: 'demo', workspace: 'First' }, worktree: { use: '@bakers-build/addon-herdr' } };\n`;
  writeFileSync(w.engine, original);
  writeFileSync(variant, original);
  await writeBbWorkspaceSelection(
    bakersProjectOwner(variant),
    'Second',
    'Retry',
  );
  expect(readBbProjectSelection(variant)).toEqual({
    project: 'demo',
    workspace: 'Second',
  });
  expect(readFileSync(variant, 'utf8')).toContain(
    "worktree: { use: '@bakers-build/addon-herdr' }",
  );
  expect(readFileSync(w.engine, 'utf8')).toBe(original);
});

it.each([
  "export default { project: 'demo' };",
  "export default { bakers: { project: 'demo' } };",
  "export default { project: { name: 'demo', ...extra } };",
  'export default { project: getIdentity() };',
  'export default { project: { name: chosenProject } };',
  "export default { project: { name: '' } };",
])('rejects an uninspectable or legacy project identity: %s', (source) => {
  const w = world();
  writeFileSync(w.engine, source);
  expect(() => readBbProjectSelection(w.engine)).toThrow(
    /set project: \{ name/,
  );
});

it('blocks a conflicting nested and legacy project name before writing', () => {
  const w = world();
  const original = `export default { project: 'old', bakers: { project: 'new' } };\n`;
  writeFileSync(w.engine, original);
  const plan = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'upgrade',
  });
  expect(plan.report.result).toBe('blocked');
  expect(service.applyConfigPlan(plan).result).toBe('blocked');
  expect(readFileSync(w.engine, 'utf8')).toBe(original);
});
it('does not migrate through a spread bakers.build identity', () => {
  const w = world();
  const original = `export default { project: 'demo', bakers: { ...computed } };`;
  writeFileSync(w.engine, original);
  const plan = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'upgrade',
  });
  expect(plan.report.result).toBe('blocked');
  expect(service.applyConfigPlan(plan).result).toBe('blocked');
  expect(readFileSync(w.engine, 'utf8')).toBe(original);
});
it('blocks runtime loading of legacy top-level identity before evaluating source', async () => {
  const w = world();
  const sentinel = join(w.cwd, 'evaluated');
  writeFileSync(
    w.engine,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'yes'); export default { project: 'demo' };`,
  );
  await expect(loadConductorConfig(w.engine)).rejects.toThrow(
    /set project: \{ name/,
  );
  expect(existsSync(sentinel)).toBe(false);
});
it.each([
  {
    source: `export default { project: 'demo' };`,
    finding: {
      key: 'project',
      code: 'invalid_value',
      remediation: expect.stringContaining('must be object'),
    },
  },
  {
    source: `export default { bakers: { project: 'demo' } };`,
    finding: { key: 'bakers', code: 'unknown_key' },
  },
])('config check names project: { name } for a legacy identity: $source', ({
  source,
  finding,
}) => {
  const w = world();
  writeFileSync(w.engine, source);
  const report = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'check',
  }).report;
  expect(report.findings).toContainEqual(expect.objectContaining(finding));
});
it('config check rejects a spread project identity', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default { project: { name: 'demo', ...computed } };`,
  );
  const report = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'check',
  }).report;
  expect(report.result).toBe('blocked');
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      key: 'project',
      code: 'invalid_value',
      severity: 'error',
    }),
  );
});

const roots: string[] = [];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const workspace = '11111111-1111-4111-8111-111111111111';
function engineText() {
  return `export default {
  project: { name: 'demo' },
  server: { use: '@bakers-build/addon-remote-drupal' },
  executor: { use: '@bakers-build/addon-herdr' },
  agent: { plugin: '@bakers-build/addon-claude' },
  worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};\n`;
}
async function importMachine(path: string) {
  return (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)).default;
}
function world() {
  const root = mkdtempSync(join(tmpdir(), 'bakers-plan-'));
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
    "// @bakers-schema-version 1\nexport default { schema_version: 1, machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label: 'operator' };\n",
  );
  writeFileSync(connection, connectionText());
  writeFileSync(engine, engineText());
  return { home, cwd, machine, connection, engine, scope: 'all' as const };
}
function connectionText(secret = 'private-value') {
  return `// @bakers-schema-version 1\nexport default { schema_version: 1, site: { base_url: 'https://example.test' }, workspace_id: '${workspace}', plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { id: 'bakers', default: true, scope: 'bb:session', client_id: 'client', client_secret: '${secret}' } }] };\n`;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe('offline scoped configuration plan and apply', () => {
  it('renders schema-v1 zero-config agent templates', () => {
    const machine = renderHostMachine({
      machineId: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
      label: 'operator',
    });
    const conductor = renderCommittedConfig({
      project: 'demo',
      hooks: {
        after_create: 'make worktree',
        after_done: 'make clean',
      },
    });

    expect(machine).toContain('// @bakers-schema-version 1');
    expect(machine).toContain('schema_version: 1');
    expect(machine).not.toMatch(/^\s*agents:/m);
    // The run budget is a backend setting.
    expect(machine).not.toContain('max_parallel');
    expect(conductor).toContain("addons: ['@bakers-build/addon-herdr']");
    expect(conductor).not.toMatch(/^\s*(?:server|executor|worktree):/m);
    // addon-claude is machine-scoped; a project config may not list it.
    expect(conductor).not.toContain('@bakers-build/addon-claude');
    expect(conductor).not.toMatch(
      /^\s*(?:agent|agents|default_agent|agent_routes):/m,
    );
  });

  it('writes no machine-specific path into the committed project config', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-plan-portable-'));
    roots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(join(home, '.bakers'), { recursive: true });
    mkdirSync(join(project, '.bakers'), { recursive: true });
    const plan = service.planConfig({
      operation: 'init',
      scope: 'project',
      cwd: project,
      home,
      project: 'demo',
    });
    const committed = plan.writes.find((write) =>
      write.path.endsWith(join('.bakers', 'project.config.js')),
    );
    expect(committed?.after).toBeTruthy();
    expect(committed?.after).not.toContain('machine.config.js`');
    expect(committed?.after).not.toContain('file://');
    expect(committed?.after).not.toContain(home);
  });

  it('omits the hooks block when no hook answer was supplied', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-plan-nohooks-'));
    roots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(join(home, '.bakers'), { recursive: true });
    mkdirSync(join(project, '.bakers'), { recursive: true });
    const plan = service.planConfig({
      operation: 'init',
      scope: 'project',
      cwd: project,
      home,
      project: 'demo',
    });
    const committed = plan.writes.find((write) =>
      write.path.endsWith(join('.bakers', 'project.config.js')),
    );
    expect(committed?.after).not.toContain('hooks');
  });

  it("writes exactly the operator's answered hooks, and no others", () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-plan-hooks-'));
    roots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(join(home, '.bakers'), { recursive: true });
    mkdirSync(join(project, '.bakers'), { recursive: true });
    const plan = service.planConfig({
      operation: 'init',
      scope: 'project',
      cwd: project,
      home,
      project: 'demo',
      inputs: { hooks: { after_create: 'make provision' } },
    });
    const committed = plan.writes.find((write) =>
      write.path.endsWith(join('.bakers', 'project.config.js')),
    );
    expect(committed?.after).toContain('after_create: "make provision"');
    expect(committed?.after).not.toContain('after_done');
  });

  it('migrates retired agent policy into the nested machine policy without executing source', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'operator',
  agents: ['opus', 'k3-pi'],
  disabled_agents: ['codex'],
  agent_routes: {
    default: 'cheap',
    cheap: { '*': 'opus', coding: 'k3-pi' },
    fast: { '*': 'opus' },
  },
};\n`,
    );
    writeFileSync(
      w.engine,
      `export default {
  project: { name: 'demo' },
  server: { use: '@bakers-build/addon-remote-drupal' },
  executor: { use: '@bakers-build/addon-herdr' },
  worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
  addons: [
    { use: '@bakers-build/addon-claude' },
    { use: '@bakers-build/addon-pi' },
  ],
  agent: [
    { agent: { plugin: '@bakers-build/addon-claude' }, alias: 'opus' },
    { agent: { plugin: '@bakers-build/addon-pi', with: { model: 'kimi-coding/k3' } }, alias: 'k3-pi' },
  ],
};\n`,
    );

    const plan = service.planConfig(w);
    expect(
      plan.report.findings.filter((finding) => finding.severity === 'error'),
    ).toEqual([]);
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = (
      await import(`${pathToFileURL(w.machine).href}?agents=${Date.now()}`)
    ).default;
    expect(machine.schema_version).toBe(1);
    expect(machine.agents).toEqual({
      catalog: [
        {
          harness: '@bakers-build/addon-claude',
          alias: 'opus',
        },
        {
          harness: '@bakers-build/addon-pi',
          alias: 'k3-pi',
          with: { model: 'kimi-coding/k3' },
        },
      ],
      enabled: ['opus', 'k3-pi'],
      disabled: ['codex'],
      // The default agent lives only in routes.default.
      routes: {
        default: { '*': 'opus', coding: 'k3-pi' },
        cheap: { '*': 'opus', coding: 'k3-pi' },
        fast: { '*': 'opus' },
      },
    });
    const conductor = readFileSync(w.engine, 'utf8');
    expect(conductor).not.toMatch(
      /^\s*(?:agent|agents|default_agent|agent_routes):/m,
    );
    expect(service.planConfig(w).writes).toEqual([]);
  });

  it('refuses conflicting retired and nested agent policies before writing', () => {
    const w = world();
    const machine = readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      "label: 'operator', agents: { enabled: ['opus'] }",
    );
    writeFileSync(w.machine, machine);
    writeFileSync(
      w.engine,
      engineText().replace(
        "agent: { plugin: '@bakers-build/addon-claude' },",
        "agent: { plugin: '@bakers-build/addon-claude' }, agents: ['codex'],",
      ),
    );

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'conflicting_values', key: 'agents' }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.machine, 'utf8')).toBe(machine);
  });

  it('converts a retired state default into the reserved default route and simple fallback', async () => {
    const w = world();
    writeFileSync(
      w.engine,
      engineText().replace(
        "agent: { plugin: '@bakers-build/addon-claude' },",
        "agent: { plugin: '@bakers-build/addon-claude' }, default_agent: { '*': 'opus', coding: 'sonnet' },",
      ),
    );

    const plan = service.planConfig(w);
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = (
      await import(`${pathToFileURL(w.machine).href}?defaults=${Date.now()}`)
    ).default;
    // agents.default_agent is an old name: the default is routes.default only.
    expect(machine.agents).not.toHaveProperty('default_agent');
    expect(machine.agents.routes.default).toEqual({
      '*': 'opus',
      coding: 'sonnet',
    });
    expect(readFileSync(w.engine, 'utf8')).not.toMatch(/^\s*default_agent:/m);
  });

  it('refuses computed retired agent policy before writing', () => {
    const w = world();
    const engine = engineText().replace(
      "agent: { plugin: '@bakers-build/addon-claude' },",
      "agent: { plugin: '@bakers-build/addon-claude' }, agents: loadEnabledAgents(),",
    );
    writeFileSync(w.engine, engine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_value', key: 'agents' }),
    );
    expect(service.applyConfigPlan(plan).result).not.toBe('ok');
    expect(readFileSync(w.engine, 'utf8')).toBe(engine);
  });

  it('refuses computed route members without deleting the retired policy', () => {
    const w = world();
    const machine = readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      "label: 'operator', agent_routes: { fast: { '*': chooseAgent() } }",
    );
    writeFileSync(w.machine, machine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'unknown_value',
        key: 'agent_routes.fast.*',
      }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.machine, 'utf8')).toBe(machine);
  });

  it('refuses a computed retired default-route selector', () => {
    const w = world();
    const machine = readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      "label: 'operator', agent_routes: { default: chooseRoute(), fast: { '*': 'opus' } }",
    );
    writeFileSync(w.machine, machine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'unknown_value',
        key: 'agent_routes.default',
      }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.machine, 'utf8')).toBe(machine);
  });

  it.each([
    ['agents: [resolveAlias()]', 'agents[0]'],
    ['enabled_agents: [resolveAlias()]', 'enabled_agents[0]'],
  ])('refuses a computed retired agent list member in %s', (policy, key) => {
    const w = world();
    const machine = readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      `label: 'operator', ${policy}`,
    );
    writeFileSync(w.machine, machine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_value', key }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.machine, 'utf8')).toBe(machine);
  });

  it('refuses a computed retired state default member', () => {
    const w = world();
    const engine = engineText().replace(
      "agent: { plugin: '@bakers-build/addon-claude' },",
      "agent: { plugin: '@bakers-build/addon-claude' }, default_agent: { '*': resolveAlias() },",
    );
    writeFileSync(w.engine, engine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'unknown_value',
        key: 'default_agent.*',
      }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.engine, 'utf8')).toBe(engine);
  });

  it.each([
    ['agent_routes: buildRoutes()', 'agent_routes'],
    ["agent_routes: 'fast'", 'agent_routes'],
    ['agent_routes: []', 'agent_routes'],
    ['agent_routes: { ...buildRoutes() }', 'agent_routes'],
    [
      "agent_routes: { fast: { '*': 'opus', ...buildStates() } }",
      'agent_routes.fast.*',
    ],
  ])('refuses an unsupported retired route map in %s', (policy, key) => {
    const w = world();
    const machine = readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      `label: 'operator', ${policy}`,
    );
    writeFileSync(w.machine, machine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_value', key }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.machine, 'utf8')).toBe(machine);
  });

  it('refuses computed catalog options instead of guessing their fallback', () => {
    const w = world();
    const engine = engineText().replace(
      "agent: { plugin: '@bakers-build/addon-claude' },",
      "agent: { plugin: '@bakers-build/addon-claude', with: { model: process.env.MODEL ?? 'fallback' } },",
    );
    writeFileSync(w.engine, engine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'unknown_value',
        key: 'agent.with.model',
      }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.engine, 'utf8')).toBe(engine);
  });

  it('refuses legacy candidate metadata that has no lossless machine-catalog destination', () => {
    const w = world();
    const engine = engineText().replace(
      "agent: { plugin: '@bakers-build/addon-claude' },",
      "agent: [{ agent: { plugin: '@bakers-build/addon-claude' }, alias: 'opus', priority: (ticket) => ticket.labels.includes('careful') ? 10 : 0 }],",
    );
    writeFileSync(w.engine, engine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({
        code: 'unknown_value',
        key: 'agent[0].priority',
      }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.engine, 'utf8')).toBe(engine);
  });

  it('preserves an alias-only legacy variant and merges its harness into literal addons', async () => {
    const w = world();
    writeFileSync(
      w.engine,
      `export default {
  project: { name: 'demo' },
  server: { use: '@bakers-build/addon-remote-drupal' },
  executor: { use: '@bakers-build/addon-herdr' },
  worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
  agent: { plugin: '@bakers-build/addon-claude', alias: 'writer' },
};\n`,
    );

    const plan = service.planConfig(w);
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = (
      await import(`${pathToFileURL(w.machine).href}?alias=${Date.now()}`)
    ).default;
    expect(machine.agents.catalog).toEqual([
      { harness: '@bakers-build/addon-claude', alias: 'writer' },
    ]);
    const conductor = readFileSync(w.engine, 'utf8');
    expect(conductor).toContain("'@bakers-build/addon-remote-drupal'");
    expect(conductor).toContain("'@bakers-build/addon-herdr'");
    expect(conductor).not.toMatch(/^\s*agent:/m);
  });

  it('refuses to merge a legacy agent harness into a spread addons array', () => {
    const w = world();
    const engine = engineText()
      .replace(
        "agent: { plugin: '@bakers-build/addon-claude' },",
        "agent: { plugin: '@bakers-build/addon-claude', with: { model: 'opus' } },",
      )
      .replace(
        "project: { name: 'demo' },",
        "project: { name: 'demo' }, addons: [...local.addons],",
      );
    writeFileSync(w.engine, engine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_value', key: 'addons' }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.engine, 'utf8')).toBe(engine);
  });
  it.each([
    'machine',
  ])('blocks mixed ownership movement in %s scope before any write', (scope) => {
    const w = world();
    const before = readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      "label: 'operator', client_secret: 'private-value'",
    );
    writeFileSync(w.machine, before);
    const plan = service.planConfig({ ...w, scope });
    expect(
      plan.report.findings.some(
        (f) => f.code === 'out_of_scope_write_required',
      ),
    ).toBe(true);
    service.applyConfigPlan(plan);
    expect(readFileSync(w.machine, 'utf8')).toBe(before);
    expect(readdirSync(dirname(w.machine))).toHaveLength(2);
  });
  it('reports both conflicting origins without exposing a credential', () => {
    const w = world();
    writeFileSync(
      w.machine,
      readFileSync(w.machine, 'utf8').replace(
        "label: 'operator'",
        "label: 'operator', client_secret: 'other-private'",
      ),
    );
    const plan = service.planConfig(w);
    expect(
      plan.report.findings.find((f) => f.code === 'conflicting_values')?.related
        .length,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(plan.report)).not.toContain('other-private');
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readdirSync(dirname(w.machine))).toHaveLength(2);
  });
  it.each([
    {
      name: 'duplicate credential properties',
      source: connectionText().replace(
        "client_secret: 'private-value'",
        "client_secret: 'SYNTHETIC_EARLY_SECRET', client_secret: 'SYNTHETIC_FINAL_SECRET'",
      ),
    },
    {
      name: 'duplicate credential parent objects',
      source: connectionText()
        .replace(
          "with: { id: 'bakers'",
          "with: { client_secret: 'SYNTHETIC_EARLY_SECRET' }, with: { id: 'bakers'",
        )
        .replace(
          "client_secret: 'private-value'",
          "client_secret: 'SYNTHETIC_FINAL_SECRET'",
        ),
    },
  ])('redacts every secret span from previews with $name', ({ source }) => {
    const w = world();
    writeFileSync(w.connection, source);

    const plan = service.planConfig(w);

    expect(plan.report.changes).not.toEqual([]);
    expect(JSON.stringify(plan.report)).not.toContain('SYNTHETIC_EARLY_SECRET');
    expect(JSON.stringify(plan.report)).not.toContain('SYNTHETIC_FINAL_SECRET');
    const proposed = plan.writes.find((write) => write.path === w.connection);
    expect(proposed?.after).toContain('SYNTHETIC_EARLY_SECRET');
    expect(proposed?.after).toContain('SYNTHETIC_FINAL_SECRET');
    expect(
      proposed?.after
        ? new ConfigSourceEditor(proposed.after).property(
            'plugins[0].with.client_secret',
          )?.value
        : undefined,
    ).toBe('SYNTHETIC_FINAL_SECRET');
  });
  it.each([
    0, 3, 99,
  ])('blocks schema version %i before any write, naming bakers init', (version) => {
    const w = world();
    const source = connectionText()
      .replaceAll('schema-version 1', `schema-version ${version}`)
      .replace('schema_version: 1', `schema_version: ${version}`);
    writeFileSync(w.connection, source);
    const plan = service.planConfig(w);
    expect(
      plan.report.findings.find((f) => f.code === 'unsupported_schema_version')
        ?.remediation,
    ).toContain('bakers init');
    service.applyConfigPlan(plan);
    expect(readFileSync(w.connection, 'utf8')).toBe(source);
  });
  it('fills missing current-version fields without replacing custom values', () => {
    const w = world();
    writeFileSync(
      w.machine,
      "// @bakers-schema-version 1\nexport default { schema_version: 1, machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', tunnel: true };\n",
    );
    const plan = service.planConfig({
      ...w,
      scope: 'machine',
      inputs: { label: 'operator' },
    });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    // The existing UUID survives (a re-run never replaces it); biome
    // normalizes spacing as part of the best-effort format pass.
    const text = readFileSync(w.machine, 'utf8');
    expect(text).toContain(
      "machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30'",
    );
    expect(text).toContain('tunnel: true');
    expect(text).toMatch(/label: ['"]operator['"]/);
  });
  it('initializes project files without changing global prerequisites', () => {
    const w = world();
    rmSync(w.engine);
    const before = readFileSync(w.connection, 'utf8');
    const plan = service.planConfig({
      ...w,
      operation: 'init',
      scope: 'project',
      project: 'demo',
      inputs: { workspace: 'Engineering' },
    });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    expect(existsSync(w.engine)).toBe(true);
    expect(existsSync(join(w.cwd, '.bakers/connection.config.js'))).toBe(false);
    expect(readFileSync(w.connection, 'utf8')).toBe(before);
  });
  it('detects changed source before backups or writes', () => {
    const w = world();
    const plan = service.planConfig(w);
    writeFileSync(w.connection, connectionText('changed-secret'));
    expect(
      service
        .applyConfigPlan(plan)
        .findings.some((f) => f.code === 'changed_since_planning'),
    ).toBe(true);
    expect(readdirSync(dirname(w.machine))).toHaveLength(2);
  });
});

it('check reports actual missing keys and never plans a repair', () => {
  const w = world();
  writeFileSync(
    w.machine,
    "export default { machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label:'operator' };",
  );
  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'machine',
  });
  // The run budget is a backend setting, never a required machine key.
  expect(plan.report.findings.some((f) => f.key === 'max_parallel')).toBe(
    false,
  );
  expect(plan.writes).toEqual([]);
  expect(plan.report.changes).toEqual([]);
});
it.each([
  'project',
  'executor',
  // 'agent' is intentionally absent: agents are owned by machine.config.js;
  // a project config with no agent slot is valid.
  'worktree',
])('check reports an independently missing project %s', (key) => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText().replace(new RegExp(`^  ${key}:.*\\n`, 'm'), ''),
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('blocked');
  expect(
    plan.report.findings.some(
      (finding) =>
        finding.code === 'missing_required_key' && finding.key === key,
    ),
  ).toBe(true);
});
it('check accepts a project config that names no server', () => {
  const w = world();
  writeFileSync(w.engine, engineText().replace(/^ {2}server:.*\n/m, ''));
  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });
  expect(plan.report.findings.filter((f) => f.key === 'server')).toEqual([]);
  // A repair run does not write a server back either.
  const repaired = service.planConfig({ ...w, project: 'demo' });
  const after = repaired.writes.find((x) => x.path === w.engine)?.after ?? '';
  expect(after).not.toMatch(/^\s*server:/m);
});
it.each([
  {
    name: 'the shipped fake engine and a shipped agent',
    source: `export default {
  project: { name: 'demo' },
  addons: ['@bakers-build/addon-fake', '@bakers-build/addon-codex'],
};\n`,
  },
  {
    name: 'the shipped git workspace with explicit engine slots',
    source: engineText()
      .replace(/^ {2}agent:.*\n/m, '')
      .replace(/^ {2}worktree:.*\n/m, '')
      .replace(
        /^};$/m,
        "  addons: ['@bakers-build/addon-workspace-git', '@bakers-build/addon-codex'],\n};",
      ),
  },
])('check recognizes $name', (row) => {
  const w = world();
  writeFileSync(w.engine, row.source);

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('ok');
  expect(plan.report.findings).toEqual([]);
});
it('check reports a computed critical project value as not checked', () => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText()
      .replace(/^ {2}agent:.*\n/m, '')
      .replace(
        "worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }",
        'worktree: createWorkspace()',
      ),
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  // A computed value is a warning; the loader checks it when it runs the file.
  expect(plan.report.result).toBe('ok');
  expect(plan.report.findings).toEqual([
    expect.objectContaining({
      code: 'not_checked',
      severity: 'warning',
      key: 'worktree',
    }),
  ]);
});
it('does not silently accept a computed committed project name', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `const local = { project: '' };\n${engineText()
      .replace(/^ {2}agent:.*\n/m, '')
      .replace("name: 'demo'", "name: local.project ?? 'demo'")}`,
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.findings).toEqual([
    expect.objectContaining({
      code: 'invalid_value',
      severity: 'error',
      key: 'project.name',
    }),
  ]);
});
it('checks a generated project config clean', () => {
  const w = world();
  writeFileSync(w.engine, renderCommittedConfig({ project: 'demo' }));

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('ok');
  expect(plan.report.findings).toEqual([]);
});
it.each([
  ['conductor_id', "'my-worker'"],
  ['machine_id', "'host'"],
  ['label', "'Worker'"],
])('check rejects project.config.js carrying %s as an unknown key', (key, value) => {
  const w = world();
  const path = w.engine;
  writeFileSync(
    w.engine,
    engineText().replace(
      "project: { name: 'demo' },",
      `project: { name: 'demo' }, ${key}: ${value},`,
    ),
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('blocked');
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({ code: 'unknown_key', key, path }),
  );
});
it.each([
  {
    name: 'an empty plugin descriptor',
    source: engineText().replace(
      "server: { use: '@bakers-build/addon-remote-drupal' }",
      "server: { use: '' }",
    ),
    result: 'blocked',
    code: 'invalid_value',
    key: 'server.use',
  },
  // Note: 'agent' is no longer a required conductor slot (machine owns agents
  // since schema v3). A computed agent expression in a conductor config is
  // tolerated without error; the migration will strip it.
])('check diagnoses $name instead of reporting readiness', (row) => {
  const w = world();
  writeFileSync(w.engine, row.source);

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe(row.result);
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({ code: row.code, key: row.key }),
  );
});
it.each([
  // Note: 'agent' is intentionally absent — agents are owned by machine.config.js
  // (machine schema v3+); the conductor planner no longer fills in an agent slot.
  { operation: 'upgrade' as const, key: 'worktree', project: undefined },
])('$operation repairs an unambiguous missing conductor $key', async (row) => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText().replace(new RegExp(`^  ${row.key}:.*\\n`, 'm'), ''),
  );

  const plan = service.planConfig({
    ...w,
    operation: row.operation,
    scope: 'project',
    ...(row.project ? { project: row.project } : {}),
  });

  expect(plan.report.result).toBe('ok');
  expect(plan.writes.map((write) => write.path)).toContain(w.engine);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(
    service.planConfig({
      ...w,
      operation: 'check',
      scope: 'project',
    }).report.result,
  ).toBe('ok');
});
it('does not treat project initialization as complete with broken prerequisites', () => {
  const w = world();
  rmSync(w.engine);
  rmSync(w.connection);
  const plan = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'init',
    project: 'demo',
  });
  expect(plan.report.result).toBe('blocked');
  service.applyConfigPlan(plan);
  expect(existsSync(w.engine)).toBe(false);
});
it('upgrade adds no max_parallel to a machine that names none', () => {
  const w = world();
  writeFileSync(
    w.machine,
    "export default { machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', label:'operator' };",
  );
  const plan = service.planConfig({ ...w, scope: 'machine' });
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readFileSync(w.machine, 'utf8')).not.toContain('max_parallel');
});
it('upgrade blocks on a leftover max_parallel and writes nothing', () => {
  const w = world();
  const machine = readFileSync(w.machine, 'utf8').replace(
    "label: 'operator'",
    "label: 'operator', max_parallel: 2",
  );
  writeFileSync(w.machine, machine);
  const plan = service.planConfig({ ...w, scope: 'machine' });
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({ code: 'unknown_key', key: 'max_parallel' }),
  );
  expect(service.applyConfigPlan(plan).result).toBe('blocked');
  expect(readFileSync(w.machine, 'utf8')).toBe(machine);
});
it('blocks computed machine credentials without printing secret-bearing expressions', () => {
  const w = world();
  writeFileSync(
    w.machine,
    readFileSync(w.machine, 'utf8').replace(
      "label: 'operator'",
      "label: 'operator', client_secret: getSecret('sensitive-expression')",
    ),
  );
  const plan = service.planConfig(w);
  expect(plan.report.result).toBe('blocked');
  expect(JSON.stringify(plan.report)).not.toContain('sensitive-expression');
});
it('restores already replaced files when a later atomic replacement fails', () => {
  const w = world();
  const before = readFileSync(w.machine, 'utf8');
  const plan = service.planConfig(w);
  const write = plan.writes.find((item) => item.path === w.connection);
  expect(write).toBeDefined();
  // A deterministic filesystem fault: the second target has a directory parent that cannot be created.
  if (!write) return;
  const obstacle = join(w.home, 'obstacle');
  writeFileSync(obstacle, 'file');
  write.path = join(obstacle, 'config.js');
  const report = service.applyConfigPlan(plan);
  expect(report.result).toBe('failed');
  expect(readFileSync(w.machine, 'utf8')).toBe(before);
});
it('project init creates only the committed engine config', () => {
  const w = world();
  rmSync(w.engine);
  const plan = service.planConfig({
    ...w,
    operation: 'init',
    scope: 'project',
    project: 'demo',
    machinePath: w.machine,
    inputs: { workspace: 'Engineering' },
  });
  expect(plan.report.result).toBe('ok');
  service.applyConfigPlan(plan);
  expect(existsSync(w.engine)).toBe(true);
  const written = readFileSync(w.engine, 'utf8');
  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'Engineering',
  });
  expect(written).toContain("addons: ['@bakers-build/addon-herdr']");
  expect(existsSync(join(w.cwd, '.bakers/connection.config.js'))).toBe(false);
});
it('project init names herdr once in addons and no server, executor or worktree', () => {
  const w = world();
  rmSync(w.engine);
  const plan = service.planConfig({
    ...w,
    operation: 'init',
    scope: 'project',
    project: 'demo',
    machinePath: w.machine,
  });
  expect(plan.report.result).toBe('ok');
  service.applyConfigPlan(plan);
  const source = new ConfigSourceEditor(readFileSync(w.engine, 'utf8'));
  for (const slot of ['server', 'executor', 'worktree'])
    expect(source.property(slot)).toBeUndefined();
  expect(source.expression('addons')).toBe("['@bakers-build/addon-herdr']");
});
it('project init accepts an omitted workspace name', () => {
  const w = world();
  rmSync(w.engine);

  const plan = service.planConfig({
    ...w,
    operation: 'init',
    scope: 'project',
    project: 'demo',
    machinePath: w.machine,
  });

  expect(plan.report.result).toBe('ok');
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readBbProjectSelection(w.engine)).toEqual({ project: 'demo' });
});
it('project init inserts project.workspace into an existing project config', () => {
  const w = world();
  writeFileSync(w.engine, engineText());

  const plan = service.planConfig({
    ...w,
    operation: 'init',
    scope: 'project',
    project: 'demo',
    inputs: { workspace: 'Engineering' },
  });

  expect(plan.report.result).toBe('ok');
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'Engineering',
  });
});
it('statically reads and updates project.workspace without replacing the worktree plugin', async () => {
  const w = world();
  writeFileSync(
    w.engine,
    `throw new Error('must not execute'); ${engineText().replace(
      "name: 'demo'",
      "name: 'demo', workspace: 'First'",
    )}`,
  );

  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'First',
  });
  await writeBbWorkspaceSelection(
    bakersProjectOwner(w.engine),
    'Second',
    'hint',
  );

  const written = readFileSync(w.engine, 'utf8');
  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'Second',
  });
  expect(written).toContain("worktree: { use: '@bakers-build/addon-herdr'");
});
it('keeps disagreeing schema markers unchanged before any write', () => {
  const w = world();
  const before = connectionText().replace(
    'schema_version: 1',
    'schema_version: 3',
  );
  writeFileSync(w.connection, before);
  const plan = service.planConfig(w);
  expect(
    plan.report.findings.some((f) => f.code === 'version_marker_disagreement'),
  ).toBe(true);
  service.applyConfigPlan(plan);
  expect(readFileSync(w.connection, 'utf8')).toBe(before);
});
it('does not reinterpret an existing legacy project file as an engine config', () => {
  const w = world();
  const path = join(w.cwd, '.bakers/bakers.config.js');
  rmSync(w.engine);
  writeFileSync(
    path,
    engineText().replace(
      '@bakers-build/addon-claude',
      '@bakers-build/addon-codex',
    ),
  );
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('blocked');
  expect(existsSync(path)).toBe(true);
  expect(existsSync(w.engine)).toBe(false);
});
// ~/.config/conductor belongs to other tools; an upgrade must neither merge nor delete it.
it('never reads or removes a conductor machine file under ~/.config/conductor', () => {
  const w = world();
  const legacy = join(w.home, '.config/conductor/conductor.config.machine.js');
  mkdirSync(dirname(legacy), { recursive: true });
  const original =
    "export default {machine_id:'foreign-host',user_id:'foreign'};";
  writeFileSync(legacy, original);
  const plan = service.planConfig(w);
  expect(plan.writes.some((write) => write.path === legacy)).toBe(false);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readFileSync(legacy, 'utf8')).toBe(original);
  expect(readFileSync(w.machine, 'utf8')).not.toContain('foreign');
});
// An old local file is not read: upgrade neither merges nor removes it.
it('upgrade leaves an old home-local override alone and merges nothing from it', () => {
  const w = world();
  const local = join(w.home, '.bakers/conductor.config.local.js');
  const original =
    'export default { oauth: { client_secret:process.env.CUSTOM_SECRET } };';
  writeFileSync(local, original);
  const plan = service.planConfig(w);
  expect(plan.writes.some((write) => write.path === local)).toBe(false);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readFileSync(local, 'utf8')).toBe(original);
  expect(readFileSync(w.connection, 'utf8')).not.toContain('CUSTOM_SECRET');
});

it('an explicit isolated machine target never migrates or removes unrelated home legacy input', () => {
  const w = world();
  const legacy = join(w.home, '.config/conductor/conductor.config.machine.js');
  mkdirSync(dirname(legacy), { recursive: true });
  const original =
    "export default {machine_id:'operator-original',user_id:'operator'};";
  writeFileSync(legacy, original);
  const custom = join(w.home, 'fixture-machine.js');
  writeFileSync(
    custom,
    "export default {schema_version:1,machine_id:'0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',label:'fixture'};",
  );
  const plan = service.planConfig({
    ...w,
    scope: 'machine',
    machinePath: custom,
  });
  expect(plan.report.result).toBe('ok');
  expect(plan.writes.some((write) => write.path === legacy)).toBe(false);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readFileSync(legacy, 'utf8')).toBe(original);
});

it.each([
  'machine',
  'connection',
  'project',
] as const)('repairs an independently partial %s layer from explicit inputs', async (layer) => {
  const w = world();
  const inputs = {
    label: 'operator',
    baseUrl: 'https://example.test',
    clientId: 'client',
    secret: 'private-value',
    workspaceId: workspace,
  };
  const selected =
    layer === 'machine'
      ? w.machine
      : layer === 'connection'
        ? w.connection
        : w.engine;
  writeFileSync(selected, 'export default {};');
  const repaired = service.planConfig({ ...w, inputs, project: 'demo' });
  expect(service.applyConfigPlan(repaired).result).toBe('ok');
  const config = (
    await import(`${pathToFileURL(selected).href}?repair=${Date.now()}`)
  ).default;
  if (layer === 'machine') expect(config).not.toHaveProperty('max_parallel');
  expect(config).toMatchObject(
    layer === 'machine'
      ? { label: 'operator' }
      : layer === 'connection'
        ? { workspace_id: workspace }
        : {
            project: { name: 'demo' },
            addons: ['@bakers-build/addon-herdr'],
          },
  );
  if (layer === 'machine') expect(config.machine_id).toMatch(UUID_PATTERN);
  expect(service.planConfig({ ...w, inputs, project: 'demo' }).writes).toEqual(
    [],
  );
});

it('init generates a machine UUID and keeps it on a second run', async () => {
  const w = world();
  rmSync(w.machine);
  const init = () =>
    service.planConfig({
      ...w,
      operation: 'init',
      scope: 'machine',
      inputs: { label: 'cw-laptop' },
    });
  expect(service.applyConfigPlan(init()).result).toBe('ok');
  const first = await importMachine(w.machine);
  expect(first.machine_id).toMatch(UUID_PATTERN);
  expect(first.label).toBe('cw-laptop');
  expect(first).not.toHaveProperty('user_id');
  expect(init().writes).toEqual([]);
});

it('writes a secret-free device-code connection that then checks clean', () => {
  const w = world();
  rmSync(w.connection);
  const inputs = {
    baseUrl: 'https://example.test',
    clientId: 'bakers-cli',
    workspaceId: workspace,
    authType: 'oauth2_device_code' as const,
  };
  const plan = service.planConfig({ ...w, inputs });
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  const text = readFileSync(w.connection, 'utf8');
  expect(text).toContain("type: 'oauth2_device_code'");
  expect(text).not.toContain('client_secret');
  const checked = service.planConfig({ ...w, inputs, operation: 'check' });
  expect(checked.report.findings.filter((f) => f.severity === 'error')).toEqual(
    [],
  );
});

it('still refuses to render a client-credentials connection without a secret', () => {
  const w = world();
  rmSync(w.connection);
  const plan = service.planConfig({
    ...w,
    inputs: {
      baseUrl: 'https://example.test',
      clientId: 'bakers-cw',
      workspaceId: workspace,
    },
  });
  expect(plan.writes.some((write) => write.path === w.connection)).toBe(false);
});

it('initializes herdr-core in addons with its nested Git worktree and no herdr slots', async () => {
  const { readAddonCapabilities } = await import('@bakers-build/core');
  const w = world();
  rmSync(w.engine);
  const executor = '@bakers-build/addon-herdr-core';
  const capabilities = await readAddonCapabilities(
    [executor],
    [import.meta.url],
  );
  const plan = service.planConfig({
    ...w,
    operation: 'init',
    scope: 'project',
    project: 'demo',
    slots: { executor },
    capabilities,
  });
  const text =
    plan.writes.find((write) => write.path === w.engine)?.after ?? '';
  const source = new ConfigSourceEditor(text);
  expect(source.property('executor')).toBeUndefined();
  expect(source.property('worktree')).toBeUndefined();
  expect(text).toContain(executor);
  expect(text).not.toContain("'@bakers-build/addon-herdr'");
  expect(plan.report.findings.filter((f) => f.key === 'worktree')).toEqual([]);
});

it('keeps existing project slots and addon entries when init gets an executor flag', async () => {
  const { readAddonCapabilities } = await import('@bakers-build/core');
  const w = world();
  const executor = '@bakers-build/addon-herdr-core';
  const capabilities = await readAddonCapabilities(
    [executor],
    [import.meta.url],
  );
  const plan = service.planConfig({
    ...w,
    operation: 'init',
    scope: 'project',
    slots: { executor },
    capabilities,
  });
  const text =
    plan.writes.find((write) => write.path === w.engine)?.after ??
    readFileSync(w.engine, 'utf8');
  expect(new ConfigSourceEditor(text).property('executor.use')?.value).toBe(
    '@bakers-build/addon-herdr',
  );
  expect(text).not.toContain(executor);
});

it('requires a worktree selection for an executor that supplies none', async () => {
  const { readAddonCapabilities } = await import('@bakers-build/core');
  const w = world();
  rmSync(w.engine);
  const executor = join(w.cwd, 'executor.js');
  writeFileSync(executor, 'export const executors = (acc) => acc;');
  const capabilities = await readAddonCapabilities(
    [executor],
    [import.meta.url],
  );
  const plan = service.planConfig({
    ...w,
    project: 'demo',
    operation: 'init',
    scope: 'project',
    slots: { executor },
    capabilities,
  });
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({
      key: 'worktree',
      expected: expect.stringContaining('pass --worktree'),
    }),
  );
  expect(service.applyConfigPlan(plan).result).toBe('blocked');
  expect(existsSync(w.engine)).toBe(false);
});

it('honors an explicit worktree flag alongside an executor with a nested worktree', async () => {
  const { readAddonCapabilities } = await import('@bakers-build/core');
  const w = world();
  rmSync(w.engine);
  const executor = '@bakers-build/addon-herdr-core';
  const worktree = join(w.cwd, 'custom-worktree.js');
  writeFileSync(worktree, 'export const worktrees = (acc) => acc;');
  const capabilities = await readAddonCapabilities(
    [executor, worktree],
    [import.meta.url],
  );
  const plan = service.planConfig({
    ...w,
    project: 'demo',
    operation: 'init',
    scope: 'project',
    slots: { executor, worktree },
    capabilities,
  });
  expect(plan.writes.find((write) => write.path === w.engine)?.after).toContain(
    worktree,
  );
});
