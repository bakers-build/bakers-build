# Verify checks

For selected checks read the confirmed test plan and [results](results.md).
Before runtime checks apply the frame's Provision rule with selected environment, cwd/connection
and persona. Missing prerequisites block dependent checks; preserve denied/anonymous/missing
personas. CLI-only checks need no runtime. [Browser](browser.md) owns agent browser inspection;
human checks await a human.

Run confirmed commands/steps using project fixtures and configured commands. Deduplicate identical
executions while preserving all check/AC mappings. Compare output to expected observations;
successful exit alone is insufficient. Return one result per check with immutable revision,
observed outcome and [evidence](evidence.md), using configured report paths. Preserve multiple
results per AC. Functional checks require AC mappings; project checks may have none.
Intentional diagnosis RED remains failed and never establishes coding GREEN.
No output means blocked/not_run, not passed. Reuse valid review evidence with original scope and
revision and record reasons for reruns. Return records to the state without publishing or routing;
manual review stays pending until attributed human observation.
