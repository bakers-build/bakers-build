# Forge

**Seven conductor tools through which a sandboxed run fetches, updates its branch, pushes, opens its PR/MR, reads checks and merges, while the token stays with the conductor.**

For operators who run agents in `sandbox` permissions without trusting `git`, `gh` or `glab`. Background: decision record `docs/decisions/sandbox-forge-tools.md`.

## Enable it

Add the addon with exactly one backend, [GitHub](/addons/forge-github) or [GitLab](/addons/forge-gitlab), in `~/.bakers/machine.config.js` or the project's `.bakers/project.config.js`:

```js
addons: [
  {
    use: '@bakers-build/addon-forge',
    with: {
      merge: {
        main: { method: 'merge', delete_source: false },
        '*': { method: 'squash', delete_source: true },
      },
      backend: { use: '@bakers-build/addon-forge-github', with: { repository: 'acme/shop', auth: 'gh' } },
    },
  },
],
```

Without a `forge` entry no tool is served. An entry without `backend.use` stops the conductor's start.

## Options

<!-- @options @bakers-build/addon-forge -->

`bakers config check` validates these options; the backend checks its own at conductor start. Keep `token` and `private_key` in `~/.bakers/machine.config.js`, or use the `*_env` keys. The committed `.bakers/project.config.js` reaches every clone, run worktrees included.

## Tools

| Tool | Does | Limit |
|---|---|---|
| `forge_fetch` | Fetches `base_branch`, the ticket branch and the parent branches named in `branches`. | Read only; no tags. |
| `forge_update_branch` | Merges the current target into a run clone's ticket branch; `sync` says how the run follows. | Pushes nothing. |
| `forge_push` | Pushes an owned branch. | Fast-forward, or `force_with_lease`; bare force does not exist. |
| `forge_pr_upsert` | Opens, updates or retargets the PR/MR into the derived base. | Refuses a non-Conventional Commits title before any request. |
| `forge_checks` | Lists checks with raw `conclusion`, `run_id`, `job_id` and `overall`. | Read only. |
| `forge_job_log` | Returns a job's log tail, 16 KiB by default. | Read only. |
| `forge_merge` | Merges an owned branch's PR/MR. | Correct target, valid title, no conflict, `overall` is `success`. |

`overall` is `success` only when every required check, including one named `required`, is green; none required gives `no_required_checks`.

Human approval stays the merge gate.

## Ownership and merge

Tools take the ticket, `branch_name` and `base_branch` from the calling run; a call without a run is refused. A run owns `<branch_name>` and `<branch_name>-<suffix>`. A variant merges into the ticket branch, the ticket branch into the server's current `target_branch` (else `base_branch`). The merge sends method and source deletion explicitly, ends the body with `Merged-by: bakers.build` and `ref:<identifier>`, and keeps a source another open PR/MR targets.

## Isolation

Network git runs in a throwaway repository on the clone's object store, without config or hooks, against the backend's configured URL. Config and hooks planted in the clone have no effect; a clone whose `objects/info/alternates` lists another object store is refused. The token travels as an environment header and is redacted from every result.

## Good to know

- Without these tools a run falls back to `git` and the service's client, allowed in `sandbox` permissions only as trusted commands.

Package source in a checkout: `bakers-cli/addons/forge`.
