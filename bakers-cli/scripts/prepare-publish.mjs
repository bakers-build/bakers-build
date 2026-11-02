// Assemble self-contained publish staging dirs for the whole bakers.build package set:
// `@bakers-build/{core,conductor,ui,bakers}` PLUS every mountable
// `@bakers-build/addon-*` under `addons/*` (BB-139 merged the former
// `@bakers-build/addon-herdr-workspace` into `@bakers-build/addon-herdr`, which now ships
// both the executor + the workspace).
// BB-86 split the old single `@bakers-build/bakers`; BB-224 (Finding 6) then split
// the kernel from the conductor surface:
//   - @bakers-build/core      — surface-AGNOSTIC kernel: host contract, split-config
//                          helpers, preset/discovery machinery. NO plugin
//                          implementations, no conductor-surface interfaces
//                          (dep: dropsh, pino)
//   - @bakers-build/conductor — run engine + the conductor-SURFACE CONTRACT
//                          (`./contract`) + the `conductor` command plugin, from
//                          the `conductor/` dir (dep: @bakers-build/core)
//   - @bakers-build/addon-*   — every mountable, incl. the three impl addons BB-224
//                          carved out of core (`addon-remote-drupal`,
//                          `addon-workspace-git`, `addon-auth-basic`), the
//                          command addon it carved out of the conductor command
//                          (`addon-deployment`, Finding 7) and the BB-220 pi
//                          agent (`addon-pi`)
//   - @bakers-build/bakers      — thin meta: bin bakers + ./plugins barrel (dep: conductor
//                          + ui + core + every published addon)
// Each package ships its own tsc `dist/src` output and gets staged in its own
// `publish/` dir, so `npm pack` + `npm publish` run against each independently.
// The dev workspace keeps `workspace:^` specifiers; none of that leaks into the
// published manifests, because we WRITE fresh manifests here rather than
// shipping the dev ones. `@bakers-build/addon-fake` stays workspace-only (test
// fixture, never published).
//
// Run AFTER building (`pnpm -r run build` — see `scripts/verify-package.mjs` /
// CI `publish:npm` for the exact sequence).
//
// Optional first arg / BB_PUBLISH_VERSION overrides the version (CI passes
// the git tag); otherwise the dev root package.json version is used. The same
// version stamps the whole set, and every `workspace:^` reference between them
// is rewritten to that version.
import {
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '..'); // conductor/
export const devVersion = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
).version;

/**
 * Normalize + validate a publish version. Tolerates a leading `v` (git tags are
 * `v1.2.3`; npm versions are `1.2.3`). Throws on anything that is not semver.
 */
export function resolveVersion(raw) {
  const version = String(raw).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(version)) {
    throw new Error(`prepare-publish: invalid version "${raw}"`);
  }
  return version;
}

const REPO_URL = 'git+https://git.key-tec.de/bakers-build/bakers-build.git';

/** Rewrite `workspace:^`-style deps to the publish `version`; pass others through. */
function rewriteWorkspaceRefs(deps, version) {
  if (!deps) return undefined;
  const out = {};
  for (const [name, spec] of Object.entries(deps)) {
    out[name] = spec.startsWith('workspace:') ? `^${version}` : spec;
  }
  return out;
}

/**
 * Copy every `files` glob from the package directory into `publish/`. A
 * directory match is copied recursively; a file match gets its parent dirs.
 */
function copyFilesEntries(abs, out, files) {
  for (const entry of files ?? []) {
    for (const match of globSync(entry, { cwd: abs })) {
      const from = resolve(abs, match);
      const to = resolve(out, match);
      if (statSync(from).isDirectory()) {
        cpSync(from, to, { recursive: true });
      } else {
        mkdirSync(dirname(to), { recursive: true });
        cpSync(from, to);
      }
    }
  }
}

/**
 * Fail if any `files` entry matches nothing in the staged directory. npm treats
 * an empty glob as silence; this is the guard that stops a silently empty
 * publish. README/LICENSE listed in `files` are generated after the copy, so
 * this runs after that generation.
 */
function assertFilesEntries(out, files, pkgName) {
  for (const entry of files ?? []) {
    if (globSync(entry, { cwd: out }).length === 0) {
      throw new Error(
        `prepare-publish: ${pkgName} files entry "${entry}" matched no file`,
      );
    }
  }
}

