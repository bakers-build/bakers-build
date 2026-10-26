# Authoring recipes, runtime guides and hints

Read when writing or changing a recipe, a runtime guide, a project's `WORKFLOW.md`, or a core
skill's inputs. No CLI reads or validates these files; the native skill mechanism loads them and
`@bakers-build/bb-workflow` binds them.

## The six phases

`read, provision, work, validate, deliver, transition` are stable names. Every kind of guidance
puts its content under the phase it refines, so a run reads exactly the matching sections at each
phase. Keep the names verbatim; a section under another name is never read.

## Recipes

A recipe is one normal skill named `bb-recipe-<method>` per engineering method, domain-free and
runtime-free.

- **Description** names the method, the ticket types it covers, and `Project default` on at most
  one installed recipe. Qualification chooses from descriptions alone.
- **Sections** are named after the work states: `## plan`, `## working`, `## review`. A
  `### <type>` subsection appears only where that type behaves differently.
- Name the method's original skills; leave domain, runtime and project commands to guides and
  hints.
- A recipe may live in any plugin. It calls no other `@bakers-build/*` skill: inputs,
  publication, gates and transitions come from the frame's [plan](plan.md), [coding](coding.md)
  and [review](review.md) flows.

A ticket's `recipe` field names the recipe; its `ticket_type` field selects subsections. A
missing recipe, state section or uncovered type stops the run (`@bakers-build/bb-workflow` ›
*Required skills*).

## Runtime guides

A runtime guide is one normal skill named `bb-runtime-<tech>` that says how to provision, execute,
lint and test in one technology, under `## provision`, `## work` and `## validate`. Lore that only
some runs need sits in a reference behind a sharp conditional pointer. A project names its guide in
its `## provision` hint.

## Project hints

`WORKFLOW.md` is the entry line plus optional phase-named sections:

```markdown
# <project> — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## provision
## work
## validate
## deliver
```

`## work` and `## validate` hold `| When | Skill |` and `| When | Command |` tables; a run applies
every matching row. Repository conventions and test lore belong in repository docs that
`CLAUDE.md` points to, not in hints.

## Inputs — description + default, overridden per project

Lifecycle-specific parameters of core skills, such as release procedures, are declared
**inputs**. An input key is **`<role>.<kind>`**; the kind is a closed set:

| kind | contract |
|---|---|
| `.command` | a shell command, **run verbatim** |
| `.prompt` | an instruction, **followed verbatim** — never paraphrased, summarised, or replaced by equivalent reasoning of your own |
| `.data` | structured data, **looked up** — neither executed nor followed |

Each input carries a short `description` and a `default`, so a skill runs with no project config.
A project overrides a value in the `WORKFLOW.md` section of the phase where the skill runs, naming
the skill and the key. The effective value is the override if present, otherwise the default.

## Skill size

Every bakers.build `SKILL.md` has at most 500 whitespace-separated words, including frontmatter and
examples (`tests/contract/skill-size.py`). References have explicit loading conditions; remove
duplication before moving text.
