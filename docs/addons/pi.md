# Pi

**Lets bakers.build run tickets with the pi coding CLI.**

For anyone whose machine should run tickets with pi.

## AI first

Ask your AI to check this harness and its [bakers skills](/configuration/agents/skills).

## Setup

Follow the [vendor installation guide](https://pi.dev/docs/latest/quickstart), then authenticate `pi` as the conductor user and check it resolves on `PATH`.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-pi'],
```

It publishes one alias, `pi`, which uses your locally configured pi model.

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | pi's own default | Passed as `--model`. |
| `provider` | string | none | Passed as `--provider`. |
| `thinking` | string | none | Passed as `--thinking`. |
| `effort` | string | none | Same as `thinking`, and wins over it. |
| `approve` | boolean | `false` | Passes `--approve`: trusts the worktree's project-local pi files. Grants no bakers.build access. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Check it works

The agent catalog lists `pi` with harness `pi`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- pi has no tool-permission gate, so leave `approve` off unless a run needs project-local pi files.
- `--session-dir`, `--approve`, `-a`, `--no-approve` and `-na` are reserved; putting them in `args` fails loading.
- The addon starts `pi`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/configuration/agents), [Machines](/configuration/agents/reference#harnesses).

