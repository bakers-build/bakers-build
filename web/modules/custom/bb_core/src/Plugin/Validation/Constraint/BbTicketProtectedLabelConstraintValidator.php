<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
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
 * workspace the entity belongs to.
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
    $entity = $items->getEntity();
    if (!$entity instanceof BbTicketInterface && !$entity instanceof BbTicketTemplateInterface) {
      return;
    }
    $namespaces = $this->configFactory->get('bb_core.settings')->get('protected_label_namespaces') ?? [];
    if ($namespaces === []) {
      return;
    }
    $carried = $this->storedLabelIds($entity);
    foreach ($items->referencedEntities() as $term) {
      $name = (string) $term->label();
      if (!in_array((int) $term->id(), $carried, TRUE) && !$this->mayAdd(strstr($name, ':', TRUE), $namespaces, $entity)) {
        $this->context->addViolation($constraint->message, ['%label' => $name]);
        return;
      }
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
   * Whether the current user may add a label of the namespace to the entity.
   *
   * @param string|false $namespace
   *   The label text before the first colon, FALSE without a colon.
   * @param array<string> $protected
   *   The protected namespaces.
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The ticket or template.
   */
  private function mayAdd(string|false $namespace, array $protected, ContentEntityInterface $entity): bool {
    if (!in_array($namespace, $protected, TRUE)) {
      return TRUE;
    }
    if ($this->currentUser->hasPermission('write bakers via session scope')) {
      return FALSE;
    }
    $workspace = $this->workspaceResolver->resolve($entity);
    if ($workspace === NULL) {
      return FALSE;
    }
    if ($this->capability->hasGroupRolePermission($this->currentUser, ProtectedLabelPermissions::any($namespace), $workspace)) {
      return TRUE;
    }
    $conductor = $entity->get('conductor_id')->entity;
    return $conductor instanceof BbConductorInterface
      && $conductor->isOwnedBy($this->currentUser)
      && $this->capability->hasGroupRolePermission($this->currentUser, ProtectedLabelPermissions::own($namespace), $workspace);
  }

}
