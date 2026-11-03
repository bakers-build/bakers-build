# Handoff templates

Fill every field from the conversation; `<…>` marks a value.

## `qualification`

```markdown
## Outcome

<what the requester gets, in one paragraph>

## Acceptance

- **AC1:** As a <role>, I want <behaviour>, so that <benefit>.

Gate: <n> criteria checked, <n> passed.

## Out of scope

- <each boundary, or none with the reason>

## Handoff metadata

| Field | Value |
|---|---|
| `recipe` | `superpowers`: specified with the requester |
| `ticket_type` | `feature`, `bug` or `chore` |
| `reproduction` | the bug's reproducible condition, otherwise `not_required` |
| `scenario_required` | `true` when the behaviour needs a browser path, otherwise `false` |
| `test_as` | who tests and what each should see, or `no login needed` |
| `prior_art` | each searched spelling and its outcome (`negative` or `error`), and the probe |
| `handoff_version` | `1` |
| `provenance` | title and description as read; approved by <name> (<identity>) in <the conversation link, or the conversation> |
```

## `spec`

```markdown
## Intent

## Behaviour

## Acceptance criteria

<the AC IDs of the qualification>

## Out of scope

## Decisions

- <decision>: <who made it>

## Code facts

- <fact>: `<file path>`

Approved by <name> (<identity>).
```
