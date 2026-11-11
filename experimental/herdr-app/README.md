# bakers in Herdr Desktop

A proof of concept: a project's tickets and one ticket at a time inside the [Herdr Desktop app](https://herdr.dev) (`herdr-app`), next to the terminals where the agents run. Like the [PM bot](../pm-bot/README.md), this experimental integration has no dedicated Bakers addon. It works with bakers.build as it is today and shows what bakers.build would have to add.

The PoC is one Herdr mod, `bakers`, a layout of its own and a copy of Herdr's tab bar with **Ticket** and **Tickets** next to Files and Changes. The mod has four views:

- **Tickets** (`view: "board"`): a board in its own tab. "Needs you" comes first: frozen tickets labelled **Question** or **technical problem**, the label protocol the PM bot uses. Then one column per open workflow state (qualification, plan, working, review, then any other open state). Each card shows the ticket's identifier, title, a reason (the label, "Frozen", or the newest activity message such as `working → review`) and its age, and in the same place on every card the agent of its active run (for example `Claude Code · working`, `needs you` or `idle`, in Claude Code's own colors for the theme's brightness) or `No active run`. The status is Herdr's live one when Herdr shows the run's terminal, else the run's state from bakers; no tool lists a project's runs, so each refresh asks every open ticket for its own. A filter box, the project's conductors with their status, and a refresh every 60 s.
- **Ticket** (`view: "ticket"`): Herdr's right panel, beside Files and Changes, with the ticket last opened; **Ticket** in the tab bar shows or hides it. Title, state, type, recipe, branch, the agent working on it (its status, machine and since when, and **Show agent** when Herdr shows its terminal), what needs a person (the question, or the newest comment), tabs Summary, Plan, Runs and Activity, and its links. **Cancel run** (while a run is claimed or running) and **Freeze**/**Unfreeze** open the confirm view.
- **Confirm** (`view: "confirm"`): a dialog that says what the action does, takes an optional reason for a cancel, and runs it. **Keep running** is the default; Esc keeps too.

- **Rail** (`view: "rail"`): the narrow left rail of the `bakers` layout. Herdr's logo, **Spaces** (shows or hides Herdr's own sidebar, which keeps its updates), and **bakers**, with a dot while a ticket of the chosen project needs you; a click shows the board tab.

Clicking a card shows the ticket in the right panel. When its run is a terminal on this machine, that terminal's tab comes to the front, so the ticket sits beside the run. **Tickets** in the tab bar shows the board, with the number of tickets that need you.

The `bakers` layout is made at install time from the installed Herdr's own `main` layout, or from the layout `--from` names (your own clone of `main`, for example): the rail first, Herdr's sidebar hidden, the ticket added to the right panel, its tab bar swapped for `bakers-tabs`, everything else as it was. `bakers-tabs` is that layout's tab bar (Herdr's `tabs`, or your clone of it with its own buttons) with Ticket and Tickets added. On macOS the rail is 76 px wide, like Herdr's own rail, so the window buttons sit over it; elsewhere it is 52 px. `ctrl-shift-l` cycles back to any other layout.

| File | What it is |
|---|---|
| `install.js` | The installer (`--dry-run` shows what it would do) |
| `lib/install.js` | Makes the `bakers` layout and the `bakers-tabs` tab bar; adds the key to `keys.json` only when it is free |
| `mods/bakers/main.js` | The mod: picks the view from `props().view`; opened by `mod.open:bakers` it shows the board tab and closes its overlay |
| `mods/bakers/board.js`, `ticket.js`, `rail.js`, `confirm.js` | The four views |
| `mods/bakers/ui.js` | The pieces they share: the bakers mark, buttons, pills |
| `mods/bakers/open.js` | Shows the board tab; shows a ticket in the right panel beside its run; opens links (https only) |
| `mods/bakers/derive.js` | Pure logic: columns, reasons, ages, the attention line, where a run is, how a ticket opens, what each confirmation says and does, error lines |
| `mods/bakers/bakers.js` | bakers.build through the `bakers` CLI (`bakers tools tool_api__bakers_<name> --data <json>`) with your own auth profile |
| `test/` | `node:test` tests for the pure logic, the client and the installer's layout and key |

