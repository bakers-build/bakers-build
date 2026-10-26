# bakers.build skills

A project's `WORKFLOW.md` is one entry line plus optional phase-named hints:

```markdown
Invoke `bakers:bb-workflow` and follow it for the ticket's current state.
```

Start from `skills/bb-init-project/references/WORKFLOW.template.md`. No CLI reads or validates these
skills; the agent environment's native skill mechanism loads them.

**The frame.** `@bakers-build/bb-workflow` tells every run how a state goes, in six phases —
`read, provision, work, validate, deliver, transition` — and owns the binding, replacement and stop
rules. It routes `qualification` to `@bakers-build/bb-qualify-ticket`, `pre_deployment` /
`post_deployment` to `@bakers-build/bb-prepare-deployment` / `@bakers-build/bb-post-deployment`, and
`verifying` / `summary` to `@bakers-build/bb-verify-on-environment` /
`@bakers-build/bb-summarize-verification`. Lifecycle parameters of these core skills use declared
`inputs`.

**Recipes.** `plan`, `working` and `review` run the ticket's recipe: one skill per engineering
method, selected by the ticket's `recipe` field. `@bakers-build/bb-recipe-matt` ships here and is the
project default.

**Runtime guides.** `@bakers-build/bb-runtime-ddev` says how to provision, run, lint and test in DDEV;
a project names it in its `## provision` hint.

**Helper/capability skills route nothing.** Skills a step invokes (`@bakers-build/bb-read-ticket`,
`@bakers-build/bb-verify-tests`, `@bakers-build/bb-verify-playwright-cli`, `@bakers-build/bb-run-intake`, `@bakers-build/bb-run-outtake`,
`@bakers-build/bb-publish-comment`, `@bakers-build/bb-record-measurement`, `@bakers-build/bb-transition-ticket`,
`@bakers-build/bb-publish-origin-status`, …) each have one observable result
and never choose a destination. **A capability owns the command it performs** — the write recipes
live there, not in a step owner, a contract document, or a prose resource.
`@bakers-build/bb-ensure-qualification` keeps its guard exception — its only route is the recovery back to
`qualification`.

For authoring recipes, guides and hints, read `skills/bb-workflow/references/authoring.md`.

## Setup and upgrades

- `@bakers-build/bb-init-project` initializes or completes a selected machine, connection, project
  or all configuration scope through `bakers config init` and `bakers config check`. It preserves
  partial configurations and existing workflow policy; project setup composes an absent workflow.
- `@bakers-build/bb-init` (`bakers:bb-init` in Claude Code) guides machine and user setup through the
  documentation. Its wizard explains workspace-manager and development-environment choices,
  checks the selected path, and helps with sign-in. Tool requirements and commands live in the
  documentation; the person installs tools. `@bakers-build/bb-init-project` calls it when a machine
  has no configured user.
- `@bakers-build/bb-upgrade-project` migrates and repairs through `bakers config upgrade` and scoped checks,
  preserving local policy and optional project connections. Package update is a separate action.
  Both skills distinguish local validity from online authentication readiness (workspace optional).

Initialization and upgrade are human-initiated capabilities. Neither starts ticket work.

## Shared writes and skill delivery

`@bakers-build/bb-workflow` owns validated writes and uncertain-outcome reconciliation. Capabilities
retain returned UUIDs for readback and follow-up work; `@bakers-build/bb-create-ticket` owns the ticket-create
recipe. Normal outgoing validation stays enabled for every write.

This directory is the bundle source. After changing instructions, use the target agent environment's
supported installation/discovery facilities to refresh its bakers.build bundle. Record the source revision,
discovered path and installed manifest version, and inspect the instructions the worker actually
loads, including references and templates. A source edit alone does not update a cached install.
Validate changed skills and run the project's selected real worker example for behavior changes.
Refresh only the selected environment; preserve unrelated global skill libraries.

## Review records and skill size

Every bakers.build `SKILL.md` is limited to 500 whitespace-separated words, including frontmatter,
tables and examples. `python3 tests/contract/skill-size.py` enforces this in the core CI suite.
References are loaded for named conditions; copying the whole skill into an always-loaded
reference is not a reduction.

Qualification records intended test users and environments. The shared contract in
`bb-workflow/references/results.md` separates automated checks, agent inspection and human
review, with observed status, identity, environment and evidence. One `bb-run-outtake` summary is
rendered per state.

`bb-resolve-environment` looks up confirmed project instructions, configured environments and
existing scripts/fixtures before asking for missing choices. `bb-runtime-ddev` is a selected
adapter, not a universal lifecycle prerequisite.

Behavioral evaluations use isolated tool-free workers with synthetic tickets. Run
`python3 tests/skill-eval/run.py` from the repository; see `tests/skill-eval/README.md` for
fixtures, prerequisites, artifacts and the distinction from live integration tests.
