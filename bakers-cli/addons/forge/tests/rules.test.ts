import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONVENTIONAL_TITLE_RULE,
  derivedBase,
  isConventionalTitle,
  isOwned,
  redact,
} from '../src/rules.js';

const run = { branchName: 'feat/bb-7-work', baseBranch: 'next' };

describe('ownership', () => {
  it('owns the ticket branch and its variants only', () => {
    for (const b of [
      'feat/bb-7-work',
      'feat/bb-7-work-2',
      'feat/bb-7-work-ui.v2',
    ])
      expect(isOwned(b, run.branchName), b).toBe(true);
    for (const b of [
      'main',
      'next',
      'feat/other',
      'feat/bb-7-workx',
      'feat/bb-7-work-',
      'feat/bb-7-work-a/b',
      'feat/bb-7-work-..x',
      'feat/bb-7-work-x.lock',
    ])
      expect(isOwned(b, run.branchName), b).toBe(false);
  });

  it('derives the base: base_branch for the ticket branch, the ticket branch for a variant', () => {
    expect(derivedBase('feat/bb-7-work', run)).toBe('next');
    expect(derivedBase('feat/bb-7-work-2', run)).toBe('feat/bb-7-work');
  });
});

describe('title rule', () => {
  it('accepts Conventional Commits subjects only', () => {
    for (const t of ['feat: x', 'feat(cli)!: x', 'fix(a.b/c-d): y'])
      expect(isConventionalTitle(t), t).toBe(true);
    for (const t of [
      'Add stuff',
      'Draft: feat: x',
      'feature: x',
      'feat:  x',
      'feat(CLI): x',
    ])
      expect(isConventionalTitle(t), t).toBe(false);
  });

  it('is the RULE of tests/contract/mr-title.sh', () => {
    const script = readFileSync(
      new URL('../../../../tests/contract/mr-title.sh', import.meta.url),
      'utf8',
    );
    expect(script).toContain(`RULE='${CONVENTIONAL_TITLE_RULE}'`);
  });
});

describe('redact', () => {
  it('removes every secret and Authorization header value', () => {
    const out = redact(
      'token tok-SECRET-123 failed; Authorization: Basic eDp0b2s= and authorization: token tok-SECRET-123',
      ['tok-SECRET-123', ''],
    );
    expect(out).not.toContain('tok-SECRET-123');
    expect(out).not.toContain('eDp0b2s=');
    expect(out).toContain('[redacted]');
  });

  it('removes quoted Authorization header values', () => {
    const out = redact(
      `{"authorization":"Bearer eyJ.jwt.sig","x":1} {'Authorization': 'token ghs_Q'}`,
      [],
    );
    expect(out).not.toContain('eyJ.jwt.sig');
    expect(out).not.toContain('ghs_Q');
    expect(out).toContain('"x":1');
  });
});
