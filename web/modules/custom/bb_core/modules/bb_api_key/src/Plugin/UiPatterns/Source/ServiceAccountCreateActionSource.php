<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\ui_patterns\Attribute\Source;

/**
 * The `Create service account` plus on the Service Accounts list.
 *
 * Default `createAccess()`/`dialogRouteParameters()` already resolve the
 * workspace from the current route (CreateActionSourceBase), the same as
 * TeamCreateActionSource; only the dialog route, label and own screen gate
 * differ here.
 */
#[Source(
  id: 'bb_service_account_create_action',
  label: new TranslatableMarkup('[bakers.build] Create service account action'),
  description: new TranslatableMarkup('Opens the workspace service-account creation dialog.'),
  prop_types: ['slot'],
)]
final class ServiceAccountCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    return 'bb_api_key.service_account.add';
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Create service account');
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
    return $this->routeMatch->getRouteName() === 'view.bb_service_accounts.settings';
  }

}
