# bakers ui keys

The new-ticket popup, the deep-link targets, the auto-refresh signal and every keybinding of `bakers ui`; the screens themselves are on [bakers ui](/advanced/cli/ui).

## Creating a ticket - the new-ticket popup (`n`)

`n` opens a centered modal popup with a **Title**, a multiline **Description**, a searchable **Parent**, and live-loaded **Assignee**, **Conductor**, **Labels** (multi-select) and **Workflow** selects. Your own user and the conductor registered for this checkout are preselected. **Title** comes first because the server requires it. **Conductor** is the one select you can **clear** (`Del` or `Backspace`): a set conductor means the ticket is claimed at the next poll and a run starts, a cleared one means it waits for a human.

The popup ends in two submit rows, `[ Create with agent ]` and `[ Create directly ]`, and two key-hint rows inside the frame, because the frame is at most 60 columns wide:

```
 ↑↓ field · ←→ change · Space toggle
 Ctrl+S agent · Ctrl+D direct · Esc cancel
```

`Ctrl+S` presses the action row you stand on and from any other field means the agent; `Ctrl+D` creates directly from any field; `Enter` on an action row fires that row. `Tab` and `Shift+Tab` walk the fields forward and back, like `↓` and `↑`.

- **Create with agent** writes the fields to a temporary JSON spec, passed as `$BB_NEW_TICKET_INPUT` (never on the command line), and an embedded agent asks you only for what is missing.
- **Create directly** is one POST, with no agent and no qualification handoff. The typed text becomes the description verbatim (format `bb_rich`); workflow, assignee, conductor, labels and parent are written as picked, and the server owns the rest, so the ticket lands in the workflow's first state. It needs a project: opened from a project, that project is used; opened from a root screen, the popup adds a **Project** field above Title, and picking a project narrows **Conductor** and **Parent** to that project; changing the pick clears both. Without a project it refuses with `no project selected — pick one above to create directly` and writes nothing; the agent row refuses the same way. It also refuses an empty title before the round trip: `title is required — type one, or hand it to the agent`. The agent row has no title precondition. A rejected write is reported in the popup and your text stays.

When an option list cannot load, the popup says so for that list instead of showing an empty one.

**Parent** is optional and limited to the project you are in: type to filter, `←→` moves the suggestion cursor, `Enter` picks. It offers only the project's **open** tickets, so new work is never filed under a finished one (the ticket list's own parent filter still offers closed ones). Matching is a case-insensitive substring of `<identifier> · <title>`. Five suggestions show at once and `+N more` counts the popup's own overflow, not the server's; the server caps a page at 50 rows, so a full page may be truncated and the field says `more may exist`.

On submit each agent becomes a split pane in its project's durable terminal tab (`bakers-agents:<project>`), named after the ticket and zoomed full-screen. `Ticket-Agents` shows only the agents of the project you are in; they survive a restart of the UI because the screen rediscovers them from the live tab. There `Enter` switches to an agent, `z` returns to the tiled overview and `x` closes one.

## Deep links

`bakers ui` takes at most one target source; two or more of a positional target, `--ticket`, `--project`, `--run` and `--here` exit non-zero and name which.

