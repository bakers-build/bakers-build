export const DEFAULT_CONDUCTOR_AGENT_ADDONS =
  "[{ use: '@bakers-build/addon-herdr' }, { use: '@bakers-build/addon-claude', alias: 'opus' }]";

/**
 * A dynamic-import expression for a user-global config file, as source text.
 *
 * The result goes into a COMMITTED file, so it must name no path from the
 * machine that generated it: an absolute path resolves nowhere on the next
 * checkout, and loadMachine() swallows that failure, leaving conductor_id
 * undefined with nothing erroring. BB_HOME is the relocation knob; HOME
 * stays the fallback so the generated text works on a machine that sets
 * neither.
 */
export function configImportExpression(name: string): string {
  return `\`\${process.env.BB_HOME ?? \`\${process.env.HOME}/.bakers\`}/${name}\``;
}
export type ConnectionAuthType =
  | 'oauth2_client_credentials'
  | 'oauth2_device_code';
/** Current connection template inputs never come from machine context. */
export interface ConnectionInputs {
  baseUrl: string;
  clientId: string;
  /** Absent for `oauth2_device_code`: a public client holds no secret. */
  secret?: string;
  workspaceId?: string;
  authType: ConnectionAuthType;
}
export function renderGlobalConnection(inputs: ConnectionInputs): string {
  // The device-code grant has no client_secret in @dropsh/plugin-oauth2's
  // config union, so the key is omitted rather than rendered undefined
  // (BB-496), and it carries device_authorization_url instead.
  const baseUrl = inputs.baseUrl.replace(/\/$/, '');
  // The client-credentials branch renders byte-identical to the pre-BB-496
  // template (a single-quoted `type:` literal): only the device-code branch,
  // which is new, uses JSON.stringify for its type value.
  const type =
    inputs.authType === 'oauth2_device_code'
      ? JSON.stringify(inputs.authType)
      : "'oauth2_client_credentials'";
  const credential =
    inputs.authType === 'oauth2_device_code'
      ? `client_id: ${JSON.stringify(inputs.clientId)},
      device_authorization_url: ${JSON.stringify(`${baseUrl}/oauth/device_authorization`)},`
      : `client_id: ${JSON.stringify(inputs.clientId)}, client_secret: ${JSON.stringify(inputs.secret ?? '')},`;
  return `// @bakers-schema-version 4
// Global bakers.build connection: credentials and optional legacy workspace. Keep this file private.
export default {
  schema_version: 4,
  site: { base_url: ${JSON.stringify(inputs.baseUrl)}, jsonapi_prefix: '/jsonapi' },
${inputs.workspaceId ? `  workspace_id: ${JSON.stringify(inputs.workspaceId)},\n` : ''}
  plugins: [
    { plugin: '@bakers-build/addon-essentials' },
    { plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: {
      id: 'bakers', default: true, type: ${type}, scope: 'bb:session',
      ${credential}
      token_url: ${JSON.stringify(`${baseUrl}/oauth/token`)},
    } },
  ],
};
`;
}
export function renderHostMachine(inputs: {
  machineId: string;
  userId: string;
  maxParallel: number;
}): string {
  return `// @bakers-schema-version 2
// Local host identity and capacity. Server credentials belong to bakers.config.js.
export default {
 schema_version: 2,
 machine_id: ${JSON.stringify(inputs.machineId)},
 user_id: ${JSON.stringify(inputs.userId)},
 max_parallel: ${inputs.maxParallel},
};
`;
}

export function renderCommittedConfig(inputs: {
  project: string;
  bakersWorkspace?: string;
  /**
   * The operator's own answer for each lifecycle hook — never invented here.
   * `bakers-cli` names no provisioning tool: an absent or empty command omits
   * that hook's key entirely, and an all-absent `hooks` omits the whole block
   * rather than writing an empty one, because an empty `hooks: {}` would
   * state a decision no one made.
   */
  hooks?: { after_create?: string; after_done?: string };
}): string {
  return `// Canonical bakers.build conductor engine configuration — committed.
// Host identity comes from machine.config.js; the optional local override
// composes this project's conductor identity. Connections belong to bakers.config.js.
//
// IMPORT-FREE (BB-78): the plugin slots are \`{ plugin, with }\` descriptors
// naming the REAL published package, not \`import\`ed constructors.
// loadConductorConfig resolves each name ESLint-style (config dir → cwd →
// conductor install). Every addon package default-exports its single factory, so
// no slot needs an \`export:\` — EXCEPT the merged herdr workspace
// (\`@bakers-build/addon-herdr\` default-exports the executor, so the workspace names
// \`export: 'herdrWorkspace'\` — BB-139). BB-224 replaced the old
// \`{ plugin: '@bakers-build/bakers/plugins', export: 'drupalRemote' }\` host-barrel
// descriptor with the real addon package \`@bakers-build/addon-remote-drupal\`.

// The user-global machine context: host identity and capacity, shared
// by every project on this machine. Never committed.
async function loadMachine() {
  try {
    return (await import(${configImportExpression('machine.config.js')})).default ?? {};
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
const project = ${JSON.stringify(inputs.project)};
const composedConductorId =
  machine.user_id && machine.machine_id
    ? \`\${machine.user_id}-\${machine.machine_id}-\${project}\`
    : undefined;

export default {
  bakers: { project: ${JSON.stringify(inputs.project)}${inputs.bakersWorkspace ? `, workspace: ${JSON.stringify(inputs.bakersWorkspace)}` : ''} },
  // Registration key (BB-353 renamed from machine_id). Host capacity lives on
  // machine.config.js as max_parallel — do not set max_parallel here.
  conductor_id: local.conductor_id ?? composedConductorId,
  // Set to false to keep this conductor's transcripts out of the log store
  // (e.g. large, uninteresting, or subject to a local policy). Default true;
  // metrics are unaffected either way.
  capture_logs: true,
${
  inputs.hooks?.after_create || inputs.hooks?.after_done
    ? `  // Lifecycle hooks are executor-owned (BB-84): they live at the config top
  // level — NOT on a plugin descriptor's \`with.hooks\`.
  hooks: { ${[
    inputs.hooks.after_create
      ? `after_create: ${JSON.stringify(inputs.hooks.after_create)}`
      : '',
    inputs.hooks.after_done
      ? `after_done: ${JSON.stringify(inputs.hooks.after_done)}`
      : '',
  ]
    .filter(Boolean)
    .join(', ')} },\n`
    : ''
}  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  addons: ${DEFAULT_CONDUCTOR_AGENT_ADDONS},
  // BB-139: the herdr workspace ships in @bakers-build/addon-herdr, which
  // default-exports the EXECUTOR — so the workspace slot names export: 'herdrWorkspace'.
  workspace: {
    plugin: '@bakers-build/addon-herdr',
    export: 'herdrWorkspace',
  },
};
`;
}
