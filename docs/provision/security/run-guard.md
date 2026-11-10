---
title: Run guard
description: Which destructive Git, file, DDEV and forge commands a Claude or Codex run is refused outside its own branch, worktree and project, how refusals are reported, and the guard's limits.
---

# Run guard

Claude and Codex runs pass every shell command through the run guard before it runs, in every `permissions` mode, `yolo` included. The guard refuses a destructive command outside the run's own branch, worktree and DDEV project. A refused command does not run: the agent receives the rule and an allowed alternative, and the run log keeps one note per refusal. When the run ends without its branch on `origin`, the ticket gets one comment listing the refused commands.

What a guarded agent may do:

- Push its ticket's branch, or a `<branch>-<suffix>` branch, to `origin` without force (`git push`, `git push origin HEAD:<branch>`).
- Delete files inside its worktree and `$TMPDIR`.
- Reset, clean, restore and delete branches only in its own worktree and only its own branch.
- Delete or remove the data of its own DDEV project, from its worktree.
- Read, create and comment on PRs and MRs with `gh` and `glab`.

What it refuses:

| Rule | Refused |
|---|---|
| `git-push` | any force (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+` refspec), any delete (`--delete`, `-d`, a `:<ref>` refspec), `--mirror`, `--all`, `--tags`, `--prune`, a remote other than `origin`, another branch, or a push from outside the worktree |
| `git-branch-delete`, `git-update-ref` | deleting or force-moving a branch or ref the run does not own |
| `git-worktree-remove` | removing any worktree but its own |
| `git-discard-outside` | `git reset --hard`, `git clean`, `git checkout --` and `git restore` outside the worktree, including through `-C`, `--git-dir` and `--work-tree` |
| `git-stash` | `git stash drop` and `git stash clear`: the stash stack is shared by every worktree |
| `delete-outside` | `rm`, `rmdir`, `unlink`, `shred`, `find … -delete` and `find … -exec rm` on a target outside the worktree and `$TMPDIR` |
| `ddev-other` | `ddev delete` and `--remove-data` for another project, or for every project with `--all` |
| `forge-delete` | `gh`/`glab` closing, merging or deleting a PR/MR, deleting a release or repository, `api -X DELETE`, and an API write to another branch |
| `unresolvable` | a destructive command whose target depends on the shell: an unknown `$VAR`, `$(…)`, backticks, `xargs`, or a `cd` to such a path |

The guard follows `&&`, `||`, `;`, `|`, newlines, a literal `cd`, `sudo`, `env` and `bash -c`/`sh -c`. It matches commands; it is not a security boundary. A command inside a script file or an interpreter (`python -c`, `node -e`) is not inspected, and no tool served to a run deletes a ticket. [Isolate the machine](/provision/security/execution#risk-of-loosening) where that matters.

`bakers agents` shows `guard: active`, `off` or `not_applied` per alias. Grok, OpenCode, Pi and Kimi report `not_applied`. Only `guard: false` on a Claude or Codex entry in `~/.bakers/machine.config.js` switches the guard off. No mode does, and a committed project config cannot, because agent entries are accepted only in the machine config.

Codex receives the guard as a `-c hooks.PreToolUse=…` override. It has not yet been checked against a real Codex run.
