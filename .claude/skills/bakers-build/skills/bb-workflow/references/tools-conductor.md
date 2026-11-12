# Conductor tools

Inside a conductor run, the `bakers` MCP server serves two kinds of tools under their plain name:

- addon tools (`provision_up`, `ports_up`, a runtime addon's own tools, …), acting on the run's
  worktree;
- the site's tools of [tools](tools.md) › Operations, plus
  `bakers_ticket_runs_list`, `bakers_label_list`, `bakers_project_read` and `bakers_user_read`. The
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
or a client timeout, call again once to receive the result.

When the base URL arrives and `bb-phase-provision` names a readiness command, run it there; without
one, the base URL counts. Provisioning **fails** on an error, on no result from the repeat call, or
on a readiness command that does not print its expected output: a site that answers is not proof
that it works. On failure, every confirmed check that needs the site is `blocked` with that output
as its evidence; checks needing no site still run. The run then stops before `deliver` as a
technical problem naming the output: no push, no MR. Its handoff and summary are still owed.
