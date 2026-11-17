---
name: bb-init
description: Use when preparing a machine for bakers.build, choosing its tooling, completing user sign-in, or diagnosing authentication without workspace access.
---

# Initialize a bakers.build machine and user

Documentation owns choices and commands; this skill guides the conversation. Return project setup to
`@bakers-build/bb-init-project`.

## Welcome

Open with one message, before any check or question: what bakers.build setup does, the steps
ahead (tooling, identity, sign-in, agent harness, permissions and sandbox, then the project) and
the files it writes after your confirmation: `~/.bakers/machine.config.js`,
`~/.bakers/connections/default.js`, the project's `.bakers/project.config.js` and `WORKFLOW.md`.
**Done when the welcome is shown.**

## Read

Read [machine setup](references/machine-setup.md), the [setup conversation](references/setup-conversation.md)
and [Set up a machine](https://bakers.build/provision/machine.md), in full text as the conversation
rules say. If the required documentation cannot be read, report the missing source and stop; do not
substitute a remembered tool list.
**Done when the relevant documentation is loaded.**

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
The person installs tools; give the documentation link and recheck after they act.
On a worker, check the documented agent sandbox prerequisites (`bakers conductor check` once a
project is connected). Report present tools and leave them alone. Run a missing one's documented
install command only with explicit consent, or hand it over when it needs `sudo` this session lacks.

Before configuration writes, inspect existing configuration, collect only missing inputs and
write after the person confirms.
Preserve correct values and keep secrets out of output. On a host that runs tickets, register
the chosen agent harness and write chosen routes, permissions and preview policy per
[machine configuration](https://bakers.build/configuration/machine.md), or report each unresolved.
Identity initialization configures none of them.
Distinguish tool readiness, authentication and workspace access. Blocked prerequisites remain
outstanding; they are not successful setup.
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

Show each written configuration back under the conversation rules. Report the choices and check
results, what was written, what was preserved, and outstanding
actions with their owner and documentation link. Stop after machine/user setup and return to
the caller.
