import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireValue, slug, validateEnvelope } from './validation.mjs';

const directory = new URL('./fixtures/', import.meta.url);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const catalog = () => json(new URL('./fixtures.json', import.meta.url));

export async function fixtureIds() {
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
  return [...new Set([...files, ...(await catalog()).map(f => f.id ?? f.fixture)])].sort();
}

export async function loadFixture(idOrPath) {
  let fixture;
  if (slug(idOrPath)) {
    try { fixture = await json(new URL(`${idOrPath}.json`, directory)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fixture = (await catalog()).find(f => f.id === idOrPath);
      requireValue(fixture, `Unknown fixture: ${idOrPath}`);
    }
  } else fixture = await json(resolve(idOrPath));
  await loadProfile(fixture);
  return fixture;
}

export async function loadProfile(fixture) {
  validateEnvelope(fixture);
  // Version 1 focused attempts predate the explicit profile field.
  const name = fixture.profile ?? (fixture.id === 'run-outtake-coding' ? 'run-outtake-coding' : undefined);
  requireValue(slug(name), 'Expected a local profile name');
  const profile = await import(new URL(`./profiles/${name}.mjs`, import.meta.url));
  requireValue(typeof profile.validate === 'function' && typeof profile.checkOutput === 'function',
    `Profile ${name} must export validate and checkOutput`);
  await profile.validate(fixture);
  return profile;
}
