---
name: bb-init
description: Use when preparing a machine for bakers.build, choosing its tooling, completing user sign-in, or diagnosing authentication without workspace access.
---

# Initialize a bakers.build machine and user

Guide the person through the documentation as a wizard. The documentation owns tool choices,
requirements and commands; this skill owns the conversation. Return project configuration to
`@bakers-build/bb-init-project`.

## Read

Read [Prepare a machine](https://bb-539921.gitlab-pages.keytec.de/advanced/cli/prepare-machine)
and [Install the CLI](https://bb-539921.gitlab-pages.keytec.de/advanced/cli/install).
In a bakers.build source checkout, use its `docs/advanced/cli/prepare-machine.md` and
`docs/advanced/cli/install.md` instead, so instructions match the revision being worked on.
Follow their links when a chosen path needs more detail. If the required documentation cannot be
read, report the missing source and stop; do not substitute a remembered tool list.
**Done when the relevant documentation is loaded.**

## Ask and explain

Establish whether this machine runs tickets and whether it is the developer's computer or a
remote worker. For a worker, ask which workspace manager and development environment they want,
then resolve the remaining choices from the documentation. Explain the options and their
tradeoffs briefly, using the docs; distinguish supported integrations from planned ones.

Reuse supplied answers and explicit project or machine configuration, naming the source.
Ask one unanswered question at a time and wait. Unattended, use known choices and mark unanswered
ones `not determined`; a custom environment calls for its project's documented setup and checks.
**Done when each applicable choice is known or explicitly unresolved.**

## Guide and check

Follow the selected documentation path: tooling first, then identity and sign-in. Run the
applicable read-only checks and explain failures with the documentation's next action.
The person installs tools; give the relevant documentation link and recheck after they act.

Before configuration writes, inspect existing configuration and collect only missing inputs.
Preserve correct values, keep secrets out of output, and leave project configuration to the caller.
Distinguish tool readiness, authentication and workspace access. Blocked prerequisites remain
outstanding; they are not successful setup.
**Done when the documented checks pass or each remaining action has an owner.**

## Report and return

Report the choices and check results, what was written, what was preserved, and outstanding
actions with their owner and documentation link. Stop after machine/user setup and return to
the caller.
