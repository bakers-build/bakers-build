# herdr

Run each ticket's agent in a visible herdr terminal and its own Git worktree. For the herdr-cli experience and first action, see [Use your client](/get-started/use-your-client#herdr-cli). Development tooling remains independent of the client.

## AI first

```text
Read https://bakers.build/addons/herdr.
Use herdr as this project’s client. Check its installation and default
session, propose its paired executor/workspace addon entry, and verify it
with bakers oven check. Preserve the project’s environment hooks.
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

List the package once in `.bakers/conductor.config.js`; one entry supplies both executor and workspace:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  {
    use: '@bakers-build/addon-herdr',
    with: {
      worktreeDir: '.bakers-worktrees',
      default: { panelLabel: '{title}' },
    },
  },
],
```

No `with` options are required. [Options and layouts](/addons/herdr/options) owns all defaults, placeholders, panes and launch timeouts. The herdr executor also runs on another workspace's worktree, and a machine can replace it with its own executor; see [Conductor slots](/addons/slots).

## Verify

Run `bakers oven check`, then [a first ticket](/get-started/first-ticket). Its agent must open in a herdr tab named after its identifier, within the ticket worktree. A frozen ticket shows a `bb_frozen` sidebar token; resuming clears it.

Harness commands run through non-interactive `/bin/sh`, so binaries must resolve through `PATH`; shell aliases are not loaded.

Package source in a checkout: `bakers-cli/addons/herdr`.
