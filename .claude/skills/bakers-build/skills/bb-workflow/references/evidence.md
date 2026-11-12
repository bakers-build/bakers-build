# Evidence and links

Durable evidence: **command, observation, immutable commit**, all in typed comments with MR and
permanent regression tests. Transient logs/reports/probes live in gitignored
`assets-ai/<identifier>/`, removed with worktree, never durable links.
Before tests choose behavior-named permanent suite coverage or ticket-named transient probes.
Inspect changed/untracked tests before staging. Use lowercase binary directories (`vitest/`,
`shell/`), kind subdirectories only for multiple artifact kinds; [browser](browser.md) owns its
layout. Name subject and applicable before/after, red/green, review suffix; output opens with
command, SHA in evidence not filename. Repeats overwrite.
MR is first-class link; pipeline status stays a gate, no new pipeline links. Preserve human links.
Outside outtake local artifacts use absolute file:// URLs, external absolute URLs.
[Outtake](outtake.md) alone formats visible resources.
