# Pi

**Lets bakers.build run tickets with the pi coding CLI.**

For anyone whose machine should run tickets with pi.

## AI first

Ask your AI to check this harness and its [bakers skills](/skills-and-workflows/skills).

## Setup

Follow the [vendor installation guide](https://pi.dev/docs/latest/quickstart), then authenticate `pi` as the conductor user and check it resolves on `PATH`.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-pi'],
```

It publishes one alias, `pi`, which uses your locally configured pi model.

## Options

<!-- @options @bakers-build/addon-pi -->

Without `env_deny`, the [default list](/provision/security/execution#ticket-env-vars) of ticket env vars is kept from the run.

## Security

[Isolation models](/agents/isolation): platform support.

pi has no OS sandbox and no tool-permission gate: its tools run with the conductor user's own permissions. bakers.build therefore offers no `sandbox` or `yolo` for pi; both fail loading before pi starts.

| `permissions` | Launch flags |
|---|---|
| `system` (default) | none |
| `custom` | `--no-extensions`, then `-e '<extension>'` for each entry of `config.extensions` |
| `sandbox`, `yolo` | fails loading |

`custom` takes `config: { extensions: ['<path or builtin:name>', ...] }`, at least one entry and no other key. Only these extensions load, for example one that sandboxes pi's tools; whether they protect anything is up to the extension, not bakers.build.

```js
{ use: '@bakers-build/addon-pi', with: { permissions: 'custom', config: { extensions: ['./pi-sandbox.ts'] } } }
```

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
- Listed in a project config, an agent addon is ignored with a warning.
- Runs reach the conductor's [addon tools](build/tools.md) through `bakers tools`, not through MCP.

More: [Choose agents and models](/agents/guide), [Machines](/agents/reference#harnesses).

