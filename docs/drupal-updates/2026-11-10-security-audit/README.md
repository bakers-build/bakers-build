# Security update, 2026-11-10

- **Mode:** security. **Scope:** every locked package with a Composer audit advisory, transitive ones included.
- **Base:** `c4a887be`. **Environment:** this worktree's DDEV `recipe-test` site.
- **Trigger:** the new `composer_audit` check found about 60 advisories ([audit-before.json](audit-before.json)).

## Version plan and result

| Package | Before | After | Reason |
|---|---|---|---|
| drupal/core, core-recommended, core-composer-scaffold | 11.3.11 | 11.3.21 | SA-CORE-2026-005 to -016, among them a critical RCE (-014) |
| drupal/simple_oauth | 6.1.1 | 6.1.4 | SA-CONTRIB-2026-242, -296 |
| drupal/ui_patterns | 2.0.15 | 2.0.23 | SA-CONTRIB-2026-075 |
| drupal/ui_icons | 1.1.2 | 1.1.3 | SA-CONTRIB-2026-221, -230 |
| drupal/entity | 1.6.0 | 1.8.0 | SA-CONTRIB-2026-113 |
| symfony/* | 7.4.x | 7.4.17–7.4.23 | several advisories |
| guzzlehttp/guzzle, psr7 | 7.10.6, 2.8.1 | 7.16.1, 2.13.2 | several advisories |
| league/commonmark | 2.8.2 | 2.10.7 | several advisories |
| composer/composer | 2.10.0 | 2.11.2 | several advisories |
| squizlabs/php_codesniffer | 3.13.5 | 3.13.6 | command injection |
| mcp/sdk | 0.8.1 | **0.7.1** | GHSA-f4rf-6ghj-mhr6 affects only 0.8.x; 0.9.0 fixes it, but `drupal/mcp_server` 2.0.0-beta6 allows only `^0.7.1 \|\| ^0.8`. The requester chose the downgrade. |

All 76 changes are in [lock-diff.txt](lock-diff.txt).

The dependency changes are needed by the packages above:

- `lcobucci/clock` is removed. `lcobucci/jwt` 5.6.1 needs only `psr/clock`, and no custom code uses `lcobucci/clock`.
- The rest are patch and minor releases of dependencies.

No manifest constraint changed. The two `config.audit.ignore` entries for `guzzlehttp/psr7` are removed: psr7 2.13.2 fixes both advisories, and the audit is clean without them.

## Steps and results

| Step | Command | Exit | Log |
|---|---|---|---|
| Baseline | `drush config:status` | 0 | [config-status-before.txt](config-status-before.txt) |
| Backup | `drush sql:dump --gzip` (inside the container, not committed) | 0 | — |
| Update | `composer update -W <packages>` | 0 | [composer-update.txt](composer-update.txt) |
| Audit | `composer audit --locked --abandoned=report` | 0 | [audit-after.txt](audit-after.txt) |
| Database | `drush updatedb`, `drush cr`, `drush config:status` | 0 | [updb.txt](updb.txt) |

`updatedb` ran `simple_oauth_update_8609` and `ui_patterns_views_update_10201`. The only change to `config:status` against the baseline was `views.settings`: `display_extenders` gains `ui_patterns`. That change is in `config/sync/views.settings.yml`.

The audit lists one abandoned package, `doctrine/common`, with no replacement.

## Code change caused by the update

ui_patterns 2.0.23 drops `MenuSource::$menuId` and its `alterComponent()` cache tags. `BbMenuSource` now adds the menu tag itself, through the trait's `addMenuCacheTags()`.

The existing test `BbMenuSourceTest::testAlterComponentAloneDeclaresTheCacheability` failed after the update and passes with the fix.

The full `bb_core` Kernel suite after the update found three more consequences.

- **ui_patterns 2.0.23 escapes string props itself.** `BbWorkspaceJoinForm` and `WorklogFormLayout` still escaped them first, so the invitation page showed `&lt;b&gt;` literally. Both now pass the plain string. Evidence: `WorkspaceMemberInviteTest::testInvitationShowsTheWorkspaceMarkAndDescription` failed, then passed.
- **ui_patterns 2.0.23 makes `ui_patterns.sample_entity_generator` an alias.** `hasDefinition()` no longer saw it, so `bb_core`'s `PreviewSampleEntityGenerator` was not installed. A ticket preview then ran out of memory, as the deploy import would. `BbCoreServiceProvider` now resolves the alias with `has()` and `findDefinition()`. Evidence: `DisplayBuilderTicketSampleTest::testAnonymousTicketPreviewFitsDeployMemoryLimit` hit the memory limit, then passed.
- **entity 1.8 no longer grants `AMONG_ALL` over an empty condition group.** `bb_core`'s own `jsonapi_entity_filter_access` hook already grants it for every narrowed type, so filtered reads are unchanged. The characterisation test `WorkspaceReadScopeFilterAccessTest` now pins the new contrib behaviour and the `bb_core` grant for the admin.

## Patch ledger

| Package | Version before → after | Patch | Decision | Result |
|---|---|---|---|---|
| drupal/ui_patterns | 2.0.15 → 2.0.23 | patches declared by a dependency (none in the root package) | kept, unchanged | applied, exit 0 ([composer-update.txt](composer-update.txt)) |
| drupal/display_builder | unchanged | `patches/display_builder-views-sources-schema.patch` | not affected | — |
| drupal/social_api | unchanged | `patches/social_api-php84-nullable-request.patch` | not affected | — |

## Not checked

- Drupal Update status (`NOT_SECURE`) was not fetched. This run checked only with `composer audit`.
