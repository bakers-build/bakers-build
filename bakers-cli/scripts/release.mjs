// Release the whole bakers.build package set to npm: stage every package at the resolved
// version, then `npm publish` each in dependency-direction order.
//
// Both staging and publishing iterate the SAME `TARGETS` in prepare-publish.mjs,
// which is now DISCOVERED from the workspace (every non-private package,
// topologically sorted) rather than hand-listed — so a new package is released
// automatically the moment it exists, with no per-package line to forget. That
// omission had shipped two broken releases (`@bakers-build/addon-essentials`, then
// `@bakers-build/addon-name-refs`): a dependent published a `^x.y.z` ref to a package
// that was never staged. Discovery removes the class.
//
// Two variants (npm scripts in conductor/package.json):
//   pnpm run release            → dev version (workspace package.json), for local
//                                 dry runs / smoke publishes.
//   pnpm run release:semver X    → REQUIRES an explicit semver (arg or
//                                 BB_PUBLISH_VERSION); refuses the dev-version
//                                 fallback so a real release can't ship 0.0.1.
//                                 This is what CI runs on a git tag.
//
// Version precedence: positional arg → BB_PUBLISH_VERSION → dev version
// (unless --require-version, which drops the dev fallback).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  devVersion,
  resolveVersion,
  root,
  stageAll,
  TARGETS,
} from './prepare-publish.mjs';

const args = process.argv.slice(2);
const requireVersion = args.includes('--require-version');
const explicit =
  args.find((a) => !a.startsWith('--')) ?? process.env.BB_PUBLISH_VERSION;

if (requireVersion && !explicit) {
  throw new Error(
    'release:semver needs an explicit semver, e.g. `pnpm run release:semver 1.4.0` ' +
      '(or set BB_PUBLISH_VERSION). Use `pnpm run release` for the dev version.',
  );
}

const version = resolveVersion(explicit ?? devVersion);

console.log(`release: staging the set at ${version}`);
stageAll(version);

for (const { dir } of TARGETS) {
  const cwd = resolve(root, dir, 'publish');
  if (!existsSync(resolve(cwd, 'package.json'))) {
    throw new Error(`release: ${dir}/publish was not staged`);
  }
  console.log(`release: npm publish ${dir}@${version}`);
  // shell:true so npm resolves via PATH (and npm.cmd on Windows) regardless of
  // how the parent process was launched.
  execFileSync('npm', ['publish'], { cwd, stdio: 'inherit', shell: true });
}
