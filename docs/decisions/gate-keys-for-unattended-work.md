# Gate keys for unattended work

- **Status:** Accepted 2026-11-14 and implemented (section 8).
- **Scope:** which human waits a run passes on its own, chosen per ticket by a label; how a run reads
  that at each state and how the ticket records who passed each wait. Not in scope: enforcing who may
  set a label, and the label terms in each workspace.

## Recommendation

Name the human waits the `bb-workflow` frame already has as **gates**, and let a ticket label say
which gates the run passes on its own. Three labels cover the needed procedures: `auto-review`
(a person reviews and merges), `auto-accept` (a person accepts the result) and `auto` (unchanged,
everything). Without a label, every gate waits for a person, as today. The frame defines the gates
and the default gate set for each shipped type; a recipe adds gates or declares the gates of its own
types. Every handoff records in a `### Gates` block who passed each gate and whether the run's
recommendation was followed.

Why: one meaning per label in every project, own types and recipes possible without a frame change,
and no migration for tickets that carry `auto` today.

## 1. Today

No conductor, server (`bb_core`) or CLI source reads `auto` or `ticket-question`. Only skills read
them; one script writes `auto`.

| Where | Path | What it does |
|---|---|---|
| Frame | `.claude/skills/bakers-build/skills/bb-workflow/SKILL.md` (*Routing* 1) | loads the installed `bb-label-<label>` skill for each ticket label and follows it in every state |
| `auto` | `.claude/skills/bakers-build/skills/bb-label-auto/SKILL.md` | authorizes every transition, origin status and the merge; the run decides technical questions and records them under `Decisions`; one user question per run; an unplanned risky change is a technical problem that ends the run |
| `ticket-question` | `.claude/skills/bakers-build/skills/bb-label-ticket-question/SKILL.md` | the run reaches a human only through the ticket: a `# Question` comment with label `Question`, or `# Error`/`# Architecture` with label `technical problem`, then `frozen: true`; authorizes only these writes |
| Host hand-over | the host's conversation, documented in `docs/skills-and-workflows/types-recipes-labels.md` (*Labels*) | the host adds `auto` (and `ticket-question`) when it hands a specified ticket over; `bb-create-ticket` never adds it (checked by `tests/skill-eval/profiles/create-ticket-handover.mjs`) |
| CI failure | `scripts/ci/github-failure-ticket.sh` | creates a `bug` with recipe `superpowers`, assigns the `cw-framework` conductor and adds `auto` |
| Docs | `types-recipes-labels.md`, `workflow-file.md`, `docs/development/skill-contract.md`, `docs/bakers/github-migration.md`, `docs/bakers/development-skills.md`, `.claude/skills/bakers-build/README.md` | describe the labels |
| Tests | `tests/skill-eval/fixtures/auto-*.json`, `label-route-probe.json`, `tests/skill-eval/profiles/bb-label-auto.mjs`, `bakers-cli/core/tests/workflow/skill-state-evals.test.ts`, `skill-tool-calls.test.ts`, `bakers-cli/core/tests/packaging/github-failure-ticket.test.ts`, `tests/contract/skill-references.py` | assert today's behavior |

What `auto` authorizes per state today:

| State | Without a label | With `auto` |
|---|---|---|
| qualification | the person approves the criteria | the run approves and moves to `plan` |
| plan | the person approves spec, plan and test (bug: diagnosis) | the run approves and moves to `working` |
| working | the person confirms the summary and MR and picks the destination | the run moves to `review`; asks one acceptance only if something was the user's to decide |
| review | the person confirms the verdict and authorizes the merge | the verdict stands; `OK` merges once acceptance or "no acceptance due" is recorded |

`ticket-question` changes none of these; it only moves the questions from the session to the ticket.

## 2. Gates

A gate is a named human wait that the frame already has. The catalog:

| Gate | State | A person… |
|---|---|---|
| `qualification` | qualification | approves the acceptance criteria |
| `prior-art` | qualification, working | decides on a prior-art hit (build anyway, fold, drop) |
| `agent-choice` | qualification | confirms a proposed agent label |
| `plan` (bug: `diagnosis`) | plan | approves spec, plan and test, or the diagnosis |
| `coding` | working | confirms the coding summary and MR and the destination |
| `result` | working | sees the result (preview link, else MR) and accepts it |
| `criterion` | any | decides a criterion the run cannot decide |
| `verdict` | review | confirms the review verdict |
| `merge` | review | authorizes the merge |

