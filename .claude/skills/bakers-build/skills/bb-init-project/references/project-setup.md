# Project setup

For `project` or `all`, read [Prepare your project](https://bakers.build/get-started/connect-a-project)
for the overall setup and verification steps.
Read these guides from the bakers.build website, including the applicable linked guides before
recommending or configuring an integration. The project being configured is an external repository;
it does not need a bakers.build checkout or a local copy of its documentation. Only inside a
bakers.build source checkout, read the same pages under its `docs/` to match the revision.
If a required guide cannot be retrieved, report its URL and leave the affected choice unresolved
instead of substituting a template.

## Check worktree compatibility first

Before configuration checks, server-project lookup or client/integration choices, read the
[worktree requirements](https://bakers.build/provision/guide#make-the-project-worktree-compatible).
Assess each requirement there against the repository's README, scripts and application configuration.
Reuse existing evidence and ask only about gaps, one at a time. Report concrete file/command
evidence for each finding. Git worktree support alone does not establish application compatibility.
For known blockers, report the required application changes and stop setup until resolved;
perform repairs only within the authorized scope. Keep unknowns explicitly unverified.
**Done when each requirement has an evidence-based assessment and no known blocker remains.**

When the environment is available, verify the
[two-worktree isolation check](https://bakers.build/provision/guide#verify-independent-operation).
Until then, report runtime compatibility as unverified; source inspection is not a runtime pass.

## Resolve and ask

Search the control plane for the requested project. Reuse an unambiguous hit and report its UUID;
otherwise invoke `@bakers-build/bb-create-project`. Use the returned entity's name for `--project`.
A denied lookup is not proof that the project is absent.

Resolve the matrix below row by row under the
[setup conversation](../../bb-init/references/setup-conversation.md) rules.
Finish the missing decisions before treating the configuration as complete; creating a WORKFLOW
does not resolve its recipe/marketplace choice.
Separate decisions, one turn each: profile commands and readiness checks; marketplace and workflow
hints; a service key and its match text; each lifecycle command. An installed client is not a
selected client.
**Done when every applicable row has a source, an answer, or an explicit unresolved status.**

## Decision matrix

Load the linked documentation when its condition applies, then resolve only missing inputs.
The documentation owns configuration syntax and supported options; this matrix owns the setup flow.

| When | Decide | Read |
|---|---|---|
| Client unknown | Client, executor and worktree | [Clients](https://bakers.build/get-started/use-your-client), [slots](https://bakers.build/addons/slots) |
| Application needs preparation or cleanup | Each lifecycle command separately | [Hooks](https://bakers.build/provision/hooks) |
| Tests or previews need an environment | Provisioning profiles, commands, then readiness checks | [Environment](https://bakers.build/provision/guide), [provision_up](https://bakers.build/configuration/project/hooks#provision-on-an-agent-s-request) |
| Workflow needs skills or recipes | Installed skills, required plugins and pinned sources | [Marketplaces](https://bakers.build/configuration/project#agent-plugins), [skills](https://bakers.build/skills-and-workflows/skills) |
| Permissions unknown | Mode, necessary access and effective source | [Execution security](https://bakers.build/provision/security/execution), [shared settings](https://bakers.build/provision/security/shared-settings) |
| Agent known | Project settings its agent guide recommends | [Agents](https://bakers.build/agents/), then the agent's guide |
| Agents need repository delivery | Forge backend, repository, authentication and merge policy | [Forge](https://bakers.build/addons/forge), then its backend guide |
| Preview needed | Local or public; if public, transport and service. The tunnel policy is a machine row: hand it to `@bakers-build/bb-init` | [Ports](https://bakers.build/addons/ports), [services](https://bakers.build/addons/ports-services) |

## Persist the choices

Use [addon ownership](https://bakers.build/addons/configure), the linked configuration guides and current CLI help. Initialization supplies a starting
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

Follow the project's [workflow guide](https://bakers.build/skills-and-workflows/workflow-file).
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
