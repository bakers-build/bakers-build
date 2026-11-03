<p align="center">
  <img src="docs/assets/logo.svg" alt="bakers.build" width="380">
</p>

<p align="center">
  <strong>A ticket-driven orchestrator where every active ticket state is worked by a human or an AI.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bakers-build/bakers"><img src="https://img.shields.io/npm/v/@bakers-build/bakers?color=12B886&label=%40bakers-ai%2Fbakers" alt="npm"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.19-1FA97A" alt="node">
  <img src="https://img.shields.io/badge/license-GPL--2.0--or--later%20%7C%20MIT-0E7C63" alt="license: GPL-2.0-or-later (server), MIT (CLI and skills)">
</p>

---

> Inspired by [OpenAI Symphony](https://github.com/openai/symphony), extended with a Drupal control-plane, distributed conductors, Delivery Point billing, and internal cost allocation.

Start with the [bakers.build manual](docs/index.md) for setup, configuration and AI-assisted ticket work.

## Install

### 1. The CLI (runtime)

The `bakers` CLI (conductor + write-back client) is published to npm as **`@bakers-build/bakers`** — its
plugins (`@bakers-build/addon-*`) and `dropsh` come along as dependencies:

```bash
npm install -g @bakers-build/bakers      # provides the `bakers` command (Linux / macOS / Windows)
bakers --help
```

### 2. The `/bakers` skill in Claude Code (recommended)

bakers.build ships its own Claude Code marketplace, so agents (and you) get the `/bakers` ticket-workflow
skill. Add the marketplace and install the plugin:

```
/plugin marketplace add https://bakers.build/marketplace.json
/plugin install bakers@bakers
```

Pull updates later with `/plugin marketplace update bakers`.

### 3. Bootstrap a project

**Default (guided, via the skill):** run `/bakers init` in Claude Code — it scaffolds
`.bakers/conductor.config.js` + the user-global machine context, logs in (`dropsh auth`), and
generates the repo's `WORKFLOW.md`.

```
/bakers init
```

**Or with the CLI directly** (no Claude):

```bash
bakers init --base-url <control-plane-url> --project <name>   # scaffold .bakers/conductor.config.js + machine context
```

### Run the conductor node

```bash
bakers oven start                                        # claim + dispatch loop (hosted in herdr)
bakers oven start --foreground --log-level=debug         # run in the foreground
```

`bakers oven start` is the node agent itself — one per project checkout, tracked in a local
registry (like `ddev`). There is no central daemon and no TCP.

### Working on the CLI itself (dev build)

When hacking on the conductor in this repo, call this checkout's build by explicit path instead of
the global install:

```bash
cd bakers-cli && pnpm install && pnpm build:all   # build dist + plugins
./bakers-cli/bin/bakers <cmd>                        # from the repo root: THIS checkout's build
```

A bare `bakers` inside a bakers checkout is the **released** CLI (BB-390): the `~/.local/bin/bakers`
shim only selects a checkout's own build inside a skill-test workspace, so an unbuilt or broken
branch build never breaks unrelated tooling in the worktree. There is no `bakers-dev`; BB-84
retired it.

## The idea in one paragraph

Coding agents are fast, but the bottleneck is human attention spent micro-managing many sessions.
bakers.build inverts that: **the issue tracker becomes the control plane.** Every active ticket has a
state; the state points at a handler. A registered **conductor** claims dispatchable tickets and
starts/attaches agents through spawn plugins. Human questions, approvals, and reviews run as
`human_assist` runs too: a local conductor prompts the human with context and the session writes
back after confirmation. A separate commercial and worklog context links to bakers.build Projects and
Tickets through one-way Domain Links. It owns Engagements, Delivery Items, Delivery Points,
Worklogs, and Billable Units; bakers.build execution entities never link back.

## Guiding principles

1. **Control-plane = single source of truth (Drupal).** Tickets/states live in Drupal.
2. **Repo workflow = instruction text.** The state machine (incl. handler/skill selection) is
   code-defined per ticket type; a repo `WORKFLOW.md` only adds project-specific working rules as
   text for sessions.
3. **The conductor claims + dispatches.** Concurrency (slot accounting), workspace, and executor
   selection — no probe/reconcile, no ticket-state writes. The agent session owns the run
   lifecycle (Model B); the crash backstop is the lease TTL.
4. **Agents are autonomous.** State transitions, comments, sub-tickets, footprint — and releasing
   their own run — are written back by the session itself via `BbRemote` (the dropsh lib).
5. **Model-agnostic.** The agent is swappable (Claude Code default, Codex, …), selectable per
   project/ticket/handler.
6. **Canonical domain model (Linear-style).** No foreign-system entities — imports normalise; the
   source system is only metadata.
7. **Ticket = unit of dispatch and delivery.** A `Run` is a concrete execution attempt with claim
   and audit. Billing uses the separate model defined in `07-billing.md`; no commercial fields or
   reverse links are added to bakers.build entities, and Runs are never persistent link targets.

## Handlers instead of roles

bakers.build no longer models fixed role entities. **State handlers are code state metadata** (per
ticket-type workflow) — skill/handler, role, mode, and capabilities. Each handler runs as a
spawned session via a spawn plugin: `ai_run` autonomously, `human_assist` requests human input.

| Handler | Purpose |
|---|---|
| `qualification` | classify the ticket and publish its qualification handoff, create sub-tickets if needed |
| `spec` | sharpen requirements |
| `code` | implement in the workspace |
| `review` | check and return/accept |
| `human_input` | human question/approval/decision via a `human_assist` run: the agent prompts, the human decides, the session writes back |

Concrete names are project-dependent. There is no separate HERMES orchestrator as a domain object.

## Component map

```mermaid
flowchart TB
    subgraph CP["DRUPAL — control plane (source of truth)"]
        IMP["Import (Migrate)<br/>GitLab · Jira · Harvest"]
        DOM["Domain<br/>Group · Project · Ticket · Run"]
        SM["state_machine<br/>ticket state"]
        WF["Project instructions<br/>(WORKFLOW.md text/hash)"]
        DASH["Dashboard / Board"]
        JAPI["JSON:API (read)"]
        TAPI["dropsh write-back<br/>(write)"]
        IMP --> DOM
        DOM --- SM
        DOM --- WF
        WF --- SM
        DOM --- DASH
        DOM --- JAPI
        DOM --- TAPI
    end

    subgraph CON["CONDUCTOR — Node/TypeScript supervisor"]
        POLL["poll tick"]
        REC["reconcile"]
        DISP["claim + dispatch<br/>ticket state → handler"]
        POLL --> REC --> DISP
    end

    subgraph EX["EXECUTION"]
        CC["cloud coder (SSH)<br/>ddev workspace / ticket"]
        AD["spawn plugin<br/>herdr · stdio · future"]
        LOC["local node<br/>human_assist session + human"]
        CC --- AD
    end

    JAPI -->|read dispatchable tickets| POLL
    DISP -->|run via spawn plugin| CC
    DISP -->|human_assist: agent requests input| LOC
    AD -->|state · sub-ticket · footprint| TAPI
    LOC -->|human confirms in session| TAPI
    DASH -.->|monitoring/board only| DOM
```

## Documentation

| File | Contents |
|---|---|
| [`07-billing.md`](docs/decisions/time-tracking-and-billing.md) | Separate commercial/worklog context, one-way Domain Links, Delivery Points, and Harvest boundary |

## Join this repository

Repository: `bakers-build/bakers-build`; bakers.build project: `bakers`. The committed `.bakers` configuration targets
the team's develop control plane. Obtain your own credentials and workspace access from the
operator; inspect the effective connection before running commands. Follow [join a project](docs/get-started/first-ticket.md)
and then `WORKFLOW.md`. A team conductor may supply execution capacity. Local test work uses
the playground set up by `scripts/setup-test-project.sh`.

## License

This repository holds components under different licenses, all © keytec GmbH unless noted:

- **Server** (Drupal modules, theme, recipes, configuration): GPL-2.0-or-later, see [`LICENSE.txt`](LICENSE.txt).
- **CLI** (`bakers-cli/`, the `@bakers-build/*` npm packages): MIT, see [`bakers-cli/LICENSE`](bakers-cli/LICENSE).
- **`bakers` plugin skills** (`.claude/skills/bakers-build/`): MIT, see its `LICENSE`.

Third-party material keeps its own license and notices. [Licensing](docs/bakers/licensing.md) maps every
shipped component to its source, license and evidence, and lists what is not yet cleared for publication.
