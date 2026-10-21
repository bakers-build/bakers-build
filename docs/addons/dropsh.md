# dropsh shell

**A JSON:API shell for the bakers.build server, bound to your connection.**

For agents and skills that read and write bakers.build records from the terminal.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers dropsh` and uses your [connection](/advanced/connections).

## Options

No options.

## Check it works

A read through the shell returns JSON from your server.

::: details Per CLI
```sh
bakers dropsh --help
```
:::

## Good to know

- Reads through `bakers dropsh` never show unpublished comments, such as submitted reviews that are not yet published. A direct read of one fails as not found.

More: [bakers dropsh](/advanced/cli/dropsh).

Source: [`bakers-cli/addons/dropsh`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/dropsh)
