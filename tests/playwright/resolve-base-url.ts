import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Explicit override > worktree file URL > file name > ambient DDEV URL. */
export function resolveBaseURLFrom(env: NodeJS.ProcessEnv, envDdev: string): string {
    const validURL = (value: string): string => {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || /[\s'"`$]/.test(value) || url.username || url.password) {
            throw new Error('Invalid Playwright base URL');
        }
        return value;
    };
    if (env.PLAYWRIGHT_BASE_URL) return validURL(env.PLAYWRIGHT_BASE_URL);
    const assignments = /^[ \t]*(?:export[ \t]+)?([A-Za-z_]\w*)[ \t]*=[ \t]*("(?:\\[\s\S]|[^"\\])*"|'[^']*'|(?![ \t]*["'])[^\r\n]*)(?:[ \t]*(?:#[^\r\n]*)?)?(?:\r?\n|$)/gm;
    if (/^[ \t]*(?:export[ \t]+)?[A-Za-z_]\w*[ \t]*=[ \t]*["']/m.test(envDdev.replace(assignments, ''))) {
        throw new Error('Unterminated quoted value in .env.ddev');
    }
    const kv: Record<string, string> = {};
    for (const match of envDdev.matchAll(assignments)) {
        const [, key, value] = match;
        if (key !== 'PLAYWRIGHT_BASE_URL' && key !== 'DDEV_WORKTREE_NAME') continue;
        if (key === 'PLAYWRIGHT_BASE_URL') validURL(value);
        else if (!/^[a-z](?:[a-z0-9-]{0,50}[a-z0-9])?$/.test(value)) throw new Error('Invalid DDEV_WORKTREE_NAME');
        if (kv[key] && kv[key] !== value) throw new Error(`Conflicting ${key} in .env.ddev`);
        kv[key] = value;
    }
    if (/^[ \t]*(?:export[ \t]+)?(?:DDEV_WORKTREE_NAME|PLAYWRIGHT_BASE_URL)\b/m.test(envDdev.replace(assignments, ''))) {
        throw new Error('Malformed selected assignment in .env.ddev');
    }
    if (kv.PLAYWRIGHT_BASE_URL) return kv.PLAYWRIGHT_BASE_URL;
    if (kv.DDEV_WORKTREE_NAME) return `https://${kv.DDEV_WORKTREE_NAME}.ddev.site`;
    // Inside the DDEV web container, which is where CI runs the suite. Last,
    // so a worktree that states its own URL is never overruled by the
    // container it happens to be running in.
    if (env.DDEV_PRIMARY_URL) {
        return validURL(env.DDEV_PRIMARY_URL);
    }
    throw new Error(
        'No baseURL: run `node .bakers/scripts/setup-worktree.mjs` to write .env.ddev (DDEV_WORKTREE_NAME / PLAYWRIGHT_BASE_URL), run inside the DDEV web container where DDEV_PRIMARY_URL is set, or pass PLAYWRIGHT_BASE_URL to override both.',
    );
}

/**
 * Resolve the baseURL for the running Playwright config: read the project-owned
 * git-ignored `.env.ddev` from the repo root and delegate to the pure resolver.
 */
export function resolveBaseURL(): string {
    const envFile = join(__dirname, '..', '..', '.env.ddev');
    const contents = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
    return resolveBaseURLFrom(process.env, contents);
}
