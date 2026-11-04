<?php

declare(strict_types=1);

namespace Drupal\bb_core\Navigation;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Validates the explicit workspace origin of the signed-in account's profile.
 */
final class AccountWorkspaceContext {

  /**
   * The account's own tabs: View, Edit and Profile.
   */
  public const ROUTES = ['entity.user.canonical', 'entity.user.edit_form', 'bb_core.user.profile'];

  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
    private readonly RequestStack $requestStack,
    private readonly AccountProxyInterface $currentUser,
    private readonly EntityRepositoryInterface $entityRepository,
    private readonly BbWorkspaceReadScopeInterface $readScope,
  ) {}

  /**
   * Whether this request addresses the signed-in account's own profile.
   */
  public function isOwnProfile(): bool {
    $account = $this->routeMatch->getParameter('user');
    return in_array($this->routeMatch->getRouteName(), self::ROUTES, TRUE)
      && $account instanceof UserInterface
      && $this->currentUser->isAuthenticated()
      && (string) $account->id() === (string) $this->currentUser->id();
  }

  /**
   * Resolves navigation context and records positive and negative cache terms.
   */
  public function resolve(CacheableMetadata $cache): ?BbWorkspaceInterface {
    $cache->addCacheContexts(['route', 'user', 'user.permissions', 'url.query_args:workspace']);
    $cache->addCacheTags(['bb_workspace_list', 'og_membership_list']);
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if ($workspace instanceof BbWorkspaceInterface) {
      $cache->addCacheableDependency($workspace);
      return $workspace;
    }
    if (!$this->isOwnProfile()) {
      return NULL;
    }
    $query = $this->requestStack->getCurrentRequest()?->query->all() ?? [];
    $uuid = $query['workspace'] ?? NULL;
    if (!is_string($uuid) || !Uuid::isValid($uuid)) {
      return NULL;
    }
    $workspace = $this->entityRepository->loadEntityByUuid('bb_workspace', $uuid);
    if (!$workspace instanceof BbWorkspaceInterface) {
      return NULL;
    }
    $cache->addCacheableDependency($workspace);
    if (!$this->readScope->isBypassed($this->currentUser, 'bb_workspace')
      && !in_array((int) $workspace->id(), $this->readScope->workspaceIds($this->currentUser), TRUE)) {
      return NULL;
    }
    $access = Url::fromRoute('view.tickets.my_work', ['bb_workspace' => $workspace->getSlug()])->access($this->currentUser, TRUE);
    $cache->addCacheableDependency($access);
    return $access->isAllowed() ? $workspace : NULL;
  }

}
