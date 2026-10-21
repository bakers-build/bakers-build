import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The local conductor registry must not grow back.
 *
 * It is the kind of thing that returns by accident: a second list of
 * conductors is an obvious-looking convenience right up to the moment it
 * disagrees with the control plane, which on this machine it did — seven
 * entries, one naming a directory that no longer existed and one a checkout
 * the control plane had superseded. A grep is a blunt guard, but the failure
 * mode it guards against is exactly a plausible-looking reintroduction.
 */
describe('~/.bakers/conductors.json stays gone', () => {
  const FORBIDDEN = [
    'conductors.json',
    'listRegisteredConductors',
    'getRegisteredConductor',
    'removeConductor',
    'conductorRegistryPath',
    'ConductorRegistryEntry',
  ];

  it('is named by no source file in the workspace', () => {
    const files = sourceFiles(workspaceRoot());
    // A scan that reaches nothing passes vacuously — which this guard did on
    // its first run, off by one directory level. Assert it found the workspace
    // before trusting that the workspace is clean.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const text = codeOf(readFileSync(file, 'utf8'));
      for (const needle of FORBIDDEN) {
        if (text.includes(needle)) {
          offenders.push(`${file}: ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The strip is what makes this guard's verdict meaningful, so it is asserted
  // rather than assumed: a guard that quietly ate a code line would pass for
  // the wrong reason, which is the same class of defect as the vacuous scan
  // the check above exists for.
  it('strips prose but never code', () => {
    expect(codeOf('// the old ~/.bakers/conductors.json')).not.toContain(
      'conductors.json',
    );
    expect(codeOf(' * read from `conductors.json`')).not.toContain(
      'conductors.json',
    );
    expect(codeOf("const p = join(home, 'conductors.json');")).toContain(
      'conductors.json',
    );
    // A trailing comment on a code line is NOT stripped — half a line cannot be
    // removed without risking the code beside it, and flagging it is the safe
    // direction to be wrong in.
    expect(codeOf('const p = x; // conductors.json')).toContain(
      'conductors.json',
    );
  });
});

/**
 * The source with whole-line comments removed.
 *
 * The rule this guard enforces is that no source file READS the store — not
 * that no source file may explain why the store is gone. Several files must say
 * so precisely, naming the file, or a reader cannot connect the explanation to
 * anything; a grep that forbade the name outright would make the code less
 * honest to protect a string.
 *
 * Only lines that are ENTIRELY comment are dropped, never a trailing `//` on a
 * code line: stripping mid-line would risk eating a real occurrence (a needle
 * concatenated after a `//` inside a string literal), and this guard must fail
 * loudly rather than quietly.
 */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(
        t.startsWith('//') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.startsWith('*/')
      );
    })
    .join('\n');
}

/** The bakers-cli workspace root (the dir holding core/, conductor/, ui/). */
function workspaceRoot(): string {
  // core/tests/core/<file> → core/tests/core → core/tests → core → bakers-cli
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

/**
 * Every `src/**\/*.ts` of every workspace package.
 *
 * Tests are excluded on purpose: this file names the forbidden strings itself,
 * and so does the test asserting `start` writes no such file.
 */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const packages = ['core', 'conductor', 'ui', 'host'];
  const addonsDir = join(root, 'addons');
  for (const entry of readdirSync(addonsDir)) {
    packages.push(join('addons', entry));
  }
  for (const pkg of packages) {
    walk(join(root, pkg, 'src'), out);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
}
