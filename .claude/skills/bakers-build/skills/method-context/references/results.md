# Result records

Read when qualifying, planning or reporting checks, resolving access, or rendering a handoff.
Use these Markdown tables/records in existing qualification, test and coding/review comments;
there is no new entity or separate mapping artifact. Owners supply records; outtake renders once.

| Record | Required fields |
|---|---|
| `review_actors` | `actor`, `role`, `account` or confirmed selection rule, `environment`, `source`, `status`: `confirmed`, `unresolved`, `not_required` |
| `checks` | `id`, `ac_ids`, `purpose`: `project` or `functional`, `mode`: `automated`, `agent`, `human`; `actor`, `environment`, `rationale`, `command_or_steps`, `expected`, `coverage`: `permanent` or `one_off` |
| `results` | `check_id`, `status`: `passed`, `failed`, `blocked`, `not_run`, `reused`; `actual_actor`, `environment`, `observed`, `revision`, `evidence` |
| `deliverables` | `label`, `url_or_command`, applicable `cwd` and `access` |
| `manual_review` | checks requested from the human, `pending` or `completed`, human observation when completed |

## Qualification and access

Read existing ticket decisions, project setup and fixture/account declarations first. Ask only for
missing choices: target environment, intended role/account, expected permissions, and required
denied or anonymous cases. Record the answer and its source. On unattended runs preserve missing
choices as `unresolved`; never select a convenient administrator. Non-account checks use
`not_required` with a reason.

A confirmed selection rule may precede provisioning. It is not a resolved account. Before an
actor-dependent check or working login instruction, `@bakers-build/resolve-environment` must verify the
concrete account, role, target environment and access. Return unresolved actors with their reason
and retain their paths. Expired access can be renewed for the same identity. Re-resolve identities
after reprovisioning; preserve original identities in historical evidence.

## Execution and coverage

`automated` means a repeatable suite or command; `agent` means agent-performed inspection;
`human` means the human reviewer performed the steps. These modes are independent of purpose.
An authored test is coverage, not an executed result: use `not_run` until observed. An agent walk
does not complete human review. Only an attributed human observation changes `manual_review` to
`completed`.

`reused` retains the original outcome, actor, environment, revision, evidence and scope, with its
reuse reason; it does not claim a fresh execution. Failed/blocked/not-run checks cannot establish
PASS. A missing required check blocks its AC. A pending human invitation alone does not fail an
AC already established by other confirmed evidence, unless the plan requires human acceptance.

Retain complete acceptance evidence. Record each AC's PASS/FAIL/RED/PENDING and concise reasoning with complete durable evidence in the
typed handoff. A bare verdict is a defect. Review uses `FAIL(<cause>)` or `RED(<cause>)` at the result position.
An uncovered criterion without justification is `FAIL(evidence)`. `@bakers-build/review-ticket` › *The verdict*
owns the cause set. Retain each finding's **What / Why / Fix** and success check. Keep all related resources
available to manual review without repeating passing ACs or full logs in the visible summary.
