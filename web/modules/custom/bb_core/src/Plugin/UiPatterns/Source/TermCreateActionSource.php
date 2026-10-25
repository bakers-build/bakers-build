<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The `Add type`/`Add recipe`/`Add label` affordance on the term tabs.
 */
#[Source(
  id: 'bb_term_create_action',
  label: new TranslatableMarkup('[bakers.build] Add term action'),
  description: new TranslatableMarkup('Opens the term add form for the bundle of the current workspace settings tab.'),
  prop_types: ['slot'],
)]
final class TermCreateActionSource extends CreateActionSourceBase {

  /**
   * The bundle of each term tab route.
   */
  private const TABS = [
    'view.bb_terms.types' => 'type',
    'view.bb_terms.recipes' => 'recipe',
    'view.bb_terms.labels' => 'label',
  ];

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_term.add_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) match ($this->tab()) {
      'type' => $this->t('Add type'),
      'recipe' => $this->t('Add recipe'),
      default => $this->t('Add label'),
    };
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
    return $this->tab() !== NULL;
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogRouteParameters(): array {
    return ['bb_vocabulary' => (string) $this->tab()];
  }

  /**
   * {@inheritdoc}
   *
   * The add route also needs the bundle.
   */
  protected function createAccess(): AccessResultInterface {
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface || $this->tab() === NULL) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $route_access = Url::fromRoute($this->dialogRoute(), ['bb_workspace' => $workspace->getSlug()] + $this->dialogRouteParameters())
      ->access($this->currentUser, TRUE);
    return AccessResult::allowed()->addCacheContexts(['route'])->andIf($route_access);
  }

  /**
   * The bundle of the current tab, or NULL off the term tabs.
   */
  private function tab(): ?string {
    return self::TABS[(string) $this->routeMatch->getRouteName()] ?? NULL;
  }

}
