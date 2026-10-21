# Choose agents and models

Decide which AI harnesses a machine can run, which one handles each ticket state by default, and how a single ticket overrides that.

**You need:** bakers.build installed and signed in, at least one harness (Claude Code, Codex, Kimi, OpenCode, Pi or Grok) installed, on `PATH`, and logged in on this machine, and a project checkout. The herdr executor runs the harness through non-interactive `sh`, so a shell alias is not loaded.

1. See what the machine offers. Run this in the checkout:

   ```sh
   bakers agents
   ```

   The JSON lists each alias with its harness and model, plus `enabled_agents`, `default_agent` and `routes`. An alias is one selectable harness and model, such as `opus` or `codex`. `bakers agents` neither installs a harness nor checks its login.

2. Name your harnesses in `~/.bakers/machine.config.js`. Keep the identity and capacity fields that `bakers init` wrote and edit `addons` and the `agents` object. A complete file that uses Codex for coding and Claude Opus for review:

   ```js
   // @bakers-schema-version 3
   export default {
     schema_version: 3,
     machine_id: 'alex-laptop',
     user_id: 'alex',
     max_parallel: 1,
     addons: ['@bakers-build/addon-codex', '@bakers-build/addon-claude'],
     agents: {
       enabled: ['codex', 'opus'],
       default_agent: 'codex',
       routes: {
         default: { coding: 'codex', review: 'opus', '*': 'codex' },
         careful: { '*': 'opus' },
       },
     },
   };
   ```

   `addons` supplies candidates (agent harnesses may be listed only in this file), `enabled` limits them, `default_agent` is the last fallback. A route maps workflow states to aliases, and `'*'` covers every state not named. The `default` route applies to every ticket without a label.

3. Override one ticket with a label, through the ticket's normal label editing:

   | Label | Effect with the file above |
   |---|---|
   | `agent:careful` | Route `careful`: Opus in every state |
   | `agent:opus` | Alias `opus` in every state |
   | `agent:opus@coding` | Alias `opus`, only while the ticket is in `coding` |

   A direct alias beats a route, whatever the label order. The route must exist on the machine that actually runs the ticket. The full precedence list is in [Machines](/advanced/machines#which-agent-runs-a-state).

4. Verify, then run one small ticket:

   ```sh
   bakers config check --scope machine
   bakers agents
   ```

   Inspect the run's recorded harness and model for the state. If coding and review use different agents, check both.

**Done when:** `bakers agents` shows your aliases, `default_agent` and routes, and a small ticket ran with the harness you chose for its state.

::: tip Ask your AI
"Show my installed harnesses with `bakers agents`, then propose the smallest `agents` change for Codex on coding and Opus on review."
:::

## When loading fails

The conductor and `bakers agents` fail with one of these messages; `bakers config check` does not inspect `agents`.

| Message | Cause and fix |
|---|---|
| `machine.config.js addons[] must resolve a non-empty catalog of aliased agents` | No harness addon. Add one to `addons` of `machine.config.js`. |
| `machine agents.addons is retired: …` | An older machine file. Run `bakers config upgrade --scope machine`, which moves the entries into `addons`. |
| `effective agent catalog is empty after agents filters` | `enabled` or `disabled` removed every alias. |
| `agents.default_agent names unavailable alias '<alias>'` | `default_agent` is not among the enabled aliases. |
| `agents.enabled names unknown alias '<alias>'` | Typo, or the addon that publishes it is missing. |

A label that names an unknown alias or route only logs a warning and falls back, so check the observed agent instead of trusting the label. Pins, options such as `model` and `effort`, catalog overlays and every field are in [Machines](/advanced/machines#the-agents-object). Measuring Claude runs and applying state-group settings is [Claude profiles](/advanced/configuration/claude-profiles).
