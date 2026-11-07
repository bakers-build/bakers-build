# Check the simulator against the real CLI

The contract suite sends the same literal argument arrays to the simulator and to this checkout's CLI. The CLI's `bakers tools` (`@dropsh/plugin-tool`, an MCP Streamable-HTTP client) talks to a disposable loopback MCP endpoint: JSON-RPC over HTTP at `/mcp`, serving `tools/list` from the shared `contract-fixture.json` and answering `tools/call` from fixture state. A disagreement, a wrong payload or an escaped request fails a named check. It needs no model, bakers.build account, credential or DDEV:

```sh
cd bakers-cli && pnpm install && pnpm -r run build && cd ..
npm ci --prefix tests/skill-eval --no-audit --no-fund
cd bakers-cli
pnpm exec vitest run core/tests/workflow/skill-cli-contract.test.ts
```

The CLI leg runs `bakers-cli/bin/bakers` with the current Node and no shell, never `bakers` from `PATH`. A missing build or a file resolving outside the checkout fails. Every run prints `cli_contract_identity`: commit, dirty flag, Node, launcher/host/addon paths and hashes, and the resolved dropsh, plugin and `@dropsh/plugin-tool` versions. Each call gets a fresh config, home and cache directory and an allowlisted environment, so inherited `BB_*`, `DROPSH_*`, credentials and `NODE_OPTIONS` have no effect. `cli-origin-guard.cjs` refuses any other origin, including redirects, before connecting.

Each case group is one test; together they call every operation in the tools reference. Arguments go to runner-owned JSON files passed as `--data @<file>`. A failure lists its check IDs, such as `step-2:error-class` or `one-submission-per-write`, and prints the argv, CLI result and simulator result for every step. `step-N:*` compares the legs. The other checks assert the `tools/call` request bytes and arguments, results, readback and confinement against fixed expectations, never against the simulator. Normalization is limited to two things: JSON stdout is compared by value after parsing, and the runner's temporary directory is replaced by `<contract-root>`. Text values, IDs and failure classes are never normalized. `drift-negative-controls` shows that an unknown tool (`step-1:tool-known`), an invalid payload (`step-2:arguments-valid`) and a CLI/simulator disagreement (`x:success-output`, `x:exit-code`, `x:error-class`) each fail their own check, and `confinement` shows that a JSON:API command leaves the MCP route and fails `known-routes`.

Observed CLI contract, as modeled by the simulator:

| Situation | Result |
|---|---|
| Unknown option on `tool` | Exit 1, plain parser text, no JSON |
| Tool refusal (unknown ticket or project, refused move, invalid entry) | Exit 1, `E_TOOL` with the tool's message |
| Unknown tool (also an unprefixed id such as `bakers_ticket_read`), unreadable or invalid `--data`, arguments outside the input schema | Exit 4, `E_VALIDATION`, nothing sent |
| Lost response, or a result outside the tool's output schema | Exit 5, `E_HTTP`, `details.status` 0: the outcome is uncertain, not refused |

The client checks each result against the advertised output schema, so a field the schema types as a non-nullable string must not be null. Type, recipe and label names are reused or created in the workspace: the fixture caller may create terms, so an unknown name is never refused. The CLI sends a tool call once, so a lost response never publishes twice; `lost-response-applied` checks that.

| Boundary | Proves | Does not prove |
|---|---|---|
| Simulated tool use (model runs above) | Which tools a skill calls, in which order, with which arguments | That the CLI accepts them |
| Real CLI contract (this section) | CLI parsing, `--data` file handling, schema validation, request bytes, result handling and error classes, and simulator agreement | Bash quoting or expansion, the live site's tool definitions, permissions, workflow policy |
| Live integration (a Conductor run, see the testing note) | Behavior against a real application | Anything about other environments |

[Add a skill test](/development/add-skill-test) explains how to add a tool or fault.
