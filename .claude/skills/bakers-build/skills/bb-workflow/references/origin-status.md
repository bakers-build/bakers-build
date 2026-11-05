
# Publish origin status

Read at a state's `transition`, before the state write. Accept the destination from the caller and
require caller authorization.

## The map

The project's `WORKFLOW.md` › `## bb-phase-transition` holds the only map, one table:

```markdown
| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
```

A row maps a bakers.build state to the customer-facing label on the origin issue. The set of labels
in the table is the family bakers.build owns there: exactly one of them is present at a time and
the others are removed, so a label outside the table is never touched.

## Resolve the label

```
label  = the row whose State is the destination
family = the unique labels of the table
remove = family minus label
```

## Match existing labels

bakers.build never creates a label in the Git project; it writes only labels the project already
has. For a GitLab issue URL `https://<host>/<path>/-/issues/<n>`, read the project's labels,
inherited group labels included, in one call, with `<path>` URL-encoded (`acme/shop` →
`acme%2Fshop`):

```bash
glab api --hostname "<host>" --paginate "projects/<encoded path>/labels?include_ancestor_groups=true&per_page=100"
```

Replace `label` and each name in `remove` with the listed `name` that equals it ignoring case
(`doing` → `Doing`). A name with no match is left out of the call, and the run warns naming it. If
`label` is left out, the call carries only `--unlabel`; if nothing is left, there is no call. If the
read fails, write nothing and warn.

## Write it

For a GitLab issue URL, one call with the matched names:

```bash
glab issue update "$origin" --label "$label" --unlabel "$remove"
```

**No-op when `origin` is empty, when `WORKFLOW.md` has no such table, or when the destination has no
row** — a state the project maps to nothing writes nothing and removes nothing. No table is never
filled from a default. Pass a comma-separated `remove` list; a label may therefore not contain a
comma.

Unknown adapters and failures warn and return success so ticket work is not blocked. Never choose
the label, timing, or ticket state: the label is the table's, the state is the caller's.
`@bakers-build/bb-workflow` owns ordering and compensation when the following state write fails or
is uncertain.
