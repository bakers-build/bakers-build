# Forge fallback

Read only without served forge tools. Use git and host CLI/API; sandbox mode requires project-trusted
commands, else stop at deliver and hand forge writes to a human.

## Open

The derived target is target_branch (else base_branch); variants target ticket branch. Require a Conventional
Commits subject `type(scope)!: subject`:
`^(feat|fix|chore|docs|refactor|test|ci|build|perf)(\([a-z0-9._/-]+\))?!?: \S.*`.
Apply [delivery](delivery.md) for MR text and [merge](merge.md) for invalid-title handling.
GitHub stores no per-PR squash/deletion preference; decide at merge.

For an authorized merge read [merge fallback](merge-fallback.md); its source-retention and
squash-body rules apply instead of client/project defaults.
