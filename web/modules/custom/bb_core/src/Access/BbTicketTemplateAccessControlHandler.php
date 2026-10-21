<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Denies deleting a ticket template still referenced by a bb_ticket.
 */
final class BbTicketTemplateAccessControlHandler extends EntityAccessControlHandler implements EntityHandlerInterface {

  /**
   * Constructs a BbTicketTemplateAccessControlHandler.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
    parent::__construct($entity_type);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static($entity_type, $container->get('entity_type.manager'));
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    if ($operation !== 'delete') {
      return parent::checkAccess($entity, $operation, $account);
    }
    $parent = parent::checkAccess($entity, $operation, $account);
    if (!$parent->isAllowed()) {
      return $parent;
    }
    $count = (int) $this->entityTypeManager->getStorage('bb_ticket')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('template_id', $entity->id())
      ->range(0, 1)
      ->count()
      ->execute();
    if ($count > 0) {
      return AccessResult::forbidden('Template is referenced by one or more tickets.')
        ->addCacheableDependency($entity)
        ->addCacheTags(['bb_ticket_list']);
    }
    return $parent;
  }

}
