# Authoring recipes, runtime guides and hints

Read when writing a recipe, a runtime guide or a project's `WORKFLOW.md`.
`tests/contract/skill-references.py` checks every heading named below.

## The grid

A run is **state × phase**. States with a state file: `qualification`, `plan`, `working`,
`review`. Phases: `read`, `provision`, `work`, `validate`, `deliver`, `outtake`, `transition`.
Each state file holds exactly these seven `## <phase>` sections and always runs. Guidance adds a
**slot** to a cell under a prefixed heading; everything else is free text.

**Two-file rule:** what state X does for type Y reads from X's state file plus the recipe's slots
for X. A slot that needs a third file to make sense belongs in the state file or its reference.

## Recipes

A recipe is one normal skill named `bb-recipe-<method>`, domain-free and runtime-free.

- **Description** names the method, the ticket types it declares as `for tickets of type X, Y or
  Z`, and `Project default` on at most one installed recipe. Qualification chooses from descriptions alone.
- **Sections** are `## bb-state-<state>` and, where a type differs, `## <type>:bb-state-<state>`;
  each holds `### bb-phase-<phase>` slots, only where the method adds something.
- Per slot the type section wins; a phase it lacks falls back to the general section, else none.
  A slot supplies method; where it names its own deliverable, comment, merge or check, that replaces
  the state file's default. Approval, the coding gate, the verdict and readbacks stay; a transition
  slot only picks among the gate's destinations.
- Name the method's original skills; leave domain, runtime and project commands to guides and
  hints. A recipe may live in any plugin: it links no `bb-workflow` reference and calls no other
  `@bakers-build/*` skill.

## Runtime guides

A runtime guide is one normal skill named `bb-runtime-<tech>`: how to provision, execute, lint,
test and hand over logins in one technology, under `## bb-phase-<phase>` sections. Lore only some
runs need sits behind a conditional pointer. A project names its guide in its
`## bb-phase-provision` hint.

## Project hints

`WORKFLOW.md` is the entry line plus optional `## bb-phase-<phase>` sections and nothing else:

```markdown
# <project> — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-provision
## bb-phase-work
## bb-phase-validate
## bb-phase-deliver
## bb-phase-outtake
## bb-phase-transition
```

`bb-phase-work` and `bb-phase-validate` hold `| When | Skill |` and `| When | Command |` tables; a
run applies every matching row. `bb-phase-outtake` names the test-user list and how personas get
logins. `bb-phase-transition` holds the origin-label table, `| State | Origin label |`, read only
by [origin status](origin-status.md); no table means no label is ever written. Conventions and test
lore belong in repository docs.

## Size

Each `SKILL.md` and reference stays within 500 words (`tests/contract/skill-size.py`).
