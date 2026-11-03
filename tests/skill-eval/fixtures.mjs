import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recipeName, reference, requireValue, slug, validateEnvelope } from './validation.mjs';

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
  await installRecipes(fixture);
  await installReferences(fixture);
  await loadProfile(fixture);
  return fixture;
}

/** Tool fixtures read a recipe as a virtual file (a trace event); text fixtures receive it as input. */
async function installRecipes(fixture) {
  if (fixture.recipes === undefined) return;
  requireValue(Array.isArray(fixture.recipes) && fixture.recipes.every(recipeName), 'Expected recipes as bb-recipe-<name> list');
  for (const name of fixture.recipes) {
    const content = await readFile(new URL(`./recipes/${name}.md`, import.meta.url), 'utf8');
    if (fixture.execution === 'simulated-tools') (fixture.simulation.files ??= {})[`skills/${name}/SKILL.md`] = content;
    else (fixture.input.installed_recipes ??= {})[name] = content;
  }
}

/** Tool fixtures may serve frame references and bundle skills as virtual files, so the trace counts each read. */
async function installReferences(fixture) {
  if (fixture.virtual_references === undefined) return;
  const servable = path => reference(path) || /^bb-[a-z0-9-]+\/SKILL\.md$/.test(path);
  requireValue(fixture.execution === 'simulated-tools' && Array.isArray(fixture.virtual_references) &&
    fixture.virtual_references.every(servable), 'Expected virtual_references as frame reference or bundle skill paths of a tool fixture');
  for (const path of fixture.virtual_references) {
    fixture.simulation.files[`skills/${path}`] = await readFile(new URL(`../../.claude/skills/bakers-build/skills/${path}`, import.meta.url), 'utf8');
  }
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
