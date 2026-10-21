# Search prior art

Search the domain noun in at least two spellings, using both filters for each (four calls minimum).

```bash
bakers dropsh --format md search bb_ticket --bundle bb_ticket \
  --filter 'title:CONTAINS:<domain-noun>' --sort -created --limit 20
bakers dropsh --format md search bb_ticket --bundle bb_ticket \
  --filter 'description.value:CONTAINS:<domain-noun>' --sort -created --limit 20
```

Four facts the form depends on:

- **A rich-text field filters on `<field>.value`**, never on the bare field name. `description`
  alone is rejected with HTTP 400 naming `value`, `format`, `processed`.
- **`--filter` is `key:value` or `key:op:value`** — `key=value` is refused with `E_VALIDATION` —
  and `search` needs `--bundle` or it 404s into an HTML error page.
- **An error is not a negative.** A call that comes back `E_AUTH`, `E_VALIDATION` or an HTTP status
  never searched anything, so it says nothing about what exists; fix it and run it again rather than
  reading it as absence. **No profile is named on these calls**, and that is this branch's rule
  rather than an omission: the connection was collapsed onto one identity, so the default
  profile is the one that answers, and naming a retired `pm` or `session` profile produces exactly
  the `E_AUTH` this bullet warns about being misread as absence.
- **A well-formed search with the wrong noun returns zero rows and no error.** That is the failure
  that matters here, so when a search comes back **empty**, prove the query first:

  ```bash
  bakers dropsh --format md search bb_ticket --bundle bb_ticket \
    --filter 'title:CONTAINS:ticket' --limit 1    # must return a row
  ```

  A non-empty result is its own probe; run this only for an empty one. Use at least two
  spellings of the noun — sibling work rarely uses this ticket's words.

A returned row is a **candidate**, not yet a hit: a common noun matches widely, and only a ticket
carrying **this ask** is a hit. **A ticket is never its own prior art** — where this run already has
a ticket of its own, drop that ticket's row before judging the rest, or the search reports the very
ticket it was run for and stops the run for nothing. Drop that one row and no other: a row is never
dropped for carrying this ask, which is the very thing that makes it a hit. Read each candidate
before deciding, and when a search fills the whole 20-row window, narrow the noun rather than
trusting whatever the sort left on top.

