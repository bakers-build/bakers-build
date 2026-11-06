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
  remote: slot('remote'),
  executor: slot('executor'),
  workspace: slot('workspace'),${addons ? `\n  addons: [${addons}],` : ''}
  bakers: { project: 'bakers' },
};
`;

function writeMachine(body: string): string {
  const home = mkdtempSync(join(tmpdir(), 'bakers-scope-home-'));
  mkdirSync(join(home, '.bakers'));
  writeFileSync(join(home, '.bakers/machine.config.js'), body);
  vi.stubEnv('HOME', home);
  return join(home, '.bakers/machine.config.js');
}

function writeProject(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bakers-scope-project-'));
  const file = join(dir, 'conductor.config.js');
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
    expect(scopeWarn[0]).toContain('.bakers/conductor.config.js');
  });

  it('agents.addons throws the retired-key remediation', async () => {
    writeMachine(
      `export default { agents: { addons: ['@bakers-build/addon-codex'] } };`,
    );
    await expect(
      loadConductorConfig(writeProject(projectConfig())),
    ).rejects.toThrow(
      'machine agents.addons is retired: move its entries into machine.config.js addons[]',
    );
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

describe('shared run security from the machine and project config', () => {
  const projectWithSecurity = (security: string) =>
    projectConfig().replace(
      "bakers: { project: 'bakers' },",
      `bakers: { project: 'bakers' },\n  security: ${security},`,
    );

  it('every harness gets both layers, with sources and warnings', async () => {
    writeMachine(`export default {
      addons: ['@bakers-build/addon-claude', '@bakers-build/addon-codex'],
      security: { sandbox: { allow_write: ['$inherit', '/srv/cache'] } },
    };`);
    const project = writeProject(
      projectWithSecurity(
        "{ sandbox: { trusted_commands: ['$inherit', 'make'], deny_read: ['$inherit', '~/.aws'] } }",
      ),
    );
    const { warnings, result } = await captureWarnings(() =>
      loadConductorConfig(project),
    );
    const security = (alias: string) =>
      result.agents.find((c) => c.alias === alias)?.agent.security;
    expect(security('opus')?.sandbox.trusted_commands.entries).toContainEqual({
      value: 'make',
      source: 'project',
    });
    expect(security('opus')?.sandbox.allow_write.entries).toEqual([
      { value: '/srv/cache', source: 'machine' },
    ]);
    expect(security('codex')?.not_applied).toContainEqual({
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
      expect.stringContaining('codex: project security.sandbox.deny_read'),
      expect.stringContaining(
        'codex: project security.sandbox.trusted_commands',
      ),
    ]);
  });

  it('warns once per project loosening of mode, lists and default reads', async () => {
    writeMachine(`export default { addons: ['@bakers-build/addon-codex'] };`);
    const { warnings } = await captureWarnings(() =>
      loadConductorConfig(
        writeProject(
          projectWithSecurity(
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
          projectWithSecurity(
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
      security: { sandbox: { network: [] } },
    };`);
    await expect(
      loadConductorConfig(writeProject(projectConfig())),
    ).rejects.toThrow(
      `${machine}: machine security.sandbox: unknown key network`,
    );
  });
});
