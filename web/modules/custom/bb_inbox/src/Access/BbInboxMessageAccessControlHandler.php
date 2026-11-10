<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_core\Conductor\ConductorRegistrar;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Who sees and answers an inbox message.
 *
 * View: the requester, the conductor's owner (processing), or an
 * administrator. Generic ticket-view access is NOT sufficient (BB-661):
 * an answer can carry another user's sensitive result (e.g. a login URL),
 * so a co-viewer of the ticket who did not send the request never sees it
 * through direct entity/API access either.
 * Update: only the conductor's owner, and only status and result.
 * Create: closed to everyone but administrators; messages are created by the
 * sender service, which asks the responsible handler for access.
 */
final class BbInboxMessageAccessControlHandler extends EntityAccessControlHandler implements EntityHandlerInterface {

  private const CONDUCTOR_WRITABLE_FIELDS = ['status', 'result'];

  /**
   * Constructs a BbInboxMessageAccessControlHandler.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type definition.
   * @param \Drupal\bb_core\Conductor\ConductorRegistrar $registrar
   *   Decides whether an owner may still run a conductor.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    private readonly ConductorRegistrar $registrar,
  ) {
    parent::__construct($entity_type);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static($entity_type, $container->get('bb_core.conductor_registrar'));
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $result = parent::checkAccess($entity, $operation, $account);
    if ($result->isAllowed() || !$entity instanceof BbInboxMessageInterface) {
      return $result;
    }
    return match ($operation) {
      'view' => $this->viewAccess($entity, $account),
      'update' => AccessResult::allowedIf($this->ownsConductor($entity, $account))
        ->cachePerUser()
        ->addCacheTags(['og_membership_list'])
        ->addCacheableDependency($entity),
      default => $result,
    };
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    return AccessResult::allowedIfHasPermission($account, 'administer bakers');
  }

  /**
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($operation !== 'edit' || $account->hasPermission('administer bakers')) {
      return parent::checkFieldAccess($operation, $field_definition, $account, $items);
    }
    return AccessResult::allowedIf(in_array($field_definition->getName(), self::CONDUCTOR_WRITABLE_FIELDS, TRUE))
      ->cachePerPermissions();
  }

  /**
   * Requester or conductor owner only.
   *
   * A co-viewer of the ticket is not enough (BB-661) — a result can be
   * another person's sensitive answer.
   */
  private function viewAccess(BbInboxMessageInterface $message, AccountInterface $account): AccessResultInterface {
    if ((int) $message->get('requested_by')->target_id === (int) $account->id() && (int) $account->id() !== 0) {
      return AccessResult::allowed()->cachePerUser()->addCacheableDependency($message);
    }
    if ($this->ownsConductor($message, $account)) {
      return AccessResult::allowed()->cachePerUser()->addCacheTags(['og_membership_list'])->addCacheableDependency($message);
    }
    return AccessResult::forbidden('Only the requester or the processing conductor owner may view this message.')
      ->cachePerUser()
      ->addCacheTags(['og_membership_list'])
      ->addCacheableDependency($message);
  }

  /**
   * Whether the account owns the message's conductor and may still run it.
   *
   * A seat in another workspace keeps the site-wide permission, not this one.
   */
  private function ownsConductor(BbInboxMessageInterface $message, AccountInterface $account): bool {
    $conductor = $message->conductor();
    return $conductor !== NULL && $this->registrar->serves($conductor, $account);
  }

}
