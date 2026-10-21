# Disposable existing-site upgrade fixture

Use only on the isolated verification site. These scripts restore the two legacy
layouts with nondefault title, menu depth, block settings, selectors and
priority.
They remove the matching destination app/profiles and rewind only update 8022.
Setup invokes `prepare-import.php`, which records original UUIDs in fixture
state and aligns matching active configuration identities with the checked-in
CIM source. Recipe installation otherwise assigns fresh config UUIDs, causing
CIM to recreate vocabularies and membership types that already contain seed
content. This disposable-world preparation changes only matching UUID keys;
all other configuration values and content remain intact. No content is created
or deleted. The helper can also run independently before retrying CIM.
The ordinary recipe-test seed supplies `/home` and workspace pages used for the
browser walkthrough.

From the repository root:

```bash
ddev drush php:script
web/modules/custom/island/tests/fixtures/legacy-layouts/setup.php
ddev drush cache:rebuild
ddev drush updatedb -y
ddev drush php:script
web/modules/custom/island/tests/fixtures/legacy-layouts/verify.php
ddev drush config:import -y
ddev drush cache:rebuild
ddev drush php:script
web/modules/custom/island/tests/fixtures/legacy-layouts/verify.php
```

`verify.php` checks literal expected settings and placement IDs, repeats
migration,
and reports actual provider/config absence. CIM uninstalls the old page-layout
module because both installation stores now omit it. After the successful
import,
visit `/home` and the seeded workspace/team pages, navigating twice. Existing
Display Builder entity-view editor features remain installed separately.

For the failure path on a fresh disposable verification world:

```bash
ddev drush php:script
web/modules/custom/island/tests/fixtures/legacy-layouts/unsupported.php
ddev drush cache:rebuild
ddev drush updatedb -y
# Expected nonzero: error names the retained source and unsupported plugin.
ddev drush pm:uninstall display_builder_page_layout -y
# Expected nonzero: migration validator prevents destructive cleanup.
```

Check the original object against `island.migration_fixture.unsupported` state
and
confirm the module remains enabled. Restore the normal recipe-test world when
finished. The historical dashboard controller was removed before this branch;
these fixtures prove its composition mechanism, not that retired route.