The mod reads tickets, runs, activity and conductors and writes only the two actions (`run_cancel`, `ticket_update` with `frozen`). It keeps no token and puts no ticket content in Herdr's shared state: `bakers.project` holds the chosen project's UUID, `bakers.ticket` the identifier of the ticket in the right panel, `bakers.needs` how many tickets need you, `bakers.changed` a timestamp that tells the views to reload.

## Install

Open the Herdr app once, then from this repository:

```sh
node experimental/herdr-app/install.js --dry-run   # what it would do
node experimental/herdr-app/install.js
node experimental/herdr-app/install.js --from my-layout   # start from your own layout instead of Herdr's main
```

The installer copies the mod to `~/.config/herdr-app/mods/bakers/` (`HERDR_APP_HOME` picks another home), writes `mods/bakers-tabs/` and `layouts/bakers.json` from Herdr's `main` (or `--from`), binds `cmd-shift-b` to `mod.open:bakers` in `keys.json` when that key is free, checks both mods with `herdr-app check` and switches the open window to the `bakers` layout. A file it replaces is kept beside it as `<name>.bak-<time>`. Run it again after a change here or after a Herdr update; Herdr reloads the mod and the layout.

`cmd-shift-b`, **Tickets** or the rail's bakers button shows the board. The first time, pick the project; the choice is remembered. A board for one project can also be opened from a terminal:

```sh
herdr-app do tab.new '{"name":"Tickets","mod":"bakers","props":{"view":"board","project":"<project key or UUID>"}}'
```

`bakers` must be on the `PATH` of your login shell and logged in (`bakers tools tool_api__bakers_project_list` answers).

## Runs beside the ticket

A ticket opens beside its run only when the run is a herdr-core terminal on this machine: the conductor uses the [herdr-core executor](https://bakers.build/addons/herdr-core) with `hc` 0.1.18 or later, for example in `~/.bakers/machine.config.js`:

```js
executor: { plugin: '@bakers-build/addon-herdr-core' },
```

Such a run is a terminal labelled `bakers.ticket=<identifier>` and `bakers.run=<number>`, without a tab. Opening its ticket moves the run's terminal into a tab of its own (`terminal.keep`) and shows the ticket in the right panel beside it. That is for good: **closing that terminal's pane ends the run.** To put it away, use the pane menu's "Send back" (park), never close. The next open selects that tab again.

The board and the ticket panel work with any executor. With another executor the ticket's Agent section takes the run's state from bakers and says that its terminal runs outside Herdr.

## What bakers.build would have to add

The first draft's board had more; today's tools do not carry it, so the PoC leaves it out:

- **Needs you without a run**, such as a plan that waits for approval: no field says so.
- **Mine / Team**: no tool returns a ticket's assignee.
- **Queued** and **Done today**: no queue position, no closing date.
- **Run number** (`#412`) for runs that are not a terminal here: `ticket_runs_list` has only the run's UUID.
- **Slots, load and last heartbeat** of a conductor: not in `conductor_list`.
- **The ticket's web URL**: no tool returns it, so the PoC has no "Open on web".
- **Live agent status** (working, blocked) for every run: Herdr reports it only when the agent's status hook runs, and the Claude agent's hook does not run inside bakers runs that use sandbox permissions. Without it, cards and the Agent section fall back to the run's state (`working` while it runs).

## Tests

```sh
node --test 'experimental/herdr-app/test/*.test.js'
```

The views themselves are checked with `herdr-app check` and by hand in the app.

## Later

The same mod can take more fixed places in the `bakers` layout, for example a runs or machines view in the right-hand panel beside Herdr's Files and Changes. Herdr's own updates to its tab bar reach `bakers-tabs` when the installer runs again.
