# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-05T14:23:03.971Z | validate | validate | entities-bb-workspace-bb-workspace--full | `#storybook-root` stays empty (30 s wait, no error overlay; `storybook check` ok, no console errors). The story is empty by design: `designbook/entity-mapping/bb_workspace.bb_workspace.full.jsonata` emits no body because a workspace has no body fields. It renders no changed component; intake added it only because every entity story was taken into scope, so the render criterion cannot pass for it. | Retried once after the toggle-probe correction; a pass would need a new intake that drops this story from the validate scope. |
