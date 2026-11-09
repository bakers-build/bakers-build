import { existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bumpUiRefresh, UI_REFRESH_FILE } from '../../src/index.js';

describe('bumpUiRefresh', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the signal file when it is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'ui-refresh-'));
    bumpUiRefresh(dir);
    expect(existsSync(join(dir, 'ui-refresh'))).toBe(true);
    expect(UI_REFRESH_FILE).toBe('ui-refresh');
  });

  it('advances the mtime of an existing signal file', () => {
    dir = mkdtempSync(join(tmpdir(), 'ui-refresh-'));
    const file = join(dir, 'ui-refresh');
    bumpUiRefresh(dir);
    utimesSync(file, 1000, 1000);
    bumpUiRefresh(dir);
    expect(statSync(file).mtimeMs).toBeGreaterThan(1000 * 1000);
  });

  it('creates nothing and does not throw for a missing dir', () => {
    dir = mkdtempSync(join(tmpdir(), 'ui-refresh-'));
    const missing = join(dir, 'nope');
    expect(() => bumpUiRefresh(missing)).not.toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
