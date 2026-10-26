---
name: bb-workflow
description: Use when executing or authoring bakers.build lifecycle steps — the six phases, state routing, recipe resolution, binding and stop rules.
---

# Running a state

Every state run passes six phases: **read, provision, work, validate, deliver, transition**. At
each phase, read the same-named sections of the recipe, loaded guides and `WORKFLOW.md`; they refine
bindingly. To author a recipe, runtime guide or hint, read [authoring](references/authoring.md).

## read

Read context through `@bakers-build/bb-read-ticket`, then route by state:

| State | Owner |
|---|---|
| `qualification` | `@bakers-build/bb-qualify-ticket` |
| `plan`, `working`, `review` | the ticket's recipe |
| `pre_deployment` / `post_deployment` | `@bakers-build/bb-prepare-deployment` / `@bakers-build/bb-post-deployment` |
| `verifying` / `summary` | `@bakers-build/bb-verify-on-environment` / `@bakers-build/bb-summarize-verification` |

`plan` and `working` first run `@bakers-build/bb-ensure-qualification`, continuing only on `qualified`.
A recipe state invokes `bb-recipe-<name>` from the ticket's `recipe` field; empty means the installed
recipe declaring itself project default. Execute its section named after the state; `ticket_type`
selects the type subsection.

## Required skills

Recipe sections, matching hint rows and `.prompt` values are **binding**: load every skill they
require before doing the work it governs. **Load** means invoke the skill and read its **complete**
`SKILL.md`, then announce what you loaded. Equivalent reasoning, paraphrasing the method, or naming
a skill afterwards does **not** count. A hint may mark a skill **advisory**; that one may be
skipped, and you say so in the outtake. A required skill is replaced only when the user explicitly
asks; the outtake names the replacement and its reason.

**If the recipe, its state section, the ticket's type among the recipe's declared types, or a
required skill is missing** — it cannot be resolved or read — **stop and report the exact
identifier that failed**. Stop *before* editing a file, committing, publishing a comment, asking for
confirmation, or transitioning the ticket. Say plainly that you cannot do the work because it is
unavailable; do not substitute your own method for it.

## provision

Lazy: before the first action needing the runtime, provision through
`@bakers-build/bb-resolve-environment` and the adapter the `## provision` hint names. No hint and no
need → skip silently.

## work

Apply [boundaries](references/boundaries.md). Before building, run the [remote base check](references/prior-art-build.md).
Each recipe state follows its flow: [plan](references/plan.md), [working](references/coding.md),
[review](references/review.md).

## validate

Run each matching `## validate` row once per revision; record [results](references/results.md).

## deliver

Follow [delivery](references/delivery.md). Merge only with explicit authorization, through `@bakers-build/bb-merge-mr`.

## transition

Complete authorized work → publish typed evidence and one `summary` → print it
(`@bakers-build/bb-run-outtake`) → required confirmation → optional measurements → authorized origin
publication → `@bakers-build/bb-transition-ticket` state write and readback → STOP. Deployment states
and verification `summary` keep complete evidence in their single summary; `verifying` adds
per-ticket results and a tested-set handoff.

## Rules

- Helpers route nothing, except `@bakers-build/bb-ensure-qualification` (recovery) and
  `@bakers-build/bb-create-ticket` (initial routing).
- Before creation and every qualification, run [prior-art search](references/prior-art-search.md);
  a hit needs a human decision.
- Before writing a ticket, comment or relationship, read [ticket writes](references/ticket-writes.md).
- [Evidence and links](references/evidence.md); [local preview links](references/preview-links.md).
- Skill prose cites no ticket identifiers.
