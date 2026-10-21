import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve the Playwright baseURL from the process environment and the contents
 * of the addon-generated `.env.ddev` (KEYTECDDEV-10).
 *
 * Precedence:
 *   1. an explicit `PLAYWRIGHT_BASE_URL` in the environment (ad-hoc override);
 *   2. `PLAYWRIGHT_BASE_URL` inside `.env.ddev`;
 *   3. derived from `.env.ddev`'s `DDEV_WORKTREE_NAME` (`https://<name>.ddev.site`);
 *   4. `DDEV_PRIMARY_URL` from the ambient environment.
 *
 * THE WORKTREE FILE WINS OVER THE AMBIENT URL, and step 4 is what makes step 1
 * unnecessary anywhere. `.env.ddev` is written by the addon's `init-worktree`
 * and is gitignored, so it exists on a developer's worktree and NOT in CI —
 * where the repository is cloned fresh and only `ddev init` runs. But the suite
 * runs inside the DDEV web container either way, and DDEV exports the project's
 * own URL there. So no caller has to pass a URL: not the CI job, not
 * `validate.command`, not a local `npm test`. A caller that passes one is
 * overriding the worktree rather than configuring it, which is why step 1 is
 * documented as an override and used for nothing else.
 *
 * Pure (no filesystem access) so it is exhaustively unit-testable; the thin
 * `resolveBaseURL()` below reads the file and delegates here.
 */
export function resolveBaseURLFrom(env: NodeJS.ProcessEnv, envDdev: string): string {
    if (env.PLAYWRIGHT_BASE_URL) {
        return env.PLAYWRIGHT_BASE_URL;
    }
    const kv = Object.fromEntries(
        envDdev
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => {
                const i = line.indexOf('=');
                return [line.slice(0, i), line.slice(i + 1)] as const;
            }),
    );
    if (kv.PLAYWRIGHT_BASE_URL) {
        return kv.PLAYWRIGHT_BASE_URL;
    }
    if (kv.DDEV_WORKTREE_NAME) {
        return `https://${kv.DDEV_WORKTREE_NAME}.ddev.site`;
    }
    // Inside the DDEV web container, which is where CI runs the suite. Last,
    // so a worktree that states its own URL is never overruled by the
    // container it happens to be running in.
    if (env.DDEV_PRIMARY_URL) {
        return env.DDEV_PRIMARY_URL;
    }
    throw new Error(
        'No baseURL: run `ddev init-worktree` to write .env.ddev (DDEV_WORKTREE_NAME / PLAYWRIGHT_BASE_URL), run inside the DDEV web container where DDEV_PRIMARY_URL is set, or pass PLAYWRIGHT_BASE_URL to override both.',
    );
}

/**
 * Resolve the baseURL for the running Playwright config: read the addon's
 * git-ignored `.env.ddev` from the repo root and delegate to the pure resolver.
 */
export function resolveBaseURL(): string {
    const envFile = join(__dirname, '..', '..', '.env.ddev');
    const contents = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
    return resolveBaseURLFrom(process.env, contents);
}
