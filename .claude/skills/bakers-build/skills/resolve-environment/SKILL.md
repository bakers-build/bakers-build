---
name: resolve-environment
description: Discover and verify the configured runtime, review surfaces, and actor access before executing checks or preparing a usable handoff.
---

# Resolve environment and access

Resolve the confirmed checks' prerequisites without choosing a new setup. Read the shared
[records and evidence contract](../method-context/references/results.md). Actor requirements
originate in qualification; keep their names and intended permissions through every step.

## Discover

Use this order, filling only gaps at each step:

1. Read the confirmed ticket scope/plan and project `WORKFLOW.md` setup instructions. Match
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
is a no-op. For a selected DDEV adapter, invoke `@bakers-build/provision-ddev` with the worktree,
configured setup commands, and complete actor requirements. For other providers use their
existing configured commands or skills, then verify readiness. Keep provider mechanics there.

CLI-only and no-runtime checks are valid: record the command, cwd, connection if needed,
and explicit runtime-not-required outcome. Create no web surface for them. Report unavailable
setup as blocked with its reason rather than substituting a different environment.

## Resolve actors and handoff

Before checks, resolve every required actor against the selected environment using configured
accounts, fixtures, or provider lookup. Confirm the actual account, roles, and access match the
requirement; record the source. Never default to admin, create accounts here, or silently
substitute identities. Keep anonymous and intentionally denied actors explicit; denial can be
the expected observation. Preserve unresolved actors with reasons and block dependent checks.
Use `not_required` only when the confirmed check requires no actor.

Return readiness, environment/URLs, cwd/connection, every `review_actors` entry, and usable
`deliverables` with access instructions. Access identifies the intended account and any executor
prerequisite without exposing credentials. Apply `@bakers-build/essential-skills`' local preview rules
before sharing URLs.

Reuse valid actor/access resolution at review; revalidate after provisioning, identity changes,
or a changed environment. Reuse checks only under the shared evidence contract. Report missing
or unreachable surfaces honestly; publish nothing and choose no workflow transition.
