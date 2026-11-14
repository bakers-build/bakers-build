/** Supplies the executor and the worktree slot through its preset. */
export const DEFAULT_SLOT_ADDON = '@bakers-build/addon-herdr';
export const DEFAULT_CONDUCTOR_AGENT_ADDONS = `['${DEFAULT_SLOT_ADDON}']`;

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
// A bakers.build connection: credentials and optional workspace. Keep this file private.
/** @type {import('@bakers-build/core').ConnectionConfig} */
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
// server credentials belong to the connection (connections/default.js). An
// \`executor\` slot here (e.g. \`{ use: '@bakers-build/addon-herdr-core' }\`)
// overrides every project's executor on this machine.
/** @type {import('@bakers-build/core').MachineConfig} */
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
  return `// The project's bakers.build configuration — committed and identical for
// everyone. A conductor is this machine (machine.config.js) + this project +
// the variant (project.<name>.config.js). Connections are private files.
//
// Each addon in \`addons\` fills its slots through its preset: herdr supplies
// the executor and the worktree. The server comes from the connection,
// by default @bakers-build/addon-remote-drupal.

/** @type {import('@bakers-build/core').ProjectConfig} */
export default {
  project: { name: ${JSON.stringify(inputs.project)}${inputs.bakersWorkspace ? `, workspace: ${JSON.stringify(inputs.bakersWorkspace)}` : ''} },
  // The run budget (max_parallel) is set on the machine in the backend.
  // Transcripts upload only where the server's run-log storage allows it.
  // Set to false to keep this conductor's transcripts local even then.
  // Metrics are unaffected either way.
  capture_logs: true,
${
  inputs.hooks?.after_create || inputs.hooks?.after_done
    ? `  // Lifecycle hooks are conductor-owned: they live at the config top
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
}  addons: ${DEFAULT_CONDUCTOR_AGENT_ADDONS},
};
`;
}
