# Single-skill behavioral evaluations

One runner supports isolated generation, offline Promptfoo replay and explicit semantic judging.
Start with [Test a skill](../../docs/bakers/development/test-skills.md).
Use [Add a skill test](../../docs/bakers/development/add-skill-test.md) for the fixture/profile
contract and CI checks, or the [run-outtake case](../../docs/bakers/development/test-run-outtake.md)
for exact-login and presentation coverage.

```sh
npm ci --prefix tests/skill-eval
node tests/skill-eval/run.mjs list
node tests/skill-eval/run.mjs generate --fixture missing-account --output assets-ai/skill-eval/first
node tests/skill-eval/run.mjs replay --input assets-ai/skill-eval/first/attempt.json --output assets-ai/skill-eval/replay.json
node tests/skill-eval/run.mjs judge --input assets-ai/skill-eval/first/attempt.json --output assets-ai/skill-eval/semantic
```

Requires Node >=22.22.0 and Python 3. Generation and judging each invoke one Claude worker;
tool fixtures can take multiple model turns.
replay makes none and needs no model authentication. Default model: `sonnet`. All fixtures are
synthetic; no application URL is contacted, account provisioned or live ticket mutated.

`fixtures/*.json` supplies facts and a semantic rubric. A fixture's `skill` is a skill or one
`bb-workflow` reference (applied with the frame as context); `recipes` installs test recipes from
`recipes/`, which never ship. `profiles/*.mjs` validates each case and
checks decidable output properties. Adding a case requires no shared runner edit. Missing-account
retains the required auditor and distinguishes unavailable access from an administrator substitute;
run-outtake-coding checks the issued URL and coding presentation. Semantic meaning is checked by a
separate rubric and agent inspection, never inferred solely from a structural pass.

`prepare` snapshots inputs without model calls. `run-outtake.mjs` is a compatibility alias;
`run.py --list`, repeatable `--fixture`, and `--prepare-only` delegate to the same implementation.
The Python batch defaults to the original seven cases and explicitly runs worker plus judge.
Older version 1 outtake attempts remain replayable. Outputs are never overwritten.

Exit 0: selected checks passed; 1: named check/rubric failure; 2: execution/input error.
Raw streams, prompts, source/output hashes and model metadata remain in the attempt directory.
Judge quotes must match the output, but a valid quote can still support an incorrect judgment.
Keep raw judgments and record adjudication separately.

The core suite discovers `bakers-cli/core/tests/workflow/skill-eval.test.ts`. CI installs Python and
this package before running it. Real Promptfoo replay cannot silently skip; its process/network
guard covers both maintained profiles and a temporary third extension. No CI model calls occur.
The pinned Promptfoo telemetry workaround is documented in the author guide and must pass this
integration check before any dependency update.

Generate a standalone HTML report with `report.mjs --input <result-or-attempt.json>` (repeatable)
and `--output <new-report.html>`. The operator guide shows HTTP serving and conditional sharing
through `bakers ports` when the tunnel policy is enabled. Serving remains separate from offline replay.

For publish-comment, create-ticket and transition-ticket, see
[Test a skill's tool calls](../../docs/bakers/development/test-skill-tools.md). Twelve cases exercise
actual MCP calls against a local simulator, including exact Markdown, prior-art decisions, confirmation,
uncertain publication, links-only transitions, a refused transition, and a requester's conversation from
its start to the hand-over. `bakers(argv)` simulates
`bakers tools <tool> --data @<file>` for the bakers tools in `contract-fixture.json`; it never
executes a command or contacts a tracker, and a JSON:API command fails as outside the skill contract.
Final prose cannot substitute for the recorded call trace. `cli-contract.mjs` runs the same argv through
the repository CLI against a loopback MCP endpoint serving the same tool definitions, so the simulator
cannot drift from the real CLI unnoticed; the guide documents that suite.
Profiles receive the trace as a third context argument. Results keep correctness (`status`) and
call quality (`call_quality`) separate and record observed `effort`; reports display both with the
call arguments and results.
