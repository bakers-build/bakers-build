import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as service from '../../src/cli/config-plan.js';
import { ConfigSourceEditor } from '../../src/cli/config-source-edit.js';
import {
  configImportExpression,
  renderCommittedConfig,
  renderHostMachine,
} from '../../src/cli/config-templates.js';
import {
  bakersProjectOwner,
  readBbProjectSelection,
  writeBbWorkspaceSelection,
} from '../../src/cli/project-context.js';
import { loadConductorConfig } from '../../src/config.js';

it('reads nested bakers.build identity without reading the technical workspace plugin', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default {
    bakers: { project: 'demo', workspace: 'Engineering' },
    workspace: { plugin: '@bakers-build/addon-herdr' }
  };\n`,
  );
  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'Engineering',
  });
});

it('writes only the nested workspace in the selected conductor file', async () => {
  const w = world();
  const variant = join(dirname(w.engine), 'night.conductor.config.js');
  const original = `export default { bakers: { project: 'demo', workspace: 'First' }, workspace: { plugin: '@bakers-build/addon-herdr' } };\n`;
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
    "workspace: { plugin: '@bakers-build/addon-herdr' }",
  );
  expect(readFileSync(w.engine, 'utf8')).toBe(original);
});

it.each([
  "export default { project: 'demo' };",
  "export default { bakers: { project: 'demo', ...extra } };",
  'export default { bakers: getIdentity() };',
  'export default { bakers: { project: chosenProject } };',
  "export default { bakers: { project: '' } };",
])('rejects an uninspectable or legacy bakers.build identity', (source) => {
  const w = world();
  writeFileSync(w.engine, source);
  expect(() => readBbProjectSelection(w.engine)).toThrow(
    /bakers config upgrade --scope project/,
  );
});

it('migrates legacy project identity without changing the technical workspace plugin', () => {
  const w = world();
  const original = `export default { project: 'demo', bb_workspace: 'Engineering', workspace: { plugin: '@bakers-build/addon-herdr' }, hooks: keepHooks };\n`;
  writeFileSync(w.engine, original);
  const plan = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'upgrade',
  });
  expect(plan.report.result).toBe('ok');
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  const migrated = readFileSync(w.engine, 'utf8');
  expect(readBbProjectSelection(w.engine)).toEqual({
    project: 'demo',
    workspace: 'Engineering',
  });
  expect(migrated).toContain(
    "workspace: { plugin: '@bakers-build/addon-herdr' }",
  );
  expect(migrated).toContain('hooks: keepHooks');
  expect(
    service.planConfig({ ...w, scope: 'project', operation: 'upgrade' }).report
      .changes,
  ).toEqual([]);
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
it('migrates each conductor variant independently and preserves file modes', () => {
  const w = world();
  const variant = join(dirname(w.engine), 'night.conductor.config.js');
  writeFileSync(
    w.engine,
    `export default { project: 'demo', workspace: { plugin: 'technical' } };`,
  );
  writeFileSync(
    variant,
    `export default { project: 'night', bb_workspace: 'Sales', workspace: { plugin: 'technical' } };`,
    { mode: 0o640 },
  );
  const plan = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'upgrade',
  });
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readBbProjectSelection(w.engine)).toEqual({ project: 'demo' });
  expect(readBbProjectSelection(variant)).toEqual({
    project: 'night',
    workspace: 'Sales',
  });
  expect(readFileSync(variant, 'utf8')).toContain(
    "workspace: { plugin: 'technical' }",
  );
  expect(statSync(variant).mode & 0o777).toBe(0o640);
});

it('blocks runtime loading of legacy top-level identity before evaluating source', async () => {
  const w = world();
  const sentinel = join(w.cwd, 'evaluated');
  writeFileSync(
    w.engine,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'yes'); export default { project: 'demo' };`,
  );
  await expect(loadConductorConfig(w.engine)).rejects.toThrow(
    /bakers config upgrade --scope project/,
  );
  expect(existsSync(sentinel)).toBe(false);
});
it('config check names project upgrade for legacy identity', () => {
  const w = world();
  writeFileSync(w.engine, `export default { project: 'demo' };`);
  const report = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'check',
  }).report;
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      key: 'project',
      remediation: expect.stringContaining(
        'bakers config upgrade --scope project',
      ),
    }),
  );
});
it('config check rejects a spread nested bakers.build identity', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `export default { bakers: { project: 'demo', ...computed } };`,
  );
  const report = service.planConfig({
    ...w,
    scope: 'project',
    operation: 'check',
  }).report;
  expect(report.result).toBe('blocked');
  expect(report.findings).toContainEqual(
    expect.objectContaining({
      key: 'bakers',
      code: 'unsupported_source_shape',
    }),
  );
});

