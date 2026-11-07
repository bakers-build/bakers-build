export const DEFAULT_CONDUCTOR_AGENT_ADDONS =
  "[{ use: '@bakers-build/addon-herdr' }, { use: '@bakers-build/addon-claude', alias: 'opus' }]";

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
  return `// @bakers-schema-version 1
// Global bakers.build connection: credentials and optional legacy workspace. Keep this file private.
export default {
  schema_version: 1,
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
  label?: string;
}): string {
  return `// @bakers-schema-version 1
// Local host identity. The run budget is set on the machine in the backend;
// server credentials belong to bakers.config.js.
export default {
 schema_version: 1,
 machine_id: ${JSON.stringify(inputs.machineId)},
${inputs.label ? ` label: ${JSON.stringify(inputs.label)},\n` : ''}};
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
  return `// Canonical bakers.build conductor engine configuration — committed and
// identical for everyone. It carries no identity: a conductor is this machine
// (machine.config.js) + this project + the variant (this file's stem).
// Connections belong to bakers.config.js.
//
// IMPORT-FREE (BB-78): the plugin slots are \`{ plugin, with }\` descriptors
// naming the REAL published package, not \`import\`ed constructors.
// loadConductorConfig resolves each name ESLint-style (config dir → cwd →
// conductor install). Every addon package default-exports its single factory, so
// no slot needs an \`export:\` — EXCEPT the merged herdr workspace
// (\`@bakers-build/addon-herdr\` default-exports the executor, so the workspace names
// \`export: 'herdrWorkspace'\` — BB-139).

export default {
  bakers: { project: ${JSON.stringify(inputs.project)}${inputs.bakersWorkspace ? `, workspace: ${JSON.stringify(inputs.bakersWorkspace)}` : ''} },
  // The run budget (max_parallel) is set on the machine in the backend.
  // Transcripts upload only where the server's run-log storage allows it.
  // Set to false to keep this conductor's transcripts local even then.
  // Metrics are unaffected either way.
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
