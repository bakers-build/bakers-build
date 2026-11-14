# Gates

A **gate** is a named human wait of this frame. Without a label a person passes every gate; a
`bb-label-<label>` skill names the gates its run passes on its own. Every other gate waits for a
person, in the session or, under `ticket-question`, through the ticket.

| Gate | State | A person… |
|---|---|---|
| `qualification` | qualification | approves the acceptance criteria |
| `prior-art` | qualification, working | decides on a prior-art hit: build anyway, fold or drop |
| `agent-choice` | qualification | confirms a proposed agent label |
| `plan` (bug: `diagnosis`) | plan | approves spec, plan and test, or the diagnosis |
| `coding` | working | confirms the coding summary and MR, and the destination |
| `result` | working | sees the result at one URL (preview link, else MR) and accepts it |
| `criterion` | any | decides a criterion the run cannot decide |
| `verdict` | review | confirms the review verdict |
| `merge` | review | authorizes the merge |

## Gate sets

| Type | Gates |
|---|---|
| feature, chore | qualification, prior-art, agent-choice, plan, coding, criterion, verdict, merge |
| bug | the same, `diagnosis` for `plan` |
| deployment | qualification, plan (release and version), coding, merge |
| verification | qualification, plan (the verified set), coding |

A recipe's `## bb-gates` holds one `| <type> | <gates> |` row per declared type. For a type above
it writes `default`, or `default` plus added gates; it removes none. For its own type the row lists
every gate; a missing row fails the *Stop rule*. A recipe gate reads "a person confirms <what> in
<state>/<phase>" and is named `<recipe>:<gate>`; only `auto` passes it on its own.

## Risk list

A change to a dependency, the data model, a public interface, authentication, permissions, or
build, CI or deployment configuration. An **unplanned** risky change, one the plan does not name, is
a technical problem under every label: report it and end the run.

## Record

Each `coding`, `review` and `summary` handoff carries `### Gates`, one line per gate passed or
rejected since the last handoff; omit the heading when there is none:

```markdown
### Gates

- plan: passed — by run (auto-review) — recommendation approve, followed yes
- verdict: rejected — by <person> (comment <id>) — recommendation OK, followed no (<reason>)
```

A person's decision is their own ticket comment, or their answer in the session recorded by the
run; cite it.
