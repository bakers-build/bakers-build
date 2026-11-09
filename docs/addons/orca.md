# Orca

Host ticket worktrees and agent terminals in Orca. The conductor still owns dispatch, claims and ticket status. See [Use your client](/get-started/use-your-client#orca) for the first action and everyday use.

## AI first

```text
Read https://bakers.build/addons/orca.
Use Orca as this project’s client. Check its local CLI/runtime, propose
replacing the current client’s paired addon entry, and verify it with bakers
oven check. Preserve environment hooks and explain the single-user boundary.
```

The reference below explains the commands and configuration changes.

## Setup

Use Orca 1.4 or later, enable its `orca` CLI in settings, and make it available on the conductor's `PATH`. Start the desktop app or `orca serve`, then:

```sh
orca status
```

The local runtime must answer. bakers.build does not start Orca itself. **Orca and the conductor must run on the same machine.** Orca has no multi-user accounts/roles and keeps credentials on its host; a shared team Orca is unsupported.

## Configuration

Replace the herdr entry in `.bakers/conductor.config.js` with one Orca entry, supplying both executor and workspace:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  { use: '@bakers-build/addon-orca', with: { worktreeDir: '.bakers-worktrees' } },
],
```

No `with` options are required. [Orca options](/addons/orca/options) owns defaults, terminal labels, adoption/launch timeouts and cleanup behavior.

## Verify

Run `bakers oven check`, then [a small ticket](/get-started/first-ticket). The Git worktree should appear in Orca and the agent should run in its terminal. Adoption waits up to 35 seconds by default. An unreachable-runtime error requires starting Orca and retrying dispatch.

Package source in a checkout: `bakers-cli/addons/orca`.
