# DDEV discovery

**Finds a worktree's DDEV services and names them, so Ports can share them.**

It is a support library. You do not enable it on its own; [Ports](/addons/ports) uses it.

## Enable it

Nothing to enable — used by [Ports](/addons/ports).

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

More: [Set up DDEV](/advanced/cli/ddev).

Source: [`bakers-cli/addons/ddev`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/ddev)
