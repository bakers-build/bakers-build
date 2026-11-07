// BB-86 guard: assert the `@bakers-build/*` package graph stays acyclic and keeps
// the intended layered shape. Run in CI (via a vitest test) so a future
// dependency edit that reintroduces the old `addon-* -> bakers -> addon-*` cycle
// fails loudly instead of silently resurrecting the bundle-only `./plugins`
// workaround.
//
// BB-215 reorg: reads every `@bakers-build/*` package.json under the
// Storybook-faithful topology — `core` (the kernel), `host` (the CLI host,
// @bakers-build/bakers), `conductor` (the run engine, @bakers-build/conductor), `ui`, and
// `addons/*` (every mountable).
//
// BB-224 (Finding 6, decision 12) replaced the old flat rule ("every addon
// edges ONLY `@bakers-build/core`") with a LAYERED DAG, because the conductor-surface
// contract moved out of the kernel into `@bakers-build/conductor`:
//
//   layer 0  kernel            core                          → no @bakers-build/* edge
//   layer 1  core-only edges   conductor, addon-dropsh        → core only
//   layer 2  impl/command      addons/*                       → core + their
//                                                               surface-contract
//                                                               pkg + permitted
//                                                               sibling addons
//   layer 3  sinks             ui, host (@bakers-build/bakers)       → anything
//
// Layer 1 is a GRAPH POSITION, not a role: it is exactly "may edge only the
// kernel". `@bakers-build/conductor` is there because it OWNS the conductor-surface
// contract; `@bakers-build/addon-dropsh` is there only because its single
// `@bakers-build/*` edge is `core` — it is the `dropsh` COMMAND addon and owns no
// contract (its `src/` exports no types, and nothing peer-depends on it). The
// connection surface's typing lives in `@bakers-build/core`
// (`core/src/plugins/preset.ts` → `connectionPlugins: DropSHPlugin[]`) over
// dropsh's own `DropSHPlugin`.
//
// Asserted:
//   (a) no cycle (DFS) — the hard guarantee that the permitted sibling edges of
//       layer 2 still form a DAG;
//   (b) `@bakers-build/core` has zero `@bakers-build/*` edges (the surface-agnostic kernel);
//   (c) no package depends on `@bakers-build/bakers` (the meta is a leaf sink);
//   (d) the layer rules above, for every package under `addons/*`:
//       (d1) its `@bakers-build/*` edge set (deps ∪ peers) ⊆ {core, conductor,
//            addon-dropsh} ∪ PERMITTED_SIBLINGS[name];
//       (d2) it declares a surface-contract package (core and/or conductor) as a
//            PEER dependency, never as a bundled plain dependency — so the host
//            provides the single shared copy;
//       (d3) an addon that CONTRIBUTES to the conductor surface (its `src/preset.ts`
//            exports a `remotes`/`executors`/`workspaces`/`agents` accumulator)
//            MUST peer-depend on `@bakers-build/conductor` — the new ratchet that
//            replaced the old exact-`core`-peer one;
//       (d4) no addon edges a layer-3 sink (`@bakers-build/ui`, `@bakers-build/bakers`);
//       (d5) BB-373, symmetric to (d3): an addon that CONTRIBUTES to the UI
//            surface (its `src/preset.ts` exports a `uiEntries` accumulator)
//            MUST peer-depend on `@bakers-build/addon-bakers-ui`. The accumulator's
//            ELEMENTS are module paths — plain strings core types itself — but
//            what those modules compile against is that package's `./ui`
//            contract (the contribution types and `register`), which is what
//            makes it the UI surface's contract owner and not merely its first
//            implementation;
//   (e) the layer-1 packages (`@bakers-build/conductor`, `@bakers-build/addon-dropsh`)
//       edge nothing but `@bakers-build/core`.
// Exits non-zero with the offending edge on failure.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // bakers-cli/

const KERNEL = '@bakers-build/core';
/**
 * BB-661: the InboxMessageHandler contract package. Sits below the kernel —
 * core and conductor may both depend on it, nothing may depend on them for it.
 */
const MESSAGE = '@bakers-build/message';
const CONDUCTOR = '@bakers-build/conductor';
/**
 * The connection surface's command addon. It owns NO contract — the connection
 * typing lives in `@bakers-build/core` over dropsh's `DropSHPlugin`. It is named here
 * only because it sits at layer 1 by graph position (core-only edges).
 */
