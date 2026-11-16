import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadSecretsFile,
  parseSecretsFile,
  pickSecrets,
  secretsFilePath,
} from '../../src/index.js';

describe('parseSecretsFile', () => {
  it('reads KEY=value lines, export prefixes, comments and blanks', () => {
    expect(
      parseSecretsFile(
        [
          '# token for claude',
          '',
          'CLAUDE_CODE_OAUTH_TOKEN=sk-abc=def',
          'export XAI_API_KEY=xai-1',
          '  ',
        ].join('\n'),
      ),
    ).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-abc=def', XAI_API_KEY: 'xai-1' });
  });

  it('unquotes matching quotes and never expands shell syntax', () => {
    expect(
      parseSecretsFile(
        [
          `A='single $HOME'`,
          'B="double"',
          'C=$(id)',
          'D=`id`',
          `E='unmatched"`,
        ].join('\n'),
      ),
    ).toEqual({
      A: 'single $HOME',
      B: 'double',
      C: '$(id)',
      D: '`id`',
      E: `'unmatched"`,
    });
  });

  it('keeps the last duplicate', () => {
    expect(parseSecretsFile('A=1\nA=2')).toEqual({ A: '2' });
  });

  it('reports bad lines by number without their text', () => {
    let message = '';
    try {
      parseSecretsFile('A=1\nnot a pair sk-secret\n1BAD=sk-other\n');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('line 2');
    expect(message).toContain('line 3');
    expect(message).not.toContain('sk-secret');
    expect(message).not.toContain('sk-other');
  });
});

describe('loadSecretsFile', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'bakers-secrets-'));

  it('loads a 600 file', () => {
    const path = join(dir(), '.bakers.env');
    writeFileSync(path, 'A=sk-1\n', { mode: 0o600 });
    expect(loadSecretsFile(path)).toEqual({ A: 'sk-1' });
  });

  it('treats a missing file as empty', () => {
    expect(loadSecretsFile(join(dir(), '.bakers.env'))).toEqual({});
  });

  it('refuses a file group or others can read, naming the fix and no value', () => {
    const path = join(dir(), '.bakers.env');
    writeFileSync(path, 'A=sk-leak\n');
    chmodSync(path, 0o644);
    let message = '';
    try {
      loadSecretsFile(path);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(path);
    expect(message).toContain(`chmod 600 ${path}`);
    expect(message).not.toContain('sk-leak');
  });

  it('names the file in a parse error', () => {
    const path = join(dir(), '.bakers.env');
    writeFileSync(path, 'oops\n', { mode: 0o600 });
    expect(() => loadSecretsFile(path)).toThrow(`${path}: line 1`);
  });

  it('defaults to .bakers.env beside the machine config', () => {
    expect(secretsFilePath('/h')).toBe('/h/.bakers/.bakers.env');
  });
});

describe('pickSecrets', () => {
  it('hands out declared names only, and the shell wins over the file', () => {
    expect(
      pickSecrets(
        ['A', 'B', 'C'],
        { A: 'file-a', B: 'file-b', UNDECLARED: 'x' },
        { B: 'shell-b', C: 'shell-c', D: 'shell-d' },
      ),
    ).toEqual({ A: 'file-a', B: 'shell-b', C: 'shell-c' });
  });
});
