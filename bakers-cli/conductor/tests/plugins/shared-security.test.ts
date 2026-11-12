import { describe, expect, it } from 'vitest';
import {
  resolveSecurityOptions,
  type SandboxOptions,
} from '../../src/plugins/agent-args.js';

// Run permissions are layered: harness default → project → machine → agent entry.
// A layer that sets a key replaces the one below; '$inherit' inserts it.

const DEFAULTS: Required<SandboxOptions> = {
  trusted_commands: ['bakers', 'git'],
  deny_read: ['~/.ssh', '~/.bakers'],
  allow_write: [],
  network: ['*'],
  mcp_servers: {},
};

const resolve = (
  input: Record<string, unknown>,
  unsupported?: ('deny_read' | 'trusted_commands' | 'allow_write')[],
) =>
  resolveSecurityOptions(
    input,
    DEFAULTS,
    unsupported ? { unsupported } : undefined,
  );

describe('shared run permissions layers', () => {
  it('a project list with $inherit adds to the harness default', () => {
    const r = resolve({
      permissions: 'sandbox',
      shared_permissions: {
        project: { sandbox: { trusted_commands: ['$inherit', 'make'] } },
      },
    });
    expect(r.sandbox.trusted_commands).toEqual(['bakers', 'git', 'make']);
    expect(r.report.sandbox.trusted_commands.entries).toEqual([
      { value: 'bakers', source: 'default' },
      { value: 'git', source: 'default' },
      { value: 'make', source: 'project' },
    ]);
  });

  it('the machine replaces the project, and [] vetoes its grant', () => {
    const r = resolve({
      permissions: 'sandbox',
      shared_permissions: {
        project: { sandbox: { trusted_commands: ['$inherit', 'make'] } },
        machine: { sandbox: { trusted_commands: [] } },
      },
    });
    expect(r.sandbox.trusted_commands).toEqual([]);
    expect(r.report.sandbox.trusted_commands.removed).toEqual([
      'bakers',
      'git',
    ]);
  });

  it('machine $inherit keeps the project grant; duplicates are dropped', () => {
    const r = resolve({
      permissions: 'sandbox',
      shared_permissions: {
        project: { sandbox: { allow_write: ['~/.designbook'] } },
        machine: { sandbox: { allow_write: ['$inherit', '~/.designbook'] } },
      },
    });
    expect(r.report.sandbox.allow_write.entries).toEqual([
      { value: '~/.designbook', source: 'project' },
    ]);
  });

  it('an entry list without $inherit replaces every shared layer', () => {
    const r = resolve({
      permissions: 'sandbox',
      shared_permissions: { machine: { sandbox: { deny_read: ['~/.aws'] } } },
      sandbox: { deny_read: ['~/.gnupg'] },
    });
    expect(r.sandbox.deny_read).toEqual(['~/.gnupg']);
  });

  it('an entry list with $inherit adds to the machine layer', () => {
    const r = resolve({
      permissions: 'sandbox',
      shared_permissions: {
        machine: { sandbox: { deny_read: ['$inherit', '~/.aws'] } },
      },
      sandbox: { deny_read: ['$inherit', '~/.gnupg'] },
    });
    expect(r.report.sandbox.deny_read.entries).toEqual([
      { value: '~/.ssh', source: 'default' },
      { value: '~/.bakers', source: 'default' },
      { value: '~/.aws', source: 'machine' },
      { value: '~/.gnupg', source: 'agent' },
    ]);
  });

  it('mode: entry over machine over project over the system default', () => {
    const layers = {
      project: { mode: 'yolo' },
      machine: { mode: 'system' },
    };
    expect(resolve({ shared_permissions: layers }).report.mode).toEqual({
      value: 'system',
      source: 'machine',
    });
    expect(
      resolve({ shared_permissions: { project: { mode: 'yolo' } } }).mode,
    ).toBe('yolo');
    expect(
      resolve({ shared_permissions: layers, permissions: 'sandbox' }).report
        .mode,
    ).toEqual({ value: 'sandbox', source: 'agent' });
    expect(resolve({}).report.mode).toEqual({
      value: 'system',
      source: 'default',
    });
  });

  it('shared lists are not applied outside the sandbox mode', () => {
    const r = resolve({
      shared_permissions: { project: { sandbox: { allow_write: ['~/.x'] } } },
      permissions: 'system',
    });
    expect(r.sandbox.allow_write).toEqual([]);
    expect(r.report.not_applied).toEqual([
      { key: 'allow_write', source: 'project', reason: 'mode' },
    ]);
  });

  it('a shared key the harness cannot express is not applied', () => {
    const r = resolve(
      {
        permissions: 'sandbox',
        shared_permissions: {
          machine: {
            sandbox: { deny_read: ['~/.aws'], allow_write: ['~/.y'] },
          },
        },
      },
      ['deny_read', 'trusted_commands'],
    );
    expect(r.sandbox.deny_read).toEqual(['~/.ssh', '~/.bakers']);
    expect(r.sandbox.allow_write).toEqual(['~/.y']);
    expect(r.report.not_applied).toEqual([
      { key: 'deny_read', source: 'machine', reason: 'unsupported' },
    ]);
  });

  it('rejects keys and modes the shared block does not take', () => {
    expect(() =>
      resolve({
        shared_permissions: { project: { sandbox: { network: ['x.org'] } } },
      }),
    ).toThrow(/project permissions\.sandbox: unknown key network/);
    expect(() =>
      resolve({ shared_permissions: { machine: { mode: 'custom' } } }),
    ).toThrow(/machine permissions\.mode must be one of sandbox, system, yolo/);
    expect(() =>
      resolve({ shared_permissions: { machine: { env_deny: [] } } }),
    ).toThrow(/machine permissions: unknown key env_deny/);
  });

  it('rejects the renamed key security and names permissions', () => {
    expect(() => resolve({ security: 'sandbox' })).toThrow(
      'security was renamed: use permissions',
    );
    expect(() => resolve({ skip_permissions: true })).toThrow(
      "use permissions: 'yolo'",
    );
  });

  it('without shared layers the entry behaves as before', () => {
    const r = resolve({
      permissions: 'sandbox',
      sandbox: { trusted_commands: ['$inherit', 'make'] },
    });
    expect(r.sandbox.trusted_commands).toEqual(['bakers', 'git', 'make']);
    expect(resolve({ permissions: 'sandbox' }).sandbox).toEqual(DEFAULTS);
  });
});
