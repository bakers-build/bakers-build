# Security update, 2026-11-25: Drupal core 11.3.23

- **Mode:** security. **Scope:** the six `drupal/core*` packages as one unit. **Trigger:** `composer audit` flags drupal/core 11.3.22 with SA-CORE-2026-019 (CVE-2026-136716, access bypass, affects `>=11.0.0 <11.3.23`). Before: [audit-before.json](audit-before.json).
- **Target:** 11.3.23, the smallest stable release in the current series that closes the advisory. Drupal 11.4 is out of scope.
- **Environment:** this worktree's DDEV site, installed from `config/sync` (`existing-config`). Backup: `drush sql:dump` in the container (not committed).

| Package | Before | After |
|---|---|---|
| drupal/core, -recommended, -composer-scaffold | 11.3.22 | 11.3.23 |
| drupal/core-dev, -project-message, -recipe-unpack | 11.3.22 | 11.3.23 |

No other package changes. `composer.json` is unchanged. Lock diff: [lock-diff.txt](lock-diff.txt).

## Attempts

1. [composer-update-attempt1-core-dev-unbounded.txt](composer-update-attempt1-core-dev-unbounded.txt): `--with drupal/core:11.3.23` bounds only `drupal/core`, so `drupal/core-dev` moved to 11.4.14. Discarded.
2. [composer-update-attempt2-transitive-churn.txt](composer-update-attempt2-transitive-churn.txt): with every core package bounded to 11.3.23, `--with-dependencies` also raised about 30 unpinned transitive packages (Symfony patch releases, guzzle, open-telemetry, phpstan, composer). None of them is needed for the fix. Discarded.
3. [composer-update.txt](composer-update.txt): every core package bounded plus `--minimal-changes`. Only the six core packages change. Exit 0.

## Patch ledger

- `display_builder-views-sources-schema.patch` (BB-413), `social_api-php84-nullable-request.patch` (BB-476): packages unchanged, kept.
- `ui_patterns` patch: re-applied when composer-patches reinstalled `drupal/ui_patterns` 2.0.23, exit 0.
- No patch targets a `drupal/core*` package.

## Results

| Step | Exit | Log |
|---|---|---|
| composer update (attempt 3) | 0 | [composer-update.txt](composer-update.txt) |
| drush updb -y | 0, ran `system_post_update_mark_installation_finished` | [updb.txt](updb.txt) |
| drush config:status before / after updb | identical: 7 views Different, pre-existing | [config-status-before.txt](config-status-before.txt), [config-status-after-updb.txt](config-status-after-updb.txt) |
| drush cex -y | export discarded, nothing update-caused | [config-export.diff](config-export.diff) |
| drush cim -y, config:status | 0, the same 7 views | [config-import.txt](config-import.txt) |
| composer audit --locked --abandoned=report (CI command) | 0, no advisories; doctrine/common abandoned (out of scope) | [audit-after.txt](audit-after.txt) |
| phpcs, phpmd, phpstan | 0 | `provision_exec` |

The export also rewrote `island.profile.bb_shell` (dropped a YAML comment) and `views.view.bb_terms` (quote style); both are dumper formatting, not update-caused. The 7 views stay Different after `cim`: pre-existing drift.
