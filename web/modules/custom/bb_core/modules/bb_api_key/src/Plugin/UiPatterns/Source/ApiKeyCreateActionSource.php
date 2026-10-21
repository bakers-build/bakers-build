<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\UiPatterns\Source;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\CreateActionSourceBase;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\user\UserInterface;

/**
 * The `Create API key` plus in the page header, opening the create dialog.
 *
 * Placed by the shell `page_header` island beside the other create actions
 * and kept off every route but the owner's API-key list.
 */
#[Source(
  id: 'bb_api_key_create_action',
  label: new TranslatableMarkup('[bakers.build] Create API key action'),
  description: new TranslatableMarkup('The add action that opens the create-API-key dialog over the key list.'),
  prop_types: ['slot'],
)]
final class ApiKeyCreateActionSource extends CreateActionSourceBase {

  /**
   * {@inheritdoc}
   */
  protected function dialogRoute(): string {
    // A service account's keys are issued through its workspace's own
    // route (lock, binding and admin checks), never the owner-only form.
    return $this->serviceWorkspace() !== NULL ? 'bb_api_key.service_account.key_add' : 'bb_api_key.add';
  }

  /**
   * {@inheritdoc}
   */
  protected function dialogRouteParameters(): array {
    $user = $this->pathUser();
    if ($user === NULL) {
      return [];
    }
    $workspace = $this->serviceWorkspace();
    return ($workspace === NULL ? [] : ['bb_workspace' => $workspace->getSlug()]) + ['user' => (int) $user->id()];
  }

  /**
   * {@inheritdoc}
   */
  protected function triggerLabel(): string {
    return (string) $this->t('Create API key');
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
    return $this->routeMatch->getRouteName() === 'view.bb_api_keys.page';
  }

  /**
   * {@inheritdoc}
   *
   * The add route is user-scoped, not workspace-prefixed: offer the plus
   * exactly when that route's own owner-only check allows it.
   */
  protected function createAccess(): AccessResultInterface {
    $user = $this->pathUser();
    if ($user === NULL) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $route_access = Url::fromRoute($this->dialogRoute(), $this->dialogRouteParameters())
      ->access($this->currentUser, TRUE);
    return AccessResult::allowed()->addCacheContexts(['route', 'user'])->andIf($route_access);
  }

  /**
   * The path account's workspace when it is a service account, else NULL.
   */
  private function serviceWorkspace(): ?BbWorkspaceInterface {
    $workspace = $this->pathUser()?->get(ServiceAccountManager::MARKER_FIELD)->entity;
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

  /**
   * The account in the path, upcast or raw.
   */
  private function pathUser(): ?UserInterface {
    $user = $this->routeMatch->getParameter('user');
    return $user instanceof UserInterface ? $user : NULL;
  }

}
