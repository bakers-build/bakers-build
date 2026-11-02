# Security reporting and support

## Private reporting

A monitored private vulnerability-reporting destination has **not yet been verified** for the
public repository. Public release acceptance is blocked on that prerequisite. This document does
not promise that a guessed GitHub advisory URL or an unpublished email address is monitored.

Do not disclose vulnerability details, credentials, login links, customer data or exploit material
in public issues, discussions or pull requests. Request a private contact from a known maintainer
through an existing private channel, without including the sensitive details until the recipient
and privacy are confirmed. If you have no such channel, ask only for a private reporting contact.
Maintainers must publish and verify that route and its ownership before marking the public
reporting path accepted. No test vulnerability report should be sent merely to verify the route.

Once the route is confirmed, include affected component/version and source SHA, impact, minimal
reproduction with synthetic data, expected/observed behavior and a sanitized proof of concept.
Keep credentials and personal data out of the report. Do not test against shared or customer systems.

## Supported versions

No public version range has completed the clean-install/security-reporting acceptance yet. The
`next` channel is a candidate, not a support or security guarantee. Maintainers must identify the
supported release range when enabling the private reporting route; no response-time commitment
or maintenance window is asserted here. See the [acceptance matrix](docs/bakers/clean-install-acceptance.md#support-and-cleanup)
for the current limits and [component licensing](docs/bakers/licensing.md) for publication scope.

The [security manual](docs/configuration/security.md) describes access controls and operational
boundaries. Record actual client security settings and evidence; a worktree alone is not an OS
sandbox, and a system-mode run must not be described as a sandbox pass.
