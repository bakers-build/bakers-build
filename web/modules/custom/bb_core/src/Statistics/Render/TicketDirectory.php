<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Render;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * The ticket cells of the My closed tickets table.
 */
final class TicketDirectory {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * A linked `IDENT · title` cell per row key.
   *
   * @param array<int, string> $keys
   *   Row keys: ticket UUIDs.
   *
   * @return array<string, array<string, array<string, mixed>>>
   *   `label` cells keyed by row key.
   */
  public function cells(array $keys): array {
    $cells = [];
    if ($keys === []) {
      return $cells;
    }
    foreach ($this->entityTypeManager->getStorage('bb_ticket')->loadByProperties(['uuid' => $keys]) as $ticket) {
      if (!$ticket instanceof BbTicketInterface) {
        continue;
      }
      $identifier = (string) $ticket->get('identifier')->value;
      $cells[(string) $ticket->uuid()] = [
        'label' => [
          'kind' => 'link',
          'value' => ($identifier === '' ? '' : $identifier . ' · ') . $ticket->label(),
          'url' => $ticket->toUrl()->toString(),
        ],
      ];
    }
    return $cells;
  }

}
