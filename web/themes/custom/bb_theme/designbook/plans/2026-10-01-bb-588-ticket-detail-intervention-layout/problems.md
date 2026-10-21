# Execution problems — design-screen

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-01T20:20:00Z | write-scene | write-scene | intervention layout | `plan done` rejects the whole-file `scene-file` output on PRE-EXISTING sibling scenes, not on the new one: `ticket-create`, `ticket-create (empty)`, `ticket-create (rejected)`, `ticket-create (unresolved context)`, `ticket-cancel` and `run-detail` pass `with.overlay` as a single object, while the frozen `SceneRefNode.with` schema admits only a string or an array of SceneNodes ("with/overlay must be string, must be array, must match exactly one schema in oneOf"). The sealed plan fixes those siblings as byte-preserved, so no in-scope result can validate. | None possible inside the sealed plan. Abandoned in favour of a new intake/plan (2026-10-01-bb-588-ticket-detail-intervention-layout-with-overlay-normalisation) whose sealed scope adds the semantic-preserving normalisation of those six overlays to single-element arrays. |
| 2026-10-01T20:20:00Z | write-scene | write-scene | intervention layout cancel dialog | Same pre-existing schema mismatch as above; not attempted. | As above. |
