## Terminal retrospective

When the destination is `done` or `cancelled`, apply this gate before the state write, except for
a ticket of type `deployment` or `verification`: one bundles other tickets, the other evaluates an
environment, and neither receives a job rating. A nonterminal transition follows the state-write section directly.

**Ask → metric → comment → state write is mandatory.** A transition retires the run and can
remove its write scope. Resolve the retrospective before issuing the update below.

### Collect at the caller's existing decision

Read this section before taking a terminal decision. For `done`, fold the optional rating into
the confirmation the caller already takes; reuse an answer already supplied for this close.
For `cancelled`, ask for the reason before the cancellation decision, without requesting a score.
A rating never supplies merge authorization or replaces the caller's lifecycle gates.

There is no environment test for human presence: `BB_ID` is also set in supervised runs.
Use the host's available, non-blocking question facility or the existing confirmation interaction.
If no answer is available (including dismissal, skip, an unattended interaction, or an already
authorized close with no rating), proceed with **no rating, no comment**, and the authorized
transition unchanged. Do not wait for a new answer or end the turn with a decided transition
pending. If the host cannot collect an optional answer without blocking, omit that question.
This never bypasses a caller's unanswered required confirmation.

Ask: **How do you rate the work on this ticket?** Offer these texts verbatim, plus skip;
accept only an explicit integer 1–5, never an inferred score, a default selection, or zero:

- 5 — Excellent: delivered what I wanted; nothing to correct.
- 4 — Good: minor corrections only; no rework.
- 3 — Flawed: usable, but it cost me effort it should not have.
- 2 — Poor: substantial rework, or pieces missing.
- 1 — Unusable: I would have been faster doing it myself.

If the host limits the number of choice buttons, put **all five level texts in the question
body** and accept the number through its free-text entry. Buttons may offer shortcuts (for
example 5, 4, a lower rating, and skip); they must not truncate the visible scale. A cause
multi-select with too few buttons similarly uses one free-text answer against the complete list.

At **score <= 3**, offer one multi-select: **Which of these applied?**

- `coding_loops` — Too many loops in coding.
- `model_fit` — A model unsuited to one of the steps.
- `spec_quality` — A spec that was too poor.
- `review_information` — Information missing for the human review that had to be requested afterwards.
- `other` — Another cause, in the human's own words.

If the host has no multi-select, show this list in one free-text question and accept several keys
plus the free entry. At **score > 3**, ask only **Anything worth recording?** with default **no**;
this is optional and introduces no extra required click or wait. An unanswered follow-up preserves
the explicit rating and produces its comment with `causes: []`; it does not invent an investigation.

### Pair only named causes with evidence

Read the ticket's record only for causes the human actually names. Use its related `bb_run`
entities, relevant handoff comments, its `recipe`, and `agent:*` labels. There is no queryable
transition history: tickets are not revisionable. The countable fields are `state_at_start` and
`agent` on each run. Read every related run before reporting an exact count; a partial or denied
read is unavailable evidence, not zero.

- For `coding_loops`, count runs whose `state_at_start` is `working`. Call this the working-run
  count, not a proven count of review bounces; retries can also create runs. Compare relevant
  coding/review handoffs when judging rework.
- For `model_fit`, pair the named step's `state_at_start` with the `agent` that actually ran.
  Routing labels express intent; they do not prove execution or model suitability.
- For `spec_quality` and `review_information`, compare the applicable spec/plan/test or review
  handoff with the human's account. Quote or link the relevant omission/correction; state
  **No direct measurement** when the record cannot quantify it.
- For `other`, report an observable counterpart only if one exists, otherwise **No direct
  measurement**. Keep the human's statement separate from the agent's inference.

Print each statement immediately above its counted fact or evidence limitation. A good rating
without named causes incurs no retrospective evidence queries. Copy no general footprint report.

### Persist the answer

For an explicit rating, use the `job_rating` definition at
`../../bb-verdict/measurements/definitions/job-rating.json` and invoke [measurement](measurement.md)
with `score`. Its namespace is `job_rating`; its **label_term is `retro`**. Ensure that label exists
in the ticket's workspace before the measurement write: search `bb_term/bb_labels` by name, create
it only when absent and authorized with explicit `workspace_id` and the `bb_labels` vocabulary, then
preserve existing ticket labels on update. A failed write is reported as a retrospective write
failure; it must not block or fail an otherwise authorized close. Never invent a score or silently
claim a failed write succeeded.

Publish **one** comment through [publish comment](publish-comment.md), type `retro`, Markdown in
`bb_rich`, whenever a rating or a cancellation reason was supplied. Use this shape without pipe
tables:

```markdown
## Retrospective

Rating: 3 — Flawed: usable, but it cost me effort it should not have.

causes: [coding_loops, other]

### coding_loops
Human: <statement>
Evidence: <coding-run count and supporting run references, or explicit limitation>

### other
Human: <free entry>
Evidence: No direct measurement — <why, or the actual observable counterpart>.
```

Use the selected level text verbatim, the stable cause keys above, and only blocks actually named.
For a good rating with nothing to add, write the rating and `causes: []`. For cancellation replace
the rating line with `Cancelled — no rating.` and `Reason: <human's reason>`; write **no metric row**.
Attach the `retro` label to a reason-only cancellation too, preserving existing labels.
If a metric, label, or comment write fails, report exactly which part was persisted before
continuing; reconcile an uncertain create response rather than creating a duplicate comment.
An unrated ticket remains complete and valid; missing data is never encoded as zero.

