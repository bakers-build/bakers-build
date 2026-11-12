# Merge fallback

Read only when no forge tools are served; apply [merge gates](merge.md) first.

## Merge

Feature branches squash into one commit.

Send **squash commits** and the **delete source branch** decision explicitly on this merge call;
omission inherits stored MR/project values.

Check the source. Delete only the merged ticket's own short-lived work branch. Retain long-lived,
shared and environment branches, release branches a later promote reuses, and branches that other
open MRs target as their base. Forge protection is not a substitute for this check.

For retained sources, send the deletion negative explicitly. A stored
`force_remove_source_branch: true` overrides this negative: block until the branch owner decides
to clear it before merge. For feature work keep squash enabled.

The subject comes from the MR title, which carries no bakers.build reference: the validated title,
verbatim. Squash discards individual commit trailers, so put `Merged-by: bakers.build` and
final-line `ref:<identifier>` in the squash body; otherwise release measurement silently loses the
ticket. The message goes on the squash commit, the one that represents the change.

Verify that the MR reports merged and its target advanced.


