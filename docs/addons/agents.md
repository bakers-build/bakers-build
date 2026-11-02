# Agent catalog

**Shows which agent aliases, defaults and routes this machine offers.**

For anyone checking their agent setup, and for agents that pick a harness.

## Enable it

Nothing to enable. The command ships with the bakers.build CLI as `bakers agents`.

## Options

No options. The command reads the `agents` object of your [machine file](/configuration/agents/reference#the-agents-object).

## Check it works

The command prints JSON with each alias, its harness and model, plus `enabled_agents`, `default_agent` and `routes`.

::: details Per CLI
```sh
bakers agents
```
:::

## Good to know

- It neither installs a harness nor checks its sign-in.

More: [Choose agents and models](/configuration/agents).

Package source in a checkout: `bakers-cli/addons/agents`.
