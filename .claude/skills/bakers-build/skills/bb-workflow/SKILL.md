---
name: bb-workflow
description: Use when executing or authoring bakers.build lifecycle steps — the seven phases, state routing, recipe slots, binding and stop rules.
---

# Running a state

A state run passes seven phases in order: **read, provision, work, validate, deliver, outtake,
transition**. Its state file holds one section per phase and is the only description of its flow.
For authoring read [authoring](references/authoring.md).

## Slots

At each phase, the state file's section always runs and owns gates, publication and
transitions. Beside it, read the matching **slots**; they supply the method inside it, bindingly:

- the recipe's `<type>:bb-state-<state>` › `### bb-phase-<phase>`, where `<type>` is the ticket's
  `ticket_type`; when that slot is absent, its `bb-state-<state>` › `### bb-phase-<phase>`; else none;
- `WORKFLOW.md` and every loaded runtime guide: `## bb-phase-<phase>`.

## Routing

1. Read complete context through [read ticket](references/read-ticket.md). For each label, load the
   installed `@bakers-build/bb-label-<label>`, if any, and follow it in every state.
2. Route by state:

   | State | Flow |
   |---|---|
   | `qualification` | [qualification](references/qualification.md) |
   | every other state | the recipe's `bb-state-<state>` section, run in the state file of that name: [plan](references/plan.md), [working](references/working.md), [review](references/review.md) |

   Unreadable state file: stop and name it before reading a recipe.
3. Resolve the recipe: `bb-recipe-<name>` from the ticket's `recipe` field, empty at qualification
   until [classify](references/classify.md) chooses; slots and the stop rule wait
   for it.
4. Apply *Stop rule*, then render [read ticket](references/read-ticket.md) › *Frame the run* and start the state
   file's `## read`.

## Required skills

Recipe sections and hint rows are **binding**: load every skill they require before doing the work
it governs, and where a slot names its own deliverable, comment, merge or check, it replaces the
state file's default for that phase. Approval, the coding gate, the verdict and every readback stay. **Load** means invoke the skill and read its **complete** `SKILL.md`,
then announce what you loaded. Paraphrasing or naming it later does **not** count. A hint
may mark a skill **advisory** (skippable; the outtake says so). Only an explicit
user request replaces a required skill; the outtake names the replacement and why.

## Stop rule

**If the recipe, its section for this state, the ticket's type among the recipe's declared types,
or a required skill cannot be resolved or read, stop and report the
identifier that failed**, *before* any file edit, commit, comment, confirmation or transition.
Substitute no method of your own.

## Rules

- References route nothing, except [return to qualification](references/return-to-qualification.md)
  (recovery); `@bakers-build/bb-create-ticket` routes a new ticket once.
- Before creation and every qualification, run [prior-art search](references/prior-art-search.md);
  a hit needs a human decision.
- Before writing a ticket, comment or relationship, read [ticket writes](references/ticket-writes.md).
- [Evidence and links](references/evidence.md); [local preview links](references/preview-links.md).
- **Provision**: before a confirmed check needing a running environment, start `provision_up` in a
  subagent ([conductor tools](references/tools-conductor.md)) with the `bb-phase-provision` profile
  and use its base URL; other checks start nothing. `test_as` logins follow the
  `bb-phase-outtake` hint; a missing persona stays **missing**, never substituted.
- Skill prose cites no ticket identifiers.
