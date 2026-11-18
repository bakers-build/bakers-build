<?php

declare(strict_types=1);

namespace Drupal\island\EventSubscriber;

use Drupal\Core\Config\ConfigEvents;
use Drupal\Core\Config\ConfigImporterEvent;
use Drupal\Core\Config\Entity\ConfigEntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\island\Entity\IslandProfileInterface;
use Drupal\island\IslandProfileEmbedding;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Refuses a config import whose island profiles embed placements wrongly.
 */
final class IslandProfileImportValidateSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly IslandProfileEmbedding $embedding,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [ConfigEvents::IMPORT_VALIDATE => 'onImportValidate'];
  }

  /**
   * Logs every embedding error of a created or updated profile.
   */
  public function onImportValidate(ConfigImporterEvent $event): void {
    $importer = $event->getConfigImporter();
    $comparer = $importer->getStorageComparer();
    $storage = $this->entityTypeManager->getStorage('island_profile');
    assert($storage instanceof ConfigEntityStorageInterface);
    foreach (['create', 'update'] as $op) {
      foreach ($comparer->getChangelist($op) as $name) {
        if (!str_starts_with($name, 'island.profile.')) {
          continue;
        }
        $profile = $storage->createFromStorageRecord((array) $comparer->getSourceStorage()->read($name));
        if (!$profile instanceof IslandProfileInterface) {
          continue;
        }
        foreach ($this->embedding->errors($profile) as $error) {
          $importer->logError($error);
        }
      }
    }
  }

}
