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

    // The container URL remains a fallback when no worktree file exists.
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
            /PLAYWRIGHT_BASE_URL|setup-worktree|DDEV_PRIMARY_URL/,
        );
    });
    it('rejects malformed selected assignments without evaluating them', () => {
        for (const value of ['DDEV_WORKTREE_NAME=bad name', 'LOCAL="unterminated\nPLAYWRIGHT_BASE_URL=https://hidden.example\n', 'PLAYWRIGHT_BASE_URL=$(touch marker)', 'PLAYWRIGHT_BASE_URL', 'PLAYWRIGHT_BASE_URL=javascript:alert(1)']) {
            expect(() => resolveBaseURLFrom({}, value)).toThrow();
        }
    });
    it('ignores key-like lines within unrelated quoted multiline settings', () => {
        expect(resolveBaseURLFrom({ DDEV_PRIMARY_URL: 'https://ambient.ddev.site' }, 'LOCAL="line\nPLAYWRIGHT_BASE_URL=https://wrong.example\n"\n')).toBe('https://ambient.ddev.site');
    });

});
