<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates ServiceAccountTicketOwnerConstraint.
 */
final class ServiceAccountTicketOwnerConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly ServiceAccountManager $serviceAccountManager,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('current_user'),
      $container->get(ServiceAccountManager::class),
      $container->get('entity_type.manager'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof ServiceAccountTicketOwnerConstraint);
    $entity = $items->getEntity();
    if (!$entity->isNew()) {
      return;
    }
    $actor = $this->entityTypeManager->getStorage('user')->load($this->currentUser->id());
    if (!$actor instanceof UserInterface || !$this->serviceAccountManager->isServiceAccount($actor)) {
      return;
    }
    $ownerId = $items->isEmpty() ? NULL : $items->first()->target_id;
    if ($ownerId !== NULL && (int) $ownerId !== (int) $actor->id()) {
      $this->context->addViolation($constraint->message);
    }
  }

}
