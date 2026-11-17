# Project setup

For `project` or `all`, read [Prepare your project](https://bakers.build/get-started/connect-a-project.md)
for the overall setup and verification steps, then the guides the matrix links before recommending
or configuring an integration, in full text under the
[setup conversation](../../bb-init/references/setup-conversation.md#read-syntax-in-full) rules.
The project being configured is an external repository; it needs no bakers.build checkout.
If a required guide cannot be retrieved, report its URL and leave the affected choice unresolved
instead of substituting a template.

## Check worktree compatibility first

Before configuration checks, server-project lookup or client/integration choices, read the
[worktree requirements](https://bakers.build/provision/guide.md#make-the-project-worktree-compatible).
Assess each requirement there against the repository's README, scripts and application configuration.
Reuse existing evidence and ask the gaps as one block, `Step n of m — Worktree`, with m counted
for the whole project setup. Report concrete file/command
evidence for each finding. Git worktree support alone does not establish application compatibility.
For known blockers, report the required application changes and stop setup until resolved;
perform repairs only within the authorized scope. Keep unknowns explicitly unverified.
**Done when each requirement has an evidence-based assessment and no known blocker remains.**

Explain why in one sentence: each ticket runs in its own worktree with its own runtime. Test it,
reporting each line as `pass` or `fail — <reason>`:

- Git: `git worktree add <tmp> HEAD`, then `git worktree remove <tmp>`; a failure quotes Git.
- Location: worktrees inside the checkout fail when the runtime forbids one project inside another;
  the Environment block's worktree-location row resolves it.

When the environment is available, verify the
[two-worktree isolation check](https://bakers.build/provision/guide.md#verify-independent-operation).
Until then, report runtime compatibility as unverified; source inspection is not a runtime pass.

## Resolve and ask

Search the control plane for the requested project. Reuse an unambiguous hit and report its UUID;
otherwise invoke `@bakers-build/bb-create-project` with the server project block's values.
Use the returned entity's name for `--project`. A denied lookup is not proof that the project is absent.

Resolve the matrix block by block under the
[setup conversation](../../bb-init/references/setup-conversation.md) rules: derive first, one
question per block, own decisions alone. Finish the missing decisions before treating the
configuration as complete; creating a WORKFLOW does not resolve its recipe/marketplace choice.
An installed client is not a selected client.
**Done when every applicable row has a source, an answer, or an explicit unresolved status.**

## Decision matrix

Load the linked documentation when its condition applies, then resolve only missing inputs.
The documentation owns configuration syntax and supported options; this matrix owns the setup
flow and the evidence that answers a row.

### Server project

The group is an own decision, never derived.

| When | Decide | Writes | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Project absent on the control plane | Group, teams, description, repository URL, `default_branch` | The control-plane project through `@bakers-build/bb-create-project`, including its `default_branch` | `git remote get-url origin` for the repository URL; the workspace's groups and teams to offer | — | `@bakers-build/bb-create-project` |

### Environment

| When | Decide | Writes | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Client unknown | Client, and its executor and worktree | `addons`, or `executor` and `worktree`, in `.bakers/project.config.js` | — (an installed client is not a selection) | — | [Clients](https://bakers.build/get-started/use-your-client.md), [slots](https://bakers.build/addons/slots.md) |
| Worktrees nest inside the checkout | Worktree location | A location option the worktree addon documents, or an `after_create` script that gives each worktree its own runtime name | `.ddev/` in the repository: nested DDEV projects conflict | — | [Worktree requirements](https://bakers.build/provision/guide.md#make-the-project-worktree-compatible) |
| Lifecycle hooks unanswered | Each lifecycle hook by name: `after_create`, `before_run`, `after_run`, `after_done`, `on_freeze`, `on_resume`; none is a valid value | `hooks.after_create`, `hooks.before_run`, `hooks.after_run`, `hooks.after_done`, `hooks.on_freeze`, `hooks.on_resume` in `.bakers/project.config.js` | Existing project scripts; the runtime addon's page | — | [Hooks](https://bakers.build/configuration/project/hooks.md) |
| Tests or previews need an environment | `provision_up` profiles and their commands | `hooks.provision_up` in `.bakers/project.config.js` | Existing provisioning scripts; `.ddev/` or another runtime's configuration | `provision_up` lets a sandboxed agent bring its environment up by naming a profile, never the command. | [Environment](https://bakers.build/provision/guide.md), [provision_up](https://bakers.build/configuration/project/hooks.md#provision-on-an-agent-s-request) |
| A profile serves a site | Readiness check per profile | `WORKFLOW.md` `bb-phase-provision` hint | The base URL the profile prints | — | [provision_up](https://bakers.build/configuration/project/hooks.md#provision-on-an-agent-s-request) |
| Agents run commands in the project's containers | `provision_exec` keys, one fixed command each | `hooks.provision_exec` in `.bakers/project.config.js` | Test and lint commands in the repository's scripts and CI | The sandboxed agent cannot call the environment's CLI; `provision_exec` keys are the controlled way in. | [Run a configured command](https://bakers.build/configuration/project/hooks.md#run-a-configured-command) |

### Permissions

Both rows are own decisions; recommend as the [machine matrix](../../bb-init/references/machine-setup.md) does.

| When | Decide | Writes | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Permissions unknown | Project permission mode and its effective source | `permissions.mode` in `.bakers/project.config.js` | `permissions` in project and machine configuration | — | [Execution security](https://bakers.build/provision/security/execution.md) |
| The project needs access beyond the sandbox | Project grants: necessary write paths, trusted commands, network | `permissions.sandbox` in `.bakers/project.config.js` | The commands the environment block chose | A grant is a project setting that loosens the sandbox on every machine that accepts it. | [Shared settings](https://bakers.build/provision/security/shared-settings.md) |

### Delivery

Forge authentication and the merge policy are own decisions.

| When | Decide | Writes | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Agents need repository delivery | Forge backend and repository; a repository-specific entry goes in the project file, authenticated by a login or a `*_env` key | The forge entry's `backend` in `.bakers/project.config.js` `addons` | `git remote get-url origin` | — | [Forge](https://bakers.build/addons/forge.md), then its backend guide |
| Forge chosen | Forge authentication | `backend.with.auth` or a `*_env` key of the forge entry | `gh auth status` or `glab auth status` | — | The backend guide |
| Forge chosen | Merge policy per base branch | `with.merge` of the forge entry | The forge's repository merge settings (`gh repo view`, `glab repo view`) | — | [Forge](https://bakers.build/addons/forge.md) |
| Forge chosen | Target branch | `WORKFLOW.md` `bb-phase-deliver` hint | A new project: its `default_branch` from the server-project block. Otherwise the base branches of recently merged requests (`gh pr list --state merged`, `glab mr list --merged`) | — | [Forge](https://bakers.build/addons/forge.md) |

### Workflow

| When | Decide | Writes | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Workflow needs skills or recipes | `marketplaces` entries: plugins and pinned refs | `marketplaces` in `.bakers/project.config.js` | The installed `bb-recipe-*` skills and their entries in [shipped recipes](https://bakers.build/skills-and-workflows/recipes.md#shipped-recipes-and-their-plugins); a marketplace the agent already knows | — | [Marketplaces](https://bakers.build/configuration/project.md#agent-plugins) |
| Agent known | Project settings its agent guide recommends | The file the agent guide names | The agent guide | — | [Agents](https://bakers.build/agents/index.md), then the agent's guide |
| `WORKFLOW.md` absent or incomplete | Hints and origin labels | `WORKFLOW.md` hints and `bb-phase-transition` table | The environment block's profiles and keys; existing `WORKFLOW.md` | — | [Workflow file](https://bakers.build/skills-and-workflows/workflow-file.md) |

### Preview

| When | Decide | Writes | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Preview needed | Local or public; if public, the service key and its match text. Tunnel policy and transport are machine rows: hand them to `@bakers-build/bb-init` | `with.services` of the `@bakers-build/addon-ports` entry in `.bakers/project.config.js`; tunnel rows go to the machine file | The process a `provision_up` profile starts | — | [Ports](https://bakers.build/addons/ports.md), [services](https://bakers.build/addons/ports-services.md) |

For herdr-app, initialize with `--executor @bakers-build/addon-herdr-core`;
its preset brings `@bakers-build/addon-workspace-git`. Use that pair without a separate
workspace-addon question. For another client, resolve any missing executor/worktree choice
from the slots guide.

## Persist the choices

Place new host-executed hook and provisioning scripts, including their host-side helpers, under
`.bakers/scripts/` and point every caller there. `.bakers/` is always read-only during isolated
runs. For existing scripts elsewhere, explain the proposed move and affected callers, then obtain
consent before moving them; general project-write authorization alone is not migration consent.
List every other path the host executes or reads as trusted (such as `.ddev` or `.github`) in the
project's `runtime.read_only`: the list is the project's alone, with no addon default. Under an
isolating runtime each hook, `provision_up` and `provision_exec` command must start with a script
in a listed path, and that script calls only protected code; anything the run can write, such as
a dependency install or a build, belongs in a container. Offer one fixed `provision_exec` key per command
agents run in the project's containers; add `args: true` only where the command needs input its script
validates. A declined or unanswered move stays unresolved; report
the path and protection gap. Nested entries protect their entire top-level project folder against
ancestor renames; explain this scope when obtaining consent.

Place each addon in its owning file: agent harnesses in `~/.bakers/machine.config.js` only; herdr,
server remote and Git workspace in `.bakers/project.config.js` only; every other addon as its guide
says. Use the linked configuration guides and current CLI help. Initialization supplies a starting
configuration, not the user's choices. Read back every generated setting; reconcile defaults with
the selected client and documented addon scopes. Preserve unrelated custom values and identities.

For documented settings without CLI flags, edit the selected configuration file directly within
the authorized scope, preserving existing code and values. Explain the change first. Hand a
requested machine change to `@bakers-build/bb-init`; reuse shared-scope authorization already given. If safe editing
is unavailable, report the exact choice and owning field as unpersisted. Never substitute another
choice or call the setup complete.

An agent guide's recommended project settings are a proposal: write only what the operator
chooses, merged into the file the guide names with every existing key kept. Unattended, write
nothing and report the proposal.
**Done when the configuration read back after the last write matches every answer, or a concrete
blocker is recorded.**

## Workflow and verification

Follow the project's [workflow guide](https://bakers.build/skills-and-workflows/workflow-file.md).
Preserve existing `WORKFLOW.md`; for an absent file, the
[small skeleton](WORKFLOW.template.md) supplies the entry line and phase headings only.
Fill hints from the chosen setup and repository requirements. Show the origin-label table and
ask for missing vocabulary; remove it if the operator chooses no origin labels. Remove empty hints.
Verify named skills and report installed recipes through the agent's discovery facilities.

Ensure the project's `.gitignore` carries every ignore rule the project guide lists, adding the
missing ones as part of project setup, then prove each path with `git check-ignore -v`.
Run the guide's verification commands and the configuration checks, offline and online, after the
last configuration write. Record actual command results;
report an unavailable command only after checking the available tools.
Distinguish local validity, sign-in, project access and runtime readiness. A local config check
is not proof that addons, provisioning or tunnels work.

## Start the session

With project/all checks green, ask once whether to start working now. On yes, start the
conductor with `bakers conductor start` through the configured client (herdr: a new tab), confirm
it runs, and offer a first trial ticket through `@bakers-build/bb-create-ticket`; the conductor
opens its agent session in that client. A no, a failed check or an unattended run ends with the
start command as the next action.
**Done when the conductor runs or the person declined.**
