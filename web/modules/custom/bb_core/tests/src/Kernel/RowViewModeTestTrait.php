<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Symfony\Component\Yaml\Yaml;

/**
 * Installs a shipped listing-row view mode and its display.
 */
trait RowViewModeTestTrait {

  /**
   * Creates the view mode and its Display Builder display from config/sync.
   */
  protected function installRowViewMode(string $entity_type_id, string $mode): void {
    // The repository root, seven levels above this file.
    // The row is built by Display Builder, whose `default` profile it names.
    $this->installConfig(['display_builder']);
    $dir = dirname(__DIR__, 7) . '/config/sync/';
    $manager = $this->container->get('entity_type.manager');
    foreach ([
      'entity_view_mode' => "core.entity_view_mode.$entity_type_id.$mode",
      'entity_view_display' => "core.entity_view_display.$entity_type_id.$entity_type_id.$mode",
    ] as $storage_id => $name) {
      $data = Yaml::parseFile($dir . $name . '.yml');
      self::assertIsArray($data, "$name did not parse as a YAML mapping.");
      unset($data['uuid']);
      $storage = $manager->getStorage($storage_id);
      if ($storage->load($data['id']) === NULL) {
        $storage->create($data)->save();
      }
    }
  }

}
