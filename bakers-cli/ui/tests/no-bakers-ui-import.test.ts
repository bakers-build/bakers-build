import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// BB-201 (was BB-194): the `@bakers-build/ui` command package must NOT statically
// import the renderer `@bakers-build/addon-bakers-ui` — it resolves the renderer
// DYNAMICALLY at runtime so the UI command stays independent of any one
// renderer (a swappable plugin). A static `import … from '@bakers-build/addon-bakers-ui'`
// re-couples them; fail loudly.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('@bakers-build/ui does not statically import the renderer (BB-201)', () => {
  it("has no `from '@bakers-build/addon-bakers-ui'` in src", () => {
    const offenders = tsFiles(srcDir).filter((f) =>
      /from\s+['"]@bakers-ai\/addon-bakers-ui['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
