#!/usr/bin/env node
// Input: JSON array of published versions across the complete package set, after draining the old publisher.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { valid, prerelease, compare, parse } = createRequire(new URL('../core/package.json', import.meta.url))('semver');
const base = process.argv[2];
if (valid(base) !== base || prerelease(base) || base.includes('+')) throw new Error('Expected a stable semver base');
const versions = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(versions)) throw new Error('Expected all published package versions as a JSON array');
let high = 0;
for (const version of versions) {
  if (typeof version !== 'string' || !valid(version)) throw new Error('Invalid published version');
  const parsed = parse(version);
  const stable = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (compare(stable, base) > 0 || (stable === base && !prerelease(version)))
    throw new Error('Release base is behind published versions');
  if (stable !== base) continue;
  const parts = prerelease(version);
  if (parts[0] !== 'next' || parts.length !== 2 || !Number.isSafeInteger(parts[1]))
    throw new Error('Unexpected prerelease sequence; reconcile before publishing');
  high = Math.max(high, parts[1]);
}
if (!Number.isSafeInteger(high + 1)) throw new Error('Prerelease sequence exhausted');
console.log(`${base}-next.${high + 1}`);
