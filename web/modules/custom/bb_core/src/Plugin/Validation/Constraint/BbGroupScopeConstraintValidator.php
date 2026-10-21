<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbRankEntityFence;
use Drupal\bb_core\Access\BbWorkspaceReadScope;
use Drupal\og\MembershipManagerInterface;
use Drupal\og\OgMembershipInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates BbGroupScopeConstraint.
 *
 * @see \Drupal\bb_core\Plugin\Validation\Constraint\BbGroupScopeConstraint
 */
final class BbGroupScopeConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs a BbGroupScopeConstraintValidator.
   *
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The acting account.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   The rank capability resolver.
   * @param \Drupal\bb_core\Access\BbRankEntityFence $fence
   *   The fence, for its chain resolution.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager, to read the stored anchor.
   * @param \Drupal\og\MembershipManagerInterface|null $membershipManager
   *   OG's membership manager, to test team membership directly.
   */
  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly BbRankCapabilityInterface $capability,
    private readonly BbRankEntityFence $fence,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ?MembershipManagerInterface $membershipManager,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('current_user'),
      $container->get('bb_core.rank_capability'),
      $container->get('bb_core.rank_entity_fence'),
      $container->get('entity_type.manager'),
      $container->get('og.membership_manager', ContainerInterface::NULL_ON_INVALID_REFERENCE),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    if (!$value instanceof FieldItemListInterface || !$constraint instanceof BbGroupScopeConstraint) {
      return;
    }
    $entity = $value->getEntity();
    $entity_type_id = $entity->getEntityTypeId();

    // The instance-wide bypass, read through hasPermission() ON PURPOSE — it is
    // the one place the union is the right question, because it also carries
    // core's uid 1 short-circuit. Without that, every recipe content import and
    // every drush write would fail this constraint.
    $admin_permission = $entity->getEntityType()->getAdminPermission();
    if (is_string($admin_permission) && $this->currentUser->hasPermission($admin_permission)) {
      return;
    }

    // The capability a row's anchor demands is the right to CREATE that row in
    // the tenancy it names. Read site-wide first: an operator's grant is
    // instance-wide by definition and is not what this constraint bounds.
    $permission = 'create ' . $entity_type_id;
    if ($this->capability->hasSiteWidePermission($this->currentUser, $permission)) {
      return;
    }

    foreach ($value as $delta => $item) {
      $target = $item->entity ?? NULL;
      if ($target instanceof EntityInterface
        && !$this->anchorIsPermitted($entity, (string) $value->getName(), $target, $permission)) {
        $this->context->buildViolation($constraint->message)
          ->atPath((string) $delta)
          ->addViolation();
      }
    }
  }

  /**
   * Whether one anchor value is permitted for the acting account.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being validated.
   * @param string $field_name
   *   The anchor field name.
   * @param \Drupal\Core\Entity\EntityInterface $target
   *   The referenced entity.
   * @param string $permission
   *   The `create <type>` permission the anchor demands.
   *
   * @return bool
   *   TRUE when the anchor may stand.
   */
  private function anchorIsPermitted(EntityInterface $entity, string $field_name, EntityInterface $target, string $permission): bool {
    // An unchanged anchor is not re-litigated: the row is already there, and
    // failing it would make every unrelated edit of an inherited row impossible
    // for the very people who work in that tenancy.
    if ($this->isUnchanged($entity, $field_name, $target)) {
      return TRUE;
    }
    $groups = $this->fence->groupsAnchoredBy($target);
    if ($groups === []) {
      // Unresolvable chain — the same answer the read/write fence gives, so an
      // orphan row stays governed by the ordinary access checks rather than by
      // a guess made here.
      return TRUE;
    }

    // `create bb_project` is a workspace-scoped right (teams carry
    // visibility, not rights), so the permission loop alone would let any
    // workspace contributor place a project into any team. The actor must
    // also be an active member of the target team, unless they hold the
    // workspace see-all rank.
    if ($target->getEntityTypeId() === 'bb_team' && !$this->belongsToOrSeesAllOf($target, $groups)) {
      return FALSE;
    }

    foreach ($groups as $group) {
      if ($this->capability->hasGroupPermission($this->currentUser, $permission, $group)) {
        return TRUE;
      }
    }

    return FALSE;
  }

  /**
   * Whether the actor is a member of a team anchor, or sees all of it.
   *
   * Split out of ::anchorIsPermitted() for cyclomatic complexity, not for
   * reuse: `create bb_project` is a WORKSPACE-scoped right, so being present
   * in the anchor's own chain is not enough on its own to prove team
   * membership — see the caller's comment for why the check exists at all.
   *
   * @param \Drupal\Core\Entity\EntityInterface $team
   *   The `bb_team` anchor target.
   * @param array<\Drupal\Core\Entity\EntityInterface> $chain
   *   The team's own chain, as resolved by the fence.
   *
   * @return bool
   *   TRUE when the actor is an active member of $team, or holds a workspace
   *   `admin`/see-all rank on a workspace in $chain.
   */
  private function belongsToOrSeesAllOf(EntityInterface $team, array $chain): bool {
    if ($this->membershipManager === NULL) {
      return TRUE;
    }
    if ($this->membershipManager->isMember($team, (int) $this->currentUser->id())) {
      return TRUE;
    }
    // getUserGroupIdsByRoleIds() returns group ids as OG stored them —
    // strings, from og_membership's string `entity_id` base field — so the
    // comparison below casts both sides to int rather than comparing
    // strictly against a mixed-type list.
    $see_all_workspaces = array_map('intval', $this->membershipManager->getUserGroupIdsByRoleIds(
      (int) $this->currentUser->id(),
      BbWorkspaceReadScope::SEE_ALL_WORKSPACE_ROLE_IDS,
      [OgMembershipInterface::STATE_ACTIVE],
      FALSE,
    )['bb_workspace'] ?? []);
    foreach ($chain as $group) {
      if ($group->getEntityTypeId() === 'bb_workspace'
        && in_array((int) $group->id(), $see_all_workspaces, TRUE)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Whether the anchor already had this value on the stored row.
   *
   * The stored row is read with `loadUnchanged()` rather than from
   * `$entity->original`, and that is the whole correctness of this method:
   * `original` is populated in `EntityStorageBase::doPreSave()`, which runs
   * AFTER validation. Every JSON:API write validates before saving, so on the
   * one path that matters `original` is never set — a version of this check
   * that reads it always answers "changed", and the constraint then demands
   * `create <type>` for an edit that never touched the anchor.
   *
   * That was not theoretical: it denied a site-wide operator holding
   * `update any bb_ticket` a plain title change, after Layer B had already
   * allowed it. `loadUnchanged` also avoids `$entity->original`, deprecated in
   * Drupal 11.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being validated.
   * @param string $field_name
   *   The anchor field name.
   * @param \Drupal\Core\Entity\EntityInterface $target
   *   The referenced entity.
   *
   * @return bool
   *   TRUE when the row is saved and the anchor is unchanged.
   */
  private function isUnchanged(EntityInterface $entity, string $field_name, EntityInterface $target): bool {
    if ($entity->isNew() || $entity->id() === NULL) {
      return FALSE;
    }
    try {
      $stored = $this->entityTypeManager
        ->getStorage($entity->getEntityTypeId())
        ->loadUnchanged($entity->id());
    }
    catch (\Exception $e) {
      // Unreadable storage must not silently widen the fence.
      return FALSE;
    }
    if (!$stored instanceof FieldableEntityInterface || !$stored->hasField($field_name)) {
      return FALSE;
    }
    $previous = $stored->get($field_name)->target_id ?? NULL;

    return $previous !== NULL && (string) $previous === (string) $target->id();
  }

}
