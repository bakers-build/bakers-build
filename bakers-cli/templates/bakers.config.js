// Canonical CONNECTION config for a bakers.build target repo (BB-215 addon form). This
// is the CONNECTION surface only — `site` + the auth / renderer plugins. `bakers
// dropsh`, `bakers ui`, and the conductor's auth all read this small file
// (BB-201 split preserved); it carries NO engine settings. Local overrides
// (`conductor.config.local.js`) supply base_url + credentials.
//
// Storybook-style `addons: []` — each entry names a package; its `./preset`
// self-declares the connection plugin it contributes:
//   - `@dropsh/plugin-oauth2` → the oauth2 auth provider (`with` = the provider).
//     A bakers.build connection declares exactly ONE (BB-391): `id: 'bakers'`, on scope
//     `bb:session`. That scope is not decoration — `Oauth2AccessPolicy` makes
//     it the EXACT permission set of a client_credentials token, so an entry
//     with no `scope` mints nothing. The same package with different `with` is
//     still a legitimate multi-instance; two auth profiles are no longer one.
//   - `@bakers-build/addon-auth-basic` with `{ basic }` → inline HTTP Basic
//     (fallback). BB-224 replaced the deleted `@bakers-build/core/builtins` preset
//     with this dedicated connection addon.
//   - `@bakers-build/addon-essentials` → the md renderer and the authoritative
//     JSON:API schema (a meta-addon; no `export:`, and no `with`). It no
//     longer carries the workspace filler (BB-495) — that moved to `bakers
//     ui`, which attaches `@bakers-build/addon-workspace` to its own connection.

async function loadLocal() {
  try {
    return (await import('./conductor.config.local.js')).default ?? {};
  } catch {}
  return {};
}

const local = await loadLocal();

export default {
  site: {
    base_url: local.base_url,
    jsonapi_prefix: local.jsonapi_prefix ?? '/jsonapi',
  },
  // BB-495: OPTIONAL, and `bakers ui`-facing only — `bakers dropsh` reads
  // nothing here; the caller names a workspace explicitly on each call
  // instead. Set this so `bakers ui`'s picker starts focused and its lists are
  // scoped by construction; leave it out and pick from the UI's own picker.
  // Per-install, so it comes from the local override rather than being
  // committed:
  //   // conductor.config.local.js
  //   export default { workspace_id: '<bb_workspace uuid>' };
  // Read the uuid with: bakers dropsh --format md list bb_workspace/bb_workspace
  workspace_id: local.workspace_id,
  addons: [
    // Auth: oauth2 (preferred) — ONE provider on ONE scope — else inline HTTP Basic.
    ...(local.oauth
      ? [
          {
            use: '@dropsh/plugin-oauth2',
            with: {
              scope: 'bb:session',
              ...local.oauth,
              id: 'bakers',
              default: true,
            },
          },
        ]
      : local.auth?.basic
        ? [
            {
              use: '@bakers-build/addon-auth-basic',
              with: { basic: local.auth.basic },
            },
          ]
        : []),
    '@bakers-build/addon-essentials',
  ],
};

// ─── Back-compat: the legacy `plugins: []` array still loads unchanged ───────
// A connection config may still list constructed/descriptor plugins directly:
//
//   plugins: [
//     { plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: local.oauth },
//     { plugin: '@bakers-build/addon-essentials' },
//   ],
