import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const writes: string[] = [];

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (
      path: Parameters<typeof actual.writeFileSync>[0],
      data: Parameters<typeof actual.writeFileSync>[1],
      options?: Parameters<typeof actual.writeFileSync>[2],
    ) => {
      writes.push(String(path));
      if (String(path).endsWith('run.sh')) {
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      }
      return actual.writeFileSync(path, data, options);
    },
  };
});

const { writeLaunchScript } = await import('../src/launch-script.js');

describe('writeLaunchScript internal cleanup', () => {
  it('removes the temp dir when writing the wrapper fails', () => {
    writes.length = 0;
    expect(() => writeLaunchScript('true')).toThrow(/ENOSPC/);
    expect(writes.length).toBeGreaterThan(0);
    expect(existsSync(dirname(writes[0] ?? ''))).toBe(false);
  });
});
