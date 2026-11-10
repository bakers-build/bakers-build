import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStartHooks } from '../../src/core/start-hooks.js';
import type { MachineRegistrationData, ConductorStartContext } from '../../src/plugins/executor.js';

const context = { id: 'c1', project: 'p1', variant: 'conductor' };
const baseline = { host_key: 'host', machine_label: 'Host' };
describe('start hooks', () => {
  afterEach(() => vi.useRealTimers());
  it('shares one mutable object in order and detaches the committed result', async () => {
    let shared: MachineRegistrationData | undefined;
    const result = await runStartHooks([
      { before_conductor_start(machine, conductor) { shared = machine; expect(conductor).toEqual(context); machine.connection_url = 'ssh://user@host:22'; } },
      { before_conductor_start(machine) { expect(machine).toBe(shared); expect(machine.connection_url).toBe('ssh://user@host:22'); machine.machine_label = 'Changed'; } },
    ], { ...baseline }, context, vi.fn());
    expect(result).toEqual({ ...baseline, machine_label: 'Changed', connection_url: 'ssh://user@host:22' });
    shared!.connection_url = null;
    expect(result.connection_url).toBe('ssh://user@host:22');
  });
  it.each([
    (m: MachineRegistrationData) => { m.host_key = 'other'; },
    (m: MachineRegistrationData) => { Object.assign(m, { password: 'secret' }); },
    (m: MachineRegistrationData) => { m.connection_url = 'javascript:alert(1)'; },
    (m: MachineRegistrationData) => { m.machine_label = ''; },
    (_m: MachineRegistrationData, c: Readonly<ConductorStartContext>) => { Object.assign(c, { id: 'other' }); },
    () => { throw new Error('secret'); },
  ])('rolls back the entire dispatch on unsafe mutation or failure', async (bad) => {
    const later = vi.fn(); const warn = vi.fn();
    const result = await runStartHooks([
      { before_conductor_start(m) { m.connection_url = 'ssh://host'; } },
      { before_conductor_start: bad }, { before_conductor_start: later },
    ], { ...baseline }, context, warn);
    expect(result).toEqual(baseline); expect(later).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce(); expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(context.id).toBe('c1');
  });
  it.each([null, 'https://manual.example'])('preserves authoritative manual value %s', async (connection_url) => {
    const input = { ...baseline, connection_url };
    expect(await runStartHooks([{ before_conductor_start(m) { m.connection_url = 'ssh://discovered'; } }], input, context, vi.fn())).toEqual(input);
  });
  it('omits invalid manual URL and skips discovery', async () => {
    const hook = vi.fn();
    expect(await runStartHooks([{ before_conductor_start: hook }], { ...baseline, connection_url: 'bad' }, context, vi.fn())).toEqual(baseline);
    expect(hook).not.toHaveBeenCalled();
  });
  it('bounds the whole chain and discards late changes without running later hooks', async () => {
    vi.useFakeTimers(); let finish!: () => void; const later = vi.fn();
    const promise = runStartHooks([
      { async before_conductor_start(m) { m.machine_label = 'Partial'; await new Promise<void>((r) => { finish = r; }); m.connection_url = null; } },
      { before_conductor_start: later },
    ], { ...baseline }, context, vi.fn());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise; expect(result).toEqual(baseline);
    finish(); await vi.runAllTimersAsync();
    expect(result).toEqual(baseline); expect(later).not.toHaveBeenCalled();
  });
});
