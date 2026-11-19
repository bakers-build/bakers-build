# Security + patch update, 2026-11-19

- **Mode:** security + patch. **Scope:** all. **Trigger:** `composer audit` flagged drupal/core 11.3.21 (SA-CORE-2026-017 RCE, -018).
- **Environment:** this worktree's DDEV site. Backup: `drush sql:dump` in the container (not committed).

| Package | Before | After |
|---|---|---|
| drupal/core, -recommended, -composer-scaffold | 11.3.21 | 11.3.22 |
| drupal/core-dev, -project-message, -recipe-unpack | 11.3.11 | 11.3.22 |
| config_inspector | 2.1.10 | 2.1.12 |
| facets | 3.0.6 | 3.0.7 |
| migrate_plus | 6.0.10 | 6.0.11 |
| tagify | 1.2.53 | 1.2.55 |
| views_autocomplete_filters | 2.0.3 | 2.0.4 |
| views_filters_summary | 3.4.0 | 3.4.1 |
| ui_patterns_library | 2.0.15 | 2.0.23 |

Transitive changes: see [lock-diff.txt](lock-diff.txt). composer.json is unchanged.

## Blocked / skipped
- migrate_tools 6.1.4 -> 6.1.5: conflicts with drush < 13.7 (drush is 13.6.2). First attempt: [composer-update-attempt1-failed.txt](composer-update-attempt1-failed.txt). Needs a drush update.
- Minor/prerelease updates (core 11.4, search_api, display_builder beta, mcp_server beta7 ...) are out of mode.

## Patch ledger
- display_builder-views-sources-schema.patch (BB-413), social_api-php84-nullable-request.patch (BB-476): packages unchanged, kept.
- ui_patterns patch: re-applied (ui_patterns reinstalled by composer-patches), exit 0.

## Results
| Step | Exit | Log |
|---|---|---|
| composer update | 0 | [composer-update.txt](composer-update.txt) |
| composer audit --locked | 0, no advisories (doctrine/common abandoned, no replacement) | [audit-after.txt](audit-after.txt) |
| updatedb, cr, config:status | 0, no pending updates | [updb.txt](updb.txt) |

config:status shows `search_api.index.bb_tickets` Different before and after: pre-existing drift, not update-caused; no config export needed.

# Second step: all other dependencies (minor, same major)

Requested after the first step. Logs: [composer-update-all.txt](composer-update-all.txt) (exit 0), [composer-update-all-attempt1-failed.txt](composer-update-all-attempt1-failed.txt), [lock-diff-all.txt](lock-diff-all.txt), [audit-after-all.txt](audit-after-all.txt) (clean), [updb-all.txt](updb-all.txt), [config-export.diff](config-export.diff).

| Package | Before | After |
|---|---|---|
| better_exposed_filters | 7.1.2 | 7.2.0 (post-updates add `no_reset: false` to 7 views, exported) |
| search_api | 1.41.0 | 1.43.0 |
| jsonapi_resources | 1.5.0 | 1.8.0 |
| schemata, schemata_json_schema | 1.0.0 | 1.1.0 |
| state_machine | 1.14.0 | 1.15.0 |
| mcp_server / mcp_server_oauth | 2.0.0-beta6 / 1.0.0-alpha1 | beta7 / alpha2 |
| mcp/sdk | 0.7.1 | 0.9.0 (also fixes GHSA-f4rf-6ghj-mhr6 properly) |
| plus dev tools and consolidation/*, laravel/prompts, psysh ... | | see lock-diff-all.txt |

## Blocked
- **Core 11.4.13:** drupal/core-recommended 11.4.13 pins justinrainbow/json-schema ~6.8.2, but the root composer.json requires ^6.9. Needs a manifest decision. core-dev, -project-message and -recipe-unpack are held at 11.3.22 to match core.
- **display_builder beta5:** its new patch (ui_patterns MR 514, issue 3604317) no longer applies to ui_patterns 2.0.23 (fix already partly upstream). Held at beta4. Fix: add the patch to `patches-ignore` or wait for beta6.
- **migrate_tools 6.1.5:** needs drush >= 13.7 (drush is 13.6.2). Drush itself is not updated.

Config: the full `drush cex` also exported unrelated pre-existing drift (bb_core, mcp_server_tool_bridge, ...). It was discarded; only the update-caused `no_reset` changes are kept.

# Third step: static analysis after the tooling update

The second step raised `mglaman/phpstan-drupal` from 2.0.15 to 2.4.0 and `phpstan/phpstan` from 2.2.1 to 2.3.6. Their new rules found 176 errors in custom code (`provision_exec('phpstan')`, exit 1). The code is fixed rather than the rules ignored:

- **`dependencySerializationTraitProperty.unsupportedPrivateProperty`** (161 properties in 81 files): `DependencySerializationTrait` cannot see the private properties of a subclass. A serialized form or plugin then stores its services by value instead of by service ID. These properties are now `protected`.
- **`drupal.hookEntityOperationAlterMissingCacheabilityParameter`**: the two `hook_entity_operation_alter` implementations take the `CacheableMetadata` parameter that Drupal 11.3 added.
- **`drupal.entityStoragePropertyAssignment`**: `OnboardingDestination` fetches the user storage when it needs it.
- **`drupal.symfonyYamlParse`**: `designbook:config-validate` uses `Drupal\Component\Serialization\Yaml::decode()`.
- **Tests:** the narrower inference of phpstan 2.3 gets `assertInstanceOf` checks. A lock double gets the entity type manager instead of a storage. The storage decorator `FailingSaveStorageDecorator` has a path-scoped ignore with its reason in `phpstan.neon.dist`.

After the fixes, phpcs, phpmd and phpstan all exit 0.
