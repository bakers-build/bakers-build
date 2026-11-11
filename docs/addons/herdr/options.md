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

<!-- @options @bakers-build/addon-herdr -->

A `panes` array replaces the previous one. The open layout runs once, after `after_create`, for a freshly created worktree; the executor applies it, also to a worktree another workspace made ([Conductor slots](/addons/slots)). Top-level `states` chooses what is served, while `with.states` only lays out panes.

The agent command is executed by non-interactive `/bin/sh`, so the harness binary must resolve through `PATH`. A shell alias or function is not loaded.

Restart the conductor after changing options, then dispatch a disposable ticket and confirm its tab, panes and worktree.
