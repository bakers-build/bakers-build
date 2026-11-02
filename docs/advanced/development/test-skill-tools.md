# Test a skill's tool calls

Evaluate the actual tool calls made by publish-comment, create-ticket and transition-ticket against a local bakers.build simulation.

**You need:** the setup from [Test a skill](/advanced/development/test-skills), including authenticated Claude Code for generation. No bakers.build connection or application account is used by the simulator.

1. Select a case and a new output directory:

   ```sh
   node tests/skill-eval/run.mjs list
   eval_dir=assets-ai/EXAMPLE-1/promptfoo
   node tests/skill-eval/run.mjs generate --fixture publish-comment-calls \
     --output "$eval_dir/publication" --model sonnet --timeout 240
   ```

   Ordinary fixtures expose three MCP tools: `bakers(argv)`, `read_file(path)` and `write_file(path, content)`. `bakers` simulates `bakers tools`: no name lists the bakers tools, `<tool> --schema` describes one and `<tool> --data @<file>` calls it, as the tools reference (`.claude/skills/bakers-build/skills/bb-workflow/references/tools.md`) prescribes. Tools use their wire names, `tool_api__bakers_ticket_read` and so on; an unprefixed name is an unknown tool (exit 4). The arguments file is a virtual file the model writes with `write_file`; fixture files are read-only. A JSON:API command (`read`, `search`, `create`, `update`, `schema`) is not part of the skill contract and fails.

2. Inspect `worker/tool-trace.jsonl`, `worker/stream.jsonl` and `attempt.json`. The independent simulator trace must match the model stream; prose claims do not count.

   | Fixture | Required behavior |
   |---|---|
   | `publish-comment-calls` | Read the body, call `bakers_comment_publish` once with the exact Markdown `body`, `type` and `ticket`; the result's `id` confirms it |
   | `publish-comment-uncertain` | Report the lost response (exit 5) as unresolved and never publish again; a body that lost a trailing newline fails |
   | `create-ticket-calls` | Search two spellings and prove an empty one with the `ticket` probe, create with `recipe` and `type` by name, read it back, publish qualification and summary, then route once to `plan` |
   | `create-ticket-prior-art` | Read the returned candidate in full and stop without mutations |
   | `transition-ticket-calls` | Read the state, call `bakers_ticket_transition` once with the supplied `state` and the links to add, then read back state and every link |
   | `transition-ticket-links-only` | Send `links` without `state`, keep every existing link, and verify |
   | `transition-ticket-rejected` | Preserve the refusal (exit 1, `E_TOOL`) and never retry another destination |

