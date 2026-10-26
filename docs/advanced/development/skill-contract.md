# Skill contract

A ticket state is run by one frame skill, `bb-workflow`, which routes the state to its owner and binds the recipe, the runtime guide and the project's hints; this page states how those pieces fit together.

bakers.build ships no workflow engine and no loader. It ships skills, which are Markdown instructions an agent reads, and the agent's native skill mechanism loads them. No CLI command reads or validates them. For the practical path, see [How it works](/skills-and-workflows/how-it-works) and [Configure your workflow](/skills-and-workflows/write-workflow-md). The authoring reference is `.claude/skills/bakers-build/skills/bb-workflow/references/authoring.md`.

## The six phases

Every state run passes `read, provision, work, validate, deliver, transition`. Each kind of guidance puts its content under a section named after the phase it refines, and a run reads exactly the matching sections at each phase. The names are stable; a section under another name is never read.

## The frame

`bb-workflow` is the single entry point. A project's `WORKFLOW.md` starts with one line that invokes it. It reads the ticket, then routes by state:

| State | Owner |
|---|---|
| `qualification` | `bb-qualify-ticket` |
| `plan`, `working`, `review` | the ticket's recipe |
| `pre_deployment` / `post_deployment` | `bb-prepare-deployment` / `bb-post-deployment` |
| `verifying` / `summary` | `bb-verify-on-environment` / `bb-summarize-verification` |

`plan` and `working` first run `bb-ensure-qualification` and continue only on `qualified`. Provisioning is lazy: the runtime is brought up before the first action that needs it, and skipped when nothing does.

## Recipes

A recipe is one skill named `bb-recipe-<method>` per engineering method, free of domain and runtime. Its description names the method, the ticket types it covers and, on at most one installed recipe, `Project default`; qualification chooses from descriptions alone. Its sections are named after the work states, `## plan`, `## working` and `## review`, with a `### <type>` subsection only where a type behaves differently. It names the method's original skills, calls no other bakers.build skill, and leaves domain, runtime and project commands to guides and hints; the frame supplies inputs, comments, gates and transitions. A recipe may live in any plugin. The shipped recipe is `bb-recipe-matt`.

The ticket's `recipe` field names the recipe, without the `bb-recipe-` prefix; empty means the project default. Its `ticket_type` field selects the subsection.

## Runtime guides

A runtime guide is one skill named `bb-runtime-<tech>` that says how to provision, execute, lint and test in one technology, under `## provision`, `## work` and `## validate`. A project names its guide in its `## provision` hint. The shipped guide is `bb-runtime-ddev`.

## Project hints

`WORKFLOW.md` is the entry line plus optional phase sections. `## work` holds a `| When | Skill |` table and `## validate` a `| When | Command |` table; a run applies every matching row. Repository conventions and test lore belong in repository docs that `CLAUDE.md` points to.

## Binding and stop rules

Recipe sections, matching hint rows and `.prompt` values are binding: the agent loads every skill they require, reading its complete `SKILL.md`, before the work it governs, and announces what it loaded. A hint may mark a skill advisory. A required skill is replaced only when the user explicitly asks, and the outtake names the replacement.

If the recipe, its state section, the ticket's type among the recipe's declared types or a required skill cannot be resolved, the run stops and reports the exact identifier, before it edits a file, commits, publishes a comment, asks for confirmation or transitions the ticket.

## Inputs

Lifecycle parameters of core skills are declared inputs. A key has the form `<role>.<kind>`: `.command` runs verbatim, `.prompt` is followed verbatim, and `.data` is looked up and neither run nor followed. Each input carries a `description` and a `default`, so the skill runs with no project configuration. A project overrides a value in the `WORKFLOW.md` section of the phase where the skill runs, naming the skill and the key; the override wins over the default.

## Helper skills

The capability skills a state invokes, such as reading a ticket or publishing a comment, produce one outcome and route nothing. Two exceptions exist: `bb-ensure-qualification` may send a ticket back to `qualification`, and `bb-create-ticket` owns the first routing of a new ticket. The global rules every run keeps live in `bb-workflow` and its references.

## Handoff and transition order

Every owner finishes in the same order: publish the typed handoff and one `summary`, print it, complete any confirmation the state requires, record optional measurements, publish the status to the origin issue when authorized, then write the ticket's next state and read it back. After the state write the owner stops, because the conductor ends the run shortly after it. Handoffs and ticket text are Markdown in the `bb_rich` format, which strips raw HTML.

## Handoffs and review

Qualification records `test_as`: the test personas who check the change and what each should see.
`bb-resolve-environment` confirms each persona exists, and the runtime guide issues its login link.

`bb-workflow/references/results.md` separates automated tests, agent inspection and human review.
Results retain persona, environment, observation, revision and evidence. Authored tests are not
executed tests. Agent inspection is not human acceptance.

The owner invokes `bb-run-outtake` once. Typed comments retain full
records. The summary gives brief successes, actionable problems and persona-specific review resources with login links.

## Size and verification

Every bakers.build `SKILL.md` permits 500 whitespace-separated words, including frontmatter/code.
`python3 tests/contract/skill-size.py` enforces this in CI. References contain conditional details;
remove repetition instead of moving entire instructions elsewhere.

[Test a skill](/advanced/development/test-skills) covers isolated generation and offline replay.
These evaluations use synthetic facts, without live integration.
[Add a skill test](/advanced/development/add-skill-test) documents profiles and CI coverage;
the [run-outtake case](/advanced/development/test-run-outtake) checks coding presentation and login URLs.