const CONNECTION = '@bakers-build/addon-dropsh';
/** Layer 1 = the core-only-edge packages. They may edge nothing but the kernel. */
const LAYER_1 = new Set([CONDUCTOR, CONNECTION]);
/** Layer 3: the sinks. No addon may edge these. */
const SINKS = new Set(['@bakers-build/ui', '@bakers-build/bakers']);
/**
 * The addon→addon edges the layered DAG explicitly permits (spec decision 10):
 * `addon-herdr` takes `loadInstructions` from `addon-workspace-git`, which owns it
 * since BB-224 moved it out of the kernel; and BB-351's `addon-essentials`
 * carries `addon-workspace` as a child, which is what makes the ambient-workspace
 * filler load on every connection without a config naming it. Acyclicity check
 * (a) is what keeps such sibling edges honest.
 */
const PERMITTED_SIBLINGS = {
  '@bakers-build/addon-herdr': ['@bakers-build/addon-workspace-git'],
  // The Orca host reuses herdr's launch wrapper, templates and base-ref
  // resolution (`addon-herdr/shared`) and the same `loadInstructions`.
  '@bakers-build/addon-orca': [
    '@bakers-build/addon-herdr',
    '@bakers-build/addon-workspace-git',
  ],
  // herdr-core reuses herdr's 0600 launch wrapper and its watch
  // (`addon-herdr/shared`).
  '@bakers-build/addon-herdr-core': ['@bakers-build/addon-herdr'],
  // BB-403 added `addon-name-refs` on the same footing `addon-workspace`
  // used to carry: an essentials child, so the single non-auth `plugins[]`
  // entry every committed config already carries stays exactly as it is.
  // BB-495 D1 removed `addon-workspace` from `addon-essentials`'s own
  // dependencies (the dropsh path stamps no ambient workspace any more), so
  // it is deliberately gone from here too — this is the ratchet: were that
  // dependency edge ever re-added, this guard would flag it rather than stay
  // silent because the entry still permitted it.
  '@bakers-build/addon-essentials': ['@bakers-build/addon-name-refs'],
  // BB-373: the UI surface's contract lives in `addon-bakers-ui` (the
  // contribution store, the contribution types, `register`), so a UI extension
  // addon edges it exactly as `addon-herdr` edges the owner of
  // `loadInstructions`. Acyclicity check (a) is what keeps it honest.
  '@bakers-build/addon-bakers-ui-artifacts': ['@bakers-build/addon-bakers-ui'],
  // BB-676 spec v2: `bakers ports` must not fire Docker calls itself
  // (operator decision 2026-10-15). `addon-ports` owns the `Claimer` contract
  // (its `./core` export) and loads claimer packages by name from its
  // settings, never depending on one; `addon-ddev` implements that contract
  // over `addon-docker-compose`'s generic container discovery.
  // `addon-ports` takes only the generic `ss` parser from
  // `addon-docker-compose`. BB-681 Task 1: `addon-ports-drupal` (the Drupal
  // host-header policy layer) is removed.
  '@bakers-build/addon-ports': ['@bakers-build/addon-docker-compose'],
  '@bakers-build/addon-ddev': [
    '@bakers-build/addon-ports',
    '@bakers-build/addon-docker-compose',
  ],
  // BB-681 Task 2/3/4: the pluggable-transport packages implement
  // `@bakers-build/addon-ports`'s `PortsTransport` contract (its `./core` export)
  // but are never depended on BY it — a one-directional edge, same shape as
  // `addon-ddev -> addon-ports` above.
  '@bakers-build/addon-ports-cloudflare': ['@bakers-build/addon-ports'],
  '@bakers-build/addon-ports-cloudflare-quick': ['@bakers-build/addon-ports'],
  '@bakers-build/addon-ports-frp': ['@bakers-build/addon-ports'],
  // `bakers deployment tickets` resolves identifiers through the Drupal remote
  // built from the connection alone, so it runs on a machine with no conductor.
  '@bakers-build/addon-deployment': ['@bakers-build/addon-remote-drupal'],
};
/** The conductor-surface preset accumulator names (see core's `SURFACE_KEYS`). */
const CONDUCTOR_PRESET_KEYS = [
  'remotes',
  'executors',
  'workspaces',
  'agents',
  'processHosts',
  // Addon inbox (BB-661): a value export, but it compiles against the
  // conductor's `InboxMessages`, so it makes the addon a conductor-surface
  // contributor.
  'inbox',
];
/**
 * The UI surface's contract owner, and the accumulator that names a contributor
 * to it (BB-373, see core's `SURFACE_KEYS.connection`).
 */
const UI = '@bakers-build/addon-bakers-ui';
const UI_PRESET_KEYS = ['uiEntries'];

function fail(msg) {
  console.error(`assert-acyclic: ${msg}`);
  process.exit(1);
}

