# bakers.build skills

Configure the project in `WORKFLOW.md`:

| Section | Purpose |
|---|---|
| Loaded skills | bakers.build lifecycle owners, including `@bakers-build/essential-skills`. |
| Skill set | One or more references to Matt or Superpowers; the first is the default, and a ticket records its choice as a `method:*` label. |
| Skills | Additional skills by work type and affected area. |
| Checks | Exact commands, applicability and setup. |

Start from `WORKFLOW.template.md`. The agent reads the selected collection and tables through
`@bakers-build/method-context`; its own environment installs and exposes upstream skills.

This plugin exports independently addressable skills. For lifecycle owners, `WORKFLOW.md` is a
pure loader; step-owning skills sequence their work. Lifecycle parameters use declared `inputs`.
The skill set and tables are Markdown instructions for the agent, outside lifecycle validation.

**Step-owning skills own their step's whole flow, including routing.** Each declares one `when:`
over `(work_type, workflow, step)`; the runtime matches the ticket's current triple to exactly one
loaded skill (a gap or collision is a configuration error) and that skill owns its step end to end —
guard, intake, work, validation, outtake, confirmation, **transition destination**, authorized origin publish, final transition,
and STOP. This reverses an earlier rule under which `WORKFLOW.md` alone owned routing; the reusable
`@bakers-build/workflow-step` skill documents the full contract.

**Helper/capability skills route nothing.** Skills a step invokes (`@bakers-build/read-ticket`,
`@bakers-build/verify-tests`, `@bakers-build/verify-playwright-cli`, `@bakers-build/run-intake`, `@bakers-build/run-outtake`,
`@bakers-build/publish-comment`, `@bakers-build/record-measurement`, `@bakers-build/transition-ticket`,
`@bakers-build/publish-origin-status`, …) each have one observable result
and never choose a destination. **A capability owns the command it performs** — the write recipes
live there, not in a step owner, a contract document, or a prose resource.
`@bakers-build/ensure-qualification` keeps its guard exception — its only route is the recovery back to
`qualification`.

The step-owning skills that ship here: `@bakers-build/qualify-ticket` (qualification), `@bakers-build/create-spec`
(`work:code` spec), `@bakers-build/ddev-drupal-bug` (`work:code` on a bug — diagnose/coding/review),
`@bakers-build/ddev-drupal-feature` (`work:code` on a feature/chore — coding/review),
`@bakers-build/docs-authoring` (`work:docs` — self-contained spec/diagnose/coding/review; documentation /
skill-instruction changes, validated by proportional checks and a real worker when behavior changes),
`@bakers-build/prepare-deployment` (pre_deployment), `@bakers-build/post-deployment`
(post_deployment), `@bakers-build/verify-on-environment` (verifying), `@bakers-build/summarize-verification`
(summary). Lifecycle inputs may still be overridden under the owning skill's bullet.

**Bundle skills.** `@bakers-build/essential-skills` is a **bundle** — a skill that carries a
`## Loaded skills` section in its own body, the same section (and syntax) a `WORKFLOW.md` uses, and
thereby loads further skills. No frontmatter key marks it; the section is the marker. It names the
six globally-applicable workflow skills (`qualify-ticket`, `create-spec`, `prepare-deployment`,
`post-deployment`, `verify-on-environment`, `summarize-verification`) in one canonical place, so a
project's `WORKFLOW.md` loads the one bundle instead of re-listing them. The loader (`@bakers-build/core`
`expandLoad`) expands bundles into their members — deterministically, idempotently, with a clear
error on a missing or cyclic member — before the exactly-one-match validation, resolving values
narrowest-first (`WORKFLOW.md` override > bundle value > the skill's own `default`).
Project work-type owners stay explicit bullets; the workflow tables supply their project context.
To drop or swap a member, a project writes its own bundle. The full bundle
contract lives in `@bakers-build/essential-skills`; the step contract a member follows is
`@bakers-build/workflow-step`.

## Setup and upgrades

- `@bakers-build/init-project` initializes or completes a selected machine, connection, project
  or all configuration scope through `bakers config init` and `bakers config check`. It preserves
  partial configurations and existing workflow policy; project setup composes an absent workflow.
- `@bakers-build/init` (`bakers:init` in Claude Code) guides machine and user setup through the
  documentation. Its wizard explains workspace-manager and development-environment choices,
  checks the selected path, and helps with sign-in. Tool requirements and commands live in the
  documentation; the person installs tools. `@bakers-build/init-project` calls it when a machine
  has no configured user.
- `@bakers-build/upgrade-project` migrates and repairs through `bakers config upgrade` and scoped checks,
  preserving local policy and optional project connections. Package update is a separate action.
  Both skills distinguish local validity from online authentication readiness (workspace optional).

Initialization and upgrade are human-initiated capabilities. Neither starts ticket work.

## Shared writes and skill delivery

`@bakers-build/workflow-step` owns validated writes and uncertain-outcome reconciliation. Capabilities
retain returned UUIDs for readback and follow-up work; `@bakers-build/create-ticket` owns the ticket-create
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
`method-context/references/results.md` separates automated checks, agent inspection and human
review, with observed status, identity, environment and evidence. Each owner supplies records;
the last matching owner renders one `run-outtake` summary for the state.

`resolve-environment` looks up confirmed project instructions, configured environments and
existing scripts/fixtures before asking for missing choices. `provision-ddev` is a selected
adapter, not a universal lifecycle prerequisite. Existing `ddev-drupal-*` owner names remain
compatible while their lifecycle instructions use the neutral helper.

Behavioral evaluations use isolated tool-free workers with synthetic tickets. Run
`python3 tests/skill-eval/run.py` from the repository; see `tests/skill-eval/README.md` for
fixtures, prerequisites, artifacts and the distinction from live integration tests.
