<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Component\Plugin\Exception\ContextException;
use Drupal\Core\Condition\ConditionAccessResolverTrait;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Plugin\Context\ContextHandlerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\Statistics\Context\FigureContextRepository;
use Drupal\og\MembershipManagerInterface;
use Drupal\user\UserInterface;

/**
 * Applies one figure's permission, exact context shape, and Conditions.
 */
final class FigureDisclosure {

  use ConditionAccessResolverTrait;

  public function __construct(
    private readonly BbRankCapabilityInterface $rankCapability,
    private readonly ?MembershipManagerInterface $membershipManager,
    private readonly BbRankEntityFence $fence,
    private readonly FigureContextRepository $contextRepository,
    private readonly ContextHandlerInterface $contextHandler,
  ) {}

  /**
   * Determines whether an account may view a figure in its route context.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The requesting account.
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   */
  public function mayView(AccountInterface $account, BbFigureInterface $figure, array $entities): bool {
    if (!$this->contextAllows($figure, $entities)) {
      return FALSE;
    }

    $permission = 'view bakers figure ' . $figure->id();
    $contextPermission = $this->hasContextPermission($account, $permission, $entities);
    $target = $entities['user'] ?? NULL;
    $userPermission = $this->hasUserPermission($account, $permission, $target);
    // The account's ordinary permission answer contains the tenant-blind
    // union of every OG rank it holds. Treating that union as site-wide here
    // would let a rank in workspace A disclose a figure scoped to workspace
    // B. Only an actual Drupal role may bypass the context chain.
    $siteWidePermission = $this->rankCapability->hasSiteWidePermission($account, $permission);
    if (!$siteWidePermission && !$contextPermission && !$userPermission) {
      return FALSE;
    }
    if (!$target instanceof UserInterface || (int) $target->id() === (int) $account->id()) {
      return TRUE;
    }
    return $contextPermission || $userPermission;
  }

  /**
   * Applies all non-permission context gates.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   */
  private function contextAllows(BbFigureInterface $figure, array $entities): bool {
    return $this->hasExactShape($figure, $entities)
      && $this->hasValidContextRelationship($entities)
      && $this->conditionsPass($figure, $entities);
  }

  /**
   * Checks permissions inherited through route group contexts.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The requesting account.
   * @param string $permission
   *   The figure permission.
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   */
  private function hasContextPermission(AccountInterface $account, string $permission, array $entities): bool {
    foreach (['project', 'team', 'workspace'] as $key) {
      $entity = $entities[$key] ?? NULL;
      if ($entity instanceof EntityInterface
        && $this->hasPermissionInChain($account, $permission, $entity)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Checks self access and permissions inherited through user memberships.
   */
  private function hasUserPermission(AccountInterface $account, string $permission, mixed $target): bool {
    if (!$target instanceof UserInterface) {
      return FALSE;
    }
    if ($this->membershipManager === NULL) {
      return FALSE;
    }
    foreach ($this->membershipManager->getMemberships((int) $target->id()) as $membership) {
      $group = $membership->getGroup();
      if ($group instanceof EntityInterface
        && $this->rankCapability->hasGroupPermission($account, $permission, $group)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Prevents a combined context from pairing an unrelated user and group.
   *
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   */
  private function hasValidContextRelationship(array $entities): bool {
    $target = $entities['user'] ?? NULL;
    if (!$target instanceof UserInterface) {
      return TRUE;
    }
    $groups = $this->relationshipGroups($entities);
    if ($groups === []) {
      return TRUE;
    }
    if ($this->membershipManager === NULL) {
      return FALSE;
    }
    return $this->belongsToAny($target, $groups);
  }

  /**
   * Gets team and workspace groups named or implied by a route context.
   *
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   *
   * @return array<EntityInterface>
   *   The groups used to validate a user relationship.
   */
  private function relationshipGroups(array $entities): array {
    $groups = [];
    foreach (['team', 'workspace'] as $key) {
      $entity = $entities[$key] ?? NULL;
      if ($entity instanceof EntityInterface) {
        $groups[] = $entity;
      }
    }
    $project = $entities['project'] ?? NULL;
    if (!$project instanceof EntityInterface) {
      return $groups;
    }
    foreach ($this->fence->groupsAnchoredBy($project) as $group) {
      if (in_array($group->getEntityTypeId(), ['bb_team', 'bb_workspace'], TRUE)) {
        $groups[] = $group;
      }
    }
    return $groups;
  }

  /**
   * Checks whether a user belongs to at least one group.
   *
   * @param \Drupal\user\UserInterface $target
   *   The target user.
   * @param array<EntityInterface> $groups
   *   The candidate groups.
   */
  private function belongsToAny(UserInterface $target, array $groups): bool {
    assert($this->membershipManager !== NULL);
    foreach ($groups as $group) {
      if ($this->membershipManager->getMembership($group, (int) $target->id()) !== NULL) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Checks that the request supplies exactly the configured context keys.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   */
  private function hasExactShape(BbFigureInterface $figure, array $entities): bool {
    $expected = $figure->getContextShape();
    $actual = array_keys($entities);
    sort($expected);
    sort($actual);
    return $expected === $actual;
  }

  /**
   * Evaluates the figure's configured Drupal conditions.
   *
   * @param \Drupal\bb_core\BbFigureInterface $figure
   *   The figure configuration.
   * @param array<string, EntityInterface> $entities
   *   The named route entities.
   */
  private function conditionsPass(BbFigureInterface $figure, array $entities): bool {
    $contexts = $this->contextRepository->fromEntities($entities);
    $conditions = [];
    try {
      foreach ($figure->getConditions() as $instanceId => $condition) {
        $this->contextHandler->applyContextMapping($condition, $contexts);
        $conditions[$instanceId] = $condition;
      }
    }
    catch (ContextException) {
      return FALSE;
    }
    return $this->resolveConditions($conditions, 'and');
  }

  /**
   * Checks a permission against groups associated with an entity.
   */
  private function hasPermissionInChain(AccountInterface $account, string $permission, EntityInterface $entity): bool {
    foreach ($this->fence->groupsAnchoredBy($entity) as $group) {
      if ($this->rankCapability->hasGroupPermission($account, $permission, $group)) {
        return TRUE;
      }
    }
    return FALSE;
  }

}
