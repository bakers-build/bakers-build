<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\views\field;

use Drupal\Core\Routing\RedirectDestinationTrait;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\OverlayTrigger;
use Drupal\user\UserInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A Revoke link to this module's own owner-only confirmation form.
 *
 * Never contrib's administrator delete route (`/admin/.../consumer/.../delete`)
 * — that route is permission-gated for administrators, not key owners.
 */
#[ViewsField('bb_api_key_revoke_link')]
final class ApiKeyRevokeLink extends FieldPluginBase {

  use RedirectDestinationTrait;

  /**
   * The current user, for the route's required {user} parameter.
   */
  protected AccountInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
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
   *   The revoke link render array, or an empty string for a non-entity row.
   */
  public function render(ResultRow $values) {
    $entity = $this->getEntity($values);
    if (!$entity instanceof ConsumerInterface) {
      return '';
    }
    $owner = $entity->get('owner_id')->entity;
    $workspace = $owner instanceof UserInterface ? $owner->get(ServiceAccountManager::MARKER_FIELD)->entity : NULL;
    if ($owner instanceof UserInterface && $workspace instanceof BbWorkspaceInterface) {
      // A service account's key is revoked through its workspace's route,
      // then returns to this list.
      return [
        '#type' => 'link',
        '#title' => $this->t('Revoke'),
        '#url' => Url::fromRoute('bb_api_key.service_account.key_revoke', [
          'bb_workspace' => $workspace->getSlug(),
          'user' => $owner->id(),
          'consumer' => $entity->id(),
        ], ['query' => $this->getDestinationArray()]),
      ];
    }
    $user = $this->view->args[0] ?? $this->currentUser->id();
    $url = Url::fromRoute('bb_api_key.delete', [
      'user' => $user,
      'consumer' => $entity->id(),
    ]);
    // The revoke confirm dialog over this list; the href is the page.
    return [
      '#type' => 'link',
      '#title' => $this->t('Revoke'),
      '#url' => (clone $url)->setOption('attributes', OverlayTrigger::attributes($url)),
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#cache' => ['contexts' => ['url.path', 'url.query_args']],
    ];
  }

}
