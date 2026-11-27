<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for webhook lists.
 */
final class BbWebhookViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();

    $data['bb_webhook']['edit_dialog_bb_webhook'] = [
      'title' => $this->t('Name, opening the edit form in the dialog'),
      'help' => $this->t('The webhook name, linked to its edit form in the shell dialog.'),
      'field' => ['id' => 'bb_entity_edit_dialog'],
    ];

    return $data;
  }

}
