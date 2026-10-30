# @bakers-build/addon-track

Read personal evidence for time preparation through the existing bakers.build connection:

```sh
bakers track evidence --from 2026-10-12 --to 2026-10-18
```

Use `--timezone Europe/Berlin` to override the employee profile timezone, and
`--connection <id>` or `--config <path>` to select the connection. The authenticated
employee is the only selectable owner. Dates are inclusive, at most 366 per call.
A missing profile timezone requires an explicit timezone.

The command prints JSON with chronological `days`, four same-weekday `baseline`
observations per day, `weeks`, existing `worklogs`, and shared `tickets`/`projects`
context. Runs retain their full endpoints and known duration; clusters are clipped
to each local date. Civil days may span 23 or 25 hours. Recorded totals include
approved time; proposals remain separate. Whole-week totals include existing records
outside a partial requested range. Schedule/cap values are seconds; missing values
are unknown. No target, allocation or new time entry is inferred.

Run selection uses `owner_user_id`, captured from the conductor at claim time.
Later ticket reassignment or conductor ownership changes do not rewrite history.
Activities add events from this actor or this actor's runs; they are not additional
runs or employee time. Linked summary excerpts are limited to 2,000 characters,
with the comment ID and a truncation flag for a deliberate follow-up read.

Three paginated reads cover runs (including four weeks of history), target
activities and whole-week worklogs. The first two use JSON:API; worklogs use
the MCP tool `tool_api__bakers_worklog_list` on the site's `/mcp` endpoint
(`@dropsh/plugin-tool`, same auth profile), called with `from`/`to`
(YYYY-MM-DD, complete weeks around the selection, at most 378 dates), `limit` 50
and `offset` until its `next_offset` is null. This employee-only tool is provided
by `bb_track` and must be deployed with this addon; it accepts no owner selector
and returns the referenced `tickets`/`projects` plus an `omitted` flag.
Generic JSON:API deliberately hides worklog ownership and may include led-team
records, so it cannot safely supply personal totals. Sparse includes retrieve ticket/project context
without per-ticket requests. Historical runs are reduced to daily counts and known
span/duration context in the output. No run logs are fetched. The existing core
connection supplies authentication, request hooks and backend access checks.

`complete: false` and `evidence_gaps` disclose omitted resources, missing context and
unknown timestamps. A null `run_count` is unknown, not zero; `observed_run_count` is
only a lower bound. Unknown ends stay null and cannot prove activity on later dates.
Gaps are reported only for complete known intervals. Null worklog totals likewise do
not mean zero. A failed required request or malformed page exits unsuccessfully
without emitting a partial success report. Reads are not a transactional snapshot;
activity occurring during pagination may require a fresh report.

The `prepare-time` skill consumes the report, explains anomalies, asks the employee
about each day and prepares only confirmed/attributable proposal rows. This addon
reads evidence only: it never starts a timer, creates a Submission or books time.