/**
 * Does this addon contribute to the CONDUCTOR surface? Read from its `./preset`
 * source rather than a name pattern, so the ratchet cannot drift when a package
 * is renamed (BB-224 risk "assert-acyclic name-pattern drift").
 */
function contributesConductorSurface(dir) {
  return exportsAnyAccumulator(dir, CONDUCTOR_PRESET_KEYS);
}

/**
 * Does this addon contribute to the UI surface? Same construction as (d3) and
 * for the same reason — read from the `./preset` SOURCE, never from a name
 * pattern, so the ratchet cannot drift when a package is renamed.
 */
function contributesUiSurface(dir) {
  return exportsAnyAccumulator(dir, UI_PRESET_KEYS);
}

function exportsAnyAccumulator(dir, keys) {
  let src;
  try {
    src = readFileSync(join(dir, 'src/preset.ts'), 'utf8');
  } catch {
    return false;
  }
  return keys.some((key) =>
    new RegExp(`export\\s+const\\s+${key}\\b`).test(src),
  );
}

/** Collect every workspace package.json under core, host, conductor, ui, addons/*. */
function readPackages() {
  const pkgs = new Map(); // name -> { deps, peers, dir, group, conductorSurface }
  const bakers = (obj) =>
    new Set(Object.keys(obj ?? {}).filter((n) => n.startsWith('@bakers-build/')));
  const record = (dir, relDir, group) => {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      return;
    }
    if (!pkg.name?.startsWith('@bakers-build/')) return;
    pkgs.set(pkg.name, {
      deps: bakers(pkg.dependencies),
      peers: bakers(pkg.peerDependencies),
      dir: relDir,
      group,
      conductorSurface:
        group === 'addons' ? contributesConductorSurface(dir) : false,
      uiSurface: group === 'addons' ? contributesUiSurface(dir) : false,
    });
  };

  // `core`, `host`, `conductor`, and `ui` are single packages directly at their
  // dir — the kernel, the CLI host, the run engine, and the cockpit command app.
  record(join(root, 'core'), 'core', 'core');
  record(join(root, 'message'), 'message', 'message');
  record(join(root, 'host'), 'host', 'host');
  record(join(root, 'conductor'), 'conductor', 'conductor');
  record(join(root, 'ui'), 'ui', 'ui');

  // `addons/*` is a parent dir holding one package each.
  for (const group of ['addons']) {
    const base = join(root, group);
    let entries;
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(base, entry);
      if (!statSync(dir).isDirectory()) continue;
      record(dir, `${group}/${entry}`, group);
    }
  }
  return pkgs;
}

const pkgs = readPackages();
if (pkgs.size === 0) fail('found no @bakers-build/* packages');

// Full edge set (deps ∪ peers), restricted to @bakers-build/* → @bakers-build/*.
const edges = new Map(); // name -> Set<name>
for (const [name, info] of pkgs) {
  edges.set(name, new Set([...info.deps, ...info.peers]));
}

// (a) no cycle — DFS with a recursion stack.
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map([...pkgs.keys()].map((n) => [n, WHITE]));
const stack = [];
function visit(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const next of edges.get(node) ?? []) {
    if (!pkgs.has(next)) continue; // external @bakers-build/* (none expected)
    if (color.get(next) === GRAY) {
      const from = stack.slice(stack.indexOf(next)).join(' -> ');
      fail(`cycle detected: ${from} -> ${next}`);
    }
    if (color.get(next) === WHITE) visit(next);
  }
  stack.pop();
  color.set(node, BLACK);
}
for (const name of pkgs.keys()) {
  if (color.get(name) === WHITE) visit(name);
}

// (b) core may only edge the message base layer — the surface-agnostic kernel.
const core = edges.get(KERNEL);
if (core === undefined) fail(`missing ${KERNEL}`);
const coreExtra = [...core].filter((n) => n !== MESSAGE);
if (coreExtra.length > 0) {
  fail(`${KERNEL} must only edge ${MESSAGE}, found: ${coreExtra.join(', ')}`);
}

// message is the base layer: it must edge no other @bakers-build/* package.
const messageEdges = edges.get(MESSAGE);
if (messageEdges === undefined) fail(`missing ${MESSAGE}`);
if (messageEdges.size > 0) {
  fail(
    `${MESSAGE} must have zero @bakers-build/* deps, found: ${[...messageEdges].join(', ')}`,
  );
}

// (c) no edge to @bakers-build/bakers (the meta is a sink).
for (const [name, targets] of edges) {
  if (targets.has('@bakers-build/bakers')) {
    fail(`@bakers-build/bakers must have no incoming edge, but ${name} depends on it`);
  }
}

