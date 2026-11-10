# bakers auth

`bakers auth` signs you in to the bakers.build server of a connection, switches between its auth profiles and shows the session state. `bakers tools`, `bakers ui` and the conductor all use the session it stores.

## Synopsis

```
bakers auth [<global options>] login [--provider <id>]
bakers auth [<global options>] use <id>
bakers auth [<global options>] logout [--profile <id>] [--all]
bakers auth [<global options>] status [--json] [--profile <id>]
```

| Subcommand | What it does |
|---|---|
| `login [--provider <id>]` | Sign in. `--provider` skips the picker and uses that profile id |
| `use <id>` | Set the active auth profile for this host |
| `logout` | Clear the active profile's session; `--profile <id>` clears another one, `--all` every profile of this host |
| `status` | List the host's profiles and their session state; `--json` for machine-readable output, `--profile <id>` for one profile |

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

The default sign-in is a device code: `auth login` prints a URL and a short code, you confirm on any device, and it waits until you are signed in. A browser-redirect profile opens the browser and listens on its callback port. Connections set up for unattended use sign in with client credentials instead.

Tokens renew automatically. [Connection storage](/configuration/connection#files) owns their location and private-file requirements.

## Diagnose

An expired session, a missing membership and the wrong server are three different failures:

| Check | Tells you |
|---|---|
| `bakers auth status --connection <id>` | Whether the profile has a valid session |
| `bakers config check --scope connection --connection <id>` | Whether the connection file is valid; add `--online` to also prove the session |
| `bakers ui --print-config` | Which connection, and so which server, actually answers |
