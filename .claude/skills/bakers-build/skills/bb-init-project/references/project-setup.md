# Project setup

For `project` or `all`, read [Prepare your project](https://bakers.build/get-started/connect-a-project)
and its linked [setup decisions](https://bakers.build/provision/guide#choose-the-missing-settings).
In a source checkout, use
`docs/get-started/connect-a-project.md` and the corresponding local `docs/` pages for every link.
Load each applicable guide before recommending or configuring its integration. Missing documentation
blocks that choice; report the missing source instead of substituting a template.

## Resolve and ask

Search the control plane for the requested project. Reuse an unambiguous hit and report its UUID;
otherwise invoke `@bakers-build/bb-create-project`. Use the returned entity's name for `--project`.
A denied lookup is not proof that the project is absent.

For each applicable decision in the guide, inspect existing settings and caller answers first.
Track every row of the linked setup-decision table, with its source, answer or unresolved status.
Finish the missing decisions before treating the configuration as complete; creating a WORKFLOW
does not resolve its recipe/marketplace choice. Do not silently skip a row.
Name the source of a reused choice. Link the applicable documentation whenever explaining a choice.
Ask for **one field or decision per turn** and wait. Request related follow-up values in later turns:
profile commands and readiness checks are separate decisions, as are marketplace and workflow hints.
Ask each lifecycle command separately. An installed
client is not a selected client. Unattended, keep unknown choices unresolved and report them.
**Done when every applicable choice has a source, an answer, or an explicit unresolved status.**

## Persist the choices

Use the documentation's owning files and current CLI help. Initialization supplies a starting
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
Run the configuration checks after the last configuration write.
Record
actual command results; report an unavailable command only after checking the available tools.
Distinguish local validity, sign-in, project access and runtime readiness. A local config check
is not proof that addons, provisioning or tunnels work.
