# DDEV discovery

**Finds a worktree's DDEV services and names them, so Ports can share them.**

[Ports](/addons/ports) uses it to claim services. Listed in a conductor's `addons`, it also gives agents tools for their worktree's DDEV project.

## Enable it

For discovery, nothing to enable — used by [Ports](/addons/ports). For the agent tools, add it to the machine or project `addons`:

```js
addons: ['@bakers-build/addon-ddev'],
```

## Agent tools

Every claude and codex run gets these tools on its own worktree, the DDEV approot:

| Tool | Does |
|---|---|
| `ddev_status()` | `ddev describe` as a summary: name, status, primary URL, services. |
| `ddev_start()` | `ddev start`, up to 10 minutes. |
| `ddev_exec(command)` | Runs `command` in the web container, up to 5 minutes. |

Answers carry the exit code and the last 64 KB of output; a non-zero exit is a tool error.

## Options

No options.

## Check it works

In a worktree with a running DDEV project, the ports list shows `web` and services such as `mailpit`.

::: details Per CLI
```sh
bakers ports list
```
:::

## Good to know

- The web container claims itself as `web`. Each configured and observed host alias adds a `web-<host>` key.
- Other services are named from DDEV daemon, service and Compose names.
- It has no CMS-specific rules. A project that needs a particular `Host` header handles that itself.
- Linux only. It does not need root.

More: [Set up DDEV](/configuration/provisioning/ddev).

Package source in a checkout: `bakers-cli/addons/ddev`.
