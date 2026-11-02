---
name: drupal-update
description: Drupal updates for core, individual contrib packages, or all Drupal packages; supports security, patch, minor, and major modes.
---

# Drupal Update

Follow the update workflow below; a planning-only request stops after detection
and planning. Inside a ticket, the ticket's lifecycle owns plan, approval and
review: review is mandatory for every update, also for a chore.

Require **mode** and **scope** as input; ask only for missing or ambiguous values.
Scope is a package list or **all** (core and installed contrib packages). Resolve
module names to Composer packages; treat installed core packages as one unit.
Security detection also covers transitive dependencies. For security with scope all,
include every vulnerable locked dependency; for a package list, report findings outside scope.

When a confirmed spec or bug update plan supplies a package list and target bounds, use them as the
authoritative scope instead of rediscovering all updates. Record necessary dependency
changes separately; changing selected packages or target bounds requires a scope change
before execution.

| Mode | Target per selected package |
|------|-----------------------------|
| security | Smallest stable update that resolves applicable advisories; prefer the current release series. |
| patch | Latest stable patch in the current minor series. |
| minor | Latest stable release in the current major series. |
| major | Latest stable release in the next major series, following required intermediate upgrades. |

Use the environment, linting and testing that `WORKFLOW.md` provisions and names.
Preserve unrelated work and installed tooling.

## Logging

Maintain a persistent run log in a unique directory under `docs/drupal-updates/`.
Record mode, scope, version plan,
decisions, and blockers as work proceeds. Save Composer, database-update, and
verification output with commands and actual exit codes; redact secrets.
Include the patch ledger defined in [Patch maintenance](references/patches.md).
Commit the sanitized logs, patch ledger, and report with the update changes.
For blocked runs, commit the documentation separately from incomplete changes.
Keep logs on failure and link them in the final report.

## Workflow

1. **Detect and plan.** Read [Detection and verification](references/verification.md).
   List every selected package's current version, target, reason, and blockers before
   changing dependencies. Include outdated contrib proactively, not only on failure.
   Identify required dependency changes and check official release requirements.
   Report when no update or stable target exists; do not silently widen scope.
2. **Prepare.** Record pre-update config:status and available CI or targeted-test baseline
   evidence; ensure a restorable database backup before database changes. For major mode or a security
   fix requiring a major transition, read [Major upgrades](references/major.md).
3. **Update.** Keep the lockfile. Use a partial Composer update for the planned packages,
   allowing necessary dependency changes while minimizing churn. Enforce planned
   version bounds; keep manifest constraints unchanged when they already permit the
   target. Review the lock diff and justify every additional changed package.
   Apply [Patch maintenance](references/patches.md) to affected patches. Resolve
   module, patch, and asset failures at their source; retry only after a relevant fix.
4. **Finish.** Run database updates after every dependency update, including minor
   and security updates. Rebuild caches; remove only temporary tooling introduced by
   this run before exporting relevant configuration.
   First run: updb → cex → review the export diff against the pre-update config:status
   baseline → commit only update-caused changes → cim. Preserve unrelated drift before import.
   Later runs, including review: updb → cim only; do not re-export to hide missing changes.
   Verify on a fresh pre-update database: successful updates/import and clean config:status
   demonstrate that the committed export is complete for that baseline.
   Keep changes reproducible through
   versioned code, configuration, and Composer metadata. Preserve modules in use,
   config splits, required patches, and assets; never bypass failures with vendor edits
   or manual database repairs. Stop on unresolved failures and preserve recovery data.
5. **Verify and report.** Apply the mode-specific completion criteria, check site health
   and reproducible installation, then run existing linting and tests selectively for
   affected behavior. Full suites belong to pre-merge pipelines. Compare failures with
   baseline evidence without weakening assertions. Report versions, dependency and
   patch changes, commands and results, remaining advisories, and blockers. A reverted
   code change does not roll back the database.
