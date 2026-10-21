import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk from this module to the `@bakers-build/core` package root (first ancestor
 *  holding a `package.json`). Works from `src/` (dev) and `dist/` (built). */
export function corePackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('@bakers-build/core package root not found');
    }
    dir = parent;
  }
}
