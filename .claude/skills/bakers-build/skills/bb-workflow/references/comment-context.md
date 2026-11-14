# Load comment context

`comment_facets` indexes readable comments by type and author, with count and newest time.
The state's first `bakers_ticket_read` passes its `types` set and `newest: 1`:

| State | First read |
|---|---|
| qualification | `ticket` only |
| plan | `{types: [qualification], newest: 1}` |
| working | `{types: [qualification, spec, plan, test, acceptance, review], newest: 1}` |
| review | `{types: [qualification, spec, plan, test, acceptance, coding], newest: 1}`; fetch every acceptance when count exceeds 1 |

Served `bakers_ticket_read` without `types`: read `ticket` alone, then the same set with
`bakers_comment_read` `{type: [...], newest: 1}`, skipping types absent from facets or already held.
(shortcut: remove once production serves `types`.)

Fetch further comments with `bakers_comment_read` by type or ids, including amendments or comments
newer than the last handoff per facets. Recover complete needed bodies before decisions; filters never
discard confirmed scope.
