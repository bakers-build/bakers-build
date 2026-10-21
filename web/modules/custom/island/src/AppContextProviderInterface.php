<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;

/**
 * Optionally declares typed app contexts for profile configuration widgets.
 */
interface AppContextProviderInterface {

  /**
   * Returns contexts available while configuring this app's profile mappings.
   *
   * These are configuration-time previews or typed empty contexts. Runtime
   * values come from getIslandData(), and contexts are never persisted.
   *
   * @return array<string, \Drupal\Core\Plugin\Context\ContextInterface>
   *   Named contexts whose identifiers match the runtime data contexts.
   */
  public function getProfileContexts(App $app, IslandProfile $profile): array;

}
