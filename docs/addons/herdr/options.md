# herdr options


For operators tuning [herdr](/addons/herdr), these optional `with` values control worktrees and terminal layouts. Merge the example into the existing project addon entry; preserve other addons:

```js
addons: [
  '@bakers-build/addon-remote-drupal',
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

| Option under `with` | Meaning and default |
|---|---|
| `root` | Main clone path; derived from Git's common directory when omitted. |
| `worktree_dir` | Worktree directory relative to the root, default `.bakers-worktrees`. |
| `base_branch` | Base ref for new branches; default the remote-tracking branch of the checked-out branch. |
| `auto_setup_merge` | Default `false`: run branches have no upstream and push with `push.default=current`; see [`auto_setup_merge`](/addons/workspace-git#options). `true` leaves Git alone. |
| `open` | Overview layout of a fresh worktree. Omitted runs `bakers ui --ticket {identifier}`; `{}` leaves a bare tab. Keys: `command`, `panes`, `tab_label`, `panel_label`. |
| `default`, `states.<state>` | Per-run layout. A state value beats `default`, which beats the built-ins. |
| `command` | Fallback agent command when none is supplied, default `claude`. |
| `launch_watch` | Optional. `start_timeout_ms` (default 60000) waits for the launch wrapper to write `started`; `timeout_ms` (default 4000) then fails the run if the agent exits immediately. |

Layout fields: `tab_label` (default `{identifier} · {title_slug}`, must contain `{identifier}`), `workspace_label` (`{repo_name}`), `panel_label` (`{title}`) and `panes`, extra splits that are not the agent command (`direction` is `right` or `down`, plus `command` and optional `focus`). A `panes` array replaces the previous one. Labels accept `{identifier}`, `{title}`, `{title_slug}`, `{run_uuid}`, `{repo_name}` and `{workspace_path}`; `open` commands also accept `{branch}` and `{worktree_path}`. The open layout runs once, after `after_create`, for a freshly created worktree; the executor applies it, also to a worktree another workspace made ([Conductor slots](/addons/slots)). Top-level `states` chooses what is served, while `with.states` only lays out panes.

The agent command is executed by non-interactive `/bin/sh`, so the harness binary must resolve through `PATH`. A shell alias or function is not loaded.

Restart the conductor after changing options, then dispatch a disposable ticket and confirm its tab, panes and worktree.
