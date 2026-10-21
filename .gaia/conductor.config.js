// @gaia-schema-version 1
// Canonical GAIA conductor engine configuration — committed.
// Host identity comes from machine.config.js; the optional local override
// composes this project's conductor identity. Connections belong to gaia.config.js.
//
// IMPORT-FREE (GAIA-78): the plugin slots are `{ plugin, with }` descriptors
// naming the REAL published package, not `import`ed constructors.
// loadConductorConfig resolves each name ESLint-style (config dir → cwd →
// conductor install). Every addon package default-exports its single factory, so
// no slot needs an `export:` — EXCEPT the merged herdr workspace
// (`@gaia-ai/addon-herdr` default-exports the executor, so the workspace names
// `export: 'herdrWorkspace'` — GAIA-139). GAIA-224 replaced the old
// `{ plugin: '@gaia-ai/gaia/plugins', export: 'drupalRemote' }` host-barrel
// descriptor with the real addon package `@gaia-ai/addon-remote-drupal`.

// The user-global machine context: host identity and capacity, shared
// by every project on this machine. Never committed.
async function loadMachine() {
  try {
    return (await import(`${process.env.GAIA_HOME ?? `${process.env.HOME}/.gaia`}/machine.config.js`)).default ?? {};
  } catch {}
  return {};
}

// OPTIONAL per-project override — create conductor.config.local.js beside this
// file to override machine-local values (conductor_id, model, …).
async function loadLocal() {
  try { return (await import('./conductor.config.local.js')).default ?? {}; } catch {}
  return {};
}

const machine = await loadMachine();
const local = await loadLocal();
const project = "bakers-build";
const composedConductorId =
  machine.user_id && machine.machine_id
    ? `${machine.user_id}-${machine.machine_id}-${project}`
    : undefined;

export default {
  schema_version: 1,
  gaia: { project: "bakers-build" },
  // Registration key (GAIA-353 renamed from machine_id). Host capacity lives on
  // machine.config.js as max_parallel — do not set max_parallel here.
  conductor_id: local.conductor_id ?? composedConductorId,
  // Set to false to keep this conductor's transcripts out of the log store
  // (e.g. large, uninteresting, or subject to a local policy). Default true;
  // metrics are unaffected either way.
  capture_logs: true,
  remote: { plugin: '@gaia-ai/addon-remote-drupal' },
  executor: { plugin: '@gaia-ai/addon-herdr' },
  addons: [{ use: '@gaia-ai/addon-herdr' }],
  // GAIA-139: the herdr workspace ships in @gaia-ai/addon-herdr, which
  // default-exports the EXECUTOR — so the workspace slot names export: 'herdrWorkspace'.
  workspace: {
    plugin: '@gaia-ai/addon-herdr',
    export: 'herdrWorkspace',
  },
};
