---
name: bb-init
description: Use when preparing a machine for bakers.build, choosing its tooling, completing user sign-in, or diagnosing authentication without workspace access.
---

# Initialize a bakers.build machine and user

Guide the person through the documentation as a wizard. The documentation owns tool choices,
requirements and commands; this skill owns the conversation. Return project configuration to
`@bakers-build/bb-init-project`.

## Read

Read [Set up a machine](https://bakers.build/get-started/machine).
In a bakers.build source checkout, use its `docs/get-started/machine.md` instead,
so instructions match the revision being worked on.
If the required documentation cannot be read, report the missing source and stop; do not
substitute a remembered tool list.
**Done when the relevant documentation is loaded.**

## Ask and explain

Establish whether this host runs tickets, locally or remotely. Resolve agent harnesses, skills
and host prerequisites from the documentation. Leave client and environment choices to project
setup; reuse existing projects’ requirements. A Coder workspace is a remote worker
whose path is [Set up a Coder workspace](https://bakers.build/configuration/machine/coder-workspace)
(`docs/configuration/machine/coder-workspace.md` in a source checkout). Explain the options and their
tradeoffs briefly, using the docs; distinguish supported integrations from planned ones.

Reuse supplied answers and explicit project or machine configuration, naming the source.
Ask one unanswered question at a time and wait. Unattended, use known choices and mark unanswered
ones `not determined`; a custom environment calls for its project's documented setup and checks.
**Done when each applicable choice is known or explicitly unresolved.**

## Guide and check

Follow the selected documentation path: tooling first, then identity and sign-in. Run the
applicable read-only checks and explain failures with the documentation's next action.
The person installs tools; give the documentation link and recheck after they act.
On a worker, check the documented agent sandbox prerequisites (`bakers oven check` once a
project is connected). Report present tools and leave them alone. Run a missing one's documented
install command only with explicit consent, or hand it over when it needs `sudo` this session lacks.

Before configuration writes, inspect existing configuration, collect only missing inputs and
write after the person confirms.
Preserve correct values and keep secrets out of output.
Distinguish tool readiness, authentication and workspace access. Blocked prerequisites remain
outstanding; they are not successful setup.
**Done when the documented checks pass or each remaining action has an owner.**

## Check out projects

On a remote worker, after sign-in: list the person's projects on the control plane and ask
which to check out. Confirm the
SSH key is accepted by each `repository.url` host, then clone it at `repository.default_branch`
into `~/projects/<key>` and invoke `@bakers-build/bb-init-project` with scope `project` there.
After the person confirms, start each conductor through its configured client, following that
client’s documented startup path; for herdr, use a separate tab per checkout.
**Done when each chosen project is checked out, configured, and its conductor runs or the person
declined.**

## Report and return

Report the choices and check results, what was written, what was preserved, and outstanding
actions with their owner and documentation link. Stop after machine/user setup and return to
the caller.
