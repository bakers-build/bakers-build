<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The `Add environment` affordance on the Catalog Environments tab.
 */
#[Source(
  id: 'bb_environment_create_action',
  label: new TranslatableMarkup('[bakers.build] Add environment action'),
  description: new TranslatableMarkup('Opens the environment add form of the current workspace on the Catalog Environments tab.'),
  prop_types: ['slot'],
)]
final class EnvironmentCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'entity.bb_environment.add_for_workspace';
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
    return $this->routeMatch->getRouteName() === 'view.bb_environments.catalog';
  }

}
