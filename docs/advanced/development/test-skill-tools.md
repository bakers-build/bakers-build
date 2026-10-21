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

   Ordinary fixtures expose two MCP tools: `bakers(argv)` and `read_file(path)`. bakers.build arguments are literal arrays; virtual files come from the fixture. There is no shell expansion, host file access or live tracker. Built-in tools and all other MCP servers remain unavailable.

2. Inspect `worker/tool-trace.jsonl`, `worker/stream.jsonl` and `attempt.json`. The independent simulator trace must match the model stream; prose claims do not count.

   | Fixture | Required behavior |
   |---|---|
   | `publish-comment-calls` | Read the body, discover fields, create exactly one comment with exact Markdown/type/UUID; the successful create response confirms it |
   | `publish-comment-uncertain` | Report the timed-out create as unresolved and never send a second create; a create body that lost a trailing newline fails |
   | `create-ticket-calls` | Search both prior-art fields with two spellings and a positive probe, create/read the ticket, publish qualification and summary, then route once to spec |
   | `create-ticket-prior-art` | Inspect the full candidate and stop without mutations; a complete search result needs no redundant read |
   | `transition-ticket-calls` | Read state, discover fields, update only the supplied destination and additive links, then verify |
   | `transition-ticket-links-only` | Preserve existing links, add the resolved MR, omit state entirely, and verify |
   | `transition-ticket-rejected` | Preserve the definite 422 rejection and never retry another destination |

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

   The judge receives the recorded trace as evidence as well as the final answer. A favorable semantic judgment cannot override failed call assertions. Tool generation is one worker invocation with multiple model turns; `model_calls` records those turns and `worker_invocations` records the CLI invocation. Replay records zero model calls.

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
| One rejected read, optional help, then an exact independent readback before the next dependent write | passed | `read-recovery` warning |
| A second rejected read for the same record, no later exact readback, or a readback after the next dependent write | failed | `read-recovery` failure |
| Timeout on create, reported as unresolved, no second create | passed | `uncertain-write` info |
| Timeout on create followed by a second create | failed | `uncertain-write` failure |
| Injected 422 preserved without another destination | passed | `expected-error` info |

A read is recoverable only when the simulator rejected its syntax before any lookup (unknown option, positional argument, unknown action such as `get`/`show`, unsupported target), it names exactly the UUID being verified, and it carries no `--no-validate`. A 404, backend error, timeout, unknown tool, failed write or correction, wrong identifier and wrong content are never absorbed: they keep failing `tool-results` or the content check. Changing the one-attempt limit is a policy change with its own tests.

A passed `transition-ticket-rejected` means the rejection was preserved, not that the state changed. A passed timeout case means no duplicate was sent, not that the comment exists.

Creation shows why order is a correctness rule. In this trace excerpt the summary is published after routing, so `qualification-and-summary` fails even though both comments exist:

```text
7 create bb_comment (qualification)   8 update bb_ticket --state spec
9 create bb_comment (summary)         10 read bb_ticket
```

Both creates must succeed before the state write. A favorable semantic judgment never overrides this check.

## Extend call coverage

Set `execution: simulated-tools`, select the matching call profile and provide `simulation` data: initial ticket, virtual files and the selected fault condition. Simulation data and assertions are withheld from the worker; `input` supplies the caller's task and facts. The tools expose only supported fixture operations, including CLI help and `bakers info` (the project and workspace from the fixture input). The server never invokes bakers.build or evaluates command strings. Its source snapshot and hash remain with the worker artifacts. The simulator's schemas, label terms and probe ticket live in `tests/skill-eval/contract-fixture.json`, shared with the real-CLI contract below.

