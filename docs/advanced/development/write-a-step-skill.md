---
title: Write a recipe
description: Add a recipe skill that brings your engineering method to plan, working and review.
---

# Write a recipe

**Your team works with a different method? Write a recipe, and qualification can choose it for your tickets.**

A recipe owns `plan`, `working` and `review` for one engineering method. It runs inside the frame skill `bb-workflow`, which reads the ticket, provisions the runtime, runs the project's checks and moves the ticket on. The shipped example is `bb-recipe-matt`. Stack-specific knowledge does not belong in a recipe: put it in a runtime guide or in the project's `WORKFLOW.md` hints.

**You need:** a repository connected to bakers.build and its skills under `.claude/skills` or `.agents/skills`.

1. **Describe it.** Create `.claude/skills/<namespace>/skills/bb-recipe-<method>/SKILL.md`. Qualification chooses from the description alone, so name the method, the ticket types it covers and when it fits. Add `Project default` to at most one installed recipe.

   ```yaml
   ---
   name: bb-recipe-lean
   description: Recipe for tickets of type feature or chore — a short plan, then test-first implementation and a code review. For small, well-specified work.
   ---
   ```

2. **Write one section per work state.** `## plan`, `## working` and `## review`, each naming the method's original skills. Add a `### <type>` subsection only where a type behaves differently, for example `### bug` under `## plan`. Leave inputs, comments, gates and transitions to the frame: a recipe calls no other bakers.build skill, so it keeps working when those change. Keep the whole file under 500 words.

3. **Install it** in the repository or in any plugin, so the agent can discover it. `WORKFLOW.md` does not list recipes.

4. **Prove it on a ticket.** Create a small ticket of a type your recipe covers, let qualification choose your recipe, or set it with `--recipe_names <method>`, and let it run. The run log shows `bb-recipe-<method>` loaded in each state, and the handoff comments show whether your sections hold.

**Done when:** one ticket has passed through `plan`, `working` and `review` with your recipe loaded, as the run log shows.

## The rules

Phases, routing, recipe resolution and the stop rules: [Skill contract](/advanced/development/skill-contract). Runtime guides and hints are covered in `bb-workflow/references/authoring.md`. Testing a skill's wording against a worker: [Test a skill](/advanced/development/test-skills).
