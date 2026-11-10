---
title: Write a recipe
description: Add a recipe skill that brings your engineering method to plan, working and review.
---

# Write a recipe

**Your team works with a different method? Write a recipe, and qualification can choose it for your tickets.**

A recipe brings one engineering method to `plan`, `working` and `review`. It adds slots to the state × phase grid of the frame skill `bb-workflow`, whose state files read the ticket, provision the runtime, run the project's checks and move the ticket on. The shipped example is `bb-recipe-matt`. Stack-specific knowledge does not belong in a recipe: put it in a runtime guide or in the project's `WORKFLOW.md` hints.

**You need:** a repository connected to bakers.build and its skills under `.claude/skills` or `.agents/skills`.

1. **Describe it.** Create `.claude/skills/<namespace>/skills/bb-recipe-<method>/SKILL.md`. Name the method and the ticket types it covers. Qualification loads every installed recipe completely and chooses the one whose method fits the ask, so the sections below, not the description, carry what the method does.

   ```yaml
   ---
   name: bb-recipe-lean
   description: Recipe for tickets of type feature or chore — a short plan, then test-first implementation and a code review.
   ---
   ```

2. **Write one section per state, one slot per phase.** `## bb-state-plan`, `## bb-state-working` and `## bb-state-review`, each with a `### bb-phase-<phase>` slot only where your method adds something, usually `### bb-phase-work`, naming the method's original skills. Add a `## <type>:bb-state-<state>` section only where a type behaves differently, for example `## bug:bb-state-plan`; per phase its slot wins over the general one. A recipe links no `bb-workflow` reference and calls no other bakers.build skill. Follow the authority limits below. Keep the whole file under 500 words.

   ```md
   ## bb-state-plan

   ### bb-phase-work

   Follow `brainstorming`, then `writing-plans`.
   ```

3. **Install it** in the repository or in any plugin, so the agent can discover it. `WORKFLOW.md` does not list recipes.

4. **Prove it on a ticket.** Create a small ticket of a type your recipe covers, let qualification choose your recipe, or set it with the `bakers_ticket_classify` tool ([bakers tools](/cli/tools)), and let it run. The run log shows `bb-recipe-<method>` loaded in each state, and the handoff comments show whether your slots hold.

**Done when:** one ticket has passed through `plan`, `working` and `review` with your recipe loaded, as the run log shows.

## The rules

A type-specific phase slot wins; a missing phase falls back to the general state section, then to no recipe slot. The frame's state phase always runs. A recipe can replace a default deliverable, comment, merge or check when its slot names one explicitly. Approval, the coding gate, the verdict and readbacks remain mandatory; a transition slot can only choose a destination allowed by the gate.

Install every required method skill before running a ticket. Keep runtime mechanics in runtime guides and project checks in `WORKFLOW.md`. [Workflow mechanics](/skills-and-workflows/guide#how-it-works) explains the surrounding run; the installed `bb-workflow/references/authoring.md` defines the authoring contract.

## Reader contract

Qualification must be able to determine the method and supported ticket types from the complete recipe. Verify them through the small ticket above before using it on production work.
