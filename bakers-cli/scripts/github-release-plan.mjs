#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TARGETS, root } from './prepare-publish.mjs';

const [channel, head, output] = process.argv.slice(2);
if (!['next', 'latest'].includes(channel) || !/^[0-9a-f]{40}$/.test(head ?? '') || !output)
  throw new Error('usage: github-release-plan.mjs <next|latest> <head SHA> <output.json>');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
// A never-published package answers E404: it has no versions yet. Same rule as publish-github.mjs.
function versionsOf(name) {
  try { return JSON.parse(execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch (error) {
    let response;
    try { response = JSON.parse(String(error.stdout)); } catch { throw error; }
    if (response.error?.code === 'E404') return [];
    throw error;
  }
}
const commit = channel === 'latest' ? git('rev-parse', `${head}^2`) : head;
let version;
const snapshot = {};
if (channel === 'next') {
  const tag = git('tag', '--merged', commit, '--sort=-v:refname', '--list', 'v*').split('\n').find(value => /^v\d+\.\d+\.\d+$/.test(value));
  const base = tag ? tag.slice(1).replace(/\d+$/, patch => String(Number(patch) + 1)) : '0.1.0';
  for (const { dir } of TARGETS) {
    const { name } = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8'));
    const versions = versionsOf(name);
    snapshot[name] = Array.isArray(versions) ? versions : [versions];
  }
  version = execFileSync(process.execPath, [new URL('./next-version.mjs', import.meta.url).pathname, base], {
    input: JSON.stringify(Object.values(snapshot).flat()), encoding: 'utf8',
  }).trim();
} else {
  version = execFileSync(process.execPath, [new URL('./release-version.mjs', import.meta.url).pathname, commit, '--notes', `${output}.notes.md`], { encoding: 'utf8' }).trim();
}
writeFileSync(output, `${JSON.stringify({ head, commit, channel, version, snapshot }, null, 2)}\n`);