Default gate sets, defined by the frame in a new `bb-workflow/references/gates.md`:

| Type | Gates |
|---|---|
| feature, chore | qualification, prior-art, agent-choice, plan, coding, criterion, verdict, merge |
| bug | the same with `diagnosis` for `plan` |
| deployment | qualification, plan (release and version), coding, merge |
| verification | qualification, plan (the verified set), coding |

`result` is in no default set; `auto-accept` adds it (section 3), and `auto` adds it only when
something was the user's to decide, as today.

A recipe has a `## bb-gates` section, one row per type it declares. For a shipped type it may only
add gates. For its own type (a new vocabulary term) the row is required; a missing row is a stop
rule failure. A recipe may define its own gate as "a person confirms <what> in <state>/<phase>",
named `<recipe>:<gate>`.

## 3. Labels

A label says which gates the run passes on its own. It stays fixed for the ticket's life.

| Label | A person passes | The run passes |
|---|---|---|
| none | every gate | none; it does the work between gates |
| `auto-review` | `verdict` and `merge`, as the ticket's reviewer | every other gate, up to the published verdict |
| `auto-accept` | `result`; also `verdict`, as the reviewer, when a planned change touches the risk list | every other gate; merges after acceptance |
| `auto` | only a user question on what the criteria leave open, and `result` when that happened (unchanged) | everything else, `criterion` and merge included |

- **Risk list** (from `bb-label-auto`): a dependency, the data model, a public interface,
  authentication, permissions, build, CI or deployment configuration. Under every label an
  *unplanned* risky change stays a technical problem that ends the run.
- **Recipe gates** (`<recipe>:<gate>`) wait for a person under `auto-review` and `auto-accept`;
  `auto` passes them.
- **Deployment and verification**: `auto-review` and `auto-accept` do not apply; a run that finds
  one stops with a question. `auto` keeps today's behavior.
- **`auto-review` without a reviewer** stops with a question at the first state that finds it.
- **`ticket-question`** stays a modifier on any label: it decides where the run asks, never which
  gates it passes. No rule is derived from the assignee, because an empty assignee becomes the
  conductor's owner.
- The recipient profile decides no gate.

## 4. Defaults by starter and type

Today's behavior stays the default. A starter is whoever creates the ticket and sets its label.

| Starter | feature | bug | chore | epic | deployment | verification | own type |
|---|---|---|---|---|---|---|---|
| Person (UI, CLI, `bb-create-ticket`) | none | none | none | none | none | none | none |
| Host hand-over of a specified ticket | `auto` | `auto` | `auto` | does not occur | does not occur | does not occur | does not occur |
| CI failure script | does not occur | `auto` | does not occur | does not occur | does not occur | does not occur | does not occur |
| Verification regression bug | does not occur | none | does not occur | does not occur | does not occur | does not occur | does not occur |

- **Epic**: a parent ticket of one of the types above. Its label applies to itself only; each child
  carries its own label, set by its own starter.
- **Override** on one ticket: add, change or remove the label (`bakers_ticket_update` or the UI).
  The new label applies from the next run; a running run keeps the label it started with.
- **Who may set which label**: Contributor and Lead may set `auto-review`; only a Lead may set
  `auto-accept` and `auto`. Nothing enforces this yet (`labels` is a plain reference field);
  enforcement in `bb_core` is a follow-up.

## 5. What a run may do, per label and state

"Alone" means the run passes the gate and moves on; "stop" means it publishes its handoff and waits
for a person. Questions go to the session, or to the ticket under `ticket-question`.

| State | none | `auto-review` | `auto-accept` | `auto` |
|---|---|---|---|---|
| qualification | stop for `qualification`; ask on a prior-art hit and agent choice | alone; transition to plan | alone; transition to plan | alone; transition to plan |
| plan | stop for `plan`/`diagnosis` | alone; transition to working | alone; record whether the plan touches the risk list; transition to working | alone; transition to working |
| working | stop for `coding` | alone; transition to review | stop for `result` (preview link, else MR); after acceptance transition to review | alone; ask `result` only when due; transition to review |
| review | publish verdict; stop for `verdict` and `merge` | publish verdict; stop: the reviewer confirms and authorizes the merge | publish verdict; with a planned risky change stop for the reviewer's `verdict`; otherwise merge alone | verdict stands; merge alone after acceptance or "no acceptance due" |
| done | reached only after an authorized merge | after the reviewer's merge authorization | after acceptance (and the reviewer's verdict when due) | after the merge |

