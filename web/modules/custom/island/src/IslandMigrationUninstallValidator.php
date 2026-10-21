<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Extension\ModuleUninstallValidatorInterface;

/**
 * Blocks removal of the legacy provider until its active data is preserved.
 */
final class IslandMigrationUninstallValidator implements ModuleUninstallValidatorInterface {

  public function __construct(private readonly IslandProfileMigrator $migrator) {
  }

  /**
   * {@inheritdoc}
   */
  public function validate($module): array {
    if ($module !== 'display_builder_page_layout') {
      return [];
    }
    try {
      $this->migrator->assertMigrated();
    }
    catch (\UnexpectedValueException $exception) {
      return [$exception->getMessage()];
    }
    return [];
  }

}
