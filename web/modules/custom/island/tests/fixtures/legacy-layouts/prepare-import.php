<?php

/**
 * @file
 * Aligns disposable recipe config identities with the full CIM test source.
 */

declare(strict_types=1);

use Drupal\Core\Config\FileStorage;

$active = \Drupal::service('config.storage');
$incoming = new FileStorage(DRUPAL_ROOT . '/../config/sync');
$original = \Drupal::state()->get('island.migration_fixture.config_uuids', []);
$aligned = 0;
foreach ($incoming->listAll() as $name) {
  $source = $incoming->read($name);
  $current = $active->read($name);
  if (!is_array($source) || !is_array($current) || empty($source['uuid']) || empty($current['uuid']) || $current['uuid'] === $source['uuid']) {
    continue;
  }
  $original[$name] ??= $current['uuid'];
  $current['uuid'] = $source['uuid'];
  $active->write($name, $current);
  $aligned++;
}
\Drupal::state()->set('island.migration_fixture.config_uuids', $original);
\Drupal::configFactory()->reset();
echo "Aligned $aligned existing config UUIDs; all other values and content retained.\n";
