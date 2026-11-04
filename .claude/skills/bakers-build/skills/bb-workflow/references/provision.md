# Resolve environment and access

Read at a state's `provision` when a check needs a runtime or access. Resolve the confirmed checks'
prerequisites without choosing a new setup. Read the shared [records and evidence
contract](results.md). The personas who test come from qualification's `test_as`; keep them
unchanged through every step.

## Discover

Use this order, filling only gaps at each step:

1. Read the confirmed ticket scope/plan and project `WORKFLOW.md` `bb-phase-provision` hint. Match
   setup to the selected checks, including provider and fixture requirements.
2. Inspect configured bakers.build environments and URLs, current working directory, and selected
   connection. Distinguish the tracker connection from the application under test; confirm
   which checkout/revision the selected surface serves.
3. For unresolved fields, make a bounded scan of relevant project scripts, manifests,
   runtime configuration, and named fixtures. Read documented commands/help and account
   declarations; stop once the required facts are established. Record their sources.
4. Ask only for genuinely missing environment, setup, or account choices after that discovery.
   Return unresolved prerequisites and their affected checks while an answer is pending.

Discovery supplies evidence, not authorization to invent or start arbitrary setup hooks.
Execute only existing setup commands/skills selected by confirmed instructions. A discovered
script alone is not a selected setup.

## Establish readiness

Check the selected runtime and surfaces before starting anything; an already-ready environment
is a no-op. **Tool path:** when the run's tools include the runtime's status tool and
`provision_up`, served by the `bakers-conductor` MCP server (decide by presence, never by agent or
run mode), use them in this order: ready → no-op; stopped stack → the runtime's start tool; missing
or wrong site → `provision_up(<profile the hint names>)`. Every `provision_up` reinstalls, so call it
only when the confirmed instructions need that site. Then verify readiness.

Otherwise, for a selected DDEV adapter, invoke `@bakers-build/bb-runtime-ddev` with the worktree,
configured setup commands, and the `test_as` personas. For other providers use their
existing configured commands or skills, then verify readiness. Keep provider mechanics there.

CLI-only and no-runtime checks are valid: record the command, cwd, connection if needed,
and explicit runtime-not-required outcome. Create no web surface for them. Report unavailable
setup as blocked with its reason rather than substituting a different environment.

## Personas and handoff

Before checks, confirm each `test_as` persona exists on the selected environment and get its login
the way the runtime guide says. Never fall back to an administrator, create accounts here, or test
as another persona; a persona that does not exist is reported as **missing** and blocks its
checks. `anonymous` and denied personas stay in the list; a denial can be the expected observation.

Return readiness, environment/URLs, cwd/connection, a login per persona, and usable
`deliverables` with access instructions, without exposing credentials. Apply
[preview links](preview-links.md) before sharing URLs.

At review issue fresh login links; recheck the personas after provisioning or a changed
environment. Reuse checks only under the shared evidence contract. Report missing
or unreachable surfaces honestly; publish nothing and choose no workflow transition.
