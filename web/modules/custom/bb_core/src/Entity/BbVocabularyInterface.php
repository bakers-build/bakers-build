<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Interface for bakers.build vocabulary config entities.
 *
 * A vocabulary is a bundle of bb_term — the node-free replacement for a
 * core taxonomy vocabulary.
 */
interface BbVocabularyInterface extends ConfigEntityInterface {

  /**
   * Returns the vocabulary description.
   */
  public function getDescription(): string;

}
