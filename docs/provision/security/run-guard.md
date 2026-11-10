---
title: Run guard
description: Which destructive Git, file, DDEV and forge commands a Claude or Codex run is refused outside its own branch, worktree and project, how refusals are reported, and the guard's limits.
---

# Run guard

Claude and Codex runs pass every shell command through the run guard before it runs, in every `permissions` mode, `yolo` included. The guard refuses a destructive command outside the run's own branch, worktree and DDEV project. A refused command does not run: the agent receives the rule and an allowed alternative, and the run log keeps one note per refusal. When the run is cancelled or ends without its branch on `origin`, the ticket gets one comment listing the refused commands.

What a guarded agent may do:

- Push its ticket's branch, or a `<branch>-<suffix>` branch, to `origin` without force, naming the refspec (`git push -u origin HEAD` while that branch is checked out, `git push origin HEAD:<branch>`). It deletes no branch or tag on `origin`, its own included.
- Delete files inside its worktree and `$TMPDIR`.
- Reset, clean, restore and delete branches only in its own worktree and only its own branch.
- Delete or remove the data of its own DDEV project, from its worktree.
- Read, create, comment on and merge PRs and MRs with `gh` and `glab`, including the forge removing the merged source branch (`gh pr merge --delete-branch`, `glab mr merge --remove-source-branch`).

What it refuses:

| Rule | Refused |
|---|---|
| `git-push` | any force (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+` refspec), `--mirror`, `--all`, `--tags`, `--prune`, a remote other than `origin`, updating another branch, deleting any branch or tag (its own included), `git send-pack` and `git http-push`, `HEAD` while another branch is checked out, a push without a refspec (the user's `push.default` would decide), or a push from outside the worktree. Abbreviated options count as the option they abbreviate (`--force-w`, `--del`) |
| `git-config` | `git -c`, `git config` writes and `git remote set-url`/`rename` for `alias.*`, `remote.*`, `push.*`, `url.*`, `include.*` and `includeIf.*`, which change what a push sends or where, or load other configuration |
| `git-branch-delete`, `git-update-ref` | deleting or moving a branch or ref the run does not own, and `git update-ref --stdin` |
| `git-worktree-remove` | removing any worktree but its own |
| `git-discard-outside` | `git reset --hard`, `git clean`, `git checkout --` and `git restore` outside the worktree, including through `-C`, `--git-dir` and `--work-tree` |
| `git-stash` | `git stash drop` and `git stash clear`: the stash stack is shared by every worktree |
| `delete-outside` | `rm`, `rmdir`, `unlink`, `shred`, `find … -delete` and `find … -exec rm` on a target outside the worktree and `$TMPDIR` |
| `ddev-other` | `ddev delete` and `--remove-data`/`-R` for another project, or for every project with `--all`/`-a` |
| `forge-delete` | `gh`/`glab` closing or deleting a PR/MR, deleting a release or repository, and API writes that delete any branch, close (`state=closed`, GraphQL close and delete mutations) or move another branch or a tag |
| `forge-alias` | `gh alias set`/`import` and `glab alias set`, which could give a refused command another name |
| `forge-branch` | API writes that commit to, merge into or rename another branch (`branch=`, `…/merges` with `base=`, `…/branches/<name>/…`) |
| `unresolvable` | a destructive command whose target depends on the shell: an unknown `$VAR` or `${…}`, `~user`, `$(…)`, `$'…'`, backticks, brace expansion (`{a,b}`, `{1..3}`), a computed command name (`$R -rf x`, a lone `$CMD`) or word (`${IFS}`), a computed git subcommand or option, `eval` of such a string, a shell reading commands from stdin, a pipe or a here-string (`… \| bash`, `bash <<<`, `bash -s`), `source <(…)`, `xargs`, a `gh api` body read from a file (`--input`, `-F key=@file`), `GIT_DIR`/`GIT_CONFIG_*` in the environment, and a relative path after a `cd` the guard cannot be sure of: one not chained with `&&`, in a pipeline, or `cd -`, `pushd` without a directory and `popd` |

The guard follows `&&`, `||`, `;`, `|`, newlines, subshells (a `cd` inside one ends with it), `{ … }`, `if`/`while`/`for` bodies, `$(…)` and backtick substitutions, a literal `cd` chained with `&&`, `git checkout`/`switch` (after any other git subcommand that can change the checked-out branch, such as `rebase <upstream> <branch>`, `symbolic-ref` or `bisect`, a `HEAD` push is refused), the wrappers `sudo`, `doas`, `env` (`-S` included), `timeout`, `nice`, `ionice`, `stdbuf`, `nohup`, `time`, `command`, `exec`, `setsid`, `watch`, `flock` (`-c` included), `caffeinate`, `chronic`, `unbuffer`, `busybox`, `arch`, `taskset`, `chrt` and `strace`, `trap`, `xargs` and `find -exec`, `bash -c`, `sh -c` and the other shells' `-c`, `eval`, `find` options before the start paths, `..` after a symlink, and symlinks that a trailing `/`, a glob or `find -L` would follow. It matches commands; it is not a security boundary. A command inside a script file or an interpreter (`python -c`, `node -e`), a runner it does not list, or a git or gh alias the user already configured is not inspected, and no tool served to a run deletes a ticket. [Isolate the machine](/provision/security/execution#risk-of-loosening) where that matters.

`bakers agents` shows `guard: active`, `partial`, `off` or `not_applied` per alias. Grok, OpenCode, Pi and Kimi report `not_applied`. Only `guard: false` on a Claude or Codex entry in `~/.bakers/machine.config.js` switches the guard off. No mode does, and a committed project config cannot, because agent entries are accepted only in the machine config.

Codex receives the guard as a `-c hooks.PreToolUse=…` override and shows `partial` until a real Codex run has shown that the hook blocks a shell call.
