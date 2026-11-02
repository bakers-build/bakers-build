import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WorkerAuthProvider, sessionFileFor } from './worker-auth-provider';

describe('sessionFileFor', () => {
    it('gives each worker its own session file for the same account', () => {
        expect(sessionFileFor('/out', 0, '1')).not.toBe(sessionFileFor('/out', 1, '1'));
    });

    it('keeps one worker on one file per account, so a second login reuses it', () => {
        expect(sessionFileFor('/out', 0, '1')).toBe(sessionFileFor('/out', 0, '1'));
        expect(sessionFileFor('/out', 0, '1')).not.toBe(sessionFileFor('/out', 0, '7'));
    });

    it('stays inside the run output directory, which Playwright wipes per run', () => {
        expect(sessionFileFor('/out', 2, '1').startsWith('/out/')).toBe(true);
    });
});

vi.mock('./drush', () => ({
    Drush: { exec: () => 'https://site.test/user/reset/7/1/x/login' },
}));

describe('WorkerAuthProvider.login', () => {
    it('signs the previous account out before a fresh one-time login', async () => {
        // Drupal refuses a one-time login link while a different account is signed in,
        // so a switch without clearing the cookies stays on the old account.
        const calls: string[] = [];
        const context = {
            clearCookies: async () => { calls.push('clearCookies'); },
            storageState: async () => { calls.push('storageState'); },
        };
        const page = {
            url: () => 'https://site.test/bakers/tickets',
            context: () => context,
            goto: async (url: string) => { calls.push(`goto ${url}`); },
            waitForLoadState: async () => {},
        };
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wap-'));
        await new WorkerAuthProvider(out, 0).login(page as never, '7');
        expect(calls.indexOf('clearCookies')).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf('clearCookies')).toBeLessThan(calls.indexOf('goto https://site.test/user/reset/7/1/x/login'));
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('replaces a cached session that a sign-out destroyed', async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wap-'));
        const file = sessionFileFor(out, 0, '7');
        fs.writeFileSync(file, JSON.stringify({ cookies: [] }));
        let current = 'https://site.test/bakers/tickets';
        const visited: string[] = [];
        const page = {
            url: () => current,
            context: () => ({ addCookies: async () => {}, clearCookies: async () => {}, storageState: async () => {} }),
            goto: async (url: string) => {
                visited.push(url);
                // The stale cookie is anonymous: the base address bounces to the login gate.
                current = url === 'https://site.test' ? 'https://site.test/user/login' : url;
            },
            waitForLoadState: async () => {},
        };
        await new WorkerAuthProvider(out, 0).login(page as never, '7');
        expect(visited).toContain('https://site.test/user/reset/7/1/x/login');
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('asks for a new one-time link when another worker voided the first', async () => {
        // A voided link lands anonymous on /user/password; caching that state would
        // replay a signed-out session as this account's.
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wap-'));
        let current = 'https://site.test/bakers/tickets';
        const links: string[] = [];
        const saved: string[] = [];
        const page = {
            url: () => current,
            context: () => ({ clearCookies: async () => {}, storageState: async () => { saved.push(current); } }),
            goto: async (url: string) => {
                links.push(url);
                current = links.length === 1 ? 'https://site.test/user/password' : 'https://site.test/bakers/tickets';
            },
            waitForLoadState: async () => {},
        };
        await new WorkerAuthProvider(out, 0).login(page as never, '7');
        expect(links).toEqual(['https://site.test/user/reset/7/1/x/login', 'https://site.test/user/reset/7/1/x/login']);
        expect(saved).toEqual(['https://site.test/bakers/tickets']);
        fs.rmSync(out, { recursive: true, force: true });
    });
});
