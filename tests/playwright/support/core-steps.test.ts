import { beforeEach, expect, it, vi } from 'vitest';

const steps = vi.hoisted(() => new Map<string, (...args: any[]) => Promise<void>>());
vi.mock('../bdd.fixtures', () => ({
    Given: (text: string, run: (...args: any[]) => Promise<void>) => steps.set(text, run),
    When: (text: string, run: (...args: any[]) => Promise<void>) => steps.set(text, run),
}));
import './steps/core';

const page = {};
const authProvider = { login: vi.fn(), logout: vi.fn() };
beforeEach(() => vi.clearAllMocks());

it.each(['Administrator', ' admin ', 'ADMINISTRATOR'])('logs in %s as uid 1', async (role) => {
    expect(steps.has('I am logged in as {string}')).toBe(true);
    await steps.get('I am logged in as {string}')!({ page, authProvider }, role);
    expect(authProvider.login).toHaveBeenCalledWith(page, '1');
    expect(authProvider.logout).not.toHaveBeenCalled();
});

it.each(['Anonymous', ' anonymous ', 'ANONYMOUS'])('logs out %s', async (role) => {
    await steps.get('I am logged in as {string}')!({ page, authProvider }, role);
    expect(authProvider.logout).toHaveBeenCalledWith(page);
    expect(authProvider.login).not.toHaveBeenCalled();
});

it.each(['', 'north-lead', 'uid:1'])('rejects unknown role %s without changing identity', async (role) => {
    await expect(steps.get('I am logged in as {string}')!({ page, authProvider }, role)).rejects.toThrow('Unknown role');
    expect(authProvider.login).not.toHaveBeenCalled();
    expect(authProvider.logout).not.toHaveBeenCalled();
});

it('clicks the accessible button by name', async () => {
    const click = vi.fn();
    const getByRole = vi.fn(() => ({ click }));
    await steps.get('I click button {string}')!({ page: { getByRole } }, 'Save');
    expect(getByRole).toHaveBeenCalledWith('button', { name: 'Save' });
    expect(click).toHaveBeenCalledTimes(1);
});
