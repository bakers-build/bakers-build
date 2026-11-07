# Execution problems - design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-05T10:35:00Z | write-component | write-component | board, empty-state, gate, onboarding | The `component-story` output is a data submission, so the CLI re-serialises the default stories and drops the comment lines of `board.default.story.yml` (5) and `empty-state.default.story.yml` (2) and re-wraps the long strings of `gate` and `onboarding`. | After the write, all four files were compared with the pre-run version as data (equal) and restored from HEAD with their comments and layout. Same Designbook defect as batches 1 and 3 (comments lost on data writes). |
| 2026-11-05T10:35:00Z | write-component | write-component | note | The first submission failed with `"component-story": data/slots/body must be array`: `note.default.story.yml` carried its body slot as a bare string, which the SdcStory schema does not admit. | Resubmitted with the same words as one `span` element node, the shape batch 3 used for `collapsible`. |
