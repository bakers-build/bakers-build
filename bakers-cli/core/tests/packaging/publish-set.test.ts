import { expect, it } from 'vitest';
// @ts-expect-error Release tooling is executable JavaScript.
import { publishSet } from '../../../scripts/publish-set.mjs';

it('resumes a partial upload without republishing immutable versions or advertising an incomplete set', async () => {
  const stored = new Map<string, string>();
  const tags = new Map<string, string>();
  let fail = true;
  const writes: string[] = [];
  const registry = {
    integrity: async (name: string) => stored.get(name),
    current: async () => undefined,
    publish: async (pkg: { name: string; integrity: string }) => {
      if (pkg.name === 'second' && fail) throw new Error('network');
      if (stored.has(pkg.name)) throw new Error('immutable');
      stored.set(pkg.name, pkg.integrity);
      writes.push(pkg.name);
    },
    promote: async (name: string, version: string) => tags.set(name, version),
  };
  const packages = [
    { name: 'first', integrity: 'sha512-one' },
    { name: 'second', integrity: 'sha512-two' },
  ];
  await expect(
    publishSet(packages, '1.0.1-next.1', 'next', registry),
  ).rejects.toThrow('network');
  expect(tags.size).toBe(0);
  fail = false;
  await publishSet(packages, '1.0.1-next.1', 'next', registry);
  expect(writes).toEqual(['first', 'second']);
  expect([...tags.values()]).toEqual(['1.0.1-next.1', '1.0.1-next.1']);
});

it('rejects mismatched existing bytes and channel rollback before publishing', async () => {
  let writes = 0;
  const registry = {
    integrity: async () => 'sha512-other',
    current: async () => undefined,
    publish: async () => {
      writes++;
    },
    promote: async () => {
      writes++;
    },
  };
  await expect(
    publishSet(
      [{ name: 'pkg', integrity: 'sha512-local' }],
      '1.0.1-next.1',
      'next',
      registry,
    ),
  ).rejects.toThrow('integrity');
  registry.integrity = async () => 'sha512-local';
  await expect(
    publishSet(
      [{ name: 'pkg', integrity: 'sha512-local' }],
      '1.0.1-next.1',
      'next',
      { ...registry, current: async () => '1.0.1-next.2' },
    ),
  ).rejects.toThrow('backwards');
  expect(writes).toBe(0);
});
