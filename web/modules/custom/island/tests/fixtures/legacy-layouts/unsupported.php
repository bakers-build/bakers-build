<?php

/**
 * @file
 * Adds an unsupported source to the disposable legacy-only upgrade fixture.
 */

declare(strict_types=1);

require __DIR__ . '/setup.php';
$storage = \Drupal::service('config.storage');
$name = 'display_builder_page_layout.page_layout.bb_gate';
$legacy = $storage->read($name);
$legacy['sources'][0]['source']['component']['slots']['mark']['sources'][0]['source_id'] = 'unsupported_upgrade_fixture';
$storage->write($name, $legacy);
\Drupal::state()->set('island.migration_fixture.unsupported', $legacy);
echo "Unsupported source fixture installed; updatedb and old-module uninstall must fail.\n";
