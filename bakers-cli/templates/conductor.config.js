// Canonical CONDUCTOR engine config for a bakers.build target repo (BB-215 addon
// form). This is the CONDUCTOR surface only — the run machinery
// (remote/executor/workspace/agent). The CONNECTION surface (site + auth +
// renderer) lives in the sibling `bakers.config.js`; `bakers tools` reads only that
// small file (BB-201 split preserved). The file carries no identity: a conductor
// is this machine (`~/.bakers/machine.config.js`) + this project + the variant
// (this file's stem). Local overrides (`conductor.config.local.js`) supply only
// local values such as the project name.
//
// Storybook-style `addons: []` — each entry names a package; the addon's own
// `./preset` self-declares what it contributes (its `.kind`), so there is NO
// per-slot `export:`/kind wiring:
//   - `@bakers-build/addon-remote-drupal` → the Drupal control-plane remote (sole
//                                 remote). BB-224 replaced the deleted
//                                 `@bakers-build/core/builtins` preset with it.
//   - `@bakers-build/addon-herdr`    → executor + workspace from ONE entry (the pairing
//                                 is encoded in its preset). No more
//                                 `export: 'herdrWorkspace'`. Lifecycle hooks are
//                                 TOP-LEVEL `hooks:` (BB-84), not `with.hooks`.
// `~/.bakers/machine.config.js` carries the same `addons: []`, read the same way.
// Each addon declares where it may be listed (its preset `scopes`): agent
// harnesses go in the machine file, these engine addons here, and an addon
// allowed in both (e.g. `@bakers-build/addon-ports`) takes the machine entry's `with`.

async function loadLocal() {
  try {
    return (await import('./conductor.config.local.js')).default ?? {};
  } catch {}
  return {};
}

const local = await loadLocal();

export default {
  project: local.project ?? 'bakers-playground',
  // The run budget (max_parallel) is set on the machine in the backend,
  // default 5. See bakers-cli/CONFIG.md.
  // Optional state narrowing (BB-207): serves every claimable state in the
  // project by default; add a `states` array to restrict this conductor.
  // Self-declaring addons (BB-215): each package contributes its own slots.
  // The auth `plugins[]` is NOT here — it lives in the connection config
  // `bakers.config.js` (BB-201). Agents are NOT here either — agent addons
  // declare the machine scope (`~/.bakers/machine.config.js` `addons[]`). This
  // list holds the remote/executor/workspace engine wiring.
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
  // Lifecycle hooks are run by the conductor, best-effort, from the config TOP
  // LEVEL (BB-84); the herdr addon rejects the old `with.hooks` form. Uncomment
  // and name your own provisioning/teardown commands; omit `hooks` entirely for none.
  // hooks: { after_create: 'my-provision-command', after_done: 'my-teardown-command' },
};

// ─── Back-compat: non-agent pre-BB-215 slots still load unchanged ─────────
// A config may still name remote, executor, and workspace explicitly (an
// explicit slot WINS over a discovered addon of the same kind). Retired agent
// slots must move through `bakers config upgrade --scope all` so their package
// wiring and machine-local policy are separated safely:
//
//   remote:    { plugin: '@bakers-build/addon-remote-drupal' },
//   executor:  { plugin: '@bakers-build/addon-herdr' },
//   workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
