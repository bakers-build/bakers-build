# Configure and select agents

Configuration defines the agents available on a machine. Selection chooses which of them runs a ticket: either one agent from the catalog or a route that selects agents by workflow state.

- [Configure agents](#configure-agents): one machine file, explained field by field.
- [Select an agent](#select-an-agent): use the configured default, an alias label or a route label.

<span id="choose-agents-and-models"></span>
<span id="understand-the-choices"></span>

In bakers.build, **harnesses are addons**. A harness addon supplies **agent plugins** that run a coding program such as Claude Code or Codex. Configure a plugin's model and options, then give that configuration an **alias**. The **catalog** is the set of available aliased configurations; a **route** selects from that catalog.

<span id="manual-configuration-and-what-it-controls"></span>

## Configure agents

Agents are configured per machine, in `~/.bakers/machine.config.js` on every machine that runs tickets. This file sets up two agents: an alias `coder` for working and the built-in `opus` for review, combined in a route named `reviewed`:

```js
// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', // Keep your existing ID.
  label: 'alex-laptop',
  addons: ['@bakers-build/addon-claude'],
  agents: {
    catalog: [
      {
        harness: '@bakers-build/addon-claude',
        alias: 'coder',
        with: { model: 'sonnet' },
      },
    ],
    routes: {
      default: { '*': 'coder' },
      reviewed: {
        review: 'opus',
        '*': 'coder',
      },
    },
  },
};
```

| Field | What it does |
|---|---|
| `addons` | Enables the harness addon. The addon also brings built-in aliases, such as `opus` for Claude. |
| `catalog[].harness` | The addon whose agent runs this entry. |
| `catalog[].with` | Options for that agent, here the model. |
| `catalog[].alias` | The name of this configuration. It joins the built-in aliases; reusing a name replaces that alias. Together they form the **catalog**. |
| `routes.default` | Applies when a ticket has no `agent:` label. `'*'` means every state. Without it, the first enabled alias runs. |
| `routes.<name>` | Optional **route**: workflow state → alias, `'*'` for all other states. Runs only when a ticket carries `agent:<name>`. Use a name that is not an alias. |

<span id="use-one-agent"></span>
<span id="use-agent-routes"></span>
<span id="enable-the-harness-addon"></span>
<span id="configure-a-plugin-and-give-it-an-alias"></span>
<span id="add-a-route"></span>

For a single agent, omit `reviewed`. Routes only choose agents; they neither pick a conductor nor move the ticket through its [workflow](/skills-and-workflows/states).

**Before you start:** the harness program must be installed, on `PATH` and signed in as the conductor user ([harnesses](/agents/reference#harnesses)); enabling the addon does neither. Merge `addons` and `agents` into your existing file: keep the `machine_id` from `bakers init`, your label and other settings, and do not add a second `agents` key. Keep the file private and out of Git. Use the same catalog and routes on every machine that may run the ticket.

### Inspect the catalog

In the connected project checkout, run:

```sh
bakers agents
```

Check that `coder` uses the Claude harness with model `sonnet`. Also check `opus` and `routes.reviewed`. If you use allow/deny filters, they must retain those aliases. This command neither installs a harness nor checks its login; `bakers config check --scope machine` does not validate the agent catalog.

<span id="select-a-route-or-an-alias"></span>

## Select an agent

Selection uses what you configured; it does not change a plugin's model or options.

<span id="set-the-machine-default"></span>
<span id="select-an-alias-on-a-ticket"></span>

| What you want | Ticket selection | Result with the examples above |
|---|---|---|
| Use the machine default | No `agent:` label | The `default` route applies: `coder`. |
| Use one catalog entry | `agent:coder` or `agent:opus` | That alias runs in every state. |
| Use the configured route | `agent:reviewed` | `coder` in working, `opus` in review, `coder` otherwise. |

Add the chosen label through the ticket's normal label editing. Use either an alias or a route label: a direct alias takes precedence if both are present. A state-specific label such as `agent:opus@review` applies only in that state.

These results assume the shown files and no other selectors. On an existing machine, a `default` route that maps states other than `'*'`, custom selectors and state-specific labels can also change the result. See [Configuration's selection reference](/configuration/machine#which-agent-runs-a-state) for the complete order.

### Verify the run

Run a small ticket and inspect the recorded agent and model. With `agent:coder`, expect Claude/Sonnet. With `agent:reviewed`, check both working and review. Unknown or unavailable labels can warn and fall back, so a label alone is not proof.

**Done when:** the catalog contains your intended configurations and the runs record the agent and model selected for each checked state.

## When loading fails

If `bakers agents` fails, check the named addon, alias or filter in its error. At least one agent must remain available, and the `default` route's `'*'` alias must name one. [Machine verification](/configuration/machine#verify) and the [agent reference](/agents/reference#old-keys-and-verification) explain the checks and retired keys.

## Required and optional values

A harness addon and an available agent are required. Custom aliases, filters and routes are optional. [Configuration → Machine](/configuration/machine) owns file location, identity and other machine settings; [Agent policy](/agents/reference) lists every agent field and precedence rule.

[Skills](/skills-and-workflows/skills) supply instructions, the [executor](/addons/slots) hosts the session, the [client](/get-started/use-your-client) is how you interact with the work, and the [worktree environment](/provision/guide) runs the application. Review [execution security](/provision/security/execution) before extending access.

## AI first

```text
Use `bakers:bb-init` to help me choose one agent from the catalog or a route
for different states.
Show how the chosen setup fits my complete machine.config.js, preserving
my identity and settings. Verify the catalog and the actual ticket runs.
```
