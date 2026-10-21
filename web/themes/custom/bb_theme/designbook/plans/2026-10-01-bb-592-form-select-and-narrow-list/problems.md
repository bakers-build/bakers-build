# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-01T23:55:00Z | write-component | write-component | form_select | `plan done` rejects the result: `output "component-yml": data/group must be equal to one of the allowed values`. The frozen `SdcComponent` schema allows only Action, Data Display, Navigation, Layout, Shell, but this theme's contract (data-display-components.sh B8a/B8b, `FORM_COMPONENTS`) requires form controls in group `Form`, like form_input/form_label/form_textarea. A non-Form group would break that contract and the story address. | None inside the sealed plan; not hand-written. Needs the Designbook SdcComponent group enum to admit `Form` (designbook skill source), then a new intake. Draft files are in assets-ai/BB-592/debo/out/form_select/. |
| 2026-10-01T23:55:00Z | refresh-components | refresh-components | refresh | The sealed `story_ids` include `bakers-theme-form-select--default`, which cannot exist until form_select is written. | None; pending. |
| 2026-10-01T23:55:00Z | write-scene | write-scene | ticket-list, project-runs-list | The Sort by depiction composes `bb_theme:form_select`, which does not exist (blocked above). | None; pending. |
| 2026-10-01T23:55:00Z | validate | validate | form_select, ticket-list, project-runs-list | Depend on the blocked tasks above. | None; pending. The list right-region fix was verified separately (assets-ai/BB-592/node/validate-list-narrow.txt). |
