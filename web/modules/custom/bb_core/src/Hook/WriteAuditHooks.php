<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Audit log for every bakers.build write operation.
 */
final class WriteAuditHooks {

  private const AUDITED_TYPES = [
    'bb_group',
    'bb_project',
    'bb_ticket',
    'bb_run',
    'bb_conductor',
  ];

  public function __construct(
    #[Autowire(service: 'logger.channel.bb_core')]
    private readonly LoggerInterface $logger,
    #[Autowire(service: 'current_user')]
    private readonly AccountInterface $currentUser,
  ) {
  }

  /**
   * Logs an audit entry when an audited bakers.build entity is created.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity that was inserted.
   */
  #[Hook('entity_insert')]
  public function entityInsert(EntityInterface $entity): void {
    $this->log($entity, 'insert');
  }

  /**
   * Logs an audit entry when an audited bakers.build entity is updated.
   *
   * For ticket updates, also records the state transition in the log message.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity that was updated.
   */
  #[Hook('entity_update')]
  public function entityUpdate(EntityInterface $entity): void {
    $this->log($entity, 'update');
  }

  /**
   * Writes an info log entry for an audited entity write operation.
   *
   * Skips entity types not listed in AUDITED_TYPES. For ticket updates,
   * appends the before/after state transition to the log message.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being written.
   * @param string $op
   *   The operation type, either 'insert' or 'update'.
   */
  private function log(EntityInterface $entity, string $op): void {
    if (!in_array($entity->getEntityTypeId(), self::AUDITED_TYPES, TRUE)) {
      return;
    }
    $context = [
      '@entity_type' => $entity->getEntityTypeId(),
      '@id' => (string) $entity->id(),
      '@uuid' => (string) $entity->uuid(),
      '@op' => $op,
      '@uid' => (int) $this->currentUser->id(),
    ];
    $message = 'bakers.build write: @op @entity_type @id (@uuid) by uid @uid';
    if ($entity instanceof ContentEntityInterface && $entity->getEntityTypeId() === 'bb_ticket' && $op === 'update') {
      $original = $entity->getOriginal();
      if ($original !== NULL) {
        $context['@state_before'] = (string) $original->get('state')->value;
        $context['@state_after'] = (string) $entity->get('state')->value;
        $message .= ' state @state_before -> @state_after';
      }
    }
    $this->logger->info($message, $context);
  }

}
