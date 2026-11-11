import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConductorConfig } from '../src/config.js';

// One addons[] per scope: the machine and the project conductor config are
// read the same way, and each addon declares where it may be listed.

const projectConfig = (addons = '') => `
const slot = (kind) => ({ kind, id: kind, requiredModules: [] });
export default {
  server: slot('server'),
  executor: slot('executor'),
  worktree: slot('worktree'),${addons ? `\n  addons: [${addons}],` : ''}
  project: { name: 'bakers' },
};
`;

function writeMachine(body: string): string {
  const home = mkdtempSync(join(tmpdir(), 'bakers-scope-home-'));
  mkdirSync(join(home, '.bakers'));
  // Every machine file names itself; the schema requires both keys.
  writeFileSync(
    join(home, '.bakers/machine.config.js'),
    body.replace(
      'export default {',
      "export default { machine_id: 'm1', label: 'M1',",
    ),
  );
  vi.stubEnv('HOME', home);
  return join(home, '.bakers/machine.config.js');
}

function writeProject(content: string): string {
  const dir = join(
    mkdtempSync(join(tmpdir(), 'bakers-scope-project-')),
    '.bakers',
  );
  mkdirSync(dir);
  const file = join(dir, 'project.config.js');
  writeFileSync(file, content);
  return file;
}

async function captureWarnings<T>(
  fn: () => Promise<T>,
): Promise<{ warnings: string[]; result: T }> {
  const warnings: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...a) => {
    warnings.push(a.join(' '));
  });
  try {
    return { warnings, result: await fn() };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.unstubAllEnvs());

describe('conductor addons per scope', () => {
  it('loads Tailscale only from the machine scope', async () => {
    const entry = `{ use: '@bakers-build/addon-tailscale', with: { ssh_user: 'christian' } }`;
    writeMachine(
      `export default { addons: ['@bakers-build/addon-codex', ${entry}] };`,
    );
    const config = await loadConductorConfig(writeProject(projectConfig()));
    expect(
      config.hookListeners?.some(
        (hook) => typeof hook.before_conductor_start === 'function',
      ),
    ).toBe(true);
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const { warnings, result } = await captureWarnings(() =>
      loadConductorConfig(writeProject(projectConfig(entry))),
    );
    expect(result.hookListeners ?? []).toEqual([]);
    expect(
      warnings.some(
        (warning) =>
          warning.includes('addon-tailscale') && warning.includes('not loaded'),
      ),
    ).toBe(true);
  });

  it('agent harness from machine addons[] becomes a candidate', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const cfg = await loadConductorConfig(writeProject(projectConfig()));
    expect(cfg.agents.map((c) => c.alias)).toContain('codex');
  });

  it('agent harness in a project addons[] is reported and not loaded', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const project = writeProject(projectConfig("'@bakers-build/addon-grok'"));
    const { warnings, result } = await captureWarnings(() =>
      loadConductorConfig(project),
    );
    expect(result.agents.map((c) => c.alias)).not.toContain('grok');
    const scopeWarn = warnings.filter((w) =>
      w.includes("'@bakers-build/addon-grok' is not loaded"),
    );
    expect(scopeWarn).toHaveLength(1);
    expect(scopeWarn[0]).toContain(project);
    expect(scopeWarn[0]).toContain('~/.bakers/machine.config.js');
  });

  it('herdr in machine addons[] is reported and not loaded', async () => {
    const machine = writeMachine(
      `export default { addons: ['@bakers-build/addon-codex', '@bakers-build/addon-herdr'] };`,
    );
    const { warnings, result } = await captureWarnings(() =>
      loadConductorConfig(writeProject(projectConfig())),
    );
    expect(result.hookListeners ?? []).toEqual([]);
    const scopeWarn = warnings.filter((w) =>
      w.includes("'@bakers-build/addon-herdr' is not loaded"),
    );
    expect(scopeWarn).toHaveLength(1);
    expect(scopeWarn[0]).toContain(machine);
    expect(scopeWarn[0]).toContain('.bakers/project.config.js');
  });

  it('the machine executor overrides the project executor', async () => {
    writeMachine(
      `export default { addons: ['@bakers-build/addon-codex'], executor: { kind: 'executor', id: 'herdr-core', requiredModules: [] } };`,
    );
    const cfg = await loadConductorConfig(writeProject(projectConfig()));
    expect(cfg.executor.id).toBe('herdr-core');
    // Workspace and remote stay project-owned.
    expect(cfg.workspace.id).toBe('worktree');
    expect(cfg.remote.id).toBe('server');
  });

  it('without a machine executor the project executor stays', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const cfg = await loadConductorConfig(writeProject(projectConfig()));
    expect(cfg.executor.id).toBe('executor');
  });

  it('a machine executor descriptor resolves the named addon', async () => {
    writeMachine(
      `export default { addons: ['@bakers-build/addon-codex'], executor: { use: '@bakers-build/addon-orca' } };`,
    );
    const cfg = await loadConductorConfig(writeProject(projectConfig()));
    expect(cfg.executor.id).toBe('orca');
  });

  it('a project on herdr runs herdr-core on a machine that sets it', async () => {
    writeMachine(
      `export default { addons: ['@bakers-build/addon-codex'], executor: { use: '@bakers-build/addon-herdr-core' } };`,
    );
    const project = writeProject(
      projectConfig().replace(
        "executor: slot('executor'),",
        "executor: { use: '@bakers-build/addon-herdr' },",
      ),
    );
    const cfg = await loadConductorConfig(project);
    expect(cfg.executor.id).toBe('herdr-core');
  });

  it('agents.addons is an unknown key', async () => {
    writeMachine(
      `export default { agents: { addons: ['@bakers-build/addon-codex'] } };`,
    );
    await expect(
      loadConductorConfig(writeProject(projectConfig())),
    ).rejects.toThrow('agents.addons unknown key');
  });

  it('catalog harness must be in machine addons[]', async () => {
    writeMachine(`export default {
      addons: ['@bakers-build/addon-codex'],
      agents: { catalog: [{ harness: '@bakers-build/addon-pi', alias: 'pi' }] },
    };`);
    await expect(
      loadConductorConfig(writeProject(projectConfig())),
    ).rejects.toThrow(
      "agents.catalog[0] harness '@bakers-build/addon-pi' must also appear in machine.config.js addons[]",
    );
  });
});

