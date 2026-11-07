<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Link\LinkKind;
use Drupal\bb_core\Time\BbDate;

/**
 * Maps ticket entities to board-card props.
 *
 * Column placement is each column display's filters on general index
 * fields. Card status, assignee mark and lease come from
 * {@see TicketRunDeriver}.
 */
final class ProjectBoard {

  public function __construct(
    private readonly TicketRunDeriver $deriver,
    private readonly BbDate $date,
  ) {}

  /**
   * Board-card records for one column's tickets.
   *
   * @param array<int|string, \Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   Tickets already limited to this column. Empty is a legal column.
   * @param string $display
   *   The Views display id. Running status is painted only on `working`.
   *
   * @return list<array<string, mixed>>
   *   Props for `bb_theme:board-card`.
   */
  public function cards(array $tickets, string $display = ''): array {
    $cards = [];
    foreach ($tickets as $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $cards[] = $this->card($ticket, $ticket->getState()->getId(), $display);
      }
    }
    return $cards;
  }

  /**
   * One board-card record.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param string $state
   *   The ticket's exact workflow state.
   * @param string $display
   *   The Views display id. Running status is painted only on `working`.
   *
   * @return array<string, mixed>
   *   Props for `bb_theme:board-card`.
   */
  private function card(BbTicketInterface $ticket, string $state, string $display): array {
    $assignee = $this->deriver->assignee($ticket);
    $priority = $ticket->getPriority();
    $running = $display === 'working' && $this->deriver->derivedStatus($ticket) === 'running';
    try {
      $url = $ticket->toUrl('canonical')->toString();
    }
    catch (\Exception) {
      $url = '';
    }
    $card = [
      'identifier' => $ticket->getIdentifier(),
      'title' => $ticket->getTitle(),
      'state' => $state,
      'url' => $url,
      'status' => $running ? 'running' : 'idle',
      'blocked' => $ticket->getBlockedByIds() !== [],
      'assignee_name' => $assignee['name'],
      'assignee_initials' => $assignee['initials'],
      'assignee_color' => $this->assigneeTone($assignee['color']),
      'type' => $ticket->getWorkflow(),
    ];
    $lease = $this->deriver->claimMachine($ticket);
    if ($lease !== '') {
      $card['lease'] = $lease;
    }
    if (in_array($priority, [1, 2, 3], TRUE)) {
      $card['priority'] = 'p' . $priority;
    }
    return $card + $this->doneFacts($ticket);
  }

  /**
   * When a closed ticket was done, relatively, and its merge request.
   *
   * Absent rather than empty on open tickets: the theme draws a done footer
   * only where there is something done to say.
   *
   * @return array{done_label?: string, done_datetime?: string, done_title?: string, mr_url?: string, mr_label?: string}
   *   The facts that apply.
   */
  private function doneFacts(BbTicketInterface $ticket): array {
    if (!$ticket->isClosed()) {
      return [];
    }
    $facts = [];
    $closed = $ticket->get('closed_date')->value;
    if ($closed !== NULL && $closed !== '') {
      $time = $this->date->cell((int) $closed);
      $facts['done_label'] = $time['label'];
      $facts['done_datetime'] = $time['datetime'];
      $facts['done_title'] = $time['title'];
    }
    foreach ($ticket->get('links')->getValue() as $link) {
      $uri = (string) ($link['uri'] ?? '');
      $kind = $link['options']['bakers']['kind'] ?? LinkKind::fromUri($uri);
      if ($kind === LinkKind::MR) {
        $facts['mr_url'] = $uri;
        $facts['mr_label'] = preg_match('#/merge_requests/(\d+)#', $uri, $match) === 1 ? 'MR !' . $match[1] : 'MR';
        break;
      }
    }
    return $facts;
  }

  /**
   * Maps a deriver avatar key onto a `person` colour token.
   *
   * TicketRunDeriver uses a–e; `bb_theme:person` and board-card accept the
   * five semantic tones. Unknown keys fall back to running so SDC validation
   * does not reject the card.
   */
  private function assigneeTone(string $color): string {
    $mapped = [
      'a' => 'running',
      'b' => 'attention',
      'c' => 'lease',
      'd' => 'offline',
      'e' => 'unassigned',
    ][$color] ?? $color;
    return in_array($mapped, ['running', 'attention', 'unassigned', 'lease', 'offline'], TRUE)
      ? $mapped
      : 'running';
  }

}