/**
 * Stage one workspace package into `<dir>/publish/`: write a fresh public
 * manifest (the package's own license, `publishConfig.access: public`, workspace
 * refs rewritten to the aligned version), copy every `files` entry from the
 * package directory, a README, the LICENSE (own or root) and any NOTICE. Throws
 * on a missing/UNLICENSED declaration or a non-MIT one without its own LICENSE. `readme` is 'npm' (ship README.npm.md — the end-user doc,
 * bakers meta only) or 'gen' (generate a short stub for core, the conductor, and
 * the addons). Throws if a `files` entry matches nothing in `publish/`.
 */
export function stagePackage({ dir, readme = 'gen' }, version) {
  const abs = resolve(root, dir);
  const pkg = JSON.parse(readFileSync(resolve(abs, 'package.json'), 'utf8'));
  // Declarations come from docs/bakers/licensing.md; never invent one at publish time.
  if (!pkg.license || pkg.license === 'UNLICENSED') {
    throw new Error(
      `prepare-publish: ${pkg.name} has no publishable license declaration`,
    );
  }
  const ownLicense = resolve(abs, 'LICENSE');
  if (pkg.license !== 'MIT' && !existsSync(ownLicense)) {
    throw new Error(
      `prepare-publish: ${pkg.name} declares ${pkg.license} but ships no LICENSE of its own`,
    );
  }
  // Third-party attributions the package must carry (e.g. Unicode data).
  const notice = resolve(abs, 'NOTICE');
  const hasNotice = existsSync(notice);
  const out = resolve(abs, 'publish');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const manifest = {
    name: pkg.name,
    version,
    description: pkg.description,
    type: 'module',
    license: pkg.license,
    ...(pkg.engines ? { engines: pkg.engines } : {}),
    ...(pkg.bin ? { bin: pkg.bin } : {}),
    exports: pkg.exports,
    // npm pack ships NOTICE only when `files` lists it.
    files: hasNotice ? [...pkg.files, 'NOTICE'] : pkg.files,
    publishConfig: { access: 'public' },
    repository: { type: 'git', url: REPO_URL, directory: `bakers-cli/${dir}` },
    ...(pkg.name === '@bakers-build/bakers'
      ? { keywords: ['bakers', 'conductor', 'cli', 'agent', 'drupal', 'jsonapi'] }
      : {}),
    ...(pkg.dependencies
      ? { dependencies: rewriteWorkspaceRefs(pkg.dependencies, version) }
      : {}),
    ...(pkg.peerDependencies
      ? {
          peerDependencies: rewriteWorkspaceRefs(pkg.peerDependencies, version),
        }
      : {}),
  };
  writeFileSync(
    resolve(out, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  copyFilesEntries(abs, out, pkg.files);

  // README: the bakers meta ships the end-user npm doc; every other package gets
  // a short generated stub pointing back at the repo.
  if (readme === 'npm') {
    cpSync(resolve(root, 'README.npm.md'), resolve(out, 'README.md'));
  } else {
    writeFileSync(
      resolve(out, 'README.md'),
      `# ${pkg.name}\n\n${pkg.description ?? ''}\n\n` +
        'Part of the bakers.build CLI. Install the meta package `@bakers-build/bakers` ' +
        'to get the `bakers` CLI with all addons. Source: ' +
        'https://git.key-tec.de/bakers-build/bakers-build (bakers-cli/).\n',
    );
  }
  // A package's own LICENSE wins; the root text is the shared keytec MIT license.
  cpSync(
    existsSync(ownLicense) ? ownLicense : resolve(root, 'LICENSE'),
    resolve(out, 'LICENSE'),
  );
  if (hasNotice) cpSync(notice, resolve(out, 'NOTICE'));

  assertFilesEntries(out, pkg.files, pkg.name);

  console.log(`prepare-publish: staged ${pkg.name}@${version} in ${out}`);
}

// The publish set is DERIVED, never hand-listed. Every workspace package under
// the roots below is published UNLESS its manifest sets `"private": true` — the
// one property that excludes `@bakers-build/addon-fake` (a test fixture), by an
// intrinsic fact about the package rather than by omission from a list someone
// must remember to edit. That omission shipped two broken releases already
// (`addon-essentials`, then `addon-name-refs`): a dependent went to npm with a
// `^x.y.z` ref to a package that was never staged/published. Discovery removes
// the whole class of "forgot to add it".
//
// Publish ORDER is a topological sort over the inter-package `workspace:` runtime
// edges (`dependencies` + `peerDependencies` — exactly what a consumer resolves),
// so every dependency is staged and published BEFORE the package that pins its
// exact version. `release.mjs` publishes in this order. Ties break
// alphabetically, so the order is deterministic across machines. The graph is
// guarded acyclic by `assert-acyclic.mjs`; a cycle here throws rather than loops.
// The intended layering (BB-215/224 reorg) is unchanged — it is now an OUTPUT
// of the dependency edges, not a hand-transcribed copy of them:
//   core → {conductor, addon-dropsh} → impl addons → addon-herdr → ui → bakers
const PUBLISH_ROOTS = ['core', 'conductor', 'message', 'ui', 'host'];

/** README kind: the meta ships the end-user npm doc, every other package a stub. */
function readmeFor(name) {
  return name === '@bakers-build/bakers' ? 'npm' : 'gen';
}

/** Every candidate publish dir: the fixed roots plus each `addons/*` dir. */
function candidateDirs() {
  const addons = readdirSync(resolve(root, 'addons'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `addons/${entry.name}`);
  return [...PUBLISH_ROOTS, ...addons].sort();
}

/**
 * Discover the whole publish set and return it in dependency-direction order:
 * non-private workspace packages only, topologically sorted over their
 * `workspace:` runtime edges with an alphabetical tie-break.
 */
function discoverTargets() {
  // 1. Non-private packages, indexed both ways (dir ↔ npm name) + their manifest.
  const dirs = [];
  const nameByDir = new Map();
  const dirByName = new Map();
  const manifestByDir = new Map();
  for (const dir of candidateDirs()) {
    let pkg;
    try {
      pkg = JSON.parse(
        readFileSync(resolve(root, dir, 'package.json'), 'utf8'),
      );
    } catch {
      continue; // no manifest → not a package
    }
    if (pkg.private) continue; // e.g. @bakers-build/addon-fake, the test fixture
    dirs.push(dir);
    nameByDir.set(dir, pkg.name);
    dirByName.set(pkg.name, dir);
    manifestByDir.set(dir, pkg);
  }

  // 2. In-set edges: a package must publish AFTER every workspace runtime dep it
  //    references (dependencies ∪ peerDependencies with a `workspace:` spec).
  const depsOf = new Map(); // dir → Set<dir> it must follow
  for (const dir of dirs) {
    const pkg = manifestByDir.get(dir);
    const set = new Set();
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        if (spec.startsWith('workspace:') && dirByName.has(name)) {
          set.add(dirByName.get(name));
        }
      }
    }
    depsOf.set(dir, set);
  }

  // 3. Kahn topological sort; alphabetical among ready nodes for determinism.
  const remaining = new Set(dirs);
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((dir) => [...depsOf.get(dir)].every((d) => !remaining.has(d)))
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `prepare-publish: dependency cycle among [${[...remaining].sort().join(', ')}]`,
      );
    }
    ordered.push(ready[0]);
    remaining.delete(ready[0]);
  }

  return ordered.map((dir) => ({ dir, readme: readmeFor(nameByDir.get(dir)) }));
}

// Single source of truth for the whole publish set — discovered from the
// workspace, not hand-listed. `release.mjs` iterates it, `verify-package.mjs`
// packs it, `bb-373-publish-set.test.ts` asserts it is dependency-closed.
export const TARGETS = discoverTargets();

/** Stage every package in the set at `version` (dependency refs aligned). */
export function stageAll(version) {
  for (const target of TARGETS) stagePackage(target, version);
}

// Only stage when run directly (`node prepare-publish.mjs [version]`); importing
// (e.g. from release.mjs) must not trigger a staging pass. Version precedence:
// arg → BB_PUBLISH_VERSION → workspace dev version.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const raw = process.argv[2] ?? process.env.BB_PUBLISH_VERSION ?? devVersion;
  stageAll(resolveVersion(raw));
}
