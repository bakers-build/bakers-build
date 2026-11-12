# Evidence and links

Durable evidence: **command, observation, immutable commit**, typed comments, MR and permanent tests.
Transient logs/reports/probes: gitignored `assets-ai/<identifier>/`, removed with the worktree.
Choose behavior-named permanent tests or ticket-named transient probes.
Inspect changed/untracked tests before staging. Use lowercase binary directories (`vitest/`,
`shell/`), kind subdirectories only for multiple artifact kinds; [browser](browser.md) owns its
layout. Name subject and applicable before/after, red/green, review suffix; output opens with
command, SHA in evidence not filename. Repeats overwrite.
Link the MR; pipeline status is a gate, not a new link. Preserve human links.
Outside outtake local artifacts use absolute file:// URLs, external absolute URLs.
[Outtake](outtake.md) alone formats visible resources.