const roots: string[] = [];
const workspace = '11111111-1111-4111-8111-111111111111';
function engineText() {
  return `export default {
  bakers: { project: 'demo' },
  conductor_id: 'my-worker',
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  agent: { plugin: '@bakers-build/addon-claude' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
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
  writeFileSync(engine, engineText());
  return { home, cwd, machine, connection, engine, scope: 'all' as const };
}
function connectionText(secret = 'private-value') {
  return `// @bakers-schema-version 3\nexport default { schema_version: 3, site: { base_url: 'https://example.test' }, workspace_id: '${workspace}', plugins: [{ plugin: '@dropsh/plugin-oauth2', with: { id: 'bakers', default: true, scope: 'bb:session', client_id: 'client', client_secret: '${secret}' } }] };\n`;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe('offline scoped configuration plan and apply', () => {
  it('renders schema-v2 zero-config agent templates', () => {
    const machine = renderHostMachine({
      machineId: 'host',
      userId: 'operator',
      maxParallel: 2,
    });
    const conductor = renderCommittedConfig({
      project: 'demo',
      hooks: {
        after_create: 'ddev init-worktree',
        after_done: 'ddev delete -Oy',
      },
    });

    expect(machine).toContain('// @bakers-schema-version 2');
    expect(machine).toContain('schema_version: 2');
    expect(machine).not.toMatch(/^\s*agents:/m);
    expect(conductor).toContain(
      "addons: [{ use: '@bakers-build/addon-herdr' }, { use: '@bakers-build/addon-claude', alias: 'opus' }]",
    );
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
      write.path.endsWith(join('.bakers', 'conductor.config.js')),
    );
    expect(committed?.after).toBeTruthy();
    expect(committed?.after).toContain('process.env.BB_HOME');
    expect(committed?.after).not.toContain('file://');
    expect(committed?.after).not.toContain(home);
  });

  it('omits the hooks block when no hook answer was supplied, and names no provisioning tool', () => {
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
      write.path.endsWith(join('.bakers', 'conductor.config.js')),
    );
    expect(committed?.after).not.toContain('hooks');
    expect(committed?.after).not.toContain('ddev');
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
      write.path.endsWith(join('.bakers', 'conductor.config.js')),
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
  machine_id: 'host',
  user_id: 'operator',
  max_parallel: 2,
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
  project: 'demo',
  conductor_id: 'my-worker',
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
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
    expect(machine.schema_version).toBe(3);
    expect(machine.addons).toEqual([
      { use: '@bakers-build/addon-claude' },
      { use: '@bakers-build/addon-pi' },
    ]);
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
      default_agent: 'opus',
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
      'max_parallel: 2',
      "max_parallel: 2, agents: { enabled: ['opus'] }",
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
    expect(machine.agents.default_agent).toBe('opus');
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
      'max_parallel: 2',
      "max_parallel: 2, agent_routes: { fast: { '*': chooseAgent() } }",
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
      'max_parallel: 2',
      "max_parallel: 2, agent_routes: { default: chooseRoute(), fast: { '*': 'opus' } }",
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
      'max_parallel: 2',
      `max_parallel: 2, ${policy}`,
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
      'max_parallel: 2',
      `max_parallel: 2, ${policy}`,
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
  project: 'demo',
  conductor_id: 'my-worker',
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
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
    // Non-agent packages (remote-drupal, herdr) are preserved in the conductor
    // config. The agent harness (@bakers-build/addon-claude) is removed — agents are
    // now owned exclusively by machine.config.js (machine 2→3 migration).
    expect(conductor).toContain("'@bakers-build/addon-remote-drupal'");
    expect(conductor).toContain("'@bakers-build/addon-herdr'");
    expect(conductor).not.toContain('@bakers-build/addon-claude');
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
        "conductor_id: 'my-worker',",
        "conductor_id: 'my-worker', addons: [...local.addons],",
      );
    writeFileSync(w.engine, engine);

    const plan = service.planConfig(w);

    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_value', key: 'addons' }),
    );
    expect(service.applyConfigPlan(plan).result).toBe('blocked');
    expect(readFileSync(w.engine, 'utf8')).toBe(engine);
  });
  it('moves mixed machine values without evaluating modules and redacts preview', () => {
    const w = world();
    rmSync(w.connection);
    const sentinel = join(w.home, 'executed');
    writeFileSync(
      w.machine,
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'bad');\nexport default { machine_id:'host', user_id:'operator', max_parallel:2, base_url:'https://example.test', client_id:'client', client_secret:'private-value', workspace_id:'${workspace}', custom: process.env.EXTENSION /* keep me */ };`,
    );
    const plan = service.planConfig(w);
    expect(plan.report.result).toBe('ok');
    expect(existsSync(sentinel)).toBe(false);
    expect(existsSync(w.connection)).toBe(false);
    expect(JSON.stringify(plan.report)).not.toContain('private-value');
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = readFileSync(w.machine, 'utf8');
    expect(machine).toContain('custom: process.env.EXTENSION /* keep me */');
    expect(machine).not.toContain('client_secret');
    expect(readFileSync(w.connection, 'utf8')).toContain('private-value');
    expect(statSync(w.connection).mode & 0o777).toBe(0o600);
    expect(service.planConfig(w).report.changes).toEqual([]);
  });
  it.each([
    'machine',
    'connection',
  ])('blocks mixed ownership movement in %s scope before any write', (scope) => {
    const w = world();
    const before = readFileSync(w.machine, 'utf8').replace(
      'max_parallel: 2',
      "max_parallel: 2, client_secret: 'private-value'",
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
        'max_parallel: 2',
        "max_parallel: 2, client_secret: 'other-private'",
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
  it('migrates conductor variant and local identity while preserving host references', () => {
    const w = world();
    const variant = join(w.cwd, '.bakers/night.conductor.config.js');
    const local = join(w.cwd, '.bakers/conductor.config.local.js');
    writeFileSync(
      variant,
      "const machine = {}; export default { project: 'night', machine_id: machine.machine_id + '-night', max_parallel: 2 };",
    );
    writeFileSync(local, "export default { machine_id: 'local-worker' };");
    expect(service.applyConfigPlan(service.planConfig(w)).result).toBe(
      'incomplete',
    );
    expect(readFileSync(variant, 'utf8')).toContain(
      "conductor_id: machine.machine_id + '-night'",
    );
    expect(readFileSync(variant, 'utf8')).not.toContain('max_parallel');
    expect(readFileSync(local, 'utf8')).toContain(
      "conductor_id: 'local-worker'",
    );
  });
  it('blocks future versions before generic renames', () => {
    const w = world();
    const source = connectionText()
      .replaceAll('schema-version 3', 'schema-version 99')
      .replace('schema_version: 3', 'schema_version: 99')
      .replace('@dropsh/plugin-oauth2', '@bakers-build/plugin-dropsh');
    writeFileSync(w.connection, source);
    const plan = service.planConfig(w);
    expect(
      plan.report.findings.some((f) => f.code === 'future_schema_version'),
    ).toBe(true);
    service.applyConfigPlan(plan);
    expect(readFileSync(w.connection, 'utf8')).toBe(source);
  });
  it('fills missing current-version fields without replacing custom values', () => {
    const w = world();
    writeFileSync(
      w.machine,
      "// @bakers-schema-version 1\nexport default { schema_version: 1, machine_id:'custom', extra: 42 };\n",
    );
    const plan = service.planConfig({
      ...w,
      scope: 'machine',
      inputs: { machineId: 'ignored', userId: 'operator', maxParallel: 3 },
    });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    // The custom values survive; biome normalizes spacing (machine_id:'custom' →
    // machine_id: 'custom') as part of the best-effort format pass.
    expect(readFileSync(w.machine, 'utf8')).toContain("machine_id: 'custom'");
    expect(readFileSync(w.machine, 'utf8')).toContain('extra: 42');
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
    expect(existsSync(join(w.cwd, '.bakers/bakers.config.js'))).toBe(false);
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
  it('does not create a project connection while repairing a legacy engine', () => {
    const w = world();
    writeFileSync(
      w.engine,
      connectionText('project-private')
        .replace('https://example.test', 'https://project.test')
        .replace('schema_version: 3,', "project: 'demo', machine_id: 'legacy',")
        .replace('// @bakers-schema-version 3\n', ''),
    );
    const plan = service.planConfig(w);
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    expect(existsSync(join(w.cwd, '.bakers/bakers.config.js'))).toBe(false);
    expect(readFileSync(w.connection, 'utf8')).toContain('private-value');
  });
});

it('check reports actual missing keys and never plans a repair', () => {
  const w = world();
  writeFileSync(
    w.machine,
    "export default { machine_id:'host', user_id:'operator' };",
  );
  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'machine',
  });
  expect(
    plan.report.findings.some(
      (f) => f.code === 'missing_required_key' && f.key === 'max_parallel',
    ),
  ).toBe(true);
  expect(plan.writes).toEqual([]);
  expect(plan.report.changes).toEqual([]);
});
it.each([
  'bakers.project',
  'conductor_id',
  'remote',
  'executor',
  // 'agent' is intentionally absent: agents are owned by machine.config.js
  // (machine schema v3+); a conductor config with no agent slot is valid.
  'workspace',
])('check reports an independently missing conductor %s', (key) => {
  const w = world();
  writeFileSync(
    w.engine,
    key === 'bakers.project'
      ? engineText().replace("  bakers: { project: 'demo' },\n", '')
      : engineText().replace(new RegExp(`^  ${key}:.*\\n`, 'm'), ''),
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
it.each([
  {
    name: 'the shipped fake engine and a shipped agent',
    source: `export default {
  bakers: { project: 'demo' },
  conductor_id: 'my-worker',
  addons: ['@bakers-build/addon-fake', '@bakers-build/addon-codex'],
};\n`,
  },
  {
    name: 'the shipped git workspace with explicit engine slots',
    source: engineText()
      .replace(/^ {2}agent:.*\n/m, '')
      .replace(/^ {2}workspace:.*\n/m, '')
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
it('check reports a computed critical conductor value as incomplete', () => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText().replace(
      "workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }",
      'workspace: createWorkspace()',
    ),
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('incomplete');
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({ code: 'unknown_value', key: 'workspace' }),
  );
});
it('does not accept a computed committed project', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `const local = { project: '' };\n${engineText().replace("project: 'demo'", "project: local.project ?? 'demo'")}`,
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('incomplete');
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({ code: 'unknown_value', key: 'bakers.project' }),
  );
});
it.each([
  {
    name: 'absent',
    local: null,
    result: 'ok',
    code: undefined,
  },
  {
    name: 'null',
    local: 'export default { project: null };\n',
    result: 'ok',
    code: undefined,
  },
  {
    name: 'nonempty',
    local: "export default { project: 'local-demo' };\n",
    result: 'ok',
    code: undefined,
  },
  {
    name: 'empty',
    local: "export default { project: '' };\n",
    result: 'ok',
    code: undefined,
  },
  {
    name: 'opaque',
    local: 'export default { project: resolveProject() };\n',
    result: 'ok',
    code: undefined,
  },
])('validates an $name generated conductor local project override', (row) => {
  const w = world();
  const local = join(w.cwd, '.bakers/conductor.config.local.js');
  writeFileSync(
    w.engine,
    renderCommittedConfig({ project: 'demo', machinePath: w.machine }),
  );
  if (row.local === null) rmSync(local, { force: true });
  else writeFileSync(local, row.local);

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe(row.result);
  if (row.code)
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: row.code, key: 'project', path: local }),
    );
  else expect(plan.report.findings).toEqual([]);
});
it.each([
  {
    name: 'generated fallback when local identities are absent',
    local: 'export default {};\n',
    result: 'ok',
    code: undefined,
    key: undefined,
    legacy: false,
  },
  {
    name: 'generated fallback after a null current identity',
    local: 'export default { conductor_id: null };\n',
    result: 'ok',
    code: undefined,
    key: undefined,
    legacy: false,
  },
  {
    name: 'valid current identity override',
    local: "export default { conductor_id: 'local-worker' };\n",
    result: 'ok',
    code: undefined,
    key: undefined,
    legacy: false,
  },
  {
    name: 'empty current identity override',
    local: "export default { conductor_id: '' };\n",
    result: 'blocked',
    code: 'invalid_value',
    key: 'conductor_id',
    legacy: false,
  },
  {
    name: 'numeric current identity override',
    local: 'export default { conductor_id: 42 };\n',
    result: 'blocked',
    code: 'invalid_value',
    key: 'conductor_id',
    legacy: false,
  },
  {
    name: 'legacy machine identity after a null conductor identity',
    local:
      "export default { conductor_id: null, machine_id: 'legacy-worker' };\n",
    result: 'ok',
    code: undefined,
    key: undefined,
    legacy: true,
  },
  {
    name: 'empty conductor identity before a valid legacy machine identity',
    local:
      "export default { conductor_id: '', machine_id: 'legacy-worker' };\n",
    result: 'blocked',
    code: 'invalid_value',
    key: 'conductor_id',
    legacy: true,
  },
  {
    name: 'empty selected legacy machine identity',
    local: "export default { conductor_id: null, machine_id: '' };\n",
    result: 'blocked',
    code: 'invalid_value',
    key: 'machine_id',
    legacy: true,
  },
  {
    name: 'computed selected conductor identity',
    local: 'export default { conductor_id: resolveIdentity() };\n',
    result: 'incomplete',
    code: 'unknown_value',
    key: 'conductor_id',
    legacy: false,
  },
])('validates $name in generated conductor wiring', (row) => {
  const w = world();
  const local = join(w.cwd, '.bakers/conductor.config.local.js');
  const generated = renderCommittedConfig({
    project: 'demo',
    machinePath: w.machine,
  });
  writeFileSync(
    w.engine,
    row.legacy
      ? generated.replace(
          'local.conductor_id ?? composedConductorId',
          'local.conductor_id ?? local.machine_id ?? composedConductorId',
        )
      : generated,
  );
  writeFileSync(local, row.local);

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe(row.result);
  if (row.code)
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: row.code, key: row.key, path: local }),
    );
  else expect(plan.report.findings).toEqual([]);
});
it.each([
  'init',
  'upgrade',
] as const)('%s refuses to overwrite an invalid generated local identity', (operation) => {
  const w = world();
  const local = join(w.cwd, '.bakers/conductor.config.local.js');
  writeFileSync(
    w.engine,
    renderCommittedConfig({ project: 'demo', machinePath: w.machine }),
  );
  writeFileSync(local, "export default { conductor_id: '' };\n");

  const plan = service.planConfig({
    ...w,
    operation,
    scope: 'project',
    ...(operation === 'init' ? { project: 'demo' } : {}),
  });

  expect(plan.report.result).toBe('blocked');
  // The plan may propose writes for the conductor config (agent-addon migration),
  // but the invalid local identity blocks ALL writes from being applied.
  expect(plan.writes.every((w) => w.path !== local)).toBe(true);
  expect(service.applyConfigPlan(plan).result).toBe('blocked');
  // The local file must remain unchanged regardless of other proposed writes.
  expect(readFileSync(local, 'utf8')).toBe(
    "export default { conductor_id: '' };\n",
  );
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({
      code: 'invalid_value',
      key: 'conductor_id',
      path: local,
    }),
  );
});
it('check does not treat a computed legacy conductor identity as ready', () => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText().replace(
      "conductor_id: 'my-worker'",
      'machine_id: createIdentity()',
    ),
  );

  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });

  expect(plan.report.result).toBe('incomplete');
  expect(plan.report.findings).toContainEqual(
    expect.objectContaining({ code: 'unknown_value', key: 'conductor_id' }),
  );
});
it.each([
  {
    name: 'an empty plugin descriptor',
    source: engineText().replace(
      "remote: { plugin: '@bakers-build/addon-remote-drupal' }",
      "remote: { plugin: '' }",
    ),
    result: 'blocked',
    code: 'invalid_value',
    key: 'remote',
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
  { operation: 'upgrade' as const, key: 'workspace', project: undefined },
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
it('moves missing capacity from the engine before applying the default', () => {
  const w = world();
  writeFileSync(
    w.machine,
    "export default { machine_id:'host', user_id:'operator' };",
  );
  writeFileSync(w.engine, "export default { project:'demo', max_parallel:7 };");
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readFileSync(w.machine, 'utf8')).toMatch(/max_parallel["']?\s*:\s*7/);
});
it('retains comments containing historical names while renaming real addon descriptors', () => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText()
      .replace(
        'export default {',
        "// '@bakers-build/plugin-herdr' is historical\nexport default {",
      )
      .replace('@bakers-build/addon-herdr', '@bakers-build/plugin-herdr'),
  );
  service.applyConfigPlan(service.planConfig(w));
  expect(readFileSync(w.engine, 'utf8')).toContain(
    "// '@bakers-build/plugin-herdr' is historical",
  );
  expect(readFileSync(w.engine, 'utf8')).toContain(
    "plugin: '@bakers-build/addon-herdr'",
  );
});
it('blocks computed machine credentials without printing secret-bearing expressions', () => {
  const w = world();
  writeFileSync(
    w.machine,
    readFileSync(w.machine, 'utf8').replace(
      'max_parallel: 2',
      "max_parallel:2, client_secret: getSecret('sensitive-expression')",
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
it('migrates a shipped generated v3 global connection without retaining machine credential imports', async () => {
  const w = world();
  writeFileSync(
    w.machine,
    `export default { machine_id:'host', user_id:'operator', max_parallel:2, base_url:'https://example.test', client_id:'client', client_secret:'private-value', workspace_id:'${workspace}' };`,
  );
  writeFileSync(
    w.connection,
    readFileSync(
      new URL('./fixtures/bb-448/connection-v3.js.txt', import.meta.url),
      'utf8',
    ),
  );
  const plan = service.planConfig(w);
  expect(plan.report.result).toBe('ok');
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  const config = (await import(`${w.connection}?test=generated`)).default;
  expect(config.site.base_url).toBe('https://example.test');
  expect(config.workspace_id).toBe(workspace);
  expect(
    config.plugins.find(
      (p: { plugin: string }) => p.plugin === '@dropsh/plugin-oauth2',
    ).with.client_secret,
  ).toBe('private-value');
  expect(readFileSync(w.connection, 'utf8')).not.toContain('await loadMachine');
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
  expect(written).toContain(
    "bakers: { project: 'demo', workspace: 'Engineering' }",
  );
  expect(written).toContain("plugin: '@bakers-build/addon-herdr'");
  expect(existsSync(join(w.cwd, '.bakers/bakers.config.js'))).toBe(false);
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
it('project init inserts bakers.workspace into an existing conductor config', () => {
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
it('statically reads and updates bakers.workspace without replacing the workspace plugin', async () => {
  const w = world();
  writeFileSync(
    w.engine,
    `throw new Error('must not execute'); ${engineText().replace(
      "project: 'demo'",
      "project: 'demo', workspace: 'First'",
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
  expect(written).toContain("workspace: { plugin: '@bakers-build/addon-herdr'");
});
it('upgrade leaves an existing legacy project connection byte-for-byte unchanged', () => {
  const w = world();
  const path = join(w.cwd, '.bakers/bakers.config.js');
  const before = connectionText();
  writeFileSync(path, before);
  const plan = service.planConfig({ ...w, connectionPath: w.connection });
  service.applyConfigPlan(plan);
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(plan.report.findings.some((f) => f.code === 'superseded_file')).toBe(
    true,
  );
});
it('check reports dead connection keys in conductor.config.local.js', () => {
  const w = world();
  writeFileSync(
    join(w.cwd, '.bakers/conductor.config.local.js'),
    "export default { base_url:'https://old.test', oauth:{client_secret:'old'}, workspace_id:'old' };",
  );
  const plan = service.planConfig({
    ...w,
    operation: 'check',
    scope: 'project',
  });
  expect(
    plan.report.findings.filter((f) => f.code === 'dead_key').length,
  ).toBeGreaterThanOrEqual(3);
});
it('preserves engine-owned addons without creating a project connection', () => {
  const w = world();
  writeFileSync(
    w.engine,
    connectionText('project-private')
      .replace(
        'schema_version: 3,',
        "project:'demo',conductor_id:'my-worker',addons: [{ use:'@bakers-build/addon-herdr' }, { use:'@bakers-build/addon-remote-drupal' }, { use:'@bakers-build/addon-claude' }],",
      )
      .replace('// @bakers-schema-version 3\n', ''),
  );
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  const engine = readFileSync(w.engine, 'utf8');
  expect(engine).toContain('@bakers-build/addon-herdr');
  expect(engine).toContain('@bakers-build/addon-remote-drupal');
  expect(existsSync(join(w.cwd, '.bakers/bakers.config.js'))).toBe(false);
});
it('consolidates equal credential duplicates and preserves backups without overwriting earlier ones', () => {
  const w = world();
  writeFileSync(
    w.machine,
    readFileSync(w.machine, 'utf8').replace(
      'max_parallel: 2',
      "max_parallel:2, client_secret:'private-value'",
    ),
  );
  writeFileSync(`${w.machine}.bakers.bak`, 'first-backup');
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(readFileSync(`${w.machine}.bakers.bak`, 'utf8')).toBe('first-backup');
  expect(
    readdirSync(dirname(w.machine)).filter((name) => name.endsWith('.bak'))
      .length,
  ).toBeGreaterThan(1);
});
it('keeps disagreeing schema markers unchanged before any write', () => {
  const w = world();
  const before = connectionText().replace(
    'schema_version: 3',
    'schema_version: 2',
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
it('upgrades an old absolute machine import to the portable BB_HOME expression', () => {
  const w = world();
  writeFileSync(
    w.engine,
    `${engineText().replace(
      'export default {',
      `async function loadMachine() {
  try {
    return (await import(\`${w.machine}\`)).default ?? {};
  } catch {}
  return {};
}
const machine = await loadMachine();
export default {`,
    )}`,
  );
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  const migrated = readFileSync(w.engine, 'utf8');
  expect(migrated).toContain('process.env.BB_HOME');
  expect(migrated).not.toContain('file://');
  expect(migrated).not.toContain(w.home);
});
it('re-upgrading an already-portable machine import leaves it portable', () => {
  const w = world();
  writeFileSync(
    w.engine,
    engineText().replace(
      'export default {',
      `async function loadMachine() {
  try {
    return (await import(${configImportExpression('machine.config.js')})).default ?? {};
  } catch {}
  return {};
}
const machine = await loadMachine();
export default {`,
    ),
  );
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  const migrated = readFileSync(w.engine, 'utf8');
  expect(migrated).toContain('process.env.BB_HOME');
  expect(migrated).not.toContain('file://');
  expect(migrated).not.toContain(w.home);
});
it('migrates the legacy machine path into current ownership with no runtime shim', () => {
  const w = world();
  const legacy = join(w.home, '.config/conductor/conductor.config.machine.js');
  mkdirSync(dirname(legacy), { recursive: true });
  writeFileSync(legacy, readFileSync(w.machine, 'utf8'));
  rmSync(w.machine);
  const plan = service.planConfig(w);
  expect(service.applyConfigPlan(plan).result).toBe('ok');
  expect(existsSync(w.machine)).toBe(true);
  expect(existsSync(legacy)).toBe(false);
});
it('refuses a computed home-local credential with its exact source', () => {
  const w = world();
  writeFileSync(
    w.machine,
    `export default {machine_id:'host',user_id:'operator',max_parallel:2,base_url:'https://example.test',client_id:'client',client_secret:'machine-secret',workspace_id:'${workspace}'};`,
  );
  writeFileSync(
    w.connection,
    readFileSync(
      new URL('./fixtures/bb-448/connection-v3.js.txt', import.meta.url),
      'utf8',
    ),
  );
  writeFileSync(
    join(w.home, '.bakers/conductor.config.local.js'),
    'export default { oauth: { client_secret:process.env.CUSTOM_SECRET } };',
  );
  const before = readFileSync(w.connection, 'utf8');
  const plan = service.planConfig(w);
  expect(
    plan.report.findings.some(
      (f) =>
        f.code === 'unknown_value' &&
        f.path === join(w.home, '.bakers/conductor.config.local.js'),
    ),
  ).toBe(true);
  service.applyConfigPlan(plan);
  expect(readFileSync(w.connection, 'utf8')).toBe(before);
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
    "export default {schema_version:1,machine_id:'fixture',user_id:'fixture',max_parallel:1};",
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

// ─── machine 2 → 3: agent harness seeding into addons[] ─────────────────────

describe('machine schema 2→3: agent harness seeding', () => {
  it('seeds agent_addons from conductor addons[] when conductor has agent packages', () => {
    const w = world();
    // Machine at v2: has agents policy but no agent_addons.
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 2\nexport default { schema_version: 2, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { enabled: ['opus'], default_agent: 'opus' } };\n`,
    );
    // Conductor config has agent packages in addons[].
    writeFileSync(
      w.engine,
      `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-claude' }, { use: '@bakers-build/addon-codex' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(plan.report.findings.filter((f) => f.severity === 'error')).toEqual(
      [],
    );
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const text = readFileSync(w.machine, 'utf8');
    expect(text).toMatch(/^\s*addons: \[/m);
    expect(text).not.toMatch(/agents:\s*\{[^}]*addons/);
    expect(text).toContain('@bakers-build/addon-claude');
    expect(text).toContain('@bakers-build/addon-codex');
    expect(text).toContain('// @bakers-schema-version 3');
    // Idempotent: second plan produces no writes.
    expect(service.planConfig({ ...w, scope: 'machine' }).writes).toEqual([]);
  });

  it('machine init writes harnesses to addons', () => {
    const w = world();
    // Machine at v2 with no agents.addons; remove conductor config.
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 2\nexport default { schema_version: 2, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { enabled: ['opus'] } };\n`,
    );
    rmSync(w.engine);
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(plan.report.findings.filter((f) => f.severity === 'error')).toEqual(
      [],
    );
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const text = readFileSync(w.machine, 'utf8');
    expect(text).toMatch(/^\s*addons: \[/m);
    expect(text).not.toMatch(/agents:\s*\{[^}]*addons/);
    expect(text).toContain('@bakers-build/addon-claude');
    expect(text).toContain('@bakers-build/addon-codex');
    expect(text).toContain('@bakers-build/addon-grok');
    expect(text).toContain('// @bakers-schema-version 3');
    // Idempotent.
    expect(service.planConfig({ ...w, scope: 'machine' }).writes).toEqual([]);
  });

  it('biome-formats the written config: nested keys aligned, single-quoted', () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 2\nexport default { schema_version: 2, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { enabled: ['opus'] } };\n`,
    );
    rmSync(w.engine);
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const text = readFileSync(w.machine, 'utf8');
    // biome expands the single-line object; the seeded addons is a top-level
    // key at 2 spaces, single-quoted.
    expect(text).toMatch(/\n {2}addons: \[/);
    expect(text).toContain("'@bakers-build/addon-claude'");
    // The version marker survives the format pass.
    expect(text).toContain('// @bakers-schema-version 3');
  });

  it('moves agents.addons into addons', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { addons: ['@bakers-build/addon-custom'], enabled: ['custom'] } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual(['@bakers-build/addon-custom']);
    expect(machine.agents).toEqual({ enabled: ['custom'] });
    expect(readFileSync(w.machine, 'utf8')).not.toContain(
      '@bakers-build/addon-claude',
    );
    // No second write needed (idempotent).
    expect(service.planConfig({ ...w, scope: 'machine' }).writes).toEqual([]);
  });

  it('dedupes moved agent addons', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-claude'], agents: { addons: ['@bakers-build/addon-claude', { use: '@bakers-build/addon-codex', alias: 'x' }] } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual([
      '@bakers-build/addon-claude',
      { use: '@bakers-build/addon-codex', alias: 'x' },
    ]);
    expect(machine.agents).toBeUndefined();
  });

  it.each([
    [
      'different settings',
      `'@bakers-build/addon-claude'`,
      `{ use: '@bakers-build/addon-claude', with: { model: 'opus' } }`,
    ],
    [
      'a variable alias',
      `'@bakers-build/addon-claude'`,
      `{ use: '@bakers-build/addon-claude', alias: n }`,
    ],
    ['a variable package', `'@bakers-build/addon-claude'`, `{ use: p }`],
    [
      'a listed variable package',
      'p',
      `{ use: '@bakers-build/addon-claude', with: { model: 'x' } }`,
    ],
  ])('leaves an agent addon that differs from a listed one by %s', (_, listed, entry) => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nconst n = 'second', p = '@bakers-build/addon-claude';\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: [${listed}], agents: { addons: [${entry}] } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(plan.writes).toEqual([]);
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'retired_key', key: 'agents.addons' }),
    );
  });

  it('moves a variable agent addon beside a literal one', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nconst codex = '@bakers-build/addon-codex';\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { addons: ['@bakers-build/addon-claude', codex] } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual([
      '@bakers-build/addon-claude',
      '@bakers-build/addon-codex',
    ]);
  });

  it('moves the same variable listed in both arrays once', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nconst c = '@bakers-build/addon-claude';\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: [c], agents: { addons: [c] } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual(['@bakers-build/addon-claude']);
  });

  it('seeds harnesses for an empty agents.addons in one upgrade', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { addons: [] } };\n`,
    );
    rmSync(w.engine);
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual([
      '@bakers-build/addon-claude',
      '@bakers-build/addon-codex',
      '@bakers-build/addon-grok',
    ]);
    expect(service.planConfig({ ...w, scope: 'machine' }).writes).toEqual([]);
  });

  it('seeds harnesses beside first-party non-agent addons', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-essentials'] };\n`,
    );
    rmSync(w.engine);
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toContain('@bakers-build/addon-claude');
  });

  it('keeps every non-literal agent addon it moves', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nconst a = '@bakers-build/addon-claude', b = '@bakers-build/addon-codex';\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-bakers-ui-artifacts'], agents: { addons: [a, { use: b }] } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual([
      '@bakers-build/addon-bakers-ui-artifacts',
      '@bakers-build/addon-claude',
      { use: '@bakers-build/addon-codex' },
    ]);
    expect(machine.agents).toBeUndefined();
  });

  it('seeds harnesses when the machine lists only non-agent addons', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-bakers-ui-artifacts'] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual([
      '@bakers-build/addon-bakers-ui-artifacts',
      '@bakers-build/addon-claude',
      '@bakers-build/addon-codex',
      '@bakers-build/addon-grok',
    ]);
    expect(service.planConfig({ ...w, scope: 'machine' }).writes).toEqual([]);
  });

  it('seeds harnesses beside the ports addon and its transport', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: [{ use: '@bakers-build/addon-ports', with: {} }, { use: '@bakers-build/addon-ports-cloudflare' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons.slice(2)).toEqual([
      '@bakers-build/addon-claude',
      '@bakers-build/addon-codex',
      '@bakers-build/addon-grok',
    ]);
  });

  it('seeds nothing beside a third-party harness', () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@acme/bakers-agent'] };\n`,
    );
    expect(service.planConfig({ ...w, scope: 'machine' }).writes).toEqual([]);
  });

  it('moves ports into the ports addon entry', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-claude'], ports: { transport: { use: '@bakers-build/ports-cloudflare-quick' } } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.ports).toBeUndefined();
    expect(machine.addons).toEqual([
      '@bakers-build/addon-claude',
      {
        use: '@bakers-build/addon-ports',
        with: { transport: { use: '@bakers-build/ports-cloudflare-quick' } },
      },
    ]);
  });

  it('merges ports into an existing ports entry without a transport', async () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-claude', '@bakers-build/addon-ports'], ports: { transport: { use: 'q' } } };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const machine = await importMachine(w.machine);
    expect(machine.addons).toEqual([
      '@bakers-build/addon-claude',
      { use: '@bakers-build/addon-ports', with: { transport: { use: 'q' } } },
    ]);
  });

  it('leaves a machine addons list with a spread untouched', () => {
    const w = world();
    const original = `// @bakers-schema-version 3\nconst shared = ['@bakers-build/addon-pi'];\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: [...shared, '@bakers-build/addon-codex'], agents: { addons: ['@bakers-build/addon-claude'] }, ports: { transport: { use: 'q' } } };\n`;
    writeFileSync(w.machine, original);
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(plan.writes).toEqual([]);
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'retired_key', key: 'agents.addons' }),
    );
  });

  it('leaves an opaque ports block', () => {
    const w = world();
    const original = `// @bakers-schema-version 3\nexport default { schema_version: 3, machine_id: 'host', user_id: 'operator', max_parallel: 2, addons: ['@bakers-build/addon-claude'], ports: process.env.PORTS };\n`;
    writeFileSync(w.machine, original);
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(plan.writes).toEqual([]);
    expect(plan.report.findings).toContainEqual(
      expect.objectContaining({ code: 'retired_key', key: 'ports' }),
    );
  });

  it('filters non-agent packages from conductor addons[] when seeding agents.addons', () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 2\nexport default { schema_version: 2, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { enabled: ['opus'] } };\n`,
    );
    // addons[] has both a non-agent (remote-drupal) and an agent (addon-claude).
    writeFileSync(
      w.engine,
      `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-remote-drupal' }, { use: '@bakers-build/addon-claude' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'machine' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const text = readFileSync(w.machine, 'utf8');
    expect(text).toContain('@bakers-build/addon-claude');
    // Remote-drupal is not an agent package; should not appear in agents.addons.
    expect(text).not.toContain('@bakers-build/addon-remote-drupal');
  });
});

