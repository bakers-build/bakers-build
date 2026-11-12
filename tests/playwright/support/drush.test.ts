import { execSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Drush, phpUnderLock, phpWithRetry } from './drush';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
const exec = vi.mocked(execSync);

beforeEach(() => {
    exec.mockReset();
    vi.stubEnv('DDEV_DOCROOT', '');
    vi.stubEnv('DRUSH_CWD', '');
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

it.each(['1412 Table definition has changed', 'Time data is being changed'])('retries a transient PHP failure: %s', async (message) => {
    vi.stubEnv('DDEV_DOCROOT', '/var/www/html/web');
    vi.useFakeTimers();
    exec.mockImplementationOnce(() => { throw new Error(message); }).mockReturnValue('ready\n');
    const result = message.startsWith('1412')
        ? phpWithRetry('print "ready";', [message])
        : phpUnderLock('print "ready";');
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('ready');
    expect(exec).toHaveBeenCalledTimes(2);
});

it.each([
    ['1412 Table definition has changed', 5],
    ['Permission denied', 1],
])('propagates PHP failure after bounded attempts: %s', async (message, attempts) => {
    vi.stubEnv('DDEV_DOCROOT', '/var/www/html/web');
    vi.useFakeTimers();
    const failure = new Error(message);
    exec.mockImplementation(() => { throw failure; });
    const result = expect(phpWithRetry('print "ready";', ['1412 Table definition has changed'])).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await result;
    expect(exec).toHaveBeenCalledTimes(attempts);
});

it('runs native Drush inside DDEV and preserves shell arguments, cwd and UTF-8 output', () => {
    vi.stubEnv('DDEV_DOCROOT', '/var/www/html/web');
    vi.stubEnv('DRUSH_CWD', '/var/www/html');
    exec.mockReturnValue('café\n');
    expect(Drush.exec('ev \'print "$value";\'')).toBe('café\n');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('drush ev \'print "$value";\'', {
        cwd: '/var/www/html', encoding: 'utf-8', stdio: 'pipe',
    });
});

it.each([
    [true, true, 'drush status'],
    [false, true, 'ddev drush status'],
    [false, false, 'drush status'],
])('selects the available runner (native=%s, DDEV=%s)', (native, ddev, command) => {
    exec.mockImplementation((cmd) => {
        if (cmd === 'which drush' && !native || cmd === 'which ddev' && !ddev) throw new Error('not found');
        return 'ready\n';
    });
    expect(Drush.exec('status')).toBe('ready\n');
    expect(exec).toHaveBeenLastCalledWith(command, {
        cwd: process.cwd(), encoding: 'utf-8', stdio: 'pipe',
    });
    if (native) expect(exec).not.toHaveBeenCalledWith('which ddev', expect.anything());
});

it('propagates a failed Drush command without retrying it through another runner', () => {
    const failure = new Error('PHP failed');
    exec.mockImplementation((command) => {
        if (command === 'which drush') return '';
        throw failure;
    });
    expect(() => Drush.exec('status')).toThrow(failure);
    expect(exec).not.toHaveBeenCalledWith('which ddev', expect.anything());
});
