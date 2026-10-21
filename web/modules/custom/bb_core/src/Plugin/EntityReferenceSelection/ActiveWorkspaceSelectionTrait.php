<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\bb_core\Access\BbActiveWorkspaceInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\og\OgMembershipInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The two questions every workspace-narrowing selection handler asks first.
 *
 * "May this account be narrowed at all" and "which workspace am I in". A trait
 * because the `user` plugins must extend core's `UserSelection`.
 *
 * The workspace travels as a selection setting because the entity-autocomplete
 * endpoint carries no `{bb_workspace}`; `EntityAutocomplete` hashes
 * `#selection_settings` into its URL. The route is the fallback.
 *
 * @property \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
 */
trait ActiveWorkspaceSelectionTrait {

  /**
   * The selection_settings key carrying the active workspace's entity id.
   *
   * Public because it is a contract between three places: the plugins, the
   * widget alter in bb_core.module that writes it, and the tests that assert
   * the endpoint's handler still narrows. Declared on the trait rather than on
   * the base class so both inheritance branches carry it; PHP copies a trait
   * constant into every using class, so
   * `ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING` — which is how the
   * module and the tests already spell it — keeps resolving unchanged.
   */
  public const ACTIVE_WORKSPACE_SETTING = 'bb_active_workspace';

  /**
   * The active-workspace resolver, used when no setting was handed over.
   *
   * @var \Drupal\bb_core\Access\BbActiveWorkspaceInterface
   */
  protected BbActiveWorkspaceInterface $activeWorkspace;

  /**
   * The membership oracle, asked only for the bypass question.
   *
   * @var \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface
   */
  protected BbWorkspaceReadScopeInterface $readScope;

  /**
   * Injects the two services, from a plugin's own ::create().
   *
   * A method rather than a constructor, because the classes using this trait
   * inherit two different constructors from core and neither may be restated:
   * `DefaultSelection` and `UserSelection` take nine and ten positional
   * arguments respectively, and a copy of either rots the moment core adds an
   * eleventh.
   *
   * @param \Symfony\Component\DependencyInjection\ContainerInterface $container
   *   The service container.
   */
  protected function initActiveWorkspaceServices(ContainerInterface $container): void {
    $this->activeWorkspace = $container->get('bb_core.active_workspace');
    $this->readScope = $container->get('bb_core.workspace_read_scope');
  }

  /**
   * The workspace to narrow to, or NULL when there is none.
   *
   * @return int|null
   *   The active workspace's entity id.
   */
  protected function activeWorkspaceId(): ?int {
    $configured = $this->configuration[self::ACTIVE_WORKSPACE_SETTING] ?? NULL;
    if (is_numeric($configured)) {
      return (int) $configured;
    }
    $workspace = $this->activeWorkspace->resolve();
    return $workspace === NULL ? NULL : (int) $workspace->id();
  }

  /**
   * The uids holding an active membership in one workspace.
   *
   * The same question — and deliberately the same query — as
   * `BbWorkspaceReadScope::membersOfWorkspaces()`, which is private to that
   * class. An aggregate query so the uids come back in one round trip, and
   * `entity_id` compared as a STRING because that is what the base field is.
   * `accessCheck(FALSE)` is deliberate and matches the read scope's own
   * reasoning: this inner query answers the structural question "who belongs to
   * this workspace", while the outer query keeps its access check and therefore
   * its read-scope bound.
   *
   * @param int $workspace_id
   *   The workspace whose members to resolve.
   *
   * @return array<int>
   *   The user ids.
   */
  protected function memberIdsOfWorkspace(int $workspace_id): array {
    $rows = $this->entityTypeManager->getStorage('og_membership')
      ->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_workspace')
      ->condition('entity_id', (string) $workspace_id)
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->groupBy('uid')
      ->execute();
    $uids = [];
    foreach ($rows as $row) {
      if (isset($row['uid'])) {
        $uids[] = (int) $row['uid'];
      }
    }
    return $uids;
  }

}
