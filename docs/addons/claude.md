# Claude

**Lets bakers.build run tickets with the Claude Code CLI.**

For anyone whose machine should run tickets with Claude.

## Enable it

Add the package to `addons` in `~/.bakers/machine.config.js`; agent harnesses may be listed only there. Keep the other fields there.

```js
addons: ['@bakers-build/addon-claude'],
```

Without a `model` it publishes two aliases: `opus` for demanding work and `sonnet` for well-specified changes. Set `model` to publish one custom candidate instead:

```js
{ use: '@bakers-build/addon-claude', with: { model: 'opus', effort: 'high' } }
```

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `model` | string | none | Passed as `--model`. Replaces `opus` and `sonnet` with one custom candidate. |
| `effort` | string | none | Passed as `--effort`. |
| `skip_permissions` | boolean | `true` | Adds `--dangerously-skip-permissions`. `false` only omits that flag. |
| `measure` | boolean | `false` | Starts Claude through the addon's measure wrapper. |
| `args` | string[] | `[]` | Extra arguments, each shell-quoted. |

## Check it works

The agent catalog lists `opus` and `sonnet` (or your custom alias) with harness `claude`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- The addon starts `claude`; it does not install it or sign it in. The binary must be on `PATH` for a non-interactive shell; an alias is not loaded.
- bakers.build owns `--session-id`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions` and `--permission-mode`. Putting them in `args` fails loading.
- `skip_permissions: false` does not override Claude settings that select bypass mode.
- Listed in a conductor config, an agent addon is ignored with a warning.

More: [Choose agents and models](/advanced/configuration/agents-and-models), [Machines](/advanced/machines#harnesses).

Source: [`bakers-cli/addons/claude`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/claude)
