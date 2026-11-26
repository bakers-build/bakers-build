<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Plugin\UiPatterns\Source;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The Create webhook action on a project's, group's or workspace's tab.
 */
#[Source(
  id: 'bb_webhook_create_action',
  label: new TranslatableMarkup('[bakers.build] Create webhook action'),
  description: new TranslatableMarkup('Opens the webhook add form for the scope of the current Webhooks tab.'),
  prop_types: ['slot'],
)]
final class WebhookCreateActionSource extends CreateActionSourceBase {

  /**
   * The add route of each Webhooks tab.
   */
  private const ADD_ROUTES = [
    'view.bb_webhooks.project_list' => 'entity.bb_webhook.add_for_project',
    'view.bb_webhooks.group_list' => 'entity.bb_webhook.add_for_group',
    'view.bb_webhooks.workspace_list' => 'entity.bb_webhook.add_for_workspace',
  ];

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return self::ADD_ROUTES[$this->routeMatch->getRouteName()] ?? 'entity.bb_webhook.add_for_workspace';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Create webhook');
  }

  /**
   * {@inheritdoc}
   */
  protected function forwardsScreenQuery(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  protected function appliesToCurrentRoute(): bool {
    return isset(self::ADD_ROUTES[$this->routeMatch->getRouteName()]);
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, int|string>
   *   The project or group of the tab.
   */
  protected function dialogRouteParameters(): array {
    $project = $this->routeMatch->getParameter('bb_project');
    if ($project instanceof BbProjectInterface) {
      return ['bb_project' => $project->toUrl()->getRouteParameters()['bb_project']];
    }
    // The group tab's View route leaves its group id raw.
    $group = $this->routeMatch->getRawParameter('bb_group');
    return is_scalar($group) ? ['bb_group' => (string) $group] : [];
  }

}
