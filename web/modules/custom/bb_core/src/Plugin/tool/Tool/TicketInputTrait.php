<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Component\Uuid\Uuid;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;

/**
 * Resolves a tool's `ticket` input, an identifier or UUID, under view access.
 */
trait TicketInputTrait {

  /**
   * The entity type manager; ToolBase's final constructor injects no more.
   */
  protected function entities(): EntityTypeManagerInterface {
    return \Drupal::entityTypeManager();
  }

  /**
   * The readable ticket, or an input error naming the value.
   *
   * @throws \InvalidArgumentException
   */
  protected function readableTicket(string $ticket): BbTicketInterface {
    $field = Uuid::isValid($ticket) ? 'uuid' : 'identifier';
    $storage = $this->entities()->getStorage('bb_ticket');
    // The scoped query is the read boundary JSON:API collections use too.
    $ids = $storage->getQuery()->accessCheck(TRUE)->condition($field, $ticket)->range(0, 1)->execute();
    $entity = $ids ? $storage->load(reset($ids)) : NULL;
    if (!$entity instanceof BbTicketInterface || !$entity->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Ticket %s does not exist or is not readable.', $ticket));
    }
    return $entity;
  }

  /**
   * The readable ticket, when the caller may also edit the given fields.
   *
   * @param string $ticket
   *   Identifier or UUID.
   * @param array<string> $fields
   *   The fields the tool writes.
   *
   * @throws \InvalidArgumentException
   */
  protected function writableTicket(string $ticket, array $fields): BbTicketInterface {
    $entity = $this->readableTicket($ticket);
    $writable = $entity->access('update', $this->currentUser);
    foreach ($fields as $field) {
      $writable = $writable && $entity->get($field)->access('edit', $this->currentUser);
    }
    if (!$writable) {
      throw new \InvalidArgumentException(sprintf('You may not change %s of ticket %s.', implode(', ', $fields), $ticket));
    }
    return $entity;
  }

  /**
   * Fails on the first violation of an entity about to be saved.
   *
   * @throws \InvalidArgumentException
   */
  protected function assertValid(ContentEntityInterface $entity): void {
    $violations = $entity->validate();
    if ($violations->count() > 0) {
      $violation = $violations->get(0);
      throw new \InvalidArgumentException(sprintf('%s: %s', $violation->getPropertyPath(), strip_tags((string) $violation->getMessage())));
    }
  }

}
