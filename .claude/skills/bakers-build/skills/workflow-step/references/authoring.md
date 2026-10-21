## The `when` triple — the whole selection surface

A step-owning skill's frontmatter declares one `when:` over three variables. Nothing else selects
it:

```yaml
when:
  work_type: code                          # the ticket's work:* label without the prefix
  workflow: [bb_bug]                      # a list, a single string, "*", or omitted
  step: [diagnose, coding, review]          # the workflow states this skill owns
inputs:                                     # each: a <role>.<kind> key + description + default
  validate.command:
    description: the command that runs the test suite
    default: ddev e2e
  provision.command:
    description: the command that brings up the test environment
    default: ddev init
```

- **`work_type`** — the abstract label the ticket's `work:*` sub-work carries, without the `work:`
  prefix. A list matches any of them; **omitted** (or `*`) matches every work type and is used by
  the non-work-typed state skills (e.g. `qualification`, `spec`), whose triples carry no work type.
- **`workflow`** — `bb_feature` / `bb_bug` / `bb_chore` / `bb_deployment` /
  `bb_verification`; a list or `*`.
- **`step`** — the workflow state(s) this skill is responsible for. A skill may own several
  (`ddev-drupal-bug` owns `diagnose`, `coding`, `review`). Every value must be a known workflow
  step.

Each of the three keys accepts a single string, a list of strings, `*` (any), or omission (any).

## The exactly-one-match invariant

For the ticket's current `(work_type, workflow, step)` triple, the runtime loads the one skill
whose `when` matches all three components (a list matches by membership; `*`/omitted matches
anything; a `null` work type — a non-work-typed step — is matched only by an omitted/`*`
`work_type`). Across the loaded skills, **every triple the project can produce is matched by
exactly one skill**: a triple with **no** match is a coverage gap and a **configuration error**; a
triple with **two** matches is a collision and a **configuration error**.

## Engineering methods and project checks

`WORKFLOW.md` lists one or more `Skill set` entries and contains `Skills` and `Checks` tables. Read
them under `@bakers-build/method-context`: the selected collection supplies upstream skills by step; the
tables add skills and exact checks by work type and affected area. With two or more entries the
first is the project default and the ticket's `method:*` label records which one is in force, so a
step reads that answer instead of choosing again. These Markdown tables
are instructions, not input to the lifecycle validator. The existing `when` matching selects
bakers.build owners only. Skill installation and host invocation are the agent environment's concern.

## Inputs — description + default, overridden per skill

Lifecycle-specific parameters, such as release procedures, remain declared **inputs**. Engineering
methods and project checks use the sections above; keep those choices out of skill input defaults.

An input key is **`<role>.<kind>`**. The role says what the value is for (`validate`, `provision`,
`build`, `design`, `release`, …); the **kind** says what the agent does with the value, and it is a
closed set:

| kind | contract |
|---|---|
| `.command` | a shell command, **run verbatim** |
| `.prompt` | an instruction, **followed verbatim** — never paraphrased, summarised, or replaced by equivalent reasoning of your own |
| `.data` | structured data, **looked up** — neither executed nor followed |

The `description` says what belongs in the value; the kind says how to treat it. A `.prompt` default
is not a hint to adapt.

Each input carries a short `description` and a `default`, so a skill runs with no project config. A
project **overrides** a value inline under that skill's bullet in `WORKFLOW.md`'s `## Loaded skills`
list (indented `key: value` YAML, block scalars allowed for multi-line instructions). The effective
value is the override if present, otherwise the skill's default; an input with neither an override
nor a default is a configuration error, reported with the input's description. Overrides are
per-skill, at the skill's load site — there is no global values block and no deep config-merge; just
this one key-level override-or-default lookup.

## Bundles

A bundle has a `## Loaded skills` list and no `when`; it owns no step. The loader
replaces it in place with its members, recursively, in declared order. Duplicate leaves
keep their first occurrence. Missing skills, cycles, and inline values on a bundle's own
bullet raise `StepContractError`; exactly-one-match validation runs on the expanded leaves.

Set values under the member's bullet: project overrides beat bundle values, which beat
input defaults. In nested bundles the outermost value wins. There is no member opt-out:
to replace or omit a member, load your own bundle instead. Adding a competing owner
alongside the original is a collision.
