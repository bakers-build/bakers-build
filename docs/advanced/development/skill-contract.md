# Skill contract

A ticket step is run by exactly one skill, chosen by the skill's own `when` declaration and loaded by the project's `WORKFLOW.md`; this page states the rules that `bakers validate` and the contract test enforce.

bakers.build ships no workflow engine. It ships skills, which are Markdown instructions an agent reads, and each project decides which ones it loads. Two rules carry the model: a skill owns a step, including where the ticket goes next, and `WORKFLOW.md` only loads skills. It sequences nothing, routes nothing and merges nothing. For the practical path, see [how skills and WORKFLOW.md work](/skills-and-workflows/how-it-works) and [Write WORKFLOW.md](/skills-and-workflows/write-workflow-md).

## Step-owning skills

A step-owning skill declares one `when` block in its frontmatter and owns the matched step from start to finish: read the ticket, frame the work, do it, validate it, publish the handoff, choose the destination state and write it. Its body is prose with one section per owned step, and the destination is stated in that prose. There is no central table of transitions.

The reference for authors is the skill `workflow-step`, in `.claude/skills/bakers-build/skills/workflow-step/`, and its page `references/authoring.md`. It declares no `when` itself.

## The `when` triple

The whole selection surface is three keys in the frontmatter.

```yaml
when:
  work_type: code
  workflow: [bb_work]
  step: [plan, working, review]
inputs:
  validate.command:
    description: the command that runs the test suite
    default: ddev e2e
```

| Key | Meaning |
|---|---|
| `work_type` | The ticket's `work:*` label without the prefix, such as `code` or `docs` |
| `workflow` | `bb_work`, `bb_deployment` or `bb_verification` |
| `step` | The workflow states this skill owns |

Each key takes one string, a list of strings, `*` for any value, or nothing, which also means any. An empty list is an error. Only `step` values are checked against a known list: `qualification`, `plan`, `working`, `review`, `pre_deployment`, `post_deployment`, `verifying` and `summary`. The old names `spec`, `diagnose` and `coding` still pass until the shipped skills move. A key other than these three is an error.

Qualification runs before the sub-works are known, so a ticket in it has no work type. Only a skill whose `work_type` is omitted or `*` can match such a step. From `plan` on, the qualification handoff has set the `work:*` labels and the work type selects the owner.

## Exactly one match

For every triple of `(work_type, workflow, step)` that the project can produce, exactly one loaded skill must match. No match is a coverage gap and two matches are a collision; both are configuration errors.

The validator does not know your work types. It derives the triples from the loaded owners. It takes the claimable states of each workflow, then for each state it makes one triple per work type among the owners that cover that step, or one triple with no work type when no work-typed owner covers it.

| Workflow | Claimable steps |
|---|---|
| `bb_work` | `qualification`, `plan`, `working`, `review` |
| `bb_deployment` | `pre_deployment`, `post_deployment` |
| `bb_verification` | `verifying`, `summary` |

The distributed `when` blocks are the decision table you would otherwise keep in one place, and each row is declared by the skill that implements it. To add a skill for your stack, you claim triples. Claim one that is taken and the load fails.

## Inputs

Everything project-specific that a skill needs is a declared input, never baked into the body. An input key has the form `<role>.<kind>`, such as `validate.command` or `build.prompt`. By convention the kind tells the agent how to treat the value: `.command` runs verbatim, `.prompt` is followed verbatim, and `.data` is looked up and neither run nor followed. The validator does not check kinds.

Each input should carry a `description` and a `default`, so the skill runs with no project configuration. `inputs` also accepts a bare list of keys, but those inputs have no default and every project must then supply a value. An input with neither an override nor a default is a configuration error that quotes the description.

A project overrides a value under the skill's bullet in `WORKFLOW.md`. The narrowest value wins, and there is no deep merge.

```
WORKFLOW.md override  >  bundle value  >  the skill's default
```

An override that names an input the skill does not declare is also an error. Without that rule, renaming an input key would leave the old override resolving to nothing while the skill silently ran on its default.

## The loader section

The loader reads one section of `WORKFLOW.md`, `## Loaded skills`, up to the next `##` heading. The other sections of the file, such as the skill set, the skills and checks tables, the required skills and the standards, are instructions the agent reads. The loader ignores them.

```md
## Loaded skills

- @bakers-build/essential-skills
- @bakers-build/ddev-drupal-bug
    validate.command: pnpm test:e2e
- @bakers-build/docs-authoring
```

