import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// The ~/.local/bin/bakers PATH shim resolves to (1) the build of the checkout named
// by a `.bakers-testbuild` marker at or above the working directory — the skill-test
// workspace, the one place a branch build is under test — or (2) the global
// @bakers-build/bakers everywhere else, INSIDE A PLAIN bakers.build CHECKOUT INCLUDED. A marker
// naming an unbuilt checkout must fail loudly instead of silently running other
// code. BB-390 scoped tier 1 to the workspace; it used to fire on the git
// toplevel, so an unbuilt branch build broke every unrelated `bakers` command in
// that worktree.
//
// We drive the canonical template through `sh` with fake node/bakers bins.

const TEMPLATE = fileURLToPath(
  new URL('../../templates/bakers.pathshim.sh', import.meta.url),
);

const SETUP = fileURLToPath(new URL('../../scripts/setup.sh', import.meta.url));

let template: string;

/** Write an executable `#!/bin/sh` that prints `marker`. */
function fakeBb(path: string, marker: string): void {
  writeFileSync(path, `#!/bin/sh\necho ${marker}\n`);
  chmodSync(path, 0o755);
}

/**
 * Render the shim and run it under a controlled PATH/cwd, returning trimmed
 * stdout — the tier marker (CHECKOUT / GLOBAL).
 *
 * `from` is where the shim is invoked: the workspace that carries the marker, a
 * per-ticket worktree nested inside it (which is where the conductor puts them,
 * so the walk has to pass through it), the plain checkout, or a directory
 * belonging to neither. `built` controls whether the checkout the marker names
 * carries its compiled dist.
 */
function runShim(opts: {
  from: 'workspace' | 'ticket-worktree' | 'checkout' | 'outside';
  built?: boolean;
}): string {
  const box = mkdtempSync(join(tmpdir(), 'pathshim-'));

  // The checkout the marker names. The tier-1 gate requires BOTH the launcher and
  // the compiled dist, so an unbuilt checkout must fail loudly rather than resolve
  // to any other bakers.
  const checkout = join(box, 'checkout');
  mkdirSync(join(checkout, 'bakers-cli', 'bin'), { recursive: true });
  fakeBb(join(checkout, 'bakers-cli', 'bin', 'bakers'), 'CHECKOUT');
  if (opts.built !== false) {
    mkdirSync(join(checkout, 'bakers-cli', 'conductor', 'dist', 'src'), {
      recursive: true,
    });
    writeFileSync(
      join(checkout, 'bakers-cli', 'conductor', 'dist', 'src', 'index.js'),
      '',
    );
  }

  // The test workspace and its marker: one line, the checkout's absolute path.
  const workspace = join(checkout, 'workspaces', 'bakers-playground');
  const ticketWorktree = join(workspace, '.bakers-worktrees', 'feat', 'x');
  mkdirSync(ticketWorktree, { recursive: true });
  writeFileSync(join(workspace, '.bakers-testbuild'), `${checkout}\n`);

  // Tier 2: the global bakers, alongside a fake `node` (the shim derives its
  // directory from `command -v node`), on the sandbox PATH.
  const bin = join(box, 'bin');
  mkdirSync(bin, { recursive: true });
  fakeBb(join(bin, 'bakers'), 'GLOBAL');
  fakeBb(join(bin, 'node'), 'NODE'); // never executed; only its dir matters

  const shim = join(box, 'bakers');
  writeFileSync(shim, template);
  chmodSync(shim, 0o755);

  const cwd = {
    workspace,
    'ticket-worktree': ticketWorktree,
    checkout,
    outside: box,
  }[opts.from];

  // Sandbox bin FIRST so the shim's node/bakers lookups hit our fakes; the system
  // dirs follow only to supply the coreutils (dirname, head) the shim calls.
  return execFileSync('/bin/sh', [shim], {
    cwd,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin` },
  }).trim();
}

describe('bakers.pathshim.sh resolution order', () => {
  beforeAll(() => {
    template = readFileSync(TEMPLATE, 'utf8');
  });

  it('AC-1: inside a .bakers-testbuild workspace, runs the named checkout build (tier 1 wins)', () => {
    expect(runShim({ from: 'workspace' })).toBe('CHECKOUT');
  });

  // The conductor's checkoutRoot is its config's DIRECTORY (`<workspace>/.bakers`),
  // so its per-ticket worktrees land inside the workspace. This is why the walk is
  // over the filesystem: a git-based lookup stops at such a worktree's own
  // toplevel and never sees the marker two levels up.
  it('finds the marker from a per-ticket worktree nested in the workspace', () => {
    expect(runShim({ from: 'ticket-worktree' })).toBe('CHECKOUT');
  });

  it('a marker naming an unbuilt checkout fails instead of falling back to the global', () => {
    expect(() => runShim({ from: 'workspace', built: false })).toThrow(
      /which is not built/,
    );
  });

  // BB-390's behaviour change, and the reason the ticket exists: the checkout
  // carries a launcher AND a built dist here, and is still not selected. An
  // unbuilt or broken branch build must not break unrelated tooling in the
  // worktree that holds it.
  it('inside a plain bakers checkout runs the GLOBAL cli, not the checkout build', () => {
    expect(runShim({ from: 'checkout' })).toBe('GLOBAL');
  });

  it('outside any workspace falls back to the global (tier 2)', () => {
    expect(runShim({ from: 'outside' })).toBe('GLOBAL');
  });

  // A third "primary clone" tier — an absolute bakers-cli/bin/bakers path baked into
  // the shim by setup.sh — silently ran one clone's dev build in EVERY other
  // project, so `bakers version` reported that clone's unbumped 0.0.1 instead of
  // the released global. The two tiers above are the whole contract: the test
  // workspace's checkout, otherwise the published CLI.
  it('carries no clone-path tier — the template is the shim, verbatim', () => {
    // No render placeholder: nothing can be substituted into the installed shim.
    expect(template).not.toMatch(/__[A-Z_]+__/);
    // Exactly two exec targets — the checkout the marker names and the node bin dir.
    const execs = template.match(/^\s*exec .*/gm) ?? [];
    expect(execs).toHaveLength(2);
    expect(execs[0]).toContain('$checkout/bakers-cli/bin/bakers');
    expect(execs[1]).toContain('dirname "$node_bin"');
  });

  // The marker is READ, never sourced: it holds a bare path, and sourcing a file
  // to obtain one string would be arbitrary code execution in every `bakers`
  // invocation on the machine.
  it('reads the marker instead of sourcing it, and forks no git', () => {
    expect(template).toMatch(/head -n1 "\$d\/\.bakers-testbuild"/);
    const code = template
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(code).not.toMatch(/(^|[^\w])\.\s+["']?\$?\{?d\}?/);
    expect(code).not.toMatch(/(^|[^\w])git\s/);
  });

  it('setup.sh installs the template without substituting any path into it', () => {
    const setup = readFileSync(SETUP, 'utf8');
    expect(setup).not.toMatch(/PRIMARY_BB_BIN/);
    expect(setup).not.toMatch(/sed[^\n]*SHIM_SRC/);
  });
});
