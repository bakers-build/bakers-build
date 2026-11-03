# Skill contract

A ticket state is run by one frame skill, `bb-workflow`, which routes the state to its state file and binds the recipe, the runtime guide and the project's hints; this page states how those pieces fit together.

bakers.build ships no workflow engine and no loader. It ships skills, which are Markdown instructions an agent reads, and the agent's native skill mechanism loads them. No CLI command reads or validates them. For the practical path, see [How it works](/configuration/workflows#how-it-works) and [Configure your workflow](/configuration/workflows/workflow-file). The authoring reference is `.claude/skills/bakers-build/skills/bb-workflow/references/authoring.md`.

## Skills and references

A skill is something that is *chosen*: by a person, by the ticket's `recipe` field, by a provision hint, or as a subagent's start. bakers.build ships fifteen:

| Skill | Chosen by |
|---|---|
| `bb-workflow` | the `WORKFLOW.md` entry line; the frame of every state run |
| `bb-recipe-matt` | the ticket's `recipe` field; the project default, for `feature`, `bug` and `chore` tickets |
| `bb-recipe-superpowers` | the ticket's `recipe` field; the superpowers method for the same types |
| `bb-recipe-deploy-and-release` | the ticket's `recipe` field; for `deployment` tickets |
| `bb-recipe-verify` | the ticket's `recipe` field; for `verification` tickets |
| `bb-runtime-ddev` | the project's `bb-phase-provision` hint |
| `bb-verdict` | the review state, as its subagent's start |
| `bb-ticket-pingpong` | the project's `WORKFLOW.md` entry line, for a ticket labelled `ticket:pingpong` in `working` or `review` |
| `bb-init`, `bb-init-project`, `bb-create-project`, `bb-upgrade-project` | a person, for setup |
| `bb-create-ticket`, `bb-scope-change`, `bb-prepare-time` | a person, for a ticket or time proposals |

Everything that is only *read* is a reference of `bb-workflow`, under `bb-workflow/references/`: the four state files, reading the ticket, publishing a comment, provisioning, verification, the browser surface, the intake and outtake, measurements, merge and the state write. A reference is not a skill and cannot be invoked.

## The grid

A run is **state × phase**. Every state run passes seven phases in order: `read, provision, work, validate, deliver, outtake, transition`. Each state with a state file — `qualification`, `plan`, `working`, `review` — has exactly one `## <phase>` section per phase, and that section always runs: it owns gates, publication and transitions. Guidance adds a **slot** to a cell under a prefixed heading; a heading under another name is never read.

**Two-file rule:** what state X does for type Y reads from X's state file plus the recipe's slots for X.

## The frame

`bb-workflow` is the single entry point. A project's `WORKFLOW.md` starts with one line that invokes it. It reads the ticket through `references/read-ticket.md` and routes by state. The routing table has two rows:

| State | Flow |
|---|---|
| `qualification` | `references/qualification.md` |
| every other state | the recipe's `bb-state-<state>` section, run inside the state file of that name (`plan`, `working`, `review`) |

It then resolves the recipe, renders the intake (`references/intake.md`) once and starts the state file's `## read`. A state without a state file stops the run and names the state.

Every ticket runs the one workflow `bb_work`: `qualification → plan → working → review → done`. A deployment and a verification are tickets of type `deployment` and `verification` whose recipes, `bb-recipe-deploy-and-release` and `bb-recipe-verify`, say what `plan`, `working` and `review` mean for them.

`plan`, `working` and `review` first apply `references/ensure-qualification.md` and continue only on `qualified`. Provisioning is lazy: the runtime is brought up before the first action that needs it, and skipped when nothing does.

## Recipes

A recipe is one skill named `bb-recipe-<method>` per engineering method, free of domain and runtime. Its description names the method, the ticket types it covers and, on at most one installed recipe, `Project default`; qualification chooses from descriptions alone. Its sections are `## bb-state-<state>` and, where a type differs, `## <type>:bb-state-<state>`; each holds `### bb-phase-<phase>` slots only where the method adds something. Per phase the type slot wins, then the general one, else none. A slot supplies method; where it names its own deliverable, comment, merge or check, that replaces the state file's default. Approval, the coding gate, the verdict and every readback stay, and a transition slot only picks among the gate's destinations. A recipe names the method's original skills, links no `bb-workflow` reference, calls no other bakers.build skill, and leaves domain, runtime and project commands to guides and hints. A recipe may live in any plugin. The shipped recipes are `bb-recipe-matt` (project default), `bb-recipe-deploy-and-release` and `bb-recipe-verify`.

