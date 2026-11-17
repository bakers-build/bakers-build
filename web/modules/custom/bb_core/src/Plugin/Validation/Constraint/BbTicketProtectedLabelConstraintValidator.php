<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\ProtectedLabelPermissions;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Rejects a newly added protected label the current user may not add.
 *
 * Only labels absent from the stored entity are checked, so removing labels
 * and keeping carried ones always pass. A save without a human actor (uid 0)
 * passes. A session-scoped actor is always refused, and `administer bakers`
 * grants nothing here: the permissions come from the actor's own rank in the
 * workspace the entity belongs to. On a label term's name it refuses a
 * rename to a protected name unless the actor holds `any`.
 */
final class BbTicketProtectedLabelConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AccountInterface $currentUser,
    private readonly WorkspaceResolverInterface $workspaceResolver,
    private readonly BbRankCapabilityInterface $capability,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('config.factory'),
      $container->get('entity_type.manager'),
      $container->get('current_user'),
      $container->get('bb_core.workspace_resolver'),
      $container->get('bb_core.rank_capability'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $items, Constraint $constraint): void {
    assert($constraint instanceof BbTicketProtectedLabelConstraint);
    if (!$items instanceof FieldItemListInterface || $items->isEmpty() || $this->currentUser->isAnonymous()) {
      return;
    }
    $namespaces = $this->configFactory->get('bb_core.settings')->get('protected_label_namespaces') ?? [];
    if ($namespaces === []) {
      return;
    }
    $entity = $items->getEntity();
    if ($entity instanceof BbTermInterface) {
      $this->validateRename($entity, $namespaces, $constraint);
      return;
    }
    if ($entity instanceof BbTicketInterface || $entity instanceof BbTicketTemplateInterface) {
      $this->validateLabels($items, $entity, $namespaces, $constraint);
    }
  }

  /**
   * Rejects the first newly added protected label the actor may not add.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The labels.
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The ticket or template.
   * @param array<string> $namespaces
   *   The protected namespaces.
   * @param \Drupal\bb_core\Plugin\Validation\Constraint\BbTicketProtectedLabelConstraint $constraint
   *   The constraint.
   */
  private function validateLabels(FieldItemListInterface $items, ContentEntityInterface $entity, array $namespaces, BbTicketProtectedLabelConstraint $constraint): void {
    $carried = $this->storedLabelIds($entity);
    $workspace = $this->workspaceResolver->resolve($entity);
    $conductor = $entity->get('conductor_id')->entity;
    $conductor = $conductor instanceof BbConductorInterface ? $conductor : NULL;
    foreach ($items->referencedEntities() as $term) {
      $name = (string) $term->label();
      if (!in_array((int) $term->id(), $carried, TRUE) && !$this->mayAdd(strstr($name, ':', TRUE), $namespaces, $workspace, $conductor)) {
        $this->context->addViolation($constraint->message, ['%label' => $name]);
        return;
      }
    }
  }

  /**
   * Rejects renaming a label term to a protected name without `any`.
   *
   * Every ticket carrying the term would gain the name without a ticket save,
   * so only `any` counts. A new term passes: attaching it is checked.
   *
   * @param \Drupal\bb_core\Entity\BbTermInterface $term
   *   The term.
   * @param array<string> $namespaces
   *   The protected namespaces.
   * @param \Drupal\bb_core\Plugin\Validation\Constraint\BbTicketProtectedLabelConstraint $constraint
   *   The constraint.
   */
  private function validateRename(BbTermInterface $term, array $namespaces, BbTicketProtectedLabelConstraint $constraint): void {
    if ($term->isNew() || $term->bundle() !== 'label') {
      return;
    }
    $name = $term->getName();
    $stored = $this->entityTypeManager->getStorage('bb_term')->loadUnchanged($term->id());
    if ($stored instanceof BbTermInterface && $stored->getName() === $name) {
      return;
    }
    $workspace = $term->get('workspace_id')->entity;
    if (!$this->mayAdd(strstr($name, ':', TRUE), $namespaces, $workspace instanceof BbWorkspaceInterface ? $workspace : NULL, NULL)) {
      $this->context->addViolation($constraint->renameMessage, ['%label' => $name]);
    }
  }

  /**
   * The label term ids of the stored entity, empty for a new one.
   *
   * @return array<int>
   *   The term ids.
   */
  private function storedLabelIds(ContentEntityInterface $entity): array {
    $stored = $entity->isNew() ? NULL : $this->entityTypeManager->getStorage($entity->getEntityTypeId())->loadUnchanged($entity->id());
    if (!$stored instanceof ContentEntityInterface) {
      return [];
    }
    return array_map('intval', array_column($stored->get('labels')->getValue(), 'target_id'));
  }

  /**
   * Whether the current user may add a label of the namespace.
   *
   * @param string|false $namespace
   *   The label text before the first colon, FALSE without a colon.
   * @param array<string> $protected
   *   The protected namespaces.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface|null $workspace
   *   The workspace the label is used in.
   * @param \Drupal\bb_core\Entity\BbConductorInterface|null $conductor
   *   The conductor whose owner may use `own`, NULL when `own` does not apply.
   */
  private function mayAdd(string|false $namespace, array $protected, ?BbWorkspaceInterface $workspace, ?BbConductorInterface $conductor): bool {
    if (!in_array($namespace, $protected, TRUE)) {
      return TRUE;
    }
    if ($this->currentUser->hasPermission('write bakers via session scope') || $workspace === NULL) {
      return FALSE;
    }
    if ($this->capability->hasGroupRolePermission($this->currentUser, ProtectedLabelPermissions::any($namespace), $workspace)) {
      return TRUE;
    }
    return $conductor !== NULL
      && $conductor->isOwnedBy($this->currentUser)
      && $this->capability->hasGroupRolePermission($this->currentUser, ProtectedLabelPermissions::own($namespace), $workspace);
  }

}
