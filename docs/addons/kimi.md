# Kimi

**Lets bakers.build run tickets with the Kimi Code CLI.**

For anyone whose machine should run tickets with Kimi.

## AI first

Ask your AI to check this harness and its [bakers skills](/configuration/agents/skills).

## Setup

Follow the [vendor installation guide](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started), then authenticate `kimi` as the conductor user and check it resolves on `PATH`.

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
- Runs reach the conductor's [addon tools](build/tools.md) through `bakers oven tools`, not through MCP.

More: [Choose agents and models](/configuration/agents), [Machines](/configuration/agents/reference#harnesses).

