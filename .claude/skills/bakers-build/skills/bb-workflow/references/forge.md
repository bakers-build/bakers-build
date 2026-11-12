# Forge operations

Use served forge tools for every hosting operation, in every permissions mode; conductor holds
the token. Consult schemas for arguments. Scope is ticket branch/suffixed variants and derived
base: target_branch else base_branch; variants target ticket branch.

- forge_fetch: include parent branches, inspect success, then update locally with git.
- forge_push: force_with_lease after rewrites.
- forge_pr_upsert: create/update MR.
- forge_checks: poll until success/failure.
- forge_merge: only at explicitly authorized done.

Tools enforce ownership, target, Conventional Commits title, checks, project merge method,
safe deletion and squash trailer. Correct named refusals before retrying.
When no forge tools are served, read [forge fallback](forge-fallback.md) at the operation needed.
