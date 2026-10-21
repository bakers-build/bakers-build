import { describe, expect, it } from 'vitest';
import { resolveBaseURLFrom } from './resolve-base-url';

describe('resolveBaseURLFrom', () => {
    it('prefers an explicit PLAYWRIGHT_BASE_URL over .env.ddev', () => {
        const env = 'PLAYWRIGHT_BASE_URL=https://from-envddev.ddev.site\n';
        expect(resolveBaseURLFrom({ PLAYWRIGHT_BASE_URL: 'https://explicit.example' }, env)).toBe(
            'https://explicit.example',
        );
    });

    it('reads PLAYWRIGHT_BASE_URL from .env.ddev contents', () => {
        const env = 'DDEV_WORKTREE_NAME=bakers-wt-abc\nPLAYWRIGHT_BASE_URL=https://bakers-wt-abc.ddev.site\n';
        expect(resolveBaseURLFrom({}, env)).toBe('https://bakers-wt-abc.ddev.site');
    });

    it('derives the URL from DDEV_WORKTREE_NAME when PLAYWRIGHT_BASE_URL is absent', () => {
        expect(resolveBaseURLFrom({}, 'DDEV_WORKTREE_NAME=bakers-wt-abc\n')).toBe('https://bakers-wt-abc.ddev.site');
    });

    it('ignores comments and blank lines in .env.ddev', () => {
        const env = '# DDEV-derived URLs for host tools\n\nPLAYWRIGHT_BASE_URL=https://bakers-wt-xyz.ddev.site\n';
        expect(resolveBaseURLFrom({}, env)).toBe('https://bakers-wt-xyz.ddev.site');
    });

    // CI has no `.env.ddev`: the file is written by the addon's `init-worktree`
    // and is gitignored, while the pipeline clones fresh and runs `ddev init`.
    // The suite still runs inside the DDEV web container, where DDEV exports the
    // project's own URL — so that is the third source, and it is what lets NO
    // caller pass a URL anywhere.
    it('falls back to DDEV_PRIMARY_URL when there is no .env.ddev', () => {
        expect(resolveBaseURLFrom({ DDEV_PRIMARY_URL: 'https://bb-396.ddev.site' }, '')).toBe(
            'https://bb-396.ddev.site',
        );
    });

    it('lets the worktree file win over the ambient container URL', () => {
        const env = 'PLAYWRIGHT_BASE_URL=https://from-worktree.ddev.site\n';
        expect(
            resolveBaseURLFrom({ DDEV_PRIMARY_URL: 'https://ambient.ddev.site' }, env),
        ).toBe('https://from-worktree.ddev.site');
    });

    it('derives from DDEV_WORKTREE_NAME before the ambient container URL', () => {
        const env = 'DDEV_WORKTREE_NAME=bakers-wt-abc\n';
        expect(
            resolveBaseURLFrom({ DDEV_PRIMARY_URL: 'https://ambient.ddev.site' }, env),
        ).toBe('https://bakers-wt-abc.ddev.site');
    });

    it('throws when neither the environment nor .env.ddev provides a URL', () => {
        expect(() => resolveBaseURLFrom({}, '')).toThrow(
            /PLAYWRIGHT_BASE_URL|init-worktree|DDEV_PRIMARY_URL/,
        );
    });
});
