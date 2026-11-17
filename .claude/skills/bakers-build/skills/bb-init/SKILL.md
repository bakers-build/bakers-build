---
name: bb-init
description: Use when preparing a machine for bakers.build, choosing its tooling, completing user sign-in, or diagnosing authentication without workspace access.
---

# Initialize a bakers.build machine and user

Documentation owns choices and commands; this skill guides the conversation. Return project setup to
`@bakers-build/bb-init-project`.

## Welcome

Open with one message naming the steps ahead (sandbox prerequisites, tooling, identity, sign-in,
harness, permissions, sandbox, project) and the files it writes: `~/.bakers/machine.config.js`,
`~/.bakers/connections/default.js`, `.bakers/project.config.js` and `WORKFLOW.md`.

## Read

Read [machine setup](references/machine-setup.md), the [setup conversation](references/setup-conversation.md)
and [Set up a machine](https://bakers.build/provision/machine.md), in full text as the conversation
rules say. Unreadable required documentation: report the missing source and stop, never
substituting a remembered tool list.
**Done when the relevant documentation is loaded.**

## Sandbox prerequisites

Follow [sandbox prerequisites](references/sandbox-prerequisites.md) before any question.
**Done when they pass or are declined, or the run stops after the hand-over.**

## Ask and explain

Resolve the machine matrix block by block under the conversation rules: derive first, then one
question per block, own decisions alone. Leave client and environment
choices to project setup; reuse existing projects’ requirements. A Coder workspace is a remote
worker whose template provides its tools; its operator documents it. A custom environment calls
for its project's documented setup and checks.
**Done when each applicable row is known or explicitly unresolved.**

## Guide and check

Follow the selected documentation path: tooling first, then identity and sign-in. Run the
applicable read-only checks and explain failures with the documentation's next action.
Report present tools and leave them alone. Install a missing one only with explicit consent; hand
over what needs `sudo` with its documentation link, as in *Sandbox prerequisites*, and recheck after
they act; `bakers conductor check` rechecks once a project is connected.

Before configuration writes, inspect existing configuration, collect only missing inputs and
write after the person confirms.
Preserve correct values and keep secrets out of output. On a host that runs tickets, register
the chosen agent harness and write chosen routes, permissions and preview policy per
[machine configuration](https://bakers.build/configuration/machine.md), or report each unresolved.
Identity initialization configures none of them.
Distinguish tool readiness, authentication and workspace access. Blocked prerequisites stay
outstanding, never successful setup.
**Done when the documented checks pass or each remaining action has an owner.**

## Check out projects

On a remote worker, after sign-in and harness registration: list the person's projects on the control plane and ask
which to check out. Confirm the
SSH key is accepted by each `repository.url` host, then clone it at `repository.default_branch`
into `~/projects/<key>` and invoke `@bakers-build/bb-init-project` with scope `project` there.
After the person confirms, start each conductor through its configured client, following that
client’s documented startup path; for herdr, use a separate tab per checkout.
**Done when each chosen project is checked out, configured, and its conductor runs or the person
declined.**

## Report and return

Show written configurations back. Report the choices and check
results, what was written, what was preserved, and outstanding
actions with their owner and documentation link. Stop after machine/user setup and return to
the caller.
