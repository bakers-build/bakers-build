<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * One row's account status badge and its actions menu.
 *
 * The menu links to the account's Profile (position and background), its
 * API keys page (the same list a person sees for their own keys) and offers
 * Disable.
 *
 * Status is read from the user here because core only shows another
 * account's `status` field to holders of `administer users`, which a
 * workspace administrator lacks; this view is already limited to them. A
 * disabled account offers no actions (`ServiceAccountManager::issueKey()`
 * would refuse them anyway; this only keeps the controls off the row).
 */
#[ViewsField('bb_service_account_actions')]
final class ServiceAccountActions extends FieldPluginBase {

  /**
   * Reads each row's workspace.
   */
  protected ServiceAccountManager $serviceAccountManager;

  /**
   * The viewer, for whether the row offers actions at all.
   */
  protected AccountInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->serviceAccountManager = $container->get(ServiceAccountManager::class);
    $instance->currentUser = $container->get('current_user');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   The status badge and, for an active account, the action menu.
   */
  public function render(ResultRow $values) {
    $user = $this->getEntity($values);
    if (!$user instanceof UserInterface) {
      return '';
    }
    $build = [
      '#cache' => ['max-age' => 0],
      'status' => [
        '#type' => 'component',
        '#component' => 'bb_theme:badge',
        '#props' => [
          'label' => (string) ($user->isBlocked() ? $this->t('Disabled') : $this->t('Active')),
          'tone' => $user->isBlocked() ? 'offline' : 'running',
        ],
        '#suffix' => ' ',
      ],
    ];
    $workspace = $this->serviceAccountManager->workspace($user);
    if ($user->isBlocked() || !$workspace instanceof BbWorkspaceInterface || !$workspace->access('update', $this->currentUser)) {
      return $build;
    }
    $route = ['bb_workspace' => $workspace->getSlug(), 'user' => $user->id()];
    $build['menu'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:action_menu',
      '#props' => [
        'label' => (string) $this->t('Actions for @name', ['@name' => $user->getAccountName()]),
        'items' => $this->items($user, $route),
      ],
    ];
    return $build;
  }

  /**
   * The menu items: Profile, Manage API keys, Disable.
   *
   * @param \Drupal\user\UserInterface $user
   *   The service account.
   * @param array<string, int|string|null> $route
   *   The workspace slug and user ID route parameters.
   *
   * @return list<array{label: string, url: string}>
   *   The items, in order.
   */
  private function items(UserInterface $user, array $route): array {
    $list = Url::fromRoute('view.bb_service_accounts.settings', ['bb_workspace' => $route['bb_workspace']])->toString();
    return [
      [
        'label' => (string) $this->t('Profile'),
        'url' => Url::fromRoute('bb_core.user.profile', ['user' => $user->id()], ['query' => ['destination' => $list]])->toString(),
      ],
      [
        'label' => (string) $this->t('Manage API keys'),
        'url' => Url::fromRoute('view.bb_api_keys.page', ['user' => $user->id()])->toString(),
      ],
      [
        'label' => (string) $this->t('Disable'),
        'url' => Url::fromRoute('bb_api_key.service_account.disable', $route)->toString(),
      ],
    ];
  }

}
