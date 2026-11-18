# Sandbox prerequisites

The harness's OS sandbox has per-platform prerequisites, listed in
[Sandbox prerequisites](https://bakers.build/provision/security/execution.md#sandbox-prerequisites).
This check needs no connected project.

## Check

Read the documented row for this host's platform and each harness on it. Check every listed
prerequisite read-only with the host's own means. A platform whose row needs nothing to install
passes; a harness without an OS sandbox is not checked.

All pass: report it and continue.

## Hand-over

Anything missing: send **one** message that names

- what is missing;
- for missing packages, the install command for those packages only, in the host's package manager;
- for a missing system setting, the documented fix, with no install command;
- that the person runs the command themselves (`! <command>` in Claude Code), since the agent
  session has no `sudo`;
- that the agent session must be restarted afterwards, because a running session does not find the
  new tools;
- that they then re-run `bb-init` in the new session, which rechecks at *Sandbox prerequisites*;
- the documentation link above;
- that replying *continue without the sandbox* goes on, offering neither `sandbox` nor
  `runtime-bwrap`.

## Resume

The re-run checks again, then continues at *Ask and explain*, which derives every configured value
first. The check precedes every question, so nothing answered is asked again.
