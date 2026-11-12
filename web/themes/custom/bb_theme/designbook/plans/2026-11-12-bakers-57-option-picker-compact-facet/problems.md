# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-12T04:10:00Z | validate | validate | bb-theme-action-option-picker--selected-chips (twice) | The task list derived one story id per story file, and `option_picker.selected_chips.empty.story.yml` yielded a second `selected-chips`; the two identically titled tasks are ambiguous for `plan done --title`. | None inside the sealed plan. The story was checked directly: `storybook check` on bb-theme-action-option-picker--selected-chips returned {"ok":true,"stale":false,"console_errors":[],"missing_fonts":[]}. |
