# Handoff templates

## `qualification`

```markdown
## Outcome

<what the requester gets>

## Acceptance

- **AC1:** As a <role>, I want <behaviour>, so that <benefit>.

Gate: <n> criteria checked, <n> passed.

## Out of scope

- <boundary, or none with the reason>

## Handoff metadata

| Field | Value |
|---|---|
| `recipe` | `superpowers` |
| `ticket_type` | `feature`, `bug` or `chore` |
| `reproduction` | the bug's condition, else `not_required` |
| `scenario_required` | `true` for a browser path, else `false` |
| `test_as` | who tests and what each sees, or `no login needed` |
| `prior_art` | each spelling with its outcome, and the probe |
| `handoff_version` | `1` |
| `provenance` | title and description as read; approved by <name> (<identity>) in <conversation link, or the conversation> |
```

## `spec`

```markdown
## Intent

## Behaviour

## Acceptance criteria

<the qualification's AC IDs>

## Out of scope

## Decisions

- <decision>: <who made it>

## Code facts

- <fact>: `<file path>`

Approved by <name> (<identity>).
```
