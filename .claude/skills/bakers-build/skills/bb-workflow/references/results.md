# Result records

Read when qualifying, planning or reporting checks, resolving access, or rendering a handoff.
Use these records in qualification, test and coding/review comments; outtake cites them.

| Record | Required fields |
|---|---|
| `test_as` | one line per persona: `persona`, what it should see (or `denied`); or `no login needed` |
| `checks` | `id`, `ac_ids`, `purpose`: `project` or `functional`, `mode`: `automated`, `agent`, `human`; `persona`, `environment`, `rationale`, `command_or_steps`, `expected`, `coverage`: `permanent` or `one_off` |
| `results` | `check_id`, `status`: `passed`, `failed`, `blocked`, `not_run`, `reused`; `persona`, `environment`, `observed`, `revision`, `evidence` |
| `deliverables` | `label`, `url_or_command`, applicable `cwd` and `access` |
| `manual_review` | checks requested from the human, `pending` or `completed`, human observation when completed |

## Test as

Personas come from the project's test-user list, which the `WORKFLOW.md` `bb-phase-outtake` hint
names; include `anonymous` and denied personas when the criteria need them. A change without a web
surface records `no login needed`. Ask only when the right persona is unclear, and never pick an
administrator for convenience. A persona that does not exist on the environment stays in the list
marked **missing**; the run says so instead of testing as someone else.

## Execution and coverage

`automated` means a repeatable suite or command; `agent` means agent-performed inspection;
`human` means the human reviewer performed the steps. These modes are independent of purpose.
An authored test is coverage, not an executed result: use `not_run` until observed. An agent walk
does not complete human review. Only an attributed human observation changes `manual_review` to
`completed`.

`reused` retains the original outcome, persona, environment, revision, evidence and scope, with its
reuse reason; it does not claim a fresh execution. Failed/blocked/not-run checks cannot establish
PASS. A missing required check blocks its AC. A pending human invitation alone does not fail an
AC already established by other confirmed evidence, unless the plan requires human acceptance.

Record each AC's PASS/FAIL/RED/PENDING and reasoning under [ticket writes](ticket-writes.md). A bare verdict is a defect. Review uses
`FAIL(<cause>)` or `RED(<cause>)` at the result position. An uncovered criterion without
justification is `FAIL(evidence)`. `@bakers-build/bb-verdict` › *The verdict* owns the cause set.
Retain each finding's **What / Why / Fix** and success check. Keep related resources available to manual review.
