# Forge promotion

**A release run of a `deployment` ticket opens, checks and merges the PR/MR from `base_branch` into a stable branch, such as `next` into `main`, through the [forge tools](/addons/forge).**

For operators whose stable branch accepts only merge commits from `base_branch`.

## Enable it

Give the target its own merge rule with `method: 'merge'` in the forge entry:

```js
merge: {
  main: { method: 'merge', delete_source: false },
},
```

## Use it

`forge_pr_upsert`, `forge_checks` and `forge_merge` take two more arguments:

| Argument | Value |
|---|---|
| `promote_to` | The target branch, e.g. `main`. |
| `expected_sha` | The frozen release candidate, 40 hex. |

The PR/MR then runs from `base_branch` into the target. A promotion takes no `branch` or `ref`.

## Rules

Each call is refused, before any forge write, unless:

- the run's ticket type is `deployment`;
- the target has its own merge rule with `method: 'merge'`; neither `merge['*']` nor the default counts;
- `origin/<base_branch>`, fetched again, is at `expected_sha`.

`forge_pr_upsert` refuses an open PR/MR from `base_branch` into another target. `forge_merge` also requires the PR/MR head at `expected_sha`. It merges by merge commit, never deletes `base_branch`, and then checks that the target's second parent is `expected_sha`; a mismatch is an error naming both SHAs.

Package source in a checkout: `bakers-cli/addons/forge`.
