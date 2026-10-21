<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Selects the first applicable profile for an application request.
 */
final class IslandProfileSelector {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly IslandConditionEvaluator $evaluator,
  ) {
  }

  /**
   * Selects an enabled profile, falling back to the app's default profile.
   *
   * Conditional profiles are ordered by ascending weight and then by their
   * machine name. The deterministic tie-breaker keeps selection stable when
   * two profiles have the same configured priority. Profiles without
   * conditions are only ever selected as the app's default.
   *
   * @param \Drupal\island\Entity\App $app
   *   The app whose profiles are considered.
   * @param \Drupal\Core\Cache\CacheableMetadata|null $cache
   *   Collects the cacheability of the decision, including every rejected
   *   candidate, so a caller can vary also the output when nothing matched.
   *
   * @return \Drupal\island\Entity\IslandProfile|null
   *   The selected profile, or NULL when no usable profile exists.
   */
  public function select(App $app, ?CacheableMetadata $cache = NULL): ?IslandProfile {
    $cache ??= new CacheableMetadata();
    $cache->addCacheableDependency($app)->addCacheTags(['config:island_profile_list']);
    $profiles = array_filter($this->entityTypeManager->getStorage('island_profile')->loadByProperties([
      'app' => $app->id(),
      'status' => TRUE,
    ]), static fn($profile): bool => $profile instanceof IslandProfile && $profile->getConditions() !== []);
    uasort($profiles, static fn(IslandProfile $a, IslandProfile $b): int => [
      (int) $a->get('weight'),
      $a->id(),
    ] <=> [
      (int) $b->get('weight'),
      $b->id(),
    ]);

    foreach ($profiles as $profile) {
      if ($this->applies($profile, $cache)) {
        return $profile;
      }
    }

    $default_id = $app->getDefaultProfileId();
    if ($default_id !== '') {
      $default = $this->entityTypeManager->getStorage('island_profile')->load($default_id);
      if ($default instanceof IslandProfile && $default->getAppId() === $app->id() && $default->status() && $this->applies($default, $cache)) {
        return $default;
      }
    }

    return NULL;
  }

  /**
   * Evaluates one profile's conditions and records the decision's metadata.
   */
  private function applies(IslandProfile $profile, CacheableMetadata $cache): bool {
    $access = $this->evaluator->evaluate($profile->getConditions(), $profile->getConditionOperator());
    $cache->addCacheableDependency($profile)->addCacheableDependency($access);
    return $access->isAllowed();
  }

}
