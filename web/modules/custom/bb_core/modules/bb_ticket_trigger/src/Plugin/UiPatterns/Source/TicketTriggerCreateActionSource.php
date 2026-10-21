<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\UiPatterns\Source;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The Add trigger action on a template's Triggers tab.
 */
#[Source(
  id: 'bb_ticket_trigger_create_action',
  label: new TranslatableMarkup('[bakers.build] Add ticket trigger action'),
  description: new TranslatableMarkup('Opens the trigger add form for the current ticket template.'),
  prop_types: ['slot'],
)]
final class TicketTriggerCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_ticket_trigger.add_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Add trigger');
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
    return $this->routeMatch->getRouteName() === 'view.bb_ticket_triggers.template_list'
      && $this->template() instanceof BbTicketTemplateInterface;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The add route's parameters.
   */
  protected function dialogRouteParameters(): array {
    $template = $this->template();
    return $template instanceof BbTicketTemplateInterface ? $template->toUrl()->getRouteParameters() : [];
  }

  /**
   * {@inheritdoc}
   */
  protected function createAccess(): AccessResultInterface {
    if (!$this->template() instanceof BbTicketTemplateInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $route_access = Url::fromRoute($this->dialogRoute(), $this->dialogRouteParameters())
      ->access($this->currentUser, TRUE);
    return AccessResult::allowed()->addCacheContexts(['route'])->andIf($route_access);
  }

  /**
   * The template the current Triggers tab belongs to.
   */
  private function template(): ?BbTicketTemplateInterface {
    $template = $this->routeMatch->getParameter('bb_ticket_template');
    return $template instanceof BbTicketTemplateInterface ? $template : NULL;
  }

}
