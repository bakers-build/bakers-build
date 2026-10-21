# Kimi

**Lets bakers.build run tickets with the Kimi Code CLI.**

For anyone whose machine should run tickets with Kimi.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-kimi'],
```

It publishes one alias, `kimi`, which uses your locally configured Kimi model.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | Kimi's own default | Passed as `--model`. |
| `effort` | string | none | Not supported; ignored with a log line. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Check it works

The agent catalog lists `kimi` with harness `kimi`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- `-p`, `--prompt` and `--output-format` are reserved; putting them in `args` fails loading.
- The addon starts `kimi`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/kimi`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/kimi)
