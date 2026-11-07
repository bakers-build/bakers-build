# Choose agents and models

An agent (Claude Code, Codex or another harness) does the work. Its [skills](/skills-and-workflows/skills) supply instructions. The project’s [TUI/client](/configuration/clients) hosts its sessions, and its [environment](/provision/guide) runs the application.

Decide which harnesses this machine can run and which handles each state. Start with your existing signed-in agent; add models and routing when needed.

## AI first

```text
Check my installed agent harnesses and bakers skills. Explain my current
agent catalog, then propose the smallest machine configuration change
for the agents I choose. Keep working settings and verify the result.
```

## Manual configuration and what it controls

**You need:** bakers.build installed and signed in, at least one harness (Claude Code, Codex, Kimi, OpenCode, Pi or Grok) installed, on `PATH`, and logged in on this machine, and a project checkout. The herdr executor runs the harness through non-interactive `sh`, so a shell alias is not loaded.

1. See what the machine offers. Run this in the checkout:

   ```sh
   bakers agents
   ```

   The JSON lists each alias with its harness and model, plus `enabled_agents`, `default_agent` and `routes`. An alias is one selectable harness and model, such as `opus` or `codex`. `bakers agents` neither installs a harness nor checks its login.

2. Name your harnesses in `~/.bakers/machine.config.js`. Keep the identity fields that `bakers init` wrote and edit `addons` and the `agents` object. A complete file that uses Codex for coding and Claude Opus for review:

   ```js
   // @bakers-schema-version 1
   export default {
     schema_version: 1,
     machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
     label: 'alex-laptop',
     addons: ['@bakers-build/addon-codex', '@bakers-build/addon-claude'],
     agents: {
       enabled: ['codex', 'opus'],
       default_agent: 'codex',
       routes: {
         default: { working: 'codex', review: 'opus', '*': 'codex' },
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
   | `agent:opus@working` | Alias `opus`, only while the ticket is in `working` |

   A direct alias beats a route, whatever the label order. The route must exist on the machine that actually runs the ticket. The full precedence list is in [Agent policy](/agents/reference#which-agent-runs-a-state).

4. Verify, then run one small ticket:

   ```sh
   bakers config check --scope machine
   bakers agents
   ```

   Inspect the run's recorded harness and model for the state. If coding and review use different agents, check both.

**Done when:** `bakers agents` shows your aliases, `default_agent` and routes, and a small ticket ran with the harness you chose for its state.

## When loading fails

The conductor and `bakers agents` fail with one of these messages; `bakers config check` does not inspect `agents`.

| Message | Cause and fix |
|---|---|
| `machine.config.js addons[] must resolve a non-empty catalog of aliased agents` | No harness addon. Add one to `addons` of `machine.config.js`. |
| `machine agents.addons is retired: …` | An older machine file. Run `bakers init` to write a current one. |
| `effective agent catalog is empty after agents filters` | `enabled` or `disabled` removed every alias. |
| `agents.default_agent names unavailable alias '<alias>'` | `default_agent` is not among the enabled aliases. |
| `agents.enabled names unknown alias '<alias>'` | Typo, or the addon that publishes it is missing. |

A label that names an unknown alias or route only logs a warning and falls back, so check the observed agent instead of trusting the label. Pins, options such as `model` and `effort`, catalog overlays and every field are in [Agent policy](/agents/reference#the-agents-object).

## Required and optional values

Keep harness addons in the private machine file. At least one installed/authenticated harness is required. Catalog overlays, allow/deny lists, fallback and routes are optional; [Agent policy](/agents/reference) defines their defaults. [Execution security](/provision/security/execution) owns sandbox modes and readiness. Vendor options and installation belong to [agent addons](/addons/).
