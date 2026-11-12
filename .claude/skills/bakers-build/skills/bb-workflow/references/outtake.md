# Outtake

Read at every state's `outtake`. Apply [ticket writes](ticket-writes.md).

## Input contract

Render from the state's typed handoff and its [result records](results.md). **Show only what the
handoff contains**: a fact, link or value it lacks is absent or named as not recorded, never
inferred. The rendered text has two destinations with identical content: the caller prints it in
full in the terminal and publishes it as the ticket's `summary`. Any confirmation or destination
question comes after the printed outtake; a run that stops without a question prints it too.
Render once per state, in English; no separate recap in another format. The outtake writes no data.

## Skeleton

Use these headings in order and omit empty optional sections. The state section comes from
[qualification](outtake/qualification.md), [plan](outtake/plan.md), [working](outtake/working.md) or
[review](outtake/review.md), and says what fills each heading.

### 🎯 Outcome

Name the ticket and outcome. Distinguish delivered
work from proposals. A state's lead section follows directly.

### ✅ Success

Optional. Report executed or reused results as such; created tests and checks not run are not
passes.

### ⚠️ Problems

For failed, blocked or unresolved work, cite handoff AC/finding IDs, impact and required repair
or decision. Include not checked / risk lines.

### 🧪 Manual review

State what remains for the human, the intended persona and environment. Agent inspection is not
human approval. Give actions with expected observations and related resources: MR,
running surfaces, designs, artifacts and runnable CLI commands with working directory/access.
Preserve every supplied persona/path, including denied personas; name missing access instead of
guessing.

Apply [evidence and links](evidence.md) and [preview links](preview-links.md). One-time login URLs are
allowed in terminal and ticket: preserve each issued URL unchanged and label persona, role and
environment. Never substitute an administrator. Login URLs are access, not durable evidence. From
working onward a missing MR is a run failure.

**Recipe slot.** The recipe's `bb-phase-outtake` slot for this state and type adds its lines here,
at the end of *Manual review*, directly before *Next action*, under no heading of its own. The type
slot replaces the general slot; no slot adds nothing. A value the slot asks for that the handoff
lacks is shown as not recorded.

### ➡️ Next action

End with one concrete action or decision.

