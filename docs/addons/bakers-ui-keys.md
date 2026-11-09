# bakers ui keys

The deep-link targets, the auto-refresh signal and every keybinding of `bakers ui`; the screens themselves are on [bakers ui](/addons/bakers-ui/reference).

## Deep links

`bakers ui` takes at most one target source; two or more of a positional target, `--ticket`, `--project`, `--run` and `--here` exit non-zero and name which.

| Form | Opens |
|---|---|
| `bakers ui` | **My work** for the active workspace |
| `bakers ui SHOP-221`, `ticket:SHOP-221`, `ticket:<uuid>`, `--ticket SHOP-221` | that ticket's detail |
| `project:shop`, `--project shop` | that project's **Overview** screen |
| `run:<uuid>`, `--run <uuid>` | that run's detail, over its ticket's Runs tab |
| `'#19'`, `shop#19`, issue URL | [its origin's ticket](/addons/bakers-ui/usage) |
| `--here` | derived from the working directory |

Identifiers are `<project-key>-<number>`, case-insensitive (`shop-221` becomes `SHOP-221`). A bare number or bare UUID is rejected; prefix a UUID with `ticket:`, `project:` or `run:`. Project names are case-sensitive, and `project:x` always parses as the prefix form, so a project named `ticket` needs `--project ticket`.

`--view <mode>` modifies a ticket target: `full` (default, the tabbed detail), `teaser` (a compact block of identifier, title, state, assignee and claim) or `board_card` (state, type, priority, claim). It is rejected with `project:` and `run:` targets.

**`--here`** takes the ticket identifier in the current branch name (the first match, so `feat/shop-99-fix-404-page` gives `SHOP-99`). Without one it normalises `git remote get-url origin` (scheme, user, port and `.git` dropped, lowercased) and matches it client-side against each project's repository. One match opens that project; several open a picker (`Enter` opens, `Esc` falls back to My work); none, or no remote, is an error listing the known projects. It needs no `.bakers/` directory.

Every failure prints one line to stderr and exits 1 before the UI takes the terminal.

### Deep links are not a dead end

Booting straight into a ticket, run, addon tab, or picker pushes no back-history frame, so `Esc` on an empty history opens **My work** and the session joins normal navigation. A direct project deep link opens Overview, whose `Esc` returns to the root-level project list. Other project tabs preserve the selected project while following their registered project fallback.

### Piping

Without a TTY the command prints the route's content once and exits (honouring `--view`; an ambiguous `--here` prints its candidates; with no target, **My work**). There is no `projects:` target; `bakers tools tool_api__bakers_project_list` prints the project list.

## Auto-refresh - the `.bakers/ui-refresh` signal

An interactive `bakers ui` inside a project watches one file in that project's `.bakers/` directory. Anything that can write a file can signal stale data, be it an agent, a git hook or a script in a container:

```
touch .bakers/ui-refresh
```

Only the modification time matters. A bump runs what `R` runs on the active screen, and `R` keeps working. The footer shows `R:reload (auto)` while the watcher is live and `R:reload` without it.

- A screen that declares no reload, such as a form, the project picker or any popup, is not reloaded, and the bump is not remembered.
- Writes closer together than 300 ms coalesce into one reload; a continuous stream waits until it pauses for one window, which shields the control plane from a looping agent.
- A piped run builds no watcher, and neither does a cockpit outside a project.

The file is transient and git-ignored. The conductor touches it in the checkout when a run is claimed. It touches it in the checkout and in the run's worktree when a run starts, fails or is finalised, and after a run's agent writes a ticket through the conductor's tools. Changes made on the web, on another machine or by a remote conductor still need `R`; nothing polls.

## Keybindings

| Screen | Keys |
|--------|------|
| Workspace Members | `↑↓` select · `Enter` open member · `Tab`/`Shift-Tab` cycle tabs · `q` quit |
| Assigned, Member Tickets | `/` search |
| Projects | `↑↓` select · `Enter` open project · `Tab`/`Shift-Tab` cycle tabs · `q` quit |
| My work | `↑↓` select · `Enter` open · `/` search · `s` state · `p` parent · `r` project · `x` closed · `c` clear · `Tab`/`Shift-Tab` cycle tabs |
| Tickets | `↑↓` select · `Enter` open ticket · `/` search · `s` state filter · `w` who · `o` owner · `p` parent · `m` mine · `x` closed filter · `c` clear · `e` edit · `y`/`Y` copy id/link · `←`/`→` page · `R` reload · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Ticket | `Tab`/`Shift-Tab` switch section · `↑↓`/`jk` move between the section's entries and fall through to the body scroll at either end · `PgUp`/`PgDn` page the body when no modal is open · `g`/`G` first/last entry · `Enter`/`Space` expand the selected entry · `Enter` on a run row opens it · `e` edit ticket (on Runs: the selected claimed or running run) · `f` freeze or unfreeze · `y`/`Y` copy id/link · `Esc` back |
| Run detail | `↑↓` scroll · `e` cancel a claimed or running run · `Esc` back to the ticket's Runs tab · `q` quit |
| Runs | `↑↓` select · `Enter` open the run's ticket · `x` closed filter · `←`/`→` page · `R` reload · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Conductors | `↑↓` select · `Enter` open the conductor · `s`/`x` start/stop (mine only) · `m` mine filter · `c` clear · `R` reload · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Conductor detail | `Tab`/`Shift-Tab` cycle its tabs · `↑↓` select on Held work and Assigned · `Enter` opens the ticket · `Esc` back |
| Any screen | `W` workspace picker · `R` reload where the screen reloads · `q` quit |

`Tab`/`Shift+Tab` mean two different things, and which one you get depends on what is on screen. On a **screen** they cycle that level's tab bar, as the rows above say. Inside a **modal form** (the Who picker, the parent filter, the assignment edit) they move the form's own cursor instead, mirroring `↓` and `↑`: forward and back through the fields and, on the **parent filter**, the one picker that hands its field count to the key handler, through its suggestions. The **Who picker** has the same one-field shape but does not hand it over, so there both keys stay field moves, and a form with one field has nowhere to move them: they do nothing.
