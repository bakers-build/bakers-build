<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\ContentEntityInterface;

/**
 * Interface for bakers.build term content entities (node-free taxonomy replacement).
 */
interface BbTermInterface extends ContentEntityInterface {

  /**
   * Returns the term name.
   */
  public function getName(): string;

}
