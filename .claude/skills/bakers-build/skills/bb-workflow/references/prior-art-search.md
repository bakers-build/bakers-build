# Search prior art

Call `bakers_ticket_search` ([tools](tools.md)) once per spelling of the domain noun, at least two
spellings. Each `query` matches title and description alike and returns at most 50 rows, newest
first.

- **An error is not a negative.** A call that fails never searched anything, so it says nothing
  about what exists; fix it and run it again rather than reading it as absence.
- **A well-formed search with the wrong noun returns zero rows and no error.** That is the failure
  that matters here, so when a search comes back **empty**, prove the call first with
  `query: "ticket"`, which must return a row. A non-empty result is its own probe; run this only
  for an empty one. Sibling work rarely uses this ticket's words.

A returned row is a **candidate**, not yet a hit: a common noun matches widely, and only a ticket
carrying **this ask** is a hit. **A ticket is never its own prior art** — where this run already has
a ticket of its own, drop that ticket's row before judging the rest, or the search reports the very
ticket it was run for and stops the run for nothing. Drop that one row and no other: a row is never
dropped for carrying this ask, which is the very thing that makes it a hit. Read each candidate
before deciding, and when a search fills the whole 50-row window, narrow the noun rather than
trusting whatever the sort left on top.

