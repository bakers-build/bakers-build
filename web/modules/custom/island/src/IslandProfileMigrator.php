<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Config\StorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Migrates legacy config without deleting or partially accepting sources.
 */
final class IslandProfileMigrator {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly StorageInterface $storage,
    private readonly IslandLegacyLayoutConverter $converter,
  ) {
  }

  /**
   * Validates every source before writing; repeated migration changes nothing.
   */
  public function migrate(): int {
    $profiles = $this->prepare();
    if ($profiles === []) {
      return 0;
    }
    $app_storage = $this->entityTypeManager->getStorage('island_app');
    if (!$app_storage->load('bakers')) {
      App::create(['id' => 'bakers', 'label' => 'bakers.build', 'provider' => 'default'])->save();
    }
    $profile_storage = $this->entityTypeManager->getStorage('island_profile');
    $created = 0;
    foreach ($profiles as $id => $values) {
      if (!$profile_storage->load($id)) {
        IslandProfile::create($values)->save();
        $created++;
      }
    }
    $this->setDefaultProfile($profiles);
    return $created;
  }

  /**
   * Retains the highest-priority enabled legacy layout without constraints.
   */
  private function setDefaultProfile(array $profiles): void {
    $app = $this->entityTypeManager->getStorage('island_app')->load('bakers');
    if (!$app instanceof App || $app->getDefaultProfileId() !== '') {
      return;
    }
    $defaults = array_filter($profiles, static fn(array $profile): bool => $profile['status'] && $profile['conditions'] === []);
    uasort($defaults, static fn(array $a, array $b): int => [$a['weight'], $a['id']] <=> [$b['weight'], $b['id']]);
    if ($defaults !== []) {
      $app->set('default_profile', array_key_first($defaults))->save();
    }
  }

  /**
   * Refuses cleanup until every legacy record has an equivalent saved profile.
   */
  public function assertMigrated(): void {
    foreach (array_keys($this->prepare()) as $id) {
      if (!$this->entityTypeManager->getStorage('island_profile')->load($id)) {
        throw new \UnexpectedValueException("Page layout $id has not been migrated. Run updatedb before removing display_builder_page_layout.");
      }
    }
  }

  /**
   * Ignores mapping key order while preserving types and sequences.
   */
  private function canonicalValue(mixed $value): mixed {
    if (!is_array($value)) {
      return $value;
    }
    if (!array_is_list($value)) {
      ksort($value);
    }
    return array_map($this->canonicalValue(...), $value);
  }

  /**
   * Builds the whole migration batch, detecting collisions before any writes.
   */
  private function prepare(): array {
    $profiles = [];
    foreach ($this->storage->listAll('display_builder_page_layout.page_layout.') as $name) {
      $legacy = (array) $this->storage->read($name);
      try {
        $values = $this->converter->convert($legacy);
        $existing = $this->entityTypeManager->getStorage('island_profile')->load($values['id']);
        if ($existing instanceof IslandProfile) {
          foreach ($values as $key => $value) {
            if ($this->canonicalValue($existing->get($key)) !== $this->canonicalValue($value)) {
              throw new \UnexpectedValueException("Existing profile conflicts at $key; export and reconcile it before retrying");
            }
          }
        }
        $profiles[$values['id']] = $values;
      }
      catch (\UnexpectedValueException $exception) {
        throw new \UnexpectedValueException("Cannot migrate $name: {$exception->getMessage()}. Original configuration retained; do not remove display_builder_page_layout.", 0, $exception);
      }
    }
    return $profiles;
  }

}
