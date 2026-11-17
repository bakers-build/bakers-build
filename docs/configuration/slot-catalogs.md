# Slot catalogs

A slot catalog names several configurations of one slot by alias and picks one per run. It lives in the [machine file](/configuration/machine); the project may only restrict it.

`agent` and `runtime` are catalogs; `workspace` and `executor` hold exactly one entry (the executor keeps per-branch state), so more than one is refused with a message and a single-plugin config loads unchanged as the default entry.

```js
runtime: {
  catalog: [
    { alias: 'sandbox', use: '@bakers-build/addon-runtime-bwrap' },
    { alias: 'box', use: '@bakers-build/addon-runtime-docker', with: { image: 'node:22' } },
  ],
  routes: { default: { '*': 'sandbox', review: 'box' } },
  allow_unsandboxed: false,
},
```

The runtime catalog holds the built-in `system` entry (the host, a reserved alias that does not isolate), the runtime a top-level addon supplies (the **preset**, under its id) and your `catalog` entries; an alias equal to the preset id replaces it. A machine with no runtime runs on `system`, which the run note records.

## Which entry runs a ticket

The first match wins, for `runtime` and for `agent` through its [own chain](/agents/reference#which-agent-runs-a-state):

1. A permitted ticket label `runtime:<alias>` (or `runtime:<route>`), also with `@<state>` ([labels](/skills-and-workflows/types-recipes-labels#runtime-labels)).
2. The route for the ticket's state, `routes.default[<state>]`.
3. `routes.default['*']`.
4. The project's `runtime.default`.
5. The addon preset.
6. The built-in `system`.

A machine `select(candidates, ticket) => alias` replaces this order. An alias it returns that is not a candidate, or a throw, fails the run with the reason; there is no fallback. An unknown `runtime:` label alias fails the run too. `agents.select` does the same for agents, and replaces the deprecated project `select_agent`.

```js
runtime: {
  catalog: [{ alias: 'sandbox', use: '@bakers-build/addon-runtime-bwrap' }],
  select: (candidates, ticket) => (ticket.labels.includes('risky') ? 'sandbox' : 'system'),
},
```

## Unsandboxed runs

A label may put a run on an entry that does not isolate (`system`) only when `runtime.allow_unsandboxed` is `true` on the machine. Otherwise the label is ignored, the order continues and the conductor logs a warning naming the ticket and alias. The server decides who may add the label ([protected namespaces](/skills-and-workflows/types-recipes-labels#protected-label-namespaces)); this flag is the machine's own lock.

Each run appends a run note with the agent and runtime alias, the reason (`label`, `function`, `route`, `default-route`, `project`, `preset`, `fallback`) and the conductor's owner. A run that a label put on a runtime that does not isolate also posts a ticket comment saying so; a host default posts none. Clone mode follows the run's runtime, so a catalog may mix isolating and host entries (a herdr workspace has no run clone and refuses such a mix).

