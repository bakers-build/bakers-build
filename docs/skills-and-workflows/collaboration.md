# Decide when people approve

Choose how far the agent may go on a ticket. Without an automation label, a person approves each workflow gate. Labels change who passes those gates; they never make failed checks pass.

## Choose your level of involvement

| You want to… | Set on the ticket | Where a person decides |
|---|---|---|
| Approve each step, including every spec | No `auto`, `human-review` or `human-accept` label | Criteria, plan, coding handoff, review verdict and merge |
| Let the agent work up to a review | `human-review` | The assignee or a reviewer confirms the verdict and authorizes the merge |
| Accept the result before delivery | `human-accept` | You accept the result at one link; a planned risky change also needs the assignee’s or a reviewer’s verdict |
| Let the agent finish independently | `auto` | Only choices left to you by the criteria; result acceptance is due only if you had such a choice |

Pick one mode. If `auto` and one `human-*` label are both present, the human mode wins. Both `human-*` labels together stop with a question. Deployment and verification tickets support `auto` or no automation label, not the two human modes.

Under the human modes, the assignee or any reviewer decides unresolved criteria, confirms the verdict and authorizes the merge; a service-account assignee cannot confirm. If nobody is eligible, the run asks for a reviewer. Any custom recipe gates still need a person. A change to dependencies, data models, public interfaces, authentication, permissions or build/deployment configuration counts as risky. An unplanned risky change stops automated work as a technical problem.

## Example: approve every spec

Remove any automation label from a small ticket and keep its normal approval gates. Let it reach plan.

**Verify:** the agent publishes its spec, plan and checks, then waits for your explicit approval before implementation. Say what needs changing or approve that scope. Approval of the plan is not permission to merge.

## Example: work unattended up to human review

Add the `human-review` label to a small feature ticket assigned to a person, or add a reviewer if the assignee is a service account. The agent can approve the criteria and plan, implement, run checks and obtain an agent review. When the verdict is OK, it waits for the assignee or a reviewer.

**Verify:** the handoffs record the gates passed by the label under `Gates`. The ticket reaches a published verdict without a merged change. The assignee or a reviewer then explicitly confirms that verdict and authorizes the specific merge. A service-account assignee without a reviewer must stop the run, not silently select somebody else.

For `human-accept`, verify instead that working pauses with one result link and waits for an explicit acceptance. For `auto`, check that the handoff records either your acceptance or why no acceptance was due. [Accept results](/skills-and-workflows/accept-results) explains how to inspect the result and submit findings.

## Receive questions on the ticket

Add `ticket-question` if you want questions in ticket comments rather than in the agent session. This can accompany any mode above.

**Example:** use no automation label, plus `ticket-question`. When plan needs approval, the agent posts a question and freezes the ticket. Answer in a newer comment, remove the **Question** label and unfreeze it. Keep `ticket-question` for future questions.

**Verify:** the agent resumes using your recorded answer. Silence is not approval. A technical problem is reported separately and needs a fix; do not unfreeze blindly. Only use this mode when somebody will answer.

## Optional: add a team label

An ordinary label is just a tag unless a built-in rule or an installed `bb-label-<label>` skill gives it behavior. For example, install this skill as `bb-label-support-note` through your agent's [skill mechanism](/skills-and-workflows/skills):

```md
---
name: bb-label-support-note
description: Use when a ticket has the support-note label to make its handoff useful to support staff.
---

In each handoff, add one plain-language sentence explaining the effect on
support staff, or state that there is none. Keep all workflow gates and
required evidence.
```

Add `support-note` to a small ticket. **Verify:** the log shows the skill loaded, and the handoff contains that sentence. Merely creating the label does not install the skill. Use the supplied modes above for approval policy; this example only changes the handoff.

[Agent labels and routes](/agents/guide) choose who runs the work. [Project rules](/skills-and-workflows/workflow-file) can separately mirror progress labels to a GitLab origin.

## Runtime labels

`runtime:<alias>` (optionally `runtime:<alias>@<state>`) picks the machine's runtime for the ticket, like an agent label. A label that chooses a runtime without isolation is ignored unless the machine sets `allow_unsandboxed`; an unknown alias fails the run. See [Slot catalogs](/configuration/slot-catalogs).

## Protected label namespaces

A label whose text before the first `:` is in `bb_core.settings:protected_label_namespaces` (initially `runtime`) can be added only with a workspace permission. Removing a protected label, and adding or removing any other label, work as usual.

| Permission | Allows |
|---|---|
| `set any <namespace> label on bb_ticket` | Any ticket in the workspace. Granted to the workspace **lead**. |
| `set <namespace> label on bb_ticket with own conductor` | Tickets assigned to a conductor you own. Granted to the **contributor**. |

"Own" means you own the ticket's assigned conductor, not the ticket. Members, guests and non-members have neither. Rules:

- The check runs on every save (form, JSON:API, `bakers_ticket_update`, templates), as the current user. A run's session token acts as the human's account but holds `write bakers via session scope`, and any actor holding it is refused, so a run cannot lift its own sandbox. Administrator roles hold that permission too and are refused as well: use a non-admin lead account.
- A ticket template is checked against its own conductor. A template run is checked as the trigger's owner, so a trigger fails when its owner lacks the grant. `bakers_ticket_create` takes no labels.
- Changing a ticket's conductor drops its protected labels, because the grant was for the old conductor. Only protected labels already on the stored ticket are dropped; a protected label added in the same save is kept if the actor may set it for the new conductor. To carry a dropped label over, re-add it in a second save.
- Reassigning tickets when a conductor is deactivated drops their `runtime:*` labels the same way.
- Renaming a label term to a protected name, or from one protected name to another, needs the `any` permission, because every ticket carrying the term gets the new name. The same session-scope rule applies. Creating a new term with a protected name stays open; adding it to a ticket is checked.

