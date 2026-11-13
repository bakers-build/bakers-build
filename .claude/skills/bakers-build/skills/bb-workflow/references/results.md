# Result records

Typed comments use [ticket writes](ticket-writes.md); [outtake](outtake.md) renders.

| Record | Fields |
|---|---|
| test_as | persona + view/denial, or `no login needed` |
| checks | id, ac_ids, purpose (project/functional), mode (automated/agent/human), persona, environment, rationale, command_or_steps, expected, coverage (permanent/one_off) |
| results | check_id, status (passed/failed/blocked/not_run/reused), persona, environment, observed, revision, evidence |
| deliverables | label, url_or_command, cwd/access |
| manual_review | human checks, pending/completed, attributed observation |

Qualification names WORKFLOW.md personas, including denied/anonymous; ask if unclear.
Missing stays missing, never substituted/admin; no web surface: no login needed.
Mode names executor. Authored tests stay not_run; agent walks leave human review pending.
Reuse keeps original fields/scope/reason. Failed/blocked/unrun/missing checks block ACs;
human invitations block only when acceptance requires them.
Each AC: PASS/FAIL/RED/PENDING + reasoning. Review: FAIL(cause)/RED(cause), uncovered without
justification: FAIL(evidence); bb-verdict owns causes. Findings: What/Why/Fix + success check.
