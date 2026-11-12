# Test a skill

Generate one synthetic skill output, replay its deterministic checks offline, and inspect a separate semantic judgment.

**You need:** this checkout, Node >=22.22.0, npm and Python 3. Generation and judging also need an authenticated Claude Code CLI. Replay needs no model account.

1. Install the pinned dependency and select a fixture:

   ```sh
   npm ci --prefix tests/skill-eval
   node tests/skill-eval/run.mjs list
   node tests/skill-eval/run.mjs --help
   ```

2. Choose an unused directory under your ticket's transient root. This example checks a missing auditor account:

   ```sh
   eval_dir=assets-ai/EXAMPLE-1/promptfoo
   node tests/skill-eval/run.mjs generate --fixture missing-account \
     --output "$eval_dir/missing-account" --model sonnet --timeout 180
   ```

   Generation loads the selected skill and references from this checkout. One isolated Claude worker receives the supplied observations, with the rubric withheld. Call fixtures use [simulated tools](test-skill-tools.md). Promptfoo then checks the saved output. Use `prepare` instead of `generate` to snapshot inputs without a model call; preparation is not a passed test. A fixture ID or JSON path is accepted.

3. Replay the unchanged attempt twice:

   ```sh
   node tests/skill-eval/run.mjs replay --input "$eval_dir/missing-account/attempt.json" \
     --output "$eval_dir/replay.json"
   node tests/skill-eval/run.mjs replay --input "$eval_dir/missing-account/attempt.json" \
     --output "$eval_dir/replay-again.json"
   ```

   Compare named `checks`; evaluation IDs and timing can differ. Replay uses the saved fixture and current local profile. It makes no model, network or child-process call. Output paths must be unused; the original attempt remains unchanged.

4. Explicitly request a supporting semantic judgment:

   ```sh
   node tests/skill-eval/run.mjs judge --input "$eval_dir/missing-account/attempt.json" \
     --output "$eval_dir/semantic" --model sonnet --timeout 180
   ```

   Inspect `worker/artifact.md` and the judge's exact quotes. For this case, auditor access must remain blocked, administrator uid:1 must not substitute, and the reachable environment must not become a claimed browser-test pass. Deterministic checks preserve the role and environment and reject invented URLs; they cannot establish these semantic facts. A judge can also be wrong. Keep its raw verdict and record your adjudication separately.

**Done when:** the actual output and provenance are retained, both replays agree, and semantic findings have been inspected. Exit 0 means the selected checks passed, 1 means a named assertion or rubric failed, and 2 means input or execution error. Keep observed skill defects visible.

## Rerun policy

| Change | Run |
|---|---|
| Assertions, profiles or the report only | `replay` the saved attempts; no model call |
| A skill, a reference it loads, the worker prompt or the simulator interface | A new `generate` attempt per affected fixture |
| Nothing | Nothing; a repeated attempt for a better sample is not evidence |

Write every replay and attempt to a new path. The original attempt and its first result stay as they were, so an earlier failure remains visible next to a later pass. A deliberately repeated generation records its reason beside the earlier attempts.

## Read effort

Each result carries `effort`:

- `tool_calls`: total, `bakers`, `read_file` and failed calls in the recorded trace.
- `recovery`: attempted and verified call-recovery episodes. An episode starts at a call rejected before sending (exit 4) and is verified when the next tool call succeeds. Any other failed call counts only in `tool_calls.failed`, never as an episode. Schema and list lookups count as calls, not as verification.
- `generation`: model turns, measured elapsed milliseconds, cost and provider usage of the original worker. A value the attempt never recorded is `null` with `unavailable`; older attempts have no duration. A reported `0` is a measurement.
- `evaluation`: this replay's own elapsed milliseconds and its zero model calls. It is not the generation cost.

Compare two attempts only under the same fixture, skill and simulator hashes, and state the model, CLI version, revision and dirty status from each `attempt.json`. One attempt shows what happened once; it is not a performance claim.

## Share results over HTTP

Create a self-contained HTML report from selected result and attempt files:

