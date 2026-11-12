# Persist retrospective

Read only for an explicit rating or cancellation reason, after [collection](retrospective.md).
For a rating use [measurement](measurement.md) with the job_rating definition at
`../../bb-verdict/measurements/definitions/job-rating.json`; it owns namespace, bounds and label.
A measurement failure is reported but does not block an otherwise authorized close.

Publish one Markdown comment via [ticket writes](ticket-writes.md), type retro, without pipe tables:

```markdown
## Retrospective

Rating: <integer> — <selected level text verbatim>

causes: [<named stable keys>]

### <named key>
Human: <statement>
Evidence: <count/references or No direct measurement and reason>
```

Use only named cause blocks. No follow-up answer means causes: [], preserving explicit rating.
For cancellation replace Rating with `Cancelled — no rating.` and `Reason: <human reason>`;
write no metric. Add retro through `bakers_ticket_update` labels_add, preserving other labels.
No rating/reason means no write; absence is never encoded as zero.

Report exactly which metric/label/comment writes persisted on failure, then continue the authorized
close. Reconcile uncertain creates under ticket-writes before any retry.
