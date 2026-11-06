# `@bakers-build/ui` — `bakers ui` and its deep-link grammar

`bakers ui` is the interactive terminal cockpit: dashboard → projects → ticket list → ticket
detail. Since BB-223 it also takes a **deep-link target**, so you can open the one thing
you are working on in a single command instead of navigating to it every time.

This file is the **canonical reference** for that grammar. `bakers-cli/README.md` and
`bakers-cli/README.npm.md` carry a short version; `bakers ui --help` carries the same table in
terse form.

> **Repo note.** `prepare-publish.mjs` replaces every non-meta package README with a
> generated stub, so this file never reaches npm. That is why the short section is
> mirrored into `README.npm.md`, which npm users *do* receive.

## Synopsis

```
bakers ui [target] [--ticket <id>] [--project <id>] [--run <uuid>] [--here]
        [--view <mode>] [--config <path>] [--print-config]
```

## Target sources — at most ONE, ever

| Form | Example | Opens |
|---|---|---|
| *(nothing)* | `bakers ui` | **My work**, your open assigned tickets |
| bare identifier | `bakers ui BB-221` · `bakers ui bb-221` | that ticket's detail screen |
| `ticket:<id\|uuid>` | `bakers ui ticket:BB-221` · `bakers ui ticket:<uuid>` | that ticket |
| `project:<name\|uuid>` | `bakers ui project:bakers` | that project's **Overview** (its ticket list is one `Tab` away) |
| `run:<uuid>` | `bakers ui run:<uuid>` | the run's **owning ticket**, Runs tab active |
| `--ticket <id>` | `bakers ui --ticket BB-221` | the flag equivalent of `ticket:` |
| `--project <id>` | `bakers ui --project bakers` | the flag equivalent of `project:` |
| `--run <uuid>` | `bakers ui --run <uuid>` | the flag equivalent of `run:` |
| `--here` | `bakers ui --here` | derived from the cwd — see [the ladder](#here--the-ladder) |

**The conflict rule — one rule, not a pairwise matrix.** Supplying two or more of those
six sources exits non-zero and names *which* ones were supplied:

```
$ bakers ui BB-1 --project bakers
bakers ui: conflicting targets — the positional target 'BB-1', --project were all supplied.
Give at most one of: a positional target, --ticket, --project, --run, --here.
```

**Prefix precedence.** `project:x` always parses as the prefix form. A project literally
named `ticket` is therefore reachable as `bakers ui --project ticket`, never as
`bakers ui ticket:…`.

## Identifier normalisation

- **Accepted:** `BB-221` and `bb-221`, both normalised to **uppercase**. This is not a
  convenience: a branch carries the identifier lowercased (`feat/bb-223-…`), so `--here`
  cannot work without it.
- **Rejected — a bare number** (`bakers ui 221`). An identifier is `<project-key>-<n>` and the
  CLI knows a project *name*, not its *key*. The error lists the accepted forms.
- **Rejected — a bare UUID** (`bakers ui 1111…`). It does not say ticket/project/run, so it is
  ambiguous by construction. Prefix it: `ticket:<uuid>`, `project:<uuid>`, `run:<uuid>`.
- **Project names are used verbatim** — Drupal entity labels are case-sensitive.

## `--here` — the ladder

```
cwd
 ├─ branch carries a ticket identifier?  → that TICKET     (feat/bb-223-… → BB-223)
 └─ else: the cwd's git remote → the project(s) whose repository claims it
      ├─ exactly one                     → that PROJECT
      ├─ several                         → a PICKER of them
      └─ none, or no remote at all       → error, exit 1
```

**The branch decides the first rung, not git mechanics.** "Am I in a linked worktree?" would
be wrong twice — a worktree sitting on a non-ticket branch, and the main clone checked out on
a ticket branch (which is how you work without worktrees). The parse is pure and offline:

```
/(?:^|[/_-])([A-Za-z][A-Za-z0-9]*-\d+)(?=$|[/_-])/     first match wins
```

Every convention puts the identifier *before* the title slug and the server never truncates
it, so first-match-wins is right: `feat/bb-99-fix-404-page` yields `BB-99`, not `FIX-404`.
A version-shaped branch (`release/v2-2026`) can over-match; it then fails at resolution with
a named error rather than opening a wrong ticket.

**The project rung goes through the git remote.** `git remote get-url origin` is normalised
and matched against every `bb_project`'s `repository.url` — the control plane's own
declaration decides which project a directory belongs to. It needs no `.bakers/` at all, so a
fresh clone without project initialization still resolves through its configured global
connection. Use `bakers config init --scope connection` when that connection is absent.

Normalisation is required, not cosmetic: git and the stored field disagree on form.

| raw | normalised |
|---|---|
| `git@host:bakers-build/bakers-build.git` | `host/bakers-build/bakers-build` |
| `ssh://git@host/bakers-build/bakers-build.git` | `host/bakers-build/bakers-build` |
| `ssh://git@host:2222/bakers-build/bakers-build.git` | `host/bakers-build/bakers-build` |
| `https://host/bakers-build/bakers-build.git` | `host/bakers-build/bakers-build` |

Scheme, userinfo, port, a trailing `.git` and trailing slashes are dropped and the result
lowercased. The match runs **client-side**, because it must: `filter[repository]` answers HTTP
400 — `repository` is a JSON field, not a relationship JSON:API can filter inside.

**Several projects claim the repo → a picker, not an error.** One repo mapping to several
bakers.build projects is designed for (a Drupal multisite repo maps each site to its own project),
so `--here` lists the candidates and lets you choose. Enter opens the selected one, `Esc`
falls back to the dashboard. Without a TTY the list is printed with a
`bakers ui project:<name>` hint and the command exits.

```
  Several bakers projects claim host/keytec/shop — which one?

  ▸ shop-de
    shop-at
    shop-ch
```

**No project claims the repo → an error**, naming the repo and the known projects:

```
bakers ui --here: no bakers project owns the repo git.key-tec.de/keytec/neues-ding.
  Known projects: bakers, shop, dropsh
  Run 'bakers ui' and press Tab for the project list, or 'bakers ui project:<name>' to open one directly.
```

No git remote at all (outside a repo, or a repo without `origin`) fails the same way, naming
the cwd. Detached HEAD is not special-cased: no branch → no identifier → the project rung,
which is the useful answer.

## `--view <mode>` — how a ticket renders

`--view` is a **modifier**, not a target source: it never participates in the conflict rule.

| Mode | Renders |
|---|---|
| `full` *(default)* | the tabbed detail screen — Description, Comments, Runs, Branch, … |
| `teaser` | a compact block: identifier · title, state, status, since, assignee, claim |
| `board_card` | a compact block with the board-card field set: state, type, status, priority, claim |

```bash
bakers ui BB-221 --view teaser
bakers ui BB-221 --view board_card
```

The two compact field sets mirror the Drupal `teaser` / `board_card` view-mode displays of
`bb_ticket`. They are a deliberate duplicate — those displays are display_builder→SDC
bindings producing HTML, JSON:API serves no rendered output, and the CLI's scopes may not
read `entity_view_display`. Making the Drupal display drive the TUI is a named follow-up;
the `--view` flag is identical either way.

Rules:

- An unknown mode exits non-zero listing the known ones.
- `--view` applies to **ticket targets only**; with a `project:` target it exits non-zero.
- `run:` already means "the owning ticket's Runs tab", so `run:<uuid> --view teaser` is
  rejected as contradictory rather than silently resolved by a precedence rule.

## What a `run:` target opens

The **owning ticket's detail screen with the Runs tab active** — identical to pressing Enter
on a run row in the project Runs list. The ticket-detail Runs tab renders a *count*, not a
selectable list, so there is no run row to highlight. The route carries the run id anyway, so
a future dedicated run screen needs no change to this grammar.

## Failures never draw a screen

Every failure — a parse error, a conflict, no git remote, an unknown identifier, an unknown
uuid, a repo no project claims — prints one line to stderr and exits 1 **before** the TUI
takes the terminal: no raw mode, no alternate screen, no dashboard. Parse/conflict/no-remote
fail entirely offline, before any config is loaded or any request is made.

The picker is the one *successful* outcome that is a screen, so it necessarily runs after the
terminal is taken. Ambiguity is not a failure.

## Deep links are not a dead end

Booting straight into a ticket, project or picker pushes no back-history frame. `Esc` on an
empty history therefore opens **My work**, so a deep-linked session converges on the normal
navigation model instead of leaving `q` as the only way out.

## Piping (`| cat`, `< /dev/null`)

Without a TTY the command prints **the route's** content once and exits: the ticket's lines
(honouring `--view`), the project's ticket table, or the picker's candidate list plus its
hint. With no target it prints **My work**, the routeless default screen; `project:<name>`
prints that project's current Work surface.

There is consequently **no non-interactive way to print the project list** in `bakers ui` any
more: the deep-link grammar has no `projects:` target. `bakers tools
tool_api__bakers_project_list` prints the projects, and `tool_api__bakers_conductor_list` a
project's conductors.

## The Conductors tab (BB-232)

The root tab bar reads `My work · Projects · Conductors` (plus `Members` for workspace leads). The Conductors screen lists every
`bb_conductor` the connected control plane holds for you — label, machine label, project,
derived liveness (`running | stale | offline`), age, workspace and last known pid.

A conductor is this machine + project + variant; its label names all three, so two conductors
of one repo on one machine differ by their variant. The workspace path is shortened from the
**left**, because only its tail distinguishes rows.

| Key | What it does |
|---|---|
| `s` | start the selected conductor |
| `x` | stop it (a verified `SIGTERM`) |
| `R` | refresh now, instead of waiting for the 5 s tick |
| `Enter` | open/close its `log.txt`, tailed and formatted |
| `j`/`k`, arrows, `Tab`, `Esc` | as everywhere else |

**Rows from your other machines appear, marked `elsewhere`, and do not act.** The control
plane is scoped to *you*, not to this machine, so hiding them would make the cockpit
disagree with `bakers oven ls` for no visible reason — while acting on them is
meaningless, since a pid only identifies a process on the machine that reported it.

**A conductor that has never run on this machine does not appear**, because it has no record
to appear from. Its first start is still `bakers oven start` inside the checkout; after
that it is on the list like any other.

**Each repo reaches its own control plane**, so this tab shows the conductors of whichever
instance the current project connects to — not every conductor on the machine. See the
section below for which config wins.

## Which control plane answers

`bakers ui` resolves its connection through the same single rule `bakers tools` and `bakers auth` use:
explicit `--config` / `$BB_CONFIG` / `$DROPSH_CONFIG` → the project's
`./.bakers/bakers.config.js` (walk-up) → `~/.bakers/bakers.config.js` → the shipped fallback. So
running it inside a repo that declares its own connection reaches **that** repo's control
plane. `bakers ui --print-config` reports which file won, its source and its `base_url`,
without launching the UI.

It also reports **`bb_dir`**: the `.bakers` dir of the project you are standing in, which is a
separate question from which connection won (an explicit `--config` must not be able to
move it). Since BB-232 that dir is also how the cockpit finds *this checkout's*
conductor — the record whose `workspace_root` matches it supplies the default project when
`--project` is not given. That lookup is a control-plane read and therefore
happens in the renderer, not here, which is why the `project:` line reports the `--project`
flag and otherwise says where the value comes from rather than naming it.
