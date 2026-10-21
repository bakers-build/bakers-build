<?php

declare(strict_types=1);

namespace Drupal\island\EventSubscriber;

use Drupal\Core\Config\StorageInterface;
use Drupal\Core\Config\StorageTransformEvent;
use Drupal\island\IslandProfileMigrator;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Preserves upgraded active settings during the legacy provider's final import.
 */
final class IslandMigrationImportSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly StorageInterface $activeStorage,
    private readonly IslandProfileMigrator $migrator,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return ['config.transform.import' => ['preserveMigratedProfiles', -100]];
  }

  /**
   * Carries the saved migration results into the incoming configuration set.
   */
  public function preserveMigratedProfiles(StorageTransformEvent $event): void {
    $legacy_names = $this->activeStorage->listAll('display_builder_page_layout.page_layout.');
    if ($legacy_names === []) {
      return;
    }
    $this->migrator->assertMigrated();
    $names = ['island.app.bakers'];
    foreach ($legacy_names as $name) {
      $legacy = $this->activeStorage->read($name);
      if (is_array($legacy)) {
        $names[] = 'island.profile.' . $legacy['id'];
      }
    }
    foreach ($names as $name) {
      $config = $this->activeStorage->read($name);
      if (is_array($config)) {
        $event->getStorage()->write($name, $config);
      }
    }
  }

}