3. Replay the recorded output and calls offline:

   ```sh
   node tests/skill-eval/run.mjs replay --input "$eval_dir/publication/attempt.json" \
     --output "$eval_dir/publication-replay.json"
   ```

   Replay starts neither Claude nor the simulator. Call hashes, original model-call correspondence and explicit mutation provenance are checked before Promptfoo runs the profile. Missing/corrupt traces are execution errors. Validly recorded wrong calls fail named assertions, even if the final response claims success.

   See [Read the result](#read-the-result) for call-quality warnings.

4. Inspect meaning separately when needed:

   ```sh
   node tests/skill-eval/run.mjs judge --input "$eval_dir/publication/attempt.json" \
     --output "$eval_dir/publication-judge" --model sonnet --timeout 240
   ```

   The judge receives the recorded trace as evidence as well as the final answer. A favorable semantic judgment cannot override failed call assertions.

5. Generate and share the [HTTP report](/advanced/development/test-skills#share-results-over-http). Include the attempt to show expandable call arguments and results:

   ```sh
   node tests/skill-eval/report.mjs --input "$eval_dir/publication-replay.json" \
     --input "$eval_dir/publication/attempt.json" --output "$eval_dir/public/index.html"
   ```

**Done when:** each selected skill has a real recorded invocation sequence, unchanged replays agree, deliberate argument and ordering violations fail, and final claims have been compared with the calls. Preserve discovered skill failures.

## Read the result

A result has two separate dimensions. **Correctness** is `status`: the named checks decide `passed` or `failed` and the exit code. **Call quality** is `call_quality.status`: `clean`, `warning` or `failed`, with diagnostics that name a category, severity, reason and the original call numbers.

| Observation | Correctness | Call quality |
|---|---|---|
| One call rejected before sending (exit 4), optional `--schema` or list lookups, then a successful tool call | passed | `call-recovery` warning |
| A second rejection in a row, or no successful call after the rejection | failed | `call-recovery` failure |
| Lost response on a publication, reported as unresolved, no second publication | passed | `uncertain-write` info |
| Lost response followed by a second publication | failed | `uncertain-write` failure |
| Injected transition refusal preserved without another destination | passed | `expected-error` info |

Only exit 4 is recoverable: the CLI rejected the call against the tool's schema, or the tool name, before anything was sent. A refusal by the tool (exit 1), an HTTP or protocol error (exit 5), a wrong identifier and wrong content are never absorbed: they keep failing `tool-results` or the content check.

A passed `transition-ticket-rejected` means the rejection was preserved, not that the state changed. A passed timeout case means no duplicate was sent, not that the comment exists.

Creation shows why order is a correctness rule. In this trace excerpt the summary is published after routing, so `qualification-and-summary` fails even though both comments exist:

```text
5 bakers_comment_publish (qualification)   6 bakers_ticket_transition (state plan)
7 bakers_comment_publish (summary)         8 bakers_ticket_read
```

Both publications must succeed before the transition.

## Extend call coverage

Set `execution: simulated-tools`, select the matching call profile and provide `simulation` data: initial ticket, virtual files and the selected fault condition. Simulation data and assertions are withheld from the worker; `input` supplies the caller's task and facts. The tools expose only supported fixture operations, including CLI help and `bakers info` (the project and workspace from the fixture input). The server never invokes bakers.build or evaluates command strings. Its source snapshot and hash remain with the worker artifacts. The tool definitions (wire names, input and output schemas, as Drupal serves them), the project UUID and key and the probe ticket live in `tests/skill-eval/contract-fixture.json`, shared with the real-CLI contract below. Fixture tickets use the read tool's shape: `description` is Markdown, `type`, `recipe` and `labels` are names; seeded `comments` carry `ticket`, `type` and `body`.

Profiles receive `checkOutput(fixture, output, { tool_trace })` and optionally export `diagnose` with the same arguments; [Add a skill test](/advanced/development/add-skill-test#call-profiles) lists the shared helpers. Trace rows contain `tool`, `arguments` and `result` with exit code, stdout and stderr. Like the CLI, the simulator prints the tool's structured output as JSON text; `calls(context, files)` in `call-utils.mjs` turns each row into a tool `name` and its `args` (resolving `--data @file` against fixture files and earlier `write_file` rows), and `payload()`, `cliError()`, `refused()` and `uncertain()` read the result. An intentionally changed replay trace needs its own hash plus `negative_control.reason` and `parent_tool_trace_sha256`; never edit the original generation trace. Ordinary output mutation remains supported separately.

Permanent tests live in `core/tests/workflow/skill-tool-calls.test.ts` and the shared runner suite. Python tests exercise the actual stdio protocol and isolation checks. CI runs real Promptfoo under the offline network/process guard, with no model calls.

## Remote prior-art cases

`qualify-prior-art-base-*` and `merge-prior-art-base-*` cover negative, hit and error paths.
Their fixture-only `git(argv)`/`glab(argv)` tools return declared responses and reject other
commands; nothing executes on the host. Profiles assert search/probe evidence, reporting and
merge/publication order. Python tests verify Git semantics in disposable local repositories.

## Check the simulator against the real CLI

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

[Add a skill test](/advanced/development/add-skill-test#call-profiles) explains how to add a tool or fault.
