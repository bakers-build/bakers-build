# herdr-core

Run each ticket's agent in a herdr-core terminal. herdr-core is the local server behind the Herdr app; its terminals keep running when the app quits, updates or crashes. The worktree comes from a workspace addon such as [Git workspace](/addons/workspace-git).

## AI first

```text
Read https://bakers.build/addons/herdr-core.
Use herdr-core as this machine's executor. Check `hc --version` (0.1.18 or
later), propose the machine.config.js executor entry or a project addon entry
with a workspace addon, and verify it with bakers oven check.
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

herdr-core is an executor only. In a project, list it with a workspace addon in `.bakers/conductor.config.js`:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  '@bakers-build/addon-workspace-git',
  '@bakers-build/addon-herdr-core',
],
```

To use it on your machine only, while the project keeps its own executor, set it in `~/.bakers/machine.config.js`:

```js
executor: { plugin: '@bakers-build/addon-herdr-core' },
```

The machine's executor wins for every project on that machine; the project keeps its workspace and hooks. [Conductor slots](/addons/slots) explains the precedence. No `with` options are required; [herdr-core options](/addons/herdr-core/options) lists them.

## Verify

Run `bakers oven check`, then [a first ticket](/get-started/first-ticket). The run appears in `hc ls`, named `<identifier>-<run id>` in lowercase, in the ticket worktree, with the labels `bakers.ticket`, `bakers.branch` and `bakers.run`. Quit the Herdr app: the run keeps working, and `hc ls` still shows it. When the run is finalised, its terminal ends and disappears.

Package source in a checkout: `bakers-cli/addons/herdr-core`.
