# Patch Maintenance

For each existing or failing patch, inspect its purpose, upstream issue, and the
selected package version.

- Remove a patch only when its fix is present in the selected release or its purpose
  is demonstrably obsolete; a closed issue alone is insufficient.
- Otherwise find a compatible patch or fixed release through the drupal.org issue
  queue, following duplicate issues to their source. Use upstream Drupal patch sources.
- Apply through the project's Composer patch mechanism and update its lock metadata
  where required. Use Lenient only for a demonstrated metadata constraint mismatch,
  never as a substitute for fixing incompatible code.
- Verify patches apply and the dependency installation is reproducible. Report issue
  links and decisions; leave unresolved failures blocked rather than dropping fixes.

## Patch Ledger

Before changing patches, record the affected packages' patch inventory. Maintain a
persistent ledger in the run's report directory.
Follow the [logging rules](../SKILL.md#logging) for location, sanitization, and commits.
For each reviewed patch, record:

- Package and version before/after; patch identity and issue URL.
- Old/new patch source and checksum when available.
- Decision: kept, added, replaced, removed, or blocked; reason and supporting evidence.
- Composer patch configuration and lock-metadata changes.
- Application/check result, actual exit code, and link to full Composer output.

Update the ledger after each attempt, including failures and unchanged patches.
Never overwrite earlier attempts; retain the ledger and logs if the run stops.
