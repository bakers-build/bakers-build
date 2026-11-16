# Forge update conflicts

**A run resolves the conflicts of [`forge_update_branch`](/addons/forge#tools) in its own files, then continues or aborts.**

A conflicting `forge_update_branch` moves nothing. It returns `sync: conflict`, the pinned `previous` and `target` SHAs and each conflict's `path`, `kind` (`content`, `add_add`, `modify_delete` with `deleted_by`), and writes those files into the workspace, content conflicts with markers.

1. Edit the files without staging or committing; compare with `git show <previous>:<path>` and `<target>:<path>`.
2. Call it with `action: continue`, naming every conflict path in `keep` (committed as the workspace has it, no markers left) or `delete` (the file is removed). It commits one merge of both sides, then `sync` is `in_place` or `restart` as for a clean merge.
3. Or call it with `action: abort`: the conflict files return to `previous`, other files stay.

Continue refuses, changing nothing, undecided or unknown paths, remaining markers, a missing kept or a present deleted file, changes outside the conflict paths, a run commit and a target that moved since (abort, then start again). A continue interrupted after its merge finishes on the next call. While an update is pending, `forge_push` and a new start refuse. A conflict in a protected path refuses at the start, listing it apart from the writable ones; a maintainer merges outside the run.
