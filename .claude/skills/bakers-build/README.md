# bakers.build skills

A project's `WORKFLOW.md` is one entry line plus optional phase-named hints:

```markdown
Invoke `bakers:bb-workflow` and follow it for the ticket's current state.
```

Start from `skills/bb-init-project/references/WORKFLOW.template.md`. No CLI reads or validates these
skills; the agent environment's native skill mechanism loads them.

**Skills are chosen; references are read.** A skill is something a person, the ticket's `recipe`
field, a provision hint or a subagent start selects. Exactly thirteen ship:

| Skill | Job |
|---|---|
| `@bakers-build/bb-workflow` | The frame of every state run: seven phases — `read, provision, work, validate, deliver, outtake, transition` — the state files, routing, binding, replacement and stop rules. |
| `@bakers-build/bb-recipe-matt` | The project-default recipe for feature, bug and chore tickets, selected by the ticket's `recipe` field. |
| `@bakers-build/bb-recipe-superpowers` | The superpowers method for the same ticket types, selected by `recipe` = `superpowers`. |
| `@bakers-build/bb-recipe-deploy-and-release`, `@bakers-build/bb-recipe-verify` | The recipes of `deployment` and `verification` tickets. |
| `@bakers-build/bb-runtime-ddev` | Runtime guide: provision, run, lint, test and persona logins in DDEV; named in a `## bb-phase-provision` hint. |
| `@bakers-build/bb-verdict` | The review subagent's start: an independent verdict and findings. |
| `@bakers-build/bb-init`, `@bakers-build/bb-init-project`, `@bakers-build/bb-create-project`, `@bakers-build/bb-upgrade-project` | Machine, project and workflow setup and upgrades. |
| `@bakers-build/bb-create-ticket`, `@bakers-build/bb-scope-change`, `@bakers-build/bb-prepare-time` | Create a ticket, change its scope, prepare time proposals. |

**The grid.** A run is state × phase. `qualification`, `plan`, `working` and `review` each have a
state file under `skills/bb-workflow/references/` with exactly seven `## <phase>` sections, which
always run and own gates, publication and transitions. A recipe adds slots
(`## [<type>:]bb-state-<state>` › `### bb-phase-<phase>`; the type slot wins per phase), and
`WORKFLOW.md` and runtime guides add `## bb-phase-<phase>` sections. Every state but `qualification`
runs the recipe's section inside its state file; a state without a state file stops the run. Where a
slot names its own comment, check or merge, it replaces the state file's default.

**References route nothing.** Everything only read — reading a ticket, publishing a comment,
provisioning, verification, the browser surface, intake, outtake, measurement, merge and the state
write — is a reference under `skills/bb-workflow/references/`, not a skill, and cannot be invoked.
Each has one observable result and never chooses a destination; **a reference owns the command it
performs**. `references/ensure-qualification.md` keeps its guard exception — its only route is the
recovery back to `qualification`. Project parameters are `WORKFLOW.md` hint tables, such as the
origin-label table under `## bb-phase-transition`.

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

`@bakers-build/bb-workflow` owns validated writes and uncertain-outcome reconciliation. References
retain returned UUIDs for readback and follow-up work; `@bakers-build/bb-create-ticket` owns the ticket-create
recipe. Normal outgoing validation stays enabled for every write.

This directory is the bundle source. After changing instructions, use the target agent environment's
supported installation/discovery facilities to refresh its bakers.build bundle. Record the source revision,
discovered path and installed manifest version, and inspect the instructions the worker actually
loads, including references and templates. A source edit alone does not update a cached install.
Validate changed skills and run the project's selected real worker example for behavior changes.
Refresh only the selected environment; preserve unrelated global skill libraries.

## Review records and skill size

Every bakers.build `SKILL.md` and every file under `bb-workflow/references/` is limited to 500
whitespace-separated words, including frontmatter, tables and examples (`references/retrospective.md`
excepted). `python3 tests/contract/skill-size.py` enforces this in the core CI suite;
`python3 tests/contract/skill-references.py` checks links, grid headings and the skill set.

Qualification records intended test users and environments. The shared contract in
`bb-workflow/references/results.md` separates automated checks, agent inspection and human
review, with observed status, identity, environment and evidence. One outtake summary
(`references/outtake.md`) is rendered per state.

`references/provision.md` looks up confirmed project instructions, configured environments and
existing scripts/fixtures before asking for missing choices. `bb-runtime-ddev` is a selected
adapter, not a universal lifecycle prerequisite.
It consumes project-supplied setup, testing and login instructions; domain-specific procedures
belong in the project's documentation, outside this bundle.

Behavioral evaluations use isolated tool-free workers with synthetic tickets. Run
`python3 tests/skill-eval/run.py` from the repository; see `tests/skill-eval/README.md` for
fixtures, prerequisites, artifacts and the distinction from live integration tests.