// (d) the layered rules for everything under `addons/*`.
let conductorSurfaceAddons = 0;
let uiSurfaceAddons = 0;
for (const [name, info] of pkgs) {
  if (info.group !== 'addons') continue;
  const all = new Set([...info.deps, ...info.peers]);
  const allowed = new Set([
    KERNEL,
    CONDUCTOR,
    CONNECTION,
    // BB-661: every message addon (one with contract-2 inbox messages)
    // depends on the message base layer for MessageDefinition/MessageResult,
    // the same footing core and conductor already have.
    MESSAGE,
    ...(PERMITTED_SIBLINGS[name] ?? []),
  ]);
  allowed.delete(name);

  // (d1) the edge set stays inside the addon's layer budget.
  const extra = [...all].filter((n) => !allowed.has(n));
  if (extra.length > 0) {
    fail(
      `${name} (addons/) may only edge to [${[...allowed].sort().join(', ')}], but also edges to: [${extra.join(', ')}]`,
    );
  }

  // (d4) no addon may edge a layer-3 sink.
  const toSink = [...all].filter((n) => SINKS.has(n));
  if (toSink.length > 0) {
    fail(
      `${name} (addons/) must not edge a sink, found: [${toSink.join(', ')}]`,
    );
  }

  // (d2) a surface contract must be a PEER, never a bundled dependency.
  const contractPeers = [...info.peers].filter(
    (n) => n === KERNEL || n === CONDUCTOR,
  );
  if (contractPeers.length === 0) {
    fail(
      `${name} (addons/) must peer-depend on a surface contract (${KERNEL} and/or ${CONDUCTOR}); found peers [${[...info.peers].join(', ')}]`,
    );
  }
  for (const contract of [KERNEL, CONDUCTOR, CONNECTION]) {
    if (info.deps.has(contract)) {
      fail(
        `${name} (addons/) must declare ${contract} as a peerDependency, not a dependency (the host provides the single copy)`,
      );
    }
  }

  // (d3) the conductor-surface ratchet.
  if (info.conductorSurface) {
    conductorSurfaceAddons++;
    if (!info.peers.has(CONDUCTOR)) {
      fail(
        `${name} (addons/) contributes to the conductor surface, so it must peer-depend on ${CONDUCTOR}; found peers [${[...info.peers].join(', ')}]`,
      );
    }
  }

  // (d5) the UI-surface ratchet, symmetric to (d3).
  //
  // The `uiEntries` accumulator's ELEMENTS are module paths — plain strings, so
  // core types them itself and the accumulator alone proves no edge. But what
  // those modules compile against is `@bakers-build/addon-bakers-ui/ui`: the
  // contribution types, and `register`, which is the only way to get a
  // contribution into the store at all. So a package that exports `uiEntries`
  // is by construction a consumer of that contract, and must declare it as a
  // peer — which is exactly what makes `addon-bakers-ui` the UI surface's
  // contract owner rather than merely its first implementation.
  if (info.uiSurface) {
    uiSurfaceAddons++;
    if (!info.peers.has(UI)) {
      fail(
        `${name} (addons/) contributes to the UI surface (its src/preset.ts exports uiEntries), so it must peer-depend on ${UI}; found peers [${[...info.peers].join(', ')}]`,
      );
    }
  }
}
// The ratchet must actually be armed: if the preset detection silently stops
// matching, the (d3) rule would pass vacuously for the whole tree.
if (conductorSurfaceAddons === 0) {
  fail(
    'detected no conductor-surface addon — the (d3) peer ratchet is not guarding anything',
  );
}
// Same argument for (d5): a silently-stopped detection would pass vacuously.
if (uiSurfaceAddons === 0) {
  fail(
    'detected no UI-surface addon — the (d5) peer ratchet is not guarding anything',
  );
}

// (e) layer 1: the core-only-edge packages edge nothing but the kernel.
for (const layer1 of LAYER_1) {
  const info = pkgs.get(layer1);
  if (info === undefined) fail(`missing layer-1 package ${layer1}`);
  const all = [...info.deps, ...info.peers].filter(
    (n) => n !== KERNEL && n !== MESSAGE,
  );
  if (all.length > 0) {
    fail(
      `${layer1} (layer 1) may only edge to ${KERNEL} or ${MESSAGE}, but also edges to: [${all.join(', ')}]`,
    );
  }
}

console.log(
  `assert-acyclic: OK — graph acyclic, layered core <- {conductor, addon-dropsh} <- addons/* <- {ui, bakers} ` +
    `(${pkgs.size} @bakers-build/* packages, ${conductorSurfaceAddons} conductor-surface addons, ` +
    `${uiSurfaceAddons} UI-surface addons)`,
);
