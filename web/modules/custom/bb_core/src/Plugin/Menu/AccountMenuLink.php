<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Menu;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Menu\MenuLinkDefault;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A `bakers-account` link whose `{user}` route parameter is the viewed account.
 *
 * The account is the route's `{user}`, or the signed-in account on routes
 * without one. A link whose route takes no `{user}` (Workspaces, Log out)
 * cannot be told apart by route access, so it declares
 * `metadata: { owner_only: true }` and shows only on the signed-in account's
 * own pages.
 *
 * Modules may narrow which links show for a viewed account through
 * `hook_bb_core_account_menu_link_access_alter()`, e.g. a non-human
 * account whose area has only some of these pages.
 */
final class AccountMenuLink extends MenuLinkDefault implements AmbientScopedMenuLinkInterface {

  /**
   * The current route, read for the viewed account's `{user}` parameter.
   */
  private RouteMatchInterface $routeMatch;

  /**
   * The signed-in account, the fallback when the route carries none.
   */
  private AccountProxyInterface $currentUser;

  /**
   * Lets other modules narrow the links for a viewed account.
   */
  private ModuleHandlerInterface $moduleHandler;

  /**
   * The resolved uid, or FALSE when there is none; NULL until resolved.
   */
  private int|false|null $uid = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->routeMatch = $container->get('current_route_match');
    $instance->currentUser = $container->get('current_user');
    $instance->moduleHandler = $container->get('module_handler');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getRouteParameters() {
    $uid = $this->resolveUid();
    if ($uid === NULL || $this->isOwnerOnly()) {
      // An owner-only route takes no {user}; adding one would leak into the
      // URL as a query argument.
      return parent::getRouteParameters();
    }
    return ['user' => $uid] + parent::getRouteParameters();
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function getUrlObject($title_attribute = TRUE) {
    if ($this->resolveUid() === NULL) {
      return Url::fromRoute('<nolink>');
    }
    return parent::getUrlObject($title_attribute);
  }

  /**
   * {@inheritdoc}
   */
  public function ambientAccess(): ?AccessResultInterface {
    $uid = $this->resolveUid();
    if ($uid === NULL) {
      return AccessResult::neutral('No account for this menu link.')->addCacheContexts(['route', 'user']);
    }
    $narrowed = AccessResult::neutral();
    $plugin_id = $this->getPluginId();
    $this->moduleHandler->alter('bb_core_account_menu_link_access', $narrowed, $plugin_id, $uid);
    if ($narrowed->isForbidden()) {
      return $narrowed->addCacheContexts(['route', 'user']);
    }
    if (!$this->isOwnerOnly()) {
      return NULL;
    }
    return AccessResult::allowedIf($this->currentUser->isAuthenticated() && $uid === (int) $this->currentUser->id())
      ->addCacheContexts(['route', 'user']);
  }

  /**
   * The route's `{user}`, upcast or raw (Views routes), or the signed-in uid.
   */
  private function resolveUid(): ?int {
    if ($this->uid === NULL) {
      $user = $this->routeMatch->getParameter('user');
      $this->uid = match (TRUE) {
        $user instanceof UserInterface => (int) $user->id(),
        is_numeric($user) => (int) $user,
        $this->currentUser->isAuthenticated() => (int) $this->currentUser->id(),
        default => FALSE,
      };
    }
    return $this->uid === FALSE ? NULL : $this->uid;
  }

  /**
   * Whether the link shows only on the signed-in account's own pages.
   */
  private function isOwnerOnly(): bool {
    return !empty($this->getMetaData()['owner_only']);
  }

}
