<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultForbidden;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Routing\Access\AccessInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Contradicts a URL that claims a workspace it has no right to.
 *
 * The `_bb_workspace_match` requirement on every `/{bb_workspace}` route:
 * the workspace must be in the account's read scope and the path entity must
 * belong to it (identifiers are instance-unique, so the reference alone would
 * resolve a foreign row). Both failures are 404, never 403, so a boundary does
 * not reveal that a row exists. The verdict is a forbidden result carrying
 * WORKSPACE_MISMATCH_REASON, not a thrown exception: link probes
 * (Url::access()) must render unlinked instead of aborting the page, and
 * BbWorkspaceNotFoundSubscriber turns only that marker into a 404.
 */
final class BbWorkspaceAccessCheck implements AccessInterface {

  /**
   * The reason marking a forbidden result as a workspace failure.
   *
   * Core copies an AccessResultReasonInterface reason into the
   * AccessDeniedHttpException message (AccessAwareRouter::checkAccess), which
   * is what lets the exception subscriber recognise this verdict without
   * guessing. Deliberately not user-facing text: it never reaches a response,
   * because the response it produces is a 404.
   */
  public const WORKSPACE_MISMATCH_REASON = 'bb_core.workspace_mismatch';

  /**
   * Constructs a BbWorkspaceAccessCheck.
   *
   * @param \Drupal\bb_core\Access\WorkspaceResolverInterface $resolver
   *   Resolves the workspace an entity belongs to.
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   The account's OG read scope — reused, not reinvented, so the workspace a
   *   URL may name and the rows a query returns are the same set.
   */
  public function __construct(
    private readonly WorkspaceResolverInterface $resolver,
    private readonly BbWorkspaceReadScopeInterface $readScope,
  ) {
  }

  /**
   * Checks that the path's workspace is legitimate for this account and entity.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $route_match
   *   The current route match.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Allowed, or forbidden with WORKSPACE_MISMATCH_REASON — which reaches the
   *   requester as a 404. Either way it carries the cacheability the verdict
   *   depends on.
   */
  public function access(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $workspace = $route_match->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      // Unreachable through the router — an unknown slug converts to NULL and
      // never gets this far. Reached only when a caller hand-builds a route
      // match, and answering 404 there is the same honest answer.
      return $this->notFound();
    }

    $result = AccessResult::allowed()
      ->addCacheableDependency($workspace)
      // The read scope is per account and derived from OG memberships, so the
      // verdict varies by user and expires when a membership does.
      ->addCacheContexts(['user'])
      ->addCacheTags(['og_membership_list']);

    if (!$this->inReadScope($workspace, $account)) {
      return $this->notFound()->addCacheableDependency($result);
    }

    foreach ($route_match->getParameters() as $name => $value) {
      if ($name === 'bb_workspace' || !$value instanceof EntityInterface) {
        continue;
      }
      if (!$this->resolver->hasChain($value->getEntityTypeId())) {
        // Not a workspace-owned type — nothing for this check to contradict.
        continue;
      }
      $owner = $this->resolver->resolve($value);
      // A NULL here is a row whose chain is broken, i.e. a row that belongs to
      // no workspace. It is deliberately NOT treated as "belongs to every
      // workspace": that would make an orphan reachable under any slug.
      if ($owner === NULL || (int) $owner->id() !== (int) $workspace->id()) {
        return $this->notFound()->addCacheableDependency($result);
      }
      $result->addCacheableDependency($value);
    }

    return $result;
  }

  /**
   * The marked forbidden verdict the exception subscriber turns into a 404.
   *
   * @return \Drupal\Core\Access\AccessResultForbidden
   *   Forbidden, reasoned with WORKSPACE_MISMATCH_REASON.
   */
  private function notFound(): AccessResultForbidden {
    return AccessResult::forbidden(self::WORKSPACE_MISMATCH_REASON);
  }

  /**
   * Whether the account may see this workspace at all.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace the path names.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   *
   * @return bool
   *   TRUE when the workspace is in scope or the account bypasses the scope.
   */
  private function inReadScope(BbWorkspaceInterface $workspace, AccountInterface $account): bool {
    if ($this->readScope->isBypassed($account, 'bb_workspace')) {
      return TRUE;
    }
    return in_array(
      (int) $workspace->id(),
      $this->readScope->workspaceIds($account),
      TRUE,
    );
  }

}
