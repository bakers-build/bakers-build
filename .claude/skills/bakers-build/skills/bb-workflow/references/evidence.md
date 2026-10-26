# Evidence and links

Read before running a check, writing a test, capturing output or writing ticket links.

## Durable evidence and the transient root

**Durable evidence** is the triad: **command**, **observed result**, **immutable commit**.
Missing any part leaves verification incomplete. Keep complete evidence in typed ticket comments;
retain the MR and permanent regression test as reproducible deliverables.

Transient reports, logs, screenshots and probes live under `assets-ai/<bakers.build-nnn>/`, gitignored and
removed with the worktree. They are not durable ticket links.

Before writing a test, choose permanent regression coverage or a throwaway probe. Permanent tests
belong in the project suite, named for behavior without ticket IDs. Ticket-named probes remain in
the ignored root. Review new, changed and untracked tests before staging.

- The **tool is the only axis**: lowercase binary directories such as `vitest/`, `shell/`.
- Add kind subdirectories only for tools producing multiple artifact kinds; the browser helper
  owns its screenshot/output layout.
- Name files for the subject; use before/after, red/green or review suffixes where applicable.
- Each output file opens with its command. Store the revision in evidence, not filenames.
- A repeated step overwrites its previous transient files.

## Links

The MR is the first-class ticket link. Pipeline URLs are never written to `links`; pipeline status
remains a merge/review gate. Preserve human-added links. Outside the outtake, local clickable
artifacts use absolute `file://` URLs; external links use absolute URLs. Owners supply raw
artifacts to `@bakers-build/bb-run-outtake`, which alone formats the visible handoff.
