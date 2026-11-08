import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { agents } from '../src/preset.js';

function launchArgv(command: string): string[] {
  return execFileSync(
    'bash',
    ['-c', `claude() { printf '%s\\0' "$@"; }; ${command}`],
    { encoding: 'utf8' },
  )
    .split('\0')
    .slice(0, -1);
}

describe('Claude catalog', () => {
  it('offers reasoning and implementation variants with their bound models', async () => {
    const candidates = await agents([], undefined);
    expect(candidates.map(({ alias, model }) => ({ alias, model }))).toEqual([
      { alias: 'opus', model: 'opus' },
      { alias: 'sonnet', model: 'sonnet' },
      { alias: 'fable', model: 'fable' },
    ]);
    expect(candidates.every((c) => Boolean(c.description))).toBe(true);
  });

  it('carries options and the default sandbox into the Fable launch', async () => {
    const candidates = await agents([], {
      effort: 'high',
      args: ['--verbose'],
      env_deny: ['SECRET_*'],
    });
    const agent = await candidates
      .find((c) => c.alias === 'fable')!
      .agent.createAgent({} as never);
    const argv = launchArgv(agent.launchCommand('task'));

    expect(agent.id).toBe('claude');
    expect(argv.slice(0, 5)).toEqual([
      'task',
      '--model',
      'fable',
      '--effort',
      'high',
    ]);
    expect(argv).toContain('--verbose');
    expect(argv.filter((arg) => arg === '--model')).toHaveLength(1);
    expect(JSON.parse(argv[argv.indexOf('--settings') + 1])).toMatchObject({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
      },
    });
    expect(agent.runEnvPolicy).toEqual({ drop: true, deny: ['SECRET_*'] });
  });

  it.each([
    ['--model', 'custom-model'],
    ['--model=custom-model'],
  ])('lets explicit args %j override the Fable model', async (...args) => {
    const candidates = await agents([], { args, security: 'system' });
    const agent = await candidates
      .find((c) => c.alias === 'fable')!
      .agent.createAgent({} as never);
    expect(launchArgv(agent.launchCommand('task'))).toEqual(['task', ...args]);
  });
});