Under every label: a failed check or `Not OK` verdict goes back to `working` when coding can fix
it; a technical problem ends the run; a `criterion` waits for a person, except under `auto`, which
decides it itself and asks only what is the user's to decide.

## 6. Visibility and recording

- The label on the ticket is the procedure; the run reads it at every state through the frame, as
  it reads `bb-label-<label>` today.
- No new comment type. A person's decision is their `comment`. Under a label, each handoff
  (`coding`, `review`, `summary`) carries `### Gates`, one line per gate passed since the last
  handoff; without a label every gate is a person's comment already:

  ```markdown
  ### Gates

  - plan: passed — by run (auto-review) — recommendation approve, followed yes
  - verdict: rejected — by <person> (comment <id>) — recommendation OK, followed no (risky migration)
  ```

- A metric on `followed: no` is optional and a follow-up.

## 7. Alternatives rejected

| Alternative | Why not |
|---|---|
| A label per stage, swapped as the ticket moves | fragile: every transition must rewrite labels, and a lost write changes the procedure |
| One `procedure:<name>` label keyed by starter | the ticket has no starter field; use-case labels (`auto-review`, `auto-accept`) say more than procedure names |
| A `WORKFLOW.md` mapping from (starter, type) to a procedure, or a combination with labels | breaks the skill contract (`WORKFLOW.md` contributes only `## bb-phase-<phase>`), and a label would mean different things in different projects |
| Gates decided by the recipient profile | the profile is self-declared and carries no authority today |
| Story points or `time_estimate` as a merge condition | the run sets its own estimate, so it would decide its own merge |
| One skill per type | today a type differs only by a gate row; a later option if types grow behavior |

## 8. Changes and migration

`auto` keeps its meaning: existing `auto` tickets and `scripts/ci/github-failure-ticket.sh` need no
migration. The implementation changed:

- **Frame**: `bb-workflow/SKILL.md` (the *Stop rule* covers a missing `## bb-gates` row of an own
  type) and new `references/gates.md` (catalog, gate sets, recipe rows, risk list, `### Gates`
  record), reached through the label skills' links. The state files and the waits
  (`coding-gate.md`, `review.md`, `agent-choice.md`, `prior-art-search.md`, `ticket-writes.md`,
  `outtake.md`) keep their text: a label skill passes them, as `bb-label-auto` did before, and the
  per-state read budgets stay as they are.
- **Labels**: `bb-label-auto` (passes every gate; risk list moved to `gates.md`), new
  `bb-label-auto-review` and `bb-label-auto-accept`; `bb-label-ticket-question` unchanged.
- **Recipes**: `## bb-gates` in `bb-recipe-matt`, `bb-recipe-superpowers`,
  `bb-recipe-deploy-and-release` (its repeated tool-discovery phrase stated once, to stay within
  500 words), `bb-recipe-verify` and the test recipes.
- **Docs**: `docs/skills-and-workflows/types-recipes-labels.md`, `recipes.md`, `workflow-file.md`,
  `docs/development/skill-contract.md`, `docs/bakers/development-skills.md` (skill count, bundle
  0.71.0), `.claude/skills/bakers-build/README.md`. `docs/bakers/github-migration.md` and
  `docs/development/test-skill-tools.md` describe `auto` only and stay as they are.
- **Tests**: `tests/contract/skill-references.py` accepts `## bb-gates` and requires a row per
  declared type; the `bb-label-auto` skill-eval profile also serves the two new label skills, with
  the fixtures `label-auto-review-*` and `label-auto-accept-*` and their cases in
  `bakers-cli/core/tests/workflow/skill-state-evals.test.ts`; the simulated ticket read in
  `tests/skill-eval/tool-server.py` returns `reviewers`, as the real tool does.
- **Follow-up**: label terms `auto-review` and `auto-accept` in each workspace; label-permission
  enforcement in `bb_core`; an optional metric on `followed: no`.
