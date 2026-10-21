<?php

declare(strict_types=1);

namespace Drupal\bb_track;

/**
 * One submitted day cell of the personal week grid.
 */
final class WeekSheetCell {

  /**
   * Constructs the cell.
   *
   * @param string $date
   *   Civil date, Y-m-d.
   * @param int $projectId
   *   Project of the grid row.
   * @param int|null $ticketId
   *   Ticket of the grid row, if any.
   * @param string $typed
   *   The raw "h:mm" text, or '' for an empty cell.
   * @param int|null $entryId
   *   The one entry the cell showed when it was rendered.
   * @param string|null $version
   *   That entry's version at render time.
   */
  public function __construct(
    public readonly string $date,
    public readonly int $projectId,
    public readonly ?int $ticketId,
    public readonly string $typed,
    public readonly ?int $entryId,
    public readonly ?string $version,
  ) {}

  /**
   * Stable identity of the cell: day, project and ticket.
   */
  public function key(): string {
    return $this->date . ':' . $this->projectId . ':' . ($this->ticketId ?? 0);
  }

}
