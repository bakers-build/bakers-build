---
name: diagnose-ticket
description: Establish a bug's cause and publish an evidence-backed diagnosis and regression plan in its ticket.
---

# Diagnose a ticket

Consume the complete current-step context under `@bakers-build/read-ticket`; refresh only on its triggers.
Read and apply `@bakers-build/method-context` › *Selecting the skill set*, then invoke the
selected diagnosis method with the existing tests, reported failure, and current ticket.

Publish the cause and observed evidence as `debug_diagnose` and the complete regression plan as
`test` through `@bakers-build/publish-comment`. The plan separates applicable project checks from the
functional regression and records the check type, rationale, command/path, expected RED and GREEN,
and evidence it will report. Use the approved seams and reuse suitable coverage. Record a real
RED observation before a fix. A selected browser path uses `@bakers-build/scenario` and its browser driver.

The owning diagnose step obtains one approval for the cause, fix direction, and verification plan
unless already approved. This helper implements no fix and owns no transition.
