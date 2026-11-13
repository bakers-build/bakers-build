<?php

declare(strict_types=1);

namespace Drupal\bb_core\Project;

use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * One open ticket where a person has to act now, and why.
 */
final readonly class AttentionItem {

  /**
   * Constructs an AttentionItem.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param string $severity
   *   The severity: `critical` or `warning`.
   * @param string $reason
   *   The reason text.
   * @param int|null $idleDays
   *   The whole days without movement; only set for the idle reason.
   */
  public function __construct(
    public BbTicketInterface $ticket,
    public string $severity,
    public string $reason,
    public ?int $idleDays = NULL,
  ) {
  }

}
