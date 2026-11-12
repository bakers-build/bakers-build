# Agent catalog

**Shows which agent aliases, defaults and routes this machine offers.**

For anyone checking their agent setup, and for agents that pick a harness.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers agents`.

## Options

No addon settings. Run inside a configured project, or pass `--config <path>` for its project config. The command loads that config together with the machine [agent policy](/agents/reference#the-agents-object).

## Check it works

The command prints JSON with each alias, its harness and model, plus `permissions`, `enabled_agents`, `disabled_agents`, `default_agent` and `routes`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- It neither installs a harness nor checks its sign-in.

More: [Choose agents and models](/agents/guide).

Package source in a checkout: `bakers-cli/addons/agents`.
