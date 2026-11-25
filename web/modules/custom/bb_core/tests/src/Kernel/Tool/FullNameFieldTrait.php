<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Config\FileStorage;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;

/**
 * Installs the site's user full name field from config/sync.
 */
trait FullNameFieldTrait {

  /**
   * Installs `field_full_name` on users as the site configures it.
   */
  protected function installFullNameField(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $field_storage = $storage->read('field.storage.user.field_full_name');
    $field = $storage->read('field.field.user.user.field_full_name');
    self::assertIsArray($field_storage);
    self::assertIsArray($field);
    FieldStorageConfig::create($field_storage)->save();
    FieldConfig::create($field)->save();
  }

}
