# Daily evidence

## Observe

Reuse the main skill’s report; fetch details only for specific gaps. Process every requested
civil date chronologically, including empty dates. Local midnights handle DST; schedule
expectations remain unchanged.

Historical `owner_user_id` determines run eligibility, independently of current assignments.
Deduplicate UUIDs within each date. Include crossing runs, clipping display intervals to
that date; retain full known duration for warnings. Merge overlapping/touching intervals.
Open ends and later overlap remain unknown; heartbeat, modification time and now supply
no endpoint. Missing context, invalid timestamps or incomplete reads are gaps, never zeros;
`observed_run_count` is a lower bound. Activities add context, not runs or employee hours.

Four complete tables cover every date, checkpoint and variant: timeline (count, states,
endpoints, clusters, gaps, ticket counts/intervals); dated baseline samples; seven flags;
capacity. Carry known facts into variants; mark unavailable facts unknown.

## Compare

Show actual dates/counts for the same weekday 7/14/21/28 days earlier, applying identical
eligibility rules. Verified emptiness counts as zero; unavailable history is missing.
Report usable samples out of four, their median and available duration/span context.
Fewer than four means limited comparison; none means no personal baseline.

Each flag gets its own rule, observed value and triggered/not-triggered/unknown status:

| Flag | Rule |
|---|---|
| Unusual count | Count <half or >twice median; positive count exceeds zero median. |
| Long gap | Fully observed interior gap >2h. |
| Long run | Complete unclipped duration >4h. |
| Evening | Observed interval inside this date after 20:00 local. |
| Night | Observed interval inside this date during 22:00–06:00 local. |
| No runs | Complete evidence establishes zero eligible runs. |
| Weekend | Saturday/Sunday with eligible runs. |

Fixed warnings apply without history; unknown overlap stays unknown.

## Suggest and confirm

Use supplied total, otherwise schedule as an unconfirmed planning total; preserve absences.
Suggest ticket/project minutes with supporting activity/summary context and assumptions.
Counts, runtime and schedule alone justify no shares. Missing total means unknown minutes;
unsupported time stays unallocated. Suggestions remain separate from confirmed rows.

End interactive output with the actual consolidated question covering evidence, schedule, flags, suggested allocation
and remainder; include old/new totals and correction intent for reviewed weeks. Stop until
answered before advancing. Without an answer channel, report unconfirmed fallback only.

The answer replaces estimates, not adds hours. Deduplicate existing time by stable source
identity; preserve exact durations, corrections and absences. Conflicts stay unresolved.
Only supplied/confirmed allocations reach publication under the main skill’s contract.

## Reconcile

Show capacity before the question and refresh after each answer/correction:

Date; schedule; recorded; existing proposed; new proposed; target (confirmed/fallback/unknown);
unallocated; remaining/excess; cap excess. Use explicit zeros/unknowns/not-configured.
Absent cap means not-configured, independently of run gaps.

Unallocated = target minus attributed employee time, excluding tentative shares.
Combined time = recorded + existing proposed + new proposed. Schedule remainder is separate from unallocated target;
cap excess is a warning, never truncation.

Close with full-week schedule, recorded/proposed totals and remaining/excess, including
existing records outside a partial requested range. Add new rows only inside the range.
