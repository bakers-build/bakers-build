import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * BB-326 — the shared PTY key scripts have exactly ONE definition site.
 *
 * Two drivers walk these screens: the real-PTY screen verifier
 * (`tests/pty/verify-screen.mjs`) and the BB-322 measurement driver.
 * A verifier that
 * runs a different walk than the one the old kernel was measured with cannot
 * tell "the screen is right" from "the harness agrees with itself", so the two
 * must be structurally incapable of drifting apart. Copy-paste is the only way
 * they can drift, and this is the check that forbids it.
 *
 * It is a TEXT check, not a renderer check, so it belongs in the ordinary
 * vitest suite on Node and not in the Bun renderer suite.
 */

/** The repo root: this file sits at `<repo>/bakers-cli/addons/bakers-ui/tests/pty`. */
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));

/** The one file allowed to declare them. */
const DEFINITION_SITE = 'bakers-cli/addons/bakers-ui/tests/pty/key-script.mjs';

const EXPORTED_SCRIPTS = [
  'NEW_TICKET_KEY_SCRIPT',
  'TICKETS_KEY_SCRIPT',
  'DASHBOARD_KEY_SCRIPT',
];

/**
 * Every line in the repository that DECLARES `name`.
 *
 * `export const <name>` and not merely `<name>`: a re-export
 * (`export { NEW_TICKET_KEY_SCRIPT } from '…'`) and an import are exactly what
 * this rule wants and must not be counted as second definitions. `git grep`
 * rather than `grep -r`, so the search never walks `node_modules` — the PTY
 * harness installs its native deps right next to this file. `--untracked` so a
 * copy that has not been committed yet is caught by the author rather than by
 * the reviewer; it still honours `.gitignore`, so the exclusion holds.
 *
 * Two narrowings, both load-bearing and both found by running the check rather
 * than by reasoning about it:
 *
 *   `^export const` — the spec and the plan quote the declaration in prose and
 *   inside a code sample. Unanchored, this rule would report the DOCUMENT that
 *   describes it as a second definition site.
 *
 *   the module pathspec — only a file a runtime can import can be a definition
 *   site. A copy pasted into a `.md` is documentation, not drift.
 */
const MODULE_PATHSPEC = ['*.mjs', '*.cjs', '*.js', '*.mts', '*.cts', '*.ts'];

function definitionsOf(name: string): string[] {
  const found = execFileSync(
    'git',
    [
      'grep',
      '-n',
      '--untracked',
      '-e',
      `^export const ${name}`,
      '--',
      ...MODULE_PATHSPEC,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return found.split('\n').filter((line) => line.trim() !== '');
}

describe('the shared PTY key scripts have exactly one definition site', () => {
  for (const name of EXPORTED_SCRIPTS) {
    it(`${name} is defined once, in the real package`, () => {
      const hits = definitionsOf(name);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain(DEFINITION_SITE);
    });
  }
});
