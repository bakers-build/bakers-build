---
name: publish-origin-status
description: Best-effort mirror a bakers.build ticket's customer-facing origin label to its origin issue, from the project's configured state-to-label map.
inputs:
  origin_labels.data:
    description: >-
      The project's customer-facing origin label map, one `<key>: <label>` per line. A key is a
      bakers.build state (`coding`) or a state qualified by its workflow (`bb_verification:done`), and the
      qualified key wins over the bare one. The set of VALUES is the label family bakers.build owns on the
      origin issue — exactly one of them is present at a time and the others are removed, so a label
      outside the map is never touched. Empty means no origin label is ever written. The default below
      is the recommended chain; override it only when your customer's vocabulary differs.
    default: |
      qualification: doing
      spec: doing
      coding: doing
      review: doing
      done: review
---

# Publish origin status

Accept the destination from the caller. **Empty origin is a no-op.** Look up the caller-supplied destination in `origin_labels.data`; require caller authorization.

## Resolve the label

`origin_labels.data` is a map of `<key>: <label>` lines; ignore blank lines and `#` comments. Read the
ticket's own `workflow` from the complete retained context. Take explicit `destination` from
the caller, then:

```
label  = origin_labels["<workflow>:<destination>"] ?? origin_labels["<destination>"]
family = the unique VALUES of origin_labels
remove = family minus label
```

The qualified key wins; the bare key is the fallback. Remove only `family minus label`;
all labels outside the current map survive. `@bakers-build/workflow-step` owns ordering and compensation
when the following state write fails or is uncertain.

## Write it

For a GitLab issue URL, one call:

```bash
glab issue update "$origin" --label "$label" --unlabel "$remove"
```

**No-op when `origin` is empty, when `origin_labels.data` is empty, or when the lookup finds no label** —
a state the project maps to nothing writes nothing and removes nothing. Pass a comma-separated
`remove` list; a label may therefore not contain a comma.

Unknown adapters and failures warn and return success so ticket work is not blocked.
Never choose the label, timing, or ticket state — the map is this input's value (its default here, or
the project's override under this skill's bullet in its `WORKFLOW.md`), and the state is the caller's.

## Configure an override

Only for a different project vocabulary, add this at indent 0 under `WORKFLOW.md` → `Loaded skills`:

```yaml
- @bakers-build/publish-origin-status
    origin_labels.data: |
      qualification: doing
      spec: doing
      coding: doing
      review: doing
      done: review
```

Edit the values; the input definition above owns matching and label preservation.
