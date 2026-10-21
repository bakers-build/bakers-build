<?php

/**
 * @file
 * Restores a legacy-only upgrade fixture on the disposable verification site.
 *
 * Run with ddev drush php:script; this deliberately changes active config and
 * rewinds only the migration update number so updatedb exercises the real hook.
 */

declare(strict_types=1);

use Symfony\Component\Yaml\Yaml;

require __DIR__ . '/prepare-import.php';

\Drupal::service('module_installer')->install(['display_builder_page_layout']);
$storage = \Drupal::service('config.storage');
$original = [];
foreach (['bb_shell', 'bb_gate'] as $id) {
  $name = 'display_builder_page_layout.page_layout.' . $id;
  $legacy = Yaml::parseFile(__DIR__ . '/' . $name . '.yml');
  if ($id === 'bb_shell') {
    $legacy['weight'] = -27;
    $legacy['sources'][0]['source']['component']['slots']['sidebar']['sources'][0]['source']['content'][0]['source']['component']['props']['items']['source']['depth'] = 2;
    $legacy['sources'][0]['source']['component']['slots']['content']['sources'][0]['source']['content'][0]['source']['local_tasks_block'] = [
      'primary' => TRUE,
      'secondary' => FALSE,
    ];
  }
  if ($id === 'bb_gate') {
    $legacy['conditions']['request_path']['pages'] = "/home\n/legacy-upgrade-gate";
    $legacy['sources'][0]['source']['component']['props']['title']['source']['value'] = 'Migrated bakers.build';
  }
  $storage->write($name, $legacy);
  $storage->delete('island.profile.' . $id);
  $original[$name] = $legacy;
}
$storage->delete('island.app.bakers');
\Drupal::state()->set('island.migration_fixture.original', $original);
\Drupal::keyValue('system.schema')->set('bb_core', 8021);
\Drupal::service('config.factory')->reset();
\Drupal::entityTypeManager()->getStorage('island_profile')->resetCache();
\Drupal::entityTypeManager()->getStorage('island_app')->resetCache();
echo "Legacy-only fixture installed: 2 original layouts, 0 bakers.build profiles, bb_core update 8022 pending.\n";