```sh
node tests/skill-eval/report.mjs \
  --input "$eval_dir/replay.json" --input "$eval_dir/semantic/result.json" \
  --input "$eval_dir/missing-account/attempt.json" \
  --output "$eval_dir/public/index.html"
python3 -m http.server 8756 --bind 127.0.0.1 --directory "$eval_dir/public"
```

The server stays in that terminal. Only the selected report directory is served. Model text is escaped and displayed verbatim; the report loads no external resources. In another terminal, from the same worktree, resolve the sharing policy:

```sh
printenv BAKERS_TUNNEL
# If unset:
bakers config check --scope machine --format json
```

`BAKERS_TUNNEL=1` or `true` enables sharing; `0` or `false` disables it. If unset, use `machine_policy.tunnel`. When enabled:

```sh
bakers ports list
bakers ports up 8756 --url http://127.0.0.1:8756
```

Share the returned public origin with `/index.html` appended, after an HTTP 200 for both the local and the public URL, following redirects, shows the same report. When disabled, share `http://127.0.0.1:8756/index.html` as **local-only**. Unknown policy or tunnel failure also means local-only, with the reason stated. Use a free port if 8756 is occupied. Tunnel hostnames expire; durable evidence retains the worktree, port, commands and commit. Serving is separate from offline replay.

## Provenance and isolation

`attempt.json` records the fixture, maintained skill snapshots and hashes, prompt, raw output, repository commit, dirty status and worker model/version/usage. `sonnet` is an alias, not a pinned model. Current assertion hashes are separate from the generation revision. Provider errors retain raw streams and diagnostic records; they never become assertion passes. Artifacts under `assets-ai/` disappear with the worktree.

The default worker runs in a fresh temporary directory with no tools, MCP servers, loaded skills or persistent session. Explicit tool-call fixtures permit only the local simulator. Supplied observations replace tool calls. These evaluations test interpretation and reporting; they do not exercise live application access or workflow transitions.

## Extend your tests

### Setup conversations through herdr

The setup audit uses separate tool-free Claude workers for the setup role and the synthetic
user. Run the driver in a herdr TUI pane so its questions, answers and completion remain visible.
Use the installed `herdr --skill` instructions to create a pane without changing user focus.
From the repository root, with the existing CLI dependencies provisioned:

```sh
python3 -B tests/skill-eval/setup-conversation.py \
  tests/skill-eval/fixtures/setup/setup-s5-named.json \
  assets-ai/EXAMPLE-1/setup-attempt
node tests/skill-eval/setup-attempt.mjs assets-ai/EXAMPLE-1/setup-attempt
node --require ./tests/skill-eval/offline-guard.cjs tests/skill-eval/run.mjs replay \
  --input assets-ai/EXAMPLE-1/setup-attempt/attempt.json \
  --output assets-ai/EXAMPLE-1/setup-replay.json
```

`SETUP_MODEL` selects the setup agent's model and `SETUP_USER_MODEL` the synthetic user's; both default to `sonnet`. Each result records the model it ran with.

Directories and replay files must be unused. The driver keeps private answers out of the setup
role, retains per-role raw streams, and passes literal actions through a closed boundary. Local
config commands use the real registered CLI implementation with `BAKERS_HOME` and auth state
inside the case; external authentication and tracker responses are labelled fixture doubles.
Direct machine/project config writes accept only `export default` followed by a strict JSON
object; imports, expressions, extra statements and connection writes are rejected. After such a
write, initialization of that scope is unavailable. Exact field assertions
parse this data without executing it. Arbitrary config JavaScript, installation, cloning, hooks
and conductor startup are unavailable. These restrictions can block
a scenario and must not be reported as skill defects. `completed` means the conversation reached
a final report, not that setup succeeded. Read the final report and file assertions separately.

Replay uses independently maintained expectations from `fixtures/setup/`, actual file snapshots
and the existing provenance checks. Repeat replay to another unused output and compare named
checks. Inspect recommendations, authorization, delegation and readiness claims separately;
file checks cannot prove them. Preserve failed attempts and state the reason before any rerun.

Add coverage for another skill or explore a maintained example.

- [Add a skill test](add-skill-test.md) — Write fixtures and profiles, then run the required offline CI checks.
- [Test the coding outtake](test-run-outtake.md) — Check presentation and use a negative control for the exact login URL.
