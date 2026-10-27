<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\bb_core\Conductor\ConductorOwnerAccess;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates a newly set conductor against its owner's access and role.
 *
 * Only a changed reference is checked, as for BbConductorActive, so a ticket
 * stranded on a conductor whose owner lost access still saves unrelated edits.
 */
final class ConductorOwnerAccessConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ConductorOwnerAccess $ownerAccess,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('bb_core.conductor_owner_access'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    if (!$constraint instanceof ConductorOwnerAccessConstraint || !$value instanceof FieldItemListInterface) {
      return;
    }
    $conductor = $this->newlySetConductor($value);
    if ($conductor === NULL) {
      return;
    }
    $entity = $value->getEntity();
    if (!$this->ownerAccess->ownerHasAccess($conductor, (int) $entity->get('project_id')->target_id)) {
      $this->context->addViolation($constraint->message, ['@label' => $conductor->label()]);
      return;
    }
    if ($entity instanceof BbTicketInterface && !$this->ownerAccess->ownerIsResponsible($conductor, $entity)) {
      $this->context->addViolation($constraint->notResponsibleMessage, ['@label' => $conductor->label()]);
    }
  }

  /**
   * The conductor this write newly sets on a ticket or template with a project.
   *
   * A missing project is BbConductorProjectMatch's refusal, not this one's.
   */
  private function newlySetConductor(FieldItemListInterface $items): ?BbConductorInterface {
    $conductor = $items->entity;
    $entity = $items->getEntity();
    if (
      !$conductor instanceof BbConductorInterface
      || (!$entity instanceof BbTicketInterface && !$entity instanceof BbTicketTemplateInterface)
      || !is_numeric($entity->get('project_id')->target_id)
    ) {
      return NULL;
    }
    $previous = $this->previousConductorId($entity);
    return $previous !== NULL && (string) $previous === (string) $conductor->id() ? NULL : $conductor;
  }

  /**
   * The conductor id the entity carried before this write, if any.
   *
   * Read from storage when no save cycle is running; see
   * ConductorActiveConstraintValidator::previousConductorId().
   */
  private function previousConductorId(ContentEntityInterface $entity): string|null {
    $original = $entity->getOriginal();
    if (!$original instanceof ContentEntityInterface) {
      $original = $entity->isNew() ? NULL : $this->entityTypeManager->getStorage($entity->getEntityTypeId())->loadUnchanged($entity->id());
    }
    return $original instanceof ContentEntityInterface ? $original->get('conductor_id')->target_id : NULL;
  }

}
