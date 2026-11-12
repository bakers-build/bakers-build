# Establish acceptance

At qualification work adopt checkable seeded criteria from the handoff; at working read publish
an `acceptance` comment if absent for confirmed scope. This complete list is verification's source.
Assign stable AC IDs, covering every implied condition and deduplicated recipe additions:
“As a <role>, I want <feature>, so that <benefit>.” Include passing all matching WORKFLOW.md
validate rows; for bugs include that the reproducible condition no longer reproduces.
Roles name beneficiaries; [results](results.md) owns test personas.

## Gate each criterion

Judge scope, satisfiability, ambiguity and testability. Narrow disproportionate scope, replace
contradictions/external guarantees, specify observable inputs/results, and name the deciding
observation. `@bakers-build/bb-verdict` owns the defect vocabulary. Preserve passing wording
exactly; for supported rewrites report previous wording and assumptions. Ask or record missing
facts. The passed/rewritten tally rates wording, never implementation success.

Publish complete Markdown through [ticket writes](ticket-writes.md), type `acceptance`, and return
its ID. Qualification publishes the list in its handoff instead. Select no checks, prepare no
scenario and choose no destination here.
