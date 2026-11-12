# Forge operations

Use served `forge_*` tools for every hosting operation in every permissions mode; conductor keeps
the token. Scope: ticket branch, its suffixed variants and derived target (target_branch else
base_branch; variants target ticket branch). Consult schemas for arguments.

Fetch with `forge_fetch` including parent branches, inspect success, then update locally with git.
Push with `forge_push` (force_with_lease after rewrite); create/update MR with `forge_pr_upsert`;
poll `forge_checks` until success/failure; merge only at authorized done with `forge_merge`.
Fix a named refusal before retrying.

Delivery properties: Conventional Commits title, derived target, explicit project merge method
and safe source deletion, retained branches other MRs target, body ending `Merged-by: bakers.build`
and final `ref:<identifier>`.

If no forge tool is served, use git and host CLI/API preserving those properties. In sandbox mode
only project-trusted commands qualify; otherwise stop at deliver and hand forge writes to a human.
