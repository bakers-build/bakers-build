# Add a skill test

Extend the shared runner with a synthetic fixture and a small local validation/assertion profile.

**You need:** the checkout, Node >=22.22.0, Python 3, npm and pnpm. Read [Test a skill](/configuration/project/contributing#test-skills) for model execution and result sharing.

1. Inspect the two maintained examples:

   ```sh
   cat tests/skill-eval/fixtures/missing-account.json
   cat tests/skill-eval/profiles/missing-account.mjs
   cat tests/skill-eval/profiles/run-outtake-coding.mjs
   ```

2. Add `tests/skill-eval/fixtures/<id>.json`. The filename and `id` match. Names contain lowercase letters, digits and separating hyphens. Supply this common envelope:

   ```json
   {
     "id": "example-check",
     "synthetic": true,
     "profile": "example-check",
     "skill": "bb-workflow",
     "references": ["bb-workflow/references/results.md"],
     "input": {"required_role": "auditor", "observations": ["No matching account exists."]},
     "rubric": [
       {"id": "unresolved", "criterion": "Preserves the missing auditor account as unresolved; does not invent access."}
     ]
   }
   ```

   `input` contains every observed fact the worker may use. `rubric` belongs only to the separate judge. The unit under test, `skill`, is a skill name or one `bb-workflow/references/<file>.md`: a reference is applied directly, with `bb-workflow/SKILL.md` loaded first as context and no routing; `skill: "bb-workflow"` tests routing itself. Paths resolve beneath `.claude/skills/bakers-build/skills/`; references are unique relative Markdown paths beneath that directory. Reference only material the unit needs. Fixtures use fictional identities and `.invalid` service URLs.

   A fixture that needs an installed recipe names it in `recipes` (for example `["bb-recipe-probe"]`). Test recipes live in `tests/skill-eval/recipes/` and never ship with the plugin; real recipes get no eval. The loader places each one as the virtual file `skills/<name>/SKILL.md` for a tool fixture, so reading it is a trace event, or as `input.installed_recipes` for a text fixture. `bb-recipe-probe` leaves a unique marker per slot (`probe-method`, `Probe-working: <n>`, …), so an eval sees which slot a run applied. Profile-specific expectations go under `expect`; a tool fixture can seed earlier states' comments with `simulation.comments`.

3. Reuse a fitting `profile`, or add `profiles/<profile>.mjs`. It exports two functions:

   ```js
   export function validate(fixture) {
     if (typeof fixture.input.required_role !== 'string' || !fixture.input.required_role.trim()) {
       throw new Error('Expected required_role');
     }
   }

   export function checkOutput(fixture, output) {
     return [{
       id: 'role-preserved',
       met: output.toLowerCase().includes(fixture.input.required_role.toLowerCase()),
       reason: 'The required role must remain visible',
     }];
   }
   ```

   Validation rejects incomplete case data before paid execution. Assertions return a nonempty array of unique IDs, boolean `met` values and reasons. Derive accounts, paths and URLs from the fixture. Checks must be deterministic and perform no I/O. Keep factual meaning in the rubric: mentioning `uid:1` can correctly reject administrator substitution. A text match cannot decide whether access was invented.

   The loader discovers local profiles by name. Adding a fixture/profile requires no registry or shared runner edit. These modules are trusted repository code; the profile field cannot name an arbitrary filesystem path. The `artifact` profile provides only a nonempty-output check for legacy rubric-driven cases. The `outtake` profile reuses common presentation checks; `run-outtake-coding` adds the complete coding-review contract.

4. Add positive, negative and malformed-input coverage in `bakers-cli/core/tests/workflow/skill-eval.test.ts`, or for a state-eval profile a passing and a violating output/trace in `skill-state-evals.test.ts`. Mutate the actual output for functional negative controls while preserving the original attempt:

   ```js
   const changed = structuredClone(attempt);
   changed.negative_control = {
     reason: 'Remove the required role',
     parent_output_sha256: attempt.generation.output_sha256,
   };
   changed.output = changed.output.replaceAll('auditor', 'operator');
   changed.output_sha256 = sha256(changed.output);
   ```

   Import `sha256` from `artifacts.mjs`, save to a new JSON file, and replay it. Expect exit 1 and the intended failed check. Corrupt or missing provenance must instead produce exit 2. Do not rewrite the generation record to disguise a mutation.

5. Run the required regression checks:

   ```sh
   npm ci --prefix tests/skill-eval --no-audit --no-fund
   python3 -B -m unittest discover -s tests/skill-eval -p 'test_*.py'
   cd bakers-cli
   pnpm exec vitest run core/tests/workflow/skill-eval.test.ts
   pnpm --filter @bakers-build/core test
   pnpm lint
   ```

   The conductor CI job installs Python and the pinned Promptfoo dependency. Real Promptfoo integration is mandatory, with network and child-process calls blocked by `offline-guard.cjs`; it cannot silently skip when dependencies are absent. The regression also adds a temporary third profile and replays it without editing the runner, then rejects an empty assertion array.

**Done when:** the fixture loads, positive output passes, deliberate violations fail the expected checks, malformed input is an execution error, and a real isolated generation plus inspected semantic result demonstrates the intended behavior. CI uses saved synthetic outputs and makes no model calls.

For actual recorded calls, use [Test a skill's tool calls](/configuration/project/contributing#test-skill-tools). Profiles can inspect the third argument `{ tool_trace }`; final prose is not execution evidence.

## Call profiles

A tool-call profile parses the trace with `calls(context, fixture.simulation.files)` from `call-utils.mjs`: each `bakers tools` row gets a `mode` (`call`, `schema`, `list`), the wire `name` (`tool('bakers_ticket_read')` builds one) and its `args`. Reuse the shared checks rather than copying them:

| Helper | Use |
|---|---|
| `commonChecks(trace, allowedError, recovered)` | Observed tool calls, tool results and the call surface (no JSON:API command). `allowedError` admits only the fixture's injected error; `recovered` admits only certified call recoveries |
| `toolCalls`, `writes`, `arg`, `names`, `readAfter` | Calls of one tool, the write calls, one argument, whether a call names a ticket, the readback after a write |
| `payload`, `refused`, `uncertain` | The structured result, a tool refusal (exit 1), a lost response (exit 5, status 0) |
| `callRecovery(trace)` | Certifies a call rejected before sending (exit 4) when the next tool call succeeds; returns `recovered` and diagnostics |

The profile owns its barriers, allowed mutations and injected errors. Compute checks and diagnostics once and export both:

```js
function analyze(fixture, context) { /* return { checks, diagnostics } */ }
export const checkOutput = (f, _output, context) => analyze(f, context).checks;
export const diagnose = (f, _output, context) => analyze(f, context).diagnostics;
```

`diagnose` is optional; a profile without it reports `call_quality.status: clean`. Each diagnostic has a unique `id`, a `category` of `call-recovery`, `uncertain-write` or `expected-error`, a `severity` of `warning`, `info` or `failure`, a `reason`, and zero-based `calls` indices into the trace. A malformed diagnostic, or a `failure` while every named check passes, is an execution error (exit 2): a failure must also fail a named check.

Cover each profile in `skill-tool-calls.test.ts` with a passing trace, the recovered variant, and one negative control per rule the recovery must not absorb.

A call fixture that needs a tool, argument or fault the simulator does not model yet extends the simulator and the [real-CLI contract](/configuration/project/contributing#test-skill-tools) together:

- Put a new tool definition in `tests/skill-eval/contract-fixture.json`, which the simulator and the loopback MCP endpoint both read; copy tool definitions from what the site serves. Do not create a second copy.
- Add the call to the matching case group in `core/tests/workflow/skill-cli-contract.test.ts`. Reuse a fixture's `simulation` instead of new data.
- Assert the request, readback or error against a fixed literal. Never derive the expectation from the simulator or by calling a parser.
- Keep raw output visible. Add no normalization beyond the runner's two: JSON compared by value, and the `<contract-root>` path. Text, IDs and failure classes stay exact.
- Show the check can fail: add a deliberate variation to `drift-negative-controls`, or a fault that makes the named check fail.
- Run `pnpm exec vitest run core/tests/workflow/skill-cli-contract.test.ts` with the regression checks above.

## Shared boundaries

| File | Responsibility |
|---|---|
| `run.mjs`, `fixtures.mjs` | Commands, discovery, validation and local profile selection |
| `artifacts.mjs` | Saved-attempt integrity and assertion provenance |
| `evaluate.mjs` | Real Promptfoo assertions over saved output, call-quality validation and observed effort |
| `call-utils.mjs` | Trace parsing and checks shared by call profiles |
| `skill-worker.py`, `worker.py` | One isolated model transport and strict stream/rubric parsing |
| `profiles/*.mjs`, `outtake-checks.mjs` | Case rules and shared outtake presentation rules |
| `report.mjs` | Escaped, standalone HTML reports for HTTP sharing |

`run-outtake.mjs` delegates to the shared CLI. `run.py` retains repeatable fixture selection and the original seven-case default batch, now delegating generation and judging to the same implementation. It defaults to `sonnet`; explicit `--model` overrides it. `--prepare-only` still makes no model calls. The legacy catalog references the standalone missing-account fixture, so that case has one data source.

Version 1 attempts, including those without a `profile` field or a recorded duration, remain replayable. Assertions may evolve, but original output, source hashes and generation revision remain intact; every replay writes a new result beside the earlier ones. Promptfoo 0.121.20 attempts an opt-out telemetry event despite disabled telemetry; the pinned adapter suppresses it and fails closed if that API changes. Require the offline integration check when updating Promptfoo.
