---
name: bb-prepare-time
description: Use when preparing employee time proposals from supplied activities or authorized work history for unbooked Submission review.
---

# Prepare time

Deliver an unbooked proposal and its canonical Submission UI link. The employee
refines entries and chooses Save there; this skill stops before booking/submitting.

## Resolve sources

Resolve employee, inclusive civil-date range, timezone and bakers.build connection; ask for
missing values. Verify authentication as that employee. Run ownership selects
evidence, not employee work attribution or additional access.

Load `bakers track evidence --from YYYY-MM-DD --to YYYY-MM-DD --timezone <timezone>`
once on that connection. Reuse its schedule/cap, daily runs, activities, ticket/project
context, baseline and recorded/proposed weekly totals. Supplied activities supplement
this report; fetch details only to resolve a specific gap. Failed reads and null values
remain unknown. Resolve permitted projects, same-project tickets and their billing account.
Time-entry permission is independent of ticket assignment; verify it rather than infer it.

## Suggest, confirm, reconcile

Read and follow [daily evidence](references/daily-evidence.md) for every date, including
empty dates: evidence and flags, a tentative allocation, one consolidated question,
then reconciliation and a complete daily capacity row. Close with weekly totals.

Use the schedule as an explicitly unconfirmed planning total when no total was supplied.
Suggest ticket/project shares from activity and ticket context, explaining each estimate;
run duration is not employee time. Keep unsupported shares unallocated. Present the
suggestion before asking the employee to confirm or correct the day.

Publish only supplied or employee-confirmed allocations as positive whole-minute rows,
each with date, description, permitted assignment and stable source identity.
Preserve absences, corrections and source identities; subtract time already represented
in bookings/proposals. Unconfirmed suggestions stay in the report. If no resolved rows
remain, return the report without an empty Submission or review link.

## Publish and link

Use employee authentication. Publish every resolved row in **one** `bakers_time_propose` call
([tools](../bb-workflow/references/tools.md)): `entries`, each with `source_system`, `source_key`,
`source_version`, `work_date`, `description`, `duration_seconds` and its `project`, `ticket` or
`account` where resolved. The result is a new proposed Submission and one Worklog per entry;
proposed time is unbooked. A failing entry stores nothing and the message names it by position and
`source_key`: correct that row and call again. An unknown tool means the server cannot take
proposals: return the proposal in chat, make no writes, never book directly. After a timeout or
lost response, reconcile with the readback below before any second call.

Verify through `bakers_worklog_list` over the date range: the rows whose `submission_id` is the
returned `submission` match the entry count and totals, each in state `proposed`. An empty page proves
nothing; follow `next_offset` to the end.

Review URL: `/time/submission/{uuid}` on the selected public origin, with the returned
`submission`; verify employee access. Local URLs follow [preview links](../bb-workflow/references/preview-links.md).

Return the link, entry count, totals, per-week capacity/remaining/excess and
unresolved assignments:
**Proposal prepared, not booked. Refine entries and choose Save time in the UI.**
