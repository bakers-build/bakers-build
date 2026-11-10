// @bakers-schema-version 1
// Canonical CONNECTION config for a bakers.build target repo (BB-215 addon form). This
// is the CONNECTION surface only — `site` + the auth / renderer plugins. `bakers
// tools`, `bakers auth`, `bakers ui`, and the conductor's auth all read this small file
// (BB-201 split preserved); it carries NO engine settings. A connection is private:
// keep it at `~/.bakers/connections/<name>.js` (`default.js` unless BAKERS_CONNECTION
// or --connection names another), or as an uncommitted project
// `.bakers/connection.config.js`. `bakers config init` writes one for you.
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

/** @type {import('@bakers-build/core').ConnectionConfig} */
export default {
  schema_version: 1,
  site: {
    base_url: 'https://bakers.example.com',
    jsonapi_prefix: '/jsonapi',
  },
  // BB-495: OPTIONAL, and `bakers ui`-facing only — `bakers tools` reads
  // nothing here; the caller names a workspace explicitly on each call
  // instead. Set this so `bakers ui`'s picker starts focused and its lists are
  // scoped by construction; leave it out and pick from the UI's own picker.
  // Read the uuid with: bakers tools tool_api__bakers_workspace_list
  // workspace_id: '<bb_workspace uuid>',
  addons: [
    // Auth: oauth2 (preferred) — ONE provider on ONE scope. For inline HTTP
    // Basic instead: { use: '@bakers-build/addon-auth-basic', with: { basic } }.
    // The client_secret is never committed: it is read from the environment.
    {
      use: '@dropsh/plugin-oauth2',
      with: {
        id: 'bakers',
        default: true,
        type: 'oauth2_client_credentials',
        scope: 'bb:session',
        client_id: 'bakers-agent',
        client_secret: process.env.BAKERS_CONSUMER_SECRET,
        token_url: 'https://bakers.example.com/oauth/token',
      },
    },
    '@bakers-build/addon-essentials',
  ],
};

// A connection config may instead list dropsh plugins directly:
//
//   plugins: [
//     { plugin: '@dropsh/plugin-oauth2', export: 'oauth2Plugin', with: { … } },
//     { plugin: '@bakers-build/addon-essentials' },
//   ],
