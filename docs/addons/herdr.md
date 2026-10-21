# herdr

**Runs each ticket's agent in a herdr terminal session, in its own Git worktree.**

For projects whose conductor should start agents in visible herdr tabs and panes.

## Enable it

List the package once in `addons` of the project's `.bakers/conductor.config.js`. One entry wires both the executor and the workspace; the same `with` goes to both.

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

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `root` | string | from Git's common directory | Main clone path. |
| `worktreeDir` | string | `.bakers-worktrees` | Worktree directory, relative to the root. |
| `baseBranch` | string | remote-tracking branch of the checked-out branch | Base ref for new ticket branches. |
| `open` | object | runs `bakers ui --ticket {identifier}` | Layout of a fresh worktree's first tab. `{}` leaves a bare tab. Keys: `command`, `panes`, `tabLabel`, `panelLabel`. |
| `default` | object | built-in layout | Per-run layout: `tabLabel`, `workspaceLabel`, `panelLabel`, `panes`. |
| `states.<state>` | object | none | Per-run layout for one state; beats `default`. |
| `launchWatch` | object | `startTimeoutMs: 60000`, `timeoutMs: 4000` | How long to wait for the launch to start, then how long an immediate agent exit fails the run. |

Label placeholders and pane fields are in [herdr options](/advanced/conductor-config#herdr-options).

## Check it works

A ticket picked up by this conductor opens a herdr tab named after its identifier, inside the ticket's worktree.

## Good to know

- The herdr executor pairs only with the herdr workspace. Do not add [Git workspace](/addons/workspace-git) next to it.
- The agent command runs through non-interactive `/bin/sh`, so the harness must resolve through `PATH`.
- When a ticket is frozen, its herdr workspace shows a `bb_frozen` sidebar token; resuming clears it.
- Setup of herdr itself: [Set up herdr](/advanced/cli/herdr).

Source: [`bakers-cli/addons/herdr`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/herdr)
