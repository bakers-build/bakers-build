<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Theme\ComponentPluginManager;
use Drupal\Core\Render\Component\Exception\ComponentNotFoundException;

/**
 * Reads the declared slots from an SDC layout.
 */
final class IslandLayoutManager {

  public function __construct(
    private readonly ComponentPluginManager $componentManager,
  ) {
  }

  /**
   * Returns the layout's slots, or an empty array for an unknown layout.
   *
   * @return array<string, array<string, mixed>>
   *   Slot definitions.
   */
  public function getSlots(string $component_id): array {
    if ($component_id === '') {
      return [];
    }
    try {
      $component = $this->componentManager->find($component_id);
    }
    catch (ComponentNotFoundException) {
      return [];
    }
    return $component->metadata->slots ?? [];
  }

  /**
   * Returns all discoverable SDC definitions for an administration form.
   *
   * @return array<string, array<string, mixed>>
   *   Component definitions.
   */
  public function getDefinitions(): array {
    return $this->componentManager->getDefinitions();
  }

}
