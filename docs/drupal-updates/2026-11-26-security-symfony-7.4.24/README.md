# Security update, 2026-11-26: Symfony 7.4.24

- **Mode:** security. **Scope:** `symfony/http-kernel`, `symfony/mailer`, `symfony/routing`, `symfony/serializer`. **Trigger:** `composer audit` reports 7 advisories published 2026-11-25 (affected `>=7.4.0,<7.4.24`): CVE-2026-133743 (http-kernel), CVE-2026-133751 and CVE-2026-133755 (mailer), CVE-2026-133746 and CVE-2026-133754 (routing), CVE-2026-133761 and CVE-2026-133752 (serializer). Before: [audit-before.txt](audit-before.txt).
- **Target:** 7.4.24, the smallest stable 7.4 release that closes all 7 advisories. Symfony 8 and Drupal 11.4 are out of scope.
- **Required dependency change:** `symfony/http-foundation`, because `symfony/http-kernel` 7.4.24 requires `symfony/http-foundation ^7.4.24`.
- **Environment:** this worktree's DDEV site, installed from `config/sync` (`existing-config`) at the pre-update lock. Backup: `drush sql:dump` in the container (not committed).

| Package | Before | After |
|---|---|---|
| symfony/http-foundation | 7.4.23 | 7.4.24 |
| symfony/http-kernel | 7.4.23 | 7.4.24 |
| symfony/mailer | 7.4.22 | 7.4.24 |
| symfony/routing | 7.4.23 | 7.4.24 |
| symfony/serializer | 7.4.23 | 7.4.24 |

No other package changes; Drupal core stays at 11.3.23, whose `core-recommended` constraints already allow 7.4.24. `composer.json` is unchanged. Lock diff: [lock-diff.txt](lock-diff.txt).

## Attempts

1. [composer-update.txt](composer-update.txt): the five packages, each bounded to 7.4.24, with `--minimal-changes`. Only these five change. Exit 0.

## Patch ledger

- `display_builder-views-sources-schema.patch` (BB-413), `social_api-php84-nullable-request.patch` (BB-476): packages unchanged, kept.
- `ui_patterns` patch: re-applied when composer-patches reinstalled `drupal/ui_patterns` 2.0.23, exit 0.
- No patch targets a `symfony/*` package.

## Results

| Step | Exit | Log |
|---|---|---|
| composer update | 0 | [composer-update.txt](composer-update.txt) |
| drush updb -y, updatedb:status | 0, no pending updates | [updb.txt](updb.txt) |
| drush config:status before / after updb | identical: 7 views Different, pre-existing | [config-status-before.txt](config-status-before.txt), [config-status-after-updb.txt](config-status-after-updb.txt) |
| drush cex -y | export discarded, nothing update-caused | [config-export.diff](config-export.diff) |
| drush cim -y, config:status | 0, the same 7 views | [config-import.txt](config-import.txt) |
| composer audit --locked --abandoned=report (CI command) | 0, no advisories; doctrine/common abandoned (out of scope) | [audit-after.txt](audit-after.txt) |
| tests/config-sync/check-config-sync.sh | 0 | in the web container |
| phpcs, phpmd, phpstan | 0 | `provision_exec` |

The export rewrote 10 files with dumper formatting only: a dropped YAML comment in `island.profile.bb_shell`, quote style in `views.view.bb_environments`, `bb_terms` and `projects`, and key order in the views. None of it is update-caused. The 7 views stay Different after `cim`: pre-existing drift, the same as in the 2026-11-25 run.
