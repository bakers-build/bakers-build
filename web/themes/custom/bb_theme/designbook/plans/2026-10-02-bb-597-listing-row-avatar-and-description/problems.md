# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-02T19:20:00Z | map-entity | map-entity--design-screen | view.projects.default / view.groups.default | `ctx:image-fields` requires an image as an ImageNode in a slot; a `list` item carries cells as data and has no slot, and the Drupal `bb_entity_avatar` formatter hands `person` a picture URL. The mappings therefore pass the image as the person cell's `picture` URL (local committed asset), not as an ImageNode. Task completed; the rule conflict is recorded, not resolved. | None inside the sealed plan: a slot on list items would contradict the list component's props-only contract. |
| 2026-10-02T19:20:00Z | validate | validate | projects scene | The `projects` scene's page subtitle still reads "2 projects" while the mapped listing now shows three rows (new sample project 4). The scene file is not a declared output of this plan. | None; needs a write-scene task in a follow-up intake. |