The ticket's `recipe` field names the recipe, without the `bb-recipe-` prefix; empty means the project default. Its `ticket_type` field selects the type slots.

## Runtime guides

A runtime guide is one skill named `bb-runtime-<tech>` that says how to provision, execute, lint, test and hand over persona logins in one technology, under `## bb-phase-<phase>` sections. A project names its guide in its `## bb-phase-provision` hint. The shipped guide is `bb-runtime-ddev`.

## Project hints

`WORKFLOW.md` is the entry line plus optional `## bb-phase-<phase>` sections and nothing else. `## bb-phase-work` holds a `| When | Skill |` table and `## bb-phase-validate` a `| When | Command |` table; a run applies every matching row. `## bb-phase-outtake` names the test-user list and how personas get logins. `## bb-phase-transition` holds the origin-label table (`| State | Origin label |`), the only source `references/origin-status.md` reads; without the table no origin label is ever written. Repository conventions and test lore belong in repository docs that `CLAUDE.md` points to.

## Binding and stop rules

Recipe sections and hint rows are binding: the agent loads every skill they require, reading its complete `SKILL.md`, before the work it governs, and announces what it loaded. A hint may mark a skill advisory. A required skill is replaced only when the user explicitly asks, and the outtake names the replacement.

If the recipe, its state section, the ticket's type among the recipe's declared types or a required skill cannot be resolved, the run stops and reports the exact identifier, before it edits a file, commits, publishes a comment, asks for confirmation or transitions the ticket.

## References route nothing

A reference produces one outcome and chooses no destination. Two exceptions exist: `references/ensure-qualification.md` may send a ticket back to `qualification`, and the `bb-create-ticket` skill owns the first routing of a new ticket. The global rules every run keeps live in `bb-workflow` and its references.

## Handoff and transition order

Every state finishes in the same order. At `outtake` it publishes the typed handoff and one `summary` rendered through `references/outtake.md`, prints it, completes any confirmation the state requires and records optional measurements. At `transition` it publishes the status to the origin issue when authorized, then writes the ticket's next state and reads it back. After the state write the run stops, because the conductor ends the run shortly after it. Handoffs and ticket text are Markdown in the `bb_rich` format, which strips raw HTML.

## Handoffs and review

Qualification records `test_as`: the test personas who check the change and what each should see.
Provisioning (`references/provision.md`) confirms each persona exists, and the runtime guide's `bb-phase-outtake` issues its login link.

`bb-workflow/references/results.md` separates automated tests, agent inspection and human review.
Results retain persona, environment, observation, revision and evidence. Authored tests are not
executed tests. Agent inspection is not human acceptance.

Each state renders the outtake once. Typed comments retain full
records. The summary gives brief successes, actionable problems and persona-specific review resources with login links.

## Size and verification

Every bakers.build `SKILL.md` and every file under `bb-workflow/references/` permits 500 whitespace-separated words, including frontmatter and code; `references/retrospective.md` is the listed exception.
`python3 tests/contract/skill-size.py` enforces this in CI. Remove repetition instead of moving entire instructions elsewhere.

`python3 tests/contract/skill-references.py` is the one structure check: links resolve, retired skill names are absent, grid headings are valid, every state file has the seven phases, `WORKFLOW.md` holds only `## bb-phase-*` sections, recipes link no frame reference and call no other bakers.build skill, no skill declares an input, exactly the bundle's skills exist, no contributor-facing file requires a private keytec skill, and every project skill `WORKFLOW.md` names exists under `.claude/skills/`. No skill check asserts a sentence.

[Test a skill](/configuration/project/contributing#test-skills) covers isolated generation and offline replay.
These evaluations use synthetic facts, without live integration.
[Add a skill test](/configuration/project/contributing#add-skill-test) documents profiles and CI coverage;
the [outtake case](/configuration/project/contributing#test-run-outtake) checks coding presentation and login URLs.
