---
name: bb-get-started
description: Use for a quick start — set up bakers.build on this computer in one run with one question, ending in a running test ticket. Alias bb-quick-start.
---

# Quick start

One run, one question; everything else takes the default below. Speak the system
language (`LC_ALL`, `LC_MESSAGES`, `LANG`; unset, `C`, `POSIX`: English); commands, paths, keys and
URLs stay verbatim. Never run `sudo`, `bubblewrap` or `socat`: a step needing them stops.

1. **CLI.** `bakers --version`; missing: `npm install -g @bakers-build/bakers`; `EACCES` stops,
   naming `npm config set prefix ~/.local`. **Done when** it prints a version.
2. **Sign-in.** `bakers auth status`. Signed out: `bakers init --yes`, then `bakers auth login` in the
   background; show its URL and code at once, wait up to 10 minutes, else
   stop. **Done when** `bakers auth status` shows a session.
3. **The question.** Ask: an existing Git project's path, or the demo. A path that fails
   `git -C <path> rev-parse --show-toplevel`: ask again with the reason; never `git init`. Demo:
   clone `https://github.com/bakers-build/northside-shop` to `~/projects/northside-shop`, reusing
   its clone there; anything else there stops. **Done when** `<project>` is a Git top level.
4. **Machine.** In `~/.bakers/machine.config.js`, keeping every key: add this skill's harness
   (`@bakers-build/addon-claude` or `-codex`) to `addons`; unset `permissions.mode` becomes
   `system`, no `runtime`. **Done when** it reads back so.
5. **herdr-core.** `hc --version`; missing: install per `https://herdr.dev/core/` into
   `~/.local/bin`. **Done when** it prints 0.1.18 or later.
6. **Server project** through [tools](../bb-workflow/references/tools.md). Workspace and team: the
   only one, else the connection's `workspace_id`, else the first by name. Group `Quick start`:
   reuse or create. Project named after the repository folder: reuse it, or create it with the
   `origin` URL and `default_branch` from `origin/HEAD`, else the current branch.
   **Done when** `bakers_project_read` returns it.
7. **Files.** `bakers config init --scope project --path <project> --project <name> --workspace
   <workspace name> --executor @bakers-build/addon-herdr-core --yes`; absent `WORKFLOW.md`: the
   [skeleton](../bb-init-project/references/WORKFLOW.template.md); missing `.gitignore` lines
   `/assets-ai/`, `/.bakers/log.txt`, `/.bakers/connection.config.js`. Own project without
   `WORKFLOW.md` on `origin/<default_branch>`: commit `chore: set up bakers.build` and push it
   there; refused: stop, naming a merge request. **Done when**
   `bakers config check --scope project --online` passes.
8. **Conductor.** In `<project>`: `bakers conductor start`. **Done when** `bakers conductor status`
   shows it online, within 1 minute.
9. **Test ticket.** `bakers_ticket_create`, workflow `bb_work`: demo "Show opening hours on the
   contact page" (done when it lists every weekday's hours); own project the
   [example](../bb-init-project/references/project-setup.md#start-the-session). Then
   `bakers_ticket_update` `labels_add: [human-review]`; then set the step-8 conductor
   ([people](../bb-workflow/references/people.md)). **Done when** `bakers_run_list` lists a run,
   or after 2 minutes.
10. **Overview**, at most 15 lines: one line per step, only `✔` or `✖`,
    `<step> — <result>`, for sign-in, CLI, `hc`, machine (`permissions.mode`), server project
    (workspace / group / name, new or reused), files (written, kept, pushed), conductor, test
    ticket URL; a caveat stays in its line. A stop: `✖` with the remedy, later steps `not run`.
    Then exactly three ways on: follow the test ticket (demo: push it to your own repository to
    deliver); create your own with `bakers:bb-create-ticket`; confine agents:
    `https://bakers.build/get-started/#advanced-setup`.

A rerun fills only what is missing and creates a new test ticket.
