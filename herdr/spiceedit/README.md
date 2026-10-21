# spiceedit herdr plugin

The bakers.build **review** run-session's click-to-edit surface (BB-58).

In `review` the agent runs in the herdr root pane; the diff surface is **hunk**
(BB-55) — an opt-in, agent-driven viewer the review engine launches in the
*human's* interactive pane, **not** an executor-forced pane. There is deliberately
no reference document to link here: hunk is an open dependency on BB-55, and the
file this once pointed at (`.claude/skills/bakers-build/reference/hunk-review-surface.md`)
was never written. When the human activates a changed file in that hunk pane, a **spiceedit
overlay** opens editable on that file — a floating pane over the review layout, not
replacing hunk or the agent.

## Why a plugin

herdr opens an overlay **only** via `herdr plugin pane open --plugin … --entrypoint …
--placement overlay` — there is no generic "run an arbitrary command in an overlay"
(verified on herdr 0.7.1). So [spiceedit](https://github.com/) (a single static Go TUI,
`spiceedit <path>`) is wrapped as this plugin with an `edit` overlay entrypoint.

## Contents

| File | Role |
|------|------|
| `herdr-plugin.toml` | manifest: the `edit` overlay pane + the `open-overlay` action |
| `scripts/edit.sh` | overlay entrypoint — execs `spiceedit "$SPICEEDIT_FILE"`, guarded |
| `scripts/open-overlay.sh` | keybinding-fallback action — opens the overlay for `$SPICEEDIT_FILE` |

## Opening the overlay

```sh
herdr plugin pane open --plugin spiceedit --entrypoint edit --placement overlay \
  --env SPICEEDIT_FILE="<path>" --focus
```

The invoker passes the file path via `--env SPICEEDIT_FILE=<path>`. The intended
trigger is hunk's file-activate hook firing `open-overlay` with the selected file;
that hook is an **open dependency on BB-55** — until it lands, bind `open-overlay`
to a herdr key as the fallback (see `bakers-cli/README.md` § *herdr run-session
layouts (BB-58)* — BB-224 renamed the monorepo root, so the old
`conductor/README.md` path no longer resolves).

## Install

Host-global, once per herdr host, from the conductor bootstrap
(`bakers-cli/scripts/setup.sh`):

```sh
herdr plugin link <repo>/herdr/spiceedit   # register this repo-local plugin
# + install the spiceedit binary (Go 1.22+)
```

## Graceful degradation

An absent `spiceedit`, or an unset `SPICEEDIT_FILE`, prints a message and closes
cleanly — a review run never wedges on a missing tool. Requires **herdr 0.7+**;
spiceedit needs **Go 1.22+**.
