# herdr

Run each ticket's agent in a visible herdr terminal and its own Git worktree. For the herdr-cli experience and first action, see [Use your client](/get-started/use-your-client#herdr-cli). Development tooling remains independent of the client.

## AI first

```text
Read https://bakers.build/addons/herdr.
Use herdr as this project’s client. Check its installation and default
session, propose its paired executor/workspace addon entry, and verify it
with bakers conductor check. Preserve the project’s environment hooks.
```

The reference below explains the commands and configuration changes.

## Setup

Install herdr using its [installation guide](https://herdr.dev/docs/install/). bakers.build requires version 0.7 or later on the conductor's `PATH`.

```sh
herdr --version
herdr
```

From another terminal as the same user:

```sh
herdr workspace list
```

The default session must answer; a named session uses a separate socket. A headless host uses `herdr server`; [worker servers](/provision/worker-server) covers startup ordering.

## Configuration

List the package once in `.bakers/project.config.js`; one entry supplies both executor and workspace:

```js
addons: [
  {
    use: '@bakers-build/addon-herdr',
    with: {
      worktree_dir: '.bakers-worktrees',
      default: { panel_label: '{title}' },
    },
  },
],
```

No `with` options are required. [Options](#options) owns all defaults, placeholders, panes and launch timeouts. The herdr executor also runs on another workspace's worktree, and a machine can replace it with its own executor; see [Conductor slots](/addons/slots).

## Options

These optional `with` values control worktrees and terminal layouts. Merge the example into the existing project addon entry; preserve other addons:

```js
addons: [
  {
    use: '@bakers-build/addon-herdr',
    with: {
      worktree_dir: '.bakers-worktrees',
      open: {},
      default: { panel_label: '{title}' },
      states: {
        review: { panes: [{ direction: 'right', command: 'git diff --stat' }] },
      },
    },
  },
],
```

<!-- @options @bakers-build/addon-herdr -->

`auto_setup_merge` behaves as in [workspace-git](/addons/workspace-git#options).

A `panes` array replaces the previous one. The open layout runs once, after `after_create`, for a freshly created worktree; the executor applies it, also to a worktree another workspace made ([Conductor slots](/addons/slots)). Top-level `states` chooses what is served, while `with.states` only lays out panes.

The agent command is executed by non-interactive `/bin/sh`, so the harness binary must resolve through `PATH`. A shell alias or function is not loaded.

Restart the conductor after changing options, then dispatch a disposable ticket and confirm its tab, panes and worktree.

## Verify

Run `bakers conductor check`, then [a first ticket](/get-started/first-ticket). Its agent must open in a herdr tab named after its identifier, within the ticket worktree. A frozen ticket shows a `bb_frozen` sidebar token; resuming clears it.

Harness commands run through non-interactive `/bin/sh`, so binaries must resolve through `PATH`; shell aliases are not loaded.

Package source in a checkout: `bakers-cli/addons/herdr`.
