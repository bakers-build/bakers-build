# Forge operations

Use served forge tools in every mode; conductor holds credentials. Consult schemas.
Scope: ticket branch/suffixes; target_branch else base_branch, or ticket branch for variants.

- forge_fetch: include parents, check success, update local Git.
- forge_push: force_with_lease after rewrites.
- forge_pr_upsert: create/update MR.
- forge_checks: poll until `overall` settles. Only `success` is green; `no_required_checks` is not.
  A row's `conclusion` names the outcome (`cancelled`, `timed_out`, `skipped`); superseded runs are
  left out unless `all_runs`.
- forge_job_log: read a failed row's `job_id` before deciding on a fix.
- forge_merge: only at explicitly authorized done.

Run clone: commit before ending; forge_push transfers checked commits. Read-only merge failure: report it, a maintainer merges outside the run.

Tools enforce ownership, target, Conventional Commits title, checks, project merge method, safe deletion and squash trailer. Correct refusals before retrying. Without forge tools, read [fallback](forge-fallback.md).
