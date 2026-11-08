# Deployment tickets

**Lists the tickets a Git range delivers, so a deployment can record its release batch.**

For release pipelines and the people who run them.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers deployment tickets`.

## Options

No addon settings. The command takes `--since <ref>` and `--to <ref>`; see [bakers deployment](/addons/deployment/reference).

## Check it works

With a signed-in connection, inside the project checkout, the command prints one line of JSON with `range`, `resolved` and `unresolved`.

::: details Per CLI
```sh
bakers deployment tickets --since v1.4.0 --to HEAD
```
:::

## Good to know

- An identifier that does not resolve is listed under `unresolved`; it never fails the command.
- The command only reads. It writes nothing to the server.

Package source in a checkout: `bakers-cli/addons/deployment`.

Full command semantics and examples: [command reference](/addons/deployment/reference).
