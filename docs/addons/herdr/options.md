# herdr options


List herdr once in `addons` to wire both slots. The fragment below replaces the `addons` line of a config:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
  {
    use: '@bakers-build/addon-herdr',
    with: {
      worktreeDir: '.bakers-worktrees',
      open: {},
      default: { panelLabel: '{title}' },
      states: {
        review: { panes: [{ direction: 'right', command: 'git diff --stat' }] },
      },
    },
  },
],
```

| Option under `with` | Meaning and default |
|---|---|
| `root` | Main clone path; derived from Git's common directory when omitted. |
| `worktreeDir` | Worktree directory relative to the root, default `.bakers-worktrees`. |
| `baseBranch` | Base ref for new branches; default the remote-tracking branch of the checked-out branch. |
| `autoSetupMerge` | Default `false`: run branches have no upstream and push with `push.default=current`; see [`autoSetupMerge`](/addons/workspace-git#options). `true` leaves Git alone. |
| `open` | Overview layout of a fresh worktree. Omitted runs `bakers ui --ticket {identifier}`; `{}` leaves a bare tab. Keys: `command`, `panes`, `tabLabel`, `panelLabel`. |
| `default`, `states.<state>` | Per-run layout. A state value beats `default`, which beats the built-ins. |
| `launchWatch` | Optional. `startTimeoutMs` (default 60000) waits for the launch wrapper to write `started`; `timeoutMs` (default 4000) then fails the run if the agent exits immediately. |

Layout fields: `tabLabel` (default `{identifier} · {titleSlug}`, must contain `{identifier}`), `workspaceLabel` (`{repoName}`), `panelLabel` (`{title}`) and `panes`, extra splits that are not the agent command (`direction` is `right` or `down`, plus `command` and optional `focus`). A `panes` array replaces the previous one. Labels accept `{identifier}`, `{title}`, `{titleSlug}`, `{runUuid}`, `{repoName}` and `{workspacePath}`; `open` commands also accept `{branch}` and `{worktreePath}`. The open layout runs once, after `after_create`, for a freshly created worktree. Top-level `states` chooses what is served, while `with.states` only lays out panes.

The agent command is executed by non-interactive `/bin/sh`, so the harness binary must resolve through `PATH`. A shell alias or function is not loaded.
