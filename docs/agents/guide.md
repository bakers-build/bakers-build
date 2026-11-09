# Configure and select agents

First configure the agents your execution machine offers. Then choose which one runs a ticket.

- [Configuration](#configure-agents): enable a harness addon, configure an agent plugin and give that configuration an alias.
- [Selection](#select-an-agent): choose an existing alias as the machine default or through a ticket label. Add a route only when workflow states need different agents.

<span id="choose-agents-and-models"></span>
<span id="understand-the-choices"></span>

In bakers.build, **harnesses are addons**. A harness addon supplies **agent plugins** that run a coding program such as Claude Code or Codex. Configure a plugin's model and options, then use its **alias** to refer to that agent configuration. One addon can provide several configurations with different aliases.

For example: the Claude addon supplies the agent plugin; `model: 'sonnet'` configures it; `coder` is the alias you choose for that configuration. Selecting `coder` uses those settings.

<span id="manual-configuration-and-what-it-controls"></span>

## Configure agents

Configuration belongs in `~/.bakers/machine.config.js` on the execution machine. Keep its identity and other settings. You need bakers.build signed in, a connected project checkout, and the harness program installed, on `PATH` and authenticated as the conductor user. Follow the [harness addon instructions](/agents/reference#harnesses) for vendor setup; enabling an addon does not install or sign in to the program.

### Enable the harness addon

Add the [Claude addon](/addons/claude) to the existing top-level `addons` list:

```js
'@bakers-build/addon-claude',
```

It supplies ready-made agent configurations, including the aliases `opus` and `sonnet`. You can select those directly, or configure your own alias next.

### Configure a plugin and give it an alias

Add this entry to `agents.catalog` in the same file. Create `agents` and its `catalog` array if absent; preserve existing entries:

```js
// One entry inside agents.catalog.
{
  harness: '@bakers-build/addon-claude',
  alias: 'coder',
  with: { model: 'sonnet' },
},
```

- `harness` names the enabled addon that supplies the agent plugin.
- `with` configures that plugin. Here it starts Claude Code with Sonnet; other options belong to the [addon reference](/addons/claude#options).
- `alias` gives this configuration the selectable name `coder`.

This adds `coder` alongside the addon's existing aliases. Reusing an existing alias replaces its configuration. The [policy reference](/agents/reference#the-agents-object) defines catalog fields and filters; its [complete machine file](/agents/reference#mixed-harnesses) shows the surrounding structure.

### Inspect the catalog

The **catalog** is the set of available agent configurations. In the connected project checkout, run:

```sh
bakers agents
```

Check that `coder` names the Claude harness with model `sonnet`. The command resolves local configuration; it neither installs a harness nor checks its login. If you use allow/deny filters, ensure they retain your alias. `bakers config check --scope machine` does not validate the agent catalog.

<span id="select-a-route-or-an-alias"></span>

## Select an agent

Selection uses aliases from the catalog. It chooses an already configured agent; it does not change that agent's model or options.

### Set the machine default

Set this field inside the existing `agents` object:

```js
// Field inside agents, alongside catalog.
default_agent: 'coder',
```

Without ticket selectors or explicit default routes, runs use `coder`. An existing `routes.default` can take precedence over `default_agent`; see the [selection rules](/agents/reference#which-agent-runs-a-state) when changing a machine that already has routes.

### Select an alias on a ticket

Add the label `agent:coder` to the ticket. This selects your `coder` configuration instead of the machine default. To use the addon's existing Opus configuration, use `agent:opus` instead.

The label's alias must be available on the machine that runs the ticket. A state-specific label such as `agent:opus@review` applies only in that state. Advanced precedence and custom selectors are in the [policy reference](/agents/reference#which-agent-runs-a-state).

### Verify the run

Run a small ticket and inspect the agent and model recorded by its run. With `agent:coder`, expect the configured Claude/Sonnet agent. Unknown or unavailable labels can warn and fall back, so the label alone is not proof.

**Done when:** the catalog shows your configuration and the run records the agent and model you selected.

### Add a route

A **route** groups selections by workflow state. For example, add this fragment inside `agents.routes` to use `coder` for working and `opus` for review:

```js
// Fragment inside agents.routes, not a complete machine file.
reviewed: {
  working: 'coder',
  review: 'opus',
  '*': 'coder',
},
```

Then use ticket label `agent:reviewed`. `reviewed` is the route name, the keys are states, the values are aliases, and `'*'` covers other states. Choose a route name that is not also an alias. A direct alias label, such as `agent:coder`, takes precedence over a route label.

The conductor resolves the selection for the current state at each run. Routes select existing agents; they neither choose a conductor nor move the ticket through its [workflow](/skills-and-workflows/states). Make the route available on every execution machine that may run the ticket, and verify both working and review. For state-based defaults without a ticket label, see the [special default route](/agents/reference#mixed-harnesses).

## When loading fails

If `bakers agents` fails, check the named addon, alias or filter in its error. At least one agent must remain available, and `default_agent` must name an available alias. The [reference](/agents/reference#old-keys-and-verification) covers retired keys and verification.

## Required and optional values

A harness addon and an available agent are required. Addons can supply usable aliases without a custom catalog entry. Custom aliases, filters and routes are optional; [Agent policy](/agents/reference) defines their defaults.

[Skills](/skills-and-workflows/skills) supply instructions, the [executor](/addons/slots) hosts the session, the [client](/get-started/use-your-client) is how you interact with the work, and the [worktree environment](/provision/guide) runs the application. Review [execution security](/provision/security/execution) before extending an agent's access.

## AI first

```text
Help me configure an agent plugin and give it an alias on this machine.
Then show me how to select it as the default or with a ticket label.
Keep existing settings and verify the catalog and the actual run.
```
