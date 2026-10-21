import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The publish set's single source of truth. `release.mjs` iterates it,
// `prepare-publish.mjs` stages it — and `verify-package.mjs`, the release gate,
// must pack and install exactly it.
import { TARGETS } from '../../../scripts/prepare-publish.mjs';

const CLI_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VERIFY_SCRIPT = `${CLI_ROOT}scripts/verify-package.mjs`;

/** The `name` a workspace dir publishes under. */
function packageNameOf(dir: string): string {
  return JSON.parse(readFileSync(`${CLI_ROOT}${dir}/package.json`, 'utf8'))
    .name as string;
}

function targetDirs(): string[] {
  return (TARGETS as { dir: string }[]).map((t) => t.dir);
}

// BB-373 shipped `@bakers-build/addon-bakers-ui-artifacts`: it went into `TARGETS`
// and into `host/package.json`, but `verify-package.mjs` carried its OWN
// hardcoded addon list and therefore packed one tarball fewer than the staged
// `host` manifest depends on. That break only fires in `publish:npm`, i.e. on a
// semver tag, where a half-published version cannot be re-published under the
// same number. These cases run on every pipeline instead, and they fail for any
// future package too — because they compare the gate against the list rather
// than against a copy of it.
describe('BB-373 release gate covers the published package set', () => {
  it('verify-package derives its package set from TARGETS', async () => {
    // Assert the main-module guard BEFORE importing: an unguarded
    // `verify-package.mjs` runs `npm pack` on 19 dirs and a real `npm install`
    // over the network, which must never happen inside a unit test.
    const guard = 'import.meta.url === pathToFileURL(process.argv[1]).href';
    const source = readFileSync(VERIFY_SCRIPT, 'utf8');
    expect(
      source.includes(guard)
        ? 'verify-package.mjs only runs when invoked directly'
        : 'verify-package.mjs runs on import — it would npm pack + npm install',
    ).toBe('verify-package.mjs only runs when invoked directly');

    const gate = await import(VERIFY_SCRIPT);
    // Both the dirs it packs and the names it asserts on after the install come
    // from TARGETS — no second list to forget.
    expect(gate.PUBLISH_DIRS).toEqual(
      targetDirs().map((dir) => `${CLI_ROOT}${dir}/publish`),
    );
    expect(gate.PUBLISH_PACKAGE_NAMES).toEqual(targetDirs().map(packageNameOf));
  });

  it('every @bakers-ai dependency of the CLI host is in the published set', () => {
    // The single `npm install <all tarballs>` the gate performs has to satisfy
    // the staged `host` manifest offline; a `@bakers-build/*` dep outside the set is
    // exactly the failure BB-373 introduced.
    const host = JSON.parse(
      readFileSync(`${CLI_ROOT}host/package.json`, 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const published = new Set(targetDirs().map(packageNameOf));
    const missing = Object.keys(host.dependencies ?? {}).filter(
      (name) => name.startsWith('@bakers-build/') && !published.has(name),
    );
    expect(missing).toEqual([]);
  });

  // The invariant `@bakers-build/addon-name-refs` actually violated, and the one the
  // host-direct-deps test above CANNOT see. `addon-essentials` shipped a
  // `workspace:^` (→ `^x.y.z`) edge to `addon-name-refs`, which was absent from
  // the set; because name-refs is a TRANSITIVE dep (host → essentials →
  // name-refs), host's own dependencies never named it and the release went out
  // broken. Assert the set is CLOSED: every workspace runtime edge of every
  // published package points back into the published set.
  it('the published set is closed under workspace dependencies', () => {
    const published = new Set(targetDirs().map(packageNameOf));
    const gaps: string[] = [];
    for (const dir of targetDirs()) {
      const pkg = JSON.parse(
        readFileSync(`${CLI_ROOT}${dir}/package.json`, 'utf8'),
      ) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      for (const field of ['dependencies', 'peerDependencies'] as const) {
        for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
          if (
            spec.startsWith('workspace:') &&
            name.startsWith('@bakers-build/') &&
            !published.has(name)
          ) {
            gaps.push(
              `${pkg.name} → ${name} (workspace dep not in publish set)`,
            );
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  // Order guarantee `release.mjs` relies on: it publishes TARGETS front to back,
  // so a dependency must appear before the package that pins its exact version.
  it('publishes every workspace dependency before its dependent', () => {
    const indexOf = new Map(
      targetDirs().map((dir, i) => [packageNameOf(dir), i]),
    );
    const violations: string[] = [];
    for (const dir of targetDirs()) {
      const pkg = JSON.parse(
        readFileSync(`${CLI_ROOT}${dir}/package.json`, 'utf8'),
      ) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      for (const field of ['dependencies', 'peerDependencies'] as const) {
        for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
          if (
            spec.startsWith('workspace:') &&
            indexOf.has(name) &&
            (indexOf.get(name) as number) >= (indexOf.get(pkg.name) as number)
          ) {
            violations.push(
              `${name} publishes at/after its dependent ${pkg.name}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // The set is DISCOVERED (all non-private workspace packages), so `private:
  // true` is the ONLY thing keeping a fixture like `@bakers-build/addon-fake` off npm.
  // Guard both directions: no private package leaks in, AND at least one private
  // package exists — otherwise the filter is a silent no-op that would start
  // publishing fixtures the day someone drops the flag.
  it('excludes private workspace packages, and the exclusion is armed', () => {
    const publishedDirs = new Set(targetDirs());
    const addonDirs = readdirSync(`${CLI_ROOT}addons`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `addons/${entry.name}`);
    const privateDirs = [
      'core',
      'conductor',
      'ui',
      'host',
      ...addonDirs,
    ].filter((dir) => {
      try {
        return (
          (
            JSON.parse(
              readFileSync(`${CLI_ROOT}${dir}/package.json`, 'utf8'),
            ) as { private?: boolean }
          ).private === true
        );
      } catch {
        return false;
      }
    });
    expect(privateDirs.length).toBeGreaterThan(0);
    for (const dir of privateDirs) expect(publishedDirs.has(dir)).toBe(false);
  });
});
