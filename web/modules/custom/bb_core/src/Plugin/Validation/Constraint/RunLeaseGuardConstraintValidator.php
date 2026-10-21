<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates run lease integrity for conductor-scoped updates.
 */
final class RunLeaseGuardConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  private const ACTIVE_STATES = ['claimed', 'running'];

  // A hand-mirrored run-state list, a sibling of `STATE_MARKS`,
  // `CANCELLABLE_RUN_STATES` and `bb_run.transitions.cancel.from` — widen
  // all of them together when a state is added.
  private const TERMINAL_STATES = ['done', 'expired', 'failed', 'cancelled'];

  /**
   * Constructs a RunLeaseGuardConstraintValidator.
   *
   * @param \Drupal\Core\Session\AccountInterface $currentUser
   *   The current user account, used to bypass the check for administrators.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager, used to load the unchanged run entity.
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
    assert($constraint instanceof RunLeaseGuardConstraint);
    if ($this->currentUser->hasPermission('administer bakers')) {
      return;
    }
    $run = $items->getEntity();
    if (!$run instanceof BbRunInterface || $run->isNew()) {
      return;
    }
    $original = $this->entityTypeManager->getStorage('bb_run')->loadUnchanged($run->id());
    if (!$original instanceof BbRunInterface) {
      return;
    }
    $new_state = $run->getRunState();
    if (!in_array($new_state, self::ACTIVE_STATES, TRUE)) {
      return;
    }
    if (in_array($original->getRunState(), self::TERMINAL_STATES, TRUE)) {
      $this->context->addViolation($constraint->messageTerminal);
      return;
    }
    // Lease-expiry is no longer a validation gate: run existence blocks
    // re-claim, not claim_expires_at. The messageExpired string is kept on
    // the constraint class to avoid a wider blast-radius change.
  }

}
