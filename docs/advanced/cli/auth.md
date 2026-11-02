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

`bakers auth` takes the same global options as [bakers tools](/advanced/cli/tools#global-options): `--config <path>`, `--connection <id>`, `--connections-dir <path>` and `--auth-profile <id>`, after the subcommand. Without them the connection is chosen by the same rule as in `bakers ui`: [Which control plane answers](/advanced/cli/ui#which-control-plane-answers).

```sh
bakers auth login --connection staging
bakers auth status --connection staging
```

Sign-in needs no workspace. A fresh connection can sign in before any workspace is chosen, and before you are a member of one; which workspaces you reach is decided on the server.

## Profiles

A current bakers.build connection declares one profile, `bakers`, with the `bb:session` scope and marked default, so there is nothing to choose between. What the signed-in identity may do is decided by its membership and rank on the server, not by the profile. A connection that declares several profiles, such as `bakers` for a person and `machine` for a conductor, switches with `bakers auth use <id>`; `--auth-profile <id>` overrides the active profile for one command. Profile fields and examples: [Connections](/advanced/connections#sign-in-profiles).

## Sign in

```sh
bakers auth login
bakers auth status
```

The default sign-in is a device code: `auth login` prints a URL and a short code, you confirm on any device, and it waits until you are signed in. A browser-redirect profile opens the browser and listens on its callback port. Connections set up for unattended use sign in with client credentials instead.

Tokens never live in the connection file. Sign-in stores them in a per-host session store under `~/.config/dropsh/`, written with mode `0600`, and they renew automatically.

## Diagnose

An expired session, a missing membership and the wrong server are three different failures:

| Check | Tells you |
|---|---|
| `bakers auth status --connection <id>` | Whether the profile has a valid session |
| `bakers config check --scope connection --connection <id>` | Whether the connection file is valid; add `--online` to also prove the session |
| `bakers ui --print-config` | Which connection, and so which server, actually answers |