describe('shared run permissions from the machine and project config', () => {
  const projectWithPermissions = (permissions: string) =>
    projectConfig().replace(
      "project: { name: 'bakers' },",
      `project: { name: 'bakers' },\n  permissions: ${permissions},`,
    );

  it('every harness gets both layers, with sources and warnings', async () => {
    writeMachine(`export default {
      addons: ['@bakers-build/addon-claude', '@bakers-build/addon-codex'],
      permissions: { mode: 'sandbox', sandbox: { allow_write: ['$inherit', '/srv/cache'] } },
    };`);
    const project = writeProject(
      projectWithPermissions(
        "{ sandbox: { trusted_commands: ['$inherit', 'make'], deny_read: ['$inherit', '~/.aws'] } }",
      ),
    );
    const { warnings, result } = await captureWarnings(() =>
      loadConductorConfig(project),
    );
    const permissions = (alias: string) =>
      result.agents.find((c) => c.alias === alias)?.agent.permissions;
    expect(
      permissions('opus')?.sandbox.trusted_commands.entries,
    ).toContainEqual({
      value: 'make',
      source: 'project',
    });
    expect(permissions('opus')?.sandbox.allow_write.entries).toEqual([
      { value: '/srv/cache', source: 'machine' },
    ]);
    expect(permissions('codex')?.not_applied).toContainEqual({
      key: 'trusted_commands',
      source: 'project',
      reason: 'unsupported',
    });
    const loosening = warnings.filter((w) => w.includes('loosens'));
    expect(loosening).toHaveLength(1);
    expect(loosening[0]).toContain('trusted_commands');
    expect(loosening[0]).toContain('make');
    expect(loosening[0]).toContain(project);
    const skipped = warnings.filter((w) => w.includes('not applied'));
    expect(skipped).toEqual([
      expect.stringContaining('codex: project permissions.sandbox.deny_read'),
      expect.stringContaining(
        'codex: project permissions.sandbox.trusted_commands',
      ),
    ]);
  });

  it('warns once per project loosening of mode, lists and default reads', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const { warnings } = await captureWarnings(() =>
      loadConductorConfig(
        writeProject(
          projectWithPermissions(
            "{ mode: 'yolo', sandbox: { allow_write: ['/x'], deny_read: [] } }",
          ),
        ),
      ),
    );
    const loosening = warnings.filter((w) => w.includes('loosens'));
    expect(loosening).toHaveLength(3);
    expect(loosening.join('\n')).toMatch(/mode 'yolo'/);
    expect(loosening.join('\n')).toMatch(/allow_write/);
    expect(loosening.join('\n')).toMatch(/deny_read.*without '\$inherit'/);
  });

  it('a project that only adds read denials is not a loosening', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-claude'] };`);
    const { warnings } = await captureWarnings(() =>
      loadConductorConfig(
        writeProject(
          projectWithPermissions(
            "{ sandbox: { deny_read: ['$inherit', '~/.aws'] } }",
          ),
        ),
      ),
    );
    expect(warnings.filter((w) => w.includes('loosens'))).toEqual([]);
  });

  it('a malformed shared block fails loading and names its file', async () => {
    const machine = writeMachine(`export default {
      addons: ['@bakers-build/addon-codex'],
      permissions: { sandbox: { network: [] } },
    };`);
    await expect(
      loadConductorConfig(writeProject(projectConfig())),
    ).rejects.toThrow(`${machine}: permissions.sandbox.network unknown key`);
  });

  it('the old key security fails loading in the project and machine config', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const project = writeProject(
      projectConfig().replace(
        "project: { name: 'bakers' },",
        "project: { name: 'bakers' },\n  security: { mode: 'sandbox' },",
      ),
    );
    await expect(loadConductorConfig(project)).rejects.toThrow(
      `${project}: security unknown key`,
    );
    const machine = writeMachine(`export default {
      addons: ['@bakers-build/addon-codex'],
      security: { mode: 'sandbox' },
    };`);
    await expect(
      loadConductorConfig(writeProject(projectConfig())),
    ).rejects.toThrow(`${machine}: security unknown key`);
  });
});

