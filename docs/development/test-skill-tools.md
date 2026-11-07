# Test a skill's tool calls

Evaluate the actual tool calls made by publish-comment, create-ticket and transition-ticket against a local bakers.build simulation.

**You need:** the setup from [Test a skill](/development/test-skills), including authenticated Claude Code for generation. No bakers.build connection or application account is used by the simulator.

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
   | `create-ticket-conversation-start` | Read the user before any write, search, create the ticket in the host's project and add the conversation link; publish nothing and ask the requester only about content |
   | `create-ticket-handover` | After the requester's yes: `qualification`, `spec`, `plan`, `test` and `summary`, then the picked recipe with `feature` or `chore`, `working`, and last the host's conductor, never `auto`; only the nine tools the skill's operations map to |
   | `create-ticket-no-conductor` | The same hand-over without a host conductor: the project's conductors are read and the reply asks which one runs the ticket |
   | `create-ticket-other-approval` | Another person's clear yes changes nothing |
   | `create-ticket-bug` | An approved bug gets `qualification` and `summary`, type `bug` with the picked recipe, and ends in `plan` without `auto` |
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

5. Generate and share the [HTTP report](/development/test-skills). Include the attempt to show expandable call arguments and results:

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

Profiles receive `checkOutput(fixture, output, { tool_trace })` and optionally export `diagnose` with the same arguments; [Add a skill test](/development/add-skill-test) lists the shared helpers. Trace rows contain `tool`, `arguments` and `result` with exit code, stdout and stderr. Like the CLI, the simulator prints the tool's structured output as JSON text; `calls(context, files)` in `call-utils.mjs` turns each row into a tool `name` and its `args` (resolving `--data @file` against fixture files and earlier `write_file` rows), and `payload()`, `cliError()`, `refused()` and `uncertain()` read the result. An intentionally changed replay trace needs its own hash plus `negative_control.reason` and `parent_tool_trace_sha256`; never edit the original generation trace. Ordinary output mutation remains supported separately.

Permanent tests live in `core/tests/workflow/skill-tool-calls.test.ts` and the shared runner suite. Python tests exercise the actual stdio protocol and isolation checks. CI runs real Promptfoo under the offline network/process guard, with no model calls.

## Remote prior-art cases

`qualify-prior-art-base-*` and `merge-prior-art-base-*` cover negative, hit and error paths.
Their fixture-only `git(argv)`/`glab(argv)` tools return declared responses and reject other
commands; nothing executes on the host. Profiles assert search/probe evidence, reporting and
merge/publication order. Python tests verify Git semantics in disposable local repositories.

## Check the real CLI

[Compare the simulator with the real CLI](/development/test-cli-contract) to validate parsing, payloads and error classes independently of model behavior.
