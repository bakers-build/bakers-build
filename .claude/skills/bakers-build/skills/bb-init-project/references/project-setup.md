# Project setup

For `project` or `all`, read [Prepare your project](https://bakers.build/get-started/connect-a-project)
for the overall setup and verification steps.
Read these guides from the bakers.build website, including the applicable linked guides before
recommending or configuring an integration. The project being configured is an external repository;
it does not need a bakers.build checkout or a local copy of its documentation.
If a required guide cannot be retrieved, report its URL and leave the affected choice unresolved
instead of substituting a template.

## Resolve and ask

Search the control plane for the requested project. Reuse an unambiguous hit and report its UUID;
otherwise invoke `@bakers-build/bb-create-project`. Use the returned entity's name for `--project`.
A denied lookup is not proof that the project is absent.

For each applicable row below, inspect existing settings and caller answers first.
Track its source, answer or explicit unresolved status; mark inapplicable rows with a reason.
Finish the missing decisions before treating the configuration as complete; creating a WORKFLOW
does not resolve its recipe/marketplace choice. Do not silently skip a row.
Name the source of a reused choice. Link the applicable documentation whenever explaining a choice.
Ask for **one field or decision per turn** and wait. Request related follow-up values in later turns:
profile commands and readiness checks are separate decisions, as are marketplace and workflow hints.
Before sending, count requested inputs and keep only the first unanswered field. A service key and
its match text are separate fields. “Answer the first question first” does not permit appending another.
Ask each lifecycle command separately. An installed
client is not a selected client. Unattended, keep unknown choices unresolved and report them.
**Done when every applicable choice has a source, an answer, or an explicit unresolved status.**

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
| Agents need repository delivery | Forge backend, repository, authentication and merge policy | [Forge](https://bakers.build/addons/forge), then its backend guide |
| Preview needed | Local or public; if public, transport, service and shared-write authorization | [Ports](https://bakers.build/addons/ports), [services](https://bakers.build/addons/ports-services), [tunnel policy](https://bakers.build/configuration/machine#preview-link-tunnels) |

## Persist the choices

Use [addon ownership](https://bakers.build/addons/configure), the linked configuration guides and current CLI help. Initialization supplies a starting
configuration, not the user's choices. Read back every generated setting; reconcile defaults with
the selected client and documented addon scopes. Preserve unrelated custom values and identities.

For documented settings without CLI flags, edit the selected configuration file directly within
the authorized scope, preserving existing code and values. Explain the change first. A requested
machine change needs shared-scope authorization; reuse authorization already given. If safe editing
is unavailable, report the exact choice and owning field as unpersisted. Never substitute another
choice or call the setup complete.
**Done when each answer matches its saved field, or a concrete blocker is recorded.**

## Workflow and verification

Follow the project's [workflow guide](https://bakers.build/skills-and-workflows/workflow-file).
Preserve existing `WORKFLOW.md`; for an absent file, the
[small skeleton](WORKFLOW.template.md) supplies the entry line and phase headings only.
Fill hints from the chosen setup and repository requirements. Show the origin-label table and
ask for missing vocabulary; remove it if the operator chooses no origin labels. Remove empty hints.
Verify named skills and report installed recipes through the agent's discovery facilities.

Follow the project guide's verification commands, including applicable ignore paths. Record
the final saved configuration after all edits, then reconcile it against every tracked decision.
Run the configuration checks after the last configuration write. Record actual command results;
report an unavailable command only after checking the available tools.
Distinguish local validity, sign-in, project access and runtime readiness. A local config check
is not proof that addons, provisioning or tunnels work.
