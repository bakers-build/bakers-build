import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';

// BB-201: the ESLint-style module resolver, hoisted from the conductor's
// `config.ts` (`loadNamedPlugin`). A plugin name is resolved by trying each base
// in order (config dir → cwd → install) and returning the first
// `createRequire(base).resolve(name)` that succeeds. Bases are node module
// parents — an absolute file path OR a `file://` URL string; both are accepted
// by `createRequire`. Keeping this pure + shared lets the host, the connection
// loader, and the engine plugin loader all resolve identically.

/**
 * Bun's `createRequire` can succeed for a base with no `node_modules` by
 * returning a path under the isolated auto-install cache. That folder has no
 * sibling packages, so a contribution addon's nested imports fail (or load a
 * second copy of the kernel). Treat it as a miss and try the next base.
 */
function isBunIsolatedCachePath(resolved: string): boolean {
  const normalized = resolved.replaceAll('\\', '/');
  if (normalized.includes('/.bun/install/cache/')) return true;
  const cacheDir = process.env.BUN_INSTALL_CACHE_DIR;
  if (cacheDir === undefined || cacheDir === '') return false;
  const rel = relative(resolvePath(cacheDir), resolvePath(resolved));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolve `spec` against `bases`, ESLint-style: the first base whose
 * `createRequire(base).resolve(spec)` succeeds wins; returns that absolute
 * filesystem path. Returns `undefined` when no base resolves it.
 */
export function resolveModuleEslintStyle(
  spec: string,
  bases: string[],
): string | undefined {
  for (const base of bases) {
    try {
      const resolved = createRequire(base).resolve(spec);
      if (isBunIsolatedCachePath(resolved)) continue;
      return resolved;
    } catch {
      // try the next base
    }
  }
  return undefined;
}