| Form | Opens |
|---|---|
| `bakers ui` | **My work** for the active workspace |
| `bakers ui SHOP-221`, `ticket:SHOP-221`, `ticket:<uuid>`, `--ticket SHOP-221` | that ticket's detail |
| `project:shop`, `--project shop` | that project's **Work** screen |
| `run:<uuid>`, `--run <uuid>` | that run's detail, over its ticket's Runs tab |
| `'#19'`, `shop#19`, issue URL | [its origin's ticket](/advanced/cli/terminal-ui) |
| `--here` | derived from the working directory |

Identifiers are `<project-key>-<number>`, case-insensitive (`shop-221` becomes `SHOP-221`). A bare number or bare UUID is rejected; prefix a UUID with `ticket:`, `project:` or `run:`. Project names are case-sensitive, and `project:x` always parses as the prefix form, so a project named `ticket` needs `--project ticket`.

`--view <mode>` modifies a ticket target: `full` (default, the tabbed detail), `teaser` (a compact block of identifier, title, state, assignee and claim) or `board_card` (state, type, priority, claim). It is rejected with `project:` and `run:` targets.

**`--here`** takes the ticket identifier in the current branch name (the first match, so `feat/shop-99-fix-404-page` gives `SHOP-99`). Without one it normalises `git remote get-url origin` (scheme, user, port and `.git` dropped, lowercased) and matches it client-side against each project's repository. One match opens that project; several open a picker (`Enter` opens, `Esc` falls back to My work); none, or no remote, is an error listing the known projects. It needs no `.bakers/` directory.

Every failure prints one line to stderr and exits 1 before the UI takes the terminal.

### Deep links are not a dead end

Booting straight into a ticket, run, addon tab, or picker pushes no back-history frame, so `Esc` on an empty history opens **My work** and the session joins normal navigation. A direct project deep link opens Work, whose `Esc` returns to the root-level project list. Other project tabs preserve the selected project while following their registered project fallback.

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

The file is transient and git-ignored; nothing in bakers.build writes it.

## Keybindings

| Screen | Keys |
|--------|------|
| Stats | `PgUp`/`PgDn`/`g`/`G` scroll · `←→` switch the tab group · `t` cycle Range · `Tab`/`Shift-Tab` cycle scope tabs · `n` new ticket agent · `q` quit |
| Workspace/Team Members | `↑↓` select · `Enter` open member · `Tab`/`Shift-Tab` cycle tabs · `q` quit |
| Assigned, Member Tickets, Team Work | `/` search |
| Projects | `↑↓` select · `Enter` open project · `n` new ticket agent · `Tab`/`Shift-Tab` cycle tabs · `q` quit |
| My work | `↑↓` select · `Enter` open · `/` search · `s` state · `p` parent · `r` project · `x` closed · `c` clear · `Tab`/`Shift-Tab` cycle tabs |
| Tickets | `↑↓` select · `Enter` open ticket · `n` new ticket agent · `/` search · `s` state filter · `w` who · `o` owner · `p` parent · `m` mine · `x` closed filter · `c` clear · `e` edit · `y`/`Y` copy id/link · `←`/`→` page · `R` reload · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Ticket | `Tab`/`Shift-Tab` switch section · `↑↓`/`jk` move between the section's entries and fall through to the body scroll at either end · `PgUp`/`PgDn` page the body when no modal is open · `g`/`G` first/last entry · `Enter`/`Space` expand the selected entry · `Enter` on a run row opens it · `e` edit ticket · `f` freeze or unfreeze · `y`/`Y` copy id/link · `Esc` back |
| Run detail | `↑↓` scroll · `e` cancel a claimed or running run · `Esc` back to the ticket's Runs tab · `q` quit |
| Ticket-Agents | `↑↓` select · `Enter` switch to agent · `z` tiled overview · `x` close · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Runs | `↑↓` select · `Enter` open the run's ticket · `x` closed filter · `←`/`→` page · `R` reload · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Conductors | `↑↓` select · `Enter` open the conductor · `s`/`x` start/stop (mine only) · `m` mine filter · `c` clear · `R` reload · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Conductor detail | `Tab`/`Shift-Tab` cycle its tabs · `↑↓` select on Held work and Assigned · `Enter` opens the ticket · `Esc` back |
| New-ticket popup (`n`) | `↑↓`/`Tab`/`Shift+Tab` move field · `←→` change a select, or move the label or parent cursor · `Space` toggle a label · `Del`/`Backspace` clear the Conductor · `Enter` pick a parent suggestion or press the action row you are on · `Ctrl+S` hand to the agent (or press the row you are on) · `Ctrl+D` create directly · `Esc` cancel |
| Any screen | `W` workspace picker · `R` reload where the screen reloads · `q` quit |

`Tab`/`Shift+Tab` mean two different things, and which one you get depends on what is on screen. On a **screen** they cycle that level's tab bar, as the rows above say. Inside a **modal form** (the new-ticket popup, the Who picker, the parent filter, the assignment edit) they move the form's own cursor instead, mirroring `↓` and `↑`: forward and back through the fields and, on the **parent filter**, the one picker that hands its field count to the key handler, through its suggestions. The **Who picker** has the same one-field shape but does not hand it over, so there both keys stay field moves, and a form with one field has nowhere to move them: they do nothing.
