# Major Upgrades

Read official upgrade requirements and change records for the selected targets.
Check runtime requirements across local, CI, and deployment environments; change
only what the upgrade needs and follow required intermediate versions.

Use existing Upgrade Status tooling for custom/contrib compatibility with the
next Drupal core major, not to discover updates or security fixes. Its findings
are deprecations, not security severity; it does not scan core. For contrib-only
major changes, use that project's upgrade guidance instead.

Fix affected custom code and compatibility declarations. Prefer stable contrib
releases and investigate blockers in upstream issues. Development releases or
Lenient require demonstrated compatibility and an explicit risk report; changing
metadata alone does not make code compatible. Preserve enabled functionality.

Verify the planned installed versions, database updates, and affected behavior.
An empty Upgrade Status report is not a completion criterion: after a core upgrade
it may already analyze compatibility with the following major.
