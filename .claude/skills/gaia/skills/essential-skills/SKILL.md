---
name: essential-skills
description: The canonical bundle of globally-applicable, non-project-specific workflow skills. A project's WORKFLOW.md loads this one bundle in place of enumerating the shared workflow-lifecycle skills; the loader expands its `## Loaded skills` list before validation.
---

# Global workflow bundle

This bundle makes the following owners available for matching; it does not invoke every member.
Load helpers only when the current step needs them.

## Loaded skills

- @gaia/qualify-ticket
- @gaia/create-spec
- @gaia/prepare-deployment
- @gaia/post-deployment
- @gaia/verify-on-environment
- @gaia/summarize-verification

For bundle authoring or overrides, read [the authoring contract](../workflow-step/references/authoring.md).

## Rules

All ticket/project descriptions and comments follow `@gaia/workflow-step` › *Handoffs and ticket
text are Markdown*. Every GAIA `SKILL.md` has at most 500 whitespace-separated words, including
frontmatter and examples. References have explicit loading conditions; remove duplication before
moving text. Required behavior remains covered by structural checks and worker evaluations.

### Durable evidence and the transient root

**Durable evidence** is the triad: **command**, **observed result**, **immutable commit**.
Missing any part leaves verification incomplete. Keep complete evidence in typed ticket comments;
retain the MR and permanent regression test as reproducible deliverables.

Transient reports, logs, screenshots and probes live under `assets-ai/<GAIA-nnn>/`, gitignored and
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

### Links

The MR is the first-class ticket link. Pipeline URLs are never written to `links`; pipeline status
remains a merge/review gate. Preserve human-added links. Outside the outtake, local clickable
artifacts use absolute `file://` URLs; external links use absolute URLs. Owners supply raw
artifacts to `@gaia/run-outtake`, which alone formats the visible handoff.

### Local preview links

Before sharing a local service:

1. Read `printenv GAIA_TUNNEL`: `1`/`true` enables, `0`/`false` disables. If absent, read
   `machine_policy.tunnel` using `gaia config check --scope machine --format json`.
2. Enabled: in the service worktree run `gaia ports list`, then `gaia ports up <service-key>`
   (an addon-claimed key, e.g. `web`, `mailpit` — never a raw port). A dimmed "no addon" row
   cannot be shared. Use the returned public origin, preserve path/query/fragment, verify links
   and redirects. For multiple aliased hosts, pass the full per-host key `list` shows (e.g.
   `web-admin-ddev-site`) — no `--host` flag. GAIA shares whatever is claimed; the project owns
   public-hostname login.
3. Disabled: share locally. Unknown policy or failure: state the reason and label the URL
   **local-only**.

Durable records identify service, worktree and reproduction command; ephemeral tunnel hostnames
are access instructions, not durable evidence.