// ─── conductor scope: agent-addon removal ───────────────────────────────────

describe('conductor scope: strip agent addons from addons[]', () => {
  it('removes agent-addon entries from conductor addons[], keeping remote/executor/workspace', () => {
    const w = world();
    writeFileSync(
      w.engine,
      `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-herdr' }, { use: '@bakers-build/addon-claude' }, { use: '@bakers-build/addon-codex' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'conductor' });
    expect(plan.report.findings.filter((f) => f.severity === 'error')).toEqual(
      [],
    );
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const text = readFileSync(w.engine, 'utf8');
    // Agent packages removed.
    expect(text).not.toContain('@bakers-build/addon-claude');
    expect(text).not.toContain('@bakers-build/addon-codex');
    // Non-agent executor package kept.
    expect(text).toContain('@bakers-build/addon-herdr');
    // Idempotent.
    expect(service.planConfig({ ...w, scope: 'conductor' }).writes).toEqual([]);
  });

  it('removes the addons key entirely when all entries are agent addons', () => {
    const w = world();
    writeFileSync(
      w.engine,
      `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-claude' }, { use: '@bakers-build/addon-codex' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'conductor' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    const text = readFileSync(w.engine, 'utf8');
    expect(text).not.toContain('@bakers-build/addon-claude');
    expect(text).not.toContain('@bakers-build/addon-codex');
    // No dangling addons key with an empty array.
    expect(text).not.toMatch(/\baddons\s*:/);
    // Idempotent.
    expect(service.planConfig({ ...w, scope: 'conductor' }).writes).toEqual([]);
  });

  it('does not touch conductor addons[] when there are no agent entries', () => {
    const w = world();
    const original = `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-herdr' }] };\n`;
    writeFileSync(w.engine, original);
    const plan = service.planConfig({ ...w, scope: 'conductor' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    // No agent packages, no change needed.
    expect(service.planConfig({ ...w, scope: 'conductor' }).writes).toEqual([]);
  });

  it('conductor scope stamps schema version 1', () => {
    const w = world();
    writeFileSync(
      w.engine,
      `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-claude' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'conductor' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    expect(readFileSync(w.engine, 'utf8')).toContain(
      '// @bakers-schema-version 1',
    );
  });

  it('scope all runs both machine and conductor migrations', () => {
    const w = world();
    writeFileSync(
      w.machine,
      `// @bakers-schema-version 2\nexport default { schema_version: 2, machine_id: 'host', user_id: 'operator', max_parallel: 2, agents: { enabled: ['opus'] } };\n`,
    );
    writeFileSync(
      w.engine,
      `export default { bakers: { project: 'demo' }, conductor_id: 'my-worker', remote: { plugin: '@bakers-build/addon-remote-drupal' }, executor: { plugin: '@bakers-build/addon-herdr' }, workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' }, addons: [{ use: '@bakers-build/addon-claude' }, { use: '@bakers-build/addon-codex' }] };\n`,
    );
    const plan = service.planConfig({ ...w, scope: 'all' });
    expect(service.applyConfigPlan(plan).result).toBe('ok');
    expect(readFileSync(w.machine, 'utf8')).toMatch(/^\s*addons: \[/m);
    expect(readFileSync(w.engine, 'utf8')).not.toContain(
      '@bakers-build/addon-claude',
    );
  });
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
