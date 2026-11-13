# Connection

A connection is a private file that names one bakers.build server and how you sign in to it. Terminal commands and the conductor use it. A chat connector is configured in your chat client instead, see [Chat connector](#chat-connector). For first setup, let `bb-init` guide [machine preparation and sign-in](/provision/machine).

## Files

| Item | Value |
|---|---|
| Default connection | `~/.bakers/connections/default.js` |
| Named connections | `~/.bakers/connections/<id>.js`, for example `team.js` and `staging.js`. An id is letters, digits, dot, underscore and hyphen, starting with a letter or digit. |
| Project connection | `.bakers/connection.config.js` in a checkout, found walking up from the working directory. Optional; it replaces the default for that checkout. |
| Relocate | `BAKERS_HOME` names the `.bakers` directory itself and moves `connections/` with it. See [Machine](/configuration/machine#location). |
| Permissions | The CLI writes them with mode `0600`. Keep them outside Git. |

Create a named connection with `bakers config init --scope connection --connection <id>`. Tokens never live in these files: sign-in stores them in dropsh's per-host session store under `~/.config/dropsh/`, mode `0600`. For isolated source-build runs, set an absolute `XDG_CONFIG_HOME` to store tokens in `$XDG_CONFIG_HOME/dropsh/`; use the same value for login, CLI and conductor. This source workspace patches dropsh 0.8.2; published packages require the equivalent upstream fix.

## Fields

```js
// @bakers-schema-version 1
/** @type {import('@bakers-build/core').ConnectionConfig} */
export default {
  schema_version: 1,
  site: { base_url: 'https://bakers.example.test', jsonapi_prefix: '/jsonapi' },
  workspace_id: '00000000-0000-4000-8000-000000000000',
  plugins: [{ plugin: '@bakers-build/addon-essentials' }],
  addons: ['@bakers-build/addon-bakers-ui-artifacts'],
};
```

| Field | Meaning and default |
|---|---|
| `schema_version` | `1`. The `// @bakers-schema-version 1` header and this field must agree. |
| `site` | Required object naming the server. |
| `site.base_url` | Required absolute `http` or `https` URL of the server. |
| `site.jsonapi_prefix` | API path prefix, default `/jsonapi`. |
| `workspace_id` | Optional workspace UUID. Only `bakers ui` reads it, to focus its picker; `bakers ui --workspace <name|uuid>` overrides it for one run. It does not scope API calls and does not replace `project.workspace` in the [project file](/configuration/project). |
| `plugins` | dropsh plugin descriptors `{ plugin, export?, with?, options? }` or constructed plugins. `@bakers-build/addon-essentials` supplies the Markdown renderer and the JSON:API schema, so keep it. The sign-in profile goes here. |
| `plugins[].plugin`, `plugins[].export`, `plugins[].with`, `plugins[].options` | A descriptor's package name, the named export to load (default export when absent), and its options: `with`, or `options` when `with` is absent. Other keys in a descriptor fail. |
| `addons` | Optional package entries: a name or `{ use, alias?, with? }`. Contributions are appended after `plugins`. UI addons add tabs to `bakers ui`; see [Addons](/addons/configure). An entry that cannot be resolved is an error here. |
| `addons[].use`, `addons[].alias`, `addons[].with`, `addons[].priority` | An entry's package name, its alias, its options (`with`) and an optional `priority` function. |

Unknown keys fail. The top-level values are passed to every plugin as base options; an entry's own `with` wins. There is no merge of arbitrary plugins across files.

## Which connection is used

Highest first; the first match wins:

1. `--config <file>`
2. `--connection <id>`
3. `BAKERS_CONFIG`
4. `BAKERS_CONNECTION`
5. `.bakers/connection.config.js`, walking up from the working directory
6. `~/.bakers/connections/default.js`
7. With no default file, the only file in `connections/`. Two or more need an explicit choice.

An unknown id fails with `Unknown connection '<id>'` and lists the available ones; a selected file that does not exist fails with the command that creates it. To use a named connection in one checkout, export `BAKERS_CONNECTION=staging` there or pass `--connection staging`. Confirm the choice:

```sh
bakers config check --scope connection
```

The report prints `Connection: <id> (<source>) — <path>`. The source is `flag-config`, `flag-connection`, `env-config`, `env-connection`, `legacy-project` (a project `connection.config.js`), `default` or `sole-connection`. `bakers ui --print-config` prints the same resolution without starting the UI.

## Sign-in profiles

A connection declares one `@dropsh/plugin-oauth2` entry with `id: 'bakers'` and `scope: 'bb:session'`, the session scope sent in OAuth requests. Its server configuration entity is named `bb_session`; use `bb:session` in connection files. Choose the `type`:

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
// @bakers-schema-version 1
/** @type {import('@bakers-build/core').ConnectionConfig} */
export default {
  schema_version: 1,
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
        scope: 'bb:session',
        client_id: 'bakers-cli',
        device_authorization_url: 'https://bakers.example.test/oauth/device_authorization',
        token_url: 'https://bakers.example.test/oauth/token',
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

### Client credentials

For a conductor on a server. The operator issues the consumer and its secret; the consumer must hold the `bb:session` scope, or the token request fails with `invalid_request` and the hint `Check the scope parameter`. Provisioning is covered in [Server](/self-hosting/server).

```sh
export BAKERS_CLIENT_SECRET='<issued secret>'
bakers init --auth-type client_credentials --client-id <id> --secret-env BAKERS_CLIENT_SECRET --base-url https://bakers.example.test
```

The CLI writes the secret into the private file:

```js
// @bakers-schema-version 1
/** @type {import('@bakers-build/core').ConnectionConfig} */
export default {
  schema_version: 1,
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
        scope: 'bb:session',
        client_id: 'bakers-conductor-build-host',
        client_secret: 'replace-with-the-issued-secret',
        token_url: 'https://bakers.example.test/oauth/token',
      },
    },
  ],
};
```

Never paste a real secret into a ticket, a document or a committed file. A `client_secret` read from `process.env` works at run time; `bakers config check` then reports the value as not checked. The plugin also offers `oauth2_password`; use it only where the operator explicitly enables that grant.

Other profiles of one host: `bakers auth use <id>` switches the active profile and `--auth-profile <id>` overrides it for one command.

## Chat connector

A chat connector grants your MCP client access to bakers.build tools with your own account's permissions. It lives in your chat client's connector settings, not in a file.

| Value | Required? | Example |
|---|---|---|
| Server endpoint | Yes | `https://app.bakers.build/mcp` |
| Account authorization | Yes, your own account with workspace access | Sign in when the client opens the server |
| Client ID/secret | Leave empty for dynamic registration | No shared secret |
| Project instructions | Optional, useful in claude.ai Projects | [Canonical instructions](/configuration/guides/project-instructions) |

Follow [Set up a connector](/get-started/connector) for the one-time connection. To verify after a change, ask the connector to search for and read a known project ticket, then compare it with the web UI. An empty workspace or permission error needs a workspace lead's help; never substitute someone else's login. To renew authorization, disconnect and reconnect in the client. [Limits and errors](/configuration/guides/connector-limits) covers client-specific failures; [notifications](/configuration/guides/notifications) covers email preferences.

## Verify

```sh
bakers config check --scope connection --online
bakers auth status
```

For one named connection, add its id: `bakers config check --scope connection --connection <id>` and `bakers auth status --connection <id>`. To see which named connections exist, list `~/.bakers/connections/`; each `<id>.js` there is one connection.

The offline check proves the file's shape; `--online` proves the session and project access. A wrong server usually means the wrong selector: read the `Connection:` line before changing credentials. [Credentials](/provision/security/credentials) explains keys and service accounts.
