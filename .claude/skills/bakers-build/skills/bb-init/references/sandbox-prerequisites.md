# Sandbox prerequisites

Claude's native sandbox on Linux needs `bwrap`, `socat` and unprivileged user namespaces. This check
needs no connected project. macOS ships Seatbelt; other platforms skip it with that reason.

## Probes

Read-only:

- `command -v bwrap socat`
- when both exist: `bwrap --unshare-user --unshare-net --die-with-parent --ro-bind / / true`
- the package manager: the first of `apt-get`, `dnf`, `pacman` on `PATH`

All pass: report it and continue.

## Hand-over

Anything missing: send **one** message that names

- what is missing;
- for missing tools, the install command for those packages only: `sudo apt-get install -y <pkgs>`,
  `sudo dnf install -y <pkgs>`, `sudo pacman -S --needed <pkgs>`, else the package manager with the
  package names (`bwrap` is package `bubblewrap`);
- for a refused user namespace, allowing unprivileged user namespaces, with no install command;
- that the person runs the command themselves (`! <command>` in Claude Code), since the agent
  session has no `sudo`;
- that the agent session must be restarted afterwards, because a running session does not find the
  new tools;
- that `bb-init` then resumes at *Sandbox prerequisites* in the new session;
- [Sandbox prerequisites](https://bakers.build/provision/security/execution.md#sandbox-prerequisites);
- that replying *continue without the sandbox* goes on, offering neither `sandbox` nor
  `runtime-bwrap`.

## Resume

The re-run checks again, then continues at *Ask and explain*, which derives every configured value
first. The check precedes every question, so nothing answered is asked again.
