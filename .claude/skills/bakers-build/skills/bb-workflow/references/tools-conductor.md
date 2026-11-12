# Conductor tools

Inside a conductor run, the `bakers` MCP server serves two kinds of tools under their plain name:

- addon tools (`provision_up`, `ports_up`, a runtime addon's own tools, …), acting on the run's
  worktree;
- the site's tools of [tools](tools.md) › Operations, plus
  `bakers_comment_read`, `bakers_ticket_runs_list`, `bakers_label_list`, `bakers_project_read` and
  `bakers_user_read`. The
  conductor calls the site with its own credentials and refuses a ticket, parent, project or
  workspace outside the run ticket's project (exit 1); a missing `project` or `workspace` means the
  run's.

Call them like every tool in [tools](tools.md); the run token stays in the environment, so pass no
token yourself. An addon tool that is neither listed nor known to the CLI (exit 4) is not available
in this run: take the step's path without it.

## `provision_up`

Start it in a subagent whose only task is that call, returning its output verbatim; keep working
and take the printed base URL from its result once a check needs it. Without subagents, call it
directly. The first call on a new worktree can take minutes. The command runs to completion whatever happens to
its caller, and a call while the same profile runs in this worktree joins that run: after a cancel
or a client timeout, call again to receive the result.

## Operations

Skills name operations and link this table. Tool descriptions own arguments and limits.

| Operation | Tool |
|---|---|
| Inspect / start DDEV | `ddev_status` / `ddev_start` |
| PHP coding standards, mess detection, static analysis | `ddev_exec` |
| Playwright suite / browser inspection (`playwright-cli`) | `ddev_exec` |
| Provision an environment / stop or restart the playground conductor | `provision_up` |
| Inspect tunnels / share services / remove tunnels | `ports_status` / `ports_up` / `ports_down` |
| Fetch / push / open or update a PR / read checks / merge | `forge_fetch` / `forge_push` / `forge_pr_upsert` / `forge_checks` / `forge_merge` ([forge rules](forge.md)) |
| Compute the deployment ticket batch | `deployment_tickets` |
| Read the conductor's loaded agent catalog | no tool; keep defaults, make no proposal |
| List origin project labels, including inherited labels | no tool |
| Set the origin issue's mapped label and remove its other family labels | no tool |
| Lint GitLab CI configuration | no tool |
| Play the GitLab pipeline's manual gate | no tool |
| Read the GitLab release for a tag | no tool |
| Check deployed login responds HTTP 200 | no tool |
| Check package version is published on npm | no tool |
| Read machine tunnel policy | run-provided `BAKERS_TUNNEL`; absent means unknown |
| Read time evidence | operator-only `bb-prepare-time` |

**Fallback:** when an operation has no available tool, warn and record the named operation and
the human's next action in the outtake's *Manual review*. Report it as unverified; perform no
dependent write or claim. An unavailable catalog keeps the existing defaults.
