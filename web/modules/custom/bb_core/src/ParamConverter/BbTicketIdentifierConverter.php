<?php

declare(strict_types=1);

namespace Drupal\bb_core\ParamConverter;

/**
 * Binds {bb_ticket} from its identifier, e.g. `proj-12` → `PROJ-12`.
 *
 * @see \Drupal\bb_core\ParamConverter\BbHumanReferenceConverter
 */
final class BbTicketIdentifierConverter extends BbHumanReferenceConverter {

  /**
   * {@inheritdoc}
   */
  protected function entityTypeId(): string {
    return 'bb_ticket';
  }

  /**
   * {@inheritdoc}
   */
  protected function referenceField(): string {
    return 'identifier';
  }

}
