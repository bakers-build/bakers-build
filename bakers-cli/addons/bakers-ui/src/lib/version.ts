// BB-375 — resolve the version shown in the global footer.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNKNOWN = '0.0.0';

let cached: string | undefined;

/**
 * Host/`bakers` CLI version when linked; otherwise this addon's package.json.
 * Cached — the footer reads it every frame.
 */
export const resolveBbVersion = (): string => {
  if (cached !== undefined) return cached;
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve('@bakers-build/bakers/package.json');
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      version?: string;
    };
    if (typeof pkg.version === 'string' && pkg.version !== '') {
      cached = pkg.version;
      return cached;
    }
  } catch {
    // Host package is optional in addon-only layouts.
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as {
        name?: string;
        version?: string;
      };
      if (
        (pkg.name === '@bakers-build/addon-bakers-ui' ||
          pkg.name === '@bakers-build/bakers') &&
        typeof pkg.version === 'string' &&
        pkg.version !== ''
      ) {
        cached = pkg.version;
        return cached;
      }
    } catch {
      // Keep walking.
    }
    dir = dirname(dir);
  }
  cached = UNKNOWN;
  return cached;
};
