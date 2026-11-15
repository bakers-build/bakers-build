---
name: bb-label-human-accept
description: "Use when a ticket labelled `human-accept` runs, in any state: carry it to done on your own once a person accepts the result; a planned risky change also needs the assignee's or a reviewer's verdict."
---

# Human accept

Apply the [label rules](../bb-workflow/references/gates.md#label-rules) first.

The label `human-accept` passes every [gate](../bb-workflow/references/gates.md) on its own except
`result`, `criterion`, recipe gates (`<recipe>:<gate>`) and, when a planned change touches the
[risk list](../bb-workflow/references/gates.md#risk-list), `verdict`. It authorizes every
transition, its origin status and, once `result` and any due `verdict` are passed, the merge.
Decide technical questions yourself and record each decision with its reason under `Decisions` in
the handoff.

A `criterion` stops with a question for the [confirming person](../bb-workflow/references/gates.md#label-rules). An unplanned risky change
ends the run as a technical problem.

| State | The run |
|---|---|
| qualification | approves the criteria and transitions to `plan` |
| plan | approves its spec, plan and test, or the diagnosis; records under `Decisions` whether the plan touches the risk list and which items; transitions to `working` |
| working | at a GREEN [coding gate](../bb-workflow/references/coding-gate.md) asks for the **acceptance**, then transitions to `review` once it is given |
| review | publishes the verdict; `Not OK` that coding can fix transitions to `working`; `OK` merges, except with a planned risky change: then it stops until the confirming person confirms the verdict |

The **acceptance** is one question for a non-technical reader: only what changed and how to try it
at exactly one URL, the tunnel link from [preview links](../bb-workflow/references/preview-links.md)
or, if nothing runs, the merge request. An explicit acceptance in a comment newer than the question
passes `result`; work requested changes and ask again.
