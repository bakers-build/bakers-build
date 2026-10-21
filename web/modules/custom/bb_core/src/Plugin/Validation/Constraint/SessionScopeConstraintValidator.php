<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbRankEntityFence;
use Drupal\bb_core\Access\BbWriteScope;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\user\EntityOwnerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates referenced ticket scope for session-scoped writes.
 */
final class SessionScopeConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs a SessionScopeConstraintValidator.
   *
   * @param \Drupal\bb_core\Access\BbWriteScope $writeScope
   *   The write-scope service determining which tickets are in session scope.
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The current user account, used to check permissions.
   * @param \Drupal\bb_core\Access\BbRankEntityFence $fence
   *   Resolves the tenancy chain the referenced ticket hangs in.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   Answers the ticket-edit rank question inside one group.
   */
  public function __construct(
    private readonly BbWriteScope $writeScope,
    private readonly AccountInterface $currentUser,
    private readonly BbRankEntityFence $fence,
    private readonly BbRankCapabilityInterface $capability,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_core.write_scope'),
      $container->get('current_user'),
      $container->get('bb_core.rank_entity_fence'),
      $container->get('bb_core.rank_capability'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof SessionScopeConstraint);
    if ($this->currentUser->hasPermission('administer bakers')
      || !$this->currentUser->hasPermission('write bakers via session scope')) {
      return;
    }
    $entity = $items->getEntity();
    if (!$entity->isNew()) {
      return;
    }
    if ($items->isEmpty()) {
      $this->validateEmptyReference($items, $constraint);
      return;
    }
    $target_id = $items->first()->target_id;
    if (is_numeric($target_id)
      && $this->writeScope->isTicketInScope($this->currentUser, (int) $target_id)) {
      return;
    }
    $target = $items->first()->entity;
    if ($target instanceof EntityInterface && $this->isExemptByTicketEditRank($target)) {
      return;
    }
    $this->context->addViolation($constraint->messageOutOfScope);
  }

  /**
   * Whether a rank in the ticket's own chain lets the actor edit it.
   *
   * Whoever may already PATCH this ticket may also comment on it, with no run.
   * Deliberately not `$target->access('update')`: a client_credentials token's
   * permissions are overwritten by its scopes, which would exempt every token
   * identity. The rank is read off the membership instead, so neither token
   * scopes nor OG's owner short-circuit can supply it, and a rank in another
   * tenancy grants nothing.
   *
   * @param \Drupal\Core\Entity\EntityInterface $target
   *   The referenced ticket.
   *
   * @return bool
   *   TRUE when a rank in the ticket's chain grants the actor ticket-edit.
   */
  private function isExemptByTicketEditRank(EntityInterface $target): bool {
    // `update own bb_ticket` is honoured only for the ticket's actual owner,
    // which is what the permission means; no shipped rank carries it today,
    // and leaving it out would silently re-open the very inconsistency this
    // ticket closes the day one does.
    $permissions = ['update any ' . $target->getEntityTypeId()];
    if ($target instanceof EntityOwnerInterface
      && (int) $target->getOwnerId() === (int) $this->currentUser->id()) {
      $permissions[] = 'update own ' . $target->getEntityTypeId();
    }
    foreach ($this->fence->groupsAnchoredBy($target) as $group) {
      foreach ($permissions as $permission) {
        if ($this->capability->hasGroupRolePermission($this->currentUser, $permission, $group)) {
          return TRUE;
        }
      }
    }
    return FALSE;
  }

  /**
   * Handles validation when the reference field is empty.
   *
   * Allows the reference to be empty when allowEmpty is set (e.g. parent_id
   * on a top-level ticket). Otherwise attempts to derive the ticket from a
   * run_id field. Adds a violation if neither condition is satisfied.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The field item list being validated.
   * @param \Drupal\bb_core\Plugin\Validation\Constraint\SessionScopeConstraint $constraint
   *   The constraint instance carrying message strings and flags.
   */
  private function validateEmptyReference(
    FieldItemListInterface $items,
    SessionScopeConstraint $constraint,
  ): void {
    if ($constraint->allowEmpty) {
      return;
    }
    $entity = $items->getEntity();
    if ($entity->hasField('run_id') && !$entity->get('run_id')->isEmpty()) {
      $run = $entity->get('run_id')->entity;
      if ($run instanceof BbRunInterface && $run->getTicketId() !== NULL) {
        if ($this->writeScope->isTicketInScope($this->currentUser, $run->getTicketId())) {
          return;
        }
        // Run exists but its ticket is outside session scope.
        $this->context->addViolation($constraint->messageOutOfScope);
        return;
      }
    }
    $this->context->addViolation($constraint->messageMissing);
  }

}
