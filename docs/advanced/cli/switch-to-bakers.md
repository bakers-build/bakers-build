# Switch to the bakers CLI

bakers.build is driven by the `bakers` command from `@bakers-build/bakers`. The older `gaia` command from `@gaia-ai/gaia` does not work against a bakers.build server, and `bakers` reads none of its files. This page moves one machine from `gaia` to `bakers`.

**You need:** [Node.js ≥ 20.19 with npm](/advanced/cli/node) and your team's bakers.build server URL, `https://app.bakers.build` unless your team runs its own.

## Before you switch

- **The new server starts empty.** Nothing is carried over from GAIA: no tickets, projects, workspaces or accounts. The first admin creates the workspace and invites you; you need that invitation before step 3 works.
- **From the switch on, create tickets only in bakers.build.** The old system takes no new tickets. Finish or move open work by hand.

## What changes

| Before | Now |
|---|---|
| `npm install -g @gaia-ai/gaia` | `npm install -g @bakers-build/bakers` |
| `gaia …` | `bakers …` |
| `gaia conductor start`, `stop`, `status`, `ls` | `bakers oven start`, `stop`, `status`, `ls` |
| `gaia conductor poll` | `bakers oven once` |
| `gaia conductor reap` | `bakers oven clean` |
| `~/.gaia`, `.gaia`, `.gaia-worktrees` | `~/.bakers`, `.bakers`, `.bakers-worktrees` |

There is no `conductor` alias and no `gaia` binary in the new package. Old configuration and sign-ins are not migrated: you configure and sign in once more.

## Steps

1. **Stop every old conductor.** In each project checkout where one runs:

   ```sh
   gaia conductor stop
   ```

   Do this before uninstalling, because the old command is what stops the old process.

2. **Swap the package.**

   ```sh
   npm uninstall -g @gaia-ai/gaia
   npm install -g @bakers-build/bakers
   bakers --version
   ```

3. **Configure `~/.bakers` and sign in.** Run outside a project checkout, then approve the displayed code:

   ```sh
   bakers init
   bakers dropsh auth login
   bakers config check --scope connection --online
   ```

   The default server is `https://app.bakers.build`; enter your team's URL if it runs its own. Details are in [Install the CLI](/advanced/cli/install).

4. **Connect each project and register its oven.** In the project checkout:

   ```sh
   bakers config init --scope project --project <project>
   bakers oven once
   ```

   `bakers oven once` registers the oven for this checkout and runs one cycle. Start it for good with `bakers oven start`. See [Connect a project by hand](/advanced/cli/connect-a-project) and [bakers oven](/advanced/cli/conductor).

5. **Clean up.** Once `bakers oven status` shows the new oven, delete the old `~/.gaia` directory and each checkout's `.gaia` and `.gaia-worktrees`. Nothing reads them any more.

## Try it on dev first

The dev server `https://develop.dev.bakers.build` runs the latest `develop`. Every deploy there publishes a matching CLI under the npm dist-tag `next`:

```sh
npm install -g @bakers-build/bakers@next
bakers init --base-url https://develop.dev.bakers.build
```

Data on dev is for testing and can be reset. Switch back to the release with `npm install -g @bakers-build/bakers@latest` and `bakers init` against your real server.

## Why the old client stops with an error

Every `bakers` request carries an `X-Bakers-Client: bakers/<version>` header. The server uses it as a compatibility check, not as access control:

- **Claiming work** requires the header. Without it, or with a version below the server's minimum, a claim answers `426 Upgrade Required` and the client never receives a ticket.
- **Any other API error** answered to a client without the header carries the install hint as an extra error entry. Successful responses, the web UI and the MCP endpoint are never changed.

So the old `gaia` stops at its first failing request with one of these messages:

```text
This server requires the bakers CLI (X-Bakers-Client header missing). Install it: npm install -g @bakers-build/bakers
```

```text
bakers 0.1.0 is too old for this server (requires >= 0.2.0). Update: npm install -g @bakers-build/bakers@latest
```

The second one appears when a `bakers` installation is older than the server allows. Run `bakers update` to fix it.

`gaia dropsh …` prints the server's error body, so it shows the first message. `gaia conductor …` prints only its own short error, such as `HTTP 404` or `Not authenticated for profile 'gaia'`, and exits non-zero. If an old conductor fails like that against a bakers.build server, it is the wrong program: follow the steps above.

## For operators

The minimum version lives in the `min_client_version` key of `bb_core.settings` and is compared as semver. Raise it at release time to retire incompatible clients:

```sh
drush config:set bb_core.settings min_client_version 0.2.0
```

Raise it only once the matching `@bakers-build/bakers` release is published, or every oven stops claiming.
