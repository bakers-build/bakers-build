<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates conductor owner integrity for conductor-scoped accounts.
 *
 * Enforces that unprivileged users (those holding only the
 * "register bakers conductor" permission) set themselves as owner on creation
 * and cannot alter the owner field on subsequent saves. Users with
 * "administer bakers" bypass all checks.
 */
final class ConductorOwnerConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs a ConductorOwnerConstraintValidator.
   *
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The currently authenticated account.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager used to load the unchanged conductor for
   *   comparison during update operations.
   */
  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get('entity_type.manager'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof ConductorOwnerConstraint);
    if ($this->isBypassedForCurrentUser()) {
      return;
    }
    $entity = $items->getEntity();
    if (!$entity instanceof BbConductorInterface) {
      return;
    }
    $owner_id = $items->isEmpty() ? NULL : $items->first()->target_id;
    if ($entity->isNew()) {
      $this->validateOwnerOnCreate($owner_id, $constraint);
      return;
    }
    $this->validateOwnerOnUpdate($entity, $owner_id, $constraint);
  }

  /**
   * Returns TRUE when the current user bypasses all owner checks.
   *
   * Users with the 'administer bakers' permission always bypass. Users who do
   * not hold 'register bakers conductor' are not subject to the constraint at
   * all (they have either broader or no conductor-related permissions).
   *
   * @return bool
   *   TRUE when validation should be skipped for this user.
   */
  private function isBypassedForCurrentUser(): bool {
    return $this->currentUser->hasPermission('administer bakers')
      || !$this->currentUser->hasPermission('register bakers conductor');
  }

  /**
   * Validates that a new conductor sets the current user as owner.
   *
   * @param mixed $owner_id
   *   The target_id supplied for the owner field, or NULL when empty.
   * @param \Drupal\bb_core\Plugin\Validation\Constraint\ConductorOwnerConstraint $constraint
   *   The active constraint carrying the violation message.
   */
  private function validateOwnerOnCreate(mixed $owner_id, ConductorOwnerConstraint $constraint): void {
    if (!is_numeric($owner_id) || (int) $owner_id !== (int) $this->currentUser->id()) {
      $this->context->addViolation($constraint->messageNotSelf);
    }
  }

  /**
   * Validates that an existing conductor's owner field has not been changed.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $entity
   *   The conductor being saved.
   * @param mixed $owner_id
   *   The target_id currently set on the owner field.
   * @param \Drupal\bb_core\Plugin\Validation\Constraint\ConductorOwnerConstraint $constraint
   *   The active constraint carrying the violation message.
   */
  private function validateOwnerOnUpdate(BbConductorInterface $entity, mixed $owner_id, ConductorOwnerConstraint $constraint): void {
    $original = $this->entityTypeManager->getStorage('bb_conductor')->loadUnchanged($entity->id());
    if (!$original instanceof BbConductorInterface) {
      return;
    }
    $original_owner = $original->get('owner_user_id')->target_id;
    if ((string) $original_owner !== (string) $owner_id) {
      $this->context->addViolation($constraint->messageLocked);
    }
  }

}
