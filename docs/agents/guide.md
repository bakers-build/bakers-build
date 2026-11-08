# Choose agents and models

Use this guide to choose the agents available on your execution machine and route a ticket's states to them. You will inspect the catalog, add a route, select it on a ticket and verify the actual run.

## Understand the choices

| Concept | What it means |
|---|---|
| Agent program, or **harness** | Runs the coding session and its tools, such as Claude Code or Codex. |
| **Model** | The model used by that program. Its addon defines the available choices and options. |
| Agent **alias** | A selectable name for a configuration: its harness and optionally a model or other options. For example, `opus` can name a Claude Code configuration. |
| Agent **catalog** | The configurations available on the execution machine, shown by `bakers agents`. |
| **Route** | A named mapping from workflow states to existing aliases. For example, use `codex` for working and `opus` for review. |

At the start of each run, the conductor resolves an agent for the ticket's current state. A route selects an existing agent; it does not create one, choose a conductor or move the ticket through its [workflow](/skills-and-workflows/states).

The agent's [skills](/skills-and-workflows/skills) supply instructions. The [executor](/addons/slots) hosts the session, the [client](/get-started/use-your-client) is how you interact with the work, and the [worktree environment](/provision/guide) runs the application.

## AI first

```text
Check my installed agent harnesses and bakers skills. Explain my current
agent catalog, then help me add and select a route for the agents I
choose. Keep working settings and verify the actual ticket runs.
```

## Manual configuration and what it controls

**You need:** bakers.build installed and signed in, a connected project checkout, and the chosen harnesses installed, on `PATH` and logged in on the machine whose conductor will run the ticket. The herdr executor runs the harness through non-interactive `sh`, so a shell alias is not loaded. Follow the [agent addon instructions](/agents/reference#harnesses) for vendor-specific installation, authentication and options.

### Inspect the catalog

Run this in the connected checkout:

```sh
bakers agents
```

The JSON lists aliases with their harnesses and models, plus the resolved filters, default and routes. It neither installs a harness nor checks its login. The example below assumes the available aliases include `codex` and `opus`; use names from your own catalog.

### Add a route

On that execution machine, add this fragment inside `agents.routes` in `~/.bakers/machine.config.js`. Create those objects if absent; keep the other settings, existing routes and machine identity.

```js
// Fragment inside agents.routes, not a complete machine file.
reviewed: {
  working: 'codex',
  review: 'opus',
  '*': 'codex',
},
```

`reviewed` is the route name. Its keys are workflow states, its values are agent aliases, and `'*'` covers states without their own entry. Choose a route name that is not also an alias. See the [complete mixed-harness file](/agents/reference#mixed-harnesses) for the surrounding configuration and the special `default` route, which supplies machine-wide choices without a ticket label.

### Select a route or an alias

Add `agent:reviewed` through the ticket's normal label editing. With the example above, the conductor chooses Codex in `working`, Opus in `review` and Codex otherwise.

To choose one agent throughout instead, use an alias label such as `agent:opus`. A direct alias label such as `agent:codex` overrides a route even if both are present. State-specific labels, defaults and custom selectors follow the [full precedence rules](/agents/reference#which-agent-runs-a-state).

The route must exist on every execution machine that may run the ticket. Editing a different machine's private file does not configure the selected conductor.

### Verify the run

Run `bakers agents` again and confirm that `routes.reviewed` contains your mapping and its target aliases are available. `bakers config check --scope machine` does not validate the agent catalog.

Use a small ticket to check the relevant states, then inspect the agent and model recorded by each run. For this example, check both working and review. Unknown labels or unavailable route targets can warn and fall back, so the label alone is not proof.

**Done when:** the resolved catalog contains your route and the ticket's runs record the agent and model you expected for each checked state.

## When loading fails

The conductor and `bakers agents` fail with one of these messages; `bakers config check` does not inspect `agents`.

| Message | Cause and fix |
|---|---|
| `machine.config.js addons[] must resolve a non-empty catalog of aliased agents` | No harness addon. Add one to `addons` of `machine.config.js`. |
| `machine agents.addons is retired: …` | An older machine file. Run `bakers init` to write a current one. |
| `effective agent catalog is empty after agents filters` | `enabled` or `disabled` removed every alias. |
| `agents.default_agent names unavailable alias '<alias>'` | `default_agent` is not among the enabled aliases. |
| `agents.enabled names unknown alias '<alias>'` | Typo, or the addon that publishes it is missing. |

Pins, options such as `model` and `effort`, catalog overlays and every field are in [Agent policy](/agents/reference#the-agents-object).

## Required and optional values

Keep harness addons in the private machine file. At least one installed/authenticated harness is required. Catalog overlays, allow/deny lists, fallback and routes are optional; [Agent policy](/agents/reference) defines their defaults. [Execution security](/provision/security/execution) owns sandbox modes and readiness. Vendor options and installation belong to [agent addons](/addons/).
