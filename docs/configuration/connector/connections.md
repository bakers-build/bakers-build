# Connections

A connection is a private file that names one bakers.build server and how you sign in to it; this page covers the files, how one is selected, every field and the three sign-in profiles. For first setup, let `bb-init` guide [machine preparation and sign-in](/get-started/machine). The reference below explains its files and manual commands.

## Files

| Item | Value |
|---|---|
| Default connection | `~/.bakers/bakers.config.js` |
| Named connections | `~/.bakers/connections/<id>.js`, for example `team.js` and `staging.js`. An id is letters, digits, dot, underscore and hyphen, starting with a letter or digit. |
| Relocate | `BB_HOME` names the `.bakers` directory itself and moves both. See [Machines](/configuration/machine#location). |
| Permissions | The CLI writes them with mode `0600`. Keep them outside Git. |

Create a named connection with `bakers config init --scope connection --connection <id>`. Tokens never live in these files: sign-in stores them in dropsh's per-host session store under `~/.config/dropsh/`, mode `0600`.

## Fields

```js
// @bakers-schema-version 4
export default {
  schema_version: 4,
  site: { base_url: 'https://bakers.example.test', jsonapi_prefix: '/jsonapi' },
  workspace_id: '00000000-0000-4000-8000-000000000000',
  plugins: [{ plugin: '@bakers-build/addon-essentials' }],
  addons: ['@bakers-build/addon-bakers-ui-artifacts'],
};
```

| Field | Meaning and default |
|---|---|
| `schema_version` | Current schema is 4; the header comment and this field must agree. |
| `site.base_url` | Required absolute `http` or `https` URL of the server. |
| `site.jsonapi_prefix` | API path prefix, default `/jsonapi`. |
| `plugins` | Array required by `bakers config check`. Descriptors `{ plugin, export?, with? }` (`options` is an alias of `with`) or constructed plugins. `@bakers-build/addon-essentials` supplies the Markdown renderer and the JSON:API schema, so keep it. The sign-in profile goes here. |
| `addons` | Optional package entries. Contributions are appended after `plugins`. UI addons add tabs to `bakers ui`; see [Addons](/addons/configure). An entry that cannot be resolved is an error here. |
| `workspace_id` | Optional workspace UUID. Only `bakers ui` reads it, to focus its picker; `bakers ui --workspace <name|uuid>` overrides it for one run. Omit it to choose in the UI. It does not scope DropSH calls and does not replace `bakers.workspace` in the conductor config. |

The top-level values are passed to every plugin as base options; an entry's own `with` wins. There is no merge of arbitrary plugins across files.

## Which connection is used

Highest first; the first match wins:

1. `--config <file>`
2. `--connection <id>`
3. `BB_CONFIG`
4. `BB_CONNECTION`
5. The checkout selector, `.bakers/connection.config.local.js`
6. The default: a legacy `.bakers/bakers.config.js` found walking up from the working directory, else `~/.bakers/bakers.config.js`
7. With no default file, the only file in `connections/`. Two or more need an explicit choice.

An unknown id fails with `Unknown connection '<id>'` and lists the available ones; a selected file that does not exist fails with the command that creates it. A legacy project `.bakers/bakers.config.js` still loads, but `bakers config check` reports it as superseded; replace it with a named connection and a selector.

### Select a connection for one checkout

Create `.bakers/connection.config.local.js` in the checkout and keep it out of Git:

```js
export default { connection: 'staging' };
```

It accepts exactly one key, `connection`, a literal non-empty string. It holds no credentials. Confirm the choice:

```sh
bakers config check --scope project
```

The report prints `Connection: staging (project-file) - <path>`. The bracketed selection source is `flag-config`, `flag-connection`, `env-config`, `env-connection`, `project-file`, `default`, `legacy-project` or `sole-connection`. `bakers ui --print-config` prints the same resolution without starting the UI.

## Sign-in profiles

A connection declares one `@dropsh/plugin-oauth2` entry with `id: 'bakers'` and `scope: 'bb:session'`, the only scope bakers.build issues. Choose the `type`:

| Type | Use when | Written by |
|---|---|---|
| `oauth2_device_code` | Default. A person signs in; no secret, works over SSH and in containers. | `bakers init` |
| `oauth2_authcode` | A person signs in and a browser runs on the same machine as the CLI. | Hand-edit only |
| `oauth2_client_credentials` | Unattended conductor or CI, no human to confirm a code. | `--auth-type client_credentials` |

| `with` field | Meaning |
|---|---|
| `id`, `default` | `bakers` and `true`: the provider name and default profile. |
| `type`, `scope` | One of the types above, and `bb:session`. |
| `client_id` | `bakers-cli`, the shared public client, for device code and browser redirect; an operator-issued id for client credentials. |
| `client_secret` | Client credentials only. A device-code profile carries no `client_secret` key at all. |
| `token_url` | The server token endpoint: the base URL plus `/oauth/token`. |
| `device_authorization_url` | Device code only: the base URL plus `/oauth/device_authorization`. |
| `redirect_port` | Browser redirect only; default `7432`, which must match the server's registered redirect `http://localhost:7432/callback`. |

### Device code

What `bakers init` writes:

```js
// @bakers-schema-version 4
export default {
  schema_version: 4,
  site: { base_url: 'https://bakers.example.test', jsonapi_prefix: '/jsonapi' },
  plugins: [
    { plugin: '@bakers-build/addon-essentials' },
    {
      plugin: '@dropsh/plugin-oauth2',
      export: 'oauth2Plugin',
      with: {
        id: 'bakers',
        default: true,
        type: 'oauth2_device_code',
        client_id: 'bakers-cli',
        device_authorization_url: 'https://bakers.example.test/oauth/device_authorization',
        token_url: 'https://bakers.example.test/oauth/token',
        scope: 'bb:session',
      },
    },
  ],
};
```

```sh
bakers auth login
bakers auth status
```

The CLI prints a verification URL and a short code, then polls the token endpoint until you confirm it on any device. Sign-in proves authentication only; `bakers config check --scope all --online` also checks project access.

### Browser redirect

A fragment that replaces the OAuth descriptor. Sign in with `bakers auth login`; the CLI opens the browser and listens on the callback port.

```js
{
  plugin: '@dropsh/plugin-oauth2',
  export: 'oauth2Plugin',
  with: {
    id: 'bakers',
    default: true,
    type: 'oauth2_authcode',
    client_id: 'bakers-cli',
    token_url: 'https://bakers.example.test/oauth/token',
    scope: 'bb:session',
    redirect_port: 7432,
  },
},
```

The current `bakers config check` reports a missing `client_secret` for this type, although the grant carries none; ignore that finding for this profile.

### Client credentials

For a conductor on a server. The operator issues the consumer and its secret; the consumer must hold the `bb:session` scope, or the token request fails with `invalid_request` and the hint `Check the scope parameter`. Provisioning is covered in [Server](/configuration/project/server).

```sh
export BB_CLIENT_SECRET='<issued secret>'
bakers init --auth-type client_credentials --client-id <id> --secret-env BB_CLIENT_SECRET --base-url https://bakers.example.test
```

The CLI writes the secret into the private file:

```js
// @bakers-schema-version 4
export default {
  schema_version: 4,
  site: { base_url: 'https://bakers.example.test', jsonapi_prefix: '/jsonapi' },
  plugins: [
    { plugin: '@bakers-build/addon-essentials' },
    {
      plugin: '@dropsh/plugin-oauth2',
      export: 'oauth2Plugin',
      with: {
        id: 'bakers',
        default: true,
        type: 'oauth2_client_credentials',
        client_id: 'bakers-conductor-build-host',
        client_secret: 'replace-with-the-issued-secret',
        token_url: 'https://bakers.example.test/oauth/token',
        scope: 'bb:session',
      },
    },
  ],
};
```

Never paste a real secret into a ticket, a document or a committed file. A `client_secret` read from `process.env` works at run time, but `bakers config check` then reports the value as computed and exits incomplete. The plugin also offers `oauth2_password`; use it only where the operator explicitly enables that grant.

Other profiles of one host: `bakers auth use <id>` switches the active profile and `--auth-profile <id>` overrides it for one command. Inline HTTP Basic (`@bakers-build/addon-auth-basic` with a `basic` token) exists for servers configured for it.

## Verify

```sh
bakers config check --scope connection --online
bakers auth status
```

For one named connection, add its id: `bakers config check --scope connection --connection <id>` and `bakers auth status --connection <id>`. To see which named connections exist, list `~/.bakers/connections/`; each `<id>.js` there is one connection.

The offline check proves the file's shape; `--online` proves the session and project access. A wrong server usually means the wrong selector: read the `Connection:` line before changing credentials.
