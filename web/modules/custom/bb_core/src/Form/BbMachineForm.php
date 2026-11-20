<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

/**
 * Machine Settings: its edit form as a page, with Delete in a danger zone.
 */
final class BbMachineForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   *
   * @return array{0: \Drupal\Core\StringTranslation\TranslatableMarkup, 1: \Drupal\Core\StringTranslation\TranslatableMarkup}
   *   The label and description.
   */
  protected function dangerZoneText(): array {
    return [
      $this->t('Delete machine'),
      $this->t('Deletes this machine. The confirmation names what goes with it.'),
    ];
  }

}