Profiles receive `checkOutput(fixture, output, { tool_trace })` and optionally export `diagnose` with the same arguments; [Add a skill test](/advanced/development/add-skill-test#call-profiles) lists the shared helpers. Trace rows contain `tool`, `arguments` and `result` with exit code, stdout and stderr. Like the CLI, the simulator prints stdout as text; read it through `payload()`, `data()`, `cliError()` and `uncertain()` in `call-utils.mjs`, which also read older traces that stored a parsed object or the retired synthetic exit 124. An intentionally changed replay trace needs its own hash plus `negative_control.reason` and `parent_tool_trace_sha256`; never edit the original generation trace. Ordinary output mutation remains supported separately.

Permanent tests live in `core/tests/workflow/skill-tool-calls.test.ts` and the shared runner suite. Python tests exercise the actual stdio protocol and isolation checks. CI runs real Promptfoo under the offline network/process guard, with no model calls.

This boundary tests skill tool selection, arguments, ordering and failure handling. The simulator itself is checked against the CLI below; a model run still executes no CLI, shell or server. Supplied synthetic API responses are not evidence of a live publication or transition. State restrictions on the parent ticket remain unchanged.

## Remote prior-art cases

`qualify-prior-art-base-*` and `merge-prior-art-base-*` cover negative, hit and error paths.
Their fixture-only `git(argv)`/`glab(argv)` tools return declared responses and reject other
commands; nothing executes on the host. Profiles assert search/probe evidence, reporting and
merge/publication order. Python tests verify Git semantics in disposable local repositories.
Live Conductor evidence remains separate.

## Check the simulator against the real CLI

The contract suite sends the same literal argument arrays to the simulator and to this checkout's CLI. The CLI talks to a disposable loopback JSON:API fixture. A disagreement, a wrong payload or an escaped request fails a named check. It needs no model, bakers.build account, credential or DDEV:

```sh
cd bakers-cli && pnpm install && pnpm -r run build && cd ..
npm ci --prefix tests/skill-eval --no-audit --no-fund
cd bakers-cli
pnpm exec vitest run core/tests/workflow/skill-cli-contract.test.ts
```

The CLI leg runs `bakers-cli/bin/bakers` with the current Node and no shell, never `bakers` from `PATH`. A missing build or a file resolving outside the checkout fails. Every run prints `cli_contract_identity`: commit, dirty flag, Node, launcher/host/addon paths and hashes, and the resolved dropsh and plugin versions. Each call gets a fresh config, home and cache directory and an allowlisted environment, so inherited `BB_*`, `DROPSH_*`, credentials and `NODE_OPTIONS` have no effect. `cli-origin-guard.cjs` refuses any other origin, including redirects, before connecting (exit 98).

Each case group is one test: `help-and-fields`, `read-search-and-format`, `comment-payload-and-readback`, `data-file-payload`, `ticket-payload-and-labels`, `transition-update-shapes`, `malformed-and-unknown`, `missing-read-and-422`, `lost-response-applied`, `lost-response-unapplied`, `confinement`, `drift-negative-controls` and `stable-repeat-and-replay`. A failure lists its check IDs, such as `step-2:error-class` or `one-submission-per-write`. It also prints the argv, CLI result and simulator result for every step. `step-N:*` compares the legs. The other checks assert the recorded request bytes, decoded payload, readback and confinement against fixed expectations, never against the simulator. Normalization is limited to two things. JSON stdout is compared by value after parsing, so object key order and whitespace are ignored. The runner's temporary directory is replaced by `<contract-root>` in CLI stdout and stderr. Text values, IDs, relationships and failure classes are never normalized.

Observed CLI contract, as modeled by the simulator:

| Situation | Result |
|---|---|
| Unknown command or option on `read`/`search` | Exit 1, plain parser text, no JSON |
| Unknown field, malformed target, mixed `--data` and fields, invalid payload | Exit 4, `E_VALIDATION`, sends no write |
| Missing entity, server 422 | Exit 5, `E_HTTP`, `details.status` 404 or 422 |
| Lost response | Exit 5, `E_HTTP`, `details.status` 0: the outcome is uncertain, not rejected |
| Unknown label name | Exit 6, `E_PLUGIN` from `bakers-name-refs` |

Labels are `bb_term` with bundle `bb_labels`. `--label_names` resolves to `labels` linkage and never reaches the wire as an attribute. A PATCH replaces a whole field, so a body correction restates `body.format`. `--format md` drops trailing newlines from multi-line values; verify exact text with JSON. The CLI retries a read after a network failure but sends a write once, so a lost response never submits a create twice; `lost-response-applied` checks that.

| Boundary | Proves | Does not prove |
|---|---|---|
| Simulated tool use (model runs above) | Which calls a skill makes, in which order, with which arguments | That the CLI accepts them |
| Real CLI contract (this section) | CLI parsing, schema validation, name resolution, request bytes and error classes for the selected commands, and simulator agreement | Bash quoting or expansion, live Drupal schema freshness, permissions, workflow policy, server hooks |
| Live integration (a Conductor run, see the testing note) | Behavior against a real application | Anything about other environments |

The fixture schemas are synthetic; agreement says nothing about the current remote schema. [Add a skill test](/advanced/development/add-skill-test#call-profiles) explains how to add a command form.
