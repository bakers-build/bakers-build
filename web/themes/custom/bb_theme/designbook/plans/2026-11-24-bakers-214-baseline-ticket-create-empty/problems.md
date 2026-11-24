# Execution problems — extract-reference

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-11-24T22:30:00Z | publish-capture | publish-capture | ticket-create-empty baseline 1440x900 | Published, but `reference validate` fails: subject package exceeds the 65536-byte limit (whole story root as subject). Screenshot and dump are valid. | None inside the sealed plan: narrowing the subject changes the capture block and needs a new revision. Recapture with a narrower subject (e.g. the `main` landmark) before a `design-verify` consumes it. |
