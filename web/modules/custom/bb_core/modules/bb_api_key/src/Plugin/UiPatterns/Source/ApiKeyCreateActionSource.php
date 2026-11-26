<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\UiPatterns\Source;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSource;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\user\UserInterface;

/**
 * The `Create API key` plus in the page header, opening the create dialog.
 *
 * A `bb_create_action` whose dialog depends on whose key list it is on: a
 * service account's keys are issued through its workspace's own route, whose
 * workspace comes from the account rather than from the `/user/{user}` screen.
 */
#[Source(
  id: 'bb_api_key_create_action',
  label: new TranslatableMarkup('[bakers.build] Create API key action'),
  description: new TranslatableMarkup('The add action that opens the create-API-key dialog over the key list.'),
  prop_types: ['slot'],
)]
final class ApiKeyCreateActionSource extends CreateActionSource {

  /**
   * {@inheritdoc}
   *
   * A service account's keys go through its workspace's route (lock, binding
   * and admin checks), never the owner-only form.
   */
  protected function dialogRoute(): string {
    return $this->serviceWorkspace() !== NULL ? 'bb_api_key.service_account.key_add' : parent::dialogRoute();
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogRouteParameters(): ?array {
    $workspace = $this->serviceWorkspace();
    $user = $this->routeMatch->getRawParameter('user');
    if ($workspace === NULL || !is_scalar($user)) {
      return parent::dialogRouteParameters();
    }
    return ['bb_workspace' => $workspace->getSlug(), 'user' => (string) $user];
  }

  /**
   * The workspace of the service account whose key list this is, if any.
   */
  private function serviceWorkspace(): ?BbWorkspaceInterface {
    $user = $this->routeMatch->getParameter('user');
    $workspace = $user instanceof UserInterface ? $user->get(ServiceAccountManager::MARKER_FIELD)->entity : NULL;
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

}
