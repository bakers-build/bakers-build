# OpenCode

**Lets bakers.build run tickets with the OpenCode CLI.**

For anyone whose machine should run tickets with OpenCode.

## AI first

Ask your AI to check this harness and its [bakers skills](/configuration/agents/skills).

## Setup

Follow the [vendor installation guide](https://opencode.ai/docs/), then authenticate `opencode` as the conductor user and check it resolves on `PATH`.

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
| `security` | `'system'` \| `'yolo'` | `'system'` | How strictly a run starts; see [Security](#security). `'sandbox'` and `'custom'` fail loading. |
| `env_deny` | string[] | the [default list](/configuration/agents/execution-security#ticket-env-vars) | Ticket env var names (`*` globs) kept from the run. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Security

OpenCode has no OS sandbox, and its permission policies do not sandbox plugin code, so bakers.build cannot protect an OpenCode run. Its default is therefore `system`, not `sandbox` as for Claude, Codex and Grok:

| `security` | Launch flags |
|---|---|
| `system` (default) | none; your own OpenCode configuration decides |
| `yolo` | `--auto` (permission auto-approval) |
| `sandbox` | fails loading: `OpenCode has no OS sandbox, so security: 'sandbox' cannot be enforced; leave security unset or set 'system' (your own OpenCode configuration) or 'yolo'` |
| `custom` | fails loading: `OpenCode has no config hand-off for security: 'custom'; use security: 'system' with your own OpenCode configuration` |

A `sandbox` block therefore always fails loading too. `bakers oven check` reports OpenCode as `sandbox ok`, as for every agent outside `sandbox` mode, which it does not check.

What `system` and `yolo` expose: [Run security › Risk of loosening](/configuration/agents/execution-security#risk-of-loosening).

## Check it works

The agent catalog lists `opencode` with harness `opencode`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- Only `yolo` runs with `--auto`; the default `system` does not. `--prompt` and `--auto` are reserved in every mode; putting them in `args` fails loading.
- The addon starts `opencode`; it does not install it or sign it in. The binary must be on `PATH`.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/configuration/agents), [Machines](/configuration/agents/reference#harnesses).

