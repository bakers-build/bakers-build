<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_track\Entity\Submission;

/**
 * Only the recording owner can create, read and update a submission.
 */
final class SubmissionAccess extends EntityAccessControlHandler implements EntityHandlerInterface {

  /**
   * Constructs the owner access handler.
   */
  public function __construct(EntityTypeInterface $entity_type, private EntityTypeManagerInterface $entities) {
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
    $allowed = $entity instanceof Submission
      && $account->isAuthenticated()
      && (int) $entity->getOwnerId() === (int) $account->id()
      && in_array($operation, ['view', 'update'], TRUE);
    return ($allowed ? AccessResult::allowed() : AccessResult::forbidden())
      ->addCacheContexts(['user'])->addCacheableDependency($entity);
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    return $this->entities->getAccessControlHandler('bb_track_worklog')->createAccess(NULL, $account, [], TRUE);
  }

}
