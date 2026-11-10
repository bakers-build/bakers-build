# herdr-core options

Optional `with` values for the [herdr-core addon](/addons/herdr-core).

| Option under `with` | Meaning and default |
|---|---|
| `command` | Fallback agent command when the agent addons supply none, default `claude`. |
| `launch_watch` | As for herdr: `start_timeout_ms` (default 60000) waits for the launch wrapper to write `started`; `timeout_ms` (default 4000) then fails the run if the agent exits immediately. |

## Run lifecycle

`startRun` runs `hc run --bg --no-parent --outlive-parent` in the worktree. The terminal is named `<identifier>-<run id>`, lowercase, at most 32 characters of `a-z0-9-_`, and labelled `bakers.ticket`, `bakers.branch` and `bakers.run`. The run's environment travels in a private launch script, never in the command line. `stopRun` does nothing. Cleanup finds the run's terminals by their branch and run labels, ends a live one with `hc kill` and removes it with `hc rm`; a sibling run's terminal is left alone. Run state reaches bakers.build through the agent and the server, as with herdr.

herdr-core has no workspace of its own and opens no layout. Remote machines (`hc run --on`) are not used.
