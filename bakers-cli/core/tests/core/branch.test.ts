import { describe, expect, it } from 'vitest';
import { validateBranch } from '../../src/core/branch.js';

describe('validateBranch', () => {
  it.each([
    '--upload-pack=touch PWNED',
    '-x',
    'a..b',
    'a/.b',
    '.hidden',
    'a//b',
    'a/',
    'a.',
    'a.lock',
    'a@{1}',
    'a b',
    'main\n',
    '',
  ])('refuses %j before it reaches git', (branch) => {
    expect(() => validateBranch(branch)).toThrow(`invalid branch: ${branch}`);
  });

  it.each([
    'feat/bb-1-x',
    'release/1.2',
    'Main',
    'a-b/c_d',
  ])('accepts %j', (branch) => {
    expect(() => validateBranch(branch)).not.toThrow();
  });
});
