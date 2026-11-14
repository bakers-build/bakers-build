# Search prior art

Call `bakers_ticket_search` ([tools](tools.md)) for at least two spellings of the domain noun.
Search covers title/description, newest first, at most 50 rows. A full window needs a narrower
noun. A failed call proves nothing: repair and retry. Prove **every empty search** with
`query: "ticket"` returning a row before judging candidates, even if another spelling matched.

Drop only this ticket's own row. Read remaining candidates with `bakers_ticket_read` `newest: 0`.
Use title/description/state and `comment_facets`; fetch newest qualification via
`bakers_comment_read` only when the ask remains unclear. A common noun alone is no hit. Sibling wording can differ. Return evidence to caller,
which owns the hit decision and stop.
