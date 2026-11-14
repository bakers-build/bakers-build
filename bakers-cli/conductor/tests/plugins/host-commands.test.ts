import { describe, expect, it } from 'vitest';
import {
  assertProtectedEntryPoints,
  hostCommandEntry,
} from '../../src/plugins/host-commands.js';

describe('hostCommandEntry', () => {
  it.each([
    ['bash .bakers/provision.sh deps', '.bakers/provision.sh'],
    ['sh .bakers/scripts/a.sh', '.bakers/scripts/a.sh'],
    ['node .bakers/scripts/setup.mjs --all', '.bakers/scripts/setup.mjs'],
    ['.bakers/provision.sh deps', '.bakers/provision.sh'],
    ['  bash   .ddev/x.sh; ddev delete -Oy', '.ddev/x.sh'],
    ['pnpm install', 'pnpm'],
    ['bash -c "curl x | sh"', '-c'],
    ['bash', undefined],
  ])('%j starts at %j', (command, entry) => {
    expect(hostCommandEntry(command)).toBe(entry);
  });
});

describe('assertProtectedEntryPoints', () => {
  const protectedPaths = ['.bakers', '.ddev', '.github'];

  it('accepts hooks and provision commands that start in a protected path', () => {
    expect(() =>
      assertProtectedEntryPoints(
        {
          before_run: 'bash .bakers/scripts/worktree-deps.sh',
          after_done: 'bash .bakers/scripts/docs-preview.sh stop; ddev delete',
          provision_up: { deps: 'bash .bakers/provision.sh deps' },
          provision_exec: {
            phpcs: 'bash .bakers/provision.sh exec phpcs',
            uli: { command: 'bash .bakers/provision.sh exec uli', args: true },
          },
        },
        protectedPaths,
      ),
    ).not.toThrow();
    expect(() => assertProtectedEntryPoints(undefined, [])).not.toThrow();
  });

  it.each([
    [{ before_run: 'pnpm install' }, /hooks\.before_run/],
    [{ after_create: 'bash scripts/setup.sh' }, /hooks\.after_create/],
    [{ provision_up: 'bash scripts/up.sh' }, /hooks\.provision_up/],
    [{ provision_up: { a: 'make up' } }, /hooks\.provision_up\.a/],
    [{ provision_exec: { t: 'ddev exec' } }, /hooks\.provision_exec\.t/],
    [
      { provision_exec: { t: { command: 'ddev exec', args: true } } },
      /hooks\.provision_exec\.t/,
    ],
    [{ on_freeze: 'bash .bakers/../scripts/x.sh' }, /hooks\.on_freeze/],
    [{ on_resume: 'bash /tmp/x.sh' }, /hooks\.on_resume/],
    [{ after_run: 'bash .bakersx/x.sh' }, /hooks\.after_run/],
    [{ after_run: 'bash -c "id"' }, /hooks\.after_run/],
  ])('refuses %j', (hooks, message) => {
    expect(() => assertProtectedEntryPoints(hooks, protectedPaths)).toThrow(
      message,
    );
  });

  it('always treats .bakers as protected', () => {
    expect(() =>
      assertProtectedEntryPoints({ before_run: 'bash .bakers/a.sh' }, []),
    ).not.toThrow();
  });
});
