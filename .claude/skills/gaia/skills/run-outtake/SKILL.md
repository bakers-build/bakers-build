---
name: run-outtake
description: Present what changed, what worked, what failed, and everything needed for manual review.
---

# Present the run

The reader switches between tickets. Explain what you did, what worked, what failed, then make
manual review immediately usable. Success stays brief; problems get enough detail to act.

## Input contract

Consume the caller's ticket, state and aggregated [result records](../method-context/references/results.md).
The rendered text has two destinations with identical content. The caller prints it
in full in the terminal and publishes it as the ticket's `summary`.
Publishing is not presenting. Any confirmation or destination question comes after
the printed outtake; a run that stops without a question prints it too.
No separate recap in another format. This helper writes no data. Render once after
all sub-works; other skills supply facts rather than overriding headings.

## Visible summary

For spec, coding and review, translate incoming facts into English. Use these stable headings in
order; extend their matching paragraphs. Omit empty optional sections.

### 🎯 Outcome

Name the ticket and explain what you did and why in one or two sentences. Distinguish delivered
work from proposals; include `OK` or `Not OK` for review.

### 📖 Spec digest

At spec only: write it under [spec digest](references/spec-digest.md).

### ✅ Success

Briefly separate **Automated checks** from **Agent inspection**, naming actual users where relevant.
Report executed or reused results as such. Created tests and checks not run are not passes.
Keep passed ACs in the typed handoff, not this summary.

### ⚠️ Problems

For failed, blocked or unresolved work, give AC IDs where applicable, expected versus observed
behavior, impact, evidence and required repair/decision. State unknown causes honestly. Distinguish
proposed fixes from completed ones. Include criterion rewrites when supplied.

### 🧪 Manual review

State what remains for the human, the intended account/role and environment. Agent inspection is
not human approval. Give short actions with expected observations and all related resources:
MR, running surfaces, designs, artifacts and runnable CLI commands with working directory/access.
Preserve every supplied actor/path, including denied actors. Name missing access instead of guessing.

Each link gets 🔗, a descriptive label and blank lines around it. Show each URL once. Use fenced
commands and short action subheadings with icons when needed. Apply `@gaia/essential-skills` for
local preview links and durable evidence. Ticket evidence uses verified absolute `https://` URLs;
local artifacts remain terminal conveniences. Never invent URLs or add pipeline URLs.

One-time login URLs are explicitly allowed in terminal and ticket. Preserve the issued URL
unchanged; label user, role and environment. Never substitute the default admin. The caller renews
expired links. Login URLs are temporary access instructions, separate from durable evidence.
Reuse the resolved MR from coding; from coding onward a missing MR is a run failure.

### ➡️ Next action

End with one concrete action or decision.

Apply `@gaia/method-context` › *Audience and register*. Complete evidence stays in the typed handoff;
summary-only domains retain it under `@gaia/workflow-step`'s explicit exception.
