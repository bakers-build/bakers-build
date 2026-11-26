<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The `Add environment` affordance on a project's Environments tab.
 */
#[Source(
  id: 'bb_environment_create_action',
  label: new TranslatableMarkup('[bakers.build] Add environment action'),
  description: new TranslatableMarkup('Opens the environment add form of the current project on its Environments tab.'),
  prop_types: ['slot'],
)]
final class EnvironmentCreateActionSource extends CreateActionSource {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_environment.add_for_project';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Add environment');
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
    return $this->routeMatch->getRouteName() === 'view.bb_environments.project_list' && $this->project() instanceof BbProjectInterface;
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogRouteParameters(): array {
    $project = $this->project();
    return $project instanceof BbProjectInterface ? $project->toUrl()->getRouteParameters() : [];
  }

  /**
   * {@inheritdoc}
   *
   * The parent checks the route with the workspace alone; this route also
   * needs its project.
   */
  protected function createAccess(): AccessResultInterface {
    $project = $this->project();
    if (!$project instanceof BbProjectInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $route_access = Url::fromRoute($this->dialogRoute(), $this->dialogRouteParameters())
      ->access($this->currentUser, TRUE);
    return AccessResult::allowed()->addCacheContexts(['route'])->andIf($route_access);
  }

  /**
   * The project the current Environments tab belongs to.
   */
  private function project(): ?BbProjectInterface {
    $project = $this->routeMatch->getParameter('bb_project');
    return $project instanceof BbProjectInterface ? $project : NULL;
  }

}
