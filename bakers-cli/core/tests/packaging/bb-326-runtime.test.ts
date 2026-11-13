import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The publish set's single source of truth: `TARGETS` is the list `release.mjs`
// iterates and `prepare-publish.mjs` stages, so deriving from it can never
// disagree with what actually ships. A glob over `addons/*` would also pick up
// the workspace-only `@bakers-build/addon-fake`, and would silently keep passing if a
// package were dropped from the publish set.
import { TARGETS } from '../../../scripts/prepare-publish.mjs';

const CLI_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The 17 published package source dirs, in publish order. */
function publishedPackageDirs(): string[] {
  return TARGETS.map((t: { dir: string }) => `${CLI_ROOT}${t.dir}`);
}

/**
 * Every workspace member — the published set plus the workspace-only fake addon
 * and the private workspace root. The `bun` / `@opentui/core` ownership rule is
 * about the whole tree, not only what ships: a `bun` added to the root
 * devDependencies would never reach npm and would still make the runtime
 * ambiguous for anyone building here.
 */
function workspacePackageDirs(): string[] {
  return [...publishedPackageDirs(), `${CLI_ROOT}addons/fake`, CLI_ROOT];
}

function manifestOf(dir: string): Record<string, never> & {
  name?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
}

// BB-326 moved `bakers ui` onto a Bun runtime and OpenTUI. Each criterion below
// is a property of a manifest, a deleted directory or a link — none of them has
// a runtime test that would notice a regression, and all four are things a
// later, unrelated edit can undo by accident.
describe('BB-326 runtime packaging', () => {
  it('no published package raises engines.node', () => {
    const dirs = publishedPackageDirs();
    // Guards the derivation itself: an empty or truncated list would make every
    // assertion below vacuously true. 21 since BB-403 published
    // `@bakers-build/addon-name-refs` — the addon-rename package that
    // `addon-essentials` had depended on but that was never in TARGETS, so it
    // shipped a broken 0.11.0. 20 before that (BB-351 added
    // `@bakers-build/addon-workspace`, BB-373 `@bakers-build/addon-bakers-ui-artifacts`,
    // BB-347 `@bakers-build/addon-grok`). Since TARGETS is now DISCOVERED from the
    // workspace (every non-private package), this number is the deliberate canary
    // that forces a human to acknowledge the set changing — bump it, with a
    // reason, whenever a publishable package is added or removed.
    // The agents command adds one publishable package without raising Node requirements.
    // 24 since BB-475 published TWO packages: `@bakers-build/addon-ports`, the
    // command half of the ports feature (worktree service discovery + tunnels),
    // and `@bakers-build/addon-ports-ui`, the cockpit half (the Ports tab). Neither
    // sets `engines`, so neither raises the Node floor.
    // 25 since BB-495 published `@bakers-build/addon-info` — the `bakers info`
    // command, the fallback that resolves project/workspace context live for
    // an agent the conductor did not start. It sets no `engines`, so it does
    // not raise the Node floor either.
    // 24 again since the Ports tab moved onto addon actions: the Addons tab of
    // `bakers ui` renders it from the server, so `@bakers-build/addon-ports-ui` is gone.
    // 25 since BB-661 published `@bakers-build/message` — the InboxMessageHandler
    // contract package, cut top-level like `ui` rather than folded into
    // `core`/`conductor`. It sets `engines.node` to the same `>=20.19` floor
    // every other package already uses, so it does not raise the Node floor.
    // The personal evidence command adds the publishable track addon.
    // BB-676 spec v2 split `@bakers-build/addon-ports`'s container
    // discovery into two new packages, `@bakers-build/addon-docker-compose`
    // (generic Docker Compose discovery) and a container-runtime addon
    // (runtime-specific interpretation + the claim contract) — `bakers ports`
    // must not fire `docker` calls itself. Neither sets `engines`, so neither
    // raises the Node floor.
    // BB-676 spec v3 also split Drupal's host-header policy out of that
    // runtime addon into `@bakers-build/addon-ports-drupal` — runtime
    // discovery must do nothing CMS-specific. It sets no `engines` either.
    // 28 since BB-681 Task 1 removed `@bakers-build/addon-ports-drupal` again —
    // the generic ports pipeline must stay transport/CMS-neutral.
    // 31 since BB-681 Tasks 2-4 published three pluggable `PortsTransport`
    // packages: `@bakers-build/addon-ports-cloudflare` (Named Cloudflare, the
    // reference implementation), `@bakers-build/addon-ports-frp` and
    // `@bakers-build/addon-ports-cloudflare-quick`. None sets `engines`, so none
    // raises the Node floor.
    // 32 since `@bakers-build/addon-orca` (the Orca executor + workspace host)
    // joined the published set; it sets no `engines`.
    // 33 since `@bakers-build/addon-herdr-core` (the herdr-core executor); it
    // sets no `engines`.
    // 36 since the forge addon and its GitHub and GitLab backends; none sets
    // `engines`.
    // Tailscale adds one optional machine addon with the same Node floor.
    // 38 since `@bakers-build/addon-runtime-docker` (the Docker runtime); it
    // sets no `engines`.
    // External Bubblewrap runtime adds one independently published addon.
    expect(dirs).toHaveLength(39);
    for (const dir of dirs) {
      const engines = manifestOf(dir).engines?.node;
      if (engines !== undefined)
        expect(`${dir}: ${engines}`).toBe(`${dir}: >=20.19`);
    }
  });

  it('bun and @opentui/core live in exactly one manifest', () => {
    for (const dependency of ['bun', '@opentui/core']) {
      const owners = workspacePackageDirs().filter((dir) => {
        const manifest = manifestOf(dir);
        return (
          manifest.dependencies?.[dependency] !== undefined ||
          manifest.devDependencies?.[dependency] !== undefined ||
          manifest.peerDependencies?.[dependency] !== undefined
        );
      });
      expect(owners.map((d) => d.slice(CLI_ROOT.length))).toEqual([
        'addons/bakers-ui',
      ]);
    }
  });

  it('the spike is gone and CI has no spike job', () => {
    expect(existsSync(`${CLI_ROOT}spikes`)).toBe(false);
    expect(readFileSync(`${REPO_ROOT}.gitlab-ci.yml`, 'utf8')).not.toContain(
      'tui_spike',
    );
  });
});
