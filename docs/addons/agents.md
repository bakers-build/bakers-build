# Agent catalog

**Shows which agent aliases, defaults and routes this machine offers.**

For anyone checking their agent setup, and for agents that pick a harness.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers agents`.

## Command

Run inside a configured project, or pass `--config <path>` for its project config. The command loads that config together with the machine [agent policy](/agents/agent-policy-reference#the-agents-object).

## Check it works

The command prints JSON with each alias, its harness and model, plus `permissions`, `secret_env` (each variable the harness declares for the [secrets file](/configuration/machine#secrets-file), `set` or `unset`, never its value), `enabled_agents`, `disabled_agents`, `default_agent` and `routes`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- It neither installs a harness nor checks its sign-in.

More: [Choose agents and models](/agents/configure-and-select-agents).

Package source in a checkout: `bakers-cli/addons/agents`.
