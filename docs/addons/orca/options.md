# Orca options

Optional `with` values for the [Orca addon](/addons/orca). Setup and its minimal configuration live on that page.

| Option under `with` | Meaning and default |
|---|---|
| `root` | Main clone path; derived from Git's common directory when omitted. |
| `worktreeDir` | Worktree directory relative to the root, default `.bakers-worktrees`. |
| `baseBranch` | Base ref for new branches; default the remote-tracking branch of the checked-out branch. |
| `autoSetupMerge` | Default `false`: run branches, including ones checked out from `origin`, have no upstream and push with `push.default=current`; see [`autoSetupMerge`](/addons/workspace-git#options). `true` leaves Git alone. |
| `command` | Fallback agent command when the agent addons supply none, default `claude`. |
| `default`, `states.<state>` | `tabLabel`, the agent terminal's title, default `{identifier} · {state}`; it must contain `{identifier}` and also accepts `{state}` (the state the run was started for), `{title}`, `{titleSlug}`, `{runUuid}` and `{workspacePath}`. ` #<run id>` is always appended, and the title is set as the terminal's manual name (`orca terminal rename`). The agent can still change the title shown for the terminal itself; the run's terminal is found again by the renamed tab title in the Orca app, or by the terminal title with `orca serve`. |
| `open` | Overview terminal of a fresh worktree. Omitted runs `bakers ui --ticket {identifier}` titled `{identifier} · {title}`; `{}` opens none. Keys: `command`, `title`. |
| `launchWatch` | As for herdr: `startTimeoutMs` (default 60000) and `timeoutMs` (default 4000). |
| `adoptTimeoutMs` | How long to wait for Orca to pick up a new worktree, default 35000. |

## Worktree lifecycle

Git creates the exact ticket branch; Orca adopts the worktree after the addon registers the repository. `stopRun` does nothing; cleanup closes the terminal, including after an Orca restart. Removal uses `orca worktree rm`, falling back to Git when Orca does not know the worktree.
