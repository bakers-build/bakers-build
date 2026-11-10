// @bakers-schema-version 2
// Canonical PROJECT config for a bakers.build target repo (BB-215 addon
// form), committed as `.bakers/project.config.js`. This is the run machinery
// only (server/executor/worktree). The CONNECTION surface (site + auth +
// renderer) is private (`~/.bakers/connections/default.js`, see the sibling
// `connection.config.js`); `bakers tools` reads only that small file (BB-201
// split preserved). A conductor is this machine (`~/.bakers/machine.config.js`)
// + this project + the variant (`project.<name>.config.js`). BAKERS_PROJECT
// overrides `project.name` for one shell.
//
// Storybook-style `addons: []` — each entry names a package; the addon's own
// `./preset` self-declares what it contributes (its `.kind`), so there is NO
// per-slot `export:`/kind wiring:
//   - `@bakers-build/addon-remote-drupal` → the Drupal control-plane server (sole
//                                 server). BB-224 replaced the deleted
//                                 `@bakers-build/core/builtins` preset with it.
//   - `@bakers-build/addon-herdr`    → executor + worktree from ONE entry (the pairing
//                                 is encoded in its preset). No more
//                                 `export: 'herdrWorkspace'`. Lifecycle hooks are
//                                 TOP-LEVEL `hooks:` (BB-84), not `with.hooks`.
// `~/.bakers/machine.config.js` carries the same `addons: []`, read the same way.
// Each addon declares where it may be listed (its preset `scopes`): agent
// harnesses go in the machine file, these engine addons here, and an addon
// allowed in both (e.g. `@bakers-build/addon-ports`) takes the machine entry's `with`.

/** @type {import('@bakers-build/core').ProjectConfig} */
export default {
  schema_version: 2,
  project: { name: 'bakers-playground' },
  // The run budget (max_parallel) is set on the machine in the backend,
  // default 5. See bakers-cli/CONFIG.md.
  // Optional state narrowing (BB-207): serves every claimable state in the
  // project by default; add a `states` array to restrict this conductor.
  // Self-declaring addons (BB-215): each package contributes its own slots.
  // The auth `plugins[]` is NOT here — it lives in the connection config
  // (BB-201). Agents are NOT here either — agent addons
  // declare the machine scope (`~/.bakers/machine.config.js` `addons[]`). This
  // list holds the server/executor/worktree engine wiring.
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
  // Lifecycle hooks are run by the conductor, best-effort, from the config TOP
  // LEVEL (BB-84); the herdr addon rejects the old `with.hooks` form. Uncomment
  // and name your own provisioning/teardown commands; omit `hooks` entirely for none.
  // hooks: { after_create: 'my-provision-command', after_done: 'my-teardown-command' },
};

// ─── Explicit slots ───────────────────────────────────────────────────────
// A config may also name server, executor, and worktree explicitly (an
// explicit slot WINS over a discovered addon of the same kind):
//
//   server:   { use: '@bakers-build/addon-remote-drupal' },
//   executor: { use: '@bakers-build/addon-herdr' },
//   worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