A skill is loaded by a bullet at indent 0 of the form `- @<namespace>/<skill-name>`, lowercase with digits and `-`. The skill is found by the `name` in its frontmatter, whatever the namespace says. Indented lines under a bullet are a YAML map of overrides, and each value must be a string. A code fence does not shelter a bullet, so an example bullet placed here is loaded for real. A bullet that starts `- @` but has the wrong shape fails with the line quoted, and a section with no bullet at indent 0 fails with a hint matched to what the section holds.

## Bundles

A bundle is a skill with a `## Loaded skills` section in its own body and no `when` and no `inputs`. It owns no step and is never invoked in prose. The loader replaces it with its members, recursively, in the order declared, and a skill that appears twice keeps its first place. The shipped bundle is `essential-skills`.

A member's value can be written under its bullet inside the bundle. Project values beat bundle values, and in nested bundles the outermost value wins. A missing skill, a cycle, or values written under a bundle's own bullet each raise an error. There is no way to opt a member out. To replace or omit one, load your own bundle, because adding a competing owner beside the original is a collision.

## Helper skills

The capability skills that a step invokes, such as reading a ticket or publishing a comment, declare no `when` and produce one outcome. They route nothing. Two narrow exceptions exist: the qualification guard may send a ticket back to `qualification`, and ticket creation owns the first routing to `spec` or `diagnose`, or to `coding` for a fully specified ticket.

A skill with no `when` can still be loaded, for its inputs. It is then a helper leaf: it matches no triple and cannot collide with an owner.

## Several sub-works on one ticket

A ticket can carry more than one `work:*` label. At a step, one skill matches per work type. They run in load order, each with its own build and validate body. The last matching skill in load order performs the single confirmation, the origin-status write and the final transition, once every sub-work has reached the step's gate.

## Handoff and transition order

Every owner finishes in the same order: publish the typed handoff and one `summary`, complete any confirmation the step requires, record optional measurements, publish the status to the origin issue when authorized, then write the ticket's next state and read it back. After the state write the owner stops, because the conductor ends the run shortly after it. Handoffs and ticket text are Markdown in the `bb_rich` format, which strips raw HTML.

## Check the load

`bakers validate` runs every rule above. Run it from the project root, or pass a directory or a `WORKFLOW.md` file. It indexes each `SKILL.md` under `.claude/skills` and `.agents/skills`, expands the bundles, derives the triples and checks them.

```sh
bakers validate
bakers validate --skills ~/.claude/plugins/cache/bakers/bakers/<version>/skills
```

Success prints the workflow file, the skill roots, the number of skills indexed and the loaded owners and helpers, then a line starting `OK` that counts the owners and the triples they cover. It goes to stdout and exits 0. A defect prints a line starting `FAILED:` with the first problem, for example a coverage gap naming the uncovered triple, to stderr and exits 1.

If your project does not keep its skills in the repository, point `--skills` at them, repeating the option for each root. The plugin cache is deliberately not scanned by default, because it holds every installed version and a blind scan would pass against whichever it met first.

The same rules run in the contract test, `bakers-cli/core/tests/workflow/step-contract.test.ts`. It also checks this repository's own `WORKFLOW.md` and shipped skills, so a change to a skill's `when` fails it if a triple is left uncovered or owned twice.

```sh
cd bakers-cli && pnpm exec vitest run core/tests/workflow/step-contract.test.ts
```

## Handoffs and review

Qualification records `review_actors`: role, account/selection rule, environment, source and
resolution status. `resolve-environment` confirms concrete access before actor-dependent checks.

`method-context/references/results.md` separates automated tests, agent inspection and human review.
Results retain actual actor, environment, observation, revision and evidence. Authored tests are not
executed tests. Agent inspection is not human acceptance.

Each owner supplies evidence; the last owner invokes `run-outtake` once. Typed comments retain full
records. The summary gives brief successes, actionable problems and actor-specific review resources.

## Size and verification

Every bakers.build `SKILL.md` permits 500 whitespace-separated words, including frontmatter/code.
`python3 tests/contract/skill-size.py` enforces this in CI. References contain conditional details;
remove repetition instead of moving entire instructions elsewhere.

[Test a skill](/advanced/development/test-skills) covers isolated generation and offline replay.
These evaluations use synthetic facts, without live integration.
[Add a skill test](/advanced/development/add-skill-test) documents profiles and CI coverage;
the [run-outtake case](/advanced/development/test-run-outtake) checks coding presentation and login URLs.
