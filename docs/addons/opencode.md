# OpenCode

**Lets bakers.build run tickets with the OpenCode CLI.**

For anyone whose machine should run tickets with OpenCode.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-opencode'],
```

It publishes one alias, `opencode`, which uses your locally configured OpenCode model.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | OpenCode's own default | Passed as `--model`. |
| `effort` | string | none | Not supported; ignored with a log line. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Check it works

The agent catalog lists `opencode` with harness `opencode`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- OpenCode runs with `--auto`. `--prompt` and `--auto` are reserved; putting them in `args` fails loading.
- The addon starts `opencode`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/opencode`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/opencode)
