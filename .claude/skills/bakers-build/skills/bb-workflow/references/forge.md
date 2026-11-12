# Forge operations

Use served forge tools for every hosting operation, in every permissions mode; conductor holds
the token. Consult schemas for arguments. Scope is ticket branch/suffixed variants and derived
base: target_branch else base_branch; variants target ticket branch.

- forge_fetch: include parent branches, inspect success, then update locally with git.
- forge_push: force_with_lease after rewrites.
- forge_pr_upsert: create/update MR.
- forge_checks: poll until success/failure.
- forge_merge: only at explicitly authorized done.

When `runtime_transfer_commit` is served, Git commits and refs are private to the run.
After `forge_fetch`, run `git fetch origin` to refresh private remote-tracking refs.
Before `forge_push`, call `runtime_transfer_commit` with the intended full commit hash.
Commits changing protected files require a maintainer to apply and deliver them outside the isolated run.

Tools enforce ownership, target, Conventional Commits title, checks, project merge method,
safe deletion and squash trailer. Correct named refusals before retrying.
When no forge tools are served, read [forge fallback](forge-fallback.md) at the operation needed.
