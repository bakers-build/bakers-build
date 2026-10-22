<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\EntityPublishedInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * Defines the interface for bakers.build comment entities.
 *
 * A comment is a structured note attached to a bakers.build ticket, authored by
 * either a human user or an automated conductor run.
 */
interface BbCommentInterface extends BbContentEntityInterface, EntityPublishedInterface, EntityOwnerInterface {

  /**
   * Returns the ID of the ticket this comment belongs to.
   *
   * @return int|null
   *   The ticket entity ID, or NULL if the reference is not set.
   */
  public function getTicketId(): ?int;

  /**
   * Returns the loaded ticket entity for this comment, or NULL if absent.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface|null
   *   The ticket entity, or NULL.
   */
  public function getTicket(): ?BbTicketInterface;

}
