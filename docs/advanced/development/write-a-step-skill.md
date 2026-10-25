---
title: Write a step skill
description: Add a skill that owns workflow steps for your stack, load it in WORKFLOW.md and check the load.
---

# Write a step skill

**Your stack has no step skill yet? Write one, load it, and bakers.build runs your tickets with it.**

A step skill owns one or more workflow steps for one work type: it reads the ticket, does the step, publishes the handoff and moves the ticket on. The shipped examples are `ddev-drupal-feature`, `ddev-drupal-bug` and `docs-authoring`.

**You need:** a repository connected to bakers.build and its skills under `.claude/skills` or `.agents/skills`.

1. **Claim your steps.** Create `.claude/skills/<namespace>/skills/<name>/SKILL.md` with a `when` block. A `work_type_term` lets qualification create the matching `work:*` label.

   ```yaml
   ---
   name: node-feature
   description: Own plan, working and review for Node services.
   when:
     work_type: node
     workflow: [bb_work]
     step: [plan, working, review]
   work_type_term:
     name: "work:node"
     description: "Sub-work: a Node service change validated by its test suite."
   inputs:
     validate.command:
       description: the command that runs the test suite
       default: npm test
   ---
   ```

2. **Write one section per step.** Each section says what the step reads, what it builds or checks, which handoff comment it publishes and which state it writes. Reuse the shared helpers instead of restating them: `@bakers-build/read-ticket`, `@bakers-build/method-context` (coding flow and gate), `@bakers-build/verify-tests`, `@bakers-build/run-outtake`, `@bakers-build/transition-ticket`. Keep the whole file under 500 words; put long material in `references/`.

3. **Keep project specifics as inputs.** Everything a project might change, a command, a prompt, a data map, is an `inputs` key with a description and a default. A project overrides it under your skill's bullet in `WORKFLOW.md`.

4. **Load it.** Add `- @<namespace>/<name>` to `## Loaded skills` in `WORKFLOW.md`.

5. **Check the load.** Ask your agent to validate `WORKFLOW.md`, or run it yourself:

   ::: details Per CLI
   ```sh
   bakers validate --skills .claude/skills
   ```
   :::

   `OK` lists the owner of every step. A collision means another loaded skill claims one of your triples; a gap means a step nobody owns.

6. **Prove it on a ticket.** Create a small `work:node` ticket and let it run. The run log and the handoff comments show whether your sections hold.

**Done when:** `bakers validate` prints `OK` with your skill as owner, and one ticket has passed through its steps.

## Rules the loader enforces

The exact `when` grammar, the exactly-one-match rule, inputs and bundles: [Skill contract](/advanced/development/skill-contract). Testing a skill's wording against a worker: [Test a skill](/advanced/development/test-skills).
