# Codex

**Lets bakers.build run tickets with the OpenAI Codex CLI.**

For anyone whose machine should run tickets with Codex.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-codex'],
```

Without a `model` it publishes `codex` (your locally configured Codex model) plus four named variants: `astra`, `sol`, `terra` and `luna`. With a `model` it publishes only `codex`.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | Codex's own default | Passed as `--model`. Drops the four named variants. |
| `effort` | string | none | Passed as `-c model_reasoning_effort=…`. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Check it works

The agent catalog lists `codex` with harness `codex`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- Codex runs with `--sandbox danger-full-access`, `--dangerously-bypass-approvals-and-sandbox` and `--dangerously-bypass-hook-trust`. These flags and `-s` are reserved; putting them in `args` fails loading.
- The addon starts `codex`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/codex`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/codex)
