import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tailscaleHook } from '../src/index.js';
import type { MachineRegistrationData } from '../../../conductor/src/plugins/executor.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const context = { id: 'c', project: 'p', variant: 'conductor' };
function output(stdout: string, error: Error | null = null) {
  vi.mocked(execFile).mockImplementation((_file, _args, _options, callback: any) => {
    callback(error, stdout, ''); return {} as any;
  });
}
afterEach(() => vi.restoreAllMocks());
describe('Tailscale start discovery', () => {
  it.each([22, 2222])('publishes validated IPv4 with configured port %s', async (ssh_port) => {
    output('100.64.0.10\n');
    const machine: MachineRegistrationData = {};
    await tailscaleHook({ ssh_user: 'christian', ssh_port }).before_conductor_start!(machine, context);
    expect(machine.connection_url).toBe(`ssh://christian@100.64.0.10:${ssh_port}`);
    expect(execFile).toHaveBeenCalledWith('tailscale', ['ip', '-4'], expect.objectContaining({ timeout: 3000, maxBuffer: 4096, encoding: 'utf8' }), expect.any(Function));
  });
  it('defaults to SSH port 22', async () => {
    output('100.64.0.10'); const machine: MachineRegistrationData = {};
    await tailscaleHook({ ssh_user: 'user' }).before_conductor_start!(machine, context);
    expect(machine.connection_url).toBe('ssh://user@100.64.0.10:22');
  });
  it.each([null, 'https://manual.example'])('skips discovery for manual %s', async (connection_url) => {
    vi.mocked(execFile).mockClear(); const machine = { connection_url };
    await tailscaleHook({ ssh_user: 'user' }).before_conductor_start!(machine, context);
    expect(execFile).not.toHaveBeenCalled(); expect(machine.connection_url).toBe(connection_url);
  });
  it.each(['', '100.64.0.10\n100.64.0.11', 'not an IP', '::1', '999.1.1.1'])('leaves data unchanged on invalid output %s', async (stdout) => {
    output(stdout); const machine = { host_key: 'h' };
    await tailscaleHook({ ssh_user: 'user' }).before_conductor_start!(machine, context);
    expect(machine).toEqual({ host_key: 'h' });
  });
  it.each(['ENOENT', 'timeout', 'nonzero'])('leaves data unchanged on command failure %s', async (reason) => {
    output('100.64.0.10', new Error(reason)); const machine = {};
    await tailscaleHook({ ssh_user: 'user' }).before_conductor_start!(machine, context);
    expect(machine).toEqual({});
  });
  it.each([{ ssh_user: '' }, { ssh_user: 'bad user' }, { ssh_user: 'a:b' }, { ssh_user: 'a@b' }, { ssh_user: 'u', ssh_port: 0 }, { ssh_user: 'u', ssh_port: 65536 }, { ssh_user: 'u', ssh_port: 1.5 }])('rejects invalid options %j', (options) => {
    expect(() => tailscaleHook(options)).toThrow();
  });
});
