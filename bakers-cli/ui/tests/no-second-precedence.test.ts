import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// BB-219 (AC-6): `@bakers-build/ui` must hold NO connection-precedence rule of its
// own. Core owns exactly one — `resolveBbConfigPath`/`loadBbConfig`, the
// same rule `bakers dropsh` uses — so a future precedence change lands in one
// place. AC-6 is worded structurally ("no existsSync chain of its own"), so it
// is checked structurally rather than by reading code: the two ways a second
// rule could grow back are a filesystem probe and a hand-built home-config
// path. Both are banned outright in `ui/src`.
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

/** Source with comments stripped: AC-6 bans a second *implementation*, and the
 *  prose explaining why core owns the rule must stay free to say so. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function offenders(pattern: RegExp): string[] {
  return tsFiles(srcDir)
    .filter((f) => pattern.test(code(f)))
    .map((f) => relative(srcDir, f));
}

describe('@bakers-build/ui holds no second connection-precedence rule (BB-219 AC-6)', () => {
  it('probes the filesystem nowhere in src — config discovery is core’s job', () => {
    expect(offenders(/\bexistsSync\b/)).toEqual([]);
  });

  it('never hand-builds a `<home>/.bakers/bakers.config.js` candidate', () => {
    // Any join()/template of the home dir with the connection file name is a
    // home-config candidate — i.e. the start of a precedence rule.
    expect(offenders(/['"`]bakers\.config\.js['"`]/)).toEqual([]);
  });

  it('does not re-implement the walk-up — it delegates to core’s resolver', () => {
    // `loadBbConfig` is the sanctioned entry point; a local loop over
    // dirname() looking for `.bakers` would be the second rule.
    expect(offenders(/['"`]\.bakers['"`]/)).toEqual([]);
  });
});
