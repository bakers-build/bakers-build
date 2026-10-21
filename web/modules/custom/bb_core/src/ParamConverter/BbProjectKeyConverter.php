<?php

declare(strict_types=1);

namespace Drupal\bb_core\ParamConverter;

/**
 * Binds {bb_project} from its key, e.g. `bakers` → `bakers.build`.
 *
 * @see \Drupal\bb_core\ParamConverter\BbHumanReferenceConverter
 */
final class BbProjectKeyConverter extends BbHumanReferenceConverter {

  /**
   * {@inheritdoc}
   */
  protected function entityTypeId(): string {
    return 'bb_project';
  }

  /**
   * {@inheritdoc}
   */
  protected function referenceField(): string {
    return 'key';
  }

}
