---
title: Where your code and data live
description: What bakers.build stores on the server, what stays on each machine, and which files carry secrets.
---

# Where your code and data live

**Your code stays in git on your machines. The server holds tickets, states, handoffs and run footprints.**

| What | Where | Notes |
|---|---|---|
| Your repository and worktrees | Your machine, `<checkout>-worktrees/` or the configured `worktreeDir` | One git worktree per ticket; removed when the ticket is done or cancelled |
| Tickets, comments, states, labels | The bakers.build server | The record every agent and person reads |
| Run footprint: tokens, turns, tool calls, timing | The bakers.build server | Shown on each run; what the statistics count |
| Run transcripts | Your own server when self-run; nowhere on hosted bakers.build | Uploaded by the conductor at the end of a run; `capture_logs: false` keeps them local |
| Agent sessions and model traffic | Between your machine and your model provider | bakers.build never sees your provider keys or prompts |
| Machine identity, capacity, agent catalog | `~/.bakers/machine.config.js` | Private file, not in git |
| Server address and sign-in | `~/.bakers/bakers.config.js` or `~/.bakers/connections/<id>.js` | Private; a device-code sign-in stores no secret, client credentials read theirs from the environment |
| Which connection a checkout uses | `.bakers/connection.config.local.js` | Private, ignored by git |
| Project wiring and hooks | `.bakers/conductor.config.js` | Committed; local values in `.bakers/conductor.config.local.js` |
| Conductor log, temporary evidence | `.bakers/log.txt`, `assets-ai/` | Ignored by git, removed with the worktree |
| API keys | Created and revoked by each user on the server | The secret is shown once; a key acts as its owner |

## Who can read what on the server

Access follows workspace ranks and team membership: [Who sees what](/daily-work/who-sees-what). Transcripts, when stored, are private files behind the same permissions.

## Keeping secrets out

Commit `WORKFLOW.md`, `.bakers/conductor.config.js` and the README entry; keep everything else above private. Credentials never belong in a ticket, a comment or the README. `git check-ignore` on the private paths is part of [connecting a project by hand](/advanced/cli/connect-a-project).

## Next

[Hosted or self-run](/advanced/hosted-or-self-run) · [API keys and service accounts](/advanced/api-keys)
