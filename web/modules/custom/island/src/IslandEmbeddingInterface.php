<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * An island placement that renders other placements of its profile inside it.
 */
interface IslandEmbeddingInterface {

  /**
   * Returns the placement ids this placement renders, once per reference.
   *
   * @return string[]
   *   Placement ids, repeated when referenced more than once.
   */
  public function embeddedPlacements(): array;

}
