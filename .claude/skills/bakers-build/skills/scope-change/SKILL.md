---
name: scope-change
description: Handle a changed bakers.build requirement as a refinement, independent addition, or approved replacement while preserving useful work.
---

# Changed scope

Read the complete current ticket and confirmed scope. Decide whether correctly finishing its
original goal would still produce a desired result.

| Situation | Action |
|---|---|
| The goal remains valid; details or the approach change | Keep the ticket. Append the revised full specification, plan, and validation; identify what they supersede and record the user's approval. |
| An independently acceptable requirement is added | Use `@bakers-build/create-ticket` for that requirement; continue the original valid work. |
| The goal is abandoned or replaced by an incompatible goal | Prepare the replacement handoff below for one approval covering both the successor and cancellation. |
| The original work is already delivered | Create a change or bug ticket and preserve delivered history. |

## Replacement handoff

Prepare the new goal and acceptance criteria, the reason for replacement, retained findings,
rejected decisions, available commits/branch/MR, verified results with their tested revision and
scope, and remaining work. The successor must be actionable without the old conversation or
worktree. Present the existing MR's proposed disposition explicitly; cancelling a ticket does
not close or merge its MR.

Obtain or reuse one explicit approval covering that concrete replacement and cancellation.
Before cancelling:

1. Stop the old worker and verify that it stopped; closing its run record alone proves nothing.
2. Preserve useful changes and evidence durably, and verify they are accessible without the old
   worktree. An unpushed commit or a transient output path is insufficient preservation.
3. Use `@bakers-build/create-ticket` to publish the successor with the full handoff and intended base.
   A replacement link is not a parent relation: setting a parent can change the base branch.
4. Read both tickets back and verify bidirectional replacement links, complete successor context,
   and the preserved code. Preserve all existing unrelated links.
5. Only after all four checks succeed, return the verified handoff and cancellation authorization
   to the calling state owner. That owner performs the approved cancellation through the transition
   capability, then reports the authorized next action for the successor. This helper writes no state.

A failure to stop work, preserve changes, create the successor, or verify either link leaves the
original uncancelled. Record what failed and the recovery action. Cancellation can clean up the old
worktree immediately; nothing the successor needs may depend on it surviving.