describe('restart_on_change and the watched files', () => {
  it('defaults restart_on_change to true and watches what was loaded', async () => {
    const machine = writeMachine(
      `export default { addons: ['@bakers-build/addon-codex'] };`,
    );
    const project = writeProject(projectConfig());
    const cfg = await loadConductorConfig(project);
    const dir = join(project, '..');

    expect(cfg.restart_on_change).toBe(true);
    expect(cfg.watch_paths?.files).toEqual([project, machine]);
    // The directory of the resolved addon module, not the package name.
    expect(cfg.watch_paths?.dirs).toHaveLength(1);
    expect(cfg.watch_paths?.dirs[0]).toMatch(/codex.*[/\\](dist|src)$/);
  });

  it('honours restart_on_change: false', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const cfg = await loadConductorConfig(
      writeProject(
        projectConfig().replace(
          'project:',
          'restart_on_change: false,\n  project:',
        ),
      ),
    );
    expect(cfg.restart_on_change).toBe(false);
  });

  it('rejects a restart_on_change that is not a boolean', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    await expect(
      loadConductorConfig(
        writeProject(
          projectConfig().replace(
            'project:',
            "restart_on_change: 'no',\n  project:",
          ),
        ),
      ),
    ).rejects.toThrow(/restart_on_change must be boolean/);
  });
});

describe('the runtime slot', () => {
  const runtimePreset = (isolates: boolean) => `
export const scopes = ['machine'];
export const runtimes = (acc) => [...acc, {
  kind: 'runtime', id: 'probe', isolates: ${isolates}, requiredModules: [],
  createRuntime: async () => ({ id: 'probe', wrap: async (l) => l, cleanup: async () => {} }),
}];
`;
  const withRuntime = (isolates: boolean) => {
    const machine = writeMachine(
      `export default { permissions: { mode: 'sandbox' }, addons: ['@bakers-build/addon-claude', './runtime-probe.js'] };`,
    );
    writeFileSync(
      join(machine, '../runtime-probe.js'),
      runtimePreset(isolates),
    );
  };

  it('an isolating runtime reaches the config and switches the sandbox off', async () => {
    withRuntime(true);
    const cfg = await loadConductorConfig(writeProject(projectConfig()));
    expect(cfg.runtime?.id).toBe('probe');
    const claude = cfg.agents.find((c) => c.agent.id === 'claude');
    expect(claude?.agent.permissions?.mode.value).toBe('system');
  });

  it('without a runtime addon the shared sandbox stays', async () => {
    writeMachine(
      `export default { permissions: { mode: 'sandbox' }, addons: ['@bakers-build/addon-claude'] };`,
    );
    const cfg = await loadConductorConfig(writeProject(projectConfig()));
    expect(cfg.runtime).toBeUndefined();
    const claude = cfg.agents.find((c) => c.agent.id === 'claude');
    expect(claude?.agent.permissions?.mode.value).toBe('sandbox');
  });
});
