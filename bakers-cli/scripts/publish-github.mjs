#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { stageAll, TARGETS, root } from './prepare-publish.mjs';
import { publishSet } from './publish-set.mjs';

const [version, channel, commit, mode] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(commit ?? '') || !['next', 'latest'].includes(channel) || !['--publish', '--dry-run'].includes(mode))
  throw new Error('usage: publish-github.mjs <version> <next|latest> <commit> <--publish|--dry-run>');
const npm = (args, cwd = root) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function view(args) {
  try { return JSON.parse(npm(['view', ...args, '--json'])); }
  catch (error) {
    let response;
    try { response = JSON.parse(String(error.stdout)); } catch { throw error; }
    if (response.error?.code === 'E404') return undefined;
    throw error;
  }
}
const directory = mkdtempSync(resolve(tmpdir(), 'bakers-release-'));
try {
  stageAll(version);
  const packages = TARGETS.map(({ dir }) => {
    const cwd = resolve(root, dir, 'publish');
    const manifest = resolve(cwd, 'package.json');
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    pkg.bakersBuild = { commit, channel };
    writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], cwd));
    return { name: pkg.name, integrity: packed.integrity, tarball: resolve(directory, packed.filename) };
  });
  const registry = {
    current: async (name, tag) => view([name, 'dist-tags'])?.[tag],
    integrity: async (name, candidate) => {
      const dist = view([`${name}@${candidate}`, 'dist']);
      if (dist && !dist.integrity) throw new Error(`${name}: missing registry integrity`);
      return dist?.integrity;
    },
    publish: async (pkg) => {
      console.log(`Publish ${pkg.name}@${version}`);
      if (mode === '--publish') npm(['publish', pkg.tarball, '--ignore-scripts', '--tag', `candidate-${channel}`]);
    },
    promote: async (name, candidate, tag) => {
      console.log(`Promote ${name}@${candidate} to ${tag}`);
      if (mode === '--publish') npm(['dist-tag', 'add', `${name}@${candidate}`, tag]);
    },
  };
  await publishSet(packages, version, channel, registry);
  console.log(JSON.stringify({ version, channel, commit, mode, packages: packages.map(({ name, integrity }) => ({ name, integrity })) }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
