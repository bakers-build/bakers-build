# Search tickets with filters and facets

[`bakers_ticket_search`](/cli/tools#tools) takes `filters` and `facets` instead of `query` and `branch_name`; giving both kinds is refused. Without `project` it covers every project you can read. Rows, `total` and every count include only tickets you can read.

| Filter | Value | Matches |
|---|---|---|
| `conductor` | conductor UUIDs | tickets on any of them; an unknown or unreadable conductor is refused |
| `conductor_owner` | `"me"` | tickets on conductors you own |
| `state` | workflow state ids, e.g. `["plan", "review"]` | tickets in any of them |
| `attention` | any of `review`, `plan_ready`, `question` | tickets that need a person for that reason |
| `closed`, `frozen` | `true` or `false` | closed or open, frozen or not |

Every given filter must hold. An empty list or an unknown value is refused, never answered unfiltered.

A ticket's `attention` is one value, checked in this order: a closed ticket has none; `question` when it is frozen with the label Question (any letter case); `plan_ready` in state plan with a `plan` comment and no claimed or running run; `review` in state review; otherwise none.

`facets` lists any of `conductor`, `project`, `state` and `attention`. The response then adds `total`, every matching ticket beyond the 50 rows, and `facets`: per name, buckets `{value, label, count}`, most tickets first, then by label. `value` is the UUID for `conductor` and `project` and the id for `state` and `attention`. A `conductor` bucket adds `owner` and `machine`, each `{uuid, name}` or `null`. A ticket without a conductor or an attention forms no bucket.

"Needs me", the open tickets that need you on your conductors, per project and reason, across all projects in one call:

```json
{
  "filters": {"attention": ["review", "plan_ready", "question"], "conductor_owner": "me", "closed": false},
  "facets": ["project", "attention"]
}
```

```json
{
  "tickets": [{"identifier": "SHOP-42", "title": "…", "state": "review", "type": "feature", "branch_name": "…", "base_branch": "main", "parent": null}],
  "total": 3,
  "facets": {
    "project": [{"value": "<project uuid>", "label": "Shop", "count": 2}, {"value": "<project uuid>", "label": "Docs", "count": 1}],
    "attention": [{"value": "review", "label": "Review", "count": 2}, {"value": "plan_ready", "label": "Plan ready", "count": 1}]
  }
}
```
