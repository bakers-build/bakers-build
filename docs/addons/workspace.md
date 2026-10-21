# Ambient workspace

**Fills in and filters by your configured workspace, so you do not have to name it.**

It is a support library. You do not enable it in a config; `bakers ui` attaches it with the connection's `workspace_id`.

## Enable it

Nothing to enable — used by `bakers ui`. Set `workspace_id` in your [connection](/advanced/connections).

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `workspace_id` | string | the connection's `workspace_id` | Workspace UUID filled into new records and used to narrow lists. |
| `entity_types` | string[] | `bb_group`, `bb_team`, `bb_term` | Record types whose workspace is filled in. |

## Check it works

In `bakers ui`, lists show only records of your configured workspace.

## Good to know

- Projects and tickets are never filled in: which group or project they belong to is your choice.

Source: [`bakers-cli/addons/workspace`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/workspace)
