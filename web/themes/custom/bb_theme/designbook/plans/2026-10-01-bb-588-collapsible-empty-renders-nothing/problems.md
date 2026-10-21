# Execution problems — design-component

| When | Step | Task | Title | Why | Attempted correction |
|---|---|---|---|---|---|
| 2026-10-01T22:00:00Z | write-component | write-component | collapsible | `plan done` rejects the PRESERVED default story: `output "component-story": data/slots/label must be array` — `collapsible.default.story.yml` (unchanged, pre-existing) gives `label` as a string. Rewriting it would violate "existing collapsible stories unchanged", so the task stays pending. The twig and component.yml changes are written and render. | None inside the sealed plan; the new `empty` story uses array slots and was accepted. |
| 2026-10-01T22:00:00Z | validate | validate | collapsible empty, intervention layout consumer | `storybook check` exits 1: `Cannot find package 'playwright'` (addon 0.11.0). Tasks stay pending. | playwright-cli (dbC): collapsible--empty root is empty after stripping comments, 0 `<details>`, no error; --default 1 closed details, --open 1 open details; intervention scene still shows "2 handoffs — spec, comment", "Code · develop", "Relations · 5". |
