import * as fs from 'node:fs';
import * as path from 'node:path';
import { Drush } from './drush';
import type { Page } from '@playwright/test';

/**
 * One Drupal session PER WORKER, not per uid.
 *
 * Sharing one uid's cached cookie across workers would share Drupal's session row
 * and let one worker drain another's status messages. Keep the seeded accounts and
 * their memberships, but cache a separate session for each worker/account pair.
 *
 * The file lives under the run's output directory because Playwright clears that
 * directory at the start of every run. A session cached across runs points at a database
 * a later `ddev init` has dropped, and the whole suite then fails as "not signed in".
 */
export function sessionFileFor(outputDir: string, workerIndex: number, uid: string): string {
    return path.join(outputDir, `auth-w${workerIndex}-uid${uid}.json`);
}

export class WorkerAuthProvider {
    constructor(private readonly outputDir: string, private readonly workerIndex: number) {}

    async login(page: Page, uid = '1', attempt = 1): Promise<void> {
        const base = this.baseOf(page);
        const file = sessionFileFor(this.outputDir, this.workerIndex, uid);
        if (!fs.existsSync(file)) {
            const link = Drush.exec(`uli --uid=${uid} --no-browser --uri=${base}`).trim();
            if (!link.startsWith('http')) throw new Error(`Invalid ULI link for uid=${uid}: ${link}`);
            // Drupal refuses a one-time login while another account is signed in, and the
            // refused page's cookies would then be cached as this uid's session.
            await page.context().clearCookies();
            await page.goto(link);
            await page.waitForLoadState('networkidle');
            // The link's hash covers the account's last login time, so another worker
            // signing in as the same uid in between voids it and the visit lands
            // anonymous. Caching that would replay a signed-out session; ask again.
            if (/^\/user\/(login|password)/.test(new URL(page.url()).pathname)) {
                if (attempt >= 3) throw new Error(`ULI login for uid=${uid} did not sign in.`);
                await this.login(page, uid, attempt + 1);
                return;
            }
            fs.mkdirSync(this.outputDir, { recursive: true });
            await page.context().storageState({ path: file });
            return;
        }
        const state = JSON.parse(fs.readFileSync(file, 'utf-8'));
        await page.context().addCookies(state.cookies);
        await page.goto(base);
        await page.waitForLoadState('networkidle');
        // A scenario that signed this account out destroyed the cached session row;
        // the replayed cookie then lands anonymous on the login gate. Sign in afresh.
        if (new URL(page.url()).pathname.startsWith('/user/login')) {
            fs.rmSync(file);
            await this.login(page, uid);
        }
    }

    async logout(page: Page): Promise<void> {
        await page.context().clearCookies();
        await page.goto(this.baseOf(page));
        await page.waitForLoadState('networkidle');
    }

    private baseOf(page: Page): string {
        const url = page.url();
        if (url && url !== 'about:blank') return new URL(url).origin;
        const configured = (page.context() as unknown as { _options?: { baseURL?: string } })._options?.baseURL;
        if (!configured) throw new Error('No base URL to sign in against.');
        return new URL(configured).origin;
    }
}
