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
 * The `Add template` affordance on a project's Templates tab.
 *
 * The add route is project-scoped, so the dialog address and its access check
 * both carry the project the tab was opened for.
 */
#[Source(
  id: 'bb_ticket_template_create_action',
  label: new TranslatableMarkup('[bakers.build] Add ticket template action'),
  description: new TranslatableMarkup('Opens the ticket template add form for the current project or workspace.'),
  prop_types: ['slot'],
)]
final class TicketTemplateCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return $this->onWorkspaceList() ? 'entity.bb_ticket_template.add_for_workspace' : 'entity.bb_ticket_template.add_for_project';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Add template');
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
    return $this->onWorkspaceList() || ($this->routeMatch->getRouteName() === 'view.bb_ticket_templates.project_list'
      && $this->project() instanceof BbProjectInterface);
  }

  /**
   * Whether the current screen is the workspace Templates page.
   */
  private function onWorkspaceList(): bool {
    return $this->routeMatch->getRouteName() === 'view.bb_ticket_templates.workspace_list';
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogRouteParameters(): array {
    if ($this->onWorkspaceList()) {
      return parent::dialogRouteParameters();
    }
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
    if ($this->onWorkspaceList()) {
      return parent::createAccess();
    }
    $project = $this->project();
    if (!$project instanceof BbProjectInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $route_access = Url::fromRoute($this->dialogRoute(), $this->dialogRouteParameters())
      ->access($this->currentUser, TRUE);
    return AccessResult::allowed()->addCacheContexts(['route'])->andIf($route_access);
  }

  /**
   * The project the current Templates tab belongs to.
   */
  private function project(): ?BbProjectInterface {
    $project = $this->routeMatch->getParameter('bb_project');
    return $project instanceof BbProjectInterface ? $project : NULL;
  }

}
