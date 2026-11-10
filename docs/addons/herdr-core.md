# herdr-core

Run each ticket's agent in a herdr-core terminal. herdr-core is the local server behind herdr-app; its terminals live independently of the app. See [Use your client](/get-started/use-your-client#herdr-app) for usage. The worktree comes from a workspace addon such as [Git workspace](/addons/workspace-git).

## AI first

```text
Read https://bakers.build/addons/herdr-core.
Use herdr-core as this machine's executor. Check `hc --version` (0.1.18 or
later), propose the machine.config.js executor entry or a project addon entry
with a workspace addon, and verify it with bakers conductor check.
```

The reference below explains the commands and configuration changes.

## Setup

Install herdr-core from [herdr.dev/core](https://herdr.dev/core/). bakers.build requires `hc` 0.1.18 or later on the conductor's `PATH`; `hc` starts its server on demand.

```sh
hc --version
hc ls
```

A run fails at once with an install or upgrade message when `hc` is missing or older.

## Configuration

herdr-core is an executor only. In a project, list it with a workspace addon in `.bakers/project.config.js`:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  '@bakers-build/addon-workspace-git',
  '@bakers-build/addon-herdr-core',
],
```

`bakers conductor start` runs the conductor as a detached process; it needs no herdr process host. Use `bakers conductor start --foreground` to keep it attached to the current terminal.

The executor calls `hc` from the conductor, outside any agent sandbox. A sandboxed agent that calls `hc` from its own shell needs it among the trusted commands, for example `trusted_commands: ['$inherit', 'hc']` in a [shared `permissions` block](/provision/security/shared-settings). A trusted `hc run` starts any program outside the sandbox, so grant it only on a machine where that is acceptable.

To use it on your machine only, while the project keeps its own executor, set it in `~/.bakers/machine.config.js`:

```js
executor: { use: '@bakers-build/addon-herdr-core' },
```

The machine's executor wins for every project on that machine; the project keeps its workspace and hooks. [Conductor slots](/addons/slots) explains the precedence. No `with` options are required; [herdr-core options](/addons/herdr-core/options) lists them.

## Verify

Run `bakers conductor check`, then [a first ticket](/get-started/first-ticket). The run appears in `hc ls`, named `<identifier>-<run id>` in lowercase, in the ticket worktree, with the labels `bakers.ticket`, `bakers.branch` and `bakers.run`. Quit herdr-app: the run keeps working, and `hc ls` still shows it. When the run is finalised, its terminal ends and disappears.

Package source in a checkout: `bakers-cli/addons/herdr-core`.
