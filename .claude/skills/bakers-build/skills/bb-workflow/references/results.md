# Result records

Use in typed comments; [outtake](outtake.md) renders.

| Record | Fields |
|---|---|
| test_as | persona + expected view/denial, or `no login needed` |
| checks | id, ac_ids, purpose (project/functional), mode (automated/agent/human), persona, environment, rationale, command_or_steps, expected, coverage (permanent/one_off) |
| results | check_id, status (passed/failed/blocked/not_run/reused), persona, environment, observed, revision, evidence |
| deliverables | label, url_or_command, cwd/access |
| manual_review | requested human checks, pending/completed, attributed observation |

## Test as

Qualification names project personas (WORKFLOW.md outtake), also denied/anonymous. Ask if unclear;
missing stays **missing**, never substituted/admin. No web surface: `no login needed`.

## Execution and coverage

Mode identifies executor, independent of purpose. Authored tests stay not_run; agent walks leave
human review pending. Reuse retains original fields/scope and reason. Failed/blocked/unrun cannot
prove PASS; missing required checks block AC;
pending human invitation blocks only if acceptance requires it.
Keep each AC PASS/FAIL/RED/PENDING with reasoning and [evidence](evidence.md).
Review uses FAIL(cause)/RED(cause); unjustified uncovered AC is FAIL(evidence). bb-verdict owns
causes. Findings retain What/Why/Fix and success check. Keep full logs out of visible summary.
