import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The @bakers-build/* package graph must stay acyclic (BB-86) and keep the BB-224
// LAYERED shape (core <- {conductor, addon-dropsh} <- addons/* <- {ui, bakers}).
// This test runs the standalone guard script so `pnpm run test` (hence CI) fails
// if a future dependency edit reintroduces a cycle, a back-edge to
// @bakers-build/bakers, or an addon that skips its surface-contract peer.
const SCRIPT = fileURLToPath(
  new URL('../../scripts/assert-acyclic.mjs', import.meta.url),
);

describe('@bakers-build/* dependency graph', () => {
  it('is acyclic + layered: core <- {conductor, addon-dropsh} <- addons/* <- {ui, bakers}', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8' });
    expect(out).toContain('graph acyclic');
    expect(out).toContain(
      'core <- {conductor, addon-dropsh} <- addons/* <- {ui, bakers}',
    );
  });

  // BB-224 risk mitigation: the conductor-surface peer ratchet (rule d3) is
  // detected from each addon's `./preset` source, not from a name pattern — so a
  // rename cannot silently disarm it. Assert it is actually guarding something.
  it('arms the conductor-surface peer ratchet on real addons', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8' });
    const m = out.match(/(\d+) conductor-surface addons/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThan(0);
  });
});
