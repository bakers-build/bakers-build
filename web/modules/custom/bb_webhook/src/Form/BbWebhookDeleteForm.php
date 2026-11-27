<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Form;

use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\Core\Url;

/**
 * Deletes a webhook and returns to its scope's Webhooks tab.
 */
final class BbWebhookDeleteForm extends BbContentEntityDeleteForm {

  /**
   * {@inheritdoc}
   */
  protected function getRedirectUrl(): Url {
    $webhook = $this->getEntity();
    assert($webhook instanceof BbWebhookInterface);
    return match ($webhook->scope()) {
      'project' => Url::fromRoute('view.bb_webhooks.project_list', ['bb_project' => $webhook->get('project_id')->target_id]),
      'group' => Url::fromRoute('view.bb_webhooks.group_list', ['bb_group' => $webhook->get('group_id')->target_id]),
      default => Url::fromRoute('view.bb_webhooks.workspace_list'),
    };
  }

}
