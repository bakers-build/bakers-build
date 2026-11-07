# Security reporting and support

## Private reporting

Use GitHub’s [private vulnerability report form](https://github.com/bakers-build/bakers-build/security/advisories/new).
Sign in to GitHub and submit the report privately to this repository’s security maintainers.
Private vulnerability reporting is enabled and was read back through GitHub’s repository API.
Do not open a public issue or pull request containing vulnerability details or credentials.

A named reporting owner and monitoring arrangement still need maintainer confirmation before
F8 can pass. The enabled form establishes a private technical route, not a response-time promise.
No test report was submitted.

Include affected component/version and source SHA, impact, minimal
reproduction with synthetic data, expected/observed behavior and a sanitized proof of concept.
Keep credentials and personal data out of the report. Do not test against shared or customer systems.

## Supported versions

No public version range has completed the full clean-install acceptance yet. The
`next` channel is a candidate, not a support or security guarantee. Maintainers must identify the
supported release range and reporting owner; no response-time commitment
or maintenance window is asserted here. See the [acceptance matrix](docs/bakers/clean-install-acceptance.md#support-and-cleanup)
for the current limits and [component licensing](docs/bakers/licensing.md) for publication scope.

The [security manual](docs/security/access-and-data.md) describes access controls and operational
boundaries. Record actual client security settings and evidence; a worktree alone is not an OS
sandbox, and a system-mode run must not be described as a sandbox pass.
