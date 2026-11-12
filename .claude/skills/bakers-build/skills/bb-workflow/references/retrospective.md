# Terminal retrospective

Before done/cancelled state writes, except deployment/verification, collect the optional answer
at the caller's existing decision. Order: **ask → metric → comment → state write**; transition can
retire write access. Rating never grants merge authorization or replaces required confirmation.

For done ask **How do you rate the work on this ticket?** Reuse an explicit answer for this close.
Offer these texts verbatim plus skip; accept only an explicit integer 1–5, never zero/default:

- 5 — Excellent: delivered what I wanted; nothing to correct.
- 4 — Good: minor corrections only; no rework.
- 3 — Flawed: usable, but it cost me effort it should not have.
- 2 — Poor: substantial rework, or pieces missing.
- 1 — Unusable: I would have been faster doing it myself.

Use a nonblocking host question or existing confirmation. Too few buttons: show the complete
scale in the body and accept free text. No available answer, skip/dismissal, unattended, or no
nonblocking facility: no rating/comment; continue the otherwise authorized close without waiting.
`BAKERS_ID` does not establish human presence. Required caller confirmations still block.

For score <= 3 ask **Which of these applied?** (multi-select, or show all keys for free text):

- coding_loops — Too many loops in coding.
- model_fit — A model unsuited to one of the steps.
- spec_quality — A spec that was too poor.
- review_information — Information missing for human review that had to be requested afterwards.
- other — Another cause, in the human's own words.

For score > 3 ask optional **Anything worth recording?**, default no, without another required
wait. Unanswered follow-up keeps the rating with causes: []. Only named causes trigger
[retrospective evidence](retrospective-evidence.md).

For cancelled ask only the reason before the cancellation decision, never a score.
When a rating or reason exists, read [persist retrospective](retrospective-write.md).
