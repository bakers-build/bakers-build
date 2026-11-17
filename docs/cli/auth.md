# bakers auth

`bakers auth` signs you in to the bakers.build server of a connection, switches between its auth profiles, shows the session state and prints an access token for other clients. `bakers tools`, `bakers ui` and the conductor all use the session it stores.

## Synopsis

```
bakers auth [<global options>] login [--provider <id>]
bakers auth [<global options>] use <id>
bakers auth [<global options>] logout [--profile <id>] [--all]
bakers auth [<global options>] status [--json] [--profile <id>]
bakers auth [<global options>] token
```

| Subcommand | What it does |
|---|---|
| `login [--provider <id>]` | Sign in. `--provider` skips the picker and uses that profile id |
| `use <id>` | Set the active auth profile for this host |
| `logout` | Clear the active profile's session; `--profile <id>` clears another one, `--all` every profile of this host |
| `status` | List the host's profiles and their session state; `--json` for machine-readable output, `--profile <id>` for one profile |
| `token` | Print a short-lived access token as JSON for direct API calls: [Tokens for other clients](#tokens-for-other-clients) |

## Select the connection

`bakers auth` takes the same global options as [bakers tools](/cli/tools#global-options): `--config <path>`, `--connection <id>`, `--connections-dir <path>` and `--auth-profile <id>`, after the subcommand. Without them the connection is chosen by the same rule as in `bakers ui`: [Connection selection](/configuration/connection#which-connection-is-used).

```sh
bakers auth login --connection staging
bakers auth status --connection staging
```

Sign-in needs no workspace. A fresh connection can sign in before any workspace is chosen, and before you are a member of one; which workspaces you reach is decided on the server.

## Profiles

A generated connection has one default profile, `bakers`. What the signed-in identity may do is decided by its membership and rank on the server, not by the profile. A connection that declares several profiles, such as `bakers` for a person and `machine` for a conductor, switches with `bakers auth use <id>`; `--auth-profile <id>` overrides the active profile for one command. Profile fields and examples: [Connections](/configuration/connection#sign-in-profiles).

## Sign in

```sh
bakers auth login
bakers auth status
```

The default sign-in is a device code: `auth login` prints a URL and a short code, you confirm on any device, and it waits until you are signed in. The URL opens a page with the code already filled in: compare it with your terminal, check the client, account and the permissions listed under *Grants access to*, then confirm. A browser-redirect profile opens the browser and listens on its callback port. Connections set up for unattended use sign in with client credentials instead.

Tokens renew automatically. [Connection storage](/configuration/connection#files) owns their location and private-file requirements.

## Tokens for other clients

A client outside the CLI, such as an editor extension, can call the server's JSON:API (`/jsonapi/...`) and MCP tool endpoint directly with your sign-in. `bakers auth token` prints the access token of the selected connection and profile as one JSON object on stdout:

```json
{"base_url": "https://app.bakers.build", "token": "<access token>", "token_type": "Bearer", "expires_at": "2026-11-16T10:00:00.000Z"}
```

```sh
TOKEN=$(bakers auth token --connection staging | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" https://app.bakers.build/jsonapi/bb_ticket/bb_ticket/<uuid>
```

- The token carries your permissions and lives as long as the server's access tokens. An expired or nearly expired session is renewed first, so the printed token works.
- Only the access token is printed, never the refresh token or a client secret. Keep it in memory, and ask again after a `401`.
- When nobody is signed in or the renewal fails, the command exits nonzero, prints nothing on stdout and writes `{"error": {"code": "E_AUTH", "message": "..."}}` to stderr; run `bakers auth login`.

## Diagnose

An expired session, a missing membership and the wrong server are three different failures:

| Check | Tells you |
|---|---|
| `bakers auth status --connection <id>` | Whether the profile has a valid session |
| `bakers config check --scope connection --connection <id>` | Whether the connection file is valid; add `--online` to also prove the session |
| `bakers ui --print-config` | Which connection, and so which server, actually answers |
