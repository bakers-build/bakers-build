<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;

/**
 * The workspaces the signed-in account may switch into.
 *
 * Same candidate set as `BbHomeController::candidates()`: every workspace
 * when the account bypasses the read scope, otherwise the membership set.
 */
trait WorkspaceSwitcherCandidatesTrait {

  /**
   * The entity type manager.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * The workspace read-scope oracle.
   */
  private BbWorkspaceReadScopeInterface $readScope;

  /**
   * The current-session account.
   */
  private AccountProxyInterface $currentUser;

  /**
   * The workspaces this account may land in, ordered by slug.
   *
   * @return list<\Drupal\bb_core\Entity\BbWorkspaceInterface>
   *   Re-indexed from zero.
   */
  private function candidates(): array {
    $storage = $this->entityTypeManager->getStorage('bb_workspace');
    $ids = NULL;
    if (!$this->readScope->isBypassed($this->currentUser, 'bb_workspace')) {
      $ids = $this->readScope->workspaceIds($this->currentUser);
      if ($ids === []) {
        return [];
      }
    }
    $candidates = [];
    foreach ($storage->loadMultiple($ids) as $workspace) {
      if ($workspace instanceof BbWorkspaceInterface) {
        $candidates[] = $workspace;
      }
    }
    usort(
      $candidates,
      static fn (BbWorkspaceInterface $a, BbWorkspaceInterface $b): int
        => strcmp((string) $a->getSlug(), (string) $b->getSlug()),
    );
    return $candidates;
  }

  /**
   * The validated account navigation context.
   */
  private AccountWorkspaceContext $workspaceContext;

  /**
   * The route workspace or validated profile origin, without a fallback.
   */
  private function ambientWorkspace(): ?BbWorkspaceInterface {
    return $this->workspaceContext->resolve(new CacheableMetadata());
  }

  /**
   * The first letter of each of the first two words of a name.
   */
  private function switcherInitials(string $name): string {
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    $letters = array_map(
      static fn (string $part): string => mb_strtoupper(mb_substr($part, 0, 1)),
      $parts,
    );
    return implode('', array_slice($letters, 0, 2));
  }

  /**
   * One of the `person` colour keys, derived from an entity id.
   */
  private function switcherColor(int $id): string {
    $colors = ['running', 'attention', 'unassigned', 'lease', 'offline'];
    return $colors[$id % count($colors)];
  }

}
