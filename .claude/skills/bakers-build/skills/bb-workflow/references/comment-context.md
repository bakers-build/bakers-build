# Load comment context

`comment_facets` indexes readable comments by type and author, with count and newest time.
Use `bakers_comment_read`; skip types absent from facets or already held in the newest two.

| State | Filter |
|---|---|
| qualification | none |
| plan | `{type: [qualification], newest: 1}` |
| working | `{type: [qualification, spec, plan, test, acceptance, review], newest: 1}` |
| review | `{type: [qualification, spec, plan, test, acceptance, coding], newest: 1}`; fetch every acceptance when count exceeds 1 |

Fetch further comments a step needs by type or ids, including amendments or comments newer than the
last handoff. Recover complete needed bodies before decisions; filters never discard confirmed scope.
