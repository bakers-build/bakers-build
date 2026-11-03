---
title: Write a recipe
description: Add a recipe skill that brings your engineering method to plan, working and review.
---

# Write a recipe

**Your team works with a different method? Write a recipe, and qualification can choose it for your tickets.**

A recipe brings one engineering method to `plan`, `working` and `review`. It adds slots to the state × phase grid of the frame skill `bb-workflow`, whose state files read the ticket, provision the runtime, run the project's checks and move the ticket on. The shipped example is `bb-recipe-matt`. Stack-specific knowledge does not belong in a recipe: put it in a runtime guide or in the project's `WORKFLOW.md` hints.

**You need:** a repository connected to bakers.build and its skills under `.claude/skills` or `.agents/skills`.

1. **Describe it.** Create `.claude/skills/<namespace>/skills/bb-recipe-<method>/SKILL.md`. Qualification chooses from the description alone, so name the method, the ticket types it covers and when it fits. Add `Project default` to at most one installed recipe.

   ```yaml
   ---
   name: bb-recipe-lean
   description: Recipe for tickets of type feature or chore — a short plan, then test-first implementation and a code review. For small, well-specified work.
   ---
   ```

2. **Write one section per state, one slot per phase.** `## bb-state-plan`, `## bb-state-working` and `## bb-state-review`, each with a `### bb-phase-<phase>` slot only where your method adds something, usually `### bb-phase-work`, naming the method's original skills. Add a `## <type>:bb-state-<state>` section only where a type behaves differently, for example `## bug:bb-state-plan`; per phase its slot wins over the general one. Leave inputs, comments, gates and transitions to the state files: a recipe links no `bb-workflow` reference and calls no other bakers.build skill, so it keeps working when those change. Keep the whole file under 500 words.

   ```md
   ## bb-state-plan

   ### bb-phase-work

   Follow `brainstorming`, then `writing-plans`.
   ```

3. **Install it** in the repository or in any plugin, so the agent can discover it. `WORKFLOW.md` does not list recipes.

4. **Prove it on a ticket.** Create a small ticket of a type your recipe covers, let qualification choose your recipe, or set it with the `bakers_ticket_classify` tool ([bakers tools](/configuration/clients/tools)), and let it run. The run log shows `bb-recipe-<method>` loaded in each state, and the handoff comments show whether your slots hold.

**Done when:** one ticket has passed through `plan`, `working` and `review` with your recipe loaded, as the run log shows.

## The rules

Phases, routing, recipe resolution and the stop rules: [Skill contract](/configuration/project/contributing#skill-contract). Runtime guides and hints are covered in `bb-workflow/references/authoring.md`. Testing a skill's wording against a worker: [Test a skill](/configuration/project/contributing#test-skills).

## Reader contract

A recipe supplies method slots inside the frame's state files; it cannot widen approval, publication or transition authority. A type-specific slot wins over the general state slot. Required skills must be available before work starts. Keep runtime mechanics in runtime guides and project checks in `WORKFLOW.md`. [Workflow mechanics](/configuration/workflows#how-it-works) explains the seven phases; the implementation contract remains in `docs/bakers/development/skill-contract.md` in the source checkout.
