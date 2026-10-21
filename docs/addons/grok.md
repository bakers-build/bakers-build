# Grok

**Lets bakers.build run tickets with xAI Grok Build.**

For anyone whose machine should run tickets with the Grok CLI.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: [{ use: '@bakers-build/addon-grok', with: { model: 'grok-4.5' } }],
```

`grok-4.5` is an example pin, not a default. It publishes one alias, `grok`.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | Grok CLI default | Passed as `--model`. |
| `effort` | string | none | Passed as `--reasoning-effort`. |
| `reasoningEffort` | string | none | Older name for `effort`; `effort` wins. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. A `-m`/`--model` here wins over `model`. |

## Check it works

The agent catalog lists `grok` with harness `grok`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- Grok runs with `--permission-mode bypassPermissions`. `--permission-mode` and `--session-id` are reserved; putting them in `args` fails loading.
- The addon starts `grok`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/grok`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/grok)
