# Forge operations

Use served forge tools in every mode; conductor holds credentials. Consult schemas.
Scope: ticket branch/suffixes; target_branch else base_branch, or ticket branch for variants.

- forge_fetch: include parents, check success, update local Git.
- forge_push: force_with_lease after rewrites.
- forge_pr_upsert: create/update MR.
- forge_checks: poll; red row `job_id` → forge_job_log.
- forge_merge: only at explicitly authorized done.

Run clone: commit before ending; forge_push transfers checked commits. Read-only merge failure: report it, a maintainer merges outside the run.

Tools enforce ownership, target, Conventional Commits title, checks, project merge method, safe deletion and squash trailer. Correct refusals before retrying. Without forge tools, read [fallback](forge-fallback.md).
