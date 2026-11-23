# Choose a method

A recipe tells the agent how to plan, implement and review a ticket. Choose one for its engineering approach; put your runtime and checks in [project rules](/skills-and-workflows/workflow-file).

## Use an existing recipe

Qualification reads the installed recipes, chooses one that fits the request and records its reason on the ticket. No recipe is preselected. Tell the agent your team's preference when you describe the work; it must still choose a recipe that supports the ticket's type.

| You need | Shipped recipe |
|---|---|
| Clarify the problem, agree a spec, implement test-first and review | `matt` |
| Brainstorm, plan and implement using the Superpowers method | `superpowers` |
| Verify an existing result | `verify` |
| Ship a batch to a target branch | `ship` |

The **type** selects the recipe's variant: for example, a bug needs a diagnosis rather than a feature specification. A recipe declares the types it supports.

**Example:** ask for a small feature using the Matt method. After qualification, check that the ticket records recipe `matt`, type `feature` and the reason for that choice. In plan, expect a spec; in working, test-first implementation; in review, a code review. The run log should name `bb-recipe-matt` and the relevant method skills. A field value alone does not prove the method ran.

To change an already agreed method or scope, ask the agent to use `bb-scope-change` before continuing.

## Shipped recipes and their plugins

A shipped recipe names original skills from an external plugin. Add the recipe's ready entry to the project's [`marketplaces`](/configuration/project#agent-plugins), so every run installs that plugin:

| Recipe | Plugin | Marketplace | Recommended ref | `marketplaces` entry |
|---|---|---|---|---|
| `bb-recipe-matt` | `mattpocock-skills` | `https://github.com/mattpocock/skills.git` | `v1.3.2` | `{ url: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.2', plugins: ['mattpocock-skills'] }` |
| `bb-recipe-superpowers` | `superpowers` | `https://github.com/obra/superpowers.git` | `v7.0.0` | `{ url: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0', plugins: ['superpowers'] }` |
| `bb-recipe-ship`, `bb-recipe-verify` | none | — | — | — |

## Add your own recipe

Start with the [skills installed for your agent](/skills-and-workflows/skills). Create a discoverable skill named `bb-recipe-<method>` in your repository or a plugin; for example, `.claude/skills/team/skills/bb-recipe-small-change/SKILL.md`.

This complete example supports chores with a short plan and a check-first implementation:

```md
---
name: bb-recipe-small-change
description: Recipe for tickets of type chore — a short plan, a failing check, a minimal change and independent review.
---

## bb-gates

| Type | Gates |
|---|---|
| chore | default |

## bb-state-qualification

### bb-phase-work

Clarify only what is needed to make the acceptance criteria checkable.

## bb-state-plan

### bb-phase-work

Describe the smallest change and its observable check. Agree the check
before implementation, including what it cannot prove.

## bb-state-working

### bb-phase-work

Show the agreed check failing, make the smallest change, then show it
passing. Keep the check result and the checked revision in the handoff.

## bb-state-review

### bb-phase-work

Check the diff against the approved scope and project conventions.
Independently verify the recorded result and report missing evidence.
```

A `bb-state-<state>` section supplies the method for that state. A `bb-phase-<phase>` slot adds instructions at that point in the run. Name the original skills if your method requires them, and install them too. Keep the recipe under 500 words and free of project commands.

**Verify:** give the agent a small chore that fits this method. Let qualification select it and check the recorded reason. Follow the ticket through plan, working and review: each log must show `bb-recipe-small-change` loaded, and the handoffs must contain the agreed check, its failing/passing results and the review evidence. A missing recipe, state section, supported type or required skill stops the run.

## Change the method for one type

A type-specific slot such as `## bug:bb-state-plan` overrides the general slot for that phase. Phases absent there fall back to the general state section. Declare the type and its gates before using it; the example above supports only `chore`.

A recipe supplies method within the [fixed workflow](/skills-and-workflows/states#what-stays-fixed). It can name a replacement deliverable or check, but cannot remove approval gates, the verdict or readbacks. Adding a slot does not add a server state.

For example, “only diagnose this bug” is a scope and stopping instruction to agree with the agent; it is not a new `diagnosis` state. Keep the diagnosis in plan and do not authorize implementation.

The installed `bb-workflow/references/authoring.md` is the full authoring contract. For who approves the method's results, see [collaboration](/skills-and-workflows/collaboration).
